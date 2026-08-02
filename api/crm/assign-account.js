/**
 * POST /api/crm/assign-account
 *
 * Links an already-real Zoho Contact to a real Zoho Account — the manual
 * "yes, that match is correct" action behind the Assign button on the
 * accounts-status unassigned-matches list. Only ever called for a contact
 * that's already a real Zoho Contact (never a Lead — Leads intentionally
 * stay account-less until they're promoted, see zoho-align-accounts.js).
 *
 * Body: { contactId, accountId }
 * Returns: { ok }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { zohoCrmHeaders, CRM_BASE } from '../_lib/zohoCrm.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactId, accountId } = req.body || {}
  if (!contactId || !accountId) return res.status(400).json({ error: 'contactId and accountId required' })

  const contact = await prisma.salesContact.findUnique({ where: { id: contactId } }).catch(() => null)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  if (contact.zohoModule !== 'Contacts' || !contact.zohoCrmId) {
    return res.status(400).json({ error: 'Contact is not a real Zoho Contact yet — nothing to link' })
  }

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const headers = zohoCrmHeaders(token)

  const putRes = await fetch(`${CRM_BASE}/Contacts/${contact.zohoCrmId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ data: [{ id: contact.zohoCrmId, Account_Name: { id: accountId } }] }),
  })
  const putData = await putRes.json().catch(() => null)
  const rec = putData?.data?.[0]
  if (rec?.status === 'error') return res.status(502).json({ error: rec.message || 'Zoho link failed' })

  // Also link the local Account row, if we have one for this Zoho Account id —
  // keeps the local Prisma side (used by sync-books-accounts/zoho-align-accounts)
  // consistent with what Zoho now shows, not just Zoho itself.
  const localAccount = await prisma.account.findFirst({ where: { zohoAccountId: accountId } }).catch(() => null)
  await prisma.salesContact.update({
    where: { id: contactId },
    data: { zohoAccountId: accountId, accountId: localAccount?.id || undefined },
  })

  return res.json({ ok: true })
}
