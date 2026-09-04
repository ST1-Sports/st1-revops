/**
 * Shared Slack sender — chat.postMessage via bot token,
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

const MEM = (key) => ({ scope_entity_key: { scope: 'org', entity: 'slack', key } })

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

export function isSlackWebhookUrl(url) {
  return typeof url === 'string' && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url.trim())
}

export function failedBradSlackRows(rows) {
  return (rows || []).filter(r => (r?.output?.slack || '') !== 'sent')
}

/** Prefer webhook when the bot cannot chat.postMessage. */
export function preferWebhookFirst(canChatPost, webhookUrl) {
  return !!(webhookUrl && canChatPost !== true)
}

async function memGet(key) {
  const row = await prisma.agentMemory.findUnique({ where: MEM(key) }).catch(() => null)
  return (row?.value || '').trim()
}

async function memSet(key, value) {
  await prisma.agentMemory.upsert({
    where: MEM(key),
    update: { value, updatedAt: new Date() },
    create: { scope: 'org', entity: 'slack', key, value, agentId: 'slack', confidence: 1 },
  })
}

export async function loadSlackWebhook() {
  const fromEnv = process.env.BRAD_REPLY_SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL
  if (fromEnv) return fromEnv.trim()
  return memGet('webhook_url')
}

export async function loadSlackBotToken() {
  const saved = await memGet('bot_token')
  return saved || (process.env.SLACK_BOT_TOKEN || '').trim()
}

export async function saveSlackBotToken(token) {
  const trimmed = String(token || '').trim()
  if (!trimmed.startsWith('xoxb-')) return { ok: false, error: 'Not a Slack bot token' }
  await memSet('bot_token', trimmed)
  await memSet('can_chat_post', 'unknown')
  return { ok: true }
}

export async function loadCanChatPost() {
  const v = await memGet('can_chat_post')
  if (v === 'yes') return true
  if (v === 'no') return false
  return null
}

export async function saveCanChatPost(can) {
  await memSet('can_chat_post', can === true ? 'yes' : can === false ? 'no' : 'unknown')
}

export async function saveSlackWebhook(url) {
  const trimmed = (url || '').trim()
  if (!isSlackWebhookUrl(trimmed)) {
    return { ok: false, error: 'Paste a Slack incoming webhook URL (https://hooks.slack.com/services/…)' }
  }
  await memSet('webhook_url', trimmed)
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text }),
  })
  const body = await r.text().catch(() => '')
  if (!r.ok || (body && body !== 'ok')) {
    return { ok: false, error: body || `webhook ${r.status}` }
  }
  return { ok: true, channel: 'webhook' }
}

async function joinSlackChannel(token, channel) {
  const r = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel }),
  })
  return r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
}

export async function postSlackMessage({ channel, text, blocks } = {}) {
  const token = await loadSlackBotToken()
  if (!token || !channel) {
    return { ok: false, skipped: true, reason: 'SLACK_BOT_TOKEN or channel not configured' }
  }
  const post = async () => {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
    })
    return r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
  }
  let data = await post()
  if (!data.ok && data.error === 'not_in_channel') {
    const joined = await joinSlackChannel(token, channel)
    if (joined.ok) data = await post()
  }
  if (!data.ok && data.error === 'missing_scope') await saveCanChatPost(false)
  if (data.ok) await saveCanChatPost(true)
  if (!data.ok) console.warn('[slack] send failed:', formatSlackError(data))
  return data
}

/**
 * Incoming webhook first when the bot cannot chat.postMessage (production
 * token only has incoming-webhook). Then try API channels.
 */
export async function sendSlackText({ channel, text, blocks, channels } = {}) {
  const tried = []
  const webhook = await loadSlackWebhook()
  const canPost = await loadCanChatPost()

  if (preferWebhookFirst(canPost, webhook)) {
    const result = await postSlackWebhook(webhook, text)
    if (result.ok) return { ok: true, channel: 'webhook', via: 'webhook' }
    tried.push(`webhook: ${formatSlackError(result)}`)
  }

  const list = [...new Set((channels?.length ? channels : [channel]).filter(Boolean))]
  for (const ch of list) {
    const result = await postSlackMessage({ channel: ch, text, blocks })
    if (result.ok) return { ok: true, channel: ch, via: 'api' }
    tried.push(`${ch}: ${formatSlackError(result)}`)
    if (result.skipped || isSlackTokenError(result)) break
  }

  if (webhook && !tried.some(t => t.startsWith('webhook:'))) {
    const result = await postSlackWebhook(webhook, text)
    if (result.ok) return { ok: true, channel: 'webhook', via: 'webhook' }
    tried.push(`webhook: ${formatSlackError(result)}`)
  } else if (!webhook && tried.some(t => t.includes('missing_scope'))) {
    tried.push('webhook: not configured — paste the Incoming Webhook URL on Brad or Integrations → Slack')
  }
  return { ok: false, error: tried.join(' | ') || 'no Slack channel configured' }
}
