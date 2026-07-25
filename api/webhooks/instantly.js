/**
 * POST /api/webhooks/instantly
 *
 * Instantly.ai reply webhook — fires when a lead replies to a campaign email.
 * Closes the Brad feedback loop: marks the pending Brad outreach interaction as
 * 'replied' and persists a memory fact so future runs know this contact responded.
 *
 * Configure in Instantly: Settings → Webhooks → Add → Events: reply_received
 * Optional shared secret: set INSTANTLY_WEBHOOK_SECRET env var and Instantly will
 * send it in the X-Webhook-Secret header.
 */
import { prisma }                  from '../_lib/prisma.js'
import { recordOutcome, remember } from '../_lib/memory.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const secret = process.env.INSTANTLY_WEBHOOK_SECRET
  if (secret) {
    const incoming = req.headers['x-webhook-secret'] || req.headers['x-instantly-secret'] || req.query.secret
    if (incoming !== secret) return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  try {
    const body = req.body || {}

    // Instantly sends several event shapes — extract email from common patterns
    const raw = body.lead?.email || body.email || body.contact?.email || body.reply_from || ''
    const email = raw.toLowerCase().trim()

    if (!email) return res.status(200).json({ ok: true, note: 'No email in payload' })

    // Find the most recent pending Brad outreach(es) for this contact email
    const pending = await prisma.agentInteraction.findMany({
      where: {
        agentId: 'brad',
        action:  'outreach',
        outcome: 'pending',
        input:   { path: ['contactEmail'], equals: email },
      },
      orderBy: { createdAt: 'desc' },
      take:    3,
    })

    await Promise.all(pending.map(i => recordOutcome(i.id, 'replied')))

    // Persist reply to memory — fire-and-forget so a write failure doesn't 500 Instantly
    remember({
      scope:   'org',
      entity:  `customer:${email}`,
      key:     'last_replied',
      value:   JSON.stringify({
        repliedAt:    new Date().toISOString(),
        campaignId:   body.campaign_id   || body.campaign_name || null,
        campaignName: body.campaign_name || null,
      }),
      agentId: 'system',
    }).catch(() => {})

    return res.status(200).json({ ok: true, updated: pending.length })
  } catch (e) {
    console.error('[instantly webhook]', e.message)
    return res.status(500).json({ error: e.message })
  }
}
