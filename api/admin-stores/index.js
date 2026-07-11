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

// Browser-like headers that match what the admin SPA sends
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
    if (cookies && (status === 200 || status === 201 || status === 302)) {
      return { type: 'cookie', value: cookies, endpoint };
    }
    const text = await res.text();
    if ((status === 200 || status === 201) && ct.includes('application/json')) {
      let body; try { body = JSON.parse(text); } catch { body = {}; }
      const token = body.accessToken || body.token || body.access_token || body.auth_token || body.jwt || body.data?.accessToken;
      const refreshToken = body.refreshToken || body.refresh_token || body.data?.refreshToken || null;
      if (token) { _probeLog.push({ endpoint, status, result: 'bearer-token' }); return { type: 'bearer', value: token, refreshToken, endpoint }; }
      if (cookies) return { type: 'cookie', value: cookies, endpoint };
      _probeLog.push({ endpoint, status, result: 'json-no-token', keys: Object.keys(body).join(',') });
    }
    if (status === 401 || status === 403 || status === 422) {
      let errBody; try { errBody = JSON.parse(text); } catch { errBody = {}; }
      _probeLog.push({ endpoint, status, result: 'auth-rejected' });
      return { type: 'rejected', endpoint, status, detail: errBody.error || errBody.message || text.slice(0, 200) };
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

async function adminGet(path) {
  const auth = await getAuth();
  const authHeader = auth.type === 'bearer' ? { 'Authorization': `Bearer ${auth.value}` } : { 'Cookie': auth.value };
  const url = `${API_BASE}/${path.replace(/^\/+/, '')}`;
  const doFetch = (ah) => fetch(url, { headers: { 'Accept': 'application/json', ...BROWSER_HEADERS, ...ah } });

  let res = await doFetch(authHeader);

  if (res.status === 401 && await tryRefresh()) {
    const newAuthHeader = _auth.type === 'bearer' ? { 'Authorization': `Bearer ${_auth.value}` } : { 'Cookie': _auth.value };
    res = await doFetch(newAuthHeader);
  }

  if (res.status === 401 || res.status === 403) {
    _auth = null;
    const errText = await res.text().catch(() => '');
    throw new Error(`Admin API returned ${res.status} for ${path}: ${errText.slice(0, 200)}`);
  }
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

  // Probe what role/permissions this token has — use to verify new credentials after updating env vars
  if (action === 'probe-permissions') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: `Auth failed: ${e.message}` }); }
    const ah = { 'Authorization': `Bearer ${auth.value}`, 'Accept': 'application/json', ...BROWSER_HEADERS };

    const sweepPaths = [
      'team_store', 'team_store_order', 'products', 'st1_products',
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
    return res.json({ ok: true, authEndpoint: auth.endpoint, sweepResults, accessible });
  }

  // Wider sweep: alternate path forms, supplier-nested paths, param variants
  if (action === 'probe-extended') {
    let auth;
    try { auth = await getAuth(); } catch (e) { return res.json({ ok: false, error: `Auth failed: ${e.message}` }); }
    const ah = { 'Authorization': `Bearer ${auth.value}`, 'Accept': 'application/json', ...BROWSER_HEADERS };

    let supplierIds = [];
    try {
      const r = await fetch(`${API_BASE}/supplier`, { headers: ah, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        const list = Array.isArray(data) ? data : (data.data || []);
        supplierIds = list.map(s => s.id).filter(Boolean).slice(0, 3);
      }
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
      `team_store?supplierId=${supplierIds[0]}`,
      `team_store?supplier_id=${supplierIds[0]}`,
      `team_store_order?supplierId=${supplierIds[0]}`,
    ] : [`team_store?page=1&perPage=5`];
    const paramResults = await Promise.all(paramVariants.map(async p => {
      try {
        const r = await fetch(`${API_BASE}/${p}`, { headers: ah, signal: AbortSignal.timeout(4000) });
        const text = await r.text();
        return { path: p, status: r.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') };
      } catch (e) { return { path: p, error: e.message }; }
    }));

    const allAccessible = [...altResults, ...supplierNested, ...paramResults]
      .filter(r => r.status && r.status !== 403 && r.status !== 404 && !r.error);

    return res.json({ ok: true, supplierIds, altResults, supplierNested, paramResults, allAccessible });
  }

  try {
    if (action === 'stores') {
      const data = await adminGet('team_store?page=1&perPage=200');
      const stores = Array.isArray(data) ? data : (data.data || data.team_stores || data.stores || []);
      return res.json({ ok: true, stores, authEndpoint: _auth?.endpoint });
    }
    if (action === 'orders') {
      const data = await adminGet('team_store_order?page=1&perPage=200');
      const orders = Array.isArray(data) ? data : (data.data || data.team_store_orders || data.orders || []);
      return res.json({ ok: true, orders });
    }
    if (action === 'top-sellers') {
      const data = await adminGet('team_store_order?page=1&perPage=200');
      const orders = Array.isArray(data) ? data : (data.data || data.team_store_orders || data.orders || []);
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
      const data = await adminGet('team_store_order?page=1&perPage=5');
      const orders = Array.isArray(data) ? data : (data.data || data.team_store_orders || data.orders || []);
      return res.json({ ok: true, sample: orders.slice(0, 2), totalOrders: orders.length, authEndpoint: _auth?.endpoint });
    }
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[admin-stores]', e.message);
    return res.status(500).json({ ok: false, error: e.message, probeLog: _probeLog });
  }
}
