/**
 * /api/team-store/ap — the weekly Accounts Payable screen.
 *
 * GET   → { summary, byPayee } computed over EVERY synced payable (so the
 *         top line and by-payee table are always the current whole-book
 *         numbers, unaffected by the line-detail filters below), plus
 *         `payables`: the line-detail list filtered by month/payee/store/
 *         status/orderNumber, each carrying its own `payment` if recorded.
 * POST  → record one payment across a selection of payables. Body:
 *         { payableIds: [...], paidOn, method, reference, note, recordedById }.
 *         Writes one PayablePayment per id (upsert, so re-recording replaces
 *         rather than duplicates) so a partial-batch payment stays
 *         attributable per payable.
 * DELETE ?payableId=X → undo: removes that one PayablePayment, restoring the
 *         payable to outstanding.
 *
 * This never writes back to the ST1 admin app — no payable write endpoint
 * was found there, so this is a one-way sync (TeamStoreSync populates these
 * rows; RevOps only records payment against them locally).
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { apSummary, rollupApByPayee } from '../../src/lib/teamStoreSettlement.js';

function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return null;
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

function applyLineFilters(payables, { month, payee, store, status, orderNumber }) {
  let out = payables;
  const range = month ? monthRange(month) : null;
  if (range) {
    out = out.filter(p => p.orderPaidAt && new Date(p.orderPaidAt) >= range.start && new Date(p.orderPaidAt) < range.end);
  }
  if (payee) out = out.filter(p => p.payeeLabel === payee);
  if (store) out = out.filter(p => p.storeName === store);
  if (status === 'outstanding') out = out.filter(p => !p.payment);
  if (status === 'paid') out = out.filter(p => !!p.payment);
  if (orderNumber) {
    const needle = String(orderNumber).toLowerCase();
    out = out.filter(p => (p.referenceNumber || '').toLowerCase().includes(needle));
  }
  return out;
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { month, payee, store, status, orderNumber } = req.query || {};
      const payables = await prisma.teamStorePayable.findMany({
        include: { payment: true },
        orderBy: { orderPaidAt: 'desc' },
      });
      const summary = apSummary(payables);
      const byPayee = rollupApByPayee(payables);
      const filtered = applyLineFilters(payables, { month, payee, store, status, orderNumber });
      return res.json({ ok: true, summary, byPayee, payables: filtered });
    }

    if (req.method === 'POST') {
      const { payableIds, paidOn, method, reference, note, recordedById } = req.body || {};
      if (!Array.isArray(payableIds) || payableIds.length === 0) {
        return res.status(400).json({ error: 'payableIds required' });
      }
      if (!paidOn) return res.status(400).json({ error: 'paidOn required' });

      const payables = await prisma.teamStorePayable.findMany({ where: { id: { in: payableIds } } });
      const payments = await Promise.all(payables.map(p => prisma.payablePayment.upsert({
        where: { payableKey: p.id },
        create: {
          payableKey: p.id,
          paidOn: new Date(paidOn),
          method: method || null,
          reference: reference || null,
          amountPaid: p.amount,
          note: note || null,
          recordedById: recordedById || null,
        },
        update: {
          paidOn: new Date(paidOn),
          method: method || null,
          reference: reference || null,
          amountPaid: p.amount,
          note: note || null,
          recordedById: recordedById || null,
        },
      })));
      return res.json({ ok: true, count: payments.length });
    }

    if (req.method === 'DELETE') {
      const { payableId } = req.query || {};
      if (!payableId) return res.status(400).json({ error: 'payableId required' });
      try {
        await prisma.payablePayment.delete({ where: { payableKey: String(payableId) } });
      } catch (e) {
        if (e.code !== 'P2025') throw e; // already not paid — undo is a no-op, not an error
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[team-store/ap]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
