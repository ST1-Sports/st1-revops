/**
 * /api/team-store/reconcile — matches real money movement to synced orders
 * and recorded payments. Never marks anything paid on its own: GET proposes
 * matches (persisting them as PENDING_REVIEW SettlementMatch rows so they
 * survive between visits), and only POST {task:'approve'} — an explicit
 * human action — turns one into a confirmation.
 *
 * GET ?direction=in&since&until   → orders matched against Stripe charges
 * GET ?direction=out&since&until  → PayablePayment rows matched against
 *                                    Stripe payouts + Zoho Books' Operating
 *                                    Account bank feed (both normalized to
 *                                    the same generic settled-transaction
 *                                    shape — see src/lib/teamStoreReconcile.js)
 * POST { task:'approve', matchId, approvedById }
 * POST { task:'reject',  matchId }
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { fetchStripeChargesNormalized, fetchStripePayoutsNormalized, fetchOperatingAccountDebitsNormalized } from '../_lib/teamStoreReconcileSources.js';
import { matchOrdersToCharges, summarizeMoneyIn, matchPaymentsToSettledTransactions, confidenceLabel } from '../../src/lib/teamStoreReconcile.js';

const DEFAULT_WINDOW_DAYS = 60;

function windowFrom(query) {
  const until = query.until ? new Date(query.until) : new Date();
  const since = query.since ? new Date(query.since) : new Date(until.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  return { since, until };
}

async function upsertMatchIfPending(data) {
  const where = { sourceType_sourceId_targetType_targetId: { sourceType: data.sourceType, sourceId: data.sourceId, targetType: data.targetType, targetId: data.targetId } };
  const existing = await prisma.settlementMatch.findUnique({ where });
  if (existing && existing.status !== 'PENDING_REVIEW') return existing; // a human already decided this one — never overwrite that
  if (existing) {
    return prisma.settlementMatch.update({
      where,
      data: { sourceAmount: data.sourceAmount, sourceDate: data.sourceDate, feeAmount: data.feeAmount ?? null, counterparty: data.counterparty ?? null, matchConfidence: data.matchConfidence, suggestionBasis: data.suggestionBasis },
    });
  }
  return prisma.settlementMatch.create({ data });
}

async function proposeMoneyIn(since, until) {
  const approvedOrderIds = (await prisma.settlementMatch.findMany({
    where: { direction: 'in', targetType: 'order', status: 'APPROVED' }, select: { targetId: true },
  })).map(m => m.targetId);
  const orders = await prisma.teamStoreOrder.findMany({
    where: { paidAt: { gte: since, lt: until }, id: { notIn: approvedOrderIds } },
  });
  const charges = await fetchStripeChargesNormalized(since, until);
  const { matches, unmatchedOrders, unmatchedCharges } = matchOrdersToCharges(orders, charges);

  for (const m of matches) {
    await upsertMatchIfPending({
      direction: 'in', targetType: 'order', targetId: m.order.id,
      sourceType: 'stripe_charge', sourceId: m.charge.id,
      sourceAmount: m.charge.amount, sourceDate: new Date(m.charge.date),
      feeAmount: m.charge.feeAmount, matchConfidence: m.confidence, suggestionBasis: m.suggestionBasis,
    });
  }

  const rows = await prisma.settlementMatch.findMany({ where: { direction: 'in', targetType: 'order', targetId: { in: orders.map(o => o.id) } } });
  const orderById = new Map(orders.map(o => [o.id, o]));
  const enriched = rows.map(r => ({ ...r, order: orderById.get(r.targetId) || null, confidenceLabel: confidenceLabel(r.matchConfidence) }));

  return {
    proposed: enriched.filter(r => r.status === 'PENDING_REVIEW'),
    confirmed: enriched.filter(r => r.status === 'APPROVED'),
    unmatchedOrders,
    unmatchedCharges,
    summary: summarizeMoneyIn(matches),
  };
}

async function proposeMoneyOut(since, until) {
  const approvedPayableKeys = (await prisma.settlementMatch.findMany({ where: { direction: 'out', targetType: 'payable', status: 'APPROVED' }, select: { targetId: true } })).map(m => m.targetId);
  const payments = await prisma.payablePayment.findMany({
    where: { paidOn: { gte: since, lt: until }, payableKey: { notIn: approvedPayableKeys } },
    include: { payable: true },
  });

  const [payouts, bankDebits] = await Promise.all([
    fetchStripePayoutsNormalized(since, until).catch(() => []),
    fetchOperatingAccountDebitsNormalized(since, until).catch(() => []),
  ]);
  const transactions = [...payouts, ...bankDebits];
  const { matches, unmatchedPayments, unmatchedTransactions } = matchPaymentsToSettledTransactions(payments, transactions);

  for (const m of matches) {
    await upsertMatchIfPending({
      direction: 'out', targetType: 'payable', targetId: m.payment.payableKey,
      sourceType: m.transaction.source, sourceId: m.transaction.id,
      sourceAmount: m.transaction.amount, sourceDate: new Date(m.transaction.date),
      counterparty: m.transaction.counterparty, matchConfidence: m.confidence, suggestionBasis: m.suggestionBasis,
    });
  }

  const rows = await prisma.settlementMatch.findMany({ where: { direction: 'out', targetType: 'payable', targetId: { in: payments.map(p => p.payableKey) } } });
  const paymentByKey = new Map(payments.map(p => [p.payableKey, p]));
  const enriched = rows.map(r => ({ ...r, payment: paymentByKey.get(r.targetId) || null, confidenceLabel: confidenceLabel(r.matchConfidence) }));

  return {
    proposed: enriched.filter(r => r.status === 'PENDING_REVIEW'),
    confirmed: enriched.filter(r => r.status === 'APPROVED'),
    unmatchedPayments,
    unmatchedTransactions,
  };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const { task, matchId, approvedById } = req.body || {};
      if (!matchId) return res.status(400).json({ error: 'matchId required' });
      const match = await prisma.settlementMatch.findUnique({ where: { id: matchId } });
      if (!match) return res.status(404).json({ error: 'Match not found' });

      if (task === 'approve') {
        const updated = await prisma.settlementMatch.update({
          where: { id: matchId },
          data: { status: 'APPROVED', approvedById: approvedById || null, approvedAt: new Date() },
        });
        // Only one confirmed source per target, and one target per source —
        // any other still-pending candidate for either side is now moot.
        await prisma.settlementMatch.updateMany({
          where: { id: { not: matchId }, status: 'PENDING_REVIEW', OR: [
            { targetType: match.targetType, targetId: match.targetId },
            { sourceType: match.sourceType, sourceId: match.sourceId },
          ] },
          data: { status: 'REJECTED' },
        });
        return res.json({ ok: true, match: updated });
      }

      if (task === 'reject') {
        const updated = await prisma.settlementMatch.update({ where: { id: matchId }, data: { status: 'REJECTED' } });
        return res.json({ ok: true, match: updated });
      }

      return res.status(400).json({ error: 'Unknown task' });
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { direction } = req.query || {};
    const { since, until } = windowFrom(req.query || {});
    if (direction === 'in') return res.json({ ok: true, direction, window: { since, until }, ...(await proposeMoneyIn(since, until)) });
    if (direction === 'out') return res.json({ ok: true, direction, window: { since, until }, ...(await proposeMoneyOut(since, until)) });
    return res.status(400).json({ error: "direction must be 'in' or 'out'" });
  } catch (e) {
    console.error('[team-store/reconcile]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
