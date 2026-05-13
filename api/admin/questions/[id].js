/**
 * Vercel Serverless Function: /api/admin/questions/:id
 *
 * PATCH  — partial update of any TalkTrackQuestion field
 * DELETE — soft delete: sets isActive = false (never hard deletes)
 */

import { prisma } from '../../_lib/prisma.js';
import { setCors } from '../../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const qId = parseInt(id, 10);
  if (!Number.isFinite(qId)) return res.status(400).json({ error: 'id must be a number' });

  // ── PATCH ───────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body || {};
    const data = {};

    if (body.phase         !== undefined) data.phase         = body.phase;
    if (body.order         !== undefined) data.order         = Number(body.order);
    if (body.questionText  !== undefined) data.questionText  = body.questionText;
    if (body.helpText      !== undefined) data.helpText      = body.helpText;
    if (body.inputType     !== undefined) data.inputType     = body.inputType;
    if (body.selectOptions !== undefined) data.selectOptions = body.selectOptions;
    if (body.isActive      !== undefined) data.isActive      = Boolean(body.isActive);
    if (body.isRequired    !== undefined) data.isRequired    = Boolean(body.isRequired);

    try {
      const question = await prisma.talkTrackQuestion.update({ where: { id: qId }, data });
      return res.status(200).json({ question });
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Question not found' });
      console.error('[admin/questions/:id] PATCH error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE (soft) ────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      await prisma.talkTrackQuestion.update({ where: { id: qId }, data: { isActive: false } });
      return res.status(200).json({ success: true });
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Question not found' });
      console.error('[admin/questions/:id] DELETE error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
