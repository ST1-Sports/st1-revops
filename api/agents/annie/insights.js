/**
 * POST /api/agents/annie/insights
 * { task?: "generate"|"friction-update"|"reliability-refresh", dryRun?: boolean, command?: string }
 *
 * Annie's business-health and insight-generation engine. Every finding is
 * written as an Insight row (category + supportingData) — never a bare
 * dollar-threshold alert.
 *
 * task: "generate" (default) — runs all checks below and returns/optionally
 * writes every Insight found:
 *
 *   CASH TIMING (PAYMENT_PLAN, RISK) — builds a day-level cash-flow timeline
 *   from projected AR collections (CustomerReliability-weighted) and
 *   projected AP due dates (Supplier.paymentFriction-weighted, reused from
 *   forecast.js), starting from the latest FinancialSnapshot cash position.
 *   A "gap" is a timing problem, not a balance floor: it fires the moment an
 *   AP due event would push the running balance negative, i.e. cash-out
 *   lands before enough cash-in has arrived to cover it. When a gap is
 *   found we build a payment plan (which AP to delay — lowest friction
 *   first, never a HIGH-friction vendor — which AR to chase, whether a
 *   split payment closes it). The lookahead window widens automatically
 *   when a spring/fall bid-season AP wave (SEASONALITY >= 1.15) is within
 *   STANDARD_LEAD_DAYS, so the warning lands with extra lead time instead
 *   of only showing up once the wave actually hits. HIGH-friction bills
 *   that both carry latePenaltyTerms and fall inside a projected shortfall
 *   are flagged as their own RISK insight (penalty exposure), separate
 *   from the payment plan.
 *
 *   CUSTOMER RELIABILITY (RISK) — CustomerReliability.avgDaysLate is
 *   computed (never manually set) from real Zoho Books paid-invoice history:
 *   payment date vs. due date, averaged per customer, requiring 3+ paid
 *   invoices before assigning anything other than UNRATED so one early/late
 *   invoice can't flip the flag. CHRONIC_LATE customers surface as their own
 *   RISK insight. Refreshed via task "reliability-refresh" (separate from
 *   "generate" since it hits Zoho Books directly and is comparatively slow).
 *
 *   AR AGING (RISK) — single-line flag for invoices 60+ days past due. No
 *   30/60/90 bucket breakdown by design (per spec).
 *
 *   OPPORTUNITY-FINDING (OPPORTUNITY) — cross-references Edgar's quote
 *   history (win/loss via aggregate.js's classifyQuote fuzzy-matched
 *   against CRM deals, category/brand/territory via the categoryBreakdown
 *   Edgar now logs per quote) to flag high-win-rate/low-margin lines (room
 *   to raise price) and low-win-rate/high-margin lines (pricing objection
 *   worth investigating). Requires 3+ closed quotes in a bucket before
 *   drawing a conclusion.
 *
 *   SPEND-CUTTING (SPEND_CUT) — COGS growth vs. revenue growth across
 *   recent MONTHLY FinancialSnapshots; Stripe processing-fee drag as a
 *   percent of processed revenue (direct Stripe balance_transactions pull —
 *   Zoho's own fee reporting shape is unverified from this sandbox, Stripe's
 *   API is not); vendor unit-cost creep from VendorBillLineItem history,
 *   cross-referenced with Supplier.paymentFriction (creep + HIGH friction =
 *   "shop this category" flag).
 *
 * task: "friction-update" — Matt sets Supplier.paymentFriction/paymentTerms
 * manually via a plain-English chat command (e.g. "flag Blazer as high
 * friction, Gill as low"). Claude parses the command into structured
 * updates, fuzzy-matches supplier names, and applies them (gated by dryRun
 * like everything else here).
 *
 * dryRun (default true) — computes and returns without writing Insight rows
 * (or, for friction-update/reliability-refresh, without writing the Supplier/
 * CustomerReliability update).
 *
 * NOTE: no live Zoho/DB/Stripe access from this sandbox — none of this has
 * actually run. Zoho Books invoice/payment field names for reliability
 * computation are best-effort candidates (see computeCustomerReliability),
 * same defensive posture as aggregate.js's report extraction. Thresholds
 * (60-day aging cutoff, 3-sample minimum, opportunity win-rate/margin
 * bands, cost-creep %) are reasoned heuristics, not fit to real history yet.
 */

