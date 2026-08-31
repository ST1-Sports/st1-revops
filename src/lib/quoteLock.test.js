import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { st1PriceActionFromPricing } from '../../api/_lib/st1PriceAction.js';
import {
  applyLockedPrices,
  buildLockedQuotePayload,
  extractLockedQuoteFromDeals,
  extractLockedQuoteFromHistory,
  lockedPricingToolResult,
  matchLockedItem,
  mergeLockedItemsIntoRequest,
  overlayLockedPricing,
  resolveLockedQuote,
  userWantsNewSellPrice,
  userWantsReprice,
} from './quoteLock.js';

const lockedTf = {
  name: 'TF-5000 SZ5 SB NFHS',
  sku: 'AC-WC647929',
  qty: 12,
  cost: 58.89,
  ourPrice: 94.99,
  quotedPrice: 94.99,
};

describe('userWantsReprice', () => {
  it('does not treat a quote update or qty change as a reprice', () => {
    assert.equal(userWantsReprice('update the quote to 10'), false);
    assert.equal(userWantsReprice('make qty 10'), false);
    assert.equal(userWantsReprice('add 2 more TF-5000s to the quote'), false);
    assert.equal(userWantsReprice('quote this for Hudson'), false);
  });

  it('detects an explicit dealer-list refresh', () => {
    assert.equal(userWantsReprice('reprice from the latest list'), true);
    assert.equal(userWantsReprice('new cost on the TF-5000'), true);
    assert.equal(userWantsReprice('refresh the price from the dealer list'), true);
    assert.equal(userWantsReprice('pull the latest list'), true);
  });
});

describe('userWantsNewSellPrice', () => {
  it('keeps sell price locked on a normal update', () => {
    assert.equal(userWantsNewSellPrice('update the quote to qty 10'), false);
  });

  it('lets Matt set a new sell price while cost stays locked', () => {
    assert.equal(userWantsNewSellPrice('charge $90'), true);
    assert.equal(userWantsNewSellPrice('change the price to 89.99'), true);
    assert.equal(userWantsNewSellPrice('10% off'), true);
  });
});

describe('extractLockedQuoteFromHistory', () => {
  it('reads cost and sell price from the last Edgar quote card', () => {
    const locked = extractLockedQuoteFromHistory([
      { role: 'assistant', actions: [{ type: 'st1_price', item: { name: 'Other', sku: 'X', cost: 1, list: 2 } }] },
      {
        role: 'assistant',
        actions: [{
          type: 'edgar_quote',
          customer: 'Hudson High School',
          quote: { customer: 'Hudson High School', lineItems: [lockedTf] },
        }],
      },
      { role: 'user', content: 'update the quote to 10' },
    ]);
    assert.equal(locked.customer, 'Hudson High School');
    assert.equal(locked.items[0].sku, 'AC-WC647929');
    assert.equal(locked.items[0].cost, 58.89);
    assert.equal(locked.items[0].quotedPrice, 94.99);
  });

  it('falls back to the last price card when no quote exists yet', () => {
    const locked = extractLockedQuoteFromHistory([
      { role: 'assistant', actions: [{ type: 'st1_price', item: { name: 'TF-5000', sku: 'AC-WC647929', cost: 58.89, list: 94.99 } }] },
    ]);
    assert.equal(locked.source, 'chat-price');
    assert.equal(locked.items[0].quotedPrice, 94.99);
  });
});

describe('extractLockedQuoteFromDeals', () => {
  it('uses CRM quoteItems rate as the held sell price', () => {
    const locked = extractLockedQuoteFromDeals([
      {
        school: 'Hudson High School',
        stage: 'Quoted',
        quoteNumber: 'ST1-1',
        createdAt: '2026-08-31',
        quoteItems: [{ name: 'TF-5000 SZ5 SB NFHS', sku: 'AC-WC647929', qty: 12, cost: 58.89, rate: 94.99 }],
      },
    ], 'update the Hudson quote');
    assert.equal(locked.items[0].cost, 58.89);
    assert.equal(locked.items[0].quotedPrice, 94.99);
    assert.equal(locked.customer, 'Hudson High School');
  });
});

