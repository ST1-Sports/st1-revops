/**
 * POST /api/contacts/zoho-align-accounts
 *
 * Pushes contacts on qualifying accounts into Zoho CRM — but which module
 * they land in depends on WHY the account qualifies, not just that it does:
 *
 *   - Invoiced accounts (real, paying customers per Zoho Books) get pushed
 *     as real, Account-linked Contacts — they're already customers.
 *   - Accounts that only qualify because a contact has shown reply/engagement
 *     intent (score>=50 or already pushedToZoho), but the account has NOT
 *     been invoiced, get pushed as Leads instead. Engagement alone should
 *     never create a real Account+Contact — that only happens later, when
 *     an actual quote or deal gets built for them (Edgar's "Create in Zoho"
 *     flow, via api/contacts/promote.js's createAsContact path). Cold,
 *     unengaged accounts are left alone entirely either way.
 *
 * A contact already sitting in Zoho as a Lead who's later found on a now-
 * invoiced account gets a real Contact created (not a formal Zoho Convert —
 * see upsertZohoRecord's module-aware update check in promote.js for why a
 * stale zohoCrmId from the Leads module can't just be PUT onto /Contacts).
 *
 * Ensures the Zoho Contacts module has "Sport" and "Coach Role" picklist
 * custom fields, creating them only if missing (Contacts only — Leads don't
 * get these). If field creation fails (plan/permission restrictions) that's
 * reported but non-fatal — linking still proceeds without those two fields.
 *
 * Idempotent/resumable: already-pushed-to-the-right-module contacts are
 * skipped on every run, and only `limit` qualifying accounts are processed
 * per call (default 25) — safe to just re-trigger to pick up the rest.
 *
 * Body: { dryRun?: boolean, limit?: number }
 * Returns: { fieldsEnsured, accountsQualifying, accountsProcessed,
 *            accountsRemaining, contactsPushed, contactsUpdated,
 *            leadsPushed, leadsUpdated, contactsSkipped, errors }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { ACCOUNT_SPORTS, COACH_ROLES, resolveSport, inferRoleFromTitle } from '../_lib/roleUtils.js'
import { normalizeAccountName } from '../_lib/accountUtils.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'

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

/** POST-or-PUT into a Zoho module, module-aware like promote.js's version — a
 * contact whose zohoCrmId belongs to a different module (e.g. upgrading from
 * a Lead once their account gets invoiced) gets a fresh record, not a PUT
 * onto the wrong module's id. */
