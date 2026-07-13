/**
 * /api/admin-stores — Pulls team store + order data from admin.st1sports.com.
 *
 * Env vars required:
 *   ADMIN_ST1_EMAIL     — login email for admin.st1sports.com
 *   ADMIN_ST1_PASSWORD  — login password
 */

import { setCors } from '../_lib/cors.js';

const API_BASE = 'https://api.st1sports.com/admin';

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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://admin.st1sports.com',
  'Referer': 'https://admin.st1sports.com/',
};

async function authenticate(email, password) {
  _probeLog = [];
  const endpoint = `${API_BASE}/signin`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...BROWSER_HEADERS },
      body: JSON.stringify({ email, password }),
    });
    const status = res.status;
    const ct = res.headers.get('content-type') || '';
    const cookies = parseCookies(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));

    if (status === 401 || status === 403 || status === 422) {
      let errBody = {};
      try { const t = await res.text(); errBody = JSON.parse(t); } catch {}
      _probeLog.push({ endpoint, status, result: 'auth-rejected' });
      return { type: 'rejected', endpoint, status, detail: errBody.error || errBody.message || '' };
    }

    const text = await res.text();
    if ((status === 200 || status === 201) && ct.includes('application/json')) {
      let body; try { body = JSON.parse(text); } catch { body = {}; }
      const token = body.accessToken || body.token || body.access_token || body.auth_token || body.jwt || body.data?.accessToken;
      const refreshToken = body.refreshToken || body.refresh_token || body.data?.refreshToken || null;
      if (token) {
        _probeLog.push({ endpoint, status, result: 'bearer-token', hasCookies: Boolean(cookies) });
        return { type: 'bearer', value: token, refreshToken, cookies: cookies || null, endpoint };
      }
    }
    if (cookies && (status === 200 || status === 201 || status === 302)) {
      return { type: 'cookie', value: cookies, endpoint };
    }
    _probeLog.push({ endpoint, status, ct, result: 'unknown' });
  } catch (err) { _probeLog.push({ endpoint, result: 'error', error: err.message }); }
  return null;
}

