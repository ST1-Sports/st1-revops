import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './agentGate.testSetup.js';
import { issueSessionToken } from './session.js';
import { safeImageUrl } from './safeImageUrl.js';
import metaAds from '../ads/meta.js';
import adStatus from '../ads/status.js';
import attribution from '../ads/attribution.js';
import alerts from '../ads/alerts.js';
import utm from '../analytics/utm.js';
import assets from '../adengine/assets.js';
import productImage from '../adengine/generate-product-image.js';
import socialPost from '../social-post.js';

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
const asRep = (id, method, body) => ({
  method, query: {}, body, headers: { authorization: `Bearer ${issueSessionToken(id)}` },
});
async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

describe('ad, social and image endpoints need a signed-in rep', () => {
  const routes = [
    ['ads/meta GET', metaAds, 'GET'],
    ['ads/meta POST', metaAds, 'POST', { action: 'pause', campaignId: 'x' }],
    ['ads/status', adStatus, 'GET'],
    ['ads/attribution POST', attribution, 'POST', { platform: 'meta', revenue: 1 }],
    ['ads/alerts', alerts, 'GET'],
    ['analytics/utm', utm, 'GET'],
    ['adengine/assets DELETE', assets, 'DELETE'],
    ['adengine/generate-product-image', productImage, 'POST', { prompt: 'x' }],
    ['social-post', socialPost, 'POST', { post: 'hi', platforms: ['facebook'] }],
  ];
  for (const [name, handler, method, body] of routes) {
    it(`${name} rejects anonymous callers`, async () => {
      process.env.PUBLER_API_KEY = 'test-key';
      const res = await call(handler, anon(method, body));
      assert.equal(res.statusCode, 401, JSON.stringify(res.body));
    });
  }

  it('live campaign changes and attribution writes are admin-only', async () => {
    for (const [handler, body] of [
      [metaAds, { action: 'set_budget', campaignId: 'x', dailyBudget: 1 }],
      [attribution, { platform: 'meta', revenue: 1 }],
    ]) {
      const res = await call(handler, asRep('r1', 'POST', body));
      assert.equal(res.statusCode, 403, JSON.stringify(res.body));
    }
  });

  it('Publer debug posts are admin-only', async () => {
    process.env.PUBLER_API_KEY = 'test-key';
    const res = await call(socialPost, asRep('r1', 'POST', { action: 'debug-post' }));
    assert.equal(res.statusCode, 403);
  });
});

describe('ad renderer image URLs', () => {
  it('keeps public https and inline images', () => {
    assert.equal(safeImageUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
    assert.ok(safeImageUrl('data:image/png;base64,AAAA').startsWith('data:image/png'));
  });
  it('drops internal, non-https and odd URLs', () => {
    for (const bad of [
      'http://example.com/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png',
      'https://169.254.169.254/latest', 'https://[::1]/a.png', 'https://db.internal/x',
      'file:///etc/passwd', 'https://user:pw@example.com/a.png', 'not a url', '',
    ]) assert.equal(safeImageUrl(bad), '', bad);
  });
});