import { setCors }       from '../../_lib/cors.js'
import { prisma }        from '../../_lib/prisma.js'
import { booksGet }      from '../../_lib/zoho-books.js'
import { fetchAllDeals, classifyQuote } from './aggregate.js'
import {
  SEASONALITY,
  addDays,
  fetchOpenInvoicesWithReliability,
  fetchOpenBillsWithFriction,
} from './forecast.js'

const API_KEY = process.env.ANTHROPIC_KEY
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY

const AR_AGING_THRESHOLD_DAYS   = 60
const STANDARD_LEAD_DAYS        = 30
const BID_SEASON_LEAD_DAYS      = 60
const HIGH_SEASON_FACTOR        = 1.15
const RELIABILITY_MIN_SAMPLES   = 3
const OPPORTUNITY_MIN_SAMPLES   = 3
const COST_CREEP_MIN_SAMPLES    = 3
const COST_CREEP_THRESHOLD_PCT  = 10
const MARGIN_COMPRESSION_MARGIN_PCT = 5
const STRIPE_FEE_FLAG_PCT       = 3.5

function daysBetween(a, b) { return Math.round((b - a) / 86_400_000) }

// ── CASH TIMING (requirements 1-4, 6) ────────────────────────────────────────

function isApproachingHighSeason(withinDays = STANDARD_LEAD_DAYS) {
  for (let d = 0; d <= withinDays; d += 15) {
    const m = addDays(new Date(), d).getUTCMonth() + 1
    if ((SEASONALITY[m] || 1) >= HIGH_SEASON_FACTOR) return true
  }
  return false
}

async function buildCashTimeline({ horizonDays = STANDARD_LEAD_DAYS } = {}) {
  const [invoicesWithReliability, billsWithFriction, latestSnapshot] = await Promise.all([
    fetchOpenInvoicesWithReliability(),
    fetchOpenBillsWithFriction(),
    prisma.financialSnapshot.findFirst({ orderBy: { snapshotDate: 'desc' } }).catch(() => null),
  ])

  const startingCash = latestSnapshot?.cashPosition != null ? Number(latestSnapshot.cashPosition) : 0
  const horizonEnd    = addDays(new Date(), horizonDays)

  const events = [
    ...invoicesWithReliability
      .filter(inv => inv.projectedCollectionDate <= horizonEnd)
      .map(inv => ({ type: 'AR_COLLECTION', date: inv.projectedCollectionDate, amount: inv.amount * inv.collectPct, ref: inv })),
    ...billsWithFriction
      .filter(b => b.projectedPayDate <= horizonEnd)
      .map(b => ({ type: 'AP_DUE', date: b.projectedPayDate, amount: -b.amount, ref: b })),
  ].sort((a, b) => a.date - b.date)

  let running = startingCash
  const timeline = events.map(e => {
    running += e.amount
    return { ...e, runningBalance: Math.round(running * 100) / 100 }
  })

  return { startingCash, timeline, invoicesWithReliability, billsWithFriction }
}

// A gap is timing, not a floor: it's the first AP_DUE event where cash-out
// lands before enough cash-in has arrived to cover it (running balance goes
// negative). AR events only ever add cash, so they can never trigger this —
// only an AP_DUE event can, which is exactly the "AP before AR" case we want.
function findFirstGap(timeline) {
  return timeline.find(e => e.type === 'AP_DUE' && e.runningBalance < 0) || null
}

