/**
 * /api/team-store/statement — the month-end settlement statement.
 *
 * GET ?month=YYYY-MM  → { statement } for that calendar month (bucketed the
 *   same way rollupByMonth does: order.paidAt, falling back to createdAt).
 *   Feeds the whole page — money in/out, by-school, school×payee, owed-by-
 *   payee, fee audit, exceptions, per-order detail. Add &payee=Label to also
 *   get `payeeSlice`: that one payee's own status + per-school breakdown,
 *   for the print/partner view — the full statement is still returned
 *   alongside it, filtering to one payee is a display concern, not a
 *   reason to refetch.
 *
 * Pulls every synced order/line/payable rather than a DB-side date filter —
 * buildStatement does its own month scoping so the exact same paidAt-then-
 * createdAt rule applies here as everywhere else this figure is reported.
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { buildStatement, statementForPayee } from '../../src/lib/teamStoreSettlement.js';

async function currentConfig(month) {
  const [y, m] = String(month).split('-').map(Number);
  const monthEnd = y && m ? new Date(Date.UTC(y, m, 1)) : new Date();
  const config = await prisma.settlementConfig.findFirst({
    where: { effectiveFrom: { lte: monthEnd } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (config) return config;
  return (await prisma.settlementConfig.findFirst({ orderBy: { effectiveFrom: 'asc' } }))
    || { feeRate: 0.035, feePerItem: 2.00 };
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { month, payee } = req.query || {};
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month required, as YYYY-MM' });
    }

    const [orders, lines, payables, config] = await Promise.all([
      prisma.teamStoreOrder.findMany(),
      prisma.teamStoreOrderLine.findMany(),
      prisma.teamStorePayable.findMany({ include: { payment: true } }),
      currentConfig(month),
    ]);

    const statement = buildStatement({ orders, lines, payables, config, month });
    const payeeSlice = payee ? statementForPayee(statement, payee) : null;

    return res.json({ ok: true, statement, payeeSlice });
  } catch (e) {
    console.error('[team-store/statement]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
