/**
 * Shared Slack sender — chat.postMessage via SLACK_BOT_TOKEN,
 * with incoming-webhook fallback (the live token currently only has
 * incoming-webhook, which cannot call chat.postMessage).
 */
import { prisma } from './prisma.js'

const TOKEN_LEVEL_ERRORS = new Set([
  'missing_scope',
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'not_authed',
])

export function formatSlackError(result) {
  if (!result) return 'failed'
  if (result.skipped) return result.reason || 'skipped'
  const parts = [result.error || 'failed']
  if (result.needed) parts.push(`needed ${result.needed}`)
  if (result.provided) parts.push(`had ${result.provided}`)
  return parts.join(' — ')
}

export function isSlackTokenError(result) {
  return !!(result && TOKEN_LEVEL_ERRORS.has(result.error))
}

export async function loadSlackWebhook() {
  const fromEnv = process.env.BRAD_REPLY_SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL
  if (fromEnv) return fromEnv.trim()
  const row = await prisma.agentMemory.findUnique({
    where: { scope_entity_key: { scope: 'org', entity: 'slack', key: 'webhook_url' } },
  }).catch(() => null)
  return (row?.value || '').trim()
}

export function isSlackWebhookUrl(url) {
  return typeof url === 'string' && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url.trim())
}

export async function saveSlackWebhook(url) {
  const trimmed = (url || '').trim()
  if (!isSlackWebhookUrl(trimmed)) {
    return { ok: false, error: 'Paste a Slack incoming webhook URL (https://hooks.slack.com/services/…)' }
  }
  await prisma.agentMemory.upsert({
    where:  { scope_entity_key: { scope: 'org', entity: 'slack', key: 'webhook_url' } },
    update: { value: trimmed, updatedAt: new Date() },
    create: { scope: 'org', entity: 'slack', key: 'webhook_url', value: trimmed, agentId: 'slack', confidence: 1 },
  })
  return { ok: true }
}

export async function clearSlackWebhook() {
  await prisma.agentMemory.deleteMany({
    where: { scope: 'org', entity: 'slack', key: 'webhook_url' },
  })
  return { ok: true }
}

export async function postSlackWebhook(url, text) {
  if (!isSlackWebhookUrl(url)) {
    return { ok: false, skipped: true, reason: 'Slack webhook not configured' }
  }
  const r = await fetch(url.trim(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body:    JSON.stringify({ text }),
  })
  const body = await r.text().catch(() => '')
  if (!r.ok || (body && body !== 'ok')) {
    return { ok: false, error: body || `webhook ${r.status}` }
  }
  return { ok: true, channel: 'webhook' }
}

async function joinSlackChannel(token, channel) {
  const r = await fetch('https://slack.com/api/conversations.join', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body:    JSON.stringify({ channel }),
  })
  return r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
}

export async function postSlackMessage({ channel, text, blocks } = {}) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token || !channel) {
    return { ok: false, skipped: true, reason: 'SLACK_BOT_TOKEN or channel not configured' }
  }
  const post = async () => {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body:    JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
    })
    return r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
  }
  let data = await post()
  if (!data.ok && data.error === 'not_in_channel') {
    const joined = await joinSlackChannel(token, channel)
    if (joined.ok) data = await post()
  }
  if (!data.ok) console.warn('[slack] send failed:', formatSlackError(data))
  return data
}

/**
 * Post via chat.postMessage, then the incoming webhook if the bot token
 * cannot write (missing_scope / incoming-webhook-only installs).
 */
export async function sendSlackText({ channel, text, blocks, channels } = {}) {
  const tried = []
  const list = [...new Set((channels?.length ? channels : [channel]).filter(Boolean))]
  for (const ch of list) {
    const result = await postSlackMessage({ channel: ch, text, blocks })
    if (result.ok) return { ok: true, channel: ch, via: 'api' }
    tried.push(`${ch}: ${formatSlackError(result)}`)
    if (result.skipped || isSlackTokenError(result)) break
  }
  const webhook = await loadSlackWebhook()
  if (webhook) {
    const result = await postSlackWebhook(webhook, text)
    if (result.ok) return { ok: true, channel: 'webhook', via: 'webhook' }
    tried.push(`webhook: ${formatSlackError(result)}`)
  } else if (tried.some(t => t.includes('missing_scope'))) {
    tried.push('webhook: not configured — add chat:write and reinstall, or paste the Incoming Webhook URL')
  }
  return { ok: false, error: tried.join(' | ') || 'no Slack channel configured' }
}