function buildPaymentPlan(gapEvent, billsWithFriction, invoicesWithReliability) {
  const gapAmount = Math.abs(gapEvent.runningBalance)
  const frictionOrder = { LOW: 0, UNRATED: 1, MEDIUM: 2, HIGH: 3 }

  const dueBeforeGap = billsWithFriction
    .filter(b => b.projectedPayDate <= gapEvent.date)
    .sort((a, b) => (frictionOrder[a.paymentFriction] ?? 1) - (frictionOrder[b.paymentFriction] ?? 1) || b.amount - a.amount)

  const delayCandidates = []
  let covered = 0
  for (const bill of dueBeforeGap) {
    if (bill.paymentFriction === 'HIGH') continue // never recommend delaying a high-friction vendor
    delayCandidates.push({
      billId: bill.billId, supplierName: bill.supplierName, amount: bill.amount,
      paymentFriction: bill.paymentFriction, currentDueDate: bill.dueDate,
    })
    covered += bill.amount
    if (covered >= gapAmount) break
  }

  const reliabilityOrder = { RELIABLE: 0, UNRATED: 1, INCONSISTENT: 2, CHRONIC_LATE: 3 }
  const chaseCandidates = invoicesWithReliability
    .filter(inv => inv.projectedCollectionDate > gapEvent.date || inv.reliabilityFlag !== 'RELIABLE')
    .sort((a, b) => (reliabilityOrder[a.reliabilityFlag] ?? 1) - (reliabilityOrder[b.reliabilityFlag] ?? 1) || b.amount - a.amount)
    .slice(0, 5)
    .map(inv => ({
      invoiceId: inv.invoiceId, crmDealName: inv.crmDealName, amount: inv.amount,
      reliabilityFlag: inv.reliabilityFlag, dueDate: inv.dueDate,
    }))

  const splitCandidate = dueBeforeGap.find(b => b.paymentFriction !== 'HIGH' && b.amount >= gapAmount)
  const splitPaymentSuggestion = splitCandidate
    ? `Splitting ${splitCandidate.supplierName}'s $${splitCandidate.amount.toFixed(2)} bill (pay part now, part after the next AR collection) could close the gap without a full delay.`
    : null

  return {
    gapAmount:       Math.round(gapAmount * 100) / 100,
    gapDate:         gapEvent.date.toISOString().slice(0, 10),
    delayCandidates,
    coveredByDelay:  Math.round(covered * 100) / 100,
    chaseCandidates,
    splitPaymentSuggestion,
  }
}

// HIGH-friction bills with latePenaltyTerms that fall inside a projected
// shortfall — exposure to an actual penalty, not just "cash is tight."
function findLatePenaltyExposure(timeline) {
  return timeline
    .filter(e => e.type === 'AP_DUE' && e.ref.paymentFriction === 'HIGH' && e.ref.latePenaltyTerms && e.runningBalance < 0)
    .map(e => ({
      billId: e.ref.billId, supplierName: e.ref.supplierName, amount: e.ref.amount,
      dueDate: e.ref.dueDate, latePenaltyTerms: e.ref.latePenaltyTerms,
      projectedShortfall: Math.round(Math.abs(e.runningBalance) * 100) / 100,
    }))
}

