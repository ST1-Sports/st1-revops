/**
 * POST /api/contacts/promote
 *
 * Push a RevOps cold-pool contact into Zoho CRM.
 *
 * Rule (as of the Zoho CRM cleanup): nothing moves to Zoho until a contact
 * has shown real intent — a reply, a meeting, an actual deal touch — not
 * just because they were scraped/imported. score>=50 is the "they replied"
 * threshold from the SCORE_CONTACT point system (replied:50, meeting:75,
 * deal:100), so it doubles as the intent gate here.
 *
 * Default: creates/updates a Lead. Requires score>=50 — the old "cheap,
 * unqualified, fine in volume" bulk-promote path is no longer allowed.
 *
 * With { createAsContact: true } — used when Brad detects positive intent
 * (already gated upstream by classifyEmailIntent on the actual reply text)
 * and hands a reply to a rep, and when Edgar ties a quote to an
 * already-intent-qualified prospect — finds-or-creates a real Account
 * (company) and creates/updates a Contact linked to it instead. This is
 * what actually shows up as a real customer in Zoho CRM rather than an
 * unqualified marketing lead.
 *
 * Body: { contactId, createAsContact? }
 * Returns: { ok, zohoId, zohoAccountId? }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { upsertAccountForContact, findOrCreateZohoAccount } from '../_lib/accountUtils.js'

const CRM_BASE = 'https://www.zohoapis.com/crm/v3'

async function findOrCreateAccount(contact, headers) {
  const name = (contact.companyName || '').trim()
  if (!name) return null

  // Reuse an account already resolved for another prospect at the same
  // school + state before hitting Zoho again — many prospects share a
  // school, but two same-named schools in different states are two
  // different real Accounts and must never share a zohoAccountId. (This
  // sibling lookup is specific to this endpoint — it may run before any
  // local Account row exists at all, unlike zoho-align-accounts.js which
  // always has a real Account.zohoAccountId to check directly.)
  const sibling = await prisma.salesContact.findFirst({
    where:  { companyName: contact.companyName, state: contact.state, zohoAccountId: { not: null } },
    select: { zohoAccountId: true },
  }).catch(() => null)
  if (sibling?.zohoAccountId) return sibling.zohoAccountId

  return findOrCreateZohoAccount({ name, city: contact.city, state: contact.state }, headers)
}

/** POST-or-PUT a record into a Zoho module, then mirror the result onto SalesContact. */
async function upsertZohoRecord({ module, payload, contact, headers, extraContactUpdate = {} }) {
  const isUpdate = !!contact.zohoCrmId
  const url    = isUpdate ? `${CRM_BASE}/${module}/${contact.zohoCrmId}` : `${CRM_BASE}/${module}`
  const method = isUpdate ? 'PUT' : 'POST'

  const zohoRes = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
  const data   = await zohoRes.json()
  const record = data?.data?.[0]

  if (record?.status === 'error') {
    throw Object.assign(new Error(record.message || 'Zoho API error'), { isZohoError: true })
  }

  const zohoId = record?.details?.id || contact.zohoCrmId

  await prisma.salesContact.update({
    where: { id: contact.id },
    data:  { pushedToZoho: true, zohoCrmId: zohoId || undefined, ...extraContactUpdate },
  })

  return zohoId
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactId, createAsContact } = req.body || {}
  if (!contactId) return res.status(400).json({ error: 'contactId required' })

  const contact = await prisma.salesContact.findUnique({ where: { id: contactId } }).catch(() => null)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  // Lead-push path has no upstream intent check of its own — enforce it here.
  // (The createAsContact path is only ever called after intent is already
  // established: Brad's reply-intent classifier, or a rep-approved Edgar
  // quote for an already-qualified prospect.)
  if (!createAsContact && (contact.score || 0) < 50 && !contact.pushedToZoho) {
    return res.status(403).json({ error: 'Contact has not shown intent yet (no reply on record) — not pushing to Zoho.' })
  }

  let token
  try {
    token = await getZohoToken()
  } catch (err) {
    return res.status(500).json({ error: `Zoho auth: ${err.message}` })
  }

  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  try {
    if (createAsContact) {
      const accountId = await findOrCreateAccount(contact, headers)
      // Positive intent on this contact is exactly the trigger that should
      // create/link the local Account (school) too — not just the Zoho side.
      const localAccountId = await upsertAccountForContact(contact.companyName, { city: contact.city, state: contact.state })
      if (localAccountId && accountId) {
        await prisma.account.update({ where: { id: localAccountId }, data: { zohoAccountId: accountId } }).catch(() => {})
      }
      const zohoId = await upsertZohoRecord({
        module: 'Contacts',
        payload: {
          First_Name:  contact.firstName || '',
          Last_Name:   contact.lastName  || contact.email.split('@')[0],
          Email:       contact.email,
          Phone:       contact.phone    || '',
          Title:       contact.title    || '',
          Description: contact.notes    || '',
          ...(accountId ? { Account_Name: { id: accountId } } : {}),
        },
        contact, headers,
        extraContactUpdate: { zohoAccountId: accountId || undefined, accountId: localAccountId || undefined },
      })
      return res.json({ ok: true, zohoId, zohoAccountId: accountId })
    }

    // ── Default: push as Lead (bulk/manual promote from Prospecting) ──────────
    const zohoId = await upsertZohoRecord({
      module: 'Leads',
      payload: {
        First_Name:   contact.firstName || '',
        Last_Name:    contact.lastName  || contact.email.split('@')[0],
        Company:      contact.companyName || '',
        Email:        contact.email,
        Phone:        contact.phone    || '',
        Designation:  contact.title    || '',
        Lead_Source:  'ST1 RevOps',
        Lead_Status:  'Working',
        Description:  contact.notes   || '',
      },
      contact, headers,
    })
    return res.json({ ok: true, zohoId })
  } catch (err) {
    if (err.isZohoError) return res.status(502).json({ error: err.message })
    console.error('[contacts/promote]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