async function tryRefresh() {
  if (!_auth?.refreshToken) return false;
  try {
    const url = `${API_BASE}/refresh_access?refreshToken=${encodeURIComponent(_auth.refreshToken)}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json', ...BROWSER_HEADERS }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const body = await r.json();
    const newToken = body.accessToken || body.token || body.access_token;
    if (newToken) { _auth = { ..._auth, value: newToken }; _sessionExpiry = Date.now() + 30 * 60 * 1000; return true; }
    return false;
  } catch { return false; }
}

async function getAuth() {
  if (_auth && _auth.type !== 'rejected' && Date.now() < _sessionExpiry) return _auth;
  const { email, password } = creds();
  if (!email || !password) throw new Error('Admin credentials not configured (ADMIN_ST1_EMAIL / ADMIN_ST1_PASSWORD)');
  const auth = await authenticate(email, password);
  if (!auth) { const summary = _probeLog.map(l => `${l.endpoint}→${l.result}(${l.status||''})`).join(', '); throw new Error(`Could not authenticate. Probe results: ${summary}`); }
  if (auth.type === 'rejected') throw new Error(`Login rejected at ${auth.endpoint} (HTTP ${auth.status}): ${auth.detail}`);
  _auth = auth;
  _sessionExpiry = Date.now() + 30 * 60 * 1000;
  return auth;
}

function buildAuthHeaders(auth) {
  if (auth.type === 'bearer') {
    const h = { 'Authorization': `Bearer ${auth.value}` };
    if (auth.cookies) h['Cookie'] = auth.cookies;
    return h;
  }
  return { 'Cookie': auth.value };
}

async function adminGet(path) {
  const auth = await getAuth();
  const url = `${API_BASE}/${path.replace(/^\/+/, '')}`;
  const makeHeaders = (a) => ({ 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(a) });

  let res = await fetch(url, { headers: makeHeaders(auth) });

  if (res.status === 401 && await tryRefresh()) {
    res = await fetch(url, { headers: makeHeaders(_auth) });
  }

  const readErr = async () => { try { return (await res.text()).slice(0, 200); } catch { return ''; } };

  if (res.status === 401) {
    _auth = null;
    const err = new Error(`Admin API returned 401 for ${path}: ${await readErr()}`);
    err.status = 401; throw err;
  }
  if (res.status === 403) {
    const err = new Error(`Admin API returned 403 for ${path}: ${await readErr()}`);
    err.status = 403; throw err;
  }
  if (!res.ok) {
    const err = new Error(`Admin API returned HTTP ${res.status} for ${path}: ${await readErr()}`);
    err.status = res.status; throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  if (text.trim().startsWith('<')) throw new Error(`Admin API returned HTML for ${path}`);
  return JSON.parse(text);
}

function extractList(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) { if (Array.isArray(data[k])) return data[k]; }
  return [];
}

async function fetchProfile(auth) {
  const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
  const candidates = ['me', 'auth/me', 'profile', 'user', 'account', 'user/profile', 'admin/profile'];
  for (const ep of candidates) {
    try {
      const r = await fetch(`${API_BASE}/${ep}`, { headers: ah, signal: AbortSignal.timeout(4000) });
      if (r.ok) { return { endpoint: ep, data: await r.json() }; }
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action = 'status' } = req.body || {};

  if (action === 'status') {
    const { email, password } = creds();
    return res.json({ ok: true, configured: Boolean(email && password) });
  }

  if (action === 'get-profile') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: e.message }); }
    const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
    const candidates = ['me', 'auth/me', 'profile', 'user', 'account', 'user/profile', 'admin/profile'];
    const results = await Promise.all(candidates.map(async ep => {
      try {
        const r = await fetch(`${API_BASE}/${ep}`, { headers: ah, signal: AbortSignal.timeout(4000) });
        const text = await r.text();
        let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
        return { endpoint: ep, status: r.status, body };
      } catch (e) { return { endpoint: ep, error: e.message }; }
    }));
    const profile = results.find(r => r.status === 200);
    return res.json({
      ok: true, authType: auth.type, hasCookies: Boolean(auth.cookies), authEndpoint: auth.endpoint,
      results, profile: profile ? { endpoint: profile.endpoint, data: profile.body } : null,
    });
  }

  if (action === 'probe-orders') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: e.message }); }
    const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };

    let supplierIds = [];
    try {
      const r = await fetch(`${API_BASE}/supplier?page=1&perPage=100`, { headers: ah, signal: AbortSignal.timeout(5000) });
      if (r.ok) { const d = await r.json(); const l = Array.isArray(d) ? d : (d.data || []); supplierIds = l.map(s => s.id).filter(Boolean); }
    } catch {}

    const variants = [
      'team_store_order',
      'team_store_order?page=1&perPage=5',
      'team_store_order?page=1&perPage=50',
      'team_store_order?page=1&perPage=100',
      'team_store_order?page=1&perPage=200',
      'team_store?page=1&perPage=5',
      ...supplierIds.slice(0, 2).flatMap(sid => [
        `team_store_order?supplierId=${sid}&page=1&perPage=5`,
        `team_store?supplierId=${sid}&page=1&perPage=5`,
      ]),
    ];

    const results = await Promise.all(variants.map(async path => {
      try {
        const r = await fetch(`${API_BASE}/${path}`, { headers: ah, signal: AbortSignal.timeout(6000) });
        const text = await r.text();
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
        const count = parsed ? (Array.isArray(parsed) ? parsed.length : (parsed.data?.length ?? parsed.total ?? null)) : null;
        return { path, status: r.status, count, snippet: text.slice(0, 300).replace(/\n/g, ' ') };
      } catch (e) { return { path, error: e.message }; }
    }));

    const working = results.filter(r => r.status === 200);
    return res.json({ ok: true, supplierIds, results, working });
  }

  if (action === 'scan-store-orders') {
    try {
      const BASE = 'https://admin.st1sports.com';
      const htmlRes = await fetch(`${BASE}/`, { headers: { 'User-Agent': 'ST1-RevOps/1.0' } });
      const html = await htmlRes.text();
      const scriptSrcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
      const allScripts = scriptSrcs.map(s => s.startsWith('http') ? s : `${BASE}${s}`);
      const hits = [];
      for (const scriptUrl of allScripts) {
        const chunk = scriptUrl.split('/').pop();
        try {
          const r = await fetch(scriptUrl, { headers: { 'User-Agent': 'ST1-RevOps/1.0' }, signal: AbortSignal.timeout(15000) });
          const text = await r.text();
          const kws = ['store_order', 'storeOrder', 'StoreOrder', 'store-order', 'storeorders', 'store_orders'];
          const contexts = [];
          for (const kw of kws) {
            let pos = 0;
            while (pos < text.length && contexts.length < 30) {
              const idx = text.toLowerCase().indexOf(kw.toLowerCase(), pos);
              if (idx === -1) break;
              contexts.push({ kw, ctx: text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 300)).replace(/\n/g, ' ').slice(0, 460) });
              pos = idx + kw.length;
            }
          }
          const orderPaths = [...new Set(
            [...text.matchAll(/["'`](\/[^"'`\s]{1,80})["'`]/g)].map(m => m[1])
              .filter(p => /order|store/i.test(p) && !p.startsWith('/assets/') && !/(js|css|png|svg|woff)$/.test(p))
          )];
          if (contexts.length || orderPaths.length) hits.push({ chunk, sizeKB: Math.round(text.length / 1024), contexts: contexts.slice(0, 15), orderPaths });
        } catch (e) { hits.push({ chunk, error: e.message }); }
      }
      return res.json({ ok: true, totalChunks: allScripts.length, hits });
    } catch (e) { return res.json({ ok: false, error: e.message }); }
  }

  if (action === 'probe-permissions') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: `Auth failed: ${e.message}` }); }
    const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
    const sweepPaths = [
      'team_store?page=1&perPage=5', 'team_store_order?page=1&perPage=5', 'products', 'st1_products',
      'supplier', 'school', 'organization', 'account', 'user',
      'report', 'revenue', 'dashboard', 'quote_order',
    ];
    const sweepResults = await Promise.all(sweepPaths.map(async p => {
      try {
        const r = await fetch(`${API_BASE}/${p}`, { headers: ah, signal: AbortSignal.timeout(5000) });
        const text = await r.text();
        return { path: p, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') };
      } catch (e) { return { path: p, error: e.message }; }
    }));
    const accessible = sweepResults.filter(r => r.status && r.status !== 403 && r.status !== 404 && !r.error);
    return res.json({ ok: true, authType: auth.type, hasCookies: Boolean(auth.cookies), authEndpoint: auth.endpoint, sweepResults, accessible });
  }

  if (action === 'probe-extended') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: `Auth failed: ${e.message}` }); }
    const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
    let supplierIds = [];
    try {
      const r = await fetch(`${API_BASE}/supplier`, { headers: ah, signal: AbortSignal.timeout(5000) });
      if (r.ok) { const data = await r.json(); const list = Array.isArray(data) ? data : (data.data || []); supplierIds = list.map(s => s.id).filter(Boolean).slice(0, 3); }
    } catch {}
    const altPaths = [
      'store', 'stores', 'team-store', 'team-stores', 'teamstore', 'teamstores',
      'storefront', 'storefronts', 'order', 'orders', 'store_order', 'store_orders',
      'product', 'supplier_product', 'supplier_products',
      'sales', 'earning', 'earnings', 'payout', 'payouts', 'commission', 'commissions',
    ];
    const altResults = await Promise.all(altPaths.map(async p => {
      try {
        const r = await fetch(`${API_BASE}/${p}`, { headers: ah, signal: AbortSignal.timeout(4000) });
        const text = await r.text();
        return { path: p, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') };
      } catch (e) { return { path: p, error: e.message }; }
    }));
    const supplierNested = [];
    for (const sid of supplierIds) {
      for (const np of ['team_store', 'orders', 'products', 'store', 'stores', 'store_order']) {
        try {
          const r = await fetch(`${API_BASE}/supplier/${sid}/${np}`, { headers: ah, signal: AbortSignal.timeout(4000) });
          const text = await r.text();
          supplierNested.push({ path: `supplier/${sid}/${np}`, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') });
        } catch (e) { supplierNested.push({ path: `supplier/${sid}/${np}`, error: e.message }); }
      }
    }
    const paramVariants = supplierIds.length ? [
      `team_store?page=1&perPage=5`,
      `team_store_order?page=1&perPage=5`,
    ] : [`team_store?page=1&perPage=5`, `team_store_order?page=1&perPage=5`];
    const paramResults = await Promise.all(paramVariants.map(async p => {
      try {
        const r = await fetch(`${API_BASE}/${p}`, { headers: ah, signal: AbortSignal.timeout(4000) });
        const text = await r.text();
        return { path: p, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') };
      } catch (e) { return { path: p, error: e.message }; }
    }));
    const allAccessible = [...altResults, ...supplierNested, ...paramResults].filter(r => r.status && r.status !== 403 && r.status !== 404 && !r.error);
    return res.json({ ok: true, supplierIds, altResults, supplierNested, paramResults, allAccessible });
  }

  try {
    if (action === 'stores') {
      const data = await adminGet('team_store?page=1&perPage=50');
      const stores = extractList(data, 'data', 'team_stores', 'teamStores', 'stores');
      return res.json({ ok: true, stores, authEndpoint: _auth?.endpoint });
    }
    if (action === 'orders') {
      const data = await adminGet('team_store_order?page=1&perPage=50');
      const orders = extractList(data, 'data', 'team_store_orders', 'teamStoreOrders', 'orders');
      return res.json({ ok: true, orders });
    }
    if (action === 'top-sellers') {
      const data = await adminGet('team_store_order?page=1&perPage=50');
      const orders = extractList(data, 'data', 'team_store_orders', 'teamStoreOrders', 'orders');
      const productMap = {};
      for (const order of orders) {
        // Handle both camelCase and snake_case field names from the API
        const lineItems =
          order.lineItems || order.line_items ||
          order.orderItems || order.order_items ||
          order.items || order.products ||
          order.cartItems || order.cart_items ||
          order.orderLines || order.order_lines || [];
        const storeName =
          order.storeName || order.store_name ||
          order.teamStoreName || order.team_store_name ||
          order.teamStore?.name || order.team_store?.name ||
          order.store?.name || order.schoolName || order.school_name || 'Unknown Store';
        for (const item of lineItems) {
          const name = item.name || item.productName || item.product_name || item.title || item.description || item.sku || null;
          if (!name) continue;
          const qty = Number(item.quantity || item.qty || item.count || 1);
          const price = Number(item.price || item.unitPrice || item.unit_price || item.amount || item.total || 0);
          const revenue = qty * price;
          if (!productMap[name]) productMap[name] = { name, revenue: 0, orders: 0, quantity: 0, stores: new Set() };
          productMap[name].revenue += revenue;
          productMap[name].orders++;
          productMap[name].quantity += qty;
          productMap[name].stores.add(storeName);
        }
      }
      const sellers = Object.values(productMap).map(p => ({ ...p, stores: p.stores.size })).sort((a, b) => b.quantity - a.quantity);
      return res.json({ ok: true, sellers, rawOrderCount: orders.length, authEndpoint: _auth?.endpoint });
    }
    if (action === 'raw-sample') {
      const data = await adminGet('team_store_order?page=1&perPage=3');
      const orders = extractList(data, 'data', 'team_store_orders', 'teamStoreOrders', 'orders');
      // Return first order with full field list to reveal the data structure
      return res.json({ ok: true, sample: orders.slice(0, 2), totalFetched: orders.length, authEndpoint: _auth?.endpoint });
    }
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[admin-stores]', e.message);
    return res.status(500).json({ ok: false, error: e.message, probeLog: _probeLog });
  }
}
