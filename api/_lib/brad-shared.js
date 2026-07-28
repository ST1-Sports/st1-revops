/**
 * Shared helpers for Brad email intent processing.
 * Used by api/cron/brad-inbox.js and api/inbound-email.js.
 */
import { prisma } from './prisma.js'

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
    return (d.content?.[0]?.text || '').trim().toUpperCase()
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

export async function notifyBradSlack(assigned, contactName, fromEmail, subject, bodyText) {
  const slackToken   = process.env.SLACK_BOT_TOKEN
  const slackChannel = process.env.BRAD_REPLY_SLACK_CHANNEL || process.env.SLACK_CHANNEL
  if (!slackToken || !slackChannel) return
  await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${slackToken}` },
    body: JSON.stringify({
      channel: slackChannel,
      text: `🔥 *Brad got a positive reply — assigned to ${assigned.name}*\n*From:* ${contactName} (${fromEmail})\n*Subject:* ${subject}\n\n_"${(bodyText || '').slice(0, 200)}…"_`,
    }),
  }).catch(() => {})
}

export function parseAddr(raw = '') {
  const m = raw.match(/^(.+?)\s*<([^>]+)>/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() }
  return { name: null, email: raw.split(',')[0].trim().toLowerCase() }
}
