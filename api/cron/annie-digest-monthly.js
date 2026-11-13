/**
 * GET /api/cron/annie-digest-monthly
 * Vercel cron — 1st of the month at 13:00 UTC.
 *
 * Triggers Annie's monthly digest (full P&L/Balance Sheet narrative,
 * forecast vs. actual, top OPPORTUNITY/SPEND_CUT insights) for the
 * just-finished calendar month, sent via Gmail.
 */

import { runMonthlyDigest } from '../agents/annie/digest.js'
import { requireCronSecret } from '../_lib/requireSignedIn.js'

export default async function handler(req, res) {
  if (!requireCronSecret(req, res)) return

  // In-process: the digest's HTTP endpoint is admin-only.
  const data = await runMonthlyDigest({ dryRun: false })
  console.log('[cron/annie-digest-monthly]', JSON.stringify({ ok: data.ok, skipped: data.skipped, digestLogId: data.digestLogId }))
  return res.status(200).json(data)
}
