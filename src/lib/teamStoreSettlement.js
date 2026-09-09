/**
 * Team Store Settlement — pure math, no I/O. Takes orders + lines +
 * payables + fee config (already fetched from wherever they live), returns
 * every number this module reports. Nothing here touches Prisma, fetch, or
 * the clock — a caller resolves what period/config applies and hands in
 * plain arrays.
 *
 * Rounding: every accumulator sums RAW (unrounded) figures across orders;
 * rounding to cents happens exactly once, at the point a number is handed
 * back out (computeOrderSettlement's return value, or a rollup's final
 * totals) — never mid-sum. Per-order rounding before summing has already
 * been observed to move a grand total by up to ~$0.50 across a real month;
 * this avoids that by construction, not by discipline.
 */

const ST1_SUPPLIED_LABEL = 'ST1 Sports';
const USA_SUPPLIER_NAME = 'Unlimited Sports Apparel';
const CENT = 0.005; // treat anything smaller as float noise, not a real amount

export function roundCents(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  return Number(v) || 0;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The per-order figures, unrounded — used internally so rollups accumulate
 * raw values. computeOrderSettlement (below) is the rounded, public version
 * of the same math.
 */
function computeOrderSettlementRaw(order, orderPayables) {
  const totalAmount = num(order.totalAmount);
  const subTotal = num(order.subTotal);
  const tax = num(order.tax);
  const shippingCost = num(order.shippingCost ?? order.shipping);

  const grossCollected = totalAmount;
  const merchandise = subTotal;
  const discount = subTotal + tax + shippingCost - totalAmount; // usually 0

  let thirdPartyPayout = 0;
  let st1SuppliedCost = 0;
  for (const p of orderPayables || []) {
    const amount = num(p.amount);
    if (String(p.payeeLabel || '').trim() === ST1_SUPPLIED_LABEL) st1SuppliedCost += amount;
    else thirdPartyPayout += amount;
  }

  const st1CashRetained = totalAmount - thirdPartyPayout;
  const st1GrossProfit = st1CashRetained - st1SuppliedCost;

  return { grossCollected, merchandise, discount, thirdPartyPayout, st1SuppliedCost, st1CashRetained, st1GrossProfit };
}

function roundSettlement(s) {
  return {
    grossCollected: roundCents(s.grossCollected),
    merchandise: roundCents(s.merchandise),
    discount: roundCents(s.discount),
    thirdPartyPayout: roundCents(s.thirdPartyPayout),
    st1SuppliedCost: roundCents(s.st1SuppliedCost),
    st1CashRetained: roundCents(s.st1CashRetained),
    st1GrossProfit: roundCents(s.st1GrossProfit),
  };
}

/** Per-order settlement, rounded for display. `orderPayables` = just this order's payables. */
export function computeOrderSettlement(order, orderPayables) {
  return { referenceNumber: order.referenceNumber, ...roundSettlement(computeOrderSettlementRaw(order, orderPayables)) };
}

function emptyRawTotals() {
  return { grossCollected: 0, merchandise: 0, discount: 0, thirdPartyPayout: 0, st1SuppliedCost: 0, st1CashRetained: 0, st1GrossProfit: 0, orderCount: 0 };
}

function addRaw(totals, s) {
  return {
    grossCollected: totals.grossCollected + s.grossCollected,
    merchandise: totals.merchandise + s.merchandise,
    discount: totals.discount + s.discount,
    thirdPartyPayout: totals.thirdPartyPayout + s.thirdPartyPayout,
    st1SuppliedCost: totals.st1SuppliedCost + s.st1SuppliedCost,
    st1CashRetained: totals.st1CashRetained + s.st1CashRetained,
    st1GrossProfit: totals.st1GrossProfit + s.st1GrossProfit,
    orderCount: totals.orderCount + 1,
  };
}

function roundRollup(groups) {
  const out = {};
  for (const [key, totals] of groups) {
    out[key] = { ...roundSettlement(totals), orderCount: totals.orderCount };
  }
  return out;
}

/** Shared by every order-keyed rollup below — groups orders by `keyFn`, sums raw, rounds once at the end. */
function rollupOrders(orders, payables, keyFn) {
  const payablesByOrderId = groupBy(payables, p => String(p.orderId));
  const groups = new Map();
  for (const order of orders || []) {
    const key = keyFn(order) ?? 'Unknown';
    const s = computeOrderSettlementRaw(order, payablesByOrderId.get(String(order.id)) || []);
    groups.set(key, addRaw(groups.get(key) || emptyRawTotals(), s));
  }
  return roundRollup(groups);
}

export function rollupByMonth(orders, payables) {
  return rollupOrders(orders, payables, order => monthKey(order.paidAt ?? order.createdAt));
}

export function rollupByStore(orders, payables) {
  return rollupOrders(orders, payables, order => order.storeName || order.storeId || 'Unknown');
}

/**
 * "What did each school sell" has to follow the LINE, not the order — a hub
 * store's order carries multiple child stores (different sports/teams),
 * and only the line knows which one a given item actually belongs to. Falls
 * back to the order's own store name for a line with no childStore.
 */
export function rollupByEntity(orders, lines) {
  const orderById = new Map((orders || []).map(o => [String(o.id), o]));
  const groups = new Map();
  for (const line of lines || []) {
    const order = orderById.get(String(line.orderId));
    const entity = line.childStoreName || order?.storeName || 'Unknown';
    const prev = groups.get(entity) || { merchandiseSold: 0, unitsSold: 0 };
    groups.set(entity, {
      merchandiseSold: prev.merchandiseSold + num(line.amount),
      unitsSold: prev.unitsSold + num(line.quantity),
    });
  }
  const out = {};
  for (const [key, v] of groups) out[key] = { merchandiseSold: roundCents(v.merchandiseSold), unitsSold: v.unitsSold };
  return out;
}

export function rollupByPayee(payables) {
  const groups = new Map();
  for (const p of payables || []) {
    const key = p.payeeLabel || 'Unknown';
    const prev = groups.get(key) || { amount: 0, count: 0, paidCount: 0 };
    groups.set(key, { amount: prev.amount + num(p.amount), count: prev.count + 1, paidCount: prev.paidCount + (p.platformPaid ? 1 : 0) });
  }
  const out = {};
  for (const [key, v] of groups) out[key] = { amount: roundCents(v.amount), count: v.count, paidCount: v.paidCount };
  return out;
}

/** Nested { [storeName]: { [payeeLabel]: {amount,count,paidCount} } } — uses the storeName already denormalized onto each payable. */
export function rollupByStorePayee(payables) {
  const stores = {};
  for (const p of payables || []) {
    const store = p.storeName || 'Unknown';
    const payee = p.payeeLabel || 'Unknown';
    if (!stores[store]) stores[store] = {};
    const prev = stores[store][payee] || { amount: 0, count: 0, paidCount: 0 };
    stores[store][payee] = { amount: prev.amount + num(p.amount), count: prev.count + 1, paidCount: prev.paidCount + (p.platformPaid ? 1 : 0) };
  }
  for (const store of Object.keys(stores)) {
    for (const payee of Object.keys(stores[store])) {
      stores[store][payee].amount = roundCents(stores[store][payee].amount);
    }
  }
  return stores;
}

/**
 * Delta-share fee audit, blended across the whole period rather than
 * per-order: an order whose lines mix an Unlimited Sports Apparel supplier
 * with another supplier can't have its fee base isolated from the order
 * record (productSupplierCut/usaCut are whole-order figures, not
 * per-supplier), so a per-order rate reads as nonsense on a mixed order.
 * Only orders with usaCut > 0 (actual delta-share orders) are included.
 */
export function feeAudit(orders, lines, config) {
  const feeRate = num(config?.feeRate);
  const feePerItem = num(config?.feePerItem);

  const deltaOrders = (orders || []).filter(o => num(o.usaCut) > 0);
  const deltaOrderIds = new Set(deltaOrders.map(o => String(o.id)));
  const usaLines = (lines || []).filter(
    l => deltaOrderIds.has(String(l.orderId)) && String(l.supplierName || '').trim() === USA_SUPPLIER_NAME,
  );

  const usaMerch = usaLines.reduce((a, l) => a + num(l.amount), 0);
  const usaUnits = usaLines.reduce((a, l) => a + num(l.quantity), 0);
  const productSupplierCut = deltaOrders.reduce((a, o) => a + num(o.productSupplierCut), 0);
  const usaCut = deltaOrders.reduce((a, o) => a + num(o.usaCut), 0);

  const feeTaken = usaMerch - productSupplierCut - usaCut;
  const rateApplied = usaMerch ? Math.round(((feeTaken - feePerItem * usaUnits) / usaMerch) * 10000) / 10000 : null;
  const feeAtConfiguredTerms = feeRate * usaMerch + feePerItem * usaUnits;
  const variance = feeAtConfiguredTerms - feeTaken;

  return {
    orderCount: deltaOrders.length,
    usaMerch: roundCents(usaMerch),
    usaUnits,
    productSupplierCut: roundCents(productSupplierCut),
    usaCut: roundCents(usaCut),
    feeTaken: roundCents(feeTaken),
    rateApplied, // a rate, not money — left at 4 decimal places (basis-point precision), not rounded to cents
    configuredFeeRate: feeRate,
    configuredFeePerItem: feePerItem,
    feeAtConfiguredTerms: roundCents(feeAtConfiguredTerms),
    variance: roundCents(variance),
  };
}

/**
 * Flags problems that make an order's numbers untrustworthy at face value.
 * Every check is scoped to what it can actually verify from the given
 * arrays — an order with no lines skips the line/subTotal check rather than
 * flagging a false "missing" mismatch (this cache is populated by an order
 * detail fetch that may not have run yet, not necessarily a real problem).
 */
export function flagExceptions(orders, lines, payables) {
  const payablesByOrderId = groupBy(payables, p => String(p.orderId));
  const linesByOrderId = groupBy(lines, l => String(l.orderId));
  const flags = [];

  for (const order of orders || []) {
    const orderId = String(order.id);
    const orderPayables = payablesByOrderId.get(orderId) || [];
    const orderLines = linesByOrderId.get(orderId) || [];
    const totalAmount = num(order.totalAmount);
    const raw = computeOrderSettlementRaw(order, orderPayables);

    if (Math.abs(raw.discount) > CENT) {
      const overpay = raw.thirdPartyPayout - totalAmount;
      flags.push({
        type: 'discount',
        referenceNumber: order.referenceNumber,
        discount: roundCents(raw.discount),
        thirdPartyPayout: roundCents(raw.thirdPartyPayout),
        totalAmount: roundCents(totalAmount),
        overpay: roundCents(overpay),
        overpayRisk: overpay > CENT,
        message: 'Payout split is computed on pre-discount merchandise — partner payouts can exceed what the customer actually paid.',
      });
    }

    for (const p of orderPayables) {
      if (String(p.payeeLabel || '').trim().toUpperCase() === 'N/A') {
        flags.push({
          type: 'naPayable',
          referenceNumber: order.referenceNumber,
          payeeType: p.payeeType,
          amount: roundCents(num(p.amount)),
          message: 'Payable has no real payee label — needs a human to identify who this is actually owed to.',
        });
      }
      if (p.payoutEnabled === false) {
        flags.push({
          type: 'payoutDisabled',
          referenceNumber: order.referenceNumber,
          payeeLabel: p.payeeLabel,
          amount: roundCents(num(p.amount)),
          message: 'payoutEnabled is false upstream — confirm this payable is actually meant to go out before paying it.',
        });
      }
    }

    if (orderLines.length) {
      const lineSum = orderLines.reduce((a, l) => a + num(l.amount), 0);
      const subTotal = num(order.subTotal);
      if (Math.abs(lineSum - subTotal) > CENT) {
        flags.push({
          type: 'lineSubtotalMismatch',
          referenceNumber: order.referenceNumber,
          lineSum: roundCents(lineSum),
          subTotal: roundCents(subTotal),
          difference: roundCents(lineSum - subTotal),
          message: 'Sum of line amounts does not match the order subTotal.',
        });
      }
    }
  }

  return flags;
}

/** Everything at once — the one call a report endpoint or page actually needs. */
export function buildSettlementReport({ orders = [], lines = [], payables = [], config = {} } = {}) {
  const payablesByOrderId = groupBy(payables, p => String(p.orderId));
  const perOrder = orders.map(order => computeOrderSettlement(order, payablesByOrderId.get(String(order.id)) || []));

  return {
    perOrder,
    byMonth: rollupByMonth(orders, payables),
    byStore: rollupByStore(orders, payables),
    byEntity: rollupByEntity(orders, lines),
    byPayee: rollupByPayee(payables),
    byStorePayee: rollupByStorePayee(payables),
    feeAudit: feeAudit(orders, lines, config),
    exceptions: flagExceptions(orders, lines, payables),
  };
}
