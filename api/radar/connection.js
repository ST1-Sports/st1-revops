import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { seedRadarConfig } from '../_lib/radar/seed.js';
import { syncConnection } from '../_lib/radar/sync.js';

export const config = { maxDuration: 300 };

function publicConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    email: row.email,
    scopes: row.scopes,
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    backfillDays: row.backfillDays,
    lastError: row.lastError,
    hasToken: Boolean(row.encryptedRefreshToken),
  };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = String(req.query?.userId || req.body?.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required' });

  if (req.method === 'GET') {
    const row = await prisma.inboxConnection.findUnique({
      where: { userId_provider: { userId, provider: 'gmail' } },
    }).catch(() => null);
    const owesReply = await prisma.followUpItem.count({
      where: {
        userId,
        bucket: 'owes_reply',
        status: 'open',
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
      },
    }).catch(() => 0);
    return res.json({ connection: publicConnection(row), owesReply });
  }

  if (req.method === 'DELETE') {
    const row = await prisma.inboxConnection.findUnique({
      where: { userId_provider: { userId, provider: 'gmail' } },
    });
    if (!row) return res.json({ ok: true, disconnected: true });
    await prisma.inboxConnection.update({
      where: { id: row.id },
      data: { status: 'disconnected', encryptedRefreshToken: '', lastError: null },
    });
    return res.json({ ok: true, disconnected: true });
  }

  if (req.method === 'POST') {
    const action = req.body?.action || req.query?.action;
    const row = await prisma.inboxConnection.findUnique({
      where: { userId_provider: { userId, provider: 'gmail' } },
    });
    if (!row || row.status === 'disconnected' || !row.encryptedRefreshToken) {
      return res.status(409).json({ error: 'Connect Gmail first' });
    }
    if (action === 'backfill-days') {
      const days = Math.max(7, Math.min(365, Number(req.body?.days) || 120));
      const updated = await prisma.inboxConnection.update({
        where: { id: row.id },
        data: { backfillDays: days, historyId: null, lastSyncAt: null, syncCursor: null },
      });
      return res.json({ ok: true, connection: publicConnection(updated) });
    }
    await seedRadarConfig();
    const result = await syncConnection(row.id, { mode: action === 'incremental' ? 'incremental' : 'backfill' });
    const fresh = await prisma.inboxConnection.findUnique({ where: { id: row.id } });
    return res.json({ ...result, connection: publicConnection(fresh) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
