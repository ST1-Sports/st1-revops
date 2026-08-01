/**
 * POST /api/contacts/zoho-align-accounts
 *
 * Pushes contacts on QUALIFYING accounts into Zoho CRM as real linked
 * Contacts (not Leads), tagged with Sport + Coach Role custom fields, and
 * linked to their Account.
 *
 * "Qualifying" mirrors the CRM-tab rule already in place elsewhere in this
 * app: an account qualifies if it's been invoiced (checked live against
 * Zoho Books) or has shown positive intent (any linked SalesContact with
 * score>=50 or already pushedToZoho). Cold, unengaged accounts are left
 * alone — this does NOT bulk-push the whole Prospecting pool, on purpose.
 *
 * Ensures the Zoho Contacts module has "Sport" and "Coach Role" picklist
 * custom fields, creating them only if missing. If field creation fails
 * (plan/permission restrictions) that's reported but non-fatal — Account/
 * Contact linking still proceeds without those two fields set. Note: a
 * field created via this API may still need a Zoho admin to add it to the
 * Contacts page layout before reps can see/edit it directly in Zoho's UI —
 * that's a Zoho platform limitation, not something this endpoint can fix.
 *
 * Idempotent/resumable: already-pushed contacts (pushedToZoho=true) are
 * skipped on every run, and only `limit` qualifying accounts are processed
 * per call (default 25) — safe to just re-trigger to pick up the rest.
 *
 * Body: { dryRun?: boolean, limit?: number }
 * Returns: { fieldsEnsured, accountsQualifying, accountsProcessed,
 *            accountsRemaining, contactsPushed, contactsUpdated,
 *            contactsSkipped, errors }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { ACCOUNT_SPORTS, COACH_ROLES, resolveSport, inferRoleFromTitle } from '../_lib/roleUtils.js'
import { findOrCreateZohoAccount, normalizeAccountName } from '../_lib/accountUtils.js'

const CRM_BASE   = 'https://www.zohoapis.com/crm/v3'
const BOOKS_BASE = 'https://www.zohoapis.com/books/v3'

async function ensureField(fieldLabel, pickListValues, headers) {
  const getRes = await fetch(`${CRM_BASE}/settings/fields?module=Contacts`, { headers })
  const getData = await getRes.json().catch(() => null)
  const fields = getData?.fields || []
  const existing = fields.find(f => (f.field_label || '').toLowerCase() === fieldLabel.toLowerCase())
  if (existing) return { created: false, api_name: existing.api_name }

  const createRes = await fetch(`${CRM_BASE}/settings/fields?module=Contacts`, {
    method: 'POST', headers,
    body: JSON.stringify({ fields: [{
      field_label: fieldLabel,
      data_type: 'picklist',
      pick_list_values: pickListValues.map(v => ({ display_value: v })),
    }] }),
  })
  const createData = await createRes.json().catch(() => null)
  const rec = createData?.fields?.[0]
  if (!rec || rec.code !== 'SUCCESS') {
    throw new Error(`Zoho field create failed for "${fieldLabel}": ${rec?.message || createData?.message || 'unknown error'}`)
  }
  return { created: true, api_name: rec.details?.api_name || null }
}


export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const dryRun = req.body?.dryRun === true
  const limit  = Math.min(Math.max(Number(req.body?.limit) || 25, 1), 100)

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  const result = {
    fieldsEnsured: [], accountsQualifying: 0, accountsProcessed: 0, accountsRemaining: 0,
    contactsPushed: 0, contactsUpdated: 0, contactsSkipped: 0, errors: [],
  }

  // 1. Ensure the Sport + Coach Role custom fields exist on Contacts.
  //    Non-fatal: if this fails, Account/Contact linking still proceeds.
  let sportApiName = null, roleApiName = null
  try {
    const sportField = await ensureField('Sport', ACCOUNT_SPORTS, headers)
    result.fieldsEnsured.push({ field: 'Sport', ...sportField })
    sportApiName = sportField.api_name
  } catch (err) { result.errors.push(`Sport field: ${err.message}`) }
  try {
    const roleField = await ensureField('Coach Role', COACH_ROLES, headers)
    result.fieldsEnsured.push({ field: 'Coach Role', ...roleField })
    roleApiName = roleField.api_name
  } catch (err) { result.errors.push(`Coach Role field: ${err.message}`) }

  // 2. Pull Zoho Books invoices once, to check which accounts are actual
  //    invoiced customers (the other half of "qualifying").
  let invoices = []
  try {
    if (process.env.ZOHO_ORG_ID) {
      const invRes = await fetch(`${BOOKS_BASE}/invoices?per_page=200&organization_id=${process.env.ZOHO_ORG_ID}`, { headers })
      const invData = await invRes.json().catch(() => null)
      invoices = invData?.invoices || []
    }
  } catch (err) { result.errors.push(`Books invoice lookup: ${err.message}`) }
  // Exact match only (after the same case/whitespace/punctuation normalization
  // used for the Account dedup key) — a loose "one name contains the other"
  // match here means one generically-named invoice can silently mark dozens
  // of unrelated accounts as invoiced/qualifying and push their entire
  // prospect list into Zoho as real Contacts, which is what happened before
  // this fix.
  const isInvoiced = (accountName) => {
    const norm = normalizeAccountName(accountName)
    return !!norm && invoices.some(inv => normalizeAccountName(inv.customer_name) === norm)
  }

  // 3. Find candidate accounts (have at least one contact not yet pushed),
  //    then filter to ones that actually qualify.
  const pending = await prisma.salesContact.findMany({
    where: { accountId: { not: null }, pushedToZoho: false },
    select: { accountId: true },
  })
  const candidateIds = [...new Set(pending.map(c => c.accountId))]
  const candidates = candidateIds.length
    ? await prisma.account.findMany({ where: { id: { in: candidateIds } }, include: { contacts: true } })
    : []
  const qualifying = candidates.filter(acc =>
    acc.contacts.some(c => (c.score || 0) >= 50 || c.pushedToZoho) || isInvoiced(acc.name)
  )
  result.accountsQualifying = qualifying.length

  if (dryRun) {
    result.accountsRemaining = qualifying.length
    return res.json(result)
  }

  const toProcess = qualifying.slice(0, limit)
  result.accountsRemaining = Math.max(0, qualifying.length - toProcess.length)

  for (const account of toProcess) {
    try {
      const zohoAccountId = account.zohoAccountId
        || await findOrCreateZohoAccount({ name: account.name, city: account.city, state: account.state }, headers)
      if (zohoAccountId && zohoAccountId !== account.zohoAccountId) {
        await prisma.account.update({ where: { id: account.id }, data: { zohoAccountId } })
      }
      for (const contact of account.contacts) {
        if (!contact.email || !contact.email.includes('@')) { result.contactsSkipped++; continue }
        if (contact.pushedToZoho && contact.zohoCrmId) continue // already done, resumable

        const sport = resolveSport(contact.sport, contact.title)
        const role  = inferRoleFromTitle(contact.title)
        const payload = {
          First_Name:  contact.firstName || '',
          Last_Name:   contact.lastName  || contact.email.split('@')[0],
          Email:       contact.email,
          Phone:       contact.phone || '',
          Title:       contact.title || '',
          Description: contact.notes || '',
          ...(zohoAccountId ? { Account_Name: { id: zohoAccountId } } : {}),
          ...(sportApiName && sport ? { [sportApiName]: sport } : {}),
          ...(roleApiName  && role  ? { [roleApiName]:  role  } : {}),
        }
        const isUpdate = !!contact.zohoCrmId
        const url    = isUpdate ? `${CRM_BASE}/Contacts/${contact.zohoCrmId}` : `${CRM_BASE}/Contacts`
        const method = isUpdate ? 'PUT' : 'POST'
        const zohoRes = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
        const zohoData = await zohoRes.json().catch(() => null)
        const rec = zohoData?.data?.[0]
        if (rec?.status === 'error') { result.errors.push(`${contact.email}: ${rec.message || 'Zoho error'}`); continue }

        const zohoCrmId = rec?.details?.id || contact.zohoCrmId
        await prisma.salesContact.update({
          where: { id: contact.id },
          data: { pushedToZoho: true, zohoCrmId, zohoAccountId: zohoAccountId || undefined },
        })
        isUpdate ? result.contactsUpdated++ : result.contactsPushed++
      }
      result.accountsProcessed++
    } catch (err) {
      result.errors.push(`${account.name}: ${err.message}`)
    }
  }

  return res.json(result)
}
