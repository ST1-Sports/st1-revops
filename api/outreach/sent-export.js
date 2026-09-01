/**
 * GET /api/outreach/sent-export
 * CSV of everyone Brad already emailed from Bulk Outreach.
 *
 * ?unique=1 (default) — one row per email, for pasting into a new sheet to dedupe
 * ?unique=0 — every sent touch
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import {
  sentRowsFromBatches,
  uniqueSentByEmail,
  toCsv,
  SENT_ALL_HEADERS,
  SENT_UNIQUE_HEADERS,
} from '../_lib/outreachSent.js';

const FALLBACK_KEY = 'outreach_batches_v1';

function isMissingTable(e) {
  return e?.code === 'P2021' || e?.message?.includes('does not exist') || e?.message?.includes('outreachBatch');
}

async function loadBatches() {
  try {
    if (prisma.outreachBatch) {
      return await prisma.outreachBatch.findMany({ orderBy: { createdAt: 'desc' } });
    }
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const row = await prisma.setting.findUnique({ where: { key: FALLBACK_KEY } }).catch(() => null);
  return Array.isArray(row?.value?.batches) ? row.value.batches : [];
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const unique = String(req.query?.unique ?? '1') !== '0';
    const rows = sentRowsFromBatches(await loadBatches());
    const out = unique ? uniqueSentByEmail(rows) : rows;
    const headers = unique ? SENT_UNIQUE_HEADERS : SENT_ALL_HEADERS;
    const filename = unique ? 'brad-bulk-sent-unique.csv' : 'brad-bulk-sent-all.csv';
    const csv = toCsv(headers, out);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'X-Sent-Count, X-Send-Rows, Content-Disposition');
    res.setHeader('X-Sent-Count', String(out.length));
    res.setHeader('X-Send-Rows', String(rows.length));
    return res.status(200).send(csv);
  } catch (e) {
    console.error('[outreach/sent-export]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
