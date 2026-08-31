import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeChatActions, isUsablePriceAction } from './chatActions.js';

describe('dedupeChatActions', () => {
  it('drops an empty st1_price echo', () => {
    const out = dedupeChatActions([
      { type: 'st1_price', item: { name: 'TF-5000 SZ5 SB NFHS', sku: 'AC-WC647929', cost: 58.89, list: 94.99 } },
      { type: 'st1_price' },
      { type: 'st1_price', item: {} },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].item.sku, 'AC-WC647929');
  });

  it('keeps one card when the same SKU appears twice', () => {
    const a = { type: 'st1_price', item: { name: 'TF-5000', sku: 'AC-WC647929', cost: 58.89 } };
    const out = dedupeChatActions([a, { ...a }]);
    assert.equal(out.length, 1);
  });

  it('leaves non-price actions alone', () => {
    const out = dedupeChatActions([{ type: 'log_note', note: 'hi' }]);
    assert.equal(out.length, 1);
  });

  it('rejects a price card with no item data', () => {
    assert.equal(isUsablePriceAction({ type: 'st1_price' }), false);
    assert.equal(isUsablePriceAction({ type: 'st1_price', item: { name: 'Ball' } }), true);
  });
});
