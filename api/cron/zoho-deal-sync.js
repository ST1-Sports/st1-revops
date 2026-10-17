/**
 * /api/cron/zoho-deal-sync — Background pull of new/changed Zoho CRM Deals
 *
 * Deals created directly in Zoho (e.g. by an external Claude Desktop + Zoho
 * MCP integration, not through this app) previously only ever showed up here
 * once someone happened to have RevOps open in a browser tab — the existing
 * sync (syncContacts in RevOps.jsx) is a client-side setInterval, so with no
 * tab open nothing syncs no matter how long you wait. This runs server-side
 * on its own schedule (see vercel.json) instead.
 *
 * Incremental: pulls only Deals Zoho says were modified since the last
 * successful run (state.dealsCronLastSync, a dedicated watermark — not the
 * client sync's own contactsLastSync, so the two don't fight over cadence),
 * not a full re-pull every time. First run (no watermark yet) just
 * establishes the watermark at "now" rather than pulling full history — see
 * the bootstrap branch below for why. Produces the exact same local Deal
 * shape + stage mapping the client-side sync does, so a deal synced from
 * either path looks identical, and checks dealIsSuppressed the same way so
 * a deal a user deliberately deleted is never resurrected.
 *
 * This only adds/updates — it does not detect deals deleted in Zoho (an
 * incremental "modified since" pull has no way to see something that's
 * gone). The client-side sync already does a full dead-deal sweep whenever
 * anyone opens the app, so that cleanup still happens; this job is purely
 * additive, for freshness when no one has.
 */
import { prisma } from '../_lib/prisma.js';
import { getZohoToken } from '../_lib/zoho-token.js';
import { CRM_BASE, zohoCrmHeaders } from '../_lib/zohoCrm.js';
import { updateSettingSafely } from '../_lib/settingSync.js';
import { dealIsSuppressed } from '../../src/lib/dealTombstone.js';

const DEAL_FIELDS = 'Deal_Name,Amount,Stage,Closing_Date,Account_Name,Contact_Name,Description,Modified_Time,Created_Time';
const DEAL_STAGES = ['Quoted', 'Follow-Up 1', 'Follow-Up 2', 'Negotiating', 'PO Received', 'Closed Won', 'Closed Lost', 'On Hold'];
const STAGE_MAP = {
  'Qualification': 'Quoted', 'Value Proposition': 'Quoted',
  'Id. Decision Makers': 'Follow-Up 1', 'Perception Analysis': 'Follow-Up 1',
  'Proposal/Price Quote': 'Quoted', 'Negotiation/Review': 'Negotiating',
  'Closed Won': 'Closed Won', 'Closed Lost': 'Closed Lost',
};

const zs = v => (typeof v === 'string' ? v : (v?.name || v?.display_value || ''));

// Defensive cap for a burst hour (e.g. a bulk import via the external
// integration) — a normal incremental run needs exactly 1 page. If the cap
// is hit, the watermark advances only to the latest Modified_Time actually
// processed (see below), not to "now", so the next run picks up the rest
// instead of silently skipping it.
const MAX_PAGES = 10;

