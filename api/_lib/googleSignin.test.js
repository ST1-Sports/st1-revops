import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedGoogleEmail, grantedGmail, GOOGLE_LOGIN_SCOPES } from './googleLogin.js';
import { withRepForEmail, gmailKeyForRep } from './repAccount.js';
import { guardAccessFields } from './appUsersGuard.js';
import { sendBlocker } from './followups/repDraft.js';

describe('Sign in with Google: who gets in', () => {
  it('accepts only verified @st1sports.com Workspace accounts', () => {
    assert.equal(allowedGoogleEmail({ email: 'Josh@ST1Sports.com', email_verified: true, hd: 'st1sports.com' }), 'josh@st1sports.com');
    assert.equal(allowedGoogleEmail({ email: 'josh@gmail.com', email_verified: true }), null);
    assert.equal(allowedGoogleEmail({ email: 'josh@st1sports.com', email_verified: false, hd: 'st1sports.com' }), null);
    assert.equal(allowedGoogleEmail({ email: 'josh@st1sports.com', email_verified: true, hd: 'other.com' }), null);
    assert.equal(allowedGoogleEmail({ email: 'josh@st1sports.com.evil.com', email_verified: true }), null);
    assert.equal(allowedGoogleEmail(null), null);
  });
  it('connects Gmail only when both Gmail permissions were granted, never gmail.send', () => {
    const both = 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';
    assert.equal(grantedGmail(both), true);
    assert.equal(grantedGmail('openid email https://www.googleapis.com/auth/gmail.readonly'), false);
    assert.ok(!GOOGLE_LOGIN_SCOPES.some(s => s.endsWith('gmail.send')));
  });
});

describe('rep account for a verified email', () => {
  const ids = (() => { let n = 0; return () => `r_${++n}`; })();
  it('creates the first rep as admin and later reps as non-admin', () => {
    const first = withRepForEmail({}, 'a@st1sports.com', { newId: ids });
    assert.equal(first.appUser.isAdmin, true);
    const second = withRepForEmail(first.state, 'b@st1sports.com', { newId: ids, name: 'Bea B' });
    assert.equal(second.appUser.isAdmin, false);
    assert.equal(second.rep.name, 'Bea B');
  });
  it('reuses the rep for the same email and assigns a Gmail key on Google connect', () => {
    const base = withRepForEmail({}, 'a@st1sports.com', { newId: () => 'r_x' }).state;
    const again = withRepForEmail(base, 'A@st1sports.com', { gmailConnected: true });
    assert.equal(again.state.reps.length, 1);
    assert.equal(again.rep.gmailEnvKey, gmailKeyForRep('r_x'));
    const legacy = { ...base, reps: [{ ...base.reps[0], gmailEnvKey: 'JOSH' }] };
    assert.equal(withRepForEmail(legacy, 'a@st1sports.com', { gmailConnected: true }).rep.gmailEnvKey, 'JOSH');
  });
});

describe('/api/state cannot change access fields without an admin session', () => {
  const previous = {
    appUsers: [{ repId: 'r1', isAdmin: true }, { repId: 'r2', isAdmin: false, pin: '1234' }],
    reps: [{ id: 'r1', email: 'a@st1sports.com', gmailEnvKey: 'A' }, { id: 'r2', email: 'b@st1sports.com', gmailEnvKey: 'B' }],
  };
  const attack = {
    appUsers: [{ repId: 'r2', isAdmin: true }, { repId: 'evil', isAdmin: true }],
    reps: [{ id: 'r1', email: 'x@evil.com', gmailEnvKey: 'B' }, { id: 'r2', gmailEnvKey: 'A' }, { id: 'new', gmailEnvKey: 'A' }],
  };
  it('keeps users, admin flags, rep emails and Gmail keys for a non-admin write', () => {
    const out = guardAccessFields(attack, previous, { callerIsAdmin: false });
    assert.deepEqual(out.appUsers, [{ repId: 'r1', isAdmin: true }, { repId: 'r2', isAdmin: false }]);
    assert.equal(out.reps[0].gmailEnvKey, 'A');
    assert.equal(out.reps[0].email, 'a@st1sports.com');
    assert.equal(out.reps[1].gmailEnvKey, 'B');
    assert.equal(out.reps[2].gmailEnvKey, undefined);
  });
  it('accepts changes from a signed-in admin and during first-time setup, and never stores PINs', () => {
    const asAdmin = guardAccessFields(attack, previous, { callerIsAdmin: true });
    assert.equal(asAdmin.appUsers.find(u => u.repId === 'r2').isAdmin, true);
    const setup = guardAccessFields({ appUsers: [{ repId: 'r1', isAdmin: true, pin: '9' }] }, { appUsers: [] });
    assert.deepEqual(setup.appUsers, [{ repId: 'r1', isAdmin: true }]);
  });
});

describe('review & send safety', () => {
  it('blocks empty drafts, open placeholders and [REVIEW] notes', () => {
    assert.match(sendBlocker('  '), /empty/);
    assert.match(sendBlocker('Hi coach, the price is [PRICE].'), /\[PRICE\]/);
    assert.match(sendBlocker('Hi\n\n[REVIEW: remove unverified numbers — 12]'), /REVIEW/);
    assert.equal(sendBlocker('Hi coach, thanks for the order. Talk soon.'), null);
  });
});
