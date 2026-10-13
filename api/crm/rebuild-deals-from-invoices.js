/**
 * POST /api/crm/rebuild-deals-from-invoices
 *
 * Resync: every real, sent Zoho Books invoice should have exactly one
 * Closed Won Deal tied to the real Account, carrying the invoice's amount/
 * date/line-items. Rebuilds only THAT set — it wipes and recreates deals
 * this same tool previously created (identified by the "<customer> —
 * Invoice <number>" name it always uses), not every Deal in the org. A
 * manually-tracked, not-yet-invoiced pipeline deal (e.g. "+ ADD DEAL" on
 * the Account page, or an uploaded quote) never matches that pattern and
 * is left alone — it used to be deleted outright by a prior version of
 * this tool with no way to get it back, which is exactly backwards once
 * accounts are meant to track real pipeline, not just invoiced history.
 *
 * Skips draft and void invoices — never actually sent to the customer, so
 * not a real transaction to have a Deal for.
 *
 * Body: { dryRun?: boolean }
 * Returns: { ok, dealsDeleted, dealsPreserved, invoicesTotal, invoicesSkipped, dealsCreated, errors }
 */
import { setCors }      from '../_lib/cors.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { zohoCrmHeaders, CRM_BASE } from '../_lib/zohoCrm.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { booksGet } from '../_lib/zoho-books.js'
import { requireInternalSecret } from '../_lib/internalAuth.js'

async function fetchAllInvoices() {
  let all = [], page = 1
  while (true) {
    const data = await booksGet(`/invoices?per_page=200&page=${page}`)
    const batch = data?.invoices || []
    all = [...all, ...batch]
    if (!data?.page_context?.has_more_page || batch.length < 200) break
    page++
  }
  return all
}

// Every Deal this tool creates is named "<customer> — Invoice <number>"
// (see the payload below) — the one reliable way to tell "a deal this tool
// is responsible for, safe to wipe and recreate" apart from a deal someone
// added manually that just happens to exist for the same customer.
const INVOICE_DEAL_NAME_RE = / — Invoice .+$/

async function fetchAllDeals(headers) {
  let all = [], page = 1
  while (true) {
    const r = await fetch(`${CRM_BASE}/Deals?fields=Deal_Name&per_page=200&page=${page}`, { headers })
    if (r.status === 204) break
    const data = await r.json().catch(() => null)
    if (data?.status === 'error') throw new Error(data.message || 'Zoho Deals fetch failed')
    const batch = data?.data || []
    all = [...all, ...batch]
    if (!data?.info?.more_records || batch.length < 200) break
    page++
  }
  return all
}

async function deleteDealsBulk(ids, headers) {
  let deleted = 0
  const errors = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const res = await fetch(`${CRM_BASE}/Deals?ids=${batch.join(',')}`, { method: 'DELETE', headers })
    const data = await res.json().catch(() => null)
    for (const rec of (data?.data || [])) {
      if (rec.status === 'success') deleted++
      else errors.push(rec.message || 'delete failed')
    }
  }
  return { deleted, errors }
}

