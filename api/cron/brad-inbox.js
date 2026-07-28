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
 *   SLACK_BOT_TOKEN + BRAD_REPLY_SLACK_CHANNEL  (optional)
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { classifyEmailIntent, pickRep, notifyBradSlack, parseAddr } from '../_lib/brad-shared.js'

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

    // Check if sender is a known prospect
    const contact = await prisma.salesContact.findUnique({ where: { email: from.email } }).catch(() => null)
    if (!contact) {
      // Mark as read and skip — not a Brad prospect
      await fetch(`${GMAIL_BASE}/messages/${msg.id}/modify`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      }).catch(() => {})
      continue
    }

    // Classify intent
    const verdict = await classifyEmailIntent(subject, bodyText)

    // Mark as read regardless
    await fetch(`${GMAIL_BASE}/messages/${msg.id}/modify`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }).catch(() => {})

    if (verdict !== 'INTENT') continue

    intents++
    const assigned    = await pickRep()
    const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || from.email

    // Log the reply
    await prisma.agentInteraction.create({
      data: {
        agentId: 'brad',
        action:  'reply_intent',
        entity:  `contact:${contact.id}`,
        input:   { fromEmail: from.email, contactName, subject, snippet: bodyText.slice(0, 300), gmailMessageId: msg.id },
        output:  { assignedTo: assigned.email, assignedName: assigned.name },
        outcome: 'pending',
        dryRun:  false,
      },
    }).catch(() => {})

    // Promote to Zoho as a real Account + Contact (not a Lead) — this is a
    // genuine positive reply being handed to a rep, not a cold marketing lead.
    if (!contact.pushedToZoho && host) {
      await fetch(`https://${host}/api/contacts/promote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contact.id, createAsContact: true }),
      }).catch(() => {})
    }

    // Slack notification
    await notifyBradSlack(assigned, contactName, from.email, subject, bodyText)
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
