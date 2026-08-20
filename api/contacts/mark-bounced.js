/**
 * POST /api/contacts/mark-bounced
 *
 * Flags a bounced email address durably beyond the one Bulk Outreach batch
 * that discovered it: marks the shared SalesContact record bounced (so
 * future imports/dedup see it), mirrors it into Zoho as an opted-out email
 * (same Email_Opt_Out convention RevOps.jsx's own bounce toggle already
 * uses), and looks for a different, still-good email on file for the same
 * company — another SalesContact under the same Account (or matching
 * company name) — as a suggested replacement.
 *
 * Body: { email }
 * Response: { ok, matched, zohoMirrored, suggestedEmail }
 */

import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const normEmail = String(email).toLowerCase().trim();

  try {
    const contact = await prisma.salesContact.findUnique({ where: { email: normEmail } });
    if (!contact) return res.json({ ok: true, matched: false });

    await prisma.salesContact.update({
      where: { id: contact.id },
      data: {
        status: 'bounced',
        notes: [contact.notes, `Bounced ${new Date().toISOString().slice(0, 10)} (Brad bulk outreach)`].filter(Boolean).join(' — '),
      },
    });

    let zohoMirrored = false;
    if (contact.zohoCrmId && contact.zohoModule) {
      try {
        const zr = await fetch(`https://${req.headers.host}/api/zoho`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service: 'crm', method: 'PUT', endpoint: `/${contact.zohoModule}/${contact.zohoCrmId}`,
            body: { data: [{ id: contact.zohoCrmId, Email_Opt_Out: true }] },
          }),
        });
        const zd = await zr.json();
        zohoMirrored = !zd.error && zd._http_status < 300;
      } catch { /* zoho mirror is best-effort — the local flag above is what matters most */ }
    }

    const altWhere = contact.accountId
      ? { accountId: contact.accountId, email: { not: contact.email }, status: { not: 'bounced' } }
      : contact.companyName
        ? { companyName: contact.companyName, email: { not: contact.email }, status: { not: 'bounced' } }
        : null;
    const alt = altWhere ? await prisma.salesContact.findFirst({ where: altWhere, orderBy: { updatedAt: 'desc' } }) : null;

    return res.json({ ok: true, matched: true, zohoMirrored, suggestedEmail: alt?.email || null });
  } catch (e) {
    console.error('[mark-bounced]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