async function upsertZohoRecord({ module, payload, contact, headers }) {
  const isUpdate = !!contact.zohoCrmId && contact.zohoModule === module
  const url    = isUpdate ? `${CRM_BASE}/${module}/${contact.zohoCrmId}` : `${CRM_BASE}/${module}`
  const method = isUpdate ? 'PUT' : 'POST'
  const zohoRes = await fetch(url, { method, headers, body: JSON.stringify({ data: [payload] }) })
  const zohoData = await zohoRes.json().catch(() => null)
  const rec = zohoData?.data?.[0]
  if (rec?.status === 'error') throw Object.assign(new Error(rec.message || 'Zoho error'), { isZohoError: true })
  return { zohoCrmId: rec?.details?.id || contact.zohoCrmId, isUpdate }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const dryRun = req.body?.dryRun === true
  const limit  = Math.min(Math.max(Number(req.body?.limit) || 25, 1), 100)

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  const result = {
    fieldsEnsured: [], accountsQualifying: 0, accountsProcessed: 0, accountsRemaining: 0,
    contactsPushed: 0, contactsUpdated: 0, leadsPushed: 0, leadsUpdated: 0, contactsSkipped: 0, errors: [],
  }

  // 1. Ensure the Sport + Coach Role custom fields exist on Contacts.
  //    Non-fatal: if this fails, linking still proceeds without those fields.
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

  // 2. Pull Zoho Books invoices once, to find which accounts are actual
  //    invoiced customers — the only tier that gets real Contacts+Accounts.
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
  // of unrelated accounts as invoiced.
  const isInvoiced = (accountName) => {
    const norm = normalizeAccountName(accountName)
    return !!norm && invoices.some(inv => normalizeAccountName(inv.customer_name) === norm)
  }

  // 3. Find candidate accounts (have at least one contact not yet pushed to
  //    its correct module), split into invoiced (-> Contacts) vs
  //    engagement-only (-> Leads).
  const pending = await prisma.salesContact.findMany({
    where: { accountId: { not: null }, pushedToZoho: false },
    select: { accountId: true },
  })
  const candidateIds = [...new Set(pending.map(c => c.accountId))]
  const candidates = candidateIds.length
    ? await prisma.account.findMany({ where: { id: { in: candidateIds } }, include: { contacts: true } })
    : []
  const engagementQualifying = (acc) => acc.contacts.some(c => (c.score || 0) >= 50 || c.pushedToZoho)
  const invoicedAccounts   = candidates.filter(acc => isInvoiced(acc.name))
  const leadOnlyAccounts   = candidates.filter(acc => !isInvoiced(acc.name) && engagementQualifying(acc))
  const qualifying = [...invoicedAccounts, ...leadOnlyAccounts]
  result.accountsQualifying = qualifying.length

  if (dryRun) {
    result.accountsRemaining = qualifying.length
    return res.json(result)
  }

  const toProcess = qualifying.slice(0, limit)
  result.accountsRemaining = Math.max(0, qualifying.length - toProcess.length)

  for (const account of toProcess) {
    const isRealCustomer = invoicedAccounts.includes(account)
    try {
      let zohoAccountId = account.zohoAccountId
      if (isRealCustomer) {
        // Only real customers get a resolved/created Zoho Account — Leads
        // don't need one (Company is just a text field on that module).
        zohoAccountId = zohoAccountId || (await findOrCreateZohoAccount({ name: account.name, city: account.city, state: account.state }, headers)).id
        if (zohoAccountId && zohoAccountId !== account.zohoAccountId) {
          await prisma.account.update({ where: { id: account.id }, data: { zohoAccountId } })
        }
      }

      for (const contact of account.contacts) {
        if (!contact.email || !contact.email.includes('@')) { result.contactsSkipped++; continue }

        if (isRealCustomer) {
          const module = 'Contacts'
          if (contact.zohoModule === module && contact.zohoCrmId) continue // already a Contact here, nothing to do
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
          const { zohoCrmId, isUpdate } = await upsertZohoRecord({ module, payload, contact, headers })
          await prisma.salesContact.update({
            where: { id: contact.id },
            data: { pushedToZoho: true, zohoCrmId, zohoModule: module, zohoAccountId: zohoAccountId || undefined },
          })
          isUpdate ? result.contactsUpdated++ : result.contactsPushed++
        } else {
          const module = 'Leads'
          if (contact.zohoModule === module && contact.zohoCrmId) continue // already a Lead, nothing to do
          const payload = {
            First_Name:  contact.firstName || '',
            Last_Name:   contact.lastName  || contact.email.split('@')[0],
            Company:     account.name || '',
            Email:       contact.email,
            Phone:       contact.phone || '',
            Designation: contact.title || '',
            Lead_Source: 'ST1 RevOps',
            Lead_Status: 'Working',
            Description: contact.notes || '',
          }
          const { zohoCrmId, isUpdate } = await upsertZohoRecord({ module, payload, contact, headers })
          await prisma.salesContact.update({
            where: { id: contact.id },
            data: { pushedToZoho: true, zohoCrmId, zohoModule: module },
          })
          isUpdate ? result.leadsUpdated++ : result.leadsPushed++
        }
      }
      result.accountsProcessed++
    } catch (err) {
      result.errors.push(`${account.name}: ${err.message}`)
    }
  }

  return res.json(result)
}
