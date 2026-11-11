/**
 * PIM-first quoting with the legacy PriceItem fallback, the read-only /
 * time-bounded PIM client, product-card cost redaction, and app_state
 * priceLists preservation.
 *
 * No network and no database: globalThis.fetch is mocked at the ST1 admin
 * API layer and globalThis.prisma is a small in-memory fake (prisma.js reuses
 * globalThis.prisma outside production). Both are installed before the
 * modules under test are imported.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const PIM_BASE = 'https://pim.test';
process.env.ST1_ADMIN_API_BASE = PIM_BASE;

// ── In-memory Prisma fake ────────────────────────────────────────────────────
const PRICE_ROWS = [
  { id: 'pi-1', name: 'Wilson TF-5000 SZ5 SB NFHS', sku: 'AC-WC647929', cost: 58.4, ourPrice: 84.95, map: null, msrp: null, supplier: { id: 'sup-1', name: 'Athletic Connection' } },
  { id: 'pi-2', name: 'Steel Hurdle 30in', sku: 'H-30', cost: 41, ourPrice: 69, map: null, msrp: null, supplier: { id: 'sup-2', name: 'Gill' } },
];
const db = {
  priceItemCalls: 0,
  productCalls: [],
  supplierCalls: 0,
  setting: null, // { key, value, updatedAt }
};
const fakePrisma = {
  priceItem: {
    async findMany() {
      db.priceItemCalls += 1;
      return PRICE_ROWS.map(r => ({ ...r }));
    },
  },
  supplier: {
    async findMany() {
      db.supplierCalls += 1;
      return [{ id: 'sup-1', name: 'Athletic Connection', category: 'Balls', rep: null, notes: null, _count: { items: 4000 } }];
    },
  },
  product: {
    async findMany(args) {
      db.productCalls.push(args);
      if (args?.where?.id === 123) {
        return [{ id: 123, name: 'Catalog Hurdle', slug: 'catalog-hurdle', price: '70', regular_price: '70', sale_price: null, on_sale: false, stock_status: 'instock', categories: [], tags: [], attributes: [], brand: 'Gill', date_modified: null }];
      }
      return [];
    },
  },
  setting: {
    async findUnique() {
      return db.setting ? { ...db.setting } : null;
    },
    async create({ data }) {
      db.setting = { ...data, updatedAt: new Date() };
      return db.setting;
    },
    async updateMany({ where, data }) {
      if (!db.setting || db.setting.updatedAt !== where.updatedAt) return { count: 0 };
      db.setting = { ...db.setting, value: data.value, updatedAt: new Date(db.setting.updatedAt.getTime() + 1) };
      return { count: 1 };
    },
  },
};
globalThis.prisma = fakePrisma;

// ── ST1 admin API (PIM) fetch mock ───────────────────────────────────────────
const realFetch = globalThis.fetch;
let pim = null;
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function installPim(handler) {
  pim = { requests: [], signIns: 0, handler };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.origin !== PIM_BASE) throw new Error(`unexpected fetch to ${url}`);
  if (!pim) throw new Error('PIM mock not installed');
  const path = `${u.pathname}${u.search}`;
  if (u.pathname === '/admin/signin') {
    pim.signIns += 1;
    return jsonResponse(200, { accessToken: 'tok' });
  }
  pim.requests.push({ path, method: opts.method || 'GET', signal: opts.signal });
  return pim.handler(path, opts);
};

function configurePim(on) {
  if (on) {
    process.env.ST1_ADMIN_SERVICE_EMAIL = 'svc@example.com';
    process.env.ST1_ADMIN_SERVICE_PASSWORD = 'pw';
  } else {
    delete process.env.ST1_ADMIN_SERVICE_EMAIL;
    delete process.env.ST1_ADMIN_SERVICE_PASSWORD;
  }
}

const PIM_TF5000 = {
  id: 77,
  sku: 'PIM-TF5000',
  name: 'Wilson TF-5000 SZ5 SB NFHS',
  brand: 'Wilson',
  baseCost: 55.1,
  sellPrice: 84.95,
  map: 79.99,
  quantityOnHand: 9,
  supplier: { id: 9, name: 'Athletic Connection' },
};

let sources;
let st1Pim;
let registry;
let schema;
let stateHandler;
let edgar;

before(async () => {
  sources = await import('./ai-tools/sources.js');
  st1Pim = await import('./st1Pim.js');
  registry = await import('./ai-tools/registry.js');
  schema = await import('./ai-tools/schema.js');
  stateHandler = (await import('../state.js')).default;
  edgar = await import('../agents/edgar.js');
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  st1Pim.resetPimSessionCache();
  db.priceItemCalls = 0;
  db.productCalls = [];
  db.supplierCalls = 0;
  pim = null;
  configurePim(true);
});

describe('findPriceItems: PIM first, PriceItem fallback', () => {
  it('uses the price lists when the PIM is not configured', async () => {
    configurePim(false);
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(db.priceItemCalls > 0, true);
    assert.equal(rows[0].id, 'pi-1');
    assert.equal(rows[0].dataSource, 'price_list');
  });

  it('falls back to the price lists when the PIM errors', async () => {
    installPim(() => { throw new TypeError('fetch failed'); });
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(pim.requests.length, 1, 'stops probing after a network error');
    assert.equal(db.priceItemCalls > 0, true);
    assert.equal(rows[0].id, 'pi-1');
    assert.equal(rows[0].dataSource, 'price_list');
  });

  it('falls back to the price lists when the PIM times out', async () => {
    installPim(() => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; });
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(rows[0].dataSource, 'price_list');
  });

  it('falls back to the price lists when the PIM has no match', async () => {
    installPim(() => jsonResponse(404, null));
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(db.priceItemCalls > 0, true);
    assert.equal(rows[0].dataSource, 'price_list');
  });

  it('falls back when the PIM only returns an unrelated catalog page', async () => {
    installPim(() => jsonResponse(200, Array.from({ length: 20 }, (_, i) => ({ id: i, sku: `CONE-${i}`, name: `Cone ${i}`, baseCost: 2 }))));
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(pim.requests.length, 1, 'stops after the first endpoint that returned a product list');
    assert.equal(rows[0].dataSource, 'price_list');
  });

  it('returns PIM rows (and skips the price lists) when the PIM matches', async () => {
    installPim(path => (path.startsWith('/admin/products/search')
      ? jsonResponse(200, { products: [PIM_TF5000] })
      : jsonResponse(404, null)));
    const rows = await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    assert.equal(db.priceItemCalls, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku, 'PIM-TF5000');
    assert.equal(rows[0].cost, 55.1);
    assert.equal(rows[0].dataSource, 'pim');
  });

  it('labels get_st1_pricing results with the source actually used', async () => {
    configurePim(false);
    const tool = registry.getTool('get_st1_pricing');
    const out = await registry.invokeTool(tool, { productName: 'Wilson TF-5000' }, { scopes: new Set(['pricing:read']) });
    assert.equal(out.result.dataSource, 'price_list');
    assert.match(out.result.cost.source, /ST1 Price Lists/);
    assert.equal(out.sources[0].system, 'ST1 Price Lists');
  });
});

describe('ST1 PIM client is read-only, bounded, and signs in once', () => {
  it('issues only GET lookups, each with an abort signal, and reuses one sign-in', async () => {
    installPim(path => (path.startsWith('/admin/products?query=')
      ? jsonResponse(200, { products: [PIM_TF5000] })
      : jsonResponse(404, null)));
    await sources.findPriceItems({ query: 'TF-5000', limit: 5 });
    await sources.findProducts({ query: 'TF-5000', limit: 5 });
    await sources.findSuppliers({ query: 'Athletic', limit: 5 });
    assert.equal(pim.signIns, 1, 'one sign-in shared across lookups');
    assert.equal(pim.requests.length > 0, true);
    for (const req of pim.requests) {
      assert.equal(req.method, 'GET', `${req.path} must be GET`);
      assert.equal(req.signal instanceof AbortSignal, true, `${req.path} must carry a timeout signal`);
    }
    assert.equal(pim.requests.some(r => r.method === 'POST'), false);
  });

  it('rejects productIds with path characters before building /admin/products/{id}', async () => {
    installPim(() => jsonResponse(404, null));
    for (const bad of ['../users', 'a/b', '..', '%2e%2e', 'id?x=1', 'id#x', ' 1 2 ']) {
      assert.equal(st1Pim.isSafePimId(bad), false, bad);
      await st1Pim.searchPimProducts({ productId: bad, query: '' }).catch(() => []);
    }
    assert.equal(pim.requests.some(r => /^\/admin\/products\/[^?]/.test(r.path) && !r.path.startsWith('/admin/products/search')), false);
    assert.equal(st1Pim.isSafePimId('abc-123'), true);
    assert.equal(st1Pim.isSafePimId(42), true);
  });

  it('looks up a safe productId directly and stops there', async () => {
    installPim(path => (path === '/admin/products/77' ? jsonResponse(200, { product: PIM_TF5000 }) : jsonResponse(404, null)));
    const rows = await sources.findPriceItems({ query: '77', productId: '77', limit: 5 });
    assert.equal(rows[0].sku, 'PIM-TF5000');
    assert.deepEqual(pim.requests.map(r => r.path), ['/admin/products/77']);
  });

  it('get_st1_product schema accepts integer and string ids but not path characters', () => {
    const tool = registry.getTool('get_st1_product');
    assert.equal(schema.validateToolInput(tool, { productId: 123 }).ok, true);
    assert.equal(schema.validateToolInput(tool, { productId: 'p-123' }).ok, true);
    assert.equal(schema.validateToolInput(tool, { productId: '../admin' }).ok, false);
    assert.equal(schema.validateToolInput(tool, { productId: 'a/b' }).ok, false);
    assert.equal(schema.validateToolInput(tool, { productId: 0 }).ok, false);
  });

  it('never sends an integer (synced-catalog) id to the PIM by-id endpoint', async () => {
    installPim(() => jsonResponse(404, null));
    const rows = await sources.findProducts({ productId: 123, query: '123', limit: 1 });
    assert.equal(rows[0].id, 123);
    assert.equal(rows[0].dataSource, 'catalog');
    assert.equal(pim.requests.some(r => r.path.startsWith('/admin/products/123')), false);
    await sources.findPriceItems({ query: '123', productId: 123, limit: 5 });
    assert.equal(pim.requests.some(r => r.path.startsWith('/admin/products/123')), false);
  });

  it('keeps the exact-ID catalog lookup for string or integer ids', async () => {
    configurePim(false);
    for (const id of [123, '123']) {
      db.productCalls = [];
      const rows = await sources.findProducts({ productId: id, query: String(id), limit: 1 });
      assert.equal(db.productCalls[0].where.id, 123);
      assert.equal(rows[0].id, 123);
      assert.equal(rows[0].dataSource, 'catalog');
    }
  });
});

describe('product results never carry dealer cost', () => {
  beforeEach(() => {
    installPim(path => (path.startsWith('/admin/products/search')
      ? jsonResponse(200, { products: [PIM_TF5000] })
      : jsonResponse(404, null)));
  });

  it('get_st1_product with product:read only has no cost or map', async () => {
    const tool = registry.getTool('get_st1_product');
    const out = await registry.invokeTool(tool, { query: 'TF-5000' }, { scopes: new Set(['product:read']) });
    assert.equal(out.ok, true);
    assert.equal(out.result.sku, 'PIM-TF5000');
    assert.equal('cost' in out.result, false);
    assert.equal('map' in out.result, false);
    assert.doesNotMatch(JSON.stringify(out), /55\.1|79\.99/);
  });

  it('search_st1_knowledge products domain has no cost or map without pricing:read', async () => {
    const tool = registry.getTool('search_st1_knowledge');
    const out = await registry.invokeTool(tool, { query: 'TF-5000', domains: ['products', 'pricing'] }, { scopes: new Set(['knowledge:read', 'product:read']) });
    assert.equal(out.ok, true);
    assert.equal(out.result.products.items.length, 1);
    assert.equal(out.result.pricing, undefined);
    assert.deepEqual(out.deniedDomains, [{ domain: 'pricing', requiredScope: 'pricing:read' }]);
    assert.doesNotMatch(JSON.stringify(out.result), /55\.1|79\.99/);
  });
});

describe('/api/state preserves stored priceLists', () => {
  function mockRes() {
    return {
      statusCode: 200,
      body: undefined,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };
  }
  const STORED_LISTS = [{ id: 'pl-1', name: 'Athletic Connection 2026', type: 'own', items: [{ id: 'i1', sku: 'AC-1', cost: 10 }] }];

  // /api/state requires a signed-in rep.
  let auth;
  beforeEach(async () => {
    process.env.SESSION_SECRET = 'test-session-secret-123456';
    const { issueSessionToken } = await import('./session.js');
    auth = { authorization: `Bearer ${issueSessionToken('r1')}` };
    db.setting = {
      key: 'app_state',
      value: { deals: [], priceLists: STORED_LISTS, appUsers: [{ repId: 'r1', isAdmin: false }] },
      updatedAt: new Date(1000),
    };
  });

  it('rejects requests without a session', async () => {
    const res = mockRes();
    await stateHandler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 401);
  });

  it('keeps priceLists when a client writes state without them', async () => {
    const res = mockRes();
    await stateHandler({ method: 'POST', headers: auth, body: { state: { deals: [{ id: 'd1' }] } } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(db.setting.value.priceLists, STORED_LISTS);
    assert.deepEqual(db.setting.value.deals, [{ id: 'd1' }]);
  });

  it('ignores a client attempt to overwrite or empty priceLists', async () => {
    const res = mockRes();
    await stateHandler({ method: 'POST', headers: auth, body: { state: { deals: [], priceLists: [] } } }, res);
    assert.deepEqual(db.setting.value.priceLists, STORED_LISTS);
  });

  it('GET omits priceLists from the response without touching the stored row', async () => {
    const res = mockRes();
    await stateHandler({ method: 'GET', headers: auth }, res);
    assert.equal('priceLists' in res.body.state, false);
    assert.deepEqual(db.setting.value.priceLists, STORED_LISTS);
  });
});

describe('Edgar searches each requested item', () => {
  const HURDLE = { id: 88, sku: 'PIM-H30', name: 'Gill Steel Hurdle 30in', baseCost: 39, sellPrice: 69, supplier: { name: 'Gill' } };
  const DISCUS = { id: 89, sku: 'PIM-D1', name: 'Cantabrian Discus 1.6kg', baseCost: 30, sellPrice: 52, supplier: { name: 'Cantabrian' } };

  it('runs one PIM query per item and merges the results', async () => {
    installPim(path => {
      if (!path.startsWith('/admin/products/search')) return jsonResponse(404, null);
      const q = decodeURIComponent(new URL(`${PIM_BASE}${path}`).searchParams.get('q'));
      if (q === 'hurdle') return jsonResponse(200, { products: [HURDLE] });
      if (q === 'discus') return jsonResponse(200, { products: [DISCUS] });
      return jsonResponse(200, { products: [] });
    });
    const { quoteSearchTerms } = await import('./quoteSearchTerms.js');
    const task = 'quote Cheyenne Mtn HS for 12 discus and a set of hurdles';
    const terms = quoteSearchTerms(task);
    const { matchedItems } = await edgar.fetchPriceData(task, { terms });
    const searched = pim.requests
      .filter(r => r.path.startsWith('/admin/products/search'))
      .map(r => new URL(`${PIM_BASE}${r.path}`).searchParams.get('q'));
    assert.deepEqual(searched.sort(), ['discus', 'hurdle']);
    assert.deepEqual(matchedItems.map(i => i.sku).sort(), ['PIM-D1', 'PIM-H30']);
    assert.equal(pim.signIns, 1);
  });

  it('falls back to the price lists per item when the PIM is down', async () => {
    installPim(() => { throw new TypeError('fetch failed'); });
    const { matchedItems, ownSuppliers } = await edgar.fetchPriceData('quote 4 hurdles', { terms: ['hurdle'] });
    assert.equal(matchedItems.length > 0, true);
    assert.equal(matchedItems.every(i => i.dataSource === 'price_list'), true);
    assert.deepEqual(ownSuppliers.map(s => s.name), ['Athletic Connection']);
  });
});
