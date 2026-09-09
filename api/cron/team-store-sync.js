/**
 * /api/cron/team-store-sync — nightly Team Store Settlement sync.
 *
 * Order volume is ~120/month, so nightly is plenty; this just calls the same
 * runSync() the on-demand "Sync now" button in the UI calls, so behavior is
 * identical either way it's triggered.
 */

import { runSync } from '../_lib/teamStoreSync.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const run = await runSync();
    return res.json({ ok: true, run });
  } catch (e) {
    console.error('[cron/team-store-sync]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