function summarizeItems(lineItems) {
  return (lineItems || [])
    .slice(0, 10)
    .map(li => `${li.quantity || 1}x ${li.name || li.item_name || 'item'} @ $${Number(li.rate || 0).toFixed(2)}`)
    .join(', ')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  if (!requireInternalSecret(req, res)) return

  const dryRun = req.body?.dryRun === true

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const crmHeaders = zohoCrmHeaders(token)

  let invoices
  try { invoices = await fetchAllInvoices() }
  catch (err) { return res.status(502).json({ error: `Zoho Books: ${err.message}` }) }

  const usable = invoices.filter(inv => !['draft', 'void'].includes(inv.status))

  if (dryRun) {
    let existingDeals = 0, dealsPreserved = 0
    try {
      const all = await fetchAllDeals(crmHeaders)
      existingDeals = all.filter(d => INVOICE_DEAL_NAME_RE.test(d.Deal_Name)).length
      dealsPreserved = all.length - existingDeals
    } catch { /* report 0 rather than fail a dry run */ }
    return res.json({
      ok: true, dryRun: true, existingDeals, dealsPreserved,
      invoicesTotal: invoices.length, invoicesUsable: usable.length,
      invoicesSkipped: invoices.length - usable.length,
    })
  }

  // 1. Wipe only the invoice-backed deals from a previous run — see
  //    INVOICE_DEAL_NAME_RE above. Anything else (manual pipeline deals,
  //    uploaded-quote deals, a deal Zoho's own native flows created) stays.
  let dealsDeleted = 0, dealsPreserved = 0
  const errors = []
  try {
    const all = await fetchAllDeals(crmHeaders)
    const invoiceBackedIds = all.filter(d => INVOICE_DEAL_NAME_RE.test(d.Deal_Name)).map(d => d.id)
    dealsPreserved = all.length - invoiceBackedIds.length
    const result = await deleteDealsBulk(invoiceBackedIds, crmHeaders)
    dealsDeleted = result.deleted
    errors.push(...result.errors)
  } catch (err) {
    return res.status(502).json({ error: `Deal wipe failed: ${err.message}` })
  }

  // 2. One Deal per real, sent invoice. Account resolution still has to be
  //    sequential (a live Zoho search per not-yet-seen customer), but deal
  //    creation itself doesn't — build every payload first, then create
  //    them in batches of 100 (Zoho's bulk-insert max), same as the delete
  //    step above, instead of one Deal per network round trip.
  const accountCache = new Map() // "name|state" -> zoho account id
  const dealBatches = []
  for (const inv of usable) {
    try {
      const name = (inv.customer_name || '').trim()
      if (!name) { errors.push(`Invoice ${inv.invoice_number || inv.invoice_id}: no customer name`); continue }
      const state = inv.billing_address?.state || inv.shipping_address?.state || ''
      const cacheKey = `${name.toLowerCase()}|${state.toLowerCase()}`
      let accountId = accountCache.get(cacheKey)
      if (accountId === undefined) {
        const acc = await findOrCreateZohoAccount(
          { name, city: inv.billing_address?.city || inv.shipping_address?.city, state },
          crmHeaders
        )
        accountId = acc.id
        accountCache.set(cacheKey, accountId)
      }
      dealBatches.push({
        invoiceNumber: inv.invoice_number || inv.invoice_id,
        payload: {
          Deal_Name:    `${name} — Invoice ${inv.invoice_number || inv.invoice_id}`,
          Amount:       Number(inv.total) || 0,
          Stage:        'Closed Won',
          Closing_Date: inv.date || undefined,
          Description:  `Invoice ${inv.invoice_number || ''} (${inv.status}) — ${summarizeItems(inv.line_items)}`.slice(0, 2000),
          ...(accountId ? { Account_Name: { id: accountId } } : {}),
        },
      })
    } catch (err) {
      errors.push(`Invoice ${inv.invoice_number || inv.invoice_id}: ${err.message}`)
    }
  }

  let dealsCreated = 0
  for (let i = 0; i < dealBatches.length; i += 100) {
    const batch = dealBatches.slice(i, i + 100)
    const createRes  = await fetch(`${CRM_BASE}/Deals`, { method: 'POST', headers: crmHeaders, body: JSON.stringify({ data: batch.map(b => b.payload) }) })
    const createData = await createRes.json().catch(() => null)
    const results = createData?.data || []
    results.forEach((rec, idx) => {
      if (rec?.status === 'error') errors.push(`Invoice ${batch[idx].invoiceNumber}: ${rec.message}`)
      else dealsCreated++
    })
  }

  return res.json({
    ok: true, dealsDeleted, dealsPreserved, invoicesTotal: invoices.length,
    invoicesSkipped: invoices.length - usable.length, dealsCreated, errors,
  })
}
