/**
 * GET /api/auth/me — who the signed session belongs to, for the app to finish signing in after
 * the Google redirect (the session arrives in the URL fragment). Includes the rep's Gmail status.
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { requireRep } from '../_lib/session.js';

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const me = await requireRep(req, res);
  if (!me) return;
  const setting = await prisma.setting.findUnique({ where: { key: 'app_state' } }).catch(() => null);
  const rep = (setting?.value?.reps || []).find(r => r?.id === me.repId) || null;
  const connection = await prisma.inboxConnection
    .findUnique({ where: { userId_provider: { userId: me.repId, provider: 'gmail' } } })
    .catch(() => null);
  return res.json({
    ok: true,
    repId: me.repId,
    rep,
    appUser: { repId: me.repId, isAdmin: me.isAdmin },
    gmail: connection && connection.status !== 'disconnected' && connection.encryptedRefreshToken
      ? { connected: true, email: connection.email, status: connection.status, lastSyncAt: connection.lastSyncAt }
      : { connected: false },
  });
}
