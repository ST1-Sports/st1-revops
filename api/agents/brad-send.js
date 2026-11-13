/**
 * POST /api/agents/brad-send
 *
 * Send an approved BDR draft via Gmail, from the signed-in rep's own BDR
 * (Settings → My BDR), and log the outcome to
 * agentInteraction so the 14-day re-touch barrier and outcome
 * tracking both reflect actual sends, not just draft generation.
 *
 * Body: { contactEmail, contactName, subject, body, contactId?, batchId?, bdrRepId? (admins) }
 */

import { setCors }        from '../_lib/cors.js'
import { requireRep }     from '../_lib/session.js'
import { callGmailInternal } from '../gmail.js'
import { logInteraction } from '../_lib/memory.js'
import { loadAllOutreachBatches } from '../_lib/outreachLoad.js'
import { claimForEmail, stoppedLeadForEmail } from '../_lib/outreachSent.js'
import { loadBdrForRep } from '../_lib/bdr.js'

export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  // Sends as the signed-in rep's own BDR.
  const me = await requireRep(req, res)
  if (!me) return

  const { contactEmail, contactName, subject, body, contactId, batchId, bdrRepId } = req.body || {}
  if (!contactEmail) return res.status(400).json({ error: 'contactEmail required' })
  if (!body)         return res.status(400).json({ error: 'body required' })
  if (process.env.BRAD_SENDING_ENABLED !== 'true') {
    return res.status(403).json({
      ok: false,
      sent: false,
      error: 'BDR sending is disabled. Set BRAD_SENDING_ENABLED=true to allow approved sends.',
    })
  }
  // Admins may send a campaign from the BDR of the rep who owns it; everyone else uses their own.
  const bdr = await loadBdrForRep(bdrRepId && me.isAdmin ? String(bdrRepId) : me.repId)
  if (!bdr) {
    return res.status(400).json({ ok: false, sent: false, error: 'Set up your BDR first: Settings → My BDR.' })
  }


  try {
    const batches = await loadAllOutreachBatches()
    const stopped = stoppedLeadForEmail(batches, contactEmail, batchId)
    if (stopped) {
      return res.status(409).json({
        ok: false,
        sent: false,
        skipped: true,
        outcome: stopped.outcome,
        error: stopped.outcome === 'intent'
          ? 'Marked as positive intent — no more automated emails.'
          : 'Marked for manual follow-up — no more automated emails.',
      })
    }
    const claim = claimForEmail(batches, contactEmail)
    if (claim && claim.batchId && claim.batchId !== batchId) {
      return res.status(409).json({
        ok: false,
        sent: false,
        skipped: true,
        held: true,
        error: `Already on the earlier list "${claim.batchName}" — first upload keeps this address.`,
      })
    }

    const { data: gmailData } = await callGmailInternal({
        action:     'send',
        to_email:   contactEmail,
        to_name:    contactName,
        subject,
        body,
        from_name:  bdr.name,
        from_email: bdr.email,
        reply_to:   bdr.email,
        repEnvKey:  bdr.gmailKey,
    })
    if (!gmailData.sent) {
      return res.status(500).json({ ok: false, error: gmailData.error || 'Gmail send failed' })
    }

    // Log the confirmed send — creates accurate 14-day re-touch record
    logInteraction({
      agentId: 'brad',
      action:  'outreach',
      entity:  contactId ? `contact:${contactId}` : null,
      input:   { contactEmail, subject },
      output:  { via: 'gmail', bdr: bdr.email, repId: me.repId },
      outcome: 'sent',
      dryRun:  false,
    }).catch(() => {})

    return res.json({ ok: true, sent: true, email: contactEmail })
  } catch (err) {
    console.error('[brad-send]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
