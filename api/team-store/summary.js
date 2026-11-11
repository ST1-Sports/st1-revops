/**
 * /api/team-store/summary — per-store performance for the Account page's
 * team store card: orders, revenue collected, ST1's team-store revenue
 * share, and what's still outstanding vs. already paid out to the school.
 *
 * GET ?storeName=X
 *
 * Revenue share uses TeamStoreOrder.teamStoreRevenue directly — the admin
 * app already computes and stores this per order, so this just sums it
 * rather than re-deriving it from payables (that's what
 * src/lib/teamStoreSettlement.js's fuller rollupByStore is for, when the
 * full cost/payout breakdown is needed instead of this one summary number).
 *
 * "Outstanding to school" sums TeamStorePayable rows for this store with
 * payeeType === 'team_store' (the admin app's own payee classification for
 * the payout going to the school/team itself, as opposed to a supplier or
 * production payable) that don't yet have a RevOps PayablePayment attached —
 * same "isPaidInRevOps" rule the AP screen uses, just scoped to one store.
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const storeName = String(req.query?.storeName || '').trim();
  if (!storeName) return res.status(400).json({ error: 'storeName required' });

  try {
    const [orders, payables] = await Promise.all([
      prisma.teamStoreOrder.findMany({
        where: { storeName },
        select: { totalAmount: true, teamStoreRevenue: true, unitCount: true },
      }),
      prisma.teamStorePayable.findMany({
        where: { storeName, payeeType: 'team_store' },
        select: { amount: true, payment: { select: { payableKey: true } } },
      }),
    ]);

    let grossCollected = 0, revenueShare = 0, unitCount = 0;
    for (const o of orders) {
      grossCollected += Number(o.totalAmount || 0);
      revenueShare += Number(o.teamStoreRevenue || 0);
      unitCount += Number(o.unitCount || 0);
    }

    let outstandingToSchool = 0, paidToSchool = 0;
    for (const p of payables) {
      const amount = Number(p.amount || 0);
      if (p.payment) paidToSchool += amount;
      else outstandingToSchool += amount;
    }

    return res.json({
      ok: true,
      storeName,
      orderCount: orders.length,
      unitCount,
      grossCollected: round2(grossCollected),
      revenueShare: round2(revenueShare),
      outstandingToSchool: round2(outstandingToSchool),
      paidToSchool: round2(paidToSchool),
    });
  } catch (err) {
    console.error('[team-store/summary]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
