/**
 * POST /api/agents/annie/forecast
 * { task?: "forecast"|"backfill", horizonMonths?: 3|6|12, dryRun?: boolean }
 *
 * Annie's forecasting engine.
 *
 * task: "forecast" (default) — builds a revenue + cash projection:
 *
 *   Revenue[month] = (open-deal $ closing in that month) × closeRate × seasonality[month]
 *     closeRate is $-weighted closed-won / (closed-won + closed-lost) from CRM
 *     deal history (falls back to count-weighted, then to a conservative 0.25
 *     if there's no closed history at all yet).
 *
 *   Cash[month] = Cash[month-1] + ARCollections[month] - APDue[month] - COGS[month]
 *     Cash[0] starting point = latest FinancialSnapshot.cashPosition (0 if none exists yet).
 *     ARCollections weights each open DealInvoice by CustomerReliability (fuzzy
 *     name match — DealInvoice has no zohoContactId) — both a collection-date
 *     delay AND a $ haircut, not just a timing shift (a chronically-late payer
 *     is modeled as collecting less, not just collecting later).
 *     APDue derives a due date VendorBill doesn't itself store (createdAt +
 *     Supplier.paymentTerms), then adds slack days based on Supplier.paymentFriction
 *     (how much runway we take past terms depends on how strict that supplier
 *     is about being paid on time — friction is about their tolerance, not ours).
 *     COGS[month] = Revenue[month] × (1 - grossMarginPct/100), where grossMarginPct
 *     comes from the latest FinancialSnapshot if available, else Edgar's average
 *     quote margin, else a flat fallback — see resolveGrossMarginPct.
 *
 * dryRun (default true) — computes and returns without writing a Forecast row.
 *
 * task: "backfill" — for every existing Forecast, checks each projected month
 * that has fully elapsed and now has a MONTHLY FinancialSnapshot, computes the
 * variance (projected vs. actual, revenue and cash), and writes it into
 * actualVsForecast. Safe to re-run — recomputes and merges rather than
 * duplicating.
 *
 * NOTE: no live Zoho/DB access from this sandbox — this has never actually
 * run. Seasonality factors and reliability/friction weight tables are
 * reasoned heuristics, not empirically fit; revisit once enough
 * FinancialSnapshot/actualVsForecast history exists to calibrate against.
 */

import { setCors }        from '../../_lib/cors.js'
import { prisma }         from '../../_lib/prisma.js'
import { fetchAllDeals }  from './aggregate.js'

const CLOSED_STAGES = ['Closed Won', 'Closed Lost']
const DEFAULT_GROSS_MARGIN_PCT = 35 // fallback when no snapshot or quote history has margin data

// Spring (Feb–May) and fall (Aug–Oct) K-12 budget/bid cycles run hot; summer
// break and winter holidays run cold. Heuristic — recalibrate once 12+ months
// of FinancialSnapshot history exists to fit against real seasonal swings.
// Exported — insights.js reuses this to detect approaching spring/fall bid
// season AP waves and give the cash-timing gap check extra lead time.
export const SEASONALITY = {
  1: 0.90, 2: 1.15, 3: 1.25, 4: 1.20, 5: 1.10, 6: 0.85,
  7: 0.70, 8: 1.10, 9: 1.20, 10: 1.15, 11: 0.95, 12: 0.80,
}

// AR collection modeling — used when CustomerReliability.avgDaysLate is
// unknown for a customer; avgDaysLate (computed from real paid-invoice
// history) always wins over these defaults when present.
export const RELIABILITY_DEFAULTS = {
  RELIABLE:     { delayDays: 0,  collectPct: 1.00 },
  INCONSISTENT: { delayDays: 15, collectPct: 0.90 },
  CHRONIC_LATE: { delayDays: 30, collectPct: 0.75 },
  UNRATED:      { delayDays: 10, collectPct: 0.95 },
}

// AP timing — slack days past parsed payment terms, based on how much
// friction the supplier creates around late payment (their strictness, not ours).
export const FRICTION_SLACK_DAYS = { HIGH: 0, MEDIUM: 5, LOW: 15, UNRATED: 5 }

// ── date helpers ──────────────────────────────────────────────────────────────

