/**
 * POST /api/agents/annie/aggregate
 * { periodType?: "WEEKLY"|"MONTHLY", toDate?: "YYYY-MM-DD", dryRun?: boolean, force?: boolean }
 *
 * Annie's data aggregation layer. Pulls the numbers a financial snapshot needs
 * from every system of record, rolls them into one FinancialSnapshot row, and
 * caches the raw Zoho P&L/Balance Sheet JSON on that row so a same-day re-run
 * doesn't re-hit the Zoho Reports API.
 *
 * Sources pulled:
 *   1. Zoho Books P&L        — reports/profitandloss (period range)
 *   2. Zoho Books Balance Sheet — reports/balancesheet (point-in-time, as of toDate)
 *   3. Zoho Books AR aging   — reports/receivablesbycustomers
 *   4. Zoho Books AP aging   — reports/payablesbyvendors
 *   5. Zoho CRM open deals   — Deals module (Stage/Amount/Closing_Date/Account_Name)
 *   6. Edgar's quote history — AgentInteraction(agentId:'edgar', action:'quote')
 *      for margin trend; best-effort win/loss by fuzzy-matching the quote's
 *      customer name against the CRM deals pulled in step 5 (no real foreign
 *      key exists between an Edgar quote and a CRM deal, so this is a name
 *      match, not a guarantee).
 *   7. Ledger's own tables   — DealInvoice, Deposit, VendorBill (local
 *      cross-check numbers, used as a fallback if a Zoho report total can't
 *      be confidently extracted, and reported alongside the Zoho totals
 *      either way for comparison).
 *
 * periodType:
 *   WEEKLY  (default) — P&L over the trailing 7 days ending toDate
 *   MONTHLY            — P&L over the calendar month containing toDate
 * Balance-sheet-style figures (cash, AR, AP) are point-in-time as of toDate
 * regardless of periodType — that's how Zoho reports them too.
 *
 * dryRun (default true) — computes and returns the snapshot WITHOUT writing to
 * FinancialSnapshot. Reads (Zoho, CRM, local DB) always happen either way —
 * only the snapshot write is gated, same convention as the rest of Ledger.
 *
 * force (default false) — skip the same-day cache and re-hit Zoho even if a
 * snapshot for this periodType/toDate already has raw JSON cached.
 *
 * NOTE ON FIELD EXTRACTION: I don't have live Zoho API access to verify the
 * exact response shapes for reports/profitandloss, reports/balancesheet,
 * reports/receivablesbycustomers, or reports/payablesbyvendors. Extraction
 * below is defensive (tries several candidate field names, falls back to a
 * recursive scan, then falls back again to our own local numbers) rather than
 * assuming one exact shape. Treat the extracted Zoho totals as best-effort
 * until this has been run once against real data and the candidate key lists
 * corrected to match — see the sample dry-run in the Session 3 report-back.
 */

import { setCors }      from '../../_lib/cors.js'
import { prisma }       from '../../_lib/prisma.js'
import { getZohoToken } from '../../_lib/zoho-token.js'
import { booksGet }     from '../../_lib/zoho-books.js'

const CRM = 'https://www.zohoapis.com/crm/v3'
const CLOSED_STAGES = ['Closed Won', 'Closed Lost']

// ── date helpers ──────────────────────────────────────────────────────────────

function ymd(d) { return d.toISOString().slice(0, 10) }

function weekRange(toDateStr) {
  const to   = toDateStr ? new Date(`${toDateStr}T12:00:00Z`) : new Date()
  const from = new Date(to.getTime() - 6 * 86_400_000)
  return { fromDate: ymd(from), toDate: ymd(to) }
}

function monthRange(toDateStr) {
  const to    = toDateStr ? new Date(`${toDateStr}T12:00:00Z`) : new Date()
  const from  = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  return { fromDate: ymd(from), toDate: ymd(to) }
}

// ── CRM (Deals) ───────────────────────────────────────────────────────────────

