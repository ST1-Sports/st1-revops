/**
 * Vercel Serverless Function: POST /api/sessions
 *
 * Creates a new TalkTrackSession for the logged-in rep.
 *
 * Body: { repId, crmContactId?, crmLeadId?, crmModule? }
 *   repId — userId from the client-side auth session
 * Returns: the full session object
 */

import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { repId, crmContactId, crmLeadId, crmModule } = req.body || {};
  if (!repId) return res.status(400).json({ error: 'repId is required' });

  if (crmModule && !['Contact', 'Lead'].includes(crmModule)) {
    return res.status(400).json({ error: 'crmModule must be "Contact" or "Lead"' });
  }

  try {
    const session = await prisma.talkTrackSession.create({
      data: {
        repId,
        crmContactId: crmContactId || null,
        crmLeadId:    crmLeadId    || null,
        crmModule:    crmModule    || null,
        status:       'IN_PROGRESS',
      },
    });
    return res.status(201).json({ session });
  } catch (e) {
    console.error('[sessions] POST error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
