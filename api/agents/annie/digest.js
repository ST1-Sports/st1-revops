/**
 * POST /api/agents/annie/digest
 * { task?: "weekly"|"monthly", dryRun?: boolean, channel?: string, recipient?: string }
 *
 * Annie's scheduled digest delivery. Cron-triggered via
 * api/cron/annie-digest-weekly.js and api/cron/annie-digest-monthly.js.
 *
 * task: "weekly" (default) — short, built for Slack #all-st1-sports:
 *   - cash position (from a fresh WEEKLY FinancialSnapshot)
 *   - new PAYMENT_PLAN/RISK insights created since the last WEEKLY digest
 *     (queried from the Insight table itself, not just this run's output —
 *     so nothing is missed if insights.js ran independently in between)
 *   - AR 60+ day flag (single line, reuses insights.js's fetchArAging60Plus)
 *   - pipeline movement (this week's FinancialSnapshot.pipelineValue vs last week's)
 *   Delivered via Slack chat.postMessage (SLACK_BOT_TOKEN + SLACK_DIGEST_CHANNEL,
 *   falling back to the #all-st1-sports channel ID hardcoded elsewhere in this repo).
 *
 * task: "monthly" — longer, full narrative, delivered via Gmail:
 *   - P&L/Balance Sheet narrative for the just-finished calendar month (fresh
 *     MONTHLY FinancialSnapshot vs. the prior month's for deltas)
 *   - forecast vs. actual for that month, read from Forecast.actualVsForecast
 *     (backfillActuals is run first so it's up to date)
 *   - top 3 OPPORTUNITY insights, top 3 SPEND_CUT insights (most recent,
 *     excluding DISMISSED)
 *   Delivered via Gmail (api/gmail.js's "send" action, called over an internal
 *   fetch — gmail.js has no importable send function, only its own handler)
 *   to ANNIE_DIGEST_EMAIL_TO.
 *
 * Every send (real, i.e. dryRun:false) is logged to DigestLog (digestType,
 * channel, insightIds — only the ones actually shown in that digest, not
 * every insight generated during the run — and snapshotId), and the shown
 * Insight rows have their surfacedIn updated to DIGEST_WEEKLY/DIGEST_MONTHLY.
 * A digest is skipped (not re-sent) if one of the same digestType already
 * logged within the last 20 hours, guarding against a duplicate cron fire.
 *
 * dryRun (default true) — computes and formats everything, including running
 * aggregateSnapshot/generateInsights/backfillActuals in their own dry-run
 * mode (no snapshot/insight writes), and returns without sending or logging.
 *
 * NOTE: no live Zoho/DB/Slack/Gmail access from this sandbox — none of this
 * has actually run.
 */

import { setCors }   from '../../_lib/cors.js'
import { prisma }    from '../../_lib/prisma.js'
import { postSlackMessage } from '../../_lib/slack.js'
import { aggregateSnapshot }           from './aggregate.js'
import { backfillActuals, monthKey, addDays } from './forecast.js'
import { generateInsights, fetchArAging60Plus, AR_AGING_THRESHOLD_DAYS } from './insights.js'

// Confirmed elsewhere in this repo (README.md, src/lib/api.js, src/pages/Integrations.jsx)
// as the #all-st1-sports channel ID — used only if SLACK_DIGEST_CHANNEL isn't set.
const DEFAULT_DIGEST_CHANNEL = 'C09F64RK0MN'
const DUPLICATE_SEND_LOOKBACK_HOURS = 20

const fmtMoney = n => n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct   = n => n == null ? 'n/a' : `${Number(n).toFixed(1)}%`

// ── Duplicate-send guard ──────────────────────────────────────────────────────

async function alreadySentRecently(digestType, lookbackHours) {
  const since = new Date(Date.now() - lookbackHours * 3_600_000)
  return prisma.digestLog.findFirst({
    where: { digestType, sentAt: { gt: since } }, orderBy: { sentAt: 'desc' },
  }).catch(() => null)
}

// ── WEEKLY ─────────────────────────────────────────────────────────────────