async function crmGet(path) {
  const token = await getZohoToken()
  const r = await fetch(`${CRM}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
  })
  if (r.status === 204) return { data: [] }
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`CRM GET ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

// Fetches every deal regardless of stage — callers derive open vs. closed
// won vs. closed lost from `.stage` themselves (needed for Edgar win/loss
// matching below, which needs the closed buckets, not just open pipeline).
// Exported — forecast.js reuses this for close-rate history + open pipeline.
export async function fetchAllDeals() {
  const fields = 'Deal_Name,Stage,Amount,Closing_Date,Account_Name'
  let all = [], page = 1
  while (page <= 10) { // hard cap — 2000 deals is plenty for a snapshot
    const data  = await crmGet(`/Deals?fields=${fields}&per_page=200&page=${page}`).catch(() => ({ data: [] }))
    const batch = data.data || []
    all = all.concat(batch)
    if (!data.info?.more_records || batch.length < 200) break
    page++
  }
  const zn = v => (typeof v === 'string' ? v : v?.name || v?.display_value || '')
  return all.map(d => ({
    name:        zn(d.Deal_Name) || 'Untitled',
    stage:       zn(d.Stage) || 'Unknown',
    amount:      Number(d.Amount) || 0,
    closingDate: d.Closing_Date || null,
    account:     zn(d.Account_Name),
  }))
}

// ── Zoho Books reports ────────────────────────────────────────────────────────

async function fetchPL(fromDate, toDate) {
  try {
    return await booksGet(`/reports/profitandloss?from_date=${fromDate}&to_date=${toDate}`)
  } catch (e) {
    console.warn('[annie/aggregate] P&L fetch failed:', e.message)
    return null
  }
}

async function fetchBalanceSheet(toDate) {
  try {
    return await booksGet(`/reports/balancesheet?to_date=${toDate}`)
  } catch (e) {
    console.warn('[annie/aggregate] balance sheet fetch failed:', e.message)
    return null
  }
}

async function fetchARAging(toDate) {
  try {
    return await booksGet(`/reports/receivablesbycustomers?to_date=${toDate}`)
  } catch (e) {
    console.warn('[annie/aggregate] AR aging fetch failed:', e.message)
    return null
  }
}

async function fetchAPAging(toDate) {
  try {
    return await booksGet(`/reports/payablesbyvendors?to_date=${toDate}`)
  } catch (e) {
    console.warn('[annie/aggregate] AP aging fetch failed:', e.message)
    return null
  }
}

// ── Best-effort extraction from Zoho report JSON ─────────────────────────────
//
// Zoho Books report responses nest totals inside account-group hierarchies in
// a shape that varies by report. Rather than assume one exact path, this scans
// the tree for the first key matching any of the given candidate names.

function deepFindNumber(obj, keyNames, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return null
  seen.add(obj)
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindNumber(item, keyNames, seen)
      if (found != null) return found
    }
    return null
  }
  for (const key of keyNames) {
    if (obj[key] != null && (typeof obj[key] === 'number' || typeof obj[key] === 'string')) {
      const n = parseFloat(String(obj[key]).replace(/,/g, ''))
      if (!Number.isNaN(n)) return n
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const found = deepFindNumber(val, keyNames, seen)
      if (found != null) return found
    }
  }
  return null
}

function extractPL(pl) {
  if (!pl) return { revenueTotal: null, cogsTotal: null, grossMargin: null }
  const revenueTotal = deepFindNumber(pl, ['total_income', 'income_total', 'gross_income', 'total_operating_income'])
  const cogsTotal     = deepFindNumber(pl, ['total_cogs', 'cost_of_goods_sold', 'total_cost_of_goods_sold'])
  let grossMargin = null
  if (revenueTotal != null && revenueTotal > 0 && cogsTotal != null) {
    grossMargin = Math.round(((revenueTotal - cogsTotal) / revenueTotal) * 10000) / 100 // 2dp percent
  } else {
    const pct = deepFindNumber(pl, ['gross_profit_percentage', 'gross_margin_percentage'])
    if (pct != null) grossMargin = pct
  }
  return { revenueTotal, cogsTotal, grossMargin }
}

function extractBalanceSheet(bs) {
  if (!bs) return { cashPosition: null }
  const cashPosition = deepFindNumber(bs, ['total_bank', 'cash_and_bank', 'total_cash', 'total_bank_accounts'])
  return { cashPosition }
}

