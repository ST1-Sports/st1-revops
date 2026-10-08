/**
 * POST /api/outreach/reconcile-sent
 *
 * One-time (and re-runnable) repair for the send-batches.js time-budget bug
 * (fixed alongside this file): a batch that ran out of function time mid-send
 * had its already-sent contacts' enrollments silently dropped instead of
 * persisted, so the next "Schedule All Batches" pass re-emailed them. There's
 * no durable send log the cron wrote that we can replay, so the only ground
 * truth for "did this contact actually get an email" is the sending mailbox's
 * own Sent folder.
 *
 * For each contact in the campaign who's still sitting at a step without a
 * recorded send, this searches that step's actual Gmail Sent folder for a
 * message to their address. A match means a real email already went out —
 * it's marked sent (same enrollment advance the cron does on a real send)
 * WITHOUT sending anything. No match means they're still legitimately due.
 *
 * Body: { campaignId, sinceDate?: 'YYYY-MM-DD' (default 45 days back), dryRun?: boolean (default true) }
 * Returns: { ok, dryRun, checked, matched, matches: [{contactId,email,name,step,sentAt}], truncated?, errors }
 */
import { setCors } from '../_lib/cors.js';
import { prisma } from '../_lib/prisma.js';
import { requireInternalSecret } from '../_lib/internalAuth.js';
import { getGmailAccessToken } from '../_lib/gmailAuth.js';
import { updateSettingSafely } from '../_lib/settingSync.js';

const MAX_DURATION_MS = 110_000; // keep under this file's 120s maxDuration (vercel.json)
const CONCURRENCY = 8;

function extractEmails(headerValue) {
  return (headerValue.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map(e => e.toLowerCase());
}

async function findSentMatch(token, email, sinceDate) {
  const q = `in:sent to:${email} after:${sinceDate.replace(/-/g, '/')}`;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=5`;
  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error(listData.error?.message || 'Gmail search failed');
  const messages = listData.messages || [];
  if (messages.length === 0) return null;

  // Confirm the match is really To: this address (not just present somewhere
  // in the thread, e.g. a Cc or an earlier message) and get a real sent date.
  for (const { id } of messages) {
    const metaRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    if (!metaRes.ok) continue;
    const toHeader = (meta.payload?.headers || []).find(h => h.name === 'To')?.value || '';
    if (!extractEmails(toHeader).includes(email)) continue;
    const ms = Number(meta.internalDate) || Date.parse((meta.payload?.headers || []).find(h => h.name === 'Date')?.value || '') || Date.now();
    return new Date(ms).toISOString();
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireInternalSecret(req, res)) return;

  const campaignId = String(req.body?.campaignId || '');
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  const dryRun = req.body?.dryRun !== false;
  const sinceDate = req.body?.sinceDate || new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);

  const runStart = Date.now();

  try {
    const row = await prisma.setting.findUnique({ where: { key: 'app_state' } });
    const state = row?.value || {};
    const campaigns = state.campaigns || [];
    const camp = campaigns.find(c => c.id === campaignId);
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });

    const contacts = state.contacts || [];
    const contactMap = {};
    for (const c of contacts) if (c?.id) contactMap[c.id] = c;
    const reps = state.reps || [];
    const rep = camp.repId ? reps.find(r => r.id === camp.repId) : null;

    let token;
    try {
      token = await getGmailAccessToken(camp.fromBrad ? 'BRAD' : (rep?.gmailEnvKey || ''));
    } catch (e) {
      return res.status(500).json({ error: `Gmail auth: ${e.message}` });
    }

    const candidates = (camp.enrollments || []).filter(e => {
      if (e.status !== 'active') return false;
      if ((e.sentSteps || []).includes(e.step)) return false; // already correctly recorded
      return !!contactMap[e.contactId]?.email;
    });

    const matches = [];
    const errors = [];
    let checked = 0;
    let truncated = false;

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      if (Date.now() - runStart > MAX_DURATION_MS) { truncated = true; break; }
      const chunk = candidates.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async (enroll) => {
        const c = contactMap[enroll.contactId];
        const email = c.email.trim().toLowerCase();
        const sentAt = await findSentMatch(token, email, sinceDate);
        return { enroll, c, email, sentAt };
      }));
      for (const r of results) {
        checked++;
        if (r.status === 'rejected') { errors.push(r.reason?.message || String(r.reason)); continue; }
        const { enroll, c, email, sentAt } = r.value;
        if (sentAt) {
          matches.push({
            contactId: enroll.contactId,
            email,
            name: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim(),
            step: enroll.step,
            sentAt,
          });
        }
      }
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, campaignId, candidates: candidates.length, checked, matched: matches.length, matches, sinceDate, truncated, errors: errors.length ? errors : undefined });
    }

    if (matches.length > 0) {
      await updateSettingSafely('app_state', (value) => {
        const st = value || {};
        const camps = st.campaigns || [];
        return {
          ...st,
          campaigns: camps.map(c => {
            if (c.id !== campaignId) return c;
            const updEnr = [...(c.enrollments || [])];
            for (const m of matches) {
              const idx = updEnr.findIndex(e => e.contactId === m.contactId);
              if (idx < 0 || updEnr[idx].step !== m.step) continue; // stale — someone else already advanced this one
              const ns = m.step + 1;
              const done = ns >= (c.touches || []).length;
              const nt = (c.touches || [])[ns];
              const nd = nt ? new Date(Date.now() + nt.dayOffset * 86400000).toISOString().slice(0, 10) : null;
              const dateStr = m.sentAt.slice(0, 10);
              updEnr[idx] = {
                ...updEnr[idx],
                sentSteps: [...(updEnr[idx].sentSteps || []), m.step],
                step: ns,
                status: done ? 'done' : 'active',
                nextDate: nd || updEnr[idx].nextDate,
                lastContacted: dateStr,
                lastSentAt: dateStr,
                reconciledSteps: [...(updEnr[idx].reconciledSteps || []), m.step],
              };
            }
            return {
              ...c,
              enrollments: updEnr,
              lastReconcile: { at: new Date().toISOString(), matched: matches.length, sinceDate },
            };
          }),
        };
      });
    }

    return res.json({ ok: true, dryRun: false, campaignId, candidates: candidates.length, checked, matched: matches.length, matches, truncated, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error('[reconcile-sent]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
