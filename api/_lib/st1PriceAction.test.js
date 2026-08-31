import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeScoutActions, st1PriceActionFromPricing } from './st1PriceAction.js';

describe('st1PriceActionFromPricing', () => {
  it('returns null when the lookup missed', () => {
    assert.equal(st1PriceActionFromPricing({ status: 'not_found', result: null }), null);
    assert.equal(st1PriceActionFromPricing({ result: null }), null);
    assert.equal(st1PriceActionFromPricing({ status: 'ok', result: {} }), null);
  });

  it('maps dealer-list cost and list for the Scout card', () => {
    const action = st1PriceActionFromPricing({
      status: 'ok',
      result: {
        name: 'TF-5000 SZ5 SB NFHS',
        sku: 'AC-WC647929',
        brand: 'Spalding',
        supplier: 'Athletic Connection',
        cost: { amount: 58.89, source: 'ST1 price list (dealer cost)' },
        customerPrice: { amount: 94.99, source: 'ST1 price list (our price)' },
        mapPrice: null,
        marginPct: 38.01,
        matches: [{ name: 'Other', sku: 'X' }],
      },
    });
    assert.equal(action.type, 'st1_price');
    assert.equal(action.item.sku, 'AC-WC647929');
    assert.equal(action.item.cost, 58.89);
    assert.equal(action.item.list, 94.99);
    assert.equal(action.item.supplier, 'Athletic Connection');
    assert.equal(action.matches.length, 1);
  });

  it('passes competing vendor rates onto the Scout card', () => {
    const action = st1PriceActionFromPricing({
      status: 'ok',
      result: {
        name: 'TF-1000 28.5',
        sku: 'FRZ-TF1000-285',
        brand: 'Spalding',
        supplier: 'Frazier',
        cost: { amount: 53, source: 'ST1 price list (dealer cost)' },
        customerPrice: { amount: 81.95, source: 'ST1 price list (our price)' },
        vendorRates: [
          { supplier: 'Frazier', sku: 'FRZ-TF1000-285', cost: 53, best: true },
          { supplier: 'Athletic Connection', sku: 'AC-1457055', cost: 99.99, best: false },
        ],
      },
    });
    assert.equal(action.vendorRates.length, 2);
    assert.equal(action.vendorRates[0].supplier, 'Frazier');
    assert.equal(action.vendorRates[0].best, true);
  });

  it('builds vendor rates from matches when the tool omitted them', () => {
    const action = st1PriceActionFromPricing({
      status: 'ok',
      result: {
        name: 'TF-1000 28.5 Girls',
        sku: 'AC-1457055',
        brand: 'Spalding',
        supplier: 'Athletic Connection',
        cost: { amount: 99.99 },
        customerPrice: { amount: 120 },
        matches: [
          { name: 'TF-1000 28.5 Girls', sku: 'AC-1457055', supplier: 'Athletic Connection', cost: 99.99 },
          { name: 'TF-1000 28.5 Girls Basketball', sku: 'FRZ-1', supplier: 'Frazier', cost: 53 },
        ],
      },
    });
    assert.equal(action.vendorRates[0].supplier, 'Frazier');
    assert.equal(action.vendorRates[0].cost, 53);
    assert.equal(action.vendorRates[0].best, true);
  });
});

describe('mergeScoutActions', () => {
  it('drops a parsed st1_price echo and keeps the tool card', () => {
    const tool = st1PriceActionFromPricing({
      status: 'ok',
      result: {
        name: 'TF-5000 SZ5 SB NFHS',
        sku: 'AC-WC647929',
        cost: { amount: 58.89 },
        customerPrice: { amount: 94.99 },
      },
    });
    const out = mergeScoutActions([tool], [], [{ type: 'st1_price' }, { type: 'log_note', note: 'ok' }]);
    assert.equal(out.filter(a => a.type === 'st1_price').length, 1);
    assert.equal(out.some(a => a.type === 'log_note'), true);
  });
});