function extractARAging(ar) {
  if (!ar) return { arTotal: null, arOverdue: null }
  const arTotal = deepFindNumber(ar, ['total', 'grand_total', 'total_receivables', 'total_outstanding_receivable_amount'])
  // Aging buckets vary by response shape — sum anything that isn't "current"
  let arOverdue = null
  const bucketKeys = ['aging_summary', 'age_wise_details', 'aging']
  for (const key of bucketKeys) {
    const buckets = ar[key]
    if (Array.isArray(buckets)) {
      const overdueSum = buckets
        .filter(b => !/current|not.?due/i.test(b.range || b.label || b.name || ''))
        .reduce((s, b) => s + (parseFloat(b.amount || b.total || 0) || 0), 0)
      if (overdueSum > 0) { arOverdue = overdueSum; break }
    }
  }
  return { arTotal, arOverdue }
}

function extractAPAging(ap) {
  if (!ap) return { apTotal: null }
  const apTotal = deepFindNumber(ap, ['total', 'grand_total', 'total_payables', 'total_outstanding_payable_amount'])
  return { apTotal }
}

// ── Local cross-checks (Ledger's own tables — always accurate for what we track) ─

async function fetchLedgerLocals() {
  const [openInvoices, overdueInvoices, openBills, recentDeposits] = await Promise.all([
    prisma.dealInvoice.findMany({ where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } } }).catch(() => []),
    prisma.dealInvoice.findMany({ where: { status: 'OVERDUE' } }).catch(() => []),
    prisma.vendorBill.findMany({ where: { status: { in: ['PENDING_REVIEW', 'MAPPED', 'CREATED'] } } }).catch(() => []),
    prisma.deposit.findMany({ where: { status: 'APPROVED' }, orderBy: { txnDate: 'desc' }, take: 90 }).catch(() => []),
  ])
  const sum = (rows, field) => rows.reduce((s, r) => s + (r[field] != null ? Number(r[field]) : 0), 0)
  return {
    arTotalLocal:   sum(openInvoices, 'amountTotal'),
    arOverdueLocal: sum(overdueInvoices, 'amountTotal'),
    apTotalLocal:   sum(openBills, 'totalAmount'),
    openInvoiceCount: openInvoices.length,
    overdueInvoiceCount: overdueInvoices.length,
    openBillCount:  openBills.length,
    recentApprovedDepositCount: recentDeposits.length,
  }
}

// ── Edgar quote history — margin trend + best-effort win/loss ────────────────
//
// No real foreign key exists between an Edgar quote log and a CRM deal — this
// classifies each quote by fuzzy-matching its customer name against every
// deal's account/name, bucketed by that deal's stage. "unknown" means no CRM
// deal name matched at all (quote for a prospect with no deal yet, or a name
// mismatch) — it is the honest majority case, not a bug.

function classifyQuote(entityName, allDeals) {
  const name = (entityName || '').replace(/^(contact:|customer:)/, '').trim().toLowerCase()
  if (!name) return 'unknown'

  const matches = allDeals.filter(d => {
    const account = (d.account || '').toLowerCase()
    const dealName = (d.name || '').toLowerCase()
    return (account && (account.includes(name) || name.includes(account))) ||
           (dealName && (dealName.includes(name) || name.includes(dealName)))
  })
  if (!matches.length) return 'unknown'
  if (matches.some(d => d.stage === 'Closed Won'))  return 'won'
  if (matches.every(d => d.stage === 'Closed Lost')) return 'lost'
  return 'pending' // matches an open (not yet closed) deal
}

async function fetchEdgarQuoteHistory(allDeals) {
  const quotes = await prisma.agentInteraction.findMany({
    where:   { agentId: 'edgar', action: 'quote' },
    orderBy: { createdAt: 'desc' },
    take:    200,
  }).catch(() => [])

  if (!quotes.length) return { quoteCount: 0, avgGmPct: null, totalQuotedRevenue: 0, wonCount: 0, lostCount: 0, pendingCount: 0, unknownCount: 0 }

  const withMargin = quotes.filter(q => q.output?.overallGmPct != null)
  const avgGmPct = withMargin.length
    ? Math.round((withMargin.reduce((s, q) => s + Number(q.output.overallGmPct), 0) / withMargin.length) * 100) / 100
    : null
  const totalQuotedRevenue = quotes.reduce((s, q) => s + (Number(q.output?.totalRevenue) || 0), 0)

  const counts = { won: 0, lost: 0, pending: 0, unknown: 0 }
  for (const q of quotes) counts[classifyQuote(q.entity, allDeals)]++

  return {
    quoteCount: quotes.length, avgGmPct, totalQuotedRevenue,
    wonCount: counts.won, lostCount: counts.lost, pendingCount: counts.pending, unknownCount: counts.unknown,
  }
}