async function buildWeeklyDigestContent({ dryRun = true } = {}) {
  const [aggResult, insightsResult] = await Promise.all([
    aggregateSnapshot({ periodType: 'WEEKLY', dryRun }),
    generateInsights({ dryRun }),
  ])

  const lastDigest = await prisma.digestLog.findFirst({ where: { digestType: 'WEEKLY' }, orderBy: { sentAt: 'desc' } }).catch(() => null)
  const since = lastDigest?.sentAt || addDays(new Date(), -8) // no prior digest yet — default lookback ~1 week

  const [newRiskInsights, weeklySnaps, arAging] = await Promise.all([
    prisma.insight.findMany({
      where: { category: { in: ['PAYMENT_PLAN', 'RISK'] }, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
    }).catch(() => []),
    prisma.financialSnapshot.findMany({ where: { periodType: 'WEEKLY' }, orderBy: { snapshotDate: 'desc' }, take: 2 }).catch(() => []),
    fetchArAging60Plus(),
  ])
  const [thisWeekSnap, lastWeekSnap] = weeklySnaps

  const pipelineMovement = (thisWeekSnap?.pipelineValue != null && lastWeekSnap?.pipelineValue != null)
    ? Math.round((Number(thisWeekSnap.pipelineValue) - Number(lastWeekSnap.pipelineValue)) * 100) / 100
    : null

  const cashPosition = aggResult.snapshot?.cashPosition ?? thisWeekSnap?.cashPosition ?? null
  const weekEnding    = aggResult.context?.toDate || new Date().toISOString().slice(0, 10)

  const text = formatWeeklySlackText({ cashPosition, pipelineMovement, newRiskInsights, arAging, weekEnding })

  return {
    weekEnding, cashPosition, pipelineMovement, newRiskInsights, arAging,
    snapshotId: aggResult.financialSnapshotId,
    allGeneratedInsightIds: insightsResult.insightIds,
    text,
  }
}

function formatWeeklySlackText({ cashPosition, pipelineMovement, newRiskInsights, arAging, weekEnding }) {
  const lines = [`*Annie — Weekly Digest* (week ending ${weekEnding})`, '']
  lines.push(`Cash position: ${fmtMoney(cashPosition)}`)
  lines.push(`Pipeline movement: ${pipelineMovement == null ? 'n/a' : `${pipelineMovement >= 0 ? '+' : ''}${fmtMoney(pipelineMovement)}`}`)
  lines.push(`AR ${AR_AGING_THRESHOLD_DAYS}+ days past due: ${arAging.invoices.length} invoice(s), ${fmtMoney(arAging.totalOutstanding)} outstanding`)

  if (newRiskInsights.length) {
    lines.push('', `New PAYMENT_PLAN/RISK flags since last digest (${newRiskInsights.length}):`)
    for (const i of newRiskInsights.slice(0, 8)) lines.push(`• [${i.category}] ${i.title}`)
    if (newRiskInsights.length > 8) lines.push(`...and ${newRiskInsights.length - 8} more`)
  } else {
    lines.push('', 'No new PAYMENT_PLAN/RISK flags since last digest.')
  }
  return lines.join('\n')
}

async function deliverWeeklyDigest(content, { dryRun = true, channelOverride } = {}) {
  const channel = channelOverride || process.env.SLACK_DIGEST_CHANNEL || DEFAULT_DIGEST_CHANNEL
  const sendResult = dryRun
    ? { ok: true, skipped: true, reason: 'dry run — not sent' }
    : await postSlackMessage({ channel, text: content.text })
  return { channel, method: 'SLACK', sendResult }
}

export async function runWeeklyDigest({ dryRun = true, channelOverride } = {}) {
  const dup = !dryRun ? await alreadySentRecently('WEEKLY', DUPLICATE_SEND_LOOKBACK_HOURS) : null
  if (dup) return { ok: true, skipped: true, reason: `WEEKLY digest already sent at ${dup.sentAt.toISOString()}` }

  const content  = await buildWeeklyDigestContent({ dryRun })
  const delivery = await deliverWeeklyDigest(content, { dryRun, channelOverride })
  const shownInsightIds = content.newRiskInsights.map(i => i.id)

  let logRow = null
  if (!dryRun) {
    if (shownInsightIds.length) {
      await prisma.insight.updateMany({ where: { id: { in: shownInsightIds } }, data: { surfacedIn: 'DIGEST_WEEKLY' } }).catch(() => {})
    }
    logRow = await prisma.digestLog.create({
      data: { digestType: 'WEEKLY', channel: delivery.method, insightIds: shownInsightIds, snapshotId: content.snapshotId },
    }).catch(e => { console.error('[annie/digest] DigestLog write failed:', e.message); return null })
  }

  return { ok: true, dryRun, content, delivery, digestLogId: logRow?.id || null }
}

// ── MONTHLY ────────────────────────────────────────────────────────────────

// The just-finished calendar month, as of whenever this runs (intended to run
// on the 1st, so "previous month" is a full, closed month).
function previousMonthRange(refDate = new Date()) {
  const firstOfThisMonth = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 1))
  const lastOfPrevMonth  = new Date(firstOfThisMonth.getTime() - 86_400_000)
  const firstOfPrevMonth = new Date(Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1))
  return { start: firstOfPrevMonth, end: lastOfPrevMonth, toDateStr: lastOfPrevMonth.toISOString().slice(0, 10) }
}

