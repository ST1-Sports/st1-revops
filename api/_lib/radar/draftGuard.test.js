import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoFabricatedFacts, draftNeedsInput, extractPlaceholders } from './draftGuard.js';

const THREAD = `
Subject: Re: Baden TF-5000 volleyball
AD: Can you send pricing on the TF-5000? Last year we paid $81.95.
Matt: I'll pull that and get back to you.
`;

describe('draft placeholders — no fabricated numbers', () => {
  it('allows a number that already appears in the thread', () => {
    const draft = `Hey Coach,\n\nThe TF-5000 is $81.95 like last year. Want me to lock it?\n\nMDS`;
    const r = assertNoFabricatedFacts(draft, THREAD);
    assert.equal(r.ok, true);
    assert.equal(r.needsInput, false);
  });

  it('rejects a fabricated price that is not in the thread', () => {
    const draft = `Hey Coach,\n\nI can do these at $50 even and ship next Friday.\n\nMDS`;
    const r = assertNoFabricatedFacts(draft, THREAD);
    assert.equal(r.ok, false);
    assert.ok(r.fabricated.some(f => f.includes('50')));
  });

  it('flags [BRACKETED PLACEHOLDERS] as needs input and does not treat them as facts', () => {
    const draft = `Hey Coach,\n\nI'll send [PRICE] on the TF-5000 and confirm [ETA] once I check stock.\n\nMDS`;
    const r = assertNoFabricatedFacts(draft, THREAD);
    assert.equal(r.ok, true);
    assert.equal(draftNeedsInput(draft), true);
    assert.deepEqual(extractPlaceholders(draft), ['[PRICE]', '[ETA]']);
  });

  it('rejects a fabricated quantity', () => {
    const draft = `We can do 240 pcs of the TF-5000 this week.`;
    const r = assertNoFabricatedFacts(draft, THREAD);
    assert.equal(r.ok, false);
    assert.ok(r.fabricated.some(f => /240/i.test(f)));
  });
});
