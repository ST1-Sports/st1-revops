/**
 * /api/chat — Chat session + message persistence
 *
 * POST { action:"start_session", userId?, userName?, context? }
 *   → creates a new ChatSession, returns { sessionId }
 *
 * POST { action:"save_message", sessionId, role, content, actions? }
 *   → appends a ChatMessage to the session, returns { id }
 *
 * GET ?context=home&limit=50
 *   → returns recent ChatSessions with their messages (for history view)
 *
 * GET ?sessionId=xxx
 *   → returns a single session with all messages
 */

import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';

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

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      console.error('[chat] POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