async function fetchDealsSince(token, sinceMs) {
  const all = [];
  let page = 1;
  let truncated = false;
  // Same criteria shape as the client-side zohoFetchSince (RevOps.jsx) —
  // proven to work against this org's Zoho CRM already.
  const dt = new Date(sinceMs || 0).toISOString();
  const criteria = encodeURIComponent(`(Modified_Time:greater_than:${dt})`);
  while (true) {
    const url = `${CRM_BASE}/Deals/search?criteria=${criteria}&fields=${DEAL_FIELDS}&per_page=200&page=${page}`;
    const r = await fetch(url, { headers: zohoCrmHeaders(token) });
    if (r.status === 204) break; // no records at all
    const data = await r.json().catch(() => null);
    if (data?.status === 'error') throw new Error(data.message || 'Zoho Deals search failed');
    const batch = data?.data || [];
    all.push(...batch);
    if (!data?.info?.more_records || batch.length < 200) break;
    if (page >= MAX_PAGES) { truncated = true; break; }
    page++;
  }
  return { rows: all, truncated };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const row = await prisma.setting.findUnique({ where: { key: 'app_state' } });
    const sinceMs = row?.value?.dealsCronLastSync || 0;

    // First-ever run: there's no watermark to pull "since", and attempting a
    // full historical pull here risks the function timeout on a large org
    // (an incomplete pull would then advance the watermark to now and skip
    // whatever page it hadn't reached yet, which has no Modified_Time newer
    // than "now" to ever be picked up by a later incremental run). A full
    // historical backfill already exists — the "↓ FULL PULL" button in the
    // app — so this job's job is purely "keep up from here on," not
    // backfill: it just establishes the watermark and starts catching real
    // new/changed deals from the next run onward.
    if (!sinceMs) {
      await updateSettingSafely('app_state', (value) => ({ ...(value || {}), dealsCronLastSync: Date.now() }));
      return res.json({ ok: true, bootstrapped: true, fetched: 0, dealsAdded: 0, dealsUpdated: 0 });
    }

    const token = await getZohoToken();
    let dealRows, truncated;
    try {
      const result = await fetchDealsSince(token, sinceMs);
      dealRows = result.rows;
      truncated = result.truncated;
    } catch (err) {
      console.error('[zoho-deal-sync] fetch failed:', err.message);
      return res.status(502).json({ ok: false, error: err.message });
    }

    const now = Date.now();
    const nextWatermark = truncated && dealRows.length
      ? Math.max(sinceMs, ...dealRows.map(d => Date.parse(d.Modified_Time) || 0))
      : now;
    let dealsAdded = 0, dealsUpdated = 0, dealsSkippedSuppressed = 0;

    await updateSettingSafely('app_state', (value) => {
      const st = value || {};
      const deals = [...(st.deals || [])];
      const byZohoId = new Map(deals.filter(d => d.zohoId).map(d => [String(d.zohoId), d]));
      const suppress = { suppressedDealIds: st.suppressedDealIds, suppressedDealZohoIds: st.suppressedDealZohoIds };

      for (const zd of dealRows) {
        const zStage = zs(zd.Stage) || 'Quoted';
        const localStage = DEAL_STAGES.includes(zStage) ? zStage : (STAGE_MAP[zStage] || 'Quoted');
        const existing = byZohoId.get(String(zd.id));

        if (existing) {
          if (existing.stage !== localStage) {
            const idx = deals.findIndex(d => d.id === existing.id);
            if (idx >= 0) deals[idx] = { ...deals[idx], stage: localStage, zohoStage: zStage };
            dealsUpdated++;
          }
          continue;
        }

        const candidate = { id: 'zoho_d_' + zd.id, zohoId: zd.id };
        if (dealIsSuppressed(candidate, suppress)) { dealsSkippedSuppressed++; continue; }

        const fresh = {
          id: 'zoho_d_' + zd.id, zohoId: zd.id,
          name: zs(zd.Deal_Name) || 'Untitled',
          contact: zs(zd.Contact_Name), school: zs(zd.Account_Name),
          value: Number(zd.Amount) || 0,
          stage: localStage, zohoStage: zStage,
          notes: zd.Description || '', followUpDate: zd.Closing_Date || '',
          lastTouch: now, priority: 'warm', touchHistory: [], source: 'zoho-crm',
        };
        deals.push(fresh);
        byZohoId.set(String(zd.id), fresh);
        dealsAdded++;
      }

      return {
        ...st,
        deals,
        dealsCronLastSync: nextWatermark,
        lastDealsCronRun: {
          at: new Date(now).toISOString(),
          fetched: dealRows.length,
          added: dealsAdded,
          updated: dealsUpdated,
          skippedSuppressed: dealsSkippedSuppressed,
          truncated,
        },
      };
    });

    console.log(`[zoho-deal-sync] fetched=${dealRows.length} added=${dealsAdded} updated=${dealsUpdated} skippedSuppressed=${dealsSkippedSuppressed}${truncated?' (truncated, resuming next run)':''}`);
    return res.json({ ok: true, fetched: dealRows.length, dealsAdded, dealsUpdated, dealsSkippedSuppressed, truncated });
  } catch (err) {
    console.error('[zoho-deal-sync] crashed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
