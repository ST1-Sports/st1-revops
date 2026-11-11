/**
 * Real-Postgres integration test for the Team Store sync job. Exercises
 * runSync() end to end against a live database with the ST1 admin API
 * mocked at the fetch layer — proving the sync's actual behavior (upsert
 * idempotency, PayablePayment survival, reauth-on-403), not just its pure
 * helpers (see teamStoreSync.test.js for those).
 *
 * Requires a reachable Postgres at DATABASE_URL with the schema already
 * pushed (`DATABASE_URL=... npx prisma db push`). Skips itself cleanly
 * otherwise, so a plain `node --test` run without Postgres available still
 * passes rather than failing on an environment it can't assume.
 *
 * Run it explicitly with a real database, e.g.:
 *   DATABASE_URL="postgresql://postgres:test@localhost:5432/teamstore_test" \
 *     node --test api/_lib/teamStoreSync.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from './prisma.js';
import { runSync, payableKey } from './teamStoreSync.js';

const REF_A = 'ST1-TEST-001';
const REF_B = 'ST1-TEST-002';
const ORDER_A_ID = 'test-order-a';
const ORDER_B_ID = 'test-order-b';

function orderDetail({ id, referenceNumber, subTotal, tax, shippingCost, totalAmount, payableAAmount, payableAPaid }) {
  return {
    id, referenceNumber,
    createdAt: '2026-08-01T00:00:00Z', paidAt: '2026-08-02T00:00:00Z', status: 'paid',
    teamStore: { id: 501, name: `${referenceNumber} Store`, isUSA: false },
    tax, shippingCost, subTotal, totalAmount,
    itemCount: 1, unitCount: 2, usaCut: 0, productSupplierCut: 0, teamStoreRevenue: 20.00,
    items: [{
      id: `${id}-item-1`,
      teamStoreProduct: { designs: [{ decoration: 'DTF', dtfSizeId: 'small' }], product: { sku: 'SKU-1', name: 'Tee', supplier: { name: 'Test Supplier' }, baseCost: 8.00 } },
      size: 'L', unitPrice: subTotal / 2, quantity: 2, amount: subTotal, childStore: null,
    }],
    payables: [
      { id: `${id}-payee-store`, type: 'team_store', label: `${referenceNumber} Store`, amount: payableAAmount, paid: payableAPaid, payoutMethod: 'Check', payoutEnabled: true },
      { id: `${id}-payee-supplier`, type: 'supplier', label: 'Test Supplier', amount: totalAmount - payableAAmount, paid: false, payoutMethod: 'Check', payoutEnabled: true },
    ],
  };
}

const DECORATION_COSTS = { dtfSmall: 4, dtfMedium: 6, dtfLarge: 8, embroidery: 10, screenPrint: 0 };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Mocks the ST1 admin API at the fetch layer. Every decoration_cost call 403s once then succeeds, so every run exercises st1AdminAuth's reauth-on-403 retry for real. */
function installMockFetch(orders) {
  let signInCount = 0;
  let decorationCostCalls = 0;
  const tokens = ['mock-token-1', 'mock-token-2', 'mock-token-3'];

  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const path = u.pathname;

    if (path === '/admin/signin') {
      signInCount++;
      return jsonResponse(200, { accessToken: tokens[Math.min(signInCount, tokens.length) - 1] });
    }
    if (path === '/admin/team_store_order') {
      const page = u.searchParams.get('page');
      return jsonResponse(200, page === '1' ? orders.map(o => ({ id: o.id, referenceNumber: o.referenceNumber })) : []);
    }
    if (path === '/admin/decoration_cost') {
      decorationCostCalls++;
      if (decorationCostCalls === 1) return jsonResponse(403, { error: 'token expired' });
      return jsonResponse(200, DECORATION_COSTS);
    }
    const detailMatch = path.match(/^\/admin\/team_store_order\/(.+)$/);
    if (detailMatch) {
      const order = orders.find(o => o.id === detailMatch[1]);
      return order ? jsonResponse(200, order) : jsonResponse(404, { error: 'not found' });
    }
    throw new Error(`Unhandled mock fetch: ${path}`);
  };

  return { getSignInCount: () => signInCount, getDecorationCostCalls: () => decorationCostCalls };
}

async function cleanupTestRows() {
  await prisma.payablePayment.deleteMany({ where: { payableKey: { startsWith: 'ST1-TEST-' } } });
  await prisma.teamStoreOrder.deleteMany({ where: { referenceNumber: { in: [REF_A, REF_B] } } });
}

let dbAvailable = false;

