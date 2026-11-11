/**
 * Vercel Serverless Function: /api/admin/questions
 *
 * GET  — list all TalkTrackQuestions ordered by phase then order
 * POST — create a new TalkTrackQuestion
 *
 * Access is gated client-side (cu.isAdmin check in the UI).
 * No server-side auth token exists in this project — matches all other routes.
 */

import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { bindCaller, requireCaller } from '../_lib/agentGate.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Agents spend model credits and read company data: signed-in reps (or this deployment's server jobs).
  if (!bindCaller(await requireCaller(req, res, { adminOnly: req.method !== 'GET' }))) return;

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const questions = await prisma.talkTrackQuestion.findMany({
        orderBy: [{ phase: 'asc' }, { order: 'asc' }],
      });
      return res.status(200).json({ questions });
    } catch (e) {
      console.error('[admin/questions] GET error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { phase, order, questionText, helpText, inputType, selectOptions, isRequired } = req.body || {};

    if (!phase)        return res.status(400).json({ error: 'phase is required' });
    if (!questionText) return res.status(400).json({ error: 'questionText is required' });
    if (!inputType)    return res.status(400).json({ error: 'inputType is required' });

    try {
      const question = await prisma.talkTrackQuestion.create({
        data: {
          phase,
          order:         order        ?? 99,
          questionText,
          helpText:      helpText     || null,
          inputType,
          selectOptions: selectOptions ?? null,
          isRequired:    isRequired   ?? false,
          isActive:      true,
        },
      });
      return res.status(201).json({ question });
    } catch (e) {
      console.error('[admin/questions] POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
