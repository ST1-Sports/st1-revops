import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuoteLine,
  normalizeQuoteLines,
  quoteLinesTotal,
  filledQuoteLines,
  parseQuoteLinesFromDescription,
  quoteLinesFromZohoRecord,
  quoteLinesDescription,
  quoteLinesToZohoQuotedItems,
  quoteLinesToZohoProductDetails,
  quoteNotesFromDescription,
  quoteLinesForDeal,
  quoteLinesSummary,
  quoteFieldsFromZohoRecord,
} from './quoteLines.js';

describe('normalizeQuoteLines', () => {
  it('maps local quoteItems and Zoho Quoted_Items / Product_Details', () => {
    assert.deepEqual(normalizeQuoteLine({ name: 'Jersey', qty: 24, rate: 65 }), {
      id: null, name: 'Jersey', qty: 24, rate: 65, cost: 0, description: '',
    });
    const fromQuoted = normalizeQuoteLines([{ Product_Name: 'Warmup', Quantity: 12, List_Price: 42 }]);
    assert.equal(fromQuoted[0].name, 'Warmup');
    assert.equal(fromQuoted[0].qty, 12);
    assert.equal(fromQuoted[0].rate, 42);
    const fromProducts = normalizeQuoteLines([{ product: { name: 'Ball' }, quantity: 3, unit_price: 10 }]);
    assert.equal(fromProducts[0].name, 'Ball');
    assert.equal(fromProducts[0].rate, 10);
  });

  it('drops empty rows and totals filled lines', () => {
    const items = [
      { name: 'Jersey', qty: 2, rate: 50 },
      { name: '  ', qty: 1, rate: 0 },
    ];
    assert.equal(filledQuoteLines(items).length, 1);
    assert.equal(quoteLinesTotal(items), 100);
  });
});

describe('parseQuoteLinesFromDescription', () => {
  it('reads the bullet format written onto Zoho deals', () => {
    const text = [
      'Waiting on sizes',
      '',
      '• Varsity jersey × 24 @ $65.00 = $1560.00',
      '• Warmup pant × 24 @ $42.00 = $1008.00',
      '',
      'Subtotal: $2568.00',
    ].join('\n');
    const items = parseQuoteLinesFromDescription(text);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'Varsity jersey');
    assert.equal(items[0].qty, 24);
    assert.equal(items[0].rate, 65);
    assert.equal(quoteLinesTotal(items), 2568);
  });
});

describe('quoteLinesFromZohoRecord', () => {
  it('prefers Product_Details over Description', () => {
    const rec = {
      Description: '• Old × 1 @ $1.00 = $1.00',
      Product_Details: [{ product: { name: 'New kit' }, Quantity: 2, List_Price: 40 }],
    };
    const items = quoteLinesFromZohoRecord(rec);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'New kit');
    assert.equal(items[0].rate, 40);
  });

  it('falls back to Description when Zoho has no inventory subform', () => {
    const items = quoteLinesFromZohoRecord({ Description: '• Jersey × 10 @ $20.00 = $200.00' });
    assert.equal(items[0].name, 'Jersey');
    assert.equal(items[0].qty, 10);
  });
});

describe('quoteLinesDescription / Quoted_Items', () => {
  it('round-trips a line into the Zoho description + Quoted_Items payload', () => {
    const items = [{ name: 'Jersey', qty: 2, rate: 10 }];
    const desc = quoteLinesDescription(items, 'Rush');
    assert.match(desc, /Rush/);
    assert.match(desc, /Jersey × 2 @ \$10\.00/);
    assert.match(desc, /Subtotal: \$20\.00/);
    assert.deepEqual(quoteLinesToZohoQuotedItems(items), [
      { Product_Name: 'Jersey', Quantity: 2, List_Price: 10 },
    ]);
    assert.equal(quoteLinesToZohoProductDetails(items)[0].Product_Name, 'Jersey');
  });
});

describe('quote notes / deal summary', () => {
  it('keeps freeform notes and drops the line-item block', () => {
    const text = [
      'Rush sizes',
      '',
      '• Jersey × 2 @ $10.00 = $20.00',
      '',
      'Subtotal: $20.00',
    ].join('\n');
    assert.equal(quoteNotesFromDescription(text), 'Rush sizes');
  });

  it('reads lines off a local deal, then falls back to Description bullets', () => {
    const fromItems = quoteLinesForDeal({ quoteItems: [{ name: 'Kit', qty: 3, rate: 20 }] });
    assert.equal(quoteLinesSummary(fromItems), 'Kit × 3');
    const fromNotes = quoteLinesForDeal({ notes: '• Warmup × 12 @ $42.00 = $504.00' });
    assert.equal(fromNotes[0].name, 'Warmup');
    assert.equal(quoteLinesSummary(fromNotes.concat([{ name: 'Short', qty: 12, rate: 18 }])), 'Warmup × 12 · Short × 12');
  });

  it('hydrates local deal fields from a Zoho record', () => {
    const fields = quoteFieldsFromZohoRecord({
      Amount: 99,
      Description: 'Need sizes\n\n• Jersey × 2 @ $10.00 = $20.00\n\nSubtotal: $20.00',
    });
    assert.equal(fields.quoteItems[0].name, 'Jersey');
    assert.equal(fields.quoteAmount, 20);
    assert.equal(fields.quoteNotes, 'Need sizes');
  });
});
