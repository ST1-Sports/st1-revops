/**
 * Shared Slack sender — chat.postMessage via SLACK_BOT_TOKEN.
 * Every other Slack-sending module in this repo (brad-shared.js,
 * ledger/payments.js, ledger/reconcile.js, reddit/services/slack-review.js)
 * hand-rolls this same fetch; this is the one new callers should use.
 */
export async function postSlackMessage({ channel, text, blocks } = {}) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token || !channel) {
    return { ok: false, skipped: true, reason: 'SLACK_BOT_TOKEN or channel not configured' }
  }
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
  })
  const data = await r.json().catch(() => ({ ok: false, error: 'invalid_json_response' }))
  if (!data.ok) console.warn('[slack] send failed:', data.error)
  return data
}
