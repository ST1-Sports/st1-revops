/**
 * POST /api/crm/rebuild-deals-from-invoices
 *
 * One-time clean-slate reset: a Deal should only ever exist because of a
 * real Zoho Books invoice — not a speculative/in-progress quote that never
 * closed. This wipes every existing Zoho CRM Deal (no partial/selective
 * mode — stale ones and active-but-uninvoiced pipeline both go) and
 * rebuilds exactly one Deal per real invoice, Closed Won, tied to the real
 * Account and carrying the invoice's amount/date/line-items.
 *
 * Skips draft and void invoices — never actually sent to the customer, so
 * not a real transaction to have a Deal for.
 *
 * Body: { dryRun?: boolean }
 * Returns: { ok, dealsDeleted, invoicesTotal, invoicesSkipped, dealsCreated, errors }
 */
import { setCors }      from '../_lib/cors.js'
import { getZohoToken } from '../_lib/zoho-token.js'
import { zohoCrmHeaders, CRM_BASE } from '../_lib/zohoCrm.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { ORG, BOOKS } from '../_lib/zoho-books.js'

async function fetchAllInvoices(headers) {
  let all = [], page = 1
  while (true) {
    const res = await fetch(`${BOOKS}/invoices?per_page=200&page=${page}&organization_id=${ORG}`, { headers })
    const data = await res.json().catch(() => null)
    if (data?.message && !data?.invoices) throw new Error(data.message)
    const batch = data?.invoices || []
    all = [...all, ...batch]
    if (!data?.page_context?.has_more_page || batch.length < 200) break
    page++
  }
  return all
}

async function fetchAllDealIds(headers) {
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
  return all.map(d => d.id)
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

  const dryRun = req.body?.dryRun === true

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: `Zoho auth: ${err.message}` }) }
  const crmHeaders   = zohoCrmHeaders(token)
  const booksHeaders = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }

  let invoices
  try { invoices = await fetchAllInvoices(booksHeaders) }
  catch (err) { return res.status(502).json({ error: `Zoho Books: ${err.message}` }) }

  const usable = invoices.filter(inv => !['draft', 'void'].includes(inv.status))

  if (dryRun) {
    let existingDeals = 0
    try { existingDeals = (await fetchAllDealIds(crmHeaders)).length } catch { /* report 0 rather than fail a dry run */ }
    return res.json({
      ok: true, dryRun: true, existingDeals,
      invoicesTotal: invoices.length, invoicesUsable: usable.length,
      invoicesSkipped: invoices.length - usable.length,
    })
  }

  // 1. Wipe every existing Deal — no partial mode, see file header.
  let dealsDeleted = 0
  const errors = []
  try {
    const existingDealIds = await fetchAllDealIds(crmHeaders)
    const result = await deleteDealsBulk(existingDealIds, crmHeaders)
    dealsDeleted = result.deleted
    errors.push(...result.errors)
  } catch (err) {
    return res.status(502).json({ error: `Deal wipe failed: ${err.message}` })
  }

  // 2. One Deal per real, sent invoice.
  let dealsCreated = 0
  const accountCache = new Map() // "name|state" -> zoho account id
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
      const payload = {
        Deal_Name:    `${name} — Invoice ${inv.invoice_number || inv.invoice_id}`,
        Amount:       Number(inv.total) || 0,
        Stage:        'Closed Won',
        Closing_Date: inv.date || undefined,
        Description:  `Invoice ${inv.invoice_number || ''} (${inv.status}) — ${summarizeItems(inv.line_items)}`.slice(0, 2000),
        ...(accountId ? { Account_Name: { id: accountId } } : {}),
      }
      const createRes  = await fetch(`${CRM_BASE}/Deals`, { method: 'POST', headers: crmHeaders, body: JSON.stringify({ data: [payload] }) })
      const createData = await createRes.json().catch(() => null)
      const rec = createData?.data?.[0]
      if (rec?.status === 'error') { errors.push(`Invoice ${inv.invoice_number}: ${rec.message}`); continue }
      dealsCreated++
    } catch (err) {
      errors.push(`Invoice ${inv.invoice_number || inv.invoice_id}: ${err.message}`)
    }
  }

  return res.json({
    ok: true, dealsDeleted, invoicesTotal: invoices.length,
    invoicesSkipped: invoices.length - usable.length, dealsCreated, errors,
  })
}
