/**
 * POST /api/agents/brad-send
 *
 * Push an approved Brad draft to an Instantly campaign as a new lead.
 * Called when Matt clicks "SEND" on a Brad outreach draft card.
 *
 * Body: { contactEmail, contactName, contactSchool, subject, body, contactId?, campaignId? }
 * Env:  INSTANTLY_API_KEY, INSTANTLY_CAMPAIGN_ID
 *
 * The Instantly campaign must have its email body set to {{personalization}}
 * so Brad's full personalized draft becomes the sent email.
 */

import { setCors }        from '../_lib/cors.js'
import { logInteraction } from '../_lib/memory.js'

export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v1'

async function addLead({ apiKey, campaignId, contactEmail, contactName, contactSchool, body }) {
  const parts     = (contactName || '').trim().split(/\s+/)
  const firstName = parts[0] || ''
  const lastName  = parts.slice(1).join(' ') || ''

  const r = await fetch(`${INSTANTLY_BASE}/lead/add`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:         apiKey,
      campaign_id:     campaignId,
      email:           contactEmail,
      first_name:      firstName,
      last_name:       lastName,
      personalization: body,
      company_name:    contactSchool || '',
    }),
  })

  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.status === 'error') {
    throw new Error(data.message || `Instantly HTTP ${r.status}`)
  }
  return data
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const apiKey     = process.env.INSTANTLY_API_KEY
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID

  if (!apiKey)     return res.status(500).json({ error: 'INSTANTLY_API_KEY not configured' })
  if (!campaignId) return res.status(500).json({ error: 'INSTANTLY_CAMPAIGN_ID not configured' })

  const { contactEmail, contactName, contactSchool, subject, body, contactId } = req.body || {}

  if (!contactEmail) return res.status(400).json({ error: 'contactEmail required' })
  if (!body)         return res.status(400).json({ error: 'body required' })

  try {
    await addLead({
      apiKey,
      campaignId: req.body.campaignId || campaignId,
      contactEmail,
      contactName,
      contactSchool,
      body,
    })

    // Log the confirmed send so the 14-day re-touch barrier is enforced correctly
    logInteraction({
      agentId: 'brad',
      action:  'outreach_sent',
      entity:  contactId ? `contact:${contactId}` : null,
      input:   { contactEmail, subject },
      output:  { platform: 'instantly' },
      outcome: 'sent',
      dryRun:  false,
    }).catch(() => {})

    return res.json({ ok: true, platform: 'instantly', email: contactEmail })
  } catch (err) {
    console.error('[brad-send]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
