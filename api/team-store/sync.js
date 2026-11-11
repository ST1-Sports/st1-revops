/**
 * /api/team-store/sync — Team Store Settlement sync
 *
 * GET  → the most recent TeamStoreSyncRun, for the UI's "last synced" display
 * POST → run a sync now (same runSync() the nightly cron calls)
 */

import { setCors } from '../_lib/cors.js';
import { prisma } from '../_lib/prisma.js';
import { runSync } from '../_lib/teamStoreSync.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const lastRun = await prisma.teamStoreSyncRun.findFirst({ orderBy: { startedAt: 'desc' } });
      return res.json({ ok: true, lastRun });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const run = await runSync();
      return res.json({ ok: true, run });
    } catch (e) {
      console.error('[team-store/sync]', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
