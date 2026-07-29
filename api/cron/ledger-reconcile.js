/**
 * GET /api/cron/ledger-reconcile
 * Vercel cron — weekdays at 08:00 UTC.
 *
 * Polls uncategorized Zoho Books transactions (deposits + credit card charges,
 * if configured), proposes a coding for each (remembered correction → matched
 * invoice/bill/team-store → Zoho Books bank rule), and writes them to the
 * Deposit review queue as PENDING_REVIEW. Nothing is pushed to Zoho Books here
 * — that only happens when a human approves from the Finance tab. Slack-notifies
 * on new pending items.
 *
 * On the very first run (TeamStore empty) the reconcile handler auto-seeds
 * store names from the last 90 days of Stripe charge history before classifying.
 */

export default async function handler(req, res) {
  // Vercel cron sends Authorization: Bearer $CRON_SECRET — validate if set
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const base = `https://${req.headers.host}`

  const r = await fetch(`${base}/api/agents/ledger/reconcile`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task: 'reconcile', dryRun: false, limit: 50 }),
  })

  const data = await r.json()
  console.log('[cron/ledger-reconcile]', JSON.stringify(data.totals || {}))
  return res.status(200).json(data)
}
