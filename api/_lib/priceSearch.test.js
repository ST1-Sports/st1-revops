import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizePriceQuery,
  rankPriceItems,
  scorePriceItem,
  pickBestRate,
  productFamilyKey,
  vendorRatesFor,
  orderQuotePriceRows,
} from './priceSearch.js';

describe('tokenizePriceQuery', () => {
  it('keeps TF-5000 as a model and does not search generic ball/soccer', () => {
    const t = tokenizePriceQuery('TF-5000 soccer ball');
    assert.ok(t.models.includes('tf-5000'));
    assert.ok(t.models.includes('tf5000'));
    assert.ok(t.generic.includes('soccer'));
    assert.ok(t.generic.includes('ball'));
    assert.deepEqual(t.searchNeedles, t.models);
    assert.ok(!t.searchNeedles.includes('ball'));
  });

  it('keeps size/cert tokens around a model number', () => {
    const t = tokenizePriceQuery('TF-5000 SZ5 SB NFHS');
    assert.ok(t.models.includes('tf-5000'));
    assert.ok(t.distinctive.includes('sz5') || t.models.includes('sz5'));
  });

  it('keeps 28.5 / 29.5 court sizes so girls and boys balls stay distinct', () => {
    const t = tokenizePriceQuery('TF-1000 NFHS 28.5 girls basketball');
    assert.ok(t.models.includes('tf-1000') || t.models.includes('tf1000'));
    assert.ok(t.distinctive.includes('28.5') || t.distinctive.includes('285'));
  });

  it('falls back to generic words when that is all the user typed', () => {
    const t = tokenizePriceQuery('soccer ball');
    assert.equal(t.models.length, 0);
    assert.ok(t.searchNeedles.includes('soccer'));
    assert.ok(t.searchNeedles.includes('ball'));
  });
});

