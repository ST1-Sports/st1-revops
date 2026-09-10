import { prisma } from './prisma.js';
import { updateSettingSafely } from './settingSync.js';

const FALLBACK_KEY = 'outreach_batches_v1';

function isMissingTable(e) {
  return e?.code === 'P2021' || e?.message?.includes('does not exist') || e?.message?.includes('outreachBatch');
}

export async function loadAllOutreachBatches() {
  try {
    if (prisma.outreachBatch) {
      return await prisma.outreachBatch.findMany({ orderBy: { createdAt: 'asc' } });
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const row = await prisma.setting.findUnique({ where: { key: FALLBACK_KEY } }).catch(() => null);
  const batches = Array.isArray(row?.value?.batches) ? row.value.batches : [];
  return [...batches].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function saveOutreachBatchLeads(id, leads, extra = {}) {
  const data = { leads, ...extra };
  try {
    if (prisma.outreachBatch) {
      return await prisma.outreachBatch.update({ where: { id: String(id) }, data });
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  let updated = null;
  await updateSettingSafely(FALLBACK_KEY, async (value) => {
    const batches = Array.isArray(value?.batches) ? value.batches : [];
    const idx = batches.findIndex(b => b.id === id);
    if (idx < 0) { updated = null; return { batches }; }
    batches[idx] = { ...batches[idx], ...data, updatedAt: new Date().toISOString() };
    updated = batches[idx];
    return { batches };
  });
  return updated;
}
