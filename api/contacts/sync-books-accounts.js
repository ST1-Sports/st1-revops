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
 *   3. Pulls that customer's actual Contact Persons directly from Zoho
 *      Books (separate from anything already in our SalesContact pool —
 *      an AP/billing contact Books has on file that we never captured any
 *      other way) and upserts them as real SalesContact rows linked to
 *      the account. This is the actual "pull contacts from Zoho Books"
 *      step — step 2 only links contacts that were already in our pool
 *      some other way; this is what makes a Books-only contact show up
 *      at all.
 *   4. Reports which invoiced accounts still have ZERO linked contacts
 *      even after checking Books directly — that's the direct answer to
 *      "do we actually have contacts for these" — those are the accounts
 *      to go find staff for.
 *
 * Idempotent — safe to re-run any time new invoices show up.
 *
 * Body: { dryRun?: boolean }
 * Returns: { accountsFromBooks, accountsCreated, accountsUpdated,
 *            contactsLinked, contactsFromBooks, noEmailContacts,
 *            accountsWithNoContacts: [{accountId,name,state,looseCandidates:[{contactId,name,email,companyName,state}]}] }
 */
import { setCors }      from '../_lib/cors.js'
import { prisma }       from '../_lib/prisma.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { accountDedupKey, normalizeAccountName } from '../_lib/accountUtils.js'
import { booksGet }     from '../_lib/zoho-books.js'

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
  const customers = new Map() // dedupKey -> { name, state, city, customerId }
  for (const inv of invoices) {
    const name = (inv.customer_name || '').trim()
    if (!name) continue
    const state = inv.billing_address?.state || inv.shipping_address?.state || ''
    const city  = inv.billing_address?.city  || inv.shipping_address?.city  || ''
    const key = accountDedupKey(name, state)
    if (!key) continue
    if (!customers.has(key)) customers.set(key, { name, state, city, customerId: inv.customer_id || null })
  }

  if (dryRun) {
    return res.json({ accountsFromBooks: customers.size, dryRun: true })
  }

  // Fetch every contact with a companyName ONCE and index it by dedup key
  // — matching per Books customer against a full table scan each time
  // would be a 66k-row query repeated per account, which doesn't scale.
  const allContacts = await prisma.salesContact.findMany({
    where: { companyName: { not: null } },
    select: { id: true, firstName: true, lastName: true, email: true, companyName: true, state: true, accountId: true },
  })
  const byDedupKey = new Map()  // dedupKey (name+state) -> contacts
  const byNameOnly = new Map()  // normalized name only -> contacts (state-unknown fallback)
  for (const c of allContacts) {
    const dk = accountDedupKey(c.companyName, c.state)
    const nk = normalizeAccountName(c.companyName)
    if (dk) { if (!byDedupKey.has(dk)) byDedupKey.set(dk, []); byDedupKey.get(dk).push(c) }
    if (nk) { if (!byNameOnly.has(nk)) byNameOnly.set(nk, []); byNameOnly.get(nk).push(c) }
  }
  // A looser fallback for accounts that still end up with zero contacts —
  // the exact dedup-key/name match above is intentionally strict (no suffix
  // stripping, see accountUtils.js) to avoid false merges, but that also
  // means "Albert Lea Area Schools" (Books) vs "Albert Lea Public Schools"
  // (however some scraped contact recorded it) never links automatically.
  // Only ever surfaced as a suggestion for a human to confirm — never
  // auto-linked — so it's safe to be more aggressive here than the strict
  // match above: strip common school-type words ("HS"/"High School"/
  // "Middle School"/etc.) and compare what's left, which also catches
  // "Boone HS" vs "Boone High School" that plain substring-includes can't
  // (neither string literally contains the other).
  const SCHOOL_TYPE_WORDS = /\b(high school|middle school|elementary school|junior high|jr high|elementary|schools?|district|academy|area|public|community|hs|ms|jhs|isd|usd|csd)\b/gi
  const coreName = (raw) => normalizeAccountName(raw).replace(SCHOOL_TYPE_WORDS, '').replace(/\s+/g, ' ').trim()
  const looseNameMatch = (a, b) => {
    const na = normalizeAccountName(a), nb = normalizeAccountName(b)
    if (!na || !nb) return false
    if (na === nb) return true
    if (na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na))) return true
    const ca = coreName(a), cb = coreName(b)
    return ca.length > 2 && ca === cb
  }
  // Candidates aren't limited to totally-unlinked contacts — a real duplicate
  // Account (the same school recorded under a slightly different name by an
  // earlier import, before this one existed) can leave a contact linked to
  // the WRONG local Account. Linking pulls them onto the real one instead.

  let accountsCreated = 0, accountsUpdated = 0, contactsLinked = 0, contactsFromBooks = 0, noEmailContacts = 0
  const accountsWithNoContacts = []
  const errors = []

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

    // Pull this customer's actual Contact Persons from Zoho Books — the
    // step that was missing entirely before. A Books contact person has no
    // separate "intent" signal of their own (they were never scraped or
    // emailed) — being on file for an already-invoiced customer's account
    // is itself the qualifying signal, same bar as any other contact on a
    // real customer's account.
    if (cust.customerId) {
      try {
        const cpData = await booksGet(`/contacts/${cust.customerId}/contactpersons`)
        for (const p of (cpData.contact_persons || [])) {
          const email = (p.email || '').trim().toLowerCase()
          if (!email) {
            // A real Books contact person with no email on file — can't become
            // a SalesContact (email is the unique key every other contact-
            // handling path assumes exists), but still worth surfacing rather
            // than silently vanishing: a rep can add the email in Books, or
            // reach out by phone directly.
            const cpName = [p.first_name, p.last_name].filter(Boolean).join(' ') || '(unnamed)'
            errors.push(`${cust.name}: Books contact "${cpName}"${p.phone || p.mobile ? ` (${p.phone || p.mobile})` : ''} has no email on file — skipped`)
            noEmailContacts++
            continue
          }
          const firstName = p.first_name || ''
          const lastName  = p.last_name || ''
          const phone     = p.phone || p.mobile || ''
          const result = await prisma.salesContact.upsert({
            where: { email },
            create: {
              email, firstName, lastName, phone,
              companyName: cust.name, state: cust.state || null, city: cust.city || null,
              accountId: account.id, source: 'zoho-books',
            },
            update: {
              accountId: account.id,
              firstName: firstName || undefined, lastName: lastName || undefined,
              phone: phone || undefined,
            },
          })
          if (result) contactsFromBooks++
        }
      } catch (err) {
        errors.push(`${cust.name}: Books contact persons — ${err.message}`)
      }
    }

    const totalContacts = await prisma.salesContact.count({ where: { accountId: account.id } })
    if (totalContacts === 0) {
      const looseCandidates = allContacts
        .filter(c => c.accountId !== account.id && looseNameMatch(c.companyName, cust.name))
        .slice(0, 5)
        .map(c => ({ contactId: c.id, name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email, email: c.email, companyName: c.companyName, state: c.state || null }))
      accountsWithNoContacts.push({ accountId: account.id, name: cust.name, state: cust.state || null, looseCandidates })
    }
  }

  return res.json({
    accountsFromBooks: customers.size,
    accountsCreated, accountsUpdated, contactsLinked, contactsFromBooks, noEmailContacts,
    accountsWithNoContacts, errors,
  })
}
