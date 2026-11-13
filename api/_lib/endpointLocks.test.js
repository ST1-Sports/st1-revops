import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import './agentGate.testSetup.js';
import { issueSessionToken } from './session.js';
import {
  PUBLIC_API_FILES,
  requireCronOrCaller,
  requireCronSecret,
  requireSignedIn,
} from './requireSignedIn.js';
import utm from '../analytics/utm.js';
import contacts from '../contacts/index.js';
import deal from '../crm/deal.js';
import zoho from '../zoho.js';
import stripe from '../stripe/index.js';
import login from '../login.js';
import loginRequest from '../login-request-code.js';
import trackOpen from '../track/open.js';
import batches from '../outreach/batches.js';
import sms from '../sms.js';
import cronStatus from '../cron/status.js';
import ga4 from '../analytics/ga4.js';
import teamStoreSummary from '../team-store/summary.js';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const GATE_RE = /requireCaller\(|requireRep\(|requireSignedIn\(|requireCronSecret\(|requireCronOrCaller\(|authenticateToolRequest\(|allowAppOrToolAuth\(|readRep\(/;
const FAIL_OPEN_CRON_RE = /if \(cronSecret\) \{/;

function listHandlers(dir = apiRoot, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '_lib' || ent.name === 'services' || ent.name === 'node_modules') continue;
      listHandlers(full, acc);
      continue;
    }
    if (!ent.name.endsWith('.js') || ent.name.endsWith('.test.js') || ent.name.endsWith('.testSetup.js')) continue;
    const text = readFileSync(full, 'utf8');
    if (!text.includes('export default')) continue;
    acc.push({ rel: relative(apiRoot, full).replaceAll('\\', '/'), text });
  }
  return acc;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    end(b) { if (b !== undefined) this.body = b; return this; },
  };
}
const anon = (method, extra = {}) => ({ method, headers: {}, query: {}, body: {}, ...extra });
async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

describe('every Rev-Ops API route is gated', () => {
  const handlers = listHandlers();

  it('keeps the public allowlist limited to login, OAuth, webhooks, and the open pixel', () => {
    const expected = [
      'login.js',
      'login-request-code.js',
      'login-verify-code.js',
      'auth/google.js',
      'radar/oauth.js',
      'slack/oauth.js',
      'gmail-setup.js',
      'google-drive-setup.js',
      'zoho-setup.js',
      'webhooks/zoho.js',
      'webhooks/sms.js',
      'inbound-email.js',
      'slack/actions.js',
      'track/open.js',
    ];
    assert.deepEqual([...PUBLIC_API_FILES].sort(), expected.sort());
  });

  it('requires a sign-in (or cron/tool) gate on every non-public handler', () => {
    const publicSet = new Set(PUBLIC_API_FILES);
    const open = handlers
      .filter(({ rel }) => !publicSet.has(rel) && !GATE_RE.test(handlers.find(h => h.rel === rel).text))
      .map(({ rel }) => rel);
    assert.deepEqual(open, [], `ungated routes: ${open.join(', ')}`);
  });

  it('does not leave Vercel crons callable when CRON_SECRET is unset', () => {
    const failOpen = handlers
      .filter(({ rel, text }) => rel.startsWith('cron/') && FAIL_OPEN_CRON_RE.test(text))
      .map(({ rel }) => rel);
    assert.deepEqual(failOpen, []);
    const missing = handlers
      .filter(({ rel, text }) => rel.startsWith('cron/') && !/requireCronSecret\(|requireCronOrCaller\(/.test(text))
      .map(({ rel }) => rel);
    assert.deepEqual(missing, []);
  });

  it('fails closed on webhook secrets instead of skipping verification', () => {
    const zohoHook = handlers.find(h => h.rel === 'webhooks/zoho.js').text;
    const smsHook = handlers.find(h => h.rel === 'webhooks/sms.js').text;
    const inbound = handlers.find(h => h.rel === 'inbound-email.js').text;
    const slack = handlers.find(h => h.rel === 'slack/actions.js').text;
    assert.match(zohoHook, /if \(!secret\) return res\.status\(503\)/);
    assert.match(smsHook, /if \(!secret\) return res\.status\(503\)/);
    assert.match(inbound, /INBOUND_EMAIL_SECRET is not configured/);
    assert.match(slack, /return false/);
    assert.doesNotMatch(slack, /skipping signature verification/);
  });

  it('gates the email-open listing while leaving the tracking pixel public', () => {
    const text = handlers.find(h => h.rel === 'track/open.js').text;
    assert.match(text, /if \(req\.query\.list\)/);
    assert.match(text, /requireSignedIn/);
  });
});

describe('anonymous callers cannot read or write Rev-Ops data', () => {
  it('rejects workspace-adjacent routes that used to be open', async () => {
    const samples = [
      ['analytics/utm', utm, 'GET'],
      ['contacts', contacts, 'GET'],
      ['crm/deal', deal, 'POST'],
      ['zoho', zoho, 'POST'],
      ['stripe', stripe, 'POST'],
      ['outreach/batches', batches, 'GET'],
      ['sms', sms, 'GET'],
      ['analytics/ga4', ga4, 'GET'],
      ['team-store/summary', teamStoreSummary, 'GET'],
      ['cron/status', cronStatus, 'POST'],
    ];
    for (const [name, handler, method] of samples) {
      const res = await call(handler, anon(method));
      assert.equal(res.statusCode, 401, `${name} ${method} → ${res.statusCode} ${JSON.stringify(res.body)}`);
    }
  });

  it('still allows CORS preflight without a session', async () => {
    const res = await call(contacts, anon('OPTIONS'));
    assert.equal(res.statusCode, 200);
  });

  it('leaves sign-in itself reachable', async () => {
    const pin = await call(login, anon('POST'));
    assert.equal(pin.statusCode, 410);
    const code = await call(loginRequest, anon('POST'));
    assert.notEqual(code.statusCode, 401);
  });

  it('keeps the open-tracking pixel public and locks the listing', async () => {
    const pixel = await call(trackOpen, anon('GET', { query: {} }));
    assert.equal(pixel.statusCode, 200);
    assert.equal(pixel.headers['Content-Type'], 'image/gif');
    const list = await call(trackOpen, anon('GET', { query: { list: '1', seqId: 'x' } }));
    assert.equal(list.statusCode, 401);
  });
});

describe('cron and sign-in helpers', () => {
  const savedCron = process.env.CRON_SECRET;
  afterEach(() => {
    if (savedCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedCron;
  });

  it('requireCronSecret fails closed without a secret and rejects a missing bearer', () => {
    delete process.env.CRON_SECRET;
    const missing = mockRes();
    assert.equal(requireCronSecret({ headers: {} }, missing), false);
    assert.equal(missing.statusCode, 503);
    process.env.CRON_SECRET = 'cron-test-secret';
    const anonRes = mockRes();
    assert.equal(requireCronSecret({ headers: {} }, anonRes), false);
    assert.equal(anonRes.statusCode, 401);
    const ok = mockRes();
    assert.equal(requireCronSecret({ headers: { authorization: 'Bearer cron-test-secret' } }, ok), true);
  });

  it('requireCronOrCaller accepts Vercel cron or a signed-in rep', async () => {
    process.env.CRON_SECRET = 'cron-test-secret';
    const cron = await requireCronOrCaller({ headers: { authorization: 'Bearer cron-test-secret' } }, mockRes());
    assert.equal(cron.kind, 'cron');
    const signed = await requireCronOrCaller(
      { headers: { authorization: `Bearer ${issueSessionToken('r1')}` } },
      mockRes(),
    );
    assert.equal(signed.repId, 'r1');
    const rejected = mockRes();
    assert.equal(await requireCronOrCaller({ headers: {} }, rejected), null);
    assert.equal(rejected.statusCode, 401);
  });

  it('requireSignedIn still accepts this deployment’s server-call header', async () => {
    const { serverCallHeaders } = await import('./agentGate.js');
    const caller = await requireSignedIn({ headers: serverCallHeaders() }, mockRes());
    assert.equal(caller.server, true);
  });
});