async function fetchForecastVsActualForMonth(mKey) {
  const forecasts = await prisma.forecast.findMany({ orderBy: { forecastDate: 'desc' }, take: 20 }).catch(() => [])
  for (const fc of forecasts) {
    const entry = fc.actualVsForecast?.[mKey]
    if (entry) return { forecastId: fc.id, monthKey: mKey, ...entry }
  }
  return null
}

function buildMonthlyNarrativeLines(snap, priorSnap) {
  const deltaFmt = (curr, prev) => {
    if (curr == null || prev == null) return ''
    const d = Number(curr) - Number(prev)
    return ` (${d >= 0 ? '+' : ''}${fmtMoney(d)} vs prior month)`
  }
  return [
    `Revenue: ${fmtMoney(snap.revenueTotal)}${deltaFmt(snap.revenueTotal, priorSnap?.revenueTotal)}`,
    `COGS: ${fmtMoney(snap.cogsTotal)}${deltaFmt(snap.cogsTotal, priorSnap?.cogsTotal)}`,
    `Gross margin: ${fmtPct(snap.grossMargin)}`,
    `Cash position: ${fmtMoney(snap.cashPosition)}${deltaFmt(snap.cashPosition, priorSnap?.cashPosition)}`,
    `AR total / overdue: ${fmtMoney(snap.arTotal)} / ${fmtMoney(snap.arOverdue)}`,
    `AP total: ${fmtMoney(snap.apTotal)}`,
    `Open pipeline: ${fmtMoney(snap.pipelineValue)}`,
  ]
}

async function buildMonthlyDigestContent({ dryRun = true } = {}) {
  const { start, end, toDateStr } = previousMonthRange()

  const aggResult = await aggregateSnapshot({ periodType: 'MONTHLY', toDate: toDateStr, dryRun })
  if (!dryRun) await backfillActuals().catch(e => console.error('[annie/digest] backfillActuals failed:', e.message))
  const insightsResult = await generateInsights({ dryRun })

  const mKey = monthKey(end)

  const [priorSnap, forecastVsActual, topOpportunities, topSpendCuts] = await Promise.all([
    prisma.financialSnapshot.findFirst({ where: { periodType: 'MONTHLY', snapshotDate: { lt: start } }, orderBy: { snapshotDate: 'desc' } }).catch(() => null),
    fetchForecastVsActualForMonth(mKey),
    prisma.insight.findMany({ where: { category: 'OPPORTUNITY', status: { not: 'DISMISSED' } }, orderBy: { createdAt: 'desc' }, take: 3 }).catch(() => []),
    prisma.insight.findMany({ where: { category: 'SPEND_CUT',  status: { not: 'DISMISSED' } }, orderBy: { createdAt: 'desc' }, take: 3 }).catch(() => []),
  ])

  const narrativeLines = buildMonthlyNarrativeLines(aggResult.snapshot, priorSnap)
  const monthLabel = end.toISOString().slice(0, 7)

  const html = formatMonthlyEmailHtml({ monthLabel, narrativeLines, forecastVsActual, topOpportunities, topSpendCuts })
  const text = [`Annie — Monthly Digest: ${monthLabel}`, '', ...narrativeLines].join('\n')

  return {
    monthLabel, mKey, narrativeLines, forecastVsActual, topOpportunities, topSpendCuts,
    snapshotId: aggResult.financialSnapshotId,
    allGeneratedInsightIds: insightsResult.insightIds,
    html, text,
  }
}

