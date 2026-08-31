import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipText,
  feedbackMemoryKey,
  packChatPayload,
  splitChatPayload,
} from './chatMemory.js';

describe('splitChatPayload / packChatPayload', () => {
  it('reads a legacy action array with no vote', () => {
    const raw = [{ type: 'edgar_quote', quote: { lineItems: [] } }];
    const p = splitChatPayload(raw);
    assert.equal(p.vote, null);
    assert.equal(p.actions[0].type, 'edgar_quote');
  });

  it('round-trips a vote without losing quote actions', () => {
    const packed = packChatPayload([{ type: 'st1_price', item: { sku: 'X' } }], 'up', '2026-08-31T00:00:00.000Z');
    assert.equal(packed.vote, 'up');
    const p = splitChatPayload(packed);
    assert.equal(p.vote, 'up');
    assert.equal(p.actions[0].item.sku, 'X');
  });

  it('ignores junk vote values', () => {
    assert.equal(splitChatPayload({ items: [], vote: 'meh' }).vote, null);
  });
});

describe('feedbackMemoryKey', () => {
  it('slugs the question and prefixes good/avoid', () => {
    assert.equal(feedbackMemoryKey('up', 'Quote Hudson TF-1000s'), 'good:quote-hudson-tf-1000s');
    assert.equal(feedbackMemoryKey('down', 'What is the price?'), 'avoid:what-is-the-price');
  });
});

describe('clipText', () => {
  it('trims and ellipsizes long answers', () => {
    assert.equal(clipText('  hello  '), 'hello');
    assert.equal(clipText('x'.repeat(20), 10), `${'x'.repeat(10)}…`);
  });
});
