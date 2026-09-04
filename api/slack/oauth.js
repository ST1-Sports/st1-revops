/**
 * Slack OAuth reconnect — requests chat:write + incoming-webhook, then
 * stores the new bot token and webhook URL so Brad alerts can post.
 *
 * GET           → redirect to Slack consent
 * GET ?code=    → exchange, save, replay failed Brad Slack alerts
 *
 * Requires SLACK_CLIENT_ID + SLACK_CLIENT_SECRET on Vercel. Add this
 * redirect URL on the Slack app: https://YOUR-HOST/api/slack/oauth
 */
import crypto from 'crypto'
import { setCors } from '../_lib/cors.js'
import { saveSlackBotToken, saveSlackWebhook, isSlackWebhookUrl, saveCanChatPost } from '../_lib/slack.js'
import { replayFailedBradSlack } from '../_lib/bradSlackReplay.js'

function redirectUri(req) {
  if (process.env.SLACK_REDIRECT_URI) return process.env.SLACK_REDIRECT_URI
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  return `${proto}://${host}/api/slack/oauth`
}

function signState(secret) {
  const ts = Date.now().toString()
  const sig = crypto.createHmac('sha256', secret).update(ts).digest('hex').slice(0, 24)
  return `${ts}.${sig}`
}

function checkState(secret, state) {
  const [ts, sig] = String(state || '').split('.')
  if (!ts || !sig) return false
  if (Math.abs(Date.now() - Number(ts)) > 30 * 60 * 1000) return false
  const expect = crypto.createHmac('sha256', secret).update(ts).digest('hex').slice(0, 24)
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
}

function toIntegrations(req, query) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const q = new URLSearchParams(query).toString()
  return `${proto}://${host}/integrations?tab=slack${q ? `&${q}` : ''}`
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return res.redirect(toIntegrations(req, { slack: 'need-app-creds' }))
  }

  const { code, state, error } = req.query || {}
  if (error) return res.redirect(toIntegrations(req, { slack: 'denied' }))

  if (!code) {
    const url = new URL('https://slack.com/oauth/v2/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', 'chat:write,incoming-webhook,channels:join')
    url.searchParams.set('redirect_uri', redirectUri(req))
    url.searchParams.set('state', signState(clientSecret))
    return res.redirect(url.toString())
  }

  if (!checkState(clientSecret, state)) {
    return res.redirect(toIntegrations(req, { slack: 'bad-state' }))
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: redirectUri(req),
    })
    const r = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const d = await r.json()
    if (!d.ok) return res.redirect(toIntegrations(req, { slack: 'oauth-fail' }))

    if (d.access_token) await saveSlackBotToken(d.access_token)
    const hook = d.incoming_webhook?.url
    if (isSlackWebhookUrl(hook)) await saveSlackWebhook(hook)
    if (d.access_token) await saveCanChatPost(null)

    const replay = await replayFailedBradSlack({ limit: 25 })
    return res.redirect(toIntegrations(req, {
      slack: 'connected',
      replayed: String(replay.replayed || 0),
    }))
  } catch {
    return res.redirect(toIntegrations(req, { slack: 'oauth-fail' }))
  }
}
