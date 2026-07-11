/**
 * /api/admin-stores — Pulls team store + order data from admin.st1sports.com.
 *
 * The admin site is a Vite SPA; the real API backend is api.st1sports.com/admin.
 *
 * Env vars required:
 *   ADMIN_ST1_EMAIL     — login email for admin.st1sports.com
 *   ADMIN_ST1_PASSWORD  — login password
 */

import { setCors } from '../_lib/cors.js';

const BASE     = 'https://admin.st1sports.com';
const API_BASE = 'https://api.st1sports.com/admin';
const API_ROOT = 'https://api.st1sports.com';

const AUTH_ENDPOINTS = [
  // NestJS/Passport patterns — most likely given camelCase accessToken response
  { base: API_BASE, path: '/auth/login',        body: (e, p) => ({ email: e, password: p }) },
  { base: API_BASE, path: '/auth/signin',       body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/auth/login',        body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/auth/signin',       body: (e, p) => ({ email: e, password: p }) },
  { base: API_BASE, path: '/login',             body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/login',             body: (e, p) => ({ email: e, password: p }) },
  { base: API_BASE, path: '/signin',            body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/signin',            body: (e, p) => ({ email: e, password: p }) },
  // Fallback patterns
  { base: API_BASE, path: '/sign_in',           body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/tokens',            body: (e, p) => ({ email: e, password: p }) },
  { base: API_BASE, path: '/tokens',            body: (e, p) => ({ email: e, password: p }) },
  { base: API_ROOT, path: '/authenticate',      body: (e, p) => ({ email: e, password: p }) },
  { base: API_BASE, path: '/authenticate',      body: (e, p) => ({ email: e, password: p }) },
];

let _auth = null;
let _sessionExpiry = 0;
let _probeLog = [];

function creds() {
  return {
    email:    process.env.ADMIN_ST1_EMAIL    || process.env.ADMIN_EMAIL    || '',
    password: process.env.ADMIN_ST1_PASSWORD || process.env.ADMIN_PASSWORD || '',
  };
}

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return headers.map(h => h.split(';')[0]).join('; ');
}

async function probeAuth(email, password) {
  _probeLog = [];
  for (const ep of AUTH_ENDPOINTS) {
    let status, ct, cookies, bodySnippet;
    try {
      const res = await fetch(`${ep.base}${ep.path}`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'ST1-RevOps/1.0' },
        body: JSON.stringify(ep.body(email, password)),
      });
      status = res.status;
      ct = res.headers.get('content-type') || '';
      cookies = parseCookies(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));
      if (status === 404 || status === 405) { _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'not-found' }); continue; }
      if (cookies && (status === 200 || status === 201 || status === 302)) {
        _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'cookie-auth' });
        return { type: 'cookie', value: cookies, endpoint: `${ep.base}${ep.path}` };
      }
      const text = await res.text();
      bodySnippet = text.slice(0, 200).replace(/\n/g, ' ');
      if (ct.includes('text/html') || text.trim().startsWith('<')) { _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, ct, result: 'html-response' }); continue; }
      if ((status === 200 || status === 201) && ct.includes('application/json')) {
        let body; try { body = JSON.parse(text); } catch { body = {}; }
        const token = body.accessToken || body.token || body.access_token || body.auth_token || body.jwt || body.data?.accessToken || body.data?.token || body.user?.token || body.data?.access_token;
        if (token) { _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'bearer-token' }); return { type: 'bearer', value: token, endpoint: `${ep.base}${ep.path}` }; }
        if (cookies) { _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'cookie-json' }); return { type: 'cookie', value: cookies, endpoint: `${ep.base}${ep.path}` }; }
        _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'json-no-token', keys: Object.keys(body).join(','), snippet: bodySnippet }); continue;
      }
      if ((status === 401 || status === 403 || status === 422) && ct.includes('application/json')) {
        let errBody; try { errBody = JSON.parse(text); } catch { errBody = {}; }
        _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, result: 'auth-rejected', error: errBody.error || errBody.message || bodySnippet });
        return { type: 'rejected', endpoint: `${ep.base}${ep.path}`, status, detail: errBody.error || errBody.message || bodySnippet };
      }
      _probeLog.push({ endpoint: `${ep.base}${ep.path}`, status, ct, result: 'unknown', snippet: bodySnippet });
    } catch (err) { _probeLog.push({ endpoint: `${ep.base}${ep.path}`, result: 'error', error: err.message }); }
  }
  return null;
}