async function generateCashRelatedInsights() {
  const approachingHighSeason = isApproachingHighSeason(STANDARD_LEAD_DAYS)
  const leadDays = approachingHighSeason ? BID_SEASON_LEAD_DAYS : STANDARD_LEAD_DAYS
  const { timeline, billsWithFriction, invoicesWithReliability, startingCash } =
    await buildCashTimeline({ horizonDays: leadDays })

  const insights = []

  const gap = findFirstGap(timeline)
  if (gap) {
    const plan = buildPaymentPlan(gap, billsWithFriction, invoicesWithReliability)
    insights.push({
      category: 'PAYMENT_PLAN',
      title:    `Cash timing gap projected around ${plan.gapDate} — ~$${plan.gapAmount.toFixed(2)} short`,
      detail:
        `Projected cash goes negative around ${plan.gapDate}: AP due dates land before enough AR has ` +
        `collected to cover them.${approachingHighSeason ? ' Flagged with extra lead time ahead of the upcoming spring/fall bid-season AP wave.' : ''} ` +
        `Suggested plan: delay ${plan.delayCandidates.length} bill(s) totaling $${plan.coveredByDelay.toFixed(2)} ` +
        `(lowest-friction vendors first, never a HIGH-friction vendor), and/or chase ${plan.chaseCandidates.length} AR invoice(s) harder.` +
        `${plan.splitPaymentSuggestion ? ' ' + plan.splitPaymentSuggestion : ''}`,
      supportingData: { ...plan, startingCash, leadDaysUsed: leadDays, approachingHighSeason },
    })
  }

  const exposure = findLatePenaltyExposure(timeline)
  if (exposure.length) {
    insights.push({
      category: 'RISK',
      title:    `${exposure.length} high-friction bill(s) at risk of a late penalty`,
      detail:
        `Cash isn't projected to be available by these bills' due dates. Each is with a HIGH-friction vendor ` +
        `and carries late-penalty terms — prioritize these ahead of lower-friction bills even if it means ` +
        `tightening elsewhere.`,
      supportingData: { exposure, leadDaysUsed: leadDays },
    })
  }

  return insights
}

// ── VENDOR FRICTION — manual command handler (requirement 5) ────────────────

async function parseFrictionCommand(command) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      signal:  ctrl.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 500,
        system:
          'Extract vendor payment-friction updates from a chat instruction. Return JSON only, no prose: ' +
          '{"updates":[{"supplierName":"...","paymentFriction":"LOW|MEDIUM|HIGH","note":"short note or null"}]}. ' +
          'paymentFriction is how much friction/strictness that vendor creates around being paid on time — ' +
          'HIGH means they must be paid on time or early, LOW means they tolerate delay without issue.',
        messages: [{ role: 'user', content: command }],
      }),
    })
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    const raw  = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    const m    = raw.match(/\{[\s\S]*\}/s)
    return m ? JSON.parse(m[0]) : { updates: [] }
  } finally {
    clearTimeout(timer)
  }
}

async function applyFrictionUpdates(updates, dryRun) {
  const suppliers = await prisma.supplier.findMany({ where: { active: true } }).catch(() => [])
  const results = []

  for (const u of updates) {
    const name  = (u.supplierName || '').trim().toLowerCase()
    const match = suppliers.find(s => s.name.toLowerCase() === name) ||
                  suppliers.find(s => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase()))

    if (!match) { results.push({ ...u, matched: false }); continue }
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(u.paymentFriction)) {
      results.push({ ...u, matched: true, supplierId: match.id, applied: false, reason: 'invalid friction level' })
      continue
    }

    if (!dryRun) {
      await prisma.supplier.update({
        where: { id: match.id },
        data:  { paymentFriction: u.paymentFriction, frictionNotes: u.note || match.frictionNotes },
      }).catch(() => {})
    }
    results.push({ supplierName: match.name, supplierId: match.id, paymentFriction: u.paymentFriction, matched: true, applied: !dryRun })
  }
  return results
}

// ── CUSTOMER RELIABILITY (requirements 7-8) ──────────────────────────────────

function classifyReliability(avgDaysLate, sampleCount) {
  if (sampleCount < RELIABILITY_MIN_SAMPLES || avgDaysLate == null) return 'UNRATED'
  if (avgDaysLate <= 3)  return 'RELIABLE'
  if (avgDaysLate <= 15) return 'INCONSISTENT'
  return 'CHRONIC_LATE'
}

