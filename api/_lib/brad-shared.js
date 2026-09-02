/**
 * Shared helpers for Brad email intent processing.
 * Used by api/cron/brad-inbox.js and api/inbound-email.js.
 */
import { prisma } from './prisma.js'
import { sendSlackText } from './slack.js'

export async function classifyEmailIntent(subject, bodyText) {
  const apiKey = process.env.ANTHROPIC_KEY
  if (!apiKey) return 'PASS'
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system:     'Classify this email reply. Reply with only the word INTENT if the person shows genuine interest, asks a question, or wants to learn more. Reply with only PASS for out-of-office, unsubscribes, bounces, or rejections.',
        messages:   [{ role: 'user', content: `Subject: ${subject}\n\n${(bodyText || '').slice(0, 600)}` }],
      }),
    })
    const d = await r.json()
    const text = (d.content?.[0]?.text || '').trim().toUpperCase()
    if (text.startsWith('INTENT') || /\bINTENT\b/.test(text)) return 'INTENT'
    return 'PASS'
  } catch {
    return 'PASS'
  }
}

export async function pickRep() {
  const repRaw  = process.env.BRAD_ASSIGN_REPS || 'Matt Stone:matt@st1sports.com'
  const repList = repRaw.split(',').map(entry => {
    const [name, email] = entry.trim().split(':')
    return { name: (name || '').trim(), email: (email || '').trim().toLowerCase() }
  }).filter(r => r.email)

  const lastMem = await prisma.agentMemory.findUnique({
    where: { scope_entity_key: { scope: 'org', entity: 'brad', key: 'last_assigned_rep' } },
  }).catch(() => null)

  if (!repList.length) return { name: 'Matt Stone', email: 'matt@st1sports.com' }
  const lastIdx  = lastMem ? repList.findIndex(r => r.email === lastMem.value) : -1
  const nextIdx  = (lastIdx + 1) % repList.length
  const assigned = repList[nextIdx]

  await prisma.agentMemory.upsert({
    where:  { scope_entity_key: { scope: 'org', entity: 'brad', key: 'last_assigned_rep' } },
    update: { value: assigned.email, updatedAt: new Date() },
    create: { scope: 'org', entity: 'brad', key: 'last_assigned_rep', value: assigned.email, agentId: 'brad', confidence: 1 },
  }).catch(() => {})

  return assigned
}

function bradSlackChannels() {
  return [...new Set([
    process.env.BRAD_REPLY_SLACK_CHANNEL,
    process.env.SLACK_CHANNEL,
    process.env.SLACK_ALERT_CHANNEL,
    'C0AQ7CMB01X',   // #sales
    'C09F64RK0MN',   // #all-st1-sports
  ].filter(Boolean))]
}

export async function notifyBradSlack(assigned, contactName, fromEmail, subject, bodyText) {
  const text = `🔥 *Brad got a positive reply — assigned to ${assigned.name}*\n*From:* ${contactName} (${fromEmail})\n*Subject:* ${subject}\n\n_"${(bodyText || '').slice(0, 200)}${(bodyText || '').length > 200 ? '…' : ''}"_`
  const result = await sendSlackText({ channels: bradSlackChannels(), text })
  if (!result.ok) console.warn('[brad] slack notify failed:', result.error)
  return result
}

async function sendNotifyGmail({ to, subject, body }) {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refresh = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refresh) {
    return { ok: false, error: 'Gmail not configured' }
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }).toString(),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) return { ok: false, error: 'Gmail token refresh failed' }

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n')
  const encoded = Buffer.from(raw).toString('base64url')
  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  })
  const sendData = await sendRes.json().catch(() => ({}))
  if (!sendRes.ok) return { ok: false, error: sendData.error?.message || `Gmail ${sendRes.status}` }
  return { ok: true }
}

export async function notifyBradEmail(_host, assigned, contactName, fromEmail, subject, bodyText) {
  const notifyEmail = process.env.BRAD_REPLY_NOTIFY_EMAIL || assigned?.email || 'matt@st1sports.com'
  const body = [
    `Brad received a positive reply.`,
    ``,
    `Assigned to: ${assigned.name || assigned.email || 'Matt Stone'} <${assigned.email || notifyEmail}>`,
    `From: ${contactName} <${fromEmail}>`,
    `Subject: ${subject}`,
    ``,
    `Reply snippet:`,
    (bodyText || '').slice(0, 800),
    ``,
    `Open RevOps -> Prospecting -> Brad to handle this reply.`,
  ].join('\n')
  try {
    const result = await sendNotifyGmail({
      to: notifyEmail,
      subject: `Brad reply needs follow-up: ${contactName}`,
      body,
    })
    if (!result.ok) console.warn('[brad] email notify failed:', result.error)
    return result
  } catch (err) {
    console.warn('[brad] email notify failed:', err.message)
    return { ok: false, error: err.message }
  }
}

export function parseAddr(raw = '') {
  const m = raw.match(/^(.+?)\s*<([^>]+)>/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() }
  return { name: null, email: raw.split(',')[0].trim().toLowerCase() }
}

/**
 * Push a contact who just replied into Zoho as a Lead. Fire-and-forget.
 *
 * A reply is engagement, not a sale — it should not create a real Account+
 * Contact by itself. That promotion only happens later, when an actual quote
 * or deal gets built for them (api/contacts/promote.js's createAsContact
 * path, triggered from Edgar's "Create in Zoho" flow) — a real, deliberate
 * next step, not an automatic reaction to any reply classified as intent.
 */
export async function promoteContactToZoho(host, contactId) {
  if (!host) return
  await fetch(`https://${host}/api/contacts/promote`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ contactId }),
  }).catch(() => {})
}
