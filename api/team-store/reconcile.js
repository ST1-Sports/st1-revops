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
import { matchOrdersToCharges, summarizeMoneyIn, matchPaymentsToSettledTransactions, confidenceLabel, matchesToReject } from '../../src/lib/teamStoreReconcile.js';

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

function enrichRows(rows, byId, key) {
  return rows.map(r => ({ ...r, [key]: byId.get(r.targetId) || null, confidenceLabel: confidenceLabel(r.matchConfidence) }));
}

function splitByStatus(enriched) {
  return {
    proposed: enriched.filter(r => r.status === 'PENDING_REVIEW'),
    confirmed: enriched.filter(r => r.status === 'APPROVED'),
    // A REJECTED row is a human decision, not silence — surfaced separately
    // so a dismissed charge/transaction reads as "already reviewed, not a
    // real match" rather than looking identical to one nobody has seen yet.
    dismissed: enriched.filter(r => r.status === 'REJECTED'),
  };
}

/**
 * Never re-propose a candidate for a target or a source that already has a
 * confirmed match on the other side — excluding both symmetrically means a
 * confirmed source stops showing up as "unmatched" once its target is
 * excluded, and a confirmed source can't get proposed again for a different
 * target. Only APPROVED rows narrow the candidate pool; a REJECTED source
 * stays eligible to match something genuinely different later.
 */
async function excludeApproved({ direction, targetType, targets, targetIdOf, sources, sourceIdOf }) {
  const approvedRows = await prisma.settlementMatch.findMany({
    where: { direction, targetType, status: 'APPROVED', targetId: { in: targets.map(targetIdOf) } },
  });
  const approvedTargetIds = new Set(approvedRows.map(m => m.targetId));
  const approvedSourceIds = new Set(approvedRows.map(m => m.sourceId));
  return {
    candidateTargets: targets.filter(t => !approvedTargetIds.has(targetIdOf(t))),
    candidateSources: sources.filter(s => !approvedSourceIds.has(sourceIdOf(s))),
  };
}

async function proposeMoneyIn(since, until) {
  // Orders and the Stripe fetch are independent — run them together rather
  // than making the (slower, paginated) Stripe call wait on the DB query.
  const [orders, charges] = await Promise.all([
    prisma.teamStoreOrder.findMany({ where: { paidAt: { gte: since, lt: until } } }),
    fetchStripeChargesNormalized(since, until),
  ]);

  // `orders` itself (the full window) is still what's used below to enrich
  // the DISPLAY, so an already-confirmed order's own APPROVED row still
  // shows up as confirmed instead of disappearing.
  const { candidateTargets: candidateOrders, candidateSources: candidateCharges } = await excludeApproved({
    direction: 'in', targetType: 'order', targets: orders, targetIdOf: o => o.id, sources: charges, sourceIdOf: c => c.id,
  });

  const { matches, unmatchedOrders, unmatchedCharges } = matchOrdersToCharges(candidateOrders, candidateCharges);

  await Promise.all(matches.map(m => upsertMatchIfPending({
    direction: 'in', targetType: 'order', targetId: m.order.id,
    sourceType: 'stripe_charge', sourceId: m.charge.id,
    sourceAmount: m.charge.amount, sourceDate: new Date(m.charge.date),
    feeAmount: m.charge.feeAmount, matchConfidence: m.confidence, suggestionBasis: m.suggestionBasis,
  })));

  const rows = await prisma.settlementMatch.findMany({ where: { direction: 'in', targetType: 'order', targetId: { in: orders.map(o => o.id) } } });
  const enriched = enrichRows(rows, new Map(orders.map(o => [o.id, o])), 'order');

  return {
    ...splitByStatus(enriched),
    unmatchedOrders,
    unmatchedCharges,
    summary: summarizeMoneyIn(matches),
  };
}

async function proposeMoneyOut(since, until) {
  const [payments, payouts, bankDebits] = await Promise.all([
    prisma.payablePayment.findMany({ where: { paidOn: { gte: since, lt: until } }, include: { payable: true } }),
    fetchStripePayoutsNormalized(since, until).catch(() => []),
    fetchOperatingAccountDebitsNormalized(since, until).catch(() => []),
  ]);
  const transactions = [...payouts, ...bankDebits];

  const { candidateTargets: candidatePayments, candidateSources: candidateTransactions } = await excludeApproved({
    direction: 'out', targetType: 'payable', targets: payments, targetIdOf: p => p.payableKey, sources: transactions, sourceIdOf: t => t.id,
  });

  const { matches, unmatchedPayments, unmatchedTransactions } = matchPaymentsToSettledTransactions(candidatePayments, candidateTransactions);

  await Promise.all(matches.map(m => upsertMatchIfPending({
    direction: 'out', targetType: 'payable', targetId: m.payment.payableKey,
    sourceType: m.transaction.source, sourceId: m.transaction.id,
    sourceAmount: m.transaction.amount, sourceDate: new Date(m.transaction.date),
    counterparty: m.transaction.counterparty, matchConfidence: m.confidence, suggestionBasis: m.suggestionBasis,
  })));

  const rows = await prisma.settlementMatch.findMany({ where: { direction: 'out', targetType: 'payable', targetId: { in: payments.map(p => p.payableKey) } } });
  const enriched = enrichRows(rows, new Map(payments.map(p => [p.payableKey, p])), 'payment');

  return {
    ...splitByStatus(enriched),
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
        // Scoped only by `direction` (structural) — matchesToReject is what
        // actually decides which of these compete for the same target or
        // source, not this query, so the rule can change in one place.
        const pendingCandidates = await prisma.settlementMatch.findMany({
          where: { direction: match.direction, status: 'PENDING_REVIEW', id: { not: matchId } },
        });
        const rejectIds = matchesToReject(pendingCandidates, match);
        if (rejectIds.length) {
          await prisma.settlementMatch.updateMany({ where: { id: { in: rejectIds } }, data: { status: 'REJECTED' } });
        }
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
