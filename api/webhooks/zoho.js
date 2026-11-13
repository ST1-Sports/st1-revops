import { prisma }                    from '../_lib/prisma.js';
import { setCors }                   from '../_lib/cors.js';
import { recordOutcome, remember }   from '../_lib/memory.js';
import { serverCallHeaders } from '../_lib/agentGate.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate shared secret — fail closed, otherwise anyone can POST Closed Won.
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'ZOHO_WEBHOOK_SECRET is not configured' });
  const incoming = req.headers['x-webhook-secret'] || req.query.secret;
  if (incoming !== secret) return res.status(401).json({ error: 'Invalid webhook secret' });

  try {
    const body = req.body || {};

    // Zoho sends either a single object or an array under body.data
    const items = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [body];

    for (const item of items) {
      const stage = item.Stage || item.Deal_Stage || item['Stage'];
      if (stage !== 'Closed Won') continue;

      const dealId   = item.id   || item.ID   || item.Id;
      const amount   = parseFloat(item.Amount || item.amount || 0);
      const email    = (item.Contact_Email || item['Contact Email'] || item['Email'] || '').toLowerCase().trim();

      // Brad feedback loop — Closed Won deals close out pending Brad outreach
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
          headers: {
            'Content-Type': 'application/json',
            ...serverCallHeaders(),
            ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
          },
          body:    JSON.stringify({
            action:        'draft',
            crmDealId:     String(dealId),
            crmDealName:   item.Deal_Name || item.Name || '',
            crmAccountName: typeof item.Account_Name === 'object' ? item.Account_Name?.name : item.Account_Name || '',
            crmEmail:      email,
            dealAmount:    amount,
            dryRun:        false,
            triggerSource: 'CRM_WEBHOOK',
          }),
        }).then(async r => {
          const d = await r.json().catch(() => ({}))
          if (!r.ok || d.invoiceSyncFailed) {
            console.error('[zoho webhook] invoice draft:', d.error || r.status)
          }
        }).catch(e => console.error('[zoho webhook] invoice draft error:', e.message));
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Zoho webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
}
