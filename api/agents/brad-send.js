/**
 * POST /api/agents/brad-send
 *
 * Send an approved Brad draft via Gmail and log the outcome to
 * agentInteraction so the 14-day re-touch barrier and outcome
 * tracking both reflect actual sends, not just draft generation.
 *
 * Body: { contactEmail, contactName, subject, body, contactId? }
 */

import { setCors }        from '../_lib/cors.js'
import { logInteraction } from '../_lib/memory.js'

export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contactEmail, contactName, subject, body, contactId } = req.body || {}
  if (!contactEmail) return res.status(400).json({ error: 'contactEmail required' })
  if (!body)         return res.status(400).json({ error: 'body required' })

  const baseUrl = `https://${req.headers.host}`

  try {
    const gmailRes = await fetch(`${baseUrl}/api/gmail`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', to_email: contactEmail, to_name: contactName, subject, body }),
    })
    const gmailData = await gmailRes.json()
    if (!gmailData.sent) {
      return res.status(500).json({ ok: false, error: gmailData.error || 'Gmail send failed' })
    }

    // Log the confirmed send — creates accurate 14-day re-touch record
    logInteraction({
      agentId: 'brad',
      action:  'outreach_sent',
      entity:  contactId ? `contact:${contactId}` : null,
      input:   { contactEmail, subject },
      output:  { via: 'gmail' },
      outcome: 'sent',
      dryRun:  false,
    }).catch(() => {})

    return res.json({ ok: true, sent: true, email: contactEmail })
  } catch (err) {
    console.error('[brad-send]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
