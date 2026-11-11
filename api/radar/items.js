import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { loadLiveDeals, summarizeDeals } from '../_lib/radar/matchDeals.js';
import { requireRep } from '../_lib/session.js';

function openWhere(userId, extra = {}) {
  return {
    userId,
    status: 'open',
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    ...extra,
  };
}

function serialize(item) {
  const latest = item.drafts?.[0] || null;
  let draftStatus = 'none';
  if (latest?.sentDetectedAt) draftStatus = 'sent';
  else if (latest) draftStatus = latest.needsInput ? 'needs_input' : 'drafted';
  return {
    id: item.id,
    userId: item.userId,
    threadId: item.threadId,
    bucket: item.bucket,
    status: item.status,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    organization: item.organization,
    orgType: item.orgType,
    intentScore: item.intentScore,
    dealContext: item.dealContext,
    openCommitments: item.openCommitments || [],
    lastTouchAt: item.lastTouchAt,
    lastTouchBy: item.lastTouchBy,
    daysSinceLastTouch: item.daysSinceLastTouch,
    suggestedNextStep: item.suggestedNextStep,
    snoozedUntil: item.snoozedUntil,
    dealId: item.dealId,
    dealStage: item.dealStage,
    gmailPermalink: item.gmailPermalink,
    needsInput: item.needsInput,
    source: item.source,
    draftStatus,
    latestDraftId: latest?.gmailDraftId || null,
    updatedAt: item.updatedAt,
  };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // The rep comes from the signed session, never from the request; admin status is server-side.
  const me = await requireRep(req, res);
  if (!me) return;
  const userId = me.repId;
  const isAdmin = me.isAdmin;

  if (req.method === 'GET') {
    // Recent email activity from the rep's own inbox (threads that passed the hard filters).
    if (req.query?.activity === '1') {
      const since = new Date(Date.now() - 14 * 86400000);
      const threads = await prisma.threadSnapshot.findMany({
        where: { userId, filterReason: null, lastMessageAt: { gte: since } },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      });
      const items = await prisma.followUpItem.findMany({
        where: { userId, threadId: { in: threads.map(t => t.threadId) } },
        select: { threadId: true, bucket: true, status: true },
      });
      const bucketByThread = new Map(items.map(i => [i.threadId, i.status === 'open' ? i.bucket : i.status]));
      return res.json({
        threads: threads.map(t => ({
          threadId: t.threadId,
          subject: t.subject || '(no subject)',
          participants: (Array.isArray(t.participants) ? t.participants : [])
            .map(p => (typeof p === 'string' ? p : p?.name || p?.email))
            .filter(Boolean)
            .slice(0, 4),
          lastMessageAt: t.lastMessageAt,
          followUp: bucketByThread.get(t.threadId) || null,
          gmailUrl: `https://mail.google.com/mail/u/0/#all/${t.threadId}`,
        })),
      });
    }
    if (req.query?.counts === '1') {
      const owesReply = await prisma.followUpItem.count({ where: openWhere(userId, { bucket: 'owes_reply' }) });
      const awaiting = await prisma.followUpItem.count({ where: openWhere(userId, { bucket: 'awaiting_them' }) });
      let team = null;
      if (isAdmin && req.query?.rollup === '1') {
        const grouped = await prisma.followUpItem.groupBy({
          by: ['userId', 'bucket'],
          where: {
            status: 'open',
            bucket: { in: ['owes_reply', 'awaiting_them'] },
            OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
          },
          _count: { _all: true },
        });
        const byUser = new Map();
        for (const g of grouped) {
          if (!byUser.has(g.userId)) byUser.set(g.userId, { userId: g.userId, owesReply: 0, awaiting: 0 });
          const row = byUser.get(g.userId);
          if (g.bucket === 'owes_reply') row.owesReply = g._count._all;
          if (g.bucket === 'awaiting_them') row.awaiting = g._count._all;
        }
        team = [...byUser.values()];
        if (req.query?.details === '1') {
          for (const t of team) {
            t.items = (await prisma.followUpItem.findMany({
              where: openWhere(t.userId, { bucket: { in: ['owes_reply', 'awaiting_them'] } }),
              include: { drafts: { orderBy: { createdAt: 'desc' }, take: 1 } },
              orderBy: [{ intentScore: 'desc' }, { lastTouchAt: 'asc' }],
              take: 50,
            })).map(serialize);
          }
        }
      }
      const deals = req.query?.deals === '1' ? summarizeDeals(await loadLiveDeals()) : undefined;
      return res.json({ owesReply, awaiting, team, deals });
    }

    const bucket = req.query?.bucket === 'awaiting_them' ? 'awaiting_them' : 'owes_reply';
    const items = await prisma.followUpItem.findMany({
      where: openWhere(userId, { bucket }),
      include: { drafts: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ intentScore: 'desc' }, { lastTouchAt: 'asc' }],
      take: 200,
    });
    return res.json({ items: items.map(serialize) });
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = await prisma.followUpItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.userId !== userId && !isAdmin) return res.status(403).json({ error: 'forbidden' });

    const data = {};
    const action = req.body?.action;
    if (action === 'snooze') {
      const days = [3, 7, 14].includes(Number(req.body?.days)) ? Number(req.body.days) : 3;
      const until = new Date();
      until.setDate(until.getDate() + days);
      data.snoozedUntil = until;
      data.status = 'open';
    }
    if (action === 'closed_won' || action === 'closed_lost') {
      data.status = action;
      data.bucket = action;
      data.snoozedUntil = null;
    }
    if (action === 'link') {
      data.dealId = req.body?.dealId || null;
      data.dealStage = req.body?.dealStage || existing.dealStage;
    }
    if (action === 'unsnooze') {
      data.snoozedUntil = null;
      data.status = 'open';
    }
    const updated = await prisma.followUpItem.update({
      where: { id },
      data,
      include: { drafts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return res.json({ ok: true, item: serialize(updated) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
