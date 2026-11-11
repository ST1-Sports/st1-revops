/**
 * Team Store Settlement sync — pulls orders/lines/payables from the ST1
 * admin app into the local TeamStoreOrder/TeamStoreOrderLine/TeamStorePayable
 * tables. Safe to re-run any time: everything here is an upsert keyed on a
 * stable identifier, and PayablePayment (RevOps' own payment record) is a
 * separate table this never writes to, so re-syncing can't duplicate a row
 * or disturb a recorded payment.
 *
 * Runnable two ways with identical behavior: api/team-store/sync.js (POST,
 * on-demand from the UI) and api/cron/team-store-sync.js (nightly) both just
 * call runSync().
 */

import { prisma } from './prisma.js';
import { createSession } from './st1AdminAuth.js';
import { fetchAllOrderSummaries, fetchOrderDetail, fetchDecorationCosts } from './teamStoreAdmin.js';

const DETAIL_CONCURRENCY = 5; // sequential detail calls (~90s/month) outran the token; a pool of 5 lands a month in ~7s

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The one stable, truly-unique key for a payable: the payables[].id field is
 * the PAYEE's id (a supplier or team store id), not a per-row id — 554
 * payables share 11 ids. referenceNumber + type + a slugged label is unique
 * and stable across re-syncs, and is the primary key of TeamStorePayable.
 */
export function payableKey(referenceNumber, type, label) {
  return `${referenceNumber}~${type}~${slug(label)}`;
}

/**
 * Runs async work over `items` with at most `limit` in flight at once.
 * Order of results matches input order regardless of completion order.
 */
