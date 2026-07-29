/**
 * Annie — ST1's financial analyst agent.
 *
 * Four capabilities:
 *   forecast — revenue/cash projections over a horizon, with assumptions surfaced
 *              (backed by the Forecast model — see prisma/schema.prisma)
 *   health   — a plain-English read on business health (margin, cash, AR/AP
 *              exposure, pipeline coverage) from the latest FinancialSnapshot
 *   digest   — the weekly/monthly rollup: what changed, what needs attention
 *              (mirrors what DigestLog records as sent to Slack/email)
 *   ask      — free-form Q&A over cached FinancialSnapshot/Forecast/Insight data.
 *              Answers from the cache first; only pulls a live Zoho number when
 *              the cache is stale or the question needs something not cached.
 *
 * Annie is read-only — she never writes to Zoho or sends anything. She reports;
 * a human acts (often by handing off to Ledger for the actual invoice/reconcile
 * work once Annie has flagged what needs doing).
 *
 * Client-side definition only. Real work runs server-side, one file per
 * capability: api/agents/annie/forecast.js (forecast), api/agents/annie/ask.js
 * (health + ask — same endpoint, distinguished by a "mode" field), and
 * api/agents/annie/digest.js (digest). api/agents/annie/aggregate.js and
 * insights.js do the underlying data-gathering/analysis those endpoints call
 * into but aren't hit directly from chat.
 */
export default {
  id:           'annie',
  name:         'Annie',
  capabilities: ['forecast', 'health', 'digest', 'ask'],
  type:         'agent',
  roles:        ['admin', 'manager'],   // financial analysis — not exposed to sales_rep
  enabled:      true,

  description:
    'ST1\'s financial analyst. Projects revenue and cash over a chosen horizon ' +
    '(capability: forecast — "forecast the next 3 months"). Gives a plain-English ' +
    'read on overall business health from margin, cash, AR/AP exposure, and pipeline ' +
    'coverage (capability: health — "how are we doing financially?"). Produces the ' +
    'weekly/monthly rollup of what changed and what needs attention (capability: ' +
    'digest — "give me this week\'s digest"). Answers free-form financial questions ' +
    'from cached snapshots/forecasts/insights, falling back to a live Zoho pull only ' +
    'when the cache is stale or the question needs a fresh number (capability: ask — ' +
    '"what\'s our gross margin this month?", "which customers are chronically late?"). ' +
    'Annie only reports — she never writes to Zoho or sends anything herself.',

  dataSources: ['financial_snapshot', 'forecast', 'insight', 'zoho_books', 'agent_memory'],

  guardrails: {
    sideEffects:      false,           // analysis and reporting only, no writes
    requiresApproval: false,
    cachePolicy:      'prefer_cache',  // ask answers from FinancialSnapshot/Forecast/Insight
                                       // first; live Zoho pull only when stale or uncached
  },

  async handler(task, input = {}) {
    const serverTask =
      input.task ||
      (/forecast|project|next\s+\d+\s*(month|quarter|week)/i.test(task) ? 'forecast' :
       /digest|weekly (summary|report|digest)|monthly (summary|report|digest)/i.test(task) ? 'digest' :
       /health|how('?s| is| are) (the |our )?(business|financials?|we)\b|financial health/i.test(task) ? 'health' :
       'ask')

    if (serverTask === 'forecast') {
      const r = await fetch('/api/agents/annie/forecast', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task: 'forecast', horizonMonths: input.horizonMonths || 3, dryRun: input.dryRun ?? true }),
      })
      if (!r.ok) throw new Error(`Annie ${r.status}: ${await r.text().catch(() => '')}`)
      const d = await r.json()
      const closeRatePct = Math.round((d.assumptions?.closeRate?.used ?? 0) * 100)
      const output =
        `${d.horizonMonths}-month forecast (close rate ${closeRatePct}%, gross margin ${d.assumptions?.grossMarginPct ?? 'n/a'}%). ` +
        `Projected revenue by month: ${JSON.stringify(d.projectedRevenue)}. Projected cash by month: ${JSON.stringify(d.projectedCash)}.`
      return { output, metadata: d }
    }

    if (serverTask === 'digest') {
      const isMonthly = /month/i.test(task)
      const r = await fetch('/api/agents/annie/digest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          task: isMonthly ? 'monthly' : 'weekly', dryRun: input.dryRun ?? true,
          channel: input.channel, recipient: input.recipient,
        }),
      })
      if (!r.ok) throw new Error(`Annie ${r.status}: ${await r.text().catch(() => '')}`)
      const d = await r.json()
      const output = d.skipped ? d.reason : (d.content?.text || 'Digest generated.')
      return { output, metadata: d }
    }

    // health + ask both answer via the same endpoint, distinguished by "mode" —
    // there's no separate free-form-Q&A file, ask.js handles both.
    const r = await fetch('/api/agents/annie/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: serverTask === 'health' ? 'health' : 'ask', question: task, forceLive: input.forceLive }),
    })
    if (!r.ok) throw new Error(`Annie ${r.status}: ${await r.text().catch(() => '')}`)
    const d = await r.json()
    // d.metadata.usedLivePull is true when the cache was stale/insufficient and
    // Annie pulled a fresh number from Zoho instead of answering from cache.
    return { output: d.output, metadata: d.metadata || {} }
  },
}
