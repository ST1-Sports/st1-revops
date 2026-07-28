/**
 * POST /api/contacts/promote
 *
 * Push a RevOps cold-pool contact into Zoho CRM.
 *
 * Default: creates/updates a Lead (bulk/manual "Promote to Zoho" button from
 * Prospecting — cheap, unqualified, fine in volume).
 *
 * With { createAsContact: true } — used when Brad detects positive intent and
 * hands a reply to a rep, and when Edgar ties a quote to an unpushed prospect —
 * finds-or-creates a real Account (company) and creates/updates a Contact
 * linked to it instead. This is what actually shows up as a real customer in
 * Zoho CRM rather than an unqualified marketing lead.
 *
 * Body: { contactId, createAsContact? }
 * Returns: { ok, zohoId, zohoAccountId? }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'

const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

async function findOrCreateAccount(token, companyName) {
  const name = (companyName || '').trim()
  if (!name) return null
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  try {
    const criteria = `(Account_Name:equals:${name})`
    const searchRes = await fetch(`${CRM_BASE}/Accounts/search?criteria=${encodeURIComponent(criteria)}`, { headers })
    if (searchRes.ok) {
      const searchData = await searchRes.json().catch(() => null)
      const existing = searchData?.data?.[0]
      if (existing?.id) return existing.id
    }
  } catch {}

  const createRes = await fetch(`${CRM_BASE}/Accounts`, {
    method: 'POST', headers,
    body: JSON.stringify({ data: [{ Account_Name: name }] }),
  })
  const createData = await createRes.json().catch(() => null)
  const rec = createData?.data?.[0]
  if (rec?.status === 'error') throw new Error(rec.message || 'Zoho account create failed')
  return rec?.details?.id || null
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactId, createAsContact } = req.body || {}
  if (!contactId) return res.status(400).json({ error: 'contactId required' })

  const contact = await prisma.salesContact.findUnique({ where: { id: contactId } }).catch(() => null)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  let token
  try {
    token = await getZohoToken()
  } catch (err) {
    return res.status(500).json({ error: `Zoho auth: ${err.message}` })
  }

  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  try {
    if (createAsContact) {
      const accountId = await findOrCreateAccount(token, contact.companyName)

      const payload = {
        First_Name:  contact.firstName || '',
        Last_Name:   contact.lastName  || contact.email.split('@')[0],
        Email:       contact.email,
        Phone:       contact.phone    || '',
        Title:       contact.title    || '',
        Description: contact.notes    || '',
        ...(accountId ? { Account_Name: { id: accountId } } : {}),
      }

      const isUpdate = !!contact.zohoCrmId
      const url    = isUpdate ? `${CRM_BASE}/Contacts/${contact.zohoCrmId}` : `${CRM_BASE}/Contacts`
      const method = isUpdate ? 'PUT' : 'POST'

      const zohoRes = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
      const data   = await zohoRes.json()
      const record = data?.data?.[0]

      if (record?.status === 'error') {
        return res.status(502).json({ error: record.message || 'Zoho API error' })
      }

      const zohoId = record?.details?.id || contact.zohoCrmId

      await prisma.salesContact.update({
        where: { id: contactId },
        data:  { pushedToZoho: true, zohoCrmId: zohoId || undefined, zohoAccountId: accountId || undefined },
      })

      return res.json({ ok: true, zohoId, zohoAccountId: accountId })
    }

    // ── Default: push as Lead (bulk/manual promote from Prospecting) ──────────
    const payload = {
      First_Name:   contact.firstName || '',
      Last_Name:    contact.lastName  || contact.email.split('@')[0],
      Company:      contact.companyName || '',
      Email:        contact.email,
      Phone:        contact.phone    || '',
      Designation:  contact.title    || '',
      Lead_Source:  'ST1 RevOps',
      Lead_Status:  'Working',
      Description:  contact.notes   || '',
    }

    const isUpdate = !!contact.zohoCrmId
    const url    = isUpdate ? `${CRM_BASE}/Leads/${contact.zohoCrmId}` : `${CRM_BASE}/Leads`
    const method = isUpdate ? 'PUT' : 'POST'

    const zohoRes = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
    const data   = await zohoRes.json()
    const record = data?.data?.[0]

    if (record?.status === 'error') {
      return res.status(502).json({ error: record.message || 'Zoho API error' })
    }

    const zohoId = record?.details?.id || contact.zohoCrmId

    await prisma.salesContact.update({
      where: { id: contactId },
      data:  { pushedToZoho: true, zohoCrmId: zohoId || undefined },
    })

    return res.json({ ok: true, zohoId })
  } catch (err) {
    console.error('[contacts/promote]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