// Zoho Books' exact paid-invoice/payment-date field names are unverified from
// this sandbox — same defensive posture as aggregate.js's report extraction.
// Only invoices where both a due_date and a confident payment-completion
// date are present count toward the average; the rest are silently excluded
// rather than guessed at.
async function computeCustomerReliability({ dryRun = true } = {}) {
  let all = [], page = 1
  while (page <= 10) { // hard cap, same convention as fetchAllDeals
    const data  = await booksGet(`/invoices?status=paid&per_page=200&page=${page}`).catch(() => ({ invoices: [] }))
    const batch = data.invoices || []
    all = all.concat(batch)
    if (!data.page_context?.has_more_page || batch.length < 200) break
    page++
  }

  const byCustomer = new Map()
  for (const inv of all) {
    const customerId   = inv.customer_id
    const customerName = inv.customer_name
    if (!customerId) continue

    const dueDate  = inv.due_date ? new Date(`${inv.due_date}T00:00:00Z`) : null
    const paidDate = inv.last_payment_date ? new Date(`${inv.last_payment_date}T00:00:00Z`) : null
    if (!dueDate || !paidDate) continue // can't confidently compute days-late without both

    const entry = byCustomer.get(customerId) || { customerId, customerName, samples: [] }
    entry.samples.push(daysBetween(dueDate, paidDate))
    byCustomer.set(customerId, entry)
  }

  const results = []
  for (const entry of byCustomer.values()) {
    const count       = entry.samples.length
    const avgDaysLate = count ? entry.samples.reduce((s, d) => s + d, 0) / count : null
    const flag        = classifyReliability(avgDaysLate, count)
    const rounded     = avgDaysLate != null ? Math.round(avgDaysLate * 10) / 10 : null

    results.push({ zohoContactId: entry.customerId, customerName: entry.customerName, avgDaysLate: rounded, sampleCount: count, reliabilityFlag: flag })

    if (!dryRun && count >= RELIABILITY_MIN_SAMPLES) {
      await prisma.customerReliability.upsert({
        where:  { zohoContactId: entry.customerId },
        update: { customerName: entry.customerName, avgDaysLate, reliabilityFlag: flag },
        create: { zohoContactId: entry.customerId, customerName: entry.customerName, avgDaysLate, reliabilityFlag: flag },
      }).catch(() => {})
    }
  }
  return results
}

async function generateChronicLateInsight() {
  const chronic = await prisma.customerReliability.findMany({ where: { reliabilityFlag: 'CHRONIC_LATE' } }).catch(() => [])
  if (!chronic.length) return []
  return [{
    category: 'RISK',
    title:    `${chronic.length} customer(s) chronically late on payment`,
    detail:
      `These customers show a sustained pattern (3+ paid invoices, rolling average) of paying well past ` +
      `due date — not a single late invoice: ${chronic.map(c => c.customerName).join(', ')}.`,
    supportingData: { customers: chronic.map(c => ({ customerName: c.customerName, zohoContactId: c.zohoContactId, avgDaysLate: c.avgDaysLate })) },
  }]
}

async function generateAgingRiskInsight() {
  const cutoff = addDays(new Date(), -AR_AGING_THRESHOLD_DAYS)
  const overdueInvoices = await prisma.dealInvoice.findMany({
    where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] }, dueDate: { lte: cutoff } },
  }).catch(() => [])
  if (!overdueInvoices.length) return []

  const totalOutstanding = overdueInvoices.reduce((s, i) => s + ((Number(i.amountTotal) || 0) - (Number(i.amountPaid) || 0)), 0)
  return [{
    category: 'RISK',
    title:    `${overdueInvoices.length} invoice(s) 60+ days past due — $${totalOutstanding.toFixed(2)} outstanding`,
    detail:   `Flagging only invoices at least ${AR_AGING_THRESHOLD_DAYS} days past their due date (no 30/60/90 bucket breakdown by design).`,
    supportingData: {
      invoices: overdueInvoices.map(i => ({
        invoiceId: i.id, crmDealName: i.crmDealName, dueDate: i.dueDate,
        amountOutstanding: Math.round(((Number(i.amountTotal) || 0) - (Number(i.amountPaid) || 0)) * 100) / 100,
      })),
    },
  }]
}

// ── OPPORTUNITY-FINDING (requirement 9) ──────────────────────────────────────

