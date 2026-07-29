/**
 * GET /api/cron/annie-digest-weekly
 * Vercel cron — Mondays at 12:00 UTC.
 *
 * Triggers Annie's weekly digest (cash position, new PAYMENT_PLAN/RISK
 * insights, AR 60+ day flag, pipeline movement) to Slack #all-st1-sports.
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
    body:    JSON.stringify({ task: 'weekly', dryRun: false }),
  })

  const data = await r.json()
  console.log('[cron/annie-digest-weekly]', JSON.stringify({ ok: data.ok, skipped: data.skipped, digestLogId: data.digestLogId }))
  return res.status(200).json(data)
}