function formatMonthlyEmailHtml({ monthLabel, narrativeLines, forecastVsActual, topOpportunities, topSpendCuts }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const li  = arr => arr.map(x => `<li>${esc(x)}</li>`).join('')

  const forecastSection = forecastVsActual
    ? `<p><b>Forecast vs. actual (${esc(forecastVsActual.monthKey)}):</b><br/>
       Revenue: projected ${fmtMoney(forecastVsActual.projectedRevenue)} vs actual ${fmtMoney(forecastVsActual.actualRevenue)}
       (${forecastVsActual.revenueVariancePct != null ? forecastVsActual.revenueVariancePct.toFixed(1) + '%' : 'n/a'} variance)<br/>
       Cash: projected ${fmtMoney(forecastVsActual.projectedCash)} vs actual ${fmtMoney(forecastVsActual.actualCash)}
       (${forecastVsActual.cashVariancePct != null ? forecastVsActual.cashVariancePct.toFixed(1) + '%' : 'n/a'} variance)</p>`
    : `<p><b>Forecast vs. actual:</b> no matching forecast found for this month yet.</p>`

  return `
    <h2>Annie — Monthly Digest: ${esc(monthLabel)}</h2>
    <h3>P&amp;L / Balance Sheet</h3>
    <ul>${li(narrativeLines)}</ul>
    ${forecastSection}
    <h3>Top Opportunities</h3>
    <ul>${topOpportunities.length ? li(topOpportunities.map(i => i.title)) : '<li>None this month.</li>'}</ul>
    <h3>Top Spend-Cut Ideas</h3>
    <ul>${topSpendCuts.length ? li(topSpendCuts.map(i => i.title)) : '<li>None this month.</li>'}</ul>
  `.trim()
}

// gmail.js has no importable send function — only its own POST handler — so
// this follows the same internal-fetch convention the ledger crons use.
async function sendDigestEmail({ host, to, subject, htmlBody, textBody }) {
  const r = await fetch(`https://${host}/api/gmail`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'send', to_email: to, subject, body: textBody, htmlBody }),
  })
  return r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
}

async function deliverMonthlyDigest(content, { dryRun = true, host, recipientOverride } = {}) {
  const to = recipientOverride || process.env.ANNIE_DIGEST_EMAIL_TO
  let sendResult
  if (dryRun) {
    sendResult = { ok: true, skipped: true, reason: 'dry run — not sent' }
  } else if (!to) {
    sendResult = { ok: false, skipped: true, reason: 'ANNIE_DIGEST_EMAIL_TO not configured' }
  } else {
    sendResult = await sendDigestEmail({
      host, to, subject: `Annie — Monthly Digest: ${content.monthLabel}`, htmlBody: content.html, textBody: content.text,
    })
  }
  return { channel: to || null, method: 'EMAIL', sendResult }
}

export async function runMonthlyDigest({ dryRun = true, host, recipientOverride } = {}) {
  const dup = !dryRun ? await alreadySentRecently('MONTHLY', DUPLICATE_SEND_LOOKBACK_HOURS) : null
  if (dup) return { ok: true, skipped: true, reason: `MONTHLY digest already sent at ${dup.sentAt.toISOString()}` }

  const content  = await buildMonthlyDigestContent({ dryRun })
  const delivery = await deliverMonthlyDigest(content, { dryRun, host, recipientOverride })
  const shownInsightIds = [...content.topOpportunities.map(i => i.id), ...content.topSpendCuts.map(i => i.id)]

  let logRow = null
  if (!dryRun) {
    if (shownInsightIds.length) {
      await prisma.insight.updateMany({ where: { id: { in: shownInsightIds } }, data: { surfacedIn: 'DIGEST_MONTHLY' } }).catch(() => {})
    }
    logRow = await prisma.digestLog.create({
      data: { digestType: 'MONTHLY', channel: delivery.method, insightIds: shownInsightIds, snapshotId: content.snapshotId },
    }).catch(e => { console.error('[annie/digest] DigestLog write failed:', e.message); return null })
  }

  return { ok: true, dryRun, content, delivery, digestLogId: logRow?.id || null }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { task = 'weekly', dryRun = true, channel, recipient } = req.body || {}
  const host = req.headers.host

  try {
    if (task === 'monthly') {
      const result = await runMonthlyDigest({ dryRun, host, recipientOverride: recipient })
      return res.json(result)
    }
    const result = await runWeeklyDigest({ dryRun, channelOverride: channel })
    return res.json(result)
  } catch (err) {
    console.error('[annie/digest]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