async function aggregateQuotesByDimension() {
  const [quotes, allDeals] = await Promise.all([
    prisma.agentInteraction.findMany({ where: { agentId: 'edgar', action: 'quote' }, orderBy: { createdAt: 'desc' }, take: 300 }).catch(() => []),
    fetchAllDeals().catch(() => []),
  ])

  const byCategoryBrand = new Map()
  const byTerritory     = new Map()

  for (const q of quotes) {
    const outcome = classifyQuote(q.entity, allDeals)
    if (outcome !== 'won' && outcome !== 'lost') continue // only closed quotes count toward win-rate

    const territory = q.output?.territory
    if (territory) {
      const t = byTerritory.get(territory) || { territory, won: 0, lost: 0, gmSum: 0, gmCount: 0 }
      t[outcome === 'won' ? 'won' : 'lost']++
      if (q.output?.overallGmPct != null) { t.gmSum += Number(q.output.overallGmPct); t.gmCount++ }
      byTerritory.set(territory, t)
    }

    const breakdown = Array.isArray(q.output?.categoryBreakdown) ? q.output.categoryBreakdown : []
    for (const b of breakdown) {
      const key   = `${b.category}::${b.brand}`
      const entry = byCategoryBrand.get(key) || { category: b.category, brand: b.brand, won: 0, lost: 0, gmSum: 0, gmCount: 0 }
      entry[outcome === 'won' ? 'won' : 'lost']++
      if (b.gmPct != null) { entry.gmSum += b.gmPct; entry.gmCount++ }
      byCategoryBrand.set(key, entry)
    }
  }

  const finalize = m => [...m.values()].map(e => ({
    ...e,
    totalQuotes: e.won + e.lost,
    winRate:  (e.won + e.lost) > 0 ? Math.round((e.won / (e.won + e.lost)) * 1000) / 10 : null,
    avgGmPct: e.gmCount ? Math.round((e.gmSum / e.gmCount) * 10) / 10 : null,
  }))

  return { byCategoryBrand: finalize(byCategoryBrand), byTerritory: finalize(byTerritory) }
}

function findOpportunitiesFromAggregate(entries, dimensionLabel) {
  const insights = []
  for (const e of entries) {
    if (e.totalQuotes < OPPORTUNITY_MIN_SAMPLES || e.winRate == null || e.avgGmPct == null) continue
    const label = e.category ? `${e.category} / ${e.brand}` : e.territory

    if (e.winRate >= 70 && e.avgGmPct <= 20) {
      insights.push({
        category: 'OPPORTUNITY',
        title:    `${label}: high win rate, low margin — room to raise price`,
        detail:   `${e.winRate}% win rate across ${e.totalQuotes} closed quotes at only ${e.avgGmPct}% average margin (by ${dimensionLabel}). Winning this consistently at this margin suggests price has room to move up before it affects close rate.`,
        supportingData: { ...e, dimension: dimensionLabel },
      })
    } else if (e.winRate <= 30 && e.avgGmPct >= 35) {
      insights.push({
        category: 'OPPORTUNITY',
        title:    `${label}: low win rate, high margin — pricing objection worth investigating`,
        detail:   `Only ${e.winRate}% win rate across ${e.totalQuotes} closed quotes despite ${e.avgGmPct}% average margin (by ${dimensionLabel}). Losing this often at this margin points to a pricing objection worth investigating, not just competitive loss.`,
        supportingData: { ...e, dimension: dimensionLabel },
      })
    }
  }
  return insights
}

async function generateOpportunityInsights() {
  const { byCategoryBrand, byTerritory } = await aggregateQuotesByDimension()
  return [
    ...findOpportunitiesFromAggregate(byCategoryBrand, 'product line/brand'),
    ...findOpportunitiesFromAggregate(byTerritory, 'territory'),
  ]
}

// ── SPEND-CUTTING (requirement 10) ───────────────────────────────────────────