export async function poolMap(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Resolves a decoration cost for one line from the admin app's
 * /admin/decoration_cost reference data. UNVERIFIED — the dollar VALUES in
 * the brief (DTF small $4 / medium $6 / large $8, embroidery $10, screen
 * print $0) are confirmed observations, but the JSON field names below are
 * a best guess pending a live response; adjust the lookups here once seen,
 * nothing else in this file depends on the exact shape.
 */
export function decorationCostFor(design, decorationCosts) {
  if (!design || !decorationCosts) return null;
  const decoration = String(design.decoration || '').toLowerCase().replace(/[^a-z]/g, '');
  if (decoration === 'screenprint') return decorationCosts.screenPrint ?? decorationCosts.screen_print ?? null;
  if (decoration === 'embroidery') return decorationCosts.embroidery ?? null;
  if (decoration === 'dtf') {
    const size = String(design.dtfSizeId || '').toLowerCase();
    if (size.includes('small')) return decorationCosts.dtfSmall ?? decorationCosts.dtf_small ?? null;
    if (size.includes('medium')) return decorationCosts.dtfMedium ?? decorationCosts.dtf_medium ?? null;
    if (size.includes('large')) return decorationCosts.dtfLarge ?? decorationCosts.dtf_large ?? null;
  }
  return null;
}

const orNull = v => (v === undefined || v === null ? null : v);
const toDateOrNull = v => (v ? new Date(v) : null);

function orderFields(detail) {
  const ts = detail.teamStore || {};
  return {
    referenceNumber: detail.referenceNumber,
    createdAt: toDateOrNull(detail.createdAt),
    paidAt: toDateOrNull(detail.paidAt),
    status: detail.status ?? null,
    storeId: ts.id != null ? String(ts.id) : null,
    storeName: ts.name ?? null,
    isUsaStore: !!ts.isUSA,
    tax: orNull(detail.tax),
    shipping: orNull(detail.shippingCost),
    subTotal: orNull(detail.subTotal),
    totalAmount: orNull(detail.totalAmount),
    itemCount: orNull(detail.itemCount),
    unitCount: orNull(detail.unitCount),
    usaCut: orNull(detail.usaCut),
    productSupplierCut: orNull(detail.productSupplierCut),
    teamStoreRevenue: orNull(detail.teamStoreRevenue),
    raw: detail,
    syncedAt: new Date(),
  };
}

/** Upserts one order + its lines + its payables. Returns the payable count upserted. */
async function upsertOrder(detail, decorationCosts) {
  const orderId = String(detail.id);
  const fields = orderFields(detail);

  await prisma.teamStoreOrder.upsert({
    where: { id: orderId },
    create: { id: orderId, ...fields },
    update: fields,
  });

  for (const item of detail.items || []) {
    const tsp = item.teamStoreProduct || {};
    const product = tsp.product || {};
    const design = (tsp.designs || [])[0] || null;
    const lineFields = {
      sku: product.sku ?? null,
      productName: product.name ?? null,
      supplierName: product.supplier?.name ?? null,
      size: item.size ?? null,
      unitPrice: orNull(item.unitPrice),
      quantity: orNull(item.quantity),
      amount: orNull(item.amount),
      baseCost: orNull(product.baseCost),
      decorationCost: orNull(decorationCostFor(design, decorationCosts)),
      childStoreName: item.childStore?.name ?? null,
    };
    await prisma.teamStoreOrderLine.upsert({
      where: { orderId_externalItemId: { orderId, externalItemId: String(item.id) } },
      create: { orderId, externalItemId: String(item.id), ...lineFields },
      update: lineFields,
    });
  }

  let payablesUpserted = 0;
  for (const p of detail.payables || []) {
    const key = payableKey(detail.referenceNumber, p.type, p.label);
    // Only upstream-derived fields are ever written here — PayablePayment
    // (RevOps' own payment record) is a separate table and is never touched
    // by this upsert, on create or on re-sync.
    const payableFields = {
      orderId,
      referenceNumber: detail.referenceNumber,
      payeeType: p.type,
      payeeLabel: p.label,
      payeeExternalId: p.id != null ? String(p.id) : null,
      amount: p.amount ?? 0,
      platformPaid: !!p.paid,
      payoutMethod: p.payoutMethod ?? null,
      payoutEnabled: p.payoutEnabled === undefined ? null : !!p.payoutEnabled,
      storeName: fields.storeName,
      orderPaidAt: fields.paidAt,
      syncedAt: new Date(),
    };
    await prisma.teamStorePayable.upsert({
      where: { id: key },
      create: { id: key, ...payableFields },
      update: payableFields,
    });
    payablesUpserted++;
  }

  return payablesUpserted;
}

/**
 * Runs one full sync: sign in, page the order list, fetch every order's
 * detail (pool of 5), upsert everything, record a TeamStoreSyncRun. Never
 * throws — a hard failure (e.g. signin itself failing) is captured into the
 * run's `errors` and returned rather than left as an unhandled rejection,
 * so both the on-demand endpoint and the cron always get a clean result to
 * report back.
 */
export async function runSync() {
  const run = await prisma.teamStoreSyncRun.create({ data: {} });
  const errors = [];
  let ordersSeen = 0;
  let payablesUpserted = 0;

  try {
    const session = await createSession();
    const [summaries, decorationCosts] = await Promise.all([
      fetchAllOrderSummaries(session),
      fetchDecorationCosts(session).catch(e => {
        errors.push(`decoration_cost: ${e.message}`);
        return null;
      }),
    ]);
    ordersSeen = summaries.length;

    // Each worker's count is returned, not accumulated into a shared
    // variable across an await — poolMap's concurrent workers would
    // otherwise race (read the running total, await, add, write), silently
    // losing counts under concurrency instead of throwing.
    const perOrderCounts = await poolMap(summaries, DETAIL_CONCURRENCY, async summary => {
      try {
        const detail = await fetchOrderDetail(session, summary.id);
        return await upsertOrder(detail, decorationCosts);
      } catch (e) {
        errors.push(`order ${summary.id}${summary.referenceNumber ? ` (${summary.referenceNumber})` : ''}: ${e.message}`);
        return 0;
      }
    });
    payablesUpserted = perOrderCounts.reduce((a, b) => a + b, 0);
  } catch (e) {
    errors.push(`sync run failed: ${e.message}`);
  }

  const finishedAt = new Date();
  await prisma.teamStoreSyncRun.update({
    where: { id: run.id },
    data: { finishedAt, ordersSeen, payablesUpserted, errors },
  });

  return { id: run.id, startedAt: run.startedAt, finishedAt, ordersSeen, payablesUpserted, errors };
}
