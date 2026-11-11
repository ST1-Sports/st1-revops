import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, payableKey, poolMap, decorationCostFor } from './teamStoreSync.js';

describe('slug', () => {
  it('lowercases, trims, and dashes non-alphanumerics', () => {
    assert.equal(slug('Unlimited Sports Apparel'), 'unlimited-sports-apparel');
    assert.equal(slug('  ST1 Sports!! '), 'st1-sports');
    assert.equal(slug(''), '');
    assert.equal(slug(null), '');
  });
});

describe('payableKey', () => {
  it('builds a stable key from referenceNumber + type + slugged label', () => {
    assert.equal(
      payableKey('ST1-26-00583', 'supplier', 'Unlimited Sports Apparel'),
      'ST1-26-00583~supplier~unlimited-sports-apparel',
    );
  });

  it('is unique per payee even when the payables[].id repeats across rows', () => {
    // 554 payables sharing 11 ids — the upstream id must never be part of the key.
    const a = payableKey('ST1-26-00583', 'supplier', 'Unlimited Sports Apparel');
    const b = payableKey('ST1-26-00584', 'supplier', 'Unlimited Sports Apparel');
    assert.notEqual(a, b);
  });

  it('is stable across re-syncs of the same order', () => {
    const first = payableKey('ST1-26-00583', 'team_store', 'Ames Youth Football');
    const second = payableKey('ST1-26-00583', 'team_store', 'Ames Youth Football');
    assert.equal(first, second);
  });
});

describe('poolMap', () => {
  it('runs every item and preserves input order regardless of completion order', async () => {
    const items = [30, 10, 20, 5];
    const results = await poolMap(items, 2, async (ms) => {
      await new Promise(r => setTimeout(r, ms));
      return ms;
    });
    assert.deepEqual(results, items);
  });

  it('never runs more than `limit` at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await poolMap(Array.from({ length: 12 }, (_, i) => i), 5, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
    });
    assert.ok(maxInFlight <= 5, `expected <= 5 concurrent, saw ${maxInFlight}`);
  });

  it('handles an empty list', async () => {
    const results = await poolMap([], 5, async x => x);
    assert.deepEqual(results, []);
  });
});

describe('decorationCostFor', () => {
  const decorationCosts = { dtfSmall: 4, dtfMedium: 6, dtfLarge: 8, embroidery: 10, screenPrint: 0 };

  it('resolves each DTF size', () => {
    assert.equal(decorationCostFor({ decoration: 'DTF', dtfSizeId: 'small' }, decorationCosts), 4);
    assert.equal(decorationCostFor({ decoration: 'dtf', dtfSizeId: 'Medium' }, decorationCosts), 6);
    assert.equal(decorationCostFor({ decoration: 'DTF', dtfSizeId: 'large-ish' }, decorationCosts), 8);
  });

  it('resolves embroidery and screen print regardless of size', () => {
    assert.equal(decorationCostFor({ decoration: 'Embroidery' }, decorationCosts), 10);
    assert.equal(decorationCostFor({ decoration: 'Screen Print' }, decorationCosts), 0);
  });

  it('returns null for no design or unrecognized decoration', () => {
    assert.equal(decorationCostFor(null, decorationCosts), null);
    assert.equal(decorationCostFor({ decoration: 'vinyl' }, decorationCosts), null);
  });
});
