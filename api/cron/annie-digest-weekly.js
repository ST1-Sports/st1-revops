/**
 * GET /api/cron/annie-digest-weekly
 * Vercel cron — Mondays at 12:00 UTC.
 *
 * Triggers Annie's weekly digest (cash position, new PAYMENT_PLAN/RISK
 * insights, AR 60+ day flag, pipeline movement) to Slack #all-st1-sports.
 */

import { runWeeklyDigest } from '../agents/annie/digest.js'
import { requireCronSecret } from '../_lib/requireSignedIn.js'

export default async function handler(req, res) {
  if (!requireCronSecret(req, res)) return

  // In-process: the digest's HTTP endpoint is admin-only.
  const data = await runWeeklyDigest({ dryRun: false })
  console.log('[cron/annie-digest-weekly]', JSON.stringify({ ok: data.ok, skipped: data.skipped, digestLogId: data.digestLogId }))
  return res.status(200).json(data)
}
