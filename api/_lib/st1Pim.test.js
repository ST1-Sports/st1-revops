import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPimProduct,
  mapPimToCatalogProduct,
  mapPimSupplier,
  searchPimProducts,
  unwrapProductList,
} from './st1Pim.js';

describe('unwrapProductList', () => {
  it('accepts a bare array, wrapped keys, and a single product', () => {
    const row = { id: 1, name: 'TF-5000', sku: 'AC-1' };
    assert.deepEqual(unwrapProductList([row]), [row]);
    assert.deepEqual(unwrapProductList({ products: [row] }), [row]);
    assert.deepEqual(unwrapProductList({ data: [row] }), [row]);
    assert.deepEqual(unwrapProductList({ items: [row] }), [row]);
    assert.deepEqual(unwrapProductList(row), [row]);
    assert.deepEqual(unwrapProductList(null), []);
  });
});

describe('mapPimProduct', () => {
  it('maps the team-store catalog shape (sku, name, supplier, baseCost)', () => {
    const item = mapPimProduct({
      id: 44,
      sku: 'AC-WC647929',
      name: 'Wilson TF-5000 SZ5 SB NFHS',
      brand: 'Wilson',
      baseCost: '61.20',
      sellPrice: 89.95,
      map: 84.99,
      msrp: 99.99,
      quantityOnHand: 12,
      supplier: { id: 9, name: 'Athletic Connection' },
    });
    assert.equal(item.sku, 'AC-WC647929');
    assert.equal(item.name, 'Wilson TF-5000 SZ5 SB NFHS');
    assert.equal(item.cost, 61.2);
    assert.equal(item.ourPrice, 89.95);
    assert.equal(item.map, 84.99);
    assert.equal(item.msrp, 99.99);
    assert.equal(item.inventory, 12);
    assert.equal(item.stockStatus, 'instock');
    assert.equal(item.supplier.name, 'Athletic Connection');
    assert.equal(item.supplier.id, '9');
  });

  it('marks zero inventory as out of stock', () => {
    const item = mapPimProduct({ id: 1, name: 'Hurdle', sku: 'H-1', baseCost: 40, inventory: 0 });
    assert.equal(item.stockStatus, 'outofstock');
    assert.equal(item.inventory, 0);
  });

  it('skips rows without a name or SKU', () => {
    assert.equal(mapPimProduct({ id: 1, baseCost: 10 }), null);
    assert.equal(mapPimProduct(null), null);
  });
});

describe('mapPimToCatalogProduct', () => {
  it('exposes inventory and cost on the catalog card', () => {
    const item = mapPimProduct({
      id: 'p1',
      sku: 'H-1',
      name: 'Hurdle',
      baseCost: 40,
      sellPrice: 65,
      quantityOnHand: 3,
      supplier: { name: 'Spalding' },
    });
    const product = mapPimToCatalogProduct(item);
    assert.equal(product.sku, 'H-1');
    assert.equal(product.cost, 40);
    assert.equal(product.price, 65);
    assert.equal(product.inventory, 3);
    assert.equal(product.supplier, 'Spalding');
    assert.equal(product.source.system, 'ST1 PIM');
  });
});

describe('mapPimSupplier', () => {
  it('maps a supplier row', () => {
    const s = mapPimSupplier({ id: 2, name: 'Frazier', category: 'Track' });
    assert.equal(s.id, '2');
    assert.equal(s.name, 'Frazier');
    assert.equal(s.category, 'Track');
  });
});

describe('searchPimProducts', () => {
  it('uses /admin/search when it returns relevant products', async () => {
    const calls = [];
    const session = {
      async request(path) {
        calls.push(path);
        if (path.includes('/admin/products/search') || path.startsWith('/admin/search?q=')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              products: [{
                id: 7,
                sku: 'AC-TF5000',
                name: 'Wilson TF-5000 SZ5 SB NFHS',
                baseCost: 61.2,
                supplier: { name: 'Athletic Connection' },
              }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => null };
      },
    };
    const rows = await searchPimProducts({ query: 'TF-5000 soccer ball', limit: 10, session });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku, 'AC-TF5000');
    assert.equal(rows[0].cost, 61.2);
    assert.equal(calls.some(p => p.includes('/admin/products/search') || p.includes('/admin/search')), true);
  });

  it('skips an unfiltered catalog dump that does not match the model', async () => {
    const session = {
      async request(path) {
        if (path.startsWith('/admin/products')) {
          return {
            ok: true,
            status: 200,
            json: async () => Array.from({ length: 20 }, (_, i) => ({
              id: i,
              sku: `MISC-${i}`,
              name: `Generic Cone ${i}`,
              baseCost: 2,
            })),
          };
        }
        return { ok: false, status: 404, json: async () => null };
      },
    };
    const rows = await searchPimProducts({ query: 'TF-5000', session });
    assert.deepEqual(rows, []);
  });
});
