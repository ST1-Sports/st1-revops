/**
 * POST /api/agents/annie/ask
 * { mode?: "ask"|"health", question?: string, forceLive?: boolean }
 *
 * Annie's free-form Q&A + on-demand health-summary endpoint — the "ask" and
 * "health" capabilities described in src/lib/agents/annie.js (Session 2) but
 * never actually built until now. Both modes share the same context-gathering
 * and Claude-composition logic; only the system prompt/user-facing framing
 * differs.
 *
 * Cache-first, matching Annie's guardrails (cachePolicy: 'prefer_cache',
 * sideEffects: false): reads the latest FinancialSnapshot/Forecast/Insight
 * rows first. Falls back to a live (dry-run — never writes) Zoho pull via
 * aggregate.js's aggregateSnapshot() only when that snapshot is stale
 * (> STALE_AFTER_DAYS old, or missing) or the question itself asks for
 * something current ("today", "right now", "latest", etc.) — mirroring the
 * exact fallback condition described in Annie's own docstring.
 *
 * mode: "ask"    — answers req.body.question directly from the data.
 * mode: "health" — ignores the question (if any) and gives a general
 *                  financial-health read: margin, cash, AR/AP exposure, pipeline.
 *
 * Every call is logged via logInteraction (agentId: 'annie') so Annie's
 * activity shows up in the same AgentInteraction trail Edgar/Ledger use —
 * this is what lets other agents (and a human) see "what Annie's been asked"
 * without a dedicated Annie UI.
 *
 * Never writes anything (no Insight/FinancialSnapshot/Forecast rows created
 * here) — this endpoint only reads and reasons over existing data.
 *
 * NOTE: no live Zoho/DB access from this sandbox — this has never actually run.
 */

import { setCors }   from '../../_lib/cors.js'
import { prisma }    from '../../_lib/prisma.js'
import { logInteraction } from '../../_lib/memory.js'
import { aggregateSnapshot } from './aggregate.js'

const API_KEY = process.env.ANTHROPIC_KEY
const STALE_AFTER_DAYS = 8 // weekly cadence + a few days' slack before treating cache as stale

const fmtMoney = n => n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function isStale(snapshot) {
  if (!snapshot) return true
  const ageDays = (Date.now() - new Date(snapshot.snapshotDate).getTime()) / 86_400_000
  return ageDays > STALE_AFTER_DAYS
}

function needsFreshNumber(question) {
  return /\btoday\b|\bright now\b|\bcurrent(ly)?\b|\blatest\b|\bas of (today|now)\b|\bthis (morning|moment)\b/i.test(question || '')
}

async function gatherContext({ question, forceLive = false } = {}) {
  let snapshot = await prisma.financialSnapshot.findFirst({
    where: { periodType: 'WEEKLY' }, orderBy: { snapshotDate: 'desc' },
  }).catch(() => null)

  let usedLivePull = false
  if (forceLive || isStale(snapshot) || needsFreshNumber(question)) {
    // dryRun: true — Annie never writes; this only pulls fresh numbers to answer with.
    const live = await aggregateSnapshot({ periodType: 'WEEKLY', dryRun: true }).catch(() => null)
    if (live?.snapshot) { snapshot = live.snapshot; usedLivePull = true }
  }

  const [forecast, recentInsights] = await Promise.all([
    prisma.forecast.findFirst({ orderBy: { forecastDate: 'desc' } }).catch(() => null),
    prisma.insight.findMany({ where: { status: { not: 'DISMISSED' } }, orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []),
  ])

  return { snapshot, forecast, recentInsights, usedLivePull }
}

function buildContextBlock({ snapshot, forecast, recentInsights }) {
  const lines = []
  if (snapshot) {
    lines.push(`Snapshot (${snapshot.periodType}, as of ${new Date(snapshot.snapshotDate).toISOString().slice(0, 10)}):`)
    lines.push(`  Revenue: ${fmtMoney(snapshot.revenueTotal)}, COGS: ${fmtMoney(snapshot.cogsTotal)}, Gross margin: ${snapshot.grossMargin ?? 'n/a'}%`)
    lines.push(`  Cash: ${fmtMoney(snapshot.cashPosition)}, AR: ${fmtMoney(snapshot.arTotal)} (overdue ${fmtMoney(snapshot.arOverdue)}), AP: ${fmtMoney(snapshot.apTotal)}`)
    lines.push(`  Open pipeline: ${fmtMoney(snapshot.pipelineValue)}`)
  } else {
    lines.push('No FinancialSnapshot available yet.')
  }

  if (forecast) {
    lines.push('', `Latest forecast (${forecast.horizonMonths}mo, method ${forecast.method}):`)
    lines.push(`  Projected revenue by month: ${JSON.stringify(forecast.projectedRevenue)}`)
    lines.push(`  Projected cash by month: ${JSON.stringify(forecast.projectedCash)}`)
  }

  if (recentInsights.length) {
    lines.push('', 'Recent insights (most recent first):')
    for (const i of recentInsights) lines.push(`  [${i.category}] ${i.title}`)
  }

  return lines.join('\n')
}

async function askClaude({ question, mode, contextBlock }) {
  const system = mode === 'health'
    ? 'You are Annie, ST1 Sports\'s financial analyst agent. Give a concise (4-6 sentence) ' +
      'plain-English financial health read from the data below — margin trend, cash position, ' +
      'AR/AP exposure, pipeline coverage. Be direct about what needs attention, not just a status recap. ' +
      'If the data is missing or thin, say so rather than guessing.'
    : 'You are Annie, ST1 Sports\'s financial analyst agent. Answer the question using only the ' +
      'data below. If the data doesn\'t contain the answer, say so plainly rather than guessing.'

  const userMsg = mode === 'health'
    ? `Financial data:\n${contextBlock}\n\nGive the financial health read.`
    : `Financial data:\n${contextBlock}\n\nQuestion: ${question}`

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25_000)
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
        max_tokens: 800,
        system,
        messages:   [{ role: 'user', content: userMsg }],
      }),
    })
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  } finally {
    clearTimeout(timer)
  }
}

export async function answerQuestion({ mode = 'ask', question = '', forceLive = false } = {}) {
  const { snapshot, forecast, recentInsights, usedLivePull } = await gatherContext({ question, forceLive })
  const contextBlock = buildContextBlock({ snapshot, forecast, recentInsights })
  const answer = await askClaude({ question, mode, contextBlock })

  logInteraction({
    agentId: 'annie',
    action:  mode,
    entity:  null,
    input:   { question },
    output:  { usedLivePull, snapshotDate: snapshot?.snapshotDate || null, insightCount: recentInsights.length },
    outcome: 'pending',
  }).catch(() => {})

  return {
    ok: true, mode, output: answer,
    metadata: {
      usedLivePull,
      snapshotDate:       snapshot?.snapshotDate || null,
      insightsConsidered: recentInsights.length,
      forecastId:         forecast?.id || null,
    },
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  if (!API_KEY)                return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })

  const { mode = 'ask', question = '', forceLive = false } = req.body || {}

  try {
    const result = await answerQuestion({ mode: mode === 'health' ? 'health' : 'ask', question, forceLive })
    return res.json(result)
  } catch (err) {
    console.error('[annie/ask]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
