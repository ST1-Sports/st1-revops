/**
 * GET /api/cron/radar-sync
 * Incremental Gmail history sync for every connected Follow-Up Radar inbox.
 * Schedule: every 30 minutes.
 */
import { syncAllConnections } from '../_lib/radar/sync.js';
import { requireCronSecret } from '../_lib/requireSignedIn.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!requireCronSecret(req, res)) return;

  const result = await syncAllConnections();
  console.log('[cron/radar-sync]', JSON.stringify(result.results?.map(r => ({ userId: r.userId, ok: r.ok, stats: r.stats }))));
  return res.status(200).json(result);
}
