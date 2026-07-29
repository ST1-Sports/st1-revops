/**
 * GET /api/cron/annie-digest-monthly
 * Vercel cron — 1st of the month at 13:00 UTC.
 *
 * Triggers Annie's monthly digest (full P&L/Balance Sheet narrative,
 * forecast vs. actual, top OPPORTUNITY/SPEND_CUT insights) for the
 * just-finished calendar month, sent via Gmail.
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

  const r = await fetch(`${base}/api/agents/annie/digest`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task: 'monthly', dryRun: false }),
  })

  const data = await r.json()
  console.log('[cron/annie-digest-monthly]', JSON.stringify({ ok: data.ok, skipped: data.skipped, digestLogId: data.digestLogId }))
  return res.status(200).json(data)
}
