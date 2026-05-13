/**
 * Vercel Serverless Function: /api/sessions/:id
 *
 * GET   /api/sessions/:id?repId=xxx   — fetch a single TalkTrackSession
 * PATCH /api/sessions/:id             — partially update a TalkTrackSession
 *
 * All operations validate that the session belongs to the requesting rep.
 * repId is read from req.query (GET) or req.body (PATCH) — matching the
 * project's client-side auth pattern.
 */

import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

const VALID_MODULES  = ['Contact', 'Lead'];
const VALID_STATUSES = ['IN_PROGRESS', 'COMPLETE'];

export default async function handler(req, res) {
  setCors(res, 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Session id is required' });

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const repId = req.query.repId;
    if (!repId) return res.status(400).json({ error: 'repId query param is required' });

    try {
      const session = await prisma.talkTrackSession.findUnique({ where: { id } });
      if (!session)           return res.status(404).json({ error: 'Session not found' });
      if (session.repId !== repId) return res.status(403).json({ error: 'Access denied' });
      return res.status(200).json({ session });
    } catch (e) {
      console.error('[sessions/:id] GET error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH ───────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body  = req.body || {};
    const repId = body.repId;
    if (!repId) return res.status(400).json({ error: 'repId is required' });

    try {
      const existing = await prisma.talkTrackSession.findUnique({ where: { id } });
      if (!existing)              return res.status(404).json({ error: 'Session not found' });
      if (existing.repId !== repId) return res.status(403).json({ error: 'Access denied' });

      const data = {};

      // CRM linkage
      if (body.crmContactId !== undefined) data.crmContactId = body.crmContactId;
      if (body.crmLeadId    !== undefined) data.crmLeadId    = body.crmLeadId;
      if (body.crmModule !== undefined) {
        if (body.crmModule !== null && !VALID_MODULES.includes(body.crmModule)) {
          return res.status(400).json({ error: `crmModule must be one of: ${VALID_MODULES.join(', ')}` });
        }
        data.crmModule = body.crmModule;
      }

      // School profile
      if (body.schoolClass           !== undefined) data.schoolClass           = body.schoolClass;
      if (body.numSports             !== undefined) data.numSports             = body.numSports    != null ? Number(body.numSports)    : null;
      if (body.numAthletes           !== undefined) data.numAthletes           = body.numAthletes  != null ? Number(body.numAthletes)  : null;
      if (body.hasOnlineStore        !== undefined) data.hasOnlineStore        = body.hasOnlineStore;
      if (body.hasBoosterClub        !== undefined) data.hasBoosterClub        = body.hasBoosterClub;
      if (body.estimatedCurrentSpend !== undefined) data.estimatedCurrentSpend = body.estimatedCurrentSpend != null ? Number(body.estimatedCurrentSpend) : null;

      // Answers and pains
      if (body.answers        !== undefined) data.answers        = body.answers;
      if (body.confirmedPains !== undefined) data.confirmedPains = body.confirmedPains;

      // Sponsorship estimates
      if (body.sponsorshipGuaranteedMin !== undefined) data.sponsorshipGuaranteedMin = body.sponsorshipGuaranteedMin != null ? Number(body.sponsorshipGuaranteedMin) : null;
      if (body.sponsorshipUpsideMax     !== undefined) data.sponsorshipUpsideMax     = body.sponsorshipUpsideMax     != null ? Number(body.sponsorshipUpsideMax)     : null;

      // Draft email
      if (body.draftEmailSubject !== undefined) data.draftEmailSubject = body.draftEmailSubject;
      if (body.draftEmailBody    !== undefined) data.draftEmailBody    = body.draftEmailBody;

      // Status
      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status)) {
          return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }
        data.status = body.status;
      }

      const session = await prisma.talkTrackSession.update({ where: { id }, data });
      return res.status(200).json({ session });
    } catch (e) {
      console.error('[sessions/:id] PATCH error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