export function monthKey(d)     { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
export function addDays(date, days) { return new Date(date.getTime() + days * 86_400_000) }
// Anchored to day 1 of the target month rather than adding via setUTCMonth on
// the original day-of-month — setUTCMonth rolls a day-29/30/31 start into the
// *next* month whenever the target month is shorter (e.g. Jul 29 + 7 months =
// Feb 29 doesn't exist -> rolls to Mar 1), which produced a duplicate month
// key and silently dropped the skipped month from buildMonthSeries below.
function addMonths(date, months) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)) }
function monthBounds(key) {
  const [y, m] = key.split('-').map(Number)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59)) }
}
export function parseTermsDays(terms) {
  const m = /(\d+)/.exec(terms || '')
  return m ? parseInt(m[1], 10) : 30
}
function buildMonthSeries(horizonMonths, startDate = new Date()) {
  const months = []
  for (let i = 0; i < horizonMonths; i++) months.push(monthKey(addMonths(startDate, i)))
  return months
}
// Buckets a date into the month series: dates before the horizon (overdue /
// should already have happened) clamp into the first month rather than being
// silently dropped; dates beyond the horizon are excluded (return null).
function clampMonthKey(date, months) {
  const key = monthKey(date)
  if (months.includes(key)) return key
  return key < months[0] ? months[0] : null
}

// ── Revenue forecast ──────────────────────────────────────────────────────────

// Exported for buildForecast's own use below. insights.js builds its own
// separate per-category/brand/territory win-rate breakdown
// (aggregateQuotesByDimension) rather than this org-wide aggregate — the two
// answer different questions (overall close rate vs. win rate by product
// line) so they intentionally don't share this function.
export async function computeCloseRates() {
  const allDeals = await fetchAllDeals().catch(() => [])
  const won  = allDeals.filter(d => d.stage === 'Closed Won')
  const lost = allDeals.filter(d => d.stage === 'Closed Lost')
  const countCloseRate = (won.length + lost.length) > 0 ? won.length / (won.length + lost.length) : null
  const wonValue  = won.reduce((s, d) => s + d.amount, 0)
  const lostValue = lost.reduce((s, d) => s + d.amount, 0)
  const dollarCloseRate = (wonValue + lostValue) > 0 ? wonValue / (wonValue + lostValue) : null
  return { countCloseRate, dollarCloseRate, wonCount: won.length, lostCount: lost.length, wonValue, lostValue, allDeals }
}

function forecastRevenue(openDeals, months, closeRate) {
  const series = {}
  for (const key of months) series[key] = 0
  let undatedPipelineValue = 0

  for (const deal of openDeals) {
    if (!deal.closingDate) { undatedPipelineValue += deal.amount; continue }
    const key = clampMonthKey(new Date(`${deal.closingDate}T12:00:00Z`), months)
    if (!key) continue // closes beyond the forecast horizon
    const seasonal = SEASONALITY[Number(key.split('-')[1])] || 1
    series[key] += deal.amount * closeRate * seasonal
  }
  for (const key of months) series[key] = Math.round(series[key] * 100) / 100
  return { series, undatedPipelineValue: Math.round(undatedPipelineValue * 100) / 100 }
}

// ── AR collections (weighted by CustomerReliability, not face value) ────────

// Exported — insights.js reuses this for AR-side cash-timing and chronic-late
// risk detection (requirements #1 and #7).
export async function fetchOpenInvoicesWithReliability() {
  const [invoices, reliability] = await Promise.all([
    prisma.dealInvoice.findMany({ where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] }, dueDate: { not: null } } }).catch(() => []),
    prisma.customerReliability.findMany().catch(() => []),
  ])

  return invoices.map(inv => {
    // No zohoContactId on DealInvoice — fuzzy-match by name, same pragmatic
    // approach used for Edgar quote win/loss matching in aggregate.js.
    const name  = (inv.crmDealName || '').toLowerCase()
    const match = name ? reliability.find(r => {
      const rn = r.customerName.toLowerCase()
      return rn && (rn.includes(name) || name.includes(rn))
    }) : null
    const flag     = match?.reliabilityFlag || 'UNRATED'
    const defaults = RELIABILITY_DEFAULTS[flag] || RELIABILITY_DEFAULTS.UNRATED
    const delayDays  = match?.avgDaysLate != null ? Math.round(match.avgDaysLate) : defaults.delayDays
    const collectPct = defaults.collectPct
    return {
      invoiceId: inv.id, crmDealName: inv.crmDealName, amount: Number(inv.amountTotal) || 0,
      dueDate: inv.dueDate, reliabilityFlag: flag, delayDays, collectPct,
      projectedCollectionDate: addDays(inv.dueDate, delayDays),
    }
  })
}

function forecastARCollections(invoices, months) {
  const series = {}
  for (const key of months) series[key] = 0
  for (const inv of invoices) {
    const key = clampMonthKey(inv.projectedCollectionDate, months)
    if (!key) continue
    series[key] += inv.amount * inv.collectPct
  }
  for (const key of months) series[key] = Math.round(series[key] * 100) / 100
  return series
}

