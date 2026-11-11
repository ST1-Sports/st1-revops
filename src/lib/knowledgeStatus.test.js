import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowAppOrToolAuth } from '../../api/_lib/ai-tools/auth.js';

describe('allowAppOrToolAuth', () => {
  // The in-app Hub is now identified by the signed-in session (see api/_lib/agentGate.test.js);
  // a request with no credentials used to get full scopes and is now rejected.
  it('rejects a request with no session and no API key', async () => {
    const auth = await allowAppOrToolAuth({ headers: {} });
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 401);
  });
});
