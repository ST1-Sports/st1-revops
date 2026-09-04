import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatSlackError,
  isSlackTokenError,
  isSlackWebhookUrl,
  failedBradSlackRows,
  preferWebhookFirst,
} from './slack.js'

describe('isSlackWebhookUrl', () => {
  it('accepts a real incoming webhook URL', () => {
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com/services/T1/B2/abc_def-9'), true)
  })
  it('rejects other hosts', () => {
    assert.equal(isSlackWebhookUrl('https://example.com/services/T1/B2/abc'), false)
  })
})

describe('formatSlackError / token errors', () => {
  it('formats missing_scope the way production records it', () => {
    const msg = formatSlackError({ error: 'missing_scope', needed: 'chat:write:bot', provided: 'incoming-webhook' })
    assert.match(msg, /missing_scope/)
    assert.match(msg, /chat:write:bot/)
  })
  it('treats missing_scope as a token-level failure', () => {
    assert.equal(isSlackTokenError({ error: 'missing_scope' }), true)
    assert.equal(isSlackTokenError({ error: 'not_in_channel' }), false)
  })
})

describe('preferWebhookFirst', () => {
  it('uses the webhook when the bot cannot chat.postMessage', () => {
    assert.equal(preferWebhookFirst(false, 'https://hooks.slack.com/services/T/B/x'), true)
    assert.equal(preferWebhookFirst(null, 'https://hooks.slack.com/services/T/B/x'), true)
    assert.equal(preferWebhookFirst(true, 'https://hooks.slack.com/services/T/B/x'), false)
    assert.equal(preferWebhookFirst(false, ''), false)
  })
})

describe('failedBradSlackRows', () => {
  it('keeps every reply that is not slack sent', () => {
    const rows = [
      { id: '1', output: { slack: 'sent' } },
      { id: '2', output: { slack: 'C0AQ7CMB01X: missing_scope' } },
      { id: '3', output: {} },
    ]
    assert.deepEqual(failedBradSlackRows(rows).map(r => r.id), ['2', '3'])
  })
})
