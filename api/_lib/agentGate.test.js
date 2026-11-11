import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logged } from './agentGate.testSetup.js';
import { issueSessionToken } from './session.js';
import { bindCaller, requireCaller, serverCallHeaders, currentCaller } from './agentGate.js';
import { allowAppOrToolAuth } from './ai-tools/auth.js';
import { logInteraction } from './memory.js';



function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const asRep = (id) => ({ headers: { authorization: `Bearer ${issueSessionToken(id)}` } });

describe('agent gate', () => {
  before(() => { logged.length = 0; });

  it('rejects anonymous callers and forged server tokens', async () => {
    const res = mockRes();
    assert.equal(await requireCaller({ headers: {} }, res), null);
    assert.equal(res.statusCode, 401);
    const forged = mockRes();
    assert.equal(await requireCaller({ headers: { 'x-st1-server': 'e30.abc' } }, forged), null);
    assert.equal(forged.statusCode, 401);
  });

  it('accepts a signed-in rep and this deployment’s server jobs', async () => {
    const rep = await requireCaller(asRep('r1'), mockRes());
    assert.equal(rep.repId, 'r1');
    const server = await requireCaller({ headers: serverCallHeaders() }, mockRes());
    assert.equal(server.server, true);
  });

  it('keeps admin-only routes for admins', async () => {
    const res = mockRes();
    assert.equal(await requireCaller(asRep('r1'), res, { adminOnly: true }), null);
    assert.equal(res.statusCode, 403);
    assert.equal((await requireCaller(asRep('a1'), mockRes(), { adminOnly: true })).repId, 'a1');
  });

  it('logs agent interactions against the rep who asked', async () => {
    // Shaped like a real route: gate line, then awaited work, then a log.
    async function handler(req, res) {
      if (!bindCaller(await requireCaller(req, res))) return;
      await new Promise(r => setTimeout(r, 1));
      assert.equal(currentCaller().repId, 'r1');
      await logInteraction({ agentId: 'edgar', action: 'quote' });
    }
    await handler(asRep('r1'), mockRes());
    assert.equal(logged.at(-1).userId, 'r1');
    await logInteraction({ agentId: 'brad', action: 'draft', userId: 'explicit' });
    assert.equal(logged.at(-1).userId, 'explicit');
  });
});

describe('knowledge routes (allowAppOrToolAuth)', () => {
  it('no longer grants full scopes to a request with no credentials', async () => {
    const auth = await allowAppOrToolAuth({ headers: {} });
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 401);
  });
  it('treats a signed-in rep or server job as the app', async () => {
    const rep = await allowAppOrToolAuth(asRep('r1'));
    assert.equal(rep.ok, true);
    assert.equal(rep.scopes.has('knowledge:write'), true);
    const server = await allowAppOrToolAuth({ headers: serverCallHeaders() });
    assert.equal(server.ok, true);
  });
  it('still checks other bearers as external API keys', async () => {
    process.env.ST1_AI_TOOL_API_KEY = 'external-key-abc';
    const bad = await allowAppOrToolAuth({ headers: { authorization: 'Bearer not-a-key' } });
    assert.equal(bad.ok, false);
    const good = await allowAppOrToolAuth({ headers: { authorization: 'Bearer external-key-abc' } });
    assert.equal(good.ok, true);
    delete process.env.ST1_AI_TOOL_API_KEY;
  });
});