async function getAuth() {
  if (_auth && _auth.type !== 'rejected' && Date.now() < _sessionExpiry) return _auth;
  const { email, password } = creds();
  if (!email || !password) throw new Error('Admin credentials not configured (ADMIN_ST1_EMAIL / ADMIN_ST1_PASSWORD)');
  const auth = await probeAuth(email, password);
  if (!auth) { const summary = _probeLog.map(l => `${l.endpoint}→${l.result}(${l.status||''})` ).join(', '); throw new Error(`Could not authenticate. Probe results: ${summary}`); }
  if (auth.type === 'rejected') throw new Error(`Login rejected at ${auth.endpoint} (HTTP ${auth.status}): ${auth.detail}`);
  _auth = auth;
  _sessionExpiry = Date.now() + 30 * 60 * 1000;
  return auth;
}

async function adminGet(path) {
  const auth = await getAuth();
  const authHeader = auth.type === 'bearer' ? { 'Authorization': `Bearer ${auth.value}` } : { 'Cookie': auth.value };
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'Accept': 'application/json', 'User-Agent': 'ST1-RevOps/1.0', ...authHeader } });
  if (res.status === 401 || res.status === 403) { _auth = null; throw new Error(`Admin API returned ${res.status} for ${path}`); }
  if (!res.ok) throw new Error(`Admin API returned HTTP ${res.status} for ${path}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error(`Admin API returned HTML for ${path}`);
  return JSON.parse(text);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action = 'status' } = req.body || {};

  if (action === 'status') { const { email, password } = creds(); return res.json({ ok: true, configured: Boolean(email && password) }); }

  if (action === 'discover') {
    const paths = [`${API_ROOT}/`, `${API_BASE}/`, `${API_ROOT}/rails/info/routes`, `${API_ROOT}/swagger.json`, `${API_ROOT}/api-docs`, `${API_ROOT}/openapi.json`, `${API_BASE}/swagger.json`];
    const results = await Promise.all(paths.map(async url => {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json, text/plain, */*', 'User-Agent': 'ST1-RevOps/1.0' }, signal: AbortSignal.timeout(5000) });
        const ct = r.headers.get('content-type') || '';
        const body = await r.text();
        return { url, status: r.status, ct, snippet: body.slice(0, 300).replace(/\n/g, ' ') };
      } catch (e) { return { url, error: e.message }; }
    }));
    return res.json({ ok: true, results });
  }

  if (action === 'probe-auth') {
    const { email, password } = creds();
    if (!email || !password) return res.json({ ok: false, error: 'Credentials not configured' });
    const auth = await probeAuth(email, password);
    return res.json({ ok: true, auth: auth ? { type: auth.type, endpoint: auth.endpoint, status: auth.status } : null, probeLog: _probeLog });
  }

  if (action === 'find-api') {
    try {
      const htmlRes = await fetch(`${BASE}/`, { headers: { 'User-Agent': 'ST1-RevOps/1.0' } });
      const html = await htmlRes.text();
      const scriptMatches = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
      const mainScript = scriptMatches.find(s => /\/(index|main)[^/]*\.js/.test(s)) || scriptMatches[0];
      if (!mainScript) return res.json({ ok: false, error: 'No JS bundle found', scripts: scriptMatches });
      const bundleUrl = mainScript.startsWith('http') ? mainScript : `${BASE}${mainScript}`;
      const bundleRes = await fetch(bundleUrl, { headers: { 'User-Agent': 'ST1-RevOps/1.0' } });
      const bundleText = await bundleRes.text();
      const allQuoted = [...new Set([
        ...[...bundleText.matchAll(/["'`]([^"'`]*st1sports[^"'`]{0,100})["'`]/gi)].map(m => m[1]),
        ...[...bundleText.matchAll(/["'`](https:\/\/[^"'`\s]{5,120})["'`]/g)].map(m => m[1]),
        ...[...bundleText.matchAll(/["'`](\/api\/[^"'`\s]{3,80})["'`]/g)].map(m => m[1]),
        ...[...bundleText.matchAll(/baseURL?["'`]?\s*[:=]\s*["'`]([^"'`\s]{5,120})["'`]/gi)].map(m => m[1]),
        ...[...bundleText.matchAll(/["'`](\/[^"'`\s]*(?:login|sign_in|auth|session)[^"'`\s]{0,60})["'`]/gi)].map(m => m[1]),
      ])];
      const candidates = ['https://api.st1sports.com','https://app.st1sports.com','https://st1sports.com','https://admin-api.st1sports.com'];
      const probeResults = await Promise.all(candidates.map(async base => {
        try {
          const r = await fetch(`${base}/health`, { headers: { 'User-Agent': 'ST1-RevOps/1.0' }, signal: AbortSignal.timeout(4000) });
          const ct = r.headers.get('content-type') || '';
          const body = await r.text();
          return { base, status: r.status, ct, snippet: body.slice(0, 100).replace(/\n/g, ' ') };
        } catch (e) { return { base, error: e.message }; }
      }));
      return res.json({ ok: true, bundleUrl, bundleSizeChars: bundleText.length, urlMatches: allQuoted.slice(0, 80), candidateProbes: probeResults, allScripts: scriptMatches });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }

  // Deep-scan bundle for: POST login call, lp() token hook definition, localStorage patterns.
  if (action === 'find-auth') {
    try {
      const htmlRes = await fetch(`${BASE}/`, { headers: { 'User-Agent': 'ST1-RevOps/1.0' } });
      const html = await htmlRes.text();
      const scriptSrcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
      const allScripts = scriptSrcs.map(s => s.startsWith('http') ? s : `${BASE}${s}`);

      const chunkResults = [];
      for (const scriptUrl of allScripts.slice(0, 10)) {
        try {
          const r = await fetch(scriptUrl, { headers: { 'User-Agent': 'ST1-RevOps/1.0' }, signal: AbortSignal.timeout(10000) });
          const text = await r.text();
          const chunk = scriptUrl.split('/').pop();
          const sizeKB = Math.round(text.length / 1024);

          // 1. POST method occurrences — 400 chars context, only keep if near email/password/signin/login
          const postContexts = [];
          let pi = 0;
          while ((pi = text.indexOf('"POST"', pi)) !== -1 && postContexts.length < 8) {
            const start = Math.max(0, pi - 300);
            const end = Math.min(text.length, pi + 300);
            const ctx = text.slice(start, end).replace(/\n/g, ' ');
            if (/email|password|sign|login|auth|token/i.test(ctx)) postContexts.push(ctx);
            pi += 6;
          }

          // 2. lp() definition — look for "lp=" or "function lp"
          const lpDefs = [];
          for (const pat of [/\blp\s*=\s*[^,;]{0,300}/g, /function lp\s*\([^)]*\)\s*\{[^}]{0,300}/g]) {
            for (const m of text.matchAll(pat)) lpDefs.push(m[0].slice(0, 300).replace(/\n/g, ' '));
          }

          // 3. localStorage / sessionStorage patterns
          const storagePats = [];
          let si = 0;
          while (si < text.length && storagePats.length < 6) {
            const lsIdx = text.indexOf('localStorage', si);
            const ssIdx = text.indexOf('sessionStorage', si);
            if (lsIdx === -1 && ssIdx === -1) break;
            const abs = lsIdx === -1 ? ssIdx : ssIdx === -1 ? lsIdx : Math.min(lsIdx, ssIdx);
            const ctx = text.slice(Math.max(0, abs - 60), Math.min(text.length, abs + 200)).replace(/\n/g, ' ');
            storagePats.push(ctx);
            si = abs + 12;
          }

          // 4. useMutation / mutate calls near auth
          const mutationCtxs = [];
          for (const m of text.matchAll(/useMutation|\.mutate\s*\(/g)) {
            const start = Math.max(0, m.index - 100);
            const end = Math.min(text.length, m.index + 300);
            const ctx = text.slice(start, end).replace(/\n/g, ' ');
            if (/sign|login|auth|email|password/i.test(ctx)) mutationCtxs.push(ctx.slice(0, 300));
          }

          // 5. All quoted path-like strings that look auth-related
          const authPaths = [...new Set(
            [...text.matchAll(/["'`](\/[^"'`\s]{2,80})["'`]/g)]
              .map(m => m[1])
              .filter(p => /auth|login|sign|session|token/i.test(p))
          )];

          if (postContexts.length || lpDefs.length || storagePats.length || mutationCtxs.length || authPaths.length) {
            chunkResults.push({ chunk, sizeKB, postContexts, lpDefs: lpDefs.slice(0, 5), storagePats: storagePats.slice(0, 4), mutationCtxs: mutationCtxs.slice(0, 4), authPaths });
          }
        } catch (e) {
          chunkResults.push({ chunk: scriptUrl.split('/').pop(), error: e.message });
        }
      }
      return res.json({ ok: true, chunkResults, totalChunks: allScripts.length });
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  }

  // Scan the admin app bundle for API paths, auth interceptors, and Authorization header setup.
  if (action === 'scan-bundle-paths') {
    try {
      const htmlRes = await fetch(`${BASE}/`, { headers: { 'User-Agent': 'ST1-RevOps/1.0' } });
      const html = await htmlRes.text();
      const scriptSrcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
      const allScripts = scriptSrcs.map(s => s.startsWith('http') ? s : `${BASE}${s}`);

      const chunkResults = [];
      for (const scriptUrl of allScripts.slice(0, 5)) {
        const chunk = scriptUrl.split('/').pop();
        try {
          const r = await fetch(scriptUrl, { headers: { 'User-Agent': 'ST1-RevOps/1.0' }, signal: AbortSignal.timeout(15000) });
          const text = await r.text();
          const sizeKB = Math.round(text.length / 1024);

          // 1. interceptors.request.use — where auth token is added to headers
          const interceptorCtxs = [];
          let pos = 0;
          while (pos < text.length && interceptorCtxs.length < 4) {
            const idx = text.indexOf('interceptors', pos);
            if (idx === -1) break;
            const ctx = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + 500)).replace(/\n/g, ' ');
            if (/token|bearer|access|auth|header/i.test(ctx)) interceptorCtxs.push(ctx.slice(0, 500));
            pos = idx + 12;
          }

          // 2. Authorization header construction
          const authCtxs = [];
          pos = 0;
          while (pos < text.length && authCtxs.length < 6) {
            const idx = text.indexOf('Authorization', pos);
            if (idx === -1) break;
            authCtxs.push(text.slice(Math.max(0, idx - 100), Math.min(text.length, idx + 280)).replace(/\n/g, ' ').slice(0, 350));
            pos = idx + 13;
          }

          // 3. All short quoted path-like strings (API routes)
          const apiPaths = [...new Set(
            [...text.matchAll(/["'`](\/[a-z][a-z0-9_/-]{1,60})["'`]/gi)].map(m => m[1])
              .filter(p => !p.startsWith('/assets/') && !p.startsWith('/static/') && !/\.(js|css|png|svg|woff|ico)/.test(p))
          )];

          // 4. axios.create({}) config — shows baseURL and default headers
          const createCtxs = [];
          pos = 0;
          while (pos < text.length && createCtxs.length < 3) {
            const idx = text.indexOf('.create({', pos);
            if (idx === -1) break;
            const ctx = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + 400)).replace(/\n/g, ' ');
            if (/url|timeout|header/i.test(ctx)) createCtxs.push(ctx.slice(0, 400));
            pos = idx + 9;
          }

          // 5. team_store / store_order / order-related keyword contexts
          const endpointCtxs = [];
          const kws = ['team_store', 'store_order', 'storeOrder', 'teamStore', '/stores', '/orders', '/products', '/school', '/purchase', '/merchant'];
          for (const kw of kws) {
            pos = 0;
            while (pos < text.length && endpointCtxs.length < 20) {
              const idx = text.toLowerCase().indexOf(kw.toLowerCase(), pos);
              if (idx === -1) break;
              const before = text[idx - 1] || '';
              if (/["'`\/]/.test(before)) {
                const ctx = text.slice(Math.max(0, idx - 100), Math.min(text.length, idx + 200)).replace(/\n/g, ' ');
                endpointCtxs.push({ kw, ctx: ctx.slice(0, 280) });
              }
              pos = idx + kw.length;
            }
          }

          if (interceptorCtxs.length || authCtxs.length || endpointCtxs.length || createCtxs.length) {
            chunkResults.push({ chunk, sizeKB, interceptorCtxs, authCtxs, apiPaths: apiPaths.slice(0, 120), createCtxs, endpointCtxs: endpointCtxs.slice(0, 15) });
          }
        } catch (e) { chunkResults.push({ chunk, error: e.message }); }
      }
      return res.json({ ok: true, chunkResults, totalChunks: allScripts.length });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }

  // Probe all candidate data endpoint paths to find which ones return data.
  if (action === 'discover-data') {
    // Expanded path list — includes query-param variant for 401 endpoint and more ST1-specific names
    const storePaths  = [
      '/team_stores', '/team-stores', '/teamStores', '/stores', '/store', '/team_store',
      '/team_store?page=1&limit=20', '/school_store', '/school_stores',
      '/org_stores', '/organization_stores', '/merchant_stores', '/clients', '/accounts',
    ];
    const orderPaths  = [
      '/store_orders', '/store-orders', '/storeOrders', '/orders', '/order', '/store_order',
      '/purchase', '/purchases', '/transactions', '/checkouts',
      '/team_store_orders', '/school_store_orders',
    ];
    // Fetch auth once up front to avoid concurrent probeAuth races
    let authHeaders;
    try {
      const auth = await getAuth();
      authHeaders = auth.type === 'bearer' ? { 'Authorization': `Bearer ${auth.value}` } : { 'Cookie': auth.value };
    } catch (e) {
      return res.json({ ok: false, error: `Auth failed: ${e.message}`, probeLog: _probeLog });
    }
    const probeOne = async path => {
      const cleanPath = path.split('?')[0];
      const url = `${API_BASE}${path}`;
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'ST1-RevOps/1.0', ...authHeaders }, signal: AbortSignal.timeout(5000) });
        const text = await r.text();
        return { path: cleanPath, params: path.includes('?') ? path.split('?')[1] : null, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') };
      } catch (e) { return { path: cleanPath, error: e.message }; }
    };
    const [storeResults, orderResults] = await Promise.all([
      Promise.all(storePaths.map(probeOne)),
      Promise.all(orderPaths.map(probeOne)),
    ]);
    return res.json({ ok: true, authEndpoint: _auth?.endpoint, storeResults, orderResults });
  }

  try {
    if (action === 'stores') {
      const data = await adminGet('/team_stores');
      const stores = Array.isArray(data) ? data : (data.team_stores || data.stores || data);
      return res.json({ ok: true, stores, authEndpoint: _auth?.endpoint });
    }
    if (action === 'orders') {
      const data = await adminGet('/store_orders');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);
      return res.json({ ok: true, orders });
    }
    if (action === 'top-sellers') {
      const data = await adminGet('/store_orders');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);
      const productMap = {};
      for (const order of orders) {
        const lineItems = order.line_items || order.items || order.order_items || order.products || order.order_lines || [];
        const storeName = order.store_name || order.team_store_name || order.store?.name || order.team_store?.name || order.school_name || 'Unknown Store';
        for (const item of lineItems) {
          const name = item.name || item.product_name || item.title || item.description || item.sku || null;
          if (!name) continue;
          const qty = Number(item.quantity || item.qty || 1);
          const price = Number(item.price || item.unit_price || item.amount || 0);
          const revenue = qty * price;
          if (!productMap[name]) productMap[name] = { name, revenue: 0, orders: 0, quantity: 0, stores: new Set() };
          productMap[name].revenue += revenue; productMap[name].orders++; productMap[name].quantity += qty; productMap[name].stores.add(storeName);
        }
      }
      const sellers = Object.values(productMap).map(p => ({ ...p, stores: p.stores.size })).sort((a, b) => b.quantity - a.quantity);
      return res.json({ ok: true, sellers, rawOrderCount: orders.length, authEndpoint: _auth?.endpoint });
    }
    if (action === 'raw-sample') {
      const data = await adminGet('/store_orders');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);
      return res.json({ ok: true, sample: orders.slice(0, 2), totalOrders: orders.length, authEndpoint: _auth?.endpoint });
    }
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[admin-stores]', e.message);
    return res.status(500).json({ ok: false, error: e.message, probeLog: _probeLog });
  }
}
