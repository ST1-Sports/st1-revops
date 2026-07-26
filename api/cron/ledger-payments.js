/**
 * GET /api/cron/ledger-payments
 * Vercel cron — weekdays at 14:00 UTC (08:00 AM MT).
 *
 * Polls Zoho Books for open invoice status changes, updates DealInvoice rows,
 * and sends Slack reminders for overdue and upcoming-due invoices.
 */

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const base = `https://${req.headers.host}`

  const r = await fetch(`${base}/api/agents/ledger/payments`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dryRun: false, lookAheadDays: 7, limit: 200 }),
  })

  const data = await r.json()
  console.log('[cron/ledger-payments]', JSON.stringify(data.totals || {}))
  return res.status(200).json(data)
}
