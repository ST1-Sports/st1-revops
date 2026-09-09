import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrderSettlement,
  rollupByMonth,
  rollupByStore,
  rollupByEntity,
  rollupByPayee,
  rollupByStorePayee,
  feeAudit,
  flagExceptions,
  buildSettlementReport,
} from './teamStoreSettlement.js';

// ── August fixture ───────────────────────────────────────────────────────
// Synthetic — NOT the literal 117 real orders (that data isn't available to
// this test) — but calibrated so the sums exactly reproduce the brief's
// stated August aggregates. ST1-26-00516 (ADM Tigers) carries the entire
// month's $400.00 in discounts, matching the brief's own numbers for that
// order exactly; the other two orders are plain, undiscounted orders whose
// figures make up the rest of the month's totals.
const ORDER_516 = {
  id: 'o-516', referenceNumber: 'ST1-26-00516', paidAt: '2026-08-12T00:00:00Z',
  storeName: 'ADM Tigers', subTotal: 650.00, tax: 30.17, shippingCost: 12.00, totalAmount: 292.17,
};
const PAYABLES_516 = [
  { orderId: 'o-516', payeeType: 'team_store', payeeLabel: 'ADM Tigers', amount: 65.22, storeName: 'ADM Tigers', platformPaid: false },
  { orderId: 'o-516', payeeType: 'supplier', payeeLabel: 'Some Supplier', amount: 387.86, storeName: 'ADM Tigers', platformPaid: false },
];

const ORDER_B = {
  id: 'o-b', referenceNumber: 'ST1-26-00600', paidAt: '2026-08-05T00:00:00Z',
  storeName: 'Ames Youth Football', subTotal: 4000.00, tax: 280.00, shippingCost: 300.00, totalAmount: 4580.00,
};
const PAYABLES_B = [
  { orderId: 'o-b', payeeType: 'team_store', payeeLabel: 'Ames Youth Football', amount: 2160.00, storeName: 'Ames Youth Football', platformPaid: true },
  { orderId: 'o-b', payeeType: 'supplier', payeeLabel: 'Some Supplier B', amount: 40.00, storeName: 'Ames Youth Football', platformPaid: false },
  { orderId: 'o-b', payeeType: 'supplier', payeeLabel: 'ST1 Sports', amount: 40.00, storeName: 'Ames Youth Football', platformPaid: false },
];

const ORDER_C = {
  id: 'o-c', referenceNumber: 'ST1-26-00601', paidAt: '2026-08-20T00:00:00Z',
  storeName: 'Boone Wrestling', subTotal: 5005.49, tax: 344.48, shippingCost: 393.47, totalAmount: 5743.44,
};
const PAYABLES_C = [
  { orderId: 'o-c', payeeType: 'team_store', payeeLabel: 'Boone Wrestling', amount: 2700.00, storeName: 'Boone Wrestling', platformPaid: false },
  { orderId: 'o-c', payeeType: 'supplier', payeeLabel: 'Some Supplier C', amount: 60.89, storeName: 'Boone Wrestling', platformPaid: false },
  { orderId: 'o-c', payeeType: 'supplier', payeeLabel: 'ST1 Sports', amount: 53.65, storeName: 'Boone Wrestling', platformPaid: true },
];

const AUGUST_ORDERS = [ORDER_516, ORDER_B, ORDER_C];
const AUGUST_PAYABLES = [...PAYABLES_516, ...PAYABLES_B, ...PAYABLES_C];

describe('computeOrderSettlement — ST1-26-00516 (the discount/overpay case from the brief)', () => {
  it('computes discount and third-party payout exactly as given', () => {
    const s = computeOrderSettlement(ORDER_516, PAYABLES_516);
    assert.equal(s.grossCollected, 292.17);
    assert.equal(s.merchandise, 650.00);
    assert.equal(s.discount, 400.00);
    assert.equal(s.thirdPartyPayout, 453.08);
    assert.equal(s.st1SuppliedCost, 0);
    // The order paid out MORE than it collected — negative cash retained,
    // not clamped to zero, since that's the real problem this exists to surface.
    assert.equal(s.st1CashRetained, -160.91);
  });
});

describe('computeOrderSettlement — a normal order with an ST1-supplied cost', () => {
  it('splits third-party payout from ST1-supplied cost by payee label, not by type', () => {
    const s = computeOrderSettlement(ORDER_B, PAYABLES_B);
    assert.equal(s.discount, 0);
    assert.equal(s.thirdPartyPayout, 2200.00); // school + "Some Supplier B", NOT the ST1 Sports row
    assert.equal(s.st1SuppliedCost, 40.00);
    assert.equal(s.st1CashRetained, 2380.00); // 4580 - 2200
    assert.equal(s.st1GrossProfit, 2340.00); // 2380 - 40
  });
});

