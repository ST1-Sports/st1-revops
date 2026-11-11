/**
 * GET /api/cron/annie-digest-weekly
 * Vercel cron — Mondays at 12:00 UTC.
 *
 * Triggers Annie's weekly digest (cash position, new PAYMENT_PLAN/RISK
 * insights, AR 60+ day flag, pipeline movement) to Slack #all-st1-sports.
 */

import { runWeeklyDigest } from '../agents/annie/digest.js'

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  // In-process: the digest's HTTP endpoint is admin-only.
  const data = await runWeeklyDigest({ dryRun: false })
  console.log('[cron/annie-digest-weekly]', JSON.stringify({ ok: data.ok, skipped: data.skipped, digestLogId: data.digestLogId }))
  return res.status(200).json(data)
}
