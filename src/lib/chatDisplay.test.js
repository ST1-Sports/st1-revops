import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatFollowUp, money, stripMarkdownTables } from './chatDisplay.js';

const SAMPLE = `Here's what Edgar pulled:

---

**Spalding TF-5000 Size 5 NFHS Soccer Ball** (SKU: AC-WC647929)

| | Per Unit | × 5 |
|---|---|---|
| **Your Cost** | $58.89 | **$294.45** |
| **List Price** | $94.99 | **$474.95** |
| **Gross Margin** | 38% | ✅ Above floor |

---

**Key notes:**
- GM floor is $73.61/unit — you're well above it at $94.99
- No MAP restriction on this item
- 38% GM is solid — room to negotiate slightly if needed without going under floor

Want me to build a quote for a school, or do you need to go lower on price for a deal?`;

describe('chatFollowUp', () => {
  it('strips tables so pipes are not shown', () => {
    const out = stripMarkdownTables(SAMPLE);
    assert.equal(out.includes('|'), false);
    assert.equal(out.includes('---'), false);
  });

  it('keeps the question and drops the cost dump when a quote card is present', () => {
    const out = chatFollowUp(SAMPLE, { hasQuoteCard: true });
    assert.match(out, /Want me to build a quote/i);
    assert.equal(out.includes('Your Cost'), false);
    assert.equal(out.includes('AC-WC647929'), false);
    assert.equal(out.includes('|'), false);
  });

  it('formats money', () => {
    assert.equal(money(58.89), '$58.89');
    assert.equal(money(294.45), '$294.45');
    assert.equal(money(null), null);
  });
});
