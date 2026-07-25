/**
 * POST /api/agents/brad
 * { task: string, input?: { contactId?, minScore?, dryRun? } }
 *
 * Brad: ST1's SDR agent. Researches leads, drafts personalized outreach, and
 * queues touches for human approval. Nothing sends without an explicit human click.
 *
 * Guardrails (all enforced server-side, default-safe):
 *   BRAD_SENDING_ENABLED  — default false (draft-only mode until explicitly enabled)
 *   BRAD_DRY_RUN          — simulate without writing interaction logs
 *   BRAD_DAILY_TOUCH_CAP  — default 25 draft touches per day
 *   14-day re-touch rule  — no same contact within 14 days
 *   DNC check             — skip status=unsubscribed or notes containing "dnc"
 */
import { setCors }                              from '../_lib/cors.js'
import { prisma }                               from '../_lib/prisma.js'
import { logInteraction, countActions }         from '../_lib/memory.js'

const API_KEY   = process.env.ANTHROPIC_KEY
const _cap = parseInt(process.env.BRAD_DAILY_TOUCH_CAP || '25', 10)
const FLAGS = {
  sendingEnabled: process.env.BRAD_SENDING_ENABLED === 'true',
  dryRun:         process.env.BRAD_DRY_RUN         === 'true',
  dailyCap:       Number.isFinite(_cap) ? _cap : 25,
}
const RETOUCH_MS = 14 * 24 * 60 * 60 * 1000

const ST1_VOICE =
  'ST1 Sports | Owner: Matt Stone | matt@st1sports.com | 719-256-0275 | st1sports.com\n' +
  'Tone: warm, direct, first-person, athlete-aware. Never corporate.\n' +
  'Lead with their program, not our product. Under 120 words per email.\n' +
  'Never use: "hope this finds you well", "I wanted to reach out", "as per".\n' +
  'Sign every email: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com'

// ── Contact loading ───────────────────────────────────────────────────────────

