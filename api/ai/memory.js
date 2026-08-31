/**
 * /api/ai/memory — browse, add, and prune Scout/org memory + chat feedback.
 *
 * GET  → { facts, feedback, chatSessionCount }
 * POST { action: "remember", key, value, entity?, scope? }
 * POST { action: "forget", id }
 */
import { setCors } from '../_lib/cors.js';
import { prisma } from '../_lib/prisma.js';
import { forgetMemory, listMemory, remember } from '../_lib/memory.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const [facts, feedback, chatSessionCount] = await Promise.all([
        listMemory({ limit: 80 }),
        prisma.agentInteraction.findMany({
          where: { action: 'chat_feedback' },
          orderBy: { createdAt: 'desc' },
          take: 24,
        }),
        prisma.chatSession.count(),
      ]);
      return res.json({ ok: true, facts, feedback, chatSessionCount });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'remember') {
        const key = String(body.key || '').trim();
        const value = String(body.value || '').trim();
        if (!key || !value) return res.status(400).json({ ok: false, error: 'key and value required' });
        const row = await remember({
          scope: body.scope || 'org',
          entity: body.entity || 'org',
          key,
          value,
          agentId: body.agentId || 'revops-agent',
          confidence: 1,
        });
        return res.json({ ok: true, fact: row });
      }
      if (body.action === 'forget') {
        if (!body.id) return res.status(400).json({ ok: false, error: 'id required' });
        await forgetMemory({ id: body.id });
        return res.json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[ai/memory]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
