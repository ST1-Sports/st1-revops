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

describe('/api/gmail BDR mailboxes', () => {
  const matt = { repId: 'm1', isAdmin: false, gmailEnvKey: 'REP_M1' };
  const josh = { repId: 'j1', isAdmin: false, gmailEnvKey: 'REP_J1' };
  const assignments = { m1: { name: 'Brad Hofer', email: 'brad@shopst1sports.com', gmailKey: 'BRAD' } };
  it('a claimed BDR mailbox is only its owner’s (and admins’)', () => {
    assert.equal(gmailKeyAllowed(matt, 'BRAD', assignments), true);
    assert.equal(gmailKeyAllowed(josh, 'BRAD', assignments), false);
    assert.equal(gmailKeyAllowed({ ...josh, isAdmin: true }, 'BRAD', assignments), true);
  });
  it('unclaimed Brad stays shared, as before', () => {
    assert.equal(gmailKeyAllowed(josh, 'BRAD', {}), true);
  });
});
