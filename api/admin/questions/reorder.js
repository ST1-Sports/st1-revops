/**
 * Vercel Serverless Function: PATCH /api/admin/questions/reorder
 *
 * Bulk-updates the `order` field for multiple questions in one transaction.
 * Used by drag-to-reorder in the admin UI.
 *
 * Body: { updates: [{ id, order }] }
 * This static file takes routing priority over the dynamic [id].js sibling.
 */

import { prisma } from '../../_lib/prisma.js';
import { setCors } from '../../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH')   return res.status(405).json({ error: 'PATCH only' });

  const { updates } = req.body || {};
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array is required' });
  }

  try {
    await prisma.$transaction(
      updates.map(({ id, order }) =>
        prisma.talkTrackQuestion.update({
          where: { id: parseInt(id, 10) },
          data:  { order: Number(order) },
        })
      )
    );
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[admin/questions/reorder] PATCH error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
