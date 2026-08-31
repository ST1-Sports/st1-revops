import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowAppOrToolAuth } from '../../api/_lib/ai-tools/auth.js';

describe('allowAppOrToolAuth', () => {
  it('treats a request with no bearer as the in-app Hub', () => {
    const auth = allowAppOrToolAuth({ headers: {} });
    assert.equal(auth.ok, true);
    assert.equal(auth.subject, 'revops-app');
    assert.equal(auth.scopes.has('knowledge:write'), true);
  });
});
