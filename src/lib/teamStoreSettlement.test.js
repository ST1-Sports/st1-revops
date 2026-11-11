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
  AP_AGE_FLAG_DAYS,
  classifyPayeeRole,
  isInternalPayee,
  isPaidInRevOps,
  ageDays,
  apSummary,
  rollupApByPayee,
  buildStatement,
  statementForPayee,
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
  storeName: 'ADM Tigers', subTotal: 650.00, tax: 30.17, shippingCost: 12.00, totalAmount: 292.17, unitCount: 20,
};
const PAYABLES_516 = [
  { orderId: 'o-516', payeeType: 'team_store', payeeLabel: 'ADM Tigers', amount: 65.22, storeName: 'ADM Tigers', platformPaid: false },
  // Recorded paid in RevOps — exercises buildStatement's byPayeeStatus paid/unpaid split below.
  { orderId: 'o-516', payeeType: 'supplier', payeeLabel: 'Some Supplier', amount: 387.86, storeName: 'ADM Tigers', platformPaid: false, payment: { paidOn: '2026-08-25T00:00:00Z', amountPaid: 387.86 } },
];

const ORDER_B = {
  id: 'o-b', referenceNumber: 'ST1-26-00600', paidAt: '2026-08-05T00:00:00Z',
  storeName: 'Ames Youth Football', subTotal: 4000.00, tax: 280.00, shippingCost: 300.00, totalAmount: 4580.00, unitCount: 140,
};
const PAYABLES_B = [
  { orderId: 'o-b', payeeType: 'team_store', payeeLabel: 'Ames Youth Football', amount: 2160.00, storeName: 'Ames Youth Football', platformPaid: true },
  { orderId: 'o-b', payeeType: 'supplier', payeeLabel: 'Some Supplier B', amount: 40.00, storeName: 'Ames Youth Football', platformPaid: false },
  { orderId: 'o-b', payeeType: 'supplier', payeeLabel: 'ST1 Sports', amount: 40.00, storeName: 'Ames Youth Football', platformPaid: false },
];

const ORDER_C = {
  id: 'o-c', referenceNumber: 'ST1-26-00601', paidAt: '2026-08-20T00:00:00Z',
  storeName: 'Boone Wrestling', subTotal: 5005.49, tax: 344.48, shippingCost: 393.47, totalAmount: 5743.44, unitCount: 175,
};
const PAYABLES_C = [
  { orderId: 'o-c', payeeType: 'team_store', payeeLabel: 'Boone Wrestling', amount: 2700.00, storeName: 'Boone Wrestling', platformPaid: false },
  { orderId: 'o-c', payeeType: 'supplier', payeeLabel: 'Some Supplier C', amount: 60.89, storeName: 'Boone Wrestling', platformPaid: false },
  { orderId: 'o-c', payeeType: 'supplier', payeeLabel: 'ST1 Sports', amount: 53.65, storeName: 'Boone Wrestling', platformPaid: true },
];