async function loadContacts(input = {}) {
  const where = { NOT: { status: 'unsubscribed' } }
  if (input.contactId) where.id = input.contactId
  if (input.minScore != null) where.score = { gte: Number(input.minScore) }

  return prisma.salesContact.findMany({
    where,
    orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
    take:    30,
    include: { activities: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
}

// ── Guardrail gate ────────────────────────────────────────────────────────────

async function applyGuardrails(contacts, isDryRun) {
  const cutoff = new Date(Date.now() - RETOUCH_MS)

  const [dailyUsed, recentRows] = await Promise.all([
    countActions({ agentId: 'brad', action: 'outreach', sinceMs: 24 * 60 * 60 * 1000 }),
    prisma.agentInteraction.findMany({
      where: {
        agentId:   'brad',
        action:    'outreach',
        entity:    { in: contacts.map(c => `contact:${c.id}`) },
        createdAt: { gte: cutoff },
        dryRun:    false,
        blockedBy: null,
      },
      select: { entity: true },
    }),
  ])

  const recentSet = new Set(recentRows.map(r => r.entity))
  const allowed   = []
  const skipped   = []
  let   remaining = FLAGS.dailyCap - dailyUsed

  for (const contact of contacts) {
    const isDnc    = contact.status === 'unsubscribed' ||
                     contact.notes?.toLowerCase().includes('dnc')
    const isRecent = recentSet.has(`contact:${contact.id}`)
    const atCap    = remaining <= 0

    if (isDnc)    { skipped.push({ contact, blockedBy: 'dnc' });         continue }
    if (isRecent) { skipped.push({ contact, blockedBy: '14d_retouch' }); continue }
    if (atCap)    { skipped.push({ contact, blockedBy: 'daily_cap' });   continue }

    allowed.push(contact)
    if (!isDryRun) remaining--
  }

  return { allowed, skipped, dailyUsed, remaining: Math.max(0, FLAGS.dailyCap - dailyUsed) }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystem(contacts, guardrailStatus) {
  const contactBlock = contacts.length
    ? contacts.map(c => {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'
        let line = `  • [${c.id}] ${name}`
        if (c.title)       line += ` — ${c.title}`
        if (c.companyName) line += ` @ ${c.companyName}`
        line += `\n    email: ${c.email}`
        if (c.phone)       line += ` | phone: ${c.phone}`
        line += ` | score: ${c.score} | segment: ${c.segment}`
        if (c.notes)       line += `\n    notes: ${c.notes}`
        if (c.activities?.[0]) {
          const a = c.activities[0]
          line += `\n    last touch: ${a.type} on ${new Date(a.createdAt).toLocaleDateString()}`
        }
        return line
      }).join('\n\n')
    : '  (no eligible contacts — all cleared contacts shown)'

  return `You are Brad, ST1 Sports's SDR agent. You research leads and draft outreach. You never send — every draft requires human approval.

${ST1_VOICE}

=== GUARDRAIL STATUS ===
${guardrailStatus}

=== ELIGIBLE CONTACTS (passed all guardrail checks) ===
${contactBlock}

=== TASK ===
Review the contacts and the task below. Draft personalized first-touch emails for the most relevant contacts. Use their actual name, school, and any profile details — never placeholders.

=== OUTPUT FORMAT — return valid JSON only ===
{
  "summary": "1-2 sentence summary of what you're proposing and why",
  "drafts": [
    {
      "contactId": "DB id from the contact list above",
      "contactName": "full name",
      "contactEmail": "email address",
      "contactSchool": "school or org name",
      "subject": "email subject line — specific, not generic",
      "body": "complete email body, signed with ST1 footer, under 120 words",
      "notes": "1 sentence on why this contact is a good target right now"
    }
  ],
  "recommendations": ["optional follow-up suggestions for Matt"]
}`
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  if (!API_KEY)                return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })

  const { task, input = {} } = req.body || {}
  if (!task) return res.status(400).json({ error: 'task is required' })

  const isDryRun = FLAGS.dryRun || input.dryRun === true

  try {
    const contacts                                   = await loadContacts(input)
    const { allowed, skipped, dailyUsed, remaining } = await applyGuardrails(contacts, isDryRun)

    // Build guardrail status string for the prompt
    const guardrailStatus = [
      `Sending enabled: ${FLAGS.sendingEnabled ? 'YES' : 'NO — draft-only mode'}`,
      `Dry run: ${isDryRun ? 'YES' : 'NO'}`,
      `Daily cap: ${dailyUsed}/${FLAGS.dailyCap} used today (${remaining} remaining)`,
      skipped.length
        ? `Skipped contacts: ${skipped.map(s => `${s.contact.email} [${s.blockedBy}]`).join(', ')}`
        : '',
    ].filter(Boolean).join('\n')

    if (allowed.length === 0) {
      const blockedBy = skipped[0]?.blockedBy || 'no_contacts'
      return res.json({
        output:   skipped.length
          ? `All contacts blocked: ${[...new Set(skipped.map(s => s.blockedBy))].join(', ')}`
          : 'No eligible contacts found for this request.',
        metadata: {
          drafts:     [],
          skipped,
          guardrails: { ...FLAGS, dailyUsed, remaining },
          blockedBy,
        },
      })
    }

    // Call Claude with cleared contacts
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25_000)
    let claudeData
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
          max_tokens: 2500,
          system:     buildSystem(allowed, guardrailStatus),
          messages:   [{ role: 'user', content: task }],
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`Anthropic ${r.status}: ${txt.slice(0, 200)}`)
      }
      claudeData = await r.json()
    } finally {
      clearTimeout(timer)
    }

    const raw = (claudeData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    let parsed = null
    try {
      const m = raw.match(/\{[\s\S]*\}/s)
      if (m) parsed = JSON.parse(m[0])
    } catch {}

    if (!parsed) {
      return res.json({ output: raw, metadata: { drafts: [], skipped, guardrails: FLAGS } })
    }

    const drafts = (parsed.drafts || []).map(d => ({
      ...d,
      requiresApproval: true,
      sendingEnabled:   FLAGS.sendingEnabled,
      dryRun:           isDryRun,
    }))

    // Log each drafted touch — creates the re-touch barrier for the next 14 days
    if (!isDryRun) {
      for (const draft of drafts) {
        logInteraction({
          agentId: 'brad',
          action:  'outreach',
          entity:  draft.contactId ? `contact:${draft.contactId}` : null,
          input:   { task, contactEmail: draft.contactEmail },
          output:  { subject: draft.subject, bodyLength: draft.body?.length ?? 0 },
          outcome: 'pending',
          dryRun:  false,
        }).catch(() => {})
      }
    }

    return res.json({
      output:   parsed.summary || raw,
      metadata: {
        drafts,
        skipped,
        recommendations: parsed.recommendations || [],
        guardrails:      { ...FLAGS, dailyUsed, remaining, isDryRun },
      },
    })

  } catch (err) {
    console.error('[agents/brad]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