// ── AP due (weighted by Supplier.paymentFriction/paymentTerms) ──────────────

// Exported — insights.js reuses this for AP-side cash-timing, payment-plan
// vendor selection, and late-penalty exposure flagging (requirements #1, #3, #6).
export async function fetchOpenBillsWithFriction() {
  const bills = await prisma.vendorBill.findMany({
    where:   { status: { in: ['PENDING_REVIEW', 'MAPPED', 'CREATED', 'NEEDS_REVIEW'] } },
    include: { supplier: { select: { name: true, paymentFriction: true, paymentTerms: true, latePenaltyTerms: true } } },
  }).catch(() => [])

  return bills.map(bill => {
    // VendorBill has no due date of its own — derive one from when it was
    // recorded plus the supplier's payment terms (defaults to net 30 if unset).
    const termsDays   = parseTermsDays(bill.supplier?.paymentTerms)
    const baseDueDate = addDays(bill.createdAt, termsDays)
    const friction    = bill.supplier?.paymentFriction || 'UNRATED'
    const slack        = FRICTION_SLACK_DAYS[friction] ?? FRICTION_SLACK_DAYS.UNRATED
    return {
      billId: bill.id, supplierId: bill.supplierId, supplierName: bill.supplier?.name || 'Unknown', amount: Number(bill.totalAmount) || 0,
      paymentTermsDays: termsDays, paymentFriction: friction, latePenaltyTerms: bill.supplier?.latePenaltyTerms || null,
      dueDate: baseDueDate, projectedPayDate: addDays(baseDueDate, slack),
    }
  })
}

function forecastAPDue(bills, months) {
  const series = {}
  for (const key of months) series[key] = 0
  for (const bill of bills) {
    const key = clampMonthKey(bill.projectedPayDate, months)
    if (!key) continue
    series[key] += bill.amount
  }
  for (const key of months) series[key] = Math.round(series[key] * 100) / 100
  return series
}

// ── Gross margin source (for COGS-from-pipeline projection) ──────────────────

async function resolveGrossMarginPct(latestSnapshot) {
  if (latestSnapshot?.grossMargin != null) {
    return { pct: Number(latestSnapshot.grossMargin), source: `FinancialSnapshot ${latestSnapshot.id}` }
  }
  const recentQuotes = await prisma.agentInteraction.findMany({
    where: { agentId: 'edgar', action: 'quote' }, orderBy: { createdAt: 'desc' }, take: 50,
  }).catch(() => [])
  const withMargin = recentQuotes.filter(q => q.output?.overallGmPct != null)
  if (withMargin.length) {
    const avg = withMargin.reduce((s, q) => s + Number(q.output.overallGmPct), 0) / withMargin.length
    return { pct: Math.round(avg * 100) / 100, source: 'edgar_quote_history_avg' }
  }
  return { pct: DEFAULT_GROSS_MARGIN_PCT, source: 'default_fallback' }
}

// ── Core forecast ─────────────────────────────────────────────────────────────

