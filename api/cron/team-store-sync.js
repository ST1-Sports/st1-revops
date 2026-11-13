/**
 * /api/cron/team-store-sync — nightly Team Store Settlement sync.
 *
 * Order volume is ~120/month, so nightly is plenty; this just calls the same
 * runSync() the on-demand "Sync now" button in the UI calls, so behavior is
 * identical either way it's triggered.
 */

import { runSync } from '../_lib/teamStoreSync.js';
import { requireCronSecret } from '../_lib/requireSignedIn.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!requireCronSecret(req, res)) return;
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
