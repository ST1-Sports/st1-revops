/**
 * /api/outreach/batches — durable storage for Bulk Outreach uploads.
 *
 * GET            → list batches, lightweight (no leads payload)
 * GET ?id=X      → one batch, full leads payload for the review screen
 * POST           → create a new batch (client already parsed the sheet)
 * PATCH          → update an existing batch — edits, settings, or approval
 *                  (approving sets { status:'approved', campaignId })
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const LIST_SELECT = {
  id: true, name: true, fileName: true, status: true,
  totalCount: true, sendableCount: true, touchCount: true,
  campaignId: true, createdAt: true, updatedAt: true,
};

function countsFrom(leads) {
  const sendable = leads.filter(l => l?.sendable && l?.email);
  return {
    totalCount: leads.length,
    sendableCount: sendable.length,
    touchCount: sendable.reduce((a, l) => a + (l.touches || []).length, 0),
  };
}

const PATCHABLE = ['name', 'status', 'columnMap', 'startDt', 'batchSize', 'touchGapDays', 'campaignId'];

export default async function handler(req, res) {
  setCors(res, 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { id } = req.query || {};
      if (id) {
        const batch = await prisma.outreachBatch.findUnique({ where: { id: String(id) } });
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        return res.json({ ok: true, batch });
      }
      const batches = await prisma.outreachBatch.findMany({ select: LIST_SELECT, orderBy: { createdAt: 'desc' } });
      return res.json({ ok: true, batches });
    }

    if (req.method === 'POST') {
      const { name, fileName, columnMap, leads, startDt, batchSize, touchGapDays, createdBy } = req.body || {};
      if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({ error: 'leads array required' });
      }
      const batch = await prisma.outreachBatch.create({
        data: {
          name: (name || 'Bulk Outreach').slice(0, 200),
          fileName: fileName ? String(fileName).slice(0, 300) : null,
          columnMap: columnMap || {},
          leads,
          startDt: startDt || null,
          batchSize: Number(batchSize) || 25,
          touchGapDays: Number(touchGapDays) || 5,
          createdBy: createdBy || null,
          ...countsFrom(leads),
        },
      });
      return res.json({ ok: true, batch });
    }

    if (req.method === 'PATCH') {
      const { id, leads, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const data = {};
      for (const k of PATCHABLE) if (fields[k] !== undefined) data[k] = fields[k];
      if (Array.isArray(leads)) { data.leads = leads; Object.assign(data, countsFrom(leads)); }
      if (Object.keys(data).length === 0) return res.status(400).json({ error: 'no updatable fields provided' });
      const batch = await prisma.outreachBatch.update({ where: { id: String(id) }, data });
      return res.json({ ok: true, batch });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[outreach/batches]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
