/**
 * /api/cron/brad-inbox
 *
 * Polls every BDR mailbox (each rep's BDR from Settings → My BDR, plus the
 * original brad@shopst1sports.com while no rep has claimed it) for unread
 * messages. Classifies intent with Claude and, on positive intent, assigns
 * the reply to the rep who owns that BDR (unclaimed Brad: BRAD_ASSIGN_REPS
 * rotation) + promotes to Zoho.
 *
 * Runs automatically every 10 minutes via Vercel cron.
 * Can also be triggered manually from the Brad tab.
 *
 * Env vars required:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET (mailboxes connected in Settings → My BDR)
 *   ANTHROPIC_KEY
 *   BRAD_ASSIGN_REPS  — "Matt Stone:matt@st1sports.com,Josh:josh@st1sports.com"
 *   SLACK_BOT_TOKEN (needs chat:write) or SLACK_WEBHOOK_URL / saved incoming webhook
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { classifyEmailIntent, pickRep, notifyBradSlack, parseAddr, promoteContactToZoho } from '../_lib/brad-shared.js'
import { handOffBradReply } from '../_lib/radar/brad.js'
import { replayFailedBradSlack, canSendBradSlack } from '../_lib/bradSlackReplay.js'
import { getGmailAccessToken } from '../_lib/gmailAuth.js'
import { allBdrMailboxes, loadAssignments } from '../_lib/bdr.js'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function ownerAsAssignee(repId) {
  if (!repId) return null
  const row = await prisma.setting.findUnique({ where: { key: 'app_state' } }).catch(() => null)
  const rep = (row?.value?.reps || []).find(r => r?.id === repId)
  return rep?.email ? { name: rep.name || rep.email, email: String(rep.email).toLowerCase() } : null
}

// ── Main inbox poll (one BDR mailbox) ─────────────────────────────────────────
async function pollInbox(host, bdr) {
  const token = await getGmailAccessToken(bdr.gmailKey)
  const auth  = { Authorization: `Bearer ${token}` }

  // List unread messages in inbox (skip ones the BDR sent)
  const listRes = await fetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(`is:unread in:inbox -from:${bdr.email}`)}&maxResults=20`,
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
    const inboundHeaders = {
      'auto-submitted': getHdr('Auto-Submitted'),
      // X-Auto-Response-Suppress is not used: Outlook can set it on ordinary mail.
      'x-autoreply': getHdr('X-Autoreply'),
    }

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

    const verdict = await classifyEmailIntent(subject, bodyText, { fromEmail: from.email, headers: inboundHeaders })

    await fetch(`${GMAIL_BASE}/messages/${msg.id}/modify`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }).catch(() => {})

    if (verdict !== 'INTENT') continue

    intents++
    const assigned    = (await ownerAsAssignee(bdr.repId)) || await pickRep()
    const contactName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') || from.email
      : (from.name || from.email)

    postActions.push({ contact, assigned, contactName, from, subject, bodyText, gmailMessageId: msg.id })
  }

  // Promote to Zoho (real Account + Contact, not a Lead — a genuine positive
  // reply being handed to a rep) and notify Slack, all in parallel.
  await Promise.all(postActions.map(async pa => {
    const [slack, radar] = await Promise.all([
      notifyBradSlack(pa.assigned, pa.contactName, pa.from.email, pa.subject, pa.bodyText, bdr.name),
      handOffBradReply(host, { assigned: pa.assigned, fromEmail: pa.from.email, contactName: pa.contactName, subject: pa.subject, bodyText: pa.bodyText }),
    ])
    await prisma.agentInteraction.create({
      data: {
        agentId: 'brad',
        action:  'reply_intent',
        entity:  pa.contact ? `contact:${pa.contact.id}` : `email:${pa.from.email}`,
        input:   { fromEmail: pa.from.email, contactName: pa.contactName, subject: pa.subject, snippet: pa.bodyText.slice(0, 300), gmailMessageId: pa.gmailMessageId, bdrEmail: bdr.email },
        output:  {
          assignedTo: pa.assigned.email,
          assignedName: pa.assigned.name,
          slack: slack?.ok ? 'sent' : (slack?.error || 'failed'),
          radar: radar?.ok ? radar.followUpItemId : (radar?.error || 'failed'),
          email: radar?.email,
        },
        outcome: 'pending',
        dryRun:  false,
      },
    }).catch(() => {})
    if (pa.contact && !pa.contact.pushedToZoho) await promoteContactToZoho(host, pa.contact.id)
  }))

  return { checked, intents }
}

async function pollAllInboxes(host) {
  const mailboxes = allBdrMailboxes(await loadAssignments())
  const results = []
  let checked = 0, intents = 0
  for (const bdr of mailboxes) {
    try {
      const r = await pollInbox(host, bdr)
      checked += r.checked
      intents += r.intents
      results.push({ mailbox: bdr.email, ...r })
    } catch (err) {
      // One disconnected mailbox must not stop the others being checked.
      console.error(`[brad-inbox] ${bdr.email}:`, err.message)
      results.push({ mailbox: bdr.email, error: err.message })
    }
  }
  if (await canSendBradSlack()) {
    await replayFailedBradSlack({ limit: 15 }).catch(() => {})
  }
  return { checked, intents, mailboxes: results }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  try {
    const result = await pollAllInboxes(req.headers.host)
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[brad-inbox]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
