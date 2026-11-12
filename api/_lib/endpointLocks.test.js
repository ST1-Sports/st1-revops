import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './agentGate.testSetup.js';
import utm from '../analytics/utm.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
const anon = (method, body) => ({ method, headers: {}, query: {}, body });
async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

describe('analytics endpoints need a signed-in rep', () => {
  it('analytics/utm rejects anonymous callers', async () => {
    const res = await call(utm, anon('GET'));
    assert.equal(res.statusCode, 401, JSON.stringify(res.body));
  });
});
