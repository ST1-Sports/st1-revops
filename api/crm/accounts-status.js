/**
 * GET /api/crm/accounts-status?sinceHours=168
 *
 * Answers three things the CRM tab has never actually shown, since the app
 * has never fetched the real Zoho Accounts module before — everything the
 * "Accounts" left-rail displayed was a local grouping of contacts by
 * school+state, not a count of real Accounts sitting in Zoho:
 *
 *   1. How many real Zoho Accounts exist right now.
 *   2. Which ones are new (created within the last `sinceHours`) — the
 *      "who did the last push just create" view.
 *   3. Which already-real Zoho Contacts (module Contacts, not Leads) have
 *      no Account_Name link at all, but whose companyName text matches an
 *      existing Account by name — these are "should be linked, aren't"
 *      candidates for the Assign action, most likely left over from before
 *      the Account_Name lookup-vs-string bug was fixed.
 *
 * Returns: { ok, totalAccounts, newAccounts: [{id,name,createdTime,city,state}],
 *            unassignedMatches: [{contactId,name,email,companyName,
 *                                  matchedAccountId,matchedAccountName}] }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { zohoCrmHeaders, CRM_BASE } from '../_lib/zohoCrm.js'
import { normalizeAccountName } from '../_lib/accountUtils.js'

async function fetchAllAccounts(headers) {
  let all = [], page = 1
  while (true) {
    const res = await fetch(`${CRM_BASE}/Accounts?fields=Account_Name,Created_Time,Billing_City,Billing_State&per_page=200&page=${page}`, { headers })
    const data = await res.json().catch(() => null)
    if (data?.status === 'error') throw new Error(data.message || 'Zoho Accounts fetch failed')
    const batch = data?.data || []
    all = [...all, ...batch]
    if (!data?.info?.more_records || batch.length < 200) break
    page++
  }
  return all
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' })

  const sinceHours = Math.min(Math.max(Number(req.query?.sinceHours) || 168, 1), 24 * 90)
  const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const headers = zohoCrmHeaders(token)

  let accounts
  try { accounts = await fetchAllAccounts(headers) }
  catch (err) { return res.status(502).json({ error: err.message }) }

  const newAccounts = accounts
    .filter(a => a.Created_Time && Date.parse(a.Created_Time) >= sinceMs)
    .map(a => ({ id: a.id, name: a.Account_Name || '', createdTime: a.Created_Time, city: a.Billing_City || '', state: a.Billing_State || '' }))
    .sort((a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime))

  // Index real Accounts by normalized name for the unassigned-match lookup below.
  const byNormName = new Map()
  for (const a of accounts) {
    const norm = normalizeAccountName(a.Account_Name)
    if (norm && !byNormName.has(norm)) byNormName.set(norm, a)
  }

  const candidates = await prisma.salesContact.findMany({
    where: { zohoModule: 'Contacts', zohoCrmId: { not: null }, zohoAccountId: null, companyName: { not: null } },
    select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
    take: 500,
  })
  const unassignedMatches = []
  for (const c of candidates) {
    const norm = normalizeAccountName(c.companyName)
    const match = norm && byNormName.get(norm)
    if (!match) continue
    unassignedMatches.push({
      contactId: c.id,
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email,
      email: c.email,
      companyName: c.companyName,
      matchedAccountId: match.id,
      matchedAccountName: match.Account_Name || '',
    })
  }

  return res.json({ ok: true, totalAccounts: accounts.length, newAccounts, unassignedMatches })
}
