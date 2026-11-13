/**
 * GET /api/cron/ledger-payments
 * Vercel cron — weekdays at 14:00 UTC (08:00 AM MT).
 *
 * Polls Zoho Books for open invoice status changes, updates DealInvoice rows,
 * and sends Slack reminders for overdue and upcoming-due invoices.
 */

import { serverCallHeaders } from '../_lib/agentGate.js'
import { requireCronSecret } from '../_lib/requireSignedIn.js'

export default async function handler(req, res) {
  if (!requireCronSecret(req, res)) return

  const base = `https://${req.headers.host}`

  const r = await fetch(`${base}/api/agents/ledger/payments`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...serverCallHeaders() },
    body:    JSON.stringify({ dryRun: false, lookAheadDays: 7, limit: 200 }),
  })

  const data = await r.json()
  console.log('[cron/ledger-payments]', JSON.stringify(data.totals || {}))
  return res.status(200).json(data)
}
