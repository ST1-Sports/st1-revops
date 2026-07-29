/**
 * POST /api/contacts/sync-books-accounts
 *
 * Every customer with an invoice in Zoho Books is a real account we should
 * be tracking — but until now an Account row only got created reactively,
 * when some contact's companyName happened to match. A Books-invoiced
 * school with zero contacts already in our pool had no Account row at all.
 *
 * This endpoint:
 *   1. Pulls every Zoho Books customer (from the invoice list) and
 *      upserts a real Account row for each (dedup by accountDedupKey —
 *      name+state, falling back to name-only when Books doesn't give us
 *      a state on the invoice).
 *   2. For every one of those accounts, searches the FULL SalesContact
 *      pool (not just previously-unlinked rows) for a companyName match
 *      and links it — this is the "map the contacts into the accounts"
 *      step, run from the account side so it also catches contacts that
 *      existed before their account did.
 *   3. Reports which invoiced accounts still have ZERO linked contacts —
 *      that's the direct answer to "do we actually have contacts for
 *      these" — those are the accounts to go find staff for.
 *
 * Idempotent — safe to re-run any time new invoices show up.
 *
 * Body: { dryRun?: boolean }
 * Returns: { accountsFromBooks, accountsCreated, accountsUpdated,
 *            contactsLinked, accountsWithNoContacts: [{name,state}] }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { accountDedupKey, normalizeAccountName } from '../_lib/accountUtils.js'

const BOOKS_BASE = 'https://www.zohoapis.com/books/v3'

async function fetchAllInvoices(headers) {
  if (!process.env.ZOHO_ORG_ID) throw new Error('ZOHO_ORG_ID env var not set')
  let all = [], page = 1
  while (true) {
    const res = await fetch(`${BOOKS_BASE}/invoices?per_page=200&page=${page}&organization_id=${process.env.ZOHO_ORG_ID}`, { headers })
    const data = await res.json().catch(() => null)
    if (data?.message && !data?.invoices) throw new Error(data.message)
    const batch = data?.invoices || []
    all = [...all, ...batch]
    if (!data?.page_context?.has_more_page || batch.length < 200) break
    page++
  }
  return all
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const dryRun = req.body?.dryRun === true

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  let invoices
  try { invoices = await fetchAllInvoices(headers) }
  catch (err) { return res.status(502).json({ error: `Zoho Books: ${err.message}` }) }

  // Dedup Books customers by name (+ best-effort state from the billing
  // address, when Books provides one on the invoice — it doesn't always).
  const customers = new Map() // dedupKey -> { name, state, city }
  for (const inv of invoices) {
    const name = (inv.customer_name || '').trim()
    if (!name) continue
    const state = inv.billing_address?.state || inv.shipping_address?.state || ''
    const city  = inv.billing_address?.city  || inv.shipping_address?.city  || ''
    const key = accountDedupKey(name, state)
    if (!key) continue
    if (!customers.has(key)) customers.set(key, { name, state, city })
  }

  if (dryRun) {
    return res.json({ accountsFromBooks: customers.size, dryRun: true })
  }

  // Fetch every contact with a companyName ONCE and index it by dedup key
  // — matching per Books customer against a full table scan each time
  // would be a 66k-row query repeated per account, which doesn't scale.
  const allContacts = await prisma.salesContact.findMany({
    where: { companyName: { not: null } },
    select: { id: true, companyName: true, state: true, accountId: true },
  })
  const byDedupKey = new Map()  // dedupKey (name+state) -> contacts
  const byNameOnly = new Map()  // normalized name only -> contacts (state-unknown fallback)
  for (const c of allContacts) {
    const dk = accountDedupKey(c.companyName, c.state)
    const nk = normalizeAccountName(c.companyName)
    if (dk) { if (!byDedupKey.has(dk)) byDedupKey.set(dk, []); byDedupKey.get(dk).push(c) }
    if (nk) { if (!byNameOnly.has(nk)) byNameOnly.set(nk, []); byNameOnly.get(nk).push(c) }
  }

  let accountsCreated = 0, accountsUpdated = 0, contactsLinked = 0
  const accountsWithNoContacts = []

  for (const [dedupKey, cust] of customers) {
    const existing = await prisma.account.findUnique({ where: { normalizedName: dedupKey } })
    const account = await prisma.account.upsert({
      where: { normalizedName: dedupKey },
      create: { name: cust.name, normalizedName: dedupKey, city: cust.city || null, state: cust.state || null },
      update: { city: cust.city || undefined, state: cust.state || undefined },
    })
    existing ? accountsUpdated++ : accountsCreated++

    // Match against the pre-built index — this is the "map the contacts
    // into the accounts" step, run from the account side so it also
    // catches contacts that existed before their account did.
    const nameOnlyNorm = normalizeAccountName(cust.name)
    const matched = new Map()
    ;(byDedupKey.get(dedupKey) || []).forEach(c => matched.set(c.id, c))
    ;(byNameOnly.get(nameOnlyNorm) || []).forEach(c => matched.set(c.id, c))
    const matchIds = [...matched.values()].filter(c => c.accountId !== account.id).map(c => c.id)
    if (matchIds.length) {
      const result = await prisma.salesContact.updateMany({ where: { id: { in: matchIds } }, data: { accountId: account.id } })
      contactsLinked += result.count
    }

    const totalContacts = await prisma.salesContact.count({ where: { accountId: account.id } })
    if (totalContacts === 0) accountsWithNoContacts.push({ name: cust.name, state: cust.state || null })
  }

  return res.json({
    accountsFromBooks: customers.size,
    accountsCreated, accountsUpdated, contactsLinked,
    accountsWithNoContacts,
  })
}
