import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizePriceQuery, rankPriceItems, scorePriceItem } from './priceSearch.js';

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

  it('scores a model hit well above a generic-only name', () => {
    const tokens = tokenizePriceQuery('TF-5000 SZ5 SB NFHS');
    const hit = scorePriceItem(items[2], tokens);
    const miss = scorePriceItem(items[0], tokens);
    assert.ok(hit >= 200);
    assert.ok(hit > miss);
  });
});
