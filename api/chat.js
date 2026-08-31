/**
 * /api/chat — Chat session + message persistence
 *
 * POST { action:"start_session", userId?, userName?, context? }
 *   → creates a new ChatSession, returns { sessionId }
 *
 * POST { action:"save_message", sessionId, role, content, actions? }
 *   → appends a ChatMessage to the session, returns { id }
 *
 * POST { action:"delete_session", sessionId, userId? }
 * POST { action:"delete_all", userId }
 * POST { action:"rate_message", messageId?, sessionId?, vote, query?, answer?, userId? }
 *
 * GET ?context=home&limit=50
 *   → returns recent ChatSessions with their messages (for history view)
 *
 * GET ?sessionId=xxx
 *   → returns a single session with all messages
 */

import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { recordChatFeedback } from './_lib/memory.js';
import { packChatPayload, splitChatPayload } from '../src/lib/chatMemory.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { sessionId, context, limit = '50', userId } = req.query;
    try {
      if (sessionId) {
        const session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: { messages: { orderBy: { ts: 'asc' } } },
        });
        return res.json({ session });
      }

      const where = {};
      if (context) where.context = context;
      if (userId)  where.userId  = userId;

      const sessions = await prisma.chatSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        include: {
          messages: {
            orderBy: { ts: 'asc' },
            // Include all messages — frontend can truncate for display
          },
        },
      });
      return res.json({ sessions });
    } catch (e) {
      console.error('[chat] GET error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    try {
      if (body.action === 'start_session') {
        const session = await prisma.chatSession.create({
          data: {
            userId:   body.userId   || null,
            userName: body.userName || null,
            context:  body.context  || 'home',
          },
        });
        return res.json({ sessionId: session.id });
      }

      if (body.action === 'save_message') {
        const { sessionId, role, content, actions } = body;
        if (!sessionId || !role || !content) {
          return res.status(400).json({ error: 'sessionId, role, content required' });
        }
        const msg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role,
            content,
            actions: actions || null,
          },
        });
        // Touch updatedAt on the session
        await prisma.chatSession.update({
          where: { id: sessionId },
          data:  { updatedAt: new Date() },
        });
        return res.json({ id: msg.id });
      }

      if (body.action === 'find_similar') {
        const { query, excludeUserId, limit = 3 } = body;
        if (!query) return res.status(400).json({ error: 'query required' });

        const STOP = new Set(['that','this','what','with','from','have','they','about','some','just','your','been','were','more','will','would','could','should','their','there','which','when','then','than','like','into','also','over','such','only','most','know','make','time','need','want','tell','said','does','done','same','take','them','even','back','good','each','well','many','very','much','those','other','after','these','first','never','think','still','before','every','always','another','through']);
        const keywords = query.toLowerCase()
          .split(/[\s,?.!;:]+/)
          .filter(w => w.length > 3 && !STOP.has(w))
          .slice(0, 6);

        if (!keywords.length) return res.json({ matches: [] });

        const msgs = await prisma.chatMessage.findMany({
          where: {
            role: 'user',
            OR: keywords.map(kw => ({ content: { contains: kw, mode: 'insensitive' } })),
            ...(excludeUserId ? { session: { userId: { not: excludeUserId } } } : {}),
          },
          include: { session: { select: { id: true, userId: true, userName: true, createdAt: true } } },
          orderBy: { ts: 'desc' },
          take: 20,
        });

        const seen = new Set();
        const matches = [];
        for (const m of msgs) {
          if (seen.has(m.sessionId) || matches.length >= limit) break;
          seen.add(m.sessionId);
          matches.push({
            sessionId:  m.sessionId,
            userName:   m.session.userName || 'A teammate',
            snippet:    m.content.slice(0, 80),
            ts:         m.session.createdAt,
          });
        }
        return res.json({ matches });
      }

      if (body.action === 'delete_session') {
        const { sessionId, userId } = body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session) return res.json({ ok: true, deleted: 0 });
        if (userId && session.userId && session.userId !== userId) {
          return res.status(403).json({ error: 'Not your chat' });
        }
        await prisma.chatSession.delete({ where: { id: sessionId } });
        return res.json({ ok: true, deleted: 1 });
      }

      if (body.action === 'delete_all') {
        if (!body.userId) return res.status(400).json({ error: 'userId required' });
        const result = await prisma.chatSession.deleteMany({ where: { userId: body.userId } });
        return res.json({ ok: true, deleted: result.count });
      }

      if (body.action === 'rate_message') {
        const vote = body.vote === 'down' ? 'down' : 'up';
        let msg = null;
        if (body.messageId) {
          msg = await prisma.chatMessage.findUnique({ where: { id: body.messageId } });
        }
        if (!msg && body.sessionId) {
          msg = await prisma.chatMessage.findFirst({
            where: { sessionId: body.sessionId, role: 'assistant' },
            orderBy: { ts: 'desc' },
          });
        }
        if (msg) {
          const { actions } = splitChatPayload(msg.actions);
          await prisma.chatMessage.update({
            where: { id: msg.id },
            data: { actions: packChatPayload(actions, vote) },
          });
        }
        await recordChatFeedback({
          vote,
          query: body.query || '',
          answer: body.answer || msg?.content || '',
          messageId: msg?.id || null,
          userId: body.userId || null,
        });
        return res.json({ ok: true, vote, messageId: msg?.id || null });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      console.error('[chat] POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