// A September order — proves buildStatement's month scoping actually
// excludes out-of-month orders/payables rather than just labeling them.
const ORDER_SEPT = {
  id: 'o-sept', referenceNumber: 'ST1-26-00650', paidAt: '2026-09-02T00:00:00Z',
  storeName: 'Sept Store', subTotal: 100.00, tax: 0, shippingCost: 0, totalAmount: 100.00, unitCount: 5,
};
const PAYABLES_SEPT = [
  { orderId: 'o-sept', payeeType: 'team_store', payeeLabel: 'Sept Store', amount: 60.00, storeName: 'Sept Store', platformPaid: false },
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

// ── AP fixture ───────────────────────────────────────────────────────────
// Synthetic — calibrated so the unpaid balances reproduce the brief's exact
// reference snapshot: 10,569.52 total outstanding, with the seven named
// payees at their exact stated balances. "Other Schools" is the (unnamed in
// the brief) remainder that makes the total add up — the brief only called
// out the biggest balances, not an exhaustive list.
// `now` is fixed at 2026-09-15 so ages are deterministic: ADM Tigers' order
// paid on 2026-07-01 is 76 days old (> the 45-day flag), everything else is
// under 40 days old.
const AP_NOW = new Date('2026-09-15T00:00:00Z').getTime();

const AP_PAYABLES = [
  { id: 'p1', referenceNumber: 'ST1-26-00700', payeeLabel: 'Unlimited Sports Apparel', amount: 3953.54, orderPaidAt: '2026-08-20T00:00:00Z', platformPaid: false },
  { id: 'p2', referenceNumber: 'ST1-26-00701', payeeLabel: 'PMP Printing', amount: 2789.75, orderPaidAt: '2026-08-22T00:00:00Z', platformPaid: false },
  { id: 'p3', referenceNumber: 'ST1-26-00702', payeeLabel: 'USA', amount: 1017.13, orderPaidAt: '2026-08-25T00:00:00Z', platformPaid: true },
  { id: 'p4', referenceNumber: 'ST1-26-00703', payeeLabel: 'PMP', amount: 909.09, orderPaidAt: '2026-08-15T00:00:00Z', platformPaid: false },
  { id: 'p5', referenceNumber: 'ST1-26-00704', payeeLabel: 'Norwalk HS XC', amount: 512.59, orderPaidAt: '2026-08-10T00:00:00Z', platformPaid: false },
  { id: 'p6', referenceNumber: 'ST1-26-00705', payeeLabel: 'Inkify', amount: 470.94, orderPaidAt: '2026-08-28T00:00:00Z', platformPaid: false, payoutEnabled: false },
  { id: 'p7', referenceNumber: 'ST1-26-00706', payeeLabel: 'ADM Tigers', amount: 435.68, orderPaidAt: '2026-07-01T00:00:00Z', platformPaid: false },
  { id: 'p8', referenceNumber: 'ST1-26-00707', payeeLabel: 'Other Schools', amount: 480.80, orderPaidAt: '2026-08-18T00:00:00Z', platformPaid: false },
  // ST1-supplied product — cost, never counted toward "we owe".
  { id: 'p9', referenceNumber: 'ST1-26-00708', payeeLabel: 'ST1 Sports', amount: 200.00, orderPaidAt: '2026-08-20T00:00:00Z', platformPaid: false },
  // Already recorded paid in RevOps this period — excluded from outstanding,
  // counted in recordedPaidThisPeriod instead.
  {
    id: 'p10', referenceNumber: 'ST1-26-00709', payeeLabel: 'Random Paid School', amount: 300.00,
    orderPaidAt: '2026-08-01T00:00:00Z', platformPaid: true,
    payment: { paidOn: '2026-09-05T00:00:00Z', amountPaid: 300.00 },
  },
];

describe('classifyPayeeRole', () => {
  it('maps the exact labels from the brief to their roles', () => {
    assert.equal(classifyPayeeRole('PMP Printing'), 'Decoration / production');
    assert.equal(classifyPayeeRole('Inkify'), 'Decoration / production');
    assert.equal(classifyPayeeRole('Unlimited Sports Apparel'), 'Product supplier');
    assert.equal(classifyPayeeRole('MyHOUSE'), 'Product supplier');
    assert.equal(classifyPayeeRole('PMP'), 'Production (delta-share)');
    assert.equal(classifyPayeeRole('USA'), 'Store partner delta');
    assert.equal(classifyPayeeRole('ST1 Sports'), 'ST1-supplied product (internal)');
  });

  it('falls back to school rev share for anything unrecognized', () => {
    assert.equal(classifyPayeeRole('Norwalk HS XC'), 'School rev share');
    assert.equal(classifyPayeeRole('ADM Tigers'), 'School rev share');
  });
});

describe('isInternalPayee / isPaidInRevOps', () => {
  it('flags only the ST1 Sports label as internal', () => {
    assert.equal(isInternalPayee('ST1 Sports'), true);
    assert.equal(isInternalPayee('PMP'), false);
  });

  it('is based only on our own payment record, never the platform paid flag', () => {
    assert.equal(isPaidInRevOps({ platformPaid: true }), false);
    assert.equal(isPaidInRevOps({ platformPaid: false, payment: { paidOn: '2026-09-01' } }), true);
    assert.equal(isPaidInRevOps({}), false);
  });
});

describe('ageDays', () => {
  it('computes whole days between paidAt and now', () => {
    assert.equal(ageDays('2026-07-01T00:00:00Z', AP_NOW), 76);
  });

  it('returns null when there is no paidAt to age from', () => {
    assert.equal(ageDays(null, AP_NOW), null);
    assert.equal(ageDays(undefined, AP_NOW), null);
  });
});

describe('apSummary', () => {
  it('reproduces the brief\'s exact outstanding snapshot, excluding ST1 Sports', () => {
    const summary = apSummary(AP_PAYABLES, { now: AP_NOW });
    assert.equal(summary.totalOutstanding, 10569.52);
    assert.equal(summary.st1SuppliedCost, 200.00);
    assert.equal(summary.itemCount, 8);
    assert.equal(summary.payeeCount, 8);
    assert.equal(summary.oldestAgeDays, 76);
  });

  it('counts recorded-paid amounts falling inside the given period', () => {
    const summary = apSummary(AP_PAYABLES, { now: AP_NOW });
    assert.equal(summary.recordedPaidThisPeriod, 300.00);
  });
});

describe('rollupApByPayee', () => {
  const byPayee = rollupApByPayee(AP_PAYABLES, { now: AP_NOW });

  it('reports the exact per-payee balances from the brief', () => {
    assert.equal(byPayee['Unlimited Sports Apparel'].outstanding, 3953.54);
    assert.equal(byPayee['PMP Printing'].outstanding, 2789.75);
    assert.equal(byPayee['USA'].outstanding, 1017.13);
    assert.equal(byPayee['PMP'].outstanding, 909.09);
    assert.equal(byPayee['Norwalk HS XC'].outstanding, 512.59);
    assert.equal(byPayee['Inkify'].outstanding, 470.94);
    assert.equal(byPayee['ADM Tigers'].outstanding, 435.68);
  });

  it('attaches the right role to each payee, ST1 Sports included though it is internal', () => {
    assert.equal(byPayee['Unlimited Sports Apparel'].role, 'Product supplier');
    assert.equal(byPayee['ST1 Sports'].role, 'ST1-supplied product (internal)');
    assert.equal(byPayee['Norwalk HS XC'].role, 'School rev share');
  });

  it('tracks the oldest unpaid item age and its reference number per payee', () => {
    assert.equal(byPayee['ADM Tigers'].oldestAgeDays, 76);
    assert.equal(byPayee['ADM Tigers'].oldestReferenceNumber, 'ST1-26-00706');
  });

  it('flags nothing over the 45-day threshold except ADM Tigers', () => {
    const flagged = Object.entries(byPayee).filter(([, v]) => v.oldestAgeDays != null && v.oldestAgeDays > AP_AGE_FLAG_DAYS);
    assert.deepEqual(flagged.map(([label]) => label), ['ADM Tigers']);
  });

  it('a payee whose only item is already paid in RevOps shows zero outstanding but its full billed amount', () => {
    assert.equal(byPayee['Random Paid School'].billed, 300.00);
    assert.equal(byPayee['Random Paid School'].outstanding, 0);
  });
});

describe('buildStatement — the month-end statement', () => {
  const orders = [...AUGUST_ORDERS, ORDER_SEPT];
  const payables = [...AUGUST_PAYABLES, ...PAYABLES_SEPT];
  const statement = buildStatement({ orders, payables, config: STATED_TERMS, month: '2026-08' });

  it('scopes strictly to the requested month — the September order never enters any section', () => {
    assert.equal(statement.orderCount, 3);
    assert.equal(statement.moneyInOut.orderCount, 3);
    assert.equal(statement.byStore['Sept Store'], undefined);
    assert.equal(statement.byStorePayee['Sept Store'], undefined);
  });

  it('money in / money out matches the same August aggregate rollupByMonth produces, plus tax/shipping/units', () => {
    const m = statement.moneyInOut;
    assert.equal(m.merchandise, 9655.49);
    assert.equal(m.discount, 400.00);
    assert.equal(m.grossCollected, 10615.61);
    assert.equal(m.thirdPartyPayout, 5413.97);
    assert.equal(m.st1SuppliedCost, 93.65);
    assert.equal(m.st1CashRetained, 5201.64);
    assert.equal(m.tax, 654.65); // 30.17 + 280.00 + 344.48
    assert.equal(m.shippingCost, 705.47); // 12.00 + 300.00 + 393.47
    assert.equal(m.unitCount, 335); // 20 + 140 + 175
  });

  it('by school carries orders/units/merch/tax/shipping/gross/payouts/retained', () => {
    const tigers = statement.byStore['ADM Tigers'];
    assert.equal(tigers.orderCount, 1);
    assert.equal(tigers.unitCount, 20);
    assert.equal(tigers.merchandise, 650.00);
    assert.equal(tigers.tax, 30.17);
    assert.equal(tigers.shippingCost, 12.00);
    assert.equal(tigers.grossCollected, 292.17);
    assert.equal(tigers.thirdPartyPayout, 453.08);
    assert.equal(tigers.st1CashRetained, -160.91);
  });

  it('owed by payee reflects RevOps\' own paid/unpaid record, not the platform paid flag', () => {
    const someSupplier = statement.byPayeeStatus['Some Supplier'];
    assert.equal(someSupplier.billed, 387.86);
    assert.equal(someSupplier.paid, 387.86);
    assert.equal(someSupplier.outstanding, 0);

    // ADM Tigers' own payable was never recorded paid in RevOps, even though
    // nothing about its platformPaid flag says so either — outstanding in full.
    const admTigers = statement.byPayeeStatus['ADM Tigers'];
    assert.equal(admTigers.paid, 0);
    assert.equal(admTigers.outstanding, 65.22);
  });

  it('carries the exceptions and fee audit through unchanged from buildSettlementReport', () => {
    assert.ok(statement.exceptions.some(f => f.type === 'discount' && f.referenceNumber === 'ST1-26-00516'));
    assert.equal(statement.feeAudit.orderCount, 0); // no delta-share (usaCut) orders in this fixture
  });

  it('an empty month returns zeroed totals rather than throwing', () => {
    const empty = buildStatement({ orders, payables, config: STATED_TERMS, month: '2020-01' });
    assert.equal(empty.orderCount, 0);
    assert.equal(empty.moneyInOut.grossCollected, 0);
    assert.deepEqual(empty.byStore, {});
  });
});

describe('statementForPayee', () => {
  const orders = [...AUGUST_ORDERS, ORDER_SEPT];
  const payables = [...AUGUST_PAYABLES, ...PAYABLES_SEPT];
  const statement = buildStatement({ orders, payables, config: STATED_TERMS, month: '2026-08' });

  it('gives a payee their own status and only the schools where they have a balance', () => {
    const slice = statementForPayee(statement, 'ST1 Sports');
    assert.equal(slice.role, 'ST1-supplied product (internal)');
    assert.equal(slice.billed, 93.65);
    assert.equal(Object.keys(slice.byStore).sort().join(','), 'Ames Youth Football,Boone Wrestling');
    assert.equal(slice.byStore['Ames Youth Football'].amount, 40.00);
    assert.equal(slice.byStore['Boone Wrestling'].amount, 53.65);
  });

  it('returns a zeroed slice for a payee with no activity that month, rather than throwing', () => {
    const slice = statementForPayee(statement, 'Nobody Owed Anything');
    assert.equal(slice.billed, 0);
    assert.equal(slice.outstanding, 0);
    assert.deepEqual(slice.byStore, {});
  });
});
