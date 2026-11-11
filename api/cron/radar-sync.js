/**
 * GET /api/cron/radar-sync
 * Incremental Gmail history sync for every connected Follow-Up Radar inbox.
 * Schedule: every 30 minutes.
 */
import { syncAllConnections } from '../_lib/radar/sync.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const result = await syncAllConnections();
  console.log('[cron/radar-sync]', JSON.stringify(result.results?.map(r => ({ userId: r.userId, ok: r.ok, stats: r.stats }))));
  return res.status(200).json(result);
}