describe('applyLockedPrices', () => {
  it('keeps cost and sell price when qty changes and the name is shortened', () => {
    const out = applyLockedPrices(
      [{ name: 'TF-5000', sku: 'AC-WC647929', qty: 10, cost: 71.2, ourPrice: 110, quotedPrice: 110 }],
      [lockedTf],
    );
    assert.equal(out[0].qty, 10);
    assert.equal(out[0].cost, 58.89);
    assert.equal(out[0].quotedPrice, 94.99);
    assert.equal(out[0].gmPct, 38);
  });

  it('matches by product name when SKU is missing on the new line', () => {
    const out = applyLockedPrices(
      [{ name: 'TF-5000 SZ5 SB NFHS', qty: 8, cost: 40, quotedPrice: 80 }],
      [lockedTf],
    );
    assert.equal(out[0].cost, 58.89);
    assert.equal(out[0].quotedPrice, 94.99);
    assert.equal(out[0].sku, 'AC-WC647929');
  });

  it('leaves a new unmatched line alone', () => {
    const out = applyLockedPrices(
      [{ name: 'Helmet', sku: 'HLM-1', qty: 4, cost: 20, quotedPrice: 40 }],
      [lockedTf],
    );
    assert.equal(out[0].cost, 20);
    assert.equal(out[0].quotedPrice, 40);
  });

  it('can lock cost only when Matt sets a new sell price', () => {
    const out = applyLockedPrices(
      [{ name: 'TF-5000', sku: 'AC-WC647929', qty: 12, cost: 71.2, quotedPrice: 90 }],
      [lockedTf],
      { lockSell: false },
    );
    assert.equal(out[0].cost, 58.89);
    assert.equal(out[0].quotedPrice, 90);
  });
});

describe('mergeLockedItemsIntoRequest', () => {
  it('passes locked SKUs through when Scout only sent a task', () => {
    const items = mergeLockedItemsIntoRequest(undefined, [lockedTf]);
    assert.equal(items[0].sku, 'AC-WC647929');
    assert.equal(items[0].qty, 12);
  });

  it('fills SKU on a requested line that only has a short name', () => {
    const items = mergeLockedItemsIntoRequest([{ name: 'TF-5000', qty: 10 }], [lockedTf]);
    assert.equal(items[0].sku, 'AC-WC647929');
    assert.equal(items[0].qty, 10);
  });
});

describe('matchLockedItem / pricing overlay', () => {
  it('matches a pricing query to the open quote SKU', () => {
    assert.equal(matchLockedItem({ query: 'TF-5000', sku: 'AC-WC647929' }, [lockedTf]).cost, 58.89);
  });

  it('builds a get_st1_pricing result that the Scout card can render', () => {
    const output = lockedPricingToolResult({ query: 'TF-5000' }, lockedTf);
    const action = st1PriceActionFromPricing(output);
    assert.equal(action.item.cost, 58.89);
    assert.equal(action.item.list, 94.99);
    assert.equal(output.result.locked, true);
  });

  it('overlays a drifted lookup back onto the locked numbers', () => {
    const over = overlayLockedPricing({
      status: 'ok',
      result: {
        name: 'TF-5000 SZ5 SB NFHS',
        sku: 'AC-WC647929',
        cost: { amount: 71.2, source: 'other list' },
        customerPrice: { amount: 110, source: 'other list' },
      },
    }, [lockedTf]);
    assert.equal(over.result.cost.amount, 58.89);
    assert.equal(over.result.customerPrice.amount, 94.99);
  });
});

describe('resolveLockedQuote', () => {
  it('prefers the client-sent lock over CRM deals', () => {
    const locked = resolveLockedQuote({
      lockedQuote: { customer: 'Lincoln', items: [lockedTf] },
      deals: [{ school: 'Other', quoteItems: [{ name: 'Bat', cost: 1, rate: 2 }] }],
    });
    assert.equal(locked.customer, 'Lincoln');
  });

  it('builds a payload from chat history first', () => {
    const payload = buildLockedQuotePayload({
      history: [{
        role: 'assistant',
        actions: [{ type: 'edgar_quote', quote: { lineItems: [lockedTf] } }],
      }],
      deals: [{ school: 'Other', quoteItems: [{ name: 'Bat', cost: 1, rate: 2 }] }],
    });
    assert.equal(payload.items[0].sku, 'AC-WC647929');
  });
});