before(async () => {
  process.env.ST1_ADMIN_API_BASE = 'https://api.st1sports.test';
  process.env.ST1_ADMIN_SERVICE_EMAIL = 'svc@example.com';
  process.env.ST1_ADMIN_SERVICE_PASSWORD = 'test-password';
  try {
    await prisma.$connect();
    await cleanupTestRows();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

after(async () => {
  if (dbAvailable) await cleanupTestRows();
  await prisma.$disconnect();
});

describe('runSync — real Postgres, mocked ST1 admin API', () => {
  it('syncs orders/lines/payables and re-authenticates on a 403 instead of failing the run', async (t) => {
    if (!dbAvailable) return t.skip('no reachable Postgres at DATABASE_URL — see file header to run this for real');

    const orders = [
      orderDetail({ id: ORDER_A_ID, referenceNumber: REF_A, subTotal: 100, tax: 10, shippingCost: 5, totalAmount: 115, payableAAmount: 20, payableAPaid: false }),
      orderDetail({ id: ORDER_B_ID, referenceNumber: REF_B, subTotal: 200, tax: 20, shippingCost: 10, totalAmount: 230, payableAAmount: 40, payableAPaid: false }),
    ];
    const mock = installMockFetch(orders);

    const run = await runSync();

    assert.equal(run.errors.length, 0, `expected a clean run, got: ${JSON.stringify(run.errors)}`);
    assert.equal(run.ordersSeen, 2);
    assert.equal(run.payablesUpserted, 4);
    // The mock 403s the first decoration_cost call and only succeeds on the
    // second — a clean run with no errors here means the job actually
    // re-authenticated and retried, not that it happened to skip the call.
    assert.equal(mock.getDecorationCostCalls(), 2);
    assert.equal(mock.getSignInCount(), 2);

    const storedOrders = await prisma.teamStoreOrder.findMany({ where: { referenceNumber: { in: [REF_A, REF_B] } } });
    assert.equal(storedOrders.length, 2);
    const storedPayables = await prisma.teamStorePayable.findMany({ where: { orderId: { in: [ORDER_A_ID, ORDER_B_ID] } } });
    assert.equal(storedPayables.length, 4);
  });

  it('re-running the sync does not duplicate rows', async (t) => {
    if (!dbAvailable) return t.skip('no reachable Postgres at DATABASE_URL');

    const orders = [
      orderDetail({ id: ORDER_A_ID, referenceNumber: REF_A, subTotal: 100, tax: 10, shippingCost: 5, totalAmount: 115, payableAAmount: 20, payableAPaid: false }),
      orderDetail({ id: ORDER_B_ID, referenceNumber: REF_B, subTotal: 200, tax: 20, shippingCost: 10, totalAmount: 230, payableAAmount: 40, payableAPaid: false }),
    ];
    installMockFetch(orders);

    const before1 = await prisma.teamStorePayable.findMany({ where: { orderId: { in: [ORDER_A_ID, ORDER_B_ID] } }, select: { id: true } });
    await runSync();
    const after1 = await prisma.teamStorePayable.findMany({ where: { orderId: { in: [ORDER_A_ID, ORDER_B_ID] } }, select: { id: true } });

    assert.equal(after1.length, 4, 'row count must stay at 4, not double, on re-sync');
    assert.deepEqual(
      before1.map(p => p.id).sort(),
      after1.map(p => p.id).sort(),
      'the exact same payable ids must come back — a re-sync upserts, it never creates parallel rows',
    );
  });

  it('a recorded PayablePayment survives a re-sync untouched, independent of the upstream platformPaid flag', async (t) => {
    if (!dbAvailable) return t.skip('no reachable Postgres at DATABASE_URL');

    // The real primary key is payableKey(referenceNumber, type, label), not
    // the raw upstream payables[].id — that upstream id is only stored as
    // payeeExternalId (it repeats across rows; see payableKey's own docs).
    const payableId = payableKey(REF_A, 'team_store', `${REF_A} Store`);
    const paidOn = new Date('2026-08-10T00:00:00Z');
    await prisma.payablePayment.upsert({
      where: { payableKey: payableId },
      create: { payableKey: payableId, paidOn, method: 'Check', reference: 'CHK-9001', amountPaid: 20.00, note: 'test payment' },
      update: {},
    });

    // Re-sync with IDENTICAL upstream data (platformPaid stays false) —
    // proves the sync's upsert doesn't cascade-clear the payment relation,
    // and that platformPaid stays purely upstream-sourced either way.
    const orders = [
      orderDetail({ id: ORDER_A_ID, referenceNumber: REF_A, subTotal: 100, tax: 10, shippingCost: 5, totalAmount: 115, payableAAmount: 20, payableAPaid: false }),
      orderDetail({ id: ORDER_B_ID, referenceNumber: REF_B, subTotal: 200, tax: 20, shippingCost: 10, totalAmount: 230, payableAAmount: 40, payableAPaid: false }),
    ];
    installMockFetch(orders);
    const run = await runSync();
    assert.equal(run.errors.length, 0);

    const payable = await prisma.teamStorePayable.findUnique({ where: { id: payableId }, include: { payment: true } });
    assert.ok(payable.payment, 'PayablePayment must still be attached after the re-sync');
    assert.equal(Number(payable.payment.amountPaid), 20.00);
    assert.equal(payable.payment.reference, 'CHK-9001');
    assert.equal(payable.platformPaid, false, 'platformPaid reflects only the upstream mock data, untouched by RevOps recording a payment');

    await prisma.payablePayment.delete({ where: { payableKey: payableId } });
  });
});