describe('rankPriceItems', () => {
  const items = [
    { id: '1', name: 'Indoor Soccer Ball Pump', sku: 'AC-PUMP', brand: 'Generic' },
    { id: '2', name: 'Wilson NCAA Basketball', sku: 'WTH9900', brand: 'Wilson' },
    { id: '3', name: 'TF-5000 SZ5 SB NFHS', sku: 'AC-TF5000', brand: 'Wilson' },
    { id: '4', name: 'Athletic Connection Catalog Binder', sku: 'AC-BOOK', brand: null },
  ];

  it('ranks the TF-5000 ahead of unrelated ball items', () => {
    const ranked = rankPriceItems(items, 'TF-5000 soccer ball');
    assert.equal(ranked[0].item.id, '3');
    assert.ok(ranked[0].score > (ranked[1]?.score || 0));
  });

  it('prefers an exact SKU', () => {
    const ranked = rankPriceItems(items, 'ball', { sku: 'AC-TF5000' });
    assert.equal(ranked[0].item.id, '3');
  });

  it('prefers soccer+ball over a Baseball glove when that is all the user typed', () => {
    const ranked = rankPriceItems([
      { id: 'g', name: 'A700 Baseball 11.5" RHT', sku: 'WBW1', brand: 'Wilson' },
      { id: 's', name: 'TF-5000 SZ5 SB NFHS soccer ball', sku: 'AC-WC647929', brand: 'Wilson' },
    ], 'soccer ball');
    assert.equal(ranked[0].item.id, 's');
  });

  it('does not pick an Athletic Connection catalog ball when the query is TF-1000 28.5', () => {
    const ranked = rankPriceItems([
      { id: 'ac-wrong', name: 'Official Rubber Basketball', sku: 'AC-BALL-1', brand: 'Generic', cost: 12.5 },
      { id: 'ac-tf', name: 'Spalding TF-1000 Classic', sku: 'AC-999', brand: 'Spalding', cost: 99.99 },
      { id: 'book', name: 'Spalding TF-1000 NFHS 28.5" Girls Basketball (Booking Program)', sku: 'AC-1457055', brand: 'Spalding', cost: 58.0 },
    ], 'TF-1000 NFHS 28.5 girls basketball booking');
    assert.equal(ranked[0].item.id, 'book');
  });

  it('picks the lowest dealer cost among the same SKU', () => {
    const ranked = pickBestRate([
      { score: 400, item: { id: 'hi', sku: 'AC-1457055', name: 'TF-1000 28.5', cost: 99.99 } },
      { score: 390, item: { id: 'lo', sku: 'AC-1457055', name: 'TF-1000 28.5 Booking', cost: 58 } },
    ]);
    assert.equal(ranked[0].item.id, 'lo');
  });

  it('picks the lowest dealer cost across vendors for the same model and size', () => {
    const ac = { id: 'ac', sku: 'AC-1457055', name: 'Spalding Legacy TF-1000 NFHS 28.5 Girls', brand: 'Spalding', supplier: { name: 'Athletic Connection' }, cost: 99.99 };
    const frazier = { id: 'frz', sku: 'FRZ-TF1000-285', name: 'Legacy TF-1000 NFHS 28.5 Girls Basketball', brand: 'Spalding', supplier: { name: 'Frazier' }, cost: 53 };
    const men = { id: 'men', sku: 'AC-1457056', name: 'Spalding Legacy TF-1000 NFHS 29.5 Boys', brand: 'Spalding', supplier: { name: 'Athletic Connection' }, cost: 40 };
    assert.equal(productFamilyKey(ac), productFamilyKey(frazier));
    assert.notEqual(productFamilyKey(ac), productFamilyKey(men));

    const ranked = rankPriceItems([ac, frazier, men], 'Legacy TF-1000 NFHS 28.5 girls basketball');
    assert.equal(ranked[0].item.id, 'frz');

    const rates = vendorRatesFor([ac, frazier, men], ranked[0].item);
    assert.deepEqual(rates.map(r => r.supplier), ['Frazier', 'Athletic Connection']);
    assert.equal(rates[0].best, true);
    assert.equal(rates[0].cost, 53);
    assert.equal(rates[1].best, false);
  });

  it('does not merge Precision with Legacy or NFHS with a cheaper uncertified SKU', () => {
    const legacyAc = { id: 'ac', sku: 'AC-1457055', name: 'LEGACY TF-1000 NFHS 28.5"', cost: 99.99, supplier: { name: 'Athletic Connection 2026' } };
    const legacySp = { id: 'sp-nfhs', sku: 'IN.76814', name: 'LEGACY TF-1000 28.5" NFHS (Box/Inflate)', cost: 77.17, supplier: { name: 'Spalding 2026' } };
    const precision = { id: 'prec', sku: 'DE.780168', name: 'PRECISION TF-1000 28.5" (Bulk Deflate)', cost: 55.79, supplier: { name: 'Spalding 2026' } };
    const bulk = { id: 'bulk', sku: 'DE.768148', name: 'LEGACY TF-1000 28.5" NFHS (Bulk Deflate)', cost: 75.66, supplier: { name: 'Spalding 2026' } };
    assert.notEqual(productFamilyKey(legacyAc), productFamilyKey(precision));
    assert.equal(productFamilyKey(legacyAc), productFamilyKey(legacySp));
    assert.equal(productFamilyKey(legacyAc), productFamilyKey(bulk));

    const ranked = rankPriceItems([legacyAc, legacySp, precision, bulk], 'Legacy TF-1000 NFHS 28.5');
    assert.equal(ranked[0].item.id, 'bulk');
    const rates = vendorRatesFor([legacyAc, legacySp, precision, bulk], ranked[0].item);
    assert.deepEqual(rates.map(r => `${r.supplier}:${r.cost}`), ['Spalding 2026:75.66', 'Athletic Connection 2026:99.99']);
  });

  it('does not treat a vendor catalog SKU as the product family', () => {
    const named = { name: 'Spalding TF-1000 Classic 28.5', sku: 'AC-1457055', brand: 'Spalding' };
    const skuOnly = { name: 'Official Rubber Basketball 28.5', sku: 'AC-1457055', brand: 'Generic' };
    assert.equal(productFamilyKey(named).startsWith('fam:tf1000'), true);
    assert.equal(productFamilyKey(skuOnly).startsWith('sku:'), true);
  });

  it('uses a named supplier even when another list is cheaper', () => {
    const items = [
      { id: 'frz', name: 'TF-1000 28.5', sku: 'FRZ-1', brand: 'Spalding', supplier: { name: 'Frazier' }, cost: 53 },
      { id: 'sp', name: 'TF-1000 28.5', sku: 'SP-1', brand: 'Spalding', supplier: { name: 'Spalding' }, cost: 71.2 },
    ];
    const cheapest = orderQuotePriceRows(items);
    assert.equal(cheapest[0].id, 'frz');
    const named = orderQuotePriceRows(items, { preferredSupplier: 'Spalding' });
    assert.equal(named[0].id, 'sp');
  });

  it('scores a model hit well above a generic-only name', () => {
    const tokens = tokenizePriceQuery('TF-5000 SZ5 SB NFHS');
    const hit = scorePriceItem(items[2], tokens);
    const miss = scorePriceItem(items[0], tokens);
    assert.ok(hit >= 200);
    assert.ok(hit > miss);
  });
});