export async function buildForecast({ horizonMonths = 3, dryRun = true } = {}) {
  if (![3, 6, 12].includes(horizonMonths)) horizonMonths = 3
  const months = buildMonthSeries(horizonMonths)

  const [closeRates, invoicesWithReliability, billsWithFriction, latestSnapshot] = await Promise.all([
    computeCloseRates(),
    fetchOpenInvoicesWithReliability(),
    fetchOpenBillsWithFriction(),
    prisma.financialSnapshot.findFirst({ orderBy: { snapshotDate: 'desc' } }).catch(() => null),
  ])
  const { countCloseRate, dollarCloseRate, wonCount, lostCount, wonValue, lostValue, allDeals } = closeRates
  const marginInfo = await resolveGrossMarginPct(latestSnapshot)

  const closeRate = dollarCloseRate ?? countCloseRate ?? 0.25 // conservative default with no closed history at all
  const openDeals = allDeals.filter(d => !CLOSED_STAGES.includes(d.stage))

  const { series: projectedRevenue, undatedPipelineValue } = forecastRevenue(openDeals, months, closeRate)
  const arCollections = forecastARCollections(invoicesWithReliability, months)
  const apDue         = forecastAPDue(billsWithFriction, months)

  const startingCash = latestSnapshot?.cashPosition != null ? Number(latestSnapshot.cashPosition) : 0

  const projectedCash = {}
  let running = startingCash
  for (const key of months) {
    const cogs = projectedRevenue[key] * (1 - marginInfo.pct / 100)
    running = running + arCollections[key] - apDue[key] - cogs
    projectedCash[key] = Math.round(running * 100) / 100
  }

  const assumptions = {
    closeRate: { used: closeRate, dollarWeighted: dollarCloseRate, countWeighted: countCloseRate, wonCount, lostCount, wonValue, lostValue },
    seasonalityFactors: SEASONALITY,
    grossMarginPct: marginInfo.pct,
    grossMarginSource: marginInfo.source,
    arReliabilityWeights: RELIABILITY_DEFAULTS,
    apFrictionSlackDays: FRICTION_SLACK_DAYS,
    startingCashPosition: startingCash,
    startingCashSource: latestSnapshot
      ? `FinancialSnapshot ${latestSnapshot.id} (${latestSnapshot.snapshotDate.toISOString().slice(0, 10)})`
      : 'no FinancialSnapshot found yet — defaulted to 0',
    undatedPipelineValueExcluded: undatedPipelineValue,
    openDealCount: openDeals.length,
    openInvoiceCount: invoicesWithReliability.length,
    openBillCount: billsWithFriction.length,
    method: 'pipeline_conversion_seasonality_v1',
  }

  let saved = null
  if (!dryRun) {
    saved = await prisma.forecast.create({
      data: { horizonMonths, method: 'pipeline_conversion_seasonality_v1', projectedRevenue, projectedCash, assumptions },
    }).catch(e => { console.error('[annie/forecast] save failed:', e.message); return null })
  }

  return { ok: true, dryRun, horizonMonths, projectedRevenue, projectedCash, assumptions, forecastId: saved?.id || null }
}

// ── Backfill actualVsForecast ─────────────────────────────────────────────────

export async function backfillActuals() {
  const forecasts = await prisma.forecast.findMany().catch(() => [])
  let updated = 0

  for (const fc of forecasts) {
    const projRev  = fc.projectedRevenue || {}
    const projCash = fc.projectedCash || {}
    const resolved = {}

    for (const key of Object.keys(projRev)) {
      const { start, end } = monthBounds(key)
      if (end > new Date()) continue // month hasn't fully elapsed — nothing to compare yet

      const snap = await prisma.financialSnapshot.findFirst({
        where:   { periodType: 'MONTHLY', snapshotDate: { gte: start, lte: end } },
        orderBy: { snapshotDate: 'desc' },
      }).catch(() => null)
      if (!snap) continue

      const projectedRevenueVal = projRev[key]
      const actualRevenueVal    = snap.revenueTotal != null ? Number(snap.revenueTotal) : null
      const projectedCashVal    = projCash[key]
      const actualCashVal       = snap.cashPosition != null ? Number(snap.cashPosition) : null

      resolved[key] = {
        projectedRevenue: projectedRevenueVal,
        actualRevenue:    actualRevenueVal,
        revenueVariance:    actualRevenueVal != null ? Math.round((actualRevenueVal - projectedRevenueVal) * 100) / 100 : null,
        revenueVariancePct: (actualRevenueVal != null && projectedRevenueVal) ? Math.round(((actualRevenueVal - projectedRevenueVal) / projectedRevenueVal) * 10000) / 100 : null,
        projectedCash: projectedCashVal,
        actualCash:    actualCashVal,
        cashVariance:    actualCashVal != null ? Math.round((actualCashVal - projectedCashVal) * 100) / 100 : null,
        cashVariancePct: (actualCashVal != null && projectedCashVal) ? Math.round(((actualCashVal - projectedCashVal) / projectedCashVal) * 10000) / 100 : null,
        financialSnapshotId: snap.id,
      }
    }

    if (Object.keys(resolved).length) {
      const merged = { ...(fc.actualVsForecast || {}), ...resolved }
      const wrote = await prisma.forecast.update({ where: { id: fc.id }, data: { actualVsForecast: merged } })
        .then(() => true)
        .catch(e => { console.error('[annie/forecast] backfill write failed:', e.message); return false })
      if (wrote) updated++
    }
  }

  return { ok: true, forecastsChecked: forecasts.length, forecastsUpdated: updated }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { task = 'forecast', horizonMonths = 3, dryRun = true } = req.body || {}

  try {
    if (task === 'backfill') {
      const result = await backfillActuals()
      return res.json(result)
    }
    const result = await buildForecast({ horizonMonths, dryRun })
    return res.json(result)
  } catch (err) {
    console.error('[annie/forecast]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
