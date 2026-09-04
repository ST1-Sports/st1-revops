/**
 * /api/cron/brad-inbox
 *
 * Polls brad@shopst1sports.com's Gmail inbox for unread messages.
 * For each unread message from a known SalesContact, classifies intent
 * with Claude and, on positive intent, assigns to a rep + promotes to Zoho.
 *
 * Runs automatically every 10 minutes via Vercel cron.
 * Can also be triggered manually from the Brad tab.
 *
 * Env vars required:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN_BRAD
 *   ANTHROPIC_KEY
 *   BRAD_ASSIGN_REPS  — "Matt Stone:matt@st1sports.com,Josh:josh@st1sports.com"
 *   SLACK_BOT_TOKEN (needs chat:write) or SLACK_WEBHOOK_URL / saved incoming webhook
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { classifyEmailIntent, pickRep, notifyBradSlack, notifyBradEmail, parseAddr, promoteContactToZoho } from '../_lib/brad-shared.js'
import { replayFailedBradSlack, canSendBradSlack } from '../_lib/bradSlackReplay.js'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

// ── Gmail token for Brad ──────────────────────────────────────────────────────
let _cached = null
async function getBradToken() {
  if (_cached && Date.now() < _cached.expiry - 60_000) return _cached.token

  const refreshToken = process.env.GMAIL_REFRESH_TOKEN_BRAD
  if (!refreshToken) throw new Error('GMAIL_REFRESH_TOKEN_BRAD not set')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }).toString(),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Brad Gmail token refresh failed')
  _cached = { token: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 }
  return _cached.token
}


// ── Main inbox poll ───────────────────────────────────────────────────────────
async function pollInbox(host) {
  const token = await getBradToken()
  const auth  = { Authorization: `Bearer ${token}` }

  // List unread messages in inbox (skip sent by Brad himself)
  const listRes = await fetch(
    `${GMAIL_BASE}/messages?q=is:unread in:inbox -from:brad@shopst1sports.com&maxResults=20`,
    { headers: auth }
  )
  const listData = await listRes.json()
  const messages = listData.messages || []
  if (!messages.length) return { checked: 0, intents: 0 }

  // Load already-processed Gmail message IDs to avoid double-processing
  const processed = await prisma.agentInteraction.findMany({
    where: { agentId: 'brad', action: 'reply_intent' },
    select: { input: true },
  }).then(rows => new Set(rows.map(r => r.input?.gmailMessageId).filter(Boolean)))

  let checked = 0, intents = 0
  // Promote + Slack-notify are independent per contact — collected here and
  // fired together after the loop instead of blocking message-to-message.
  const postActions = []

  for (const msg of messages) {
    if (processed.has(msg.id)) continue

    // Fetch full message
    const msgRes = await fetch(`${GMAIL_BASE}/messages/${msg.id}?format=full`, { headers: auth })
    const full   = await msgRes.json()
    const hdrs   = full.payload?.headers || []
    const getHdr = name => (hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '')

    const from    = parseAddr(getHdr('From'))
    const subject = getHdr('Subject') || '(no subject)'

    // Extract body text
    let bodyText = ''
    const extractText = (payload) => {
      if (payload?.body?.data) {
        try { bodyText += Buffer.from(payload.body.data, 'base64url').toString('utf8') } catch {}
      }
      for (const part of payload?.parts || []) extractText(part)
    }
    extractText(full.payload)
    bodyText = bodyText.slice(0, 600)

    checked++

    const contact = await prisma.salesContact.findUnique({ where: { email: from.email } }).catch(() => null)

    const verdict = await classifyEmailIntent(subject, bodyText)

    await fetch(`${GMAIL_BASE}/messages/${msg.id}/modify`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }).catch(() => {})

    if (verdict !== 'INTENT') continue

    intents++
    const assigned    = await pickRep()
    const contactName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') || from.email
      : (from.name || from.email)

    postActions.push({ contact, assigned, contactName, from, subject, bodyText, gmailMessageId: msg.id })
  }

  // Promote to Zoho (real Account + Contact, not a Lead — a genuine positive
  // reply being handed to a rep) and notify Slack, all in parallel.
  await Promise.all(postActions.map(async pa => {
    const [slack, email] = await Promise.all([
      notifyBradSlack(pa.assigned, pa.contactName, pa.from.email, pa.subject, pa.bodyText),
      notifyBradEmail(host, pa.assigned, pa.contactName, pa.from.email, pa.subject, pa.bodyText),
    ])
    await prisma.agentInteraction.create({
      data: {
        agentId: 'brad',
        action:  'reply_intent',
        entity:  pa.contact ? `contact:${pa.contact.id}` : `email:${pa.from.email}`,
        input:   { fromEmail: pa.from.email, contactName: pa.contactName, subject: pa.subject, snippet: pa.bodyText.slice(0, 300), gmailMessageId: pa.gmailMessageId },
        output:  {
          assignedTo: pa.assigned.email,
          assignedName: pa.assigned.name,
          slack: slack?.ok ? 'sent' : (slack?.error || 'failed'),
          email: email?.ok ? 'sent' : (email?.error || 'failed'),
        },
        outcome: 'pending',
        dryRun:  false,
      },
    }).catch(() => {})
    if (pa.contact && !pa.contact.pushedToZoho) await promoteContactToZoho(host, pa.contact.id)
  }))

  if (await canSendBradSlack()) {
    await replayFailedBradSlack({ limit: 15 }).catch(() => {})
  }

  return { checked, intents }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const result = await pollInbox(req.headers.host)
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[brad-inbox]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