async function findMarginCompression() {
  const snapshots = await prisma.financialSnapshot.findMany({
    where: { periodType: 'MONTHLY' }, orderBy: { snapshotDate: 'desc' }, take: 6,
  }).catch(() => [])
  if (snapshots.length < 3) return []

  const ordered = [...snapshots].reverse() // oldest → newest
  const first = ordered[0], last = ordered[ordered.length - 1]
  if (first.revenueTotal == null || first.cogsTotal == null || last.revenueTotal == null || last.cogsTotal == null) return []
  if (!(Number(first.revenueTotal) > 0) || !(Number(first.cogsTotal) > 0)) return []

  const revenueGrowthPct = ((Number(last.revenueTotal) - Number(first.revenueTotal)) / Number(first.revenueTotal)) * 100
  const cogsGrowthPct    = ((Number(last.cogsTotal)    - Number(first.cogsTotal))    / Number(first.cogsTotal))    * 100

  if (cogsGrowthPct <= revenueGrowthPct + MARGIN_COMPRESSION_MARGIN_PCT) return []

  return [{
    category: 'SPEND_CUT',
    title:    'COGS growing faster than revenue',
    detail:   `Over the last ${ordered.length} monthly snapshots, revenue grew ${revenueGrowthPct.toFixed(1)}% while COGS grew ${cogsGrowthPct.toFixed(1)}% — margin is compressing even as sales grow.`,
    supportingData: {
      revenueGrowthPct: Math.round(revenueGrowthPct * 10) / 10,
      cogsGrowthPct:    Math.round(cogsGrowthPct * 10) / 10,
      periods: ordered.map(s => ({ date: s.snapshotDate, revenueTotal: s.revenueTotal, cogsTotal: s.cogsTotal })),
    },
  }]
}

async function findStripeFeeDrag() {
  if (!STRIPE_KEY) return []
  try {
    const sinceSec = Math.floor((Date.now() - 90 * 86_400_000) / 1000)
    let all = [], hasMore = true, startingAfter = null
    while (hasMore && all.length < 1000) {
      const url = new URL('https://api.stripe.com/v1/balance_transactions')
      url.searchParams.set('created[gte]', String(sinceSec))
      url.searchParams.set('limit', '100')
      if (startingAfter) url.searchParams.set('starting_after', startingAfter)
      const r = await fetch(url, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } })
      if (!r.ok) break
      const data = await r.json()
      all = all.concat(data.data || [])
      hasMore = !!data.has_more
      startingAfter = data.data?.length ? data.data[data.data.length - 1].id : null
    }
    if (!all.length) return []

    const fees  = all.reduce((s, t) => s + (t.fee || 0), 0) / 100
    const gross = all.reduce((s, t) => s + (t.amount || 0), 0) / 100
    if (gross <= 0) return []
    const feePct = (fees / gross) * 100
    if (feePct < STRIPE_FEE_FLAG_PCT) return []

    return [{
      category: 'SPEND_CUT',
      title:    `Stripe fees running ${feePct.toFixed(2)}% of processed revenue`,
      detail:   `Trailing 90 days: $${fees.toFixed(2)} in fees against $${gross.toFixed(2)} processed (${feePct.toFixed(2)}%) — above typical blended rates. Worth a rate review with Stripe, or checking for avoidable transaction types (international cards, disputes).`,
      supportingData: {
        trailingDays: 90, totalFees: Math.round(fees * 100) / 100, totalProcessed: Math.round(gross * 100) / 100,
        feePct: Math.round(feePct * 100) / 100, txnCount: all.length,
      },
    }]
  } catch (e) {
    console.warn('[annie/insights] Stripe fee drag check failed:', e.message)
    return []
  }
}

