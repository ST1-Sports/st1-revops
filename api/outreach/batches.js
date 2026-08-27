/**
 * /api/outreach/batches — durable storage for Bulk Outreach uploads.
 *
 * GET            → list batches, lightweight (no leads payload)
 * GET ?id=X      → one batch, full leads payload for the review screen
 * POST           → create a new batch (client already parsed the sheet)
 * PATCH          → update an existing batch — edits, settings, or approval
 *                  (approving sets { status:'approved', campaignId })
 * DELETE ?id=X   → remove a bad upload — refused once approved (the linked
 *                  campaign is the real record at that point; unlink/pause
 *                  it there instead of deleting its history here)
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const LIST_SELECT = {
  id: true, name: true, fileName: true, status: true,
  totalCount: true, sendableCount: true, touchCount: true,
  campaignId: true, createdAt: true, updatedAt: true,
};
const FALLBACK_KEY = 'outreach_batches_v1';

function isMissingTable(e) {
  return e?.code === 'P2021' || e?.message?.includes('does not exist') || e?.message?.includes('outreachBatch');
}

function countsFrom(leads) {
  const sendable = leads.filter(l => l?.sendable && l?.email);
  return {
    totalCount: leads.length,
    sendableCount: sendable.length,
    touchCount: sendable.reduce((a, l) => a + (l.touches || []).length, 0),
  };
}

const PATCHABLE = ['name', 'status', 'columnMap', 'startDt', 'batchSize', 'touchGapDays', 'campaignId'];

function listShape(batch) {
  const { leads, columnMap, templates, ...rest } = batch;
  return rest;
}

async function loadFallbackBatches() {
  const row = await prisma.setting.findUnique({ where: { key: FALLBACK_KEY } });
  return Array.isArray(row?.value?.batches) ? row.value.batches : [];
}

async function saveFallbackBatches(batches) {
  await prisma.setting.upsert({
    where: { key: FALLBACK_KEY },
    create: { key: FALLBACK_KEY, value: { batches } },
    update: { value: { batches } },
  });
}

async function fallbackList(id) {
  const batches = await loadFallbackBatches();
  if (id) return batches.find(batch => batch.id === id) || null;
  return [...batches].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(listShape);
}

async function fallbackCreate({ name, fileName, columnMap, leads, templates, startDt, batchSize, touchGapDays, createdBy }) {
  const now = new Date().toISOString();
  const batch = {
    id: `outreach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: (name || 'Bulk Outreach').slice(0, 200),
    fileName: fileName ? String(fileName).slice(0, 300) : null,
    status: 'draft',
    columnMap: columnMap || {},
    leads,
    templates: templates || {},
    startDt: startDt || null,
    batchSize: Number(batchSize) || 25,
    touchGapDays: Number(touchGapDays) || 5,
    campaignId: null,
    createdBy: createdBy || null,
    createdAt: now,
    updatedAt: now,
    ...countsFrom(leads),
  };
  const batches = await loadFallbackBatches();
  await saveFallbackBatches([batch, ...batches.filter(b => b.id !== batch.id)].slice(0, 200));
  return batch;
}

async function fallbackPatch(id, data) {
  const batches = await loadFallbackBatches();
  const idx = batches.findIndex(batch => batch.id === id);
  if (idx < 0) return null;
  const next = { ...batches[idx], ...data, updatedAt: new Date().toISOString() };
  batches[idx] = next;
  await saveFallbackBatches(batches);
  return next;
}

async function fallbackGetRaw(id) {
  const batches = await loadFallbackBatches();
  return batches.find(batch => batch.id === id) || null;
}

async function fallbackDelete(id) {
  const batches = await loadFallbackBatches();
  const next = batches.filter(batch => batch.id !== id);
  if (next.length === batches.length) return false;
  await saveFallbackBatches(next);
  return true;
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { id } = req.query || {};
      if (id) {
        let batch;
        try {
          batch = prisma.outreachBatch
            ? await prisma.outreachBatch.findUnique({ where: { id: String(id) } })
            : await fallbackList(String(id));
        } catch (e) {
          if (!isMissingTable(e)) throw e;
          batch = await fallbackList(String(id));
        }
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        return res.json({ ok: true, batch });
      }
      let batches;
      try {
        batches = prisma.outreachBatch
          ? await prisma.outreachBatch.findMany({ select: LIST_SELECT, orderBy: { createdAt: 'desc' } })
          : await fallbackList();
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        batches = await fallbackList();
      }
      return res.json({ ok: true, batches });
    }

    if (req.method === 'POST') {
      const { name, fileName, columnMap, leads, templates, startDt, batchSize, touchGapDays, createdBy } = req.body || {};
      if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({ error: 'leads array required' });
      }
      let batch;
      try {
        batch = prisma.outreachBatch ? await prisma.outreachBatch.create({
          data: {
            name: (name || 'Bulk Outreach').slice(0, 200),
            fileName: fileName ? String(fileName).slice(0, 300) : null,
            columnMap: columnMap || {},
            leads,
            templates: templates || {},
            startDt: startDt || null,
            batchSize: Number(batchSize) || 25,
            touchGapDays: Number(touchGapDays) || 5,
            createdBy: createdBy || null,
            ...countsFrom(leads),
          },
        }) : await fallbackCreate({ name, fileName, columnMap, leads, templates, startDt, batchSize, touchGapDays, createdBy });
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        batch = await fallbackCreate({ name, fileName, columnMap, leads, templates, startDt, batchSize, touchGapDays, createdBy });
      }
      return res.json({ ok: true, batch });
    }

    if (req.method === 'PATCH') {
      const { id, leads, templates, ...fields } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const data = {};
      for (const k of PATCHABLE) if (fields[k] !== undefined) data[k] = fields[k];
      if (Array.isArray(leads)) { data.leads = leads; Object.assign(data, countsFrom(leads)); }
      if (templates && typeof templates === 'object') data.templates = templates;
      if (Object.keys(data).length === 0) return res.status(400).json({ error: 'no updatable fields provided' });
      let batch;
      try {
        batch = prisma.outreachBatch
          ? await prisma.outreachBatch.update({ where: { id: String(id) }, data })
          : await fallbackPatch(String(id), data);
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        batch = await fallbackPatch(String(id), data);
      }
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      return res.json({ ok: true, batch });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      let existing;
      try {
        existing = prisma.outreachBatch
          ? await prisma.outreachBatch.findUnique({ where: { id: String(id) }, select: { status: true } })
          : await fallbackGetRaw(String(id));
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        existing = await fallbackGetRaw(String(id));
      }
      if (!existing) return res.status(404).json({ error: 'Batch not found' });
      if (existing.status === 'approved') {
        return res.status(409).json({ error: 'This upload is already approved and linked to a running campaign — manage it from Campaigns instead of deleting it here.' });
      }
      try {
        if (prisma.outreachBatch) await prisma.outreachBatch.delete({ where: { id: String(id) } });
        else await fallbackDelete(String(id));
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        await fallbackDelete(String(id));
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[outreach/batches]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
