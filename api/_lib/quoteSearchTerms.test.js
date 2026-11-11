import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUOTE_SEARCH_TERMS, quoteSearchTerms, singularizeTerm, splitTaskIntoItems } from './quoteSearchTerms.js';

describe('splitTaskIntoItems', () => {
  it('drops the customer lead-in and quantities', () => {
    assert.deepEqual(
      splitTaskIntoItems('quote Cheyenne Mtn HS for 12 discus and a set of hurdles'),
      ['discus', 'hurdle'],
    );
  });

  it('splits on commas, plus and quantities with x', () => {
    assert.deepEqual(
      splitTaskIntoItems('Price out 24x Wilson TF-5000, 6 ball carts plus 2 pairs of starting blocks'),
      ['Wilson TF-5000', 'ball cart', 'starting block'],
    );
  });

  it('removes a named customer and dollar amounts', () => {
    assert.deepEqual(
      splitTaskIntoItems('Build a quote for Lakewood HS: 10 TF-5000 at $81.95 each', { customer: 'Lakewood HS' }),
      ['TF-5000'],
    );
  });

  it('keeps sizes that start with digits', () => {
    assert.deepEqual(splitTaskIntoItems('quote 30in hurdles'), ['30in hurdle']);
  });

  it(`caps at ${MAX_QUOTE_SEARCH_TERMS} items`, () => {
    const task = Array.from({ length: 12 }, (_, i) => `item${i}`).join(', ');
    assert.equal(splitTaskIntoItems(task).length, MAX_QUOTE_SEARCH_TERMS);
  });
});

describe('quoteSearchTerms', () => {
  it('prefers structured items (sku first) and dedupes locked lines', () => {
    const terms = quoteSearchTerms('quote this for Lakewood', {
      items: [{ name: 'Wilson TF-5000', sku: 'AC-WC647929', qty: 12 }, { name: 'Hurdle', qty: 4 }],
      lockedItems: [{ name: 'Hurdle' }],
    });
    assert.deepEqual(terms, ['AC-WC647929', 'Hurdle']);
  });

  it('falls back to splitting the task', () => {
    assert.deepEqual(quoteSearchTerms('quote 12 discus and 4 hurdles'), ['discus', 'hurdle']);
  });

  it('always returns at least the task itself', () => {
    assert.deepEqual(quoteSearchTerms('x'), ['x']);
  });
});

describe('singularizeTerm', () => {
  it('trims plural suffixes only, leaving a prefix of the word', () => {
    assert.equal(singularizeTerm('hurdles'), 'hurdle');
    assert.equal(singularizeTerm('boxes'), 'box');
    assert.equal(singularizeTerm('discus'), 'discus');
    assert.equal(singularizeTerm('glass'), 'glass');
    assert.equal(singularizeTerm('TF-5000s'), 'TF-5000s');
    assert.equal(singularizeTerm('Wilson balls'), 'Wilson ball');
  });
});
