/**
 * Create / regenerate an unsent Gmail draft for a Follow-Up Radar item.
 * There is no send action on this endpoint.
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { createRadarDraft } from '../_lib/radar/drafts.js';
import { getFullThread, refreshAccessToken } from '../_lib/radar/gmail.js';
import { requireRep } from '../_lib/session.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const me = await requireRep(req, res);
  if (!me) return;
  const userId = me.repId;
  const { ids, id, skipRecentCheck } = req.body || {};
  const itemIds = Array.isArray(ids) ? ids : (id ? [id] : []);
  if (!itemIds.length) return res.status(400).json({ error: 'id or ids required' });

  const connection = await prisma.inboxConnection.findUnique({
    where: { userId_provider: { userId, provider: 'gmail' } },
  });
  if (!connection || connection.status === 'disconnected' || !connection.encryptedRefreshToken) {
    return res.status(409).json({ error: 'Connect Gmail first' });
  }

  const results = [];
  const accessToken = await refreshAccessToken(connection.encryptedRefreshToken);

  for (const itemId of itemIds.slice(0, 25)) {
    const item = await prisma.followUpItem.findUnique({ where: { id: itemId } });
    if (!item || item.userId !== userId) {
      results.push({ id: itemId, ok: false, error: 'not found' });
      continue;
    }
    if (item.threadId.startsWith('brad:')) {
      results.push({ id: itemId, ok: false, error: 'Brad-sourced items have no Gmail thread yet — open the original mail from Brad\'s box or wait for inbox sync to attach it.' });
      continue;
    }
    try {
      const thread = await getFullThread(accessToken, item.threadId);
      const out = await createRadarDraft({
        connection,
        item,
        thread,
        skipRecentCheck: Boolean(skipRecentCheck) || req.body?.action === 'regenerate',
      });
      results.push({ id: itemId, ...out });
    } catch (err) {
      results.push({ id: itemId, ok: false, error: err.message });
    }
  }

  return res.json({ ok: results.every(r => r.ok || r.skipped), results });
}
