import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_BDR, allBdrMailboxes, bdrForCampaign, bdrForRep, bdrKeyForEmail, defaultBdr, ownerOfBdrKey, validateBdr,
} from './bdr.js';
import { isBdrKey } from '../gmail.js';

const reps = [
  { id: 'm1', name: 'Matt', email: 'matt@st1sports.com', gmailEnvKey: 'REP_M1' },
  { id: 'j1', name: 'Josh', email: 'josh@st1sports.com', gmailEnvKey: 'REP_J1' },
];

describe('BDR keys', () => {
  it('uses the mailbox name, so Brad keeps the BRAD key', () => {
    assert.equal(bdrKeyForEmail('Brad@ShopST1Sports.com'), 'BRAD');
    assert.equal(bdrKeyForEmail('sam.k@shopst1sports.com'), 'SAM_K');
  });
});

describe('validateBdr', () => {
  it('accepts a separate mailbox', () => {
    const { bdr } = validateBdr({ name: ' Brad Hofer ', email: 'brad@shopst1sports.com' }, 'm1', { reps });
    assert.deepEqual(bdr, { name: 'Brad Hofer', email: 'brad@shopst1sports.com', gmailKey: 'BRAD' });
  });
  it('rejects a rep’s own address, a bad address, and a missing name', () => {
    assert.ok(validateBdr({ name: 'X', email: 'josh@st1sports.com' }, 'm1', { reps }).error);
    assert.ok(validateBdr({ name: 'X', email: 'nope' }, 'm1', { reps }).error);
    assert.ok(validateBdr({ name: '', email: 'brad@shopst1sports.com' }, 'm1', { reps }).error);
  });
  it('rejects a mailbox (or key) another rep’s BDR already uses, but lets you re-save your own', () => {
    const assignments = { m1: { name: 'Brad', email: 'brad@shopst1sports.com', gmailKey: 'BRAD' } };
    assert.ok(validateBdr({ name: 'B', email: 'brad@shopst1sports.com' }, 'j1', { reps, assignments }).error);
    assert.ok(validateBdr({ name: 'B', email: 'brad@other.com' }, 'j1', { reps, assignments }).error);
    assert.ok(validateBdr({ name: 'Brad H', email: 'brad@shopst1sports.com' }, 'm1', { reps, assignments }).bdr);
  });
  it('rejects a key that is a rep’s personal Gmail key', () => {
    assert.ok(validateBdr({ name: 'X', email: 'rep_j1@shopst1sports.com' }, 'm1', { reps }).error);
  });
});

describe('which BDR sends', () => {
  const assignments = {
    m1: { name: 'Brad Hofer', email: 'brad@shopst1sports.com', gmailKey: 'BRAD' },
    j1: { name: 'Sam Kay', email: 'sam@shopst1sports.com', gmailKey: 'SAM' },
  };
  it('a campaign uses its rep’s BDR; older campaigns use whoever owns Brad', () => {
    assert.equal(bdrForCampaign(assignments, { bdrRepId: 'j1' }).email, 'sam@shopst1sports.com');
    assert.deepEqual(bdrForCampaign(assignments, {}), { repId: 'm1', ...LEGACY_BDR });
    assert.deepEqual(bdrForCampaign({}, { bdrRepId: 'j1' }), { repId: null, ...LEGACY_BDR });
  });
  it('finds owners and lists every mailbox to watch', () => {
    assert.equal(ownerOfBdrKey(assignments, 'sam'), 'j1');
    assert.equal(ownerOfBdrKey(assignments, 'REP_M1'), null);
    assert.equal(bdrForRep(assignments, 'nobody'), null);
    assert.deepEqual(allBdrMailboxes(assignments).map(b => b.gmailKey).sort(), ['BRAD', 'SAM']);
    assert.deepEqual(allBdrMailboxes({}).map(b => b.gmailKey), ['BRAD']);
    assert.equal(defaultBdr({}).repId, null);
  });
  it('the sending switch covers every BDR mailbox, not a rep’s own Gmail', () => {
    assert.equal(isBdrKey('BRAD', {}), true);
    assert.equal(isBdrKey('SAM', assignments), true);
    assert.equal(isBdrKey('REP_M1', assignments), false);
    assert.equal(isBdrKey('', assignments), false);
  });
});