async function findCostCreep() {
  const lineItems = await prisma.vendorBillLineItem.findMany({
    include: { vendorBill: { include: { supplier: { select: { id: true, name: true, paymentFriction: true } } } } },
    orderBy: { id: 'desc' },
    take: 2000,
  }).catch(() => [])

  const groups = new Map()
  for (const li of lineItems) {
    const supplier = li.vendorBill?.supplier
    if (!supplier) continue
    const desc = (li.rawSku || li.rawDescription || '').toLowerCase().trim()
    if (!desc) continue
    const key   = `${supplier.id}::${desc}`
    const entry = groups.get(key) || {
      supplierId: supplier.id, supplierName: supplier.name,
      paymentFriction: supplier.paymentFriction || 'UNRATED', desc, samples: [],
    }
    entry.samples.push({ unitCost: Number(li.unitCost), createdAt: li.vendorBill.createdAt })
    groups.set(key, entry)
  }

  const findings = []
  for (const g of groups.values()) {
    if (g.samples.length < COST_CREEP_MIN_SAMPLES) continue
    const ordered = [...g.samples].sort((a, b) => a.createdAt - b.createdAt)
    const first = ordered[0].unitCost, last = ordered[ordered.length - 1].unitCost
    if (!(first > 0)) continue
    const changePct = ((last - first) / first) * 100
    if (changePct >= COST_CREEP_THRESHOLD_PCT) {
      findings.push({ ...g, samples: undefined, changePct: Math.round(changePct * 10) / 10, firstCost: first, lastCost: last, sampleCount: ordered.length })
    }
  }

  return findings.map(f => ({
    category: 'SPEND_CUT',
    title: f.paymentFriction === 'HIGH'
      ? `${f.supplierName}: cost creep + high friction — shop this category`
      : `${f.supplierName}: unit cost up ${f.changePct}% on "${f.desc}"`,
    detail: f.paymentFriction === 'HIGH'
      ? `Unit cost on "${f.desc}" is up ${f.changePct}% ($${f.firstCost.toFixed(2)} → $${f.lastCost.toFixed(2)}) across ${f.sampleCount} bills, and this vendor is already flagged HIGH friction — worth shopping this category for an alternative supplier.`
      : `Unit cost on "${f.desc}" is up ${f.changePct}% ($${f.firstCost.toFixed(2)} → $${f.lastCost.toFixed(2)}) across ${f.sampleCount} bills.`,
    supportingData: f,
  }))
}

async function generateSpendCutInsights() {
  const [margin, stripe, creep] = await Promise.all([findMarginCompression(), findStripeFeeDrag(), findCostCreep()])
  return [...margin, ...stripe, ...creep]
}

// ── Core insight generation ───────────────────────────────────────────────────

function countByCategory(insights) {
  const c = {}
  for (const i of insights) c[i.category] = (c[i.category] || 0) + 1
  return c
}

export async function generateInsights({ dryRun = true } = {}) {
  const [cashRelated, chronicLate, agingRisk, opportunities, spendCuts] = await Promise.all([
    generateCashRelatedInsights(),
    generateChronicLateInsight(),
    generateAgingRiskInsight(),
    generateOpportunityInsights(),
    generateSpendCutInsights(),
  ])

  const all = [...cashRelated, ...chronicLate, ...agingRisk, ...opportunities, ...spendCuts]

  let saved = []
  if (!dryRun && all.length) {
    saved = await Promise.all(all.map(i => prisma.insight.create({
      data: { category: i.category, title: i.title, detail: i.detail, supportingData: i.supportingData, surfacedIn: 'CHAT' },
    }).catch(e => { console.error('[annie/insights] write failed:', e.message); return null })))
  }

  return {
    ok: true, dryRun,
    counts:     { total: all.length, byCategory: countByCategory(all) },
    insights:   all,
    insightIds: saved.filter(Boolean).map(s => s.id),
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { task = 'generate', dryRun = true, command } = req.body || {}

  try {
    if (task === 'friction-update') {
      if (!command)  return res.status(400).json({ error: 'command is required for friction-update' })
      if (!API_KEY)  return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })
      const parsed  = await parseFrictionCommand(command)
      const results = await applyFrictionUpdates(parsed.updates || [], dryRun)
      return res.json({ ok: true, dryRun, updates: results })
    }

    if (task === 'reliability-refresh') {
      const results = await computeCustomerReliability({ dryRun })
      return res.json({ ok: true, dryRun, results })
    }

    const result = await generateInsights({ dryRun })
    return res.json(result)
  } catch (err) {
    console.error('[annie/insights]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
