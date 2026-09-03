import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtractedQuote, parseJsonObject } from './quotePdfImport.js';

describe('parseJsonObject', () => {
  it('pulls a JSON object out of prose', () => {
    const o = parseJsonObject('Here you go:\n{"quoteNumber":"ST1-1","total":100}\n');
    assert.equal(o.quoteNumber, 'ST1-1');
    assert.equal(o.total, 100);
  });
  it('returns null when there is no object', () => {
    assert.equal(parseJsonObject('no json'), null);
  });
});

describe('normalizeExtractedQuote', () => {
  it('maps quantity/price aliases and fills total from lines', () => {
    const q = normalizeExtractedQuote({
      quoteNo: 'Q-9',
      school: 'Hudson High School',
      items: [{ description: 'TF-5000', quantity: '12', unitPrice: '$94.99' }],
    });
    assert.equal(q.quoteNumber, 'Q-9');
    assert.equal(q.customerName, 'Hudson High School');
    assert.equal(q.lineItems.length, 1);
    assert.equal(q.lineItems[0].qty, 12);
    assert.equal(q.lineItems[0].rate, 94.99);
    assert.ok(Math.abs(q.total - 12 * 94.99) < 0.01);
  });
  it('prefers an explicit grand total', () => {
    const q = normalizeExtractedQuote({ grandTotal: '2500', lineItems: [] });
    assert.equal(q.total, 2500);
  });
});