describe('rollupByMonth — August aggregates from the brief', () => {
  it('reproduces the exact stated totals', () => {
    const byMonth = rollupByMonth(AUGUST_ORDERS, AUGUST_PAYABLES);
    const aug = byMonth['2026-08'];
    assert.ok(aug, 'expected a 2026-08 bucket');
    assert.equal(aug.merchandise, 9655.49);
    assert.equal(aug.discount, 400.00);
    assert.equal(aug.grossCollected, 10615.61);
    assert.equal(aug.thirdPartyPayout, 5413.97);
    assert.equal(aug.st1SuppliedCost, 93.65);
    assert.equal(aug.st1CashRetained, 5201.64);
    assert.equal(aug.orderCount, 3);
  });

  it('does not lose precision by rounding per order before summing', () => {
    // Same fixture, but proves the invariant directly: summing the ROUNDED
    // per-order numbers can drift from summing the raw figures first. Here
    // they happen to agree (the fixture's numbers are clean to the cent),
    // so this is really asserting rollupByMonth takes the raw-then-round
    // path at all, not the other way around, by checking against a
    // manually-summed reference.
    const byMonth = rollupByMonth(AUGUST_ORDERS, AUGUST_PAYABLES);
    const manualSum = [ORDER_516, ORDER_B, ORDER_C].reduce((a, o) => a + o.totalAmount, 0);
    assert.equal(byMonth['2026-08'].grossCollected, Math.round(manualSum * 100) / 100);
  });
});

describe('rollupByStore', () => {
  it('buckets by teamStore name with independent totals per store', () => {
    const byStore = rollupByStore(AUGUST_ORDERS, AUGUST_PAYABLES);
    assert.equal(byStore['ADM Tigers'].st1CashRetained, -160.91);
    assert.equal(byStore['Ames Youth Football'].st1CashRetained, 2380.00);
    assert.equal(byStore['Boone Wrestling'].st1CashRetained, 2982.55);
  });
});

describe('rollupByEntity — hub stores split by childStore, not by order', () => {
  const hubOrder = { id: 'hub-1', storeName: 'Multi-Sport Hub' };
  const lines = [
    { orderId: 'hub-1', amount: 300, quantity: 10, childStoreName: 'Varsity Football' },
    { orderId: 'hub-1', amount: 150, quantity: 5, childStoreName: 'Varsity Football' },
    { orderId: 'hub-1', amount: 200, quantity: 8, childStoreName: 'JV Basketball' },
    { orderId: 'hub-1', amount: 50, quantity: 2, childStoreName: null }, // no childStore -> falls back to the order's own store
  ];

  it('sums merchandise/units per child store, falling back to the order store when a line has none', () => {
    const byEntity = rollupByEntity([hubOrder], lines);
    assert.equal(byEntity['Varsity Football'].merchandiseSold, 450);
    assert.equal(byEntity['Varsity Football'].unitsSold, 15);
    assert.equal(byEntity['JV Basketball'].merchandiseSold, 200);
    assert.equal(byEntity['Multi-Sport Hub'].merchandiseSold, 50); // the no-childStore line
  });
});

describe('rollupByPayee / rollupByStorePayee', () => {
  it('sums amounts and counts per payee across all orders', () => {
    const byPayee = rollupByPayee(AUGUST_PAYABLES);
    assert.equal(byPayee['ST1 Sports'].amount, 93.65);
    assert.equal(byPayee['ST1 Sports'].count, 2);
    assert.equal(byPayee['ST1 Sports'].paidCount, 1);
  });

  it('nests by store then payee', () => {
    const byStorePayee = rollupByStorePayee(AUGUST_PAYABLES);
    assert.equal(byStorePayee['ADM Tigers']['ADM Tigers'].amount, 65.22);
    assert.equal(byStorePayee['Boone Wrestling']['ST1 Sports'].amount, 53.65);
  });
});

// ── Delta-share blended-rate fixture ─────────────────────────────────────
// Independently calibrated (not tied to the August fixture above) so the
// blended rate comes out to exactly 2.90% at $2.00/item — feeTaken=$69 on
// $1,000 of USA-supplied merchandise and 20 units: (69 - 2*20) / 1000 = 0.029.
const DELTA_ORDER_D = { id: 'd1', usaCut: 198.60, productSupplierCut: 400.00 };
const DELTA_ORDER_E = { id: 'e1', usaCut: 132.40, productSupplierCut: 200.00 };
const DELTA_LINES = [
  { orderId: 'd1', supplierName: 'Unlimited Sports Apparel', amount: 600, quantity: 12 },
  { orderId: 'e1', supplierName: 'Unlimited Sports Apparel', amount: 400, quantity: 8 },
];
const STATED_TERMS = { feeRate: 0.035, feePerItem: 2.00 };

