import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { issueSessionToken, signPayload, verifyPayload } from './session.js';

describe('signed session tokens', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['SESSION_SECRET', 'RADAR_TOKEN_KEY', 'TOKEN_ENCRYPTION_KEY', 'DATABASE_URL']) saved[k] = process.env[k];
    delete process.env.RADAR_TOKEN_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('round-trips the rep id', () => {
    const token = issueSessionToken('r_abc');
    assert.equal(verifyPayload('session', token).sub, 'r_abc');
  });

  it('rejects tampered, expired, cross-purpose and malformed tokens', () => {
    const token = issueSessionToken('r_abc');
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'r_admin', exp: Date.now() + 1e9 })).toString('base64url');
    assert.equal(verifyPayload('session', `${forged}.${sig}`), null);
    assert.equal(verifyPayload('session', `${body}.${sig}x`), null);
    assert.equal(verifyPayload('session', issueSessionToken('r_abc', Date.now() - 31 * 864e5)), null);
    assert.equal(verifyPayload('radar-oauth', token), null);
    assert.equal(verifyPayload('session', 'nonsense'), null);
    assert.equal(verifyPayload('session', `${body}.${sig}.extra`), null);
  });

  it('falls back to a key derived from DATABASE_URL so sign-in never locks everyone out', () => {
    delete process.env.SESSION_SECRET;
    process.env.DATABASE_URL = 'postgresql://user:secret@host/db';
    const token = issueSessionToken('r_abc');
    assert.equal(verifyPayload('session', token).sub, 'r_abc');
    delete process.env.DATABASE_URL;
    assert.equal(verifyPayload('session', token), null);
  });

  it('fails closed without a signing key', () => {
    delete process.env.SESSION_SECRET;
    assert.equal(issueSessionToken('r_abc'), null);
    assert.equal(signPayload('session', { sub: 'x', exp: Date.now() + 1000 }), null);
  });
});
