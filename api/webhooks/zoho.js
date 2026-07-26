import { prisma }                    from '../_lib/prisma.js';
import { setCors }                   from '../_lib/cors.js';
import { recordOutcome, remember }   from '../_lib/memory.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// Maps Zoho Lead_Source values to ad platform IDs
const SOURCE_TO_PLATFORM = {
  'Google Ads':     'google',
  'Google':         'google',
  'Facebook':       'meta',
  'Facebook Ads':   'meta',
  'Instagram':      'meta',
  'LinkedIn':       'linkedin',
  'LinkedIn Ads':   'linkedin',
  'TikTok':         'tiktok',
  'TikTok Ads':     'tiktok',
  'Microsoft Ads':  'microsoft',
  'Bing Ads':       'microsoft',
  'YouTube':        'youtube',
  'YouTube Ads':    'youtube',
};

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate shared secret
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (secret) {
    const incoming = req.headers['x-webhook-secret'] || req.query.secret;
    if (incoming !== secret) return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const body = req.body || {};

    // Zoho sends either a single object or an array under body.data
    const items = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [body];

    let created = 0;
    for (const item of items) {
      const stage = item.Stage || item.Deal_Stage || item['Stage'];
      if (stage !== 'Closed Won') continue;

      const dealId   = item.id   || item.ID   || item.Id;
      const amount   = parseFloat(item.Amount || item.amount || 0);
      const source   = item.Lead_Source || item['Lead Source'] || '';
      const campaign = item.Campaign_Name || item['Campaign Name'] || item.Campaign || '';
      const email    = (item.Contact_Email || item['Contact Email'] || item['Email'] || '').toLowerCase().trim();
      const contactId= item.Contact_Id    || item['Contact Id']    || '';

      const platform = SOURCE_TO_PLATFORM[source] || 'unknown';

      // Ad attribution — isolated so a missing migration doesn't block the feedback loop
      try {
        await prisma.ad_attribution.create({
          data: {
            platform,
            platform_campaign_id: campaign || null,
            zoho_deal_id:         dealId   ? String(dealId) : null,
            zoho_contact_id:      contactId ? String(contactId) : null,
            contact_email:        email    || null,
            attributed_revenue:   amount,
            attribution_type:     'last_touch',
            converted_at:         new Date(),
          },
        });
        created++;
      } catch (e) {
        if (e.code !== 'P2021' && !e.message?.includes('does not exist')) throw e;
        // ad_attribution table not yet migrated — skip attribution, continue to feedback loop
      }

      // Brad feedback loop — always runs regardless of attribution table state
      if (email) {
        try {
          const pending = await prisma.agentInteraction.findMany({
            where: {
              agentId: 'brad',
              action:  'outreach',
              outcome: 'pending',
              input:   { path: ['contactEmail'], equals: email },
            },
            orderBy: { createdAt: 'desc' },
            take:    5,
          });
          await Promise.all(pending.map(i => recordOutcome(i.id, 'won')));

          await remember({
            scope:   'org',
            entity:  `customer:${email}`,
            key:     'last_closed_won',
            value:   JSON.stringify({ dealId: String(dealId || ''), amount, closedAt: new Date().toISOString() }),
            agentId: 'system',
          });
        } catch (e) {
          console.error('[zoho webhook] brad outcome loop:', e.message);
        }
      }

      // Ledger invoice creation — fire-and-forget (non-blocking)
      if (dealId) {
        const host = req.headers.host;
        fetch(`https://${host}/api/agents/ledger/invoice`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            action:        'draft',
            crmDealId:     String(dealId),
            crmDealName:   item.Deal_Name || item.Name || '',
            crmAccountName: typeof item.Account_Name === 'object' ? item.Account_Name?.name : item.Account_Name || '',
            crmEmail:      email,
            dealAmount:    amount,
            dryRun:        false,
          }),
        }).catch(e => console.error('[zoho webhook] invoice draft error:', e.message));
      }
    }

    return res.status(200).json({ ok: true, attributionsCreated: created });
  } catch (e) {
    console.error('Zoho webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
}