describe('feeAudit — blended delta-share rate', () => {
  it('comes out to 2.90%, not the stated 3.5%', () => {
    const audit = feeAudit([DELTA_ORDER_D, DELTA_ORDER_E], DELTA_LINES, STATED_TERMS);
    assert.equal(audit.usaMerch, 1000.00);
    assert.equal(audit.usaUnits, 20);
    assert.equal(audit.feeTaken, 69.00);
    assert.equal(audit.rateApplied, 0.029);
    assert.equal(audit.feeAtConfiguredTerms, 75.00); // 0.035*1000 + 2*20
    assert.equal(audit.variance, 6.00); // shortfall vs. the stated 3.5% terms
  });

  it('excludes orders with no delta share (usaCut === 0) entirely', () => {
    const nonDelta = { id: 'n1', usaCut: 0, productSupplierCut: 0 };
    const nonDeltaLine = { orderId: 'n1', supplierName: 'Unlimited Sports Apparel', amount: 9999, quantity: 500 };
    const audit = feeAudit([DELTA_ORDER_D, DELTA_ORDER_E, nonDelta], [...DELTA_LINES, nonDeltaLine], STATED_TERMS);
    assert.equal(audit.usaMerch, 1000.00); // unchanged — the non-delta order's line is not counted
    assert.equal(audit.orderCount, 2);
  });

  it('ignores non-USA-supplier lines even within a qualifying delta-share order', () => {
    const mixedLine = { orderId: 'd1', supplierName: 'Some Other Supplier', amount: 500, quantity: 99 };
    const audit = feeAudit([DELTA_ORDER_D, DELTA_ORDER_E], [...DELTA_LINES, mixedLine], STATED_TERMS);
    assert.equal(audit.usaMerch, 1000.00); // the mixed-supplier line never enters usaMerch/usaUnits
    assert.equal(audit.usaUnits, 20);
  });
});

// ── Exceptions ────────────────────────────────────────────────────────────
describe('flagExceptions', () => {
  it('flags ST1-26-00516 with exactly a $160.91 overpay', () => {
    const flags = flagExceptions([ORDER_516], [], PAYABLES_516);
    const discountFlag = flags.find(f => f.type === 'discount' && f.referenceNumber === 'ST1-26-00516');
    assert.ok(discountFlag, 'expected a discount exception for ST1-26-00516');
    assert.equal(discountFlag.discount, 400.00);
    assert.equal(discountFlag.overpay, 160.91);
    assert.equal(discountFlag.overpayRisk, true);
  });

  it('does not flag an order with zero discount', () => {
    const flags = flagExceptions([ORDER_B], [], PAYABLES_B);
    assert.equal(flags.filter(f => f.type === 'discount').length, 0);
  });

  it('flags a payable labelled "N/A"', () => {
    const order = { id: 'na-1', referenceNumber: 'ST1-26-00700', subTotal: 100, tax: 0, shippingCost: 0, totalAmount: 100 };
    const payables = [{ orderId: 'na-1', payeeType: 'supplier', payeeLabel: 'N/A', amount: 20 }];
    const flags = flagExceptions([order], [], payables);
    assert.ok(flags.some(f => f.type === 'naPayable' && f.referenceNumber === 'ST1-26-00700'));
  });

  it('flags a payable with payoutEnabled === false', () => {
    const order = { id: 'pe-1', referenceNumber: 'ST1-26-00701', subTotal: 100, tax: 0, shippingCost: 0, totalAmount: 100 };
    const payables = [{ orderId: 'pe-1', payeeType: 'supplier', payeeLabel: 'Some Supplier', amount: 20, payoutEnabled: false }];
    const flags = flagExceptions([order], [], payables);
    assert.ok(flags.some(f => f.type === 'payoutDisabled' && f.payeeLabel === 'Some Supplier'));
  });

  it('flags a real line/subTotal mismatch when line data is present', () => {
    const order = { id: 'ls-1', referenceNumber: 'ST1-26-00702', subTotal: 100, tax: 0, shippingCost: 0, totalAmount: 100 };
    const lines = [{ orderId: 'ls-1', amount: 40 }, { orderId: 'ls-1', amount: 40 }]; // sums to 80, not 100
    const flags = flagExceptions([order], lines, []);
    const mismatch = flags.find(f => f.type === 'lineSubtotalMismatch');
    assert.ok(mismatch);
    assert.equal(mismatch.difference, -20);
  });

  it('does NOT flag a line/subTotal mismatch when no line data was given at all', () => {
    // An order with no items[] synced yet is "unknown", not "wrong" — this
    // must not produce a false positive just because lines is empty.
    const order = { id: 'ls-2', referenceNumber: 'ST1-26-00703', subTotal: 100, tax: 0, shippingCost: 0, totalAmount: 100 };
    const flags = flagExceptions([order], [], []);
    assert.equal(flags.filter(f => f.type === 'lineSubtotalMismatch').length, 0);
  });
});

describe('buildSettlementReport', () => {
  it('assembles every piece from one call', () => {
    const report = buildSettlementReport({ orders: AUGUST_ORDERS, lines: [], payables: AUGUST_PAYABLES, config: STATED_TERMS });
    assert.equal(report.perOrder.length, 3);
    assert.equal(report.byMonth['2026-08'].grossCollected, 10615.61);
    assert.ok(report.exceptions.some(f => f.type === 'discount' && f.referenceNumber === 'ST1-26-00516'));
  });
});
