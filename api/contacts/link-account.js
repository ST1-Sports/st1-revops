/**
 * POST /api/contacts/link-account
 *
 * Manually confirms a loose name-match suggestion from
 * sync-books-accounts.js's accountsWithNoContacts list — a contact whose
 * companyName wasn't an exact match for the invoiced account's name (e.g.
 * "Albert Lea Area Schools" vs however the contact's companyName was
 * recorded) but a human reviewing it agrees it's the same org.
 *
 * Purely local — just sets SalesContact.accountId. If this account is a
 * real invoiced customer and the contact has an email, the existing
 * zoho-align-accounts.js pipeline picks it up and pushes it to Zoho as a
 * real Contact on the next "PULL FROM ZOHO BOOKS" run, same as any other
 * newly-linked contact.
 *
 * Body: { contactId, accountId }
 * Returns: { ok }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactId, accountId } = req.body || {}
  if (!contactId || !accountId) return res.status(400).json({ error: 'contactId and accountId required' })

  const account = await prisma.account.findUnique({ where: { id: accountId } }).catch(() => null)
  if (!account) return res.status(404).json({ error: 'Account not found' })

  try {
    await prisma.salesContact.update({ where: { id: contactId }, data: { accountId } })
  } catch (err) {
    return res.status(500).json({ error: `Link failed: ${err.message}` })
  }

  return res.json({ ok: true })
}
