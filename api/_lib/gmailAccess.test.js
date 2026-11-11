import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gmailKeyAllowed } from '../gmail.js';

describe('/api/gmail mailbox access', () => {
  const rep = { repId: 'r1', isAdmin: false, gmailEnvKey: 'REP_R1' };
  it('requires a signed-in rep', () => {
    assert.equal(gmailKeyAllowed(null, ''), false);
    assert.equal(gmailKeyAllowed(null, 'BRAD'), false);
  });
  it('lets any rep use the shared mailboxes and their own, not another rep’s', () => {
    assert.equal(gmailKeyAllowed(rep, ''), true);
    assert.equal(gmailKeyAllowed(rep, 'BRAD'), true);
    assert.equal(gmailKeyAllowed(rep, 'rep_r1'), true);
    assert.equal(gmailKeyAllowed(rep, 'REP_R2'), false);
    assert.equal(gmailKeyAllowed({ ...rep, gmailEnvKey: '' }, 'REP_R2'), false);
  });
  it('lets admins use any mailbox', () => {
    assert.equal(gmailKeyAllowed({ ...rep, isAdmin: true }, 'REP_R2'), true);
  });
});