// ── Cache lookup ──────────────────────────────────────────────────────────────

async function findCachedSnapshot(periodType, toDate) {
  try {
    const dayStart = new Date(`${toDate}T00:00:00Z`)
    const dayEnd   = new Date(`${toDate}T23:59:59Z`)
    return await prisma.financialSnapshot.findFirst({
      where:   { periodType, snapshotDate: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: 'desc' },
    })
  } catch { return null }
}

// ── Core aggregation ──────────────────────────────────────────────────────────

export async function aggregateSnapshot({ periodType = 'WEEKLY', toDate, dryRun = true, force = false } = {}) {
  const { fromDate, toDate: to } = periodType === 'MONTHLY' ? monthRange(toDate) : weekRange(toDate)

  const cached = force ? null : await findCachedSnapshot(periodType, to)
  const useCache = !!(cached?.rawZohoPL || cached?.rawZohoBS)

  const [pl, bs, arAging, apAging, allDeals] = await Promise.all([
    useCache ? Promise.resolve(cached.rawZohoPL) : fetchPL(fromDate, to),
    useCache ? Promise.resolve(cached.rawZohoBS) : fetchBalanceSheet(to),
    useCache ? Promise.resolve(null) : fetchARAging(to),   // aging reports aren't cached raw (only PL/BS per spec) — always fresh unless we add fields for them later
    useCache ? Promise.resolve(null) : fetchAPAging(to),
    fetchAllDeals().catch(() => []),
  ])
  const openDeals = allDeals.filter(d => !CLOSED_STAGES.includes(d.stage))

  const { revenueTotal, cogsTotal, grossMargin } = extractPL(pl)
  const { cashPosition } = extractBalanceSheet(bs)
  const arFromZoho = extractARAging(arAging)
  const apFromZoho = extractAPAging(apAging)

  const locals = await fetchLedgerLocals()
  const edgarHistory = await fetchEdgarQuoteHistory(allDeals)

  const pipelineValue = openDeals.reduce((s, d) => s + d.amount, 0)

  const snapshot = {
    snapshotDate: to,
    periodType,
    revenueTotal,
    cogsTotal,
    grossMargin,
    cashPosition,
    arTotal:   arFromZoho.arTotal   ?? locals.arTotalLocal,
    arOverdue: arFromZoho.arOverdue ?? locals.arOverdueLocal,
    apTotal:   apFromZoho.apTotal   ?? locals.apTotalLocal,
    pipelineValue,
    rawZohoPL: pl,
    rawZohoBS: bs,
  }

  const context = {
    fromDate, toDate: to,
    cacheUsed: useCache,
    openDealCount: openDeals.length,
    ledgerLocals: locals,
    edgarQuoteHistory: edgarHistory,
    extractionNote: 'AR/AP totals fall back to Ledger\'s own tracked totals when the Zoho report total can\'t be confidently extracted — check which source won before trusting the number.',
  }

  let saved = null
  if (!dryRun) {
    saved = await prisma.financialSnapshot.create({
      data: { ...snapshot, snapshotDate: new Date(`${to}T00:00:00Z`) },
    }).catch(e => {
      console.error('[annie/aggregate] snapshot write failed:', e.message)
      return null
    })
  }

  return { ok: true, dryRun, snapshot, context, financialSnapshotId: saved?.id || null }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const {
    periodType = 'WEEKLY',
    toDate,
    dryRun = true,
    force  = false,
  } = req.body || {}

  if (!['WEEKLY', 'MONTHLY'].includes(periodType)) {
    return res.status(400).json({ error: 'periodType must be WEEKLY or MONTHLY' })
  }

  try {
    const result = await aggregateSnapshot({ periodType, toDate, dryRun, force })
    return res.json(result)
  } catch (err) {
    console.error('[annie/aggregate]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
