/**
 * /api/admin-stores — Pulls team store + order data from admin.st1sports.com.
 *
 * Env vars required:
 *   ADMIN_ST1_EMAIL     — login email for admin.st1sports.com
 *   ADMIN_ST1_PASSWORD  — login password
 */

import { setCors } from '../_lib/cors.js';

const API_BASE = 'https://api.st1sports.com/admin';

// Wall-clock budget for the multi-request crawls, kept inside this function's
// maxDuration (see vercel.json) so there is always time left to aggregate and
// answer with JSON instead of being cut off mid-flight.
const SCAN_BUDGET_MS = 45_000;
// Time held back from the order-listing pass for the per-order detail pass.
const DETAIL_RESERVE_MS = 25_000;
// Simultaneous detail requests against the admin API.
const DETAIL_CONCURRENCY = 12;

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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action = 'status' } = req.body || {};

  if (action === 'status') {
    const { email, password } = creds();
    return res.json({ ok: true, configured: Boolean(email && password) });
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
      // This action reads every team-store order and then every order's detail
      // record, so its cost grows with the business. Left unbounded it ran past
      // the function's maxDuration, and Vercel's 504 (an HTML body) was all the
      // dashboard got back — which it could only surface as a JSON parse error,
      // wiping out the Stripe reports next to it. Everything below is bounded
      // by a wall-clock budget and returns partial results rather than dying.
      const deadline = Date.now() + SCAN_BUDGET_MS;
      const timeLeft = () => deadline - Date.now();

      // Fetch pages until we get a partial page (no reliance on total metadata)
      const PER_PAGE = 100;
      let allOrders = [];
      let page = 1;
      let partialReason = null;
      while (page <= 50) { // safety cap at 5,000 orders
        const pageData = await adminGet(`team_store_order?page=${page}&perPage=${PER_PAGE}`);
        const pageOrders = extractList(pageData, 'data', 'team_store_orders', 'teamStoreOrders', 'orders');
        allOrders.push(...pageOrders);
        if (pageOrders.length < PER_PAGE) break; // last page
        // Leave room for the detail pass, which is where most of the time goes.
        if (timeLeft() < DETAIL_RESERVE_MS) { partialReason = 'time'; break; }
        page++;
      }
      if (!partialReason && page > 50) partialReason = 'pages';

      // Fetch each order's detail record (the items array lives there), a
      // bounded number at a time — mapping straight over every order fired
      // thousands of simultaneous requests at the admin API, which made both
      // ends slower and got connections dropped.
      const auth = _auth;
      const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
      const details = [];
      let skipped = 0;
      for (let i = 0; i < allOrders.length; i += DETAIL_CONCURRENCY) {
        if (timeLeft() < 3000) {
          skipped = allOrders.length - details.length;
          partialReason = partialReason || 'time';
          break;
        }
        const batch = allOrders.slice(i, i + DETAIL_CONCURRENCY);
        details.push(...await Promise.all(
          batch.map(async order => {
            const storeName = order.teamStore?.name || order.storeName || order.store_name || 'Unknown Store';
            try {
              const r = await fetch(`${API_BASE}/team_store_order/${order.id}`, { headers: ah, signal: AbortSignal.timeout(8000) });
              if (r.ok) return { storeName, detail: await r.json() };
            } catch {}
            return { storeName, detail: null };
          })
        ));
      }

      // Aggregate by product name
      const productMap = {};
      for (const { storeName, detail } of details) {
        if (!detail) continue;
        const lineItems = detail.items || detail.lineItems || detail.line_items ||
          detail.orderItems || detail.order_items || detail.products ||
          detail.cartItems || detail.cart_items || detail.orderLines || detail.order_lines || [];
        for (const item of lineItems) {
          const name = item.name || item.productName || item.product_name || item.title || item.description ||
            item.teamStoreProduct?.product?.name || item.sku || null;
          if (!name) continue;
          const qty = Number(item.quantity || item.qty || item.count || 1);
          const price = Number(item.price || item.unitPrice || item.unit_price || item.amount || item.total || 0);
          if (!productMap[name]) productMap[name] = { name, revenue: 0, orders: 0, quantity: 0, stores: new Set() };
          productMap[name].revenue += qty * price;
          productMap[name].orders++;
          productMap[name].quantity += qty;
          productMap[name].stores.add(storeName);
        }
      }
      const sellers = Object.values(productMap)
        .map(p => ({ ...p, stores: p.stores.size }))
        .sort((a, b) => b.quantity - a.quantity);
      return res.json({
        ok: true,
        sellers,
        rawOrderCount:    details.length,
        ordersFound:      allOrders.length,
        ordersWithDetail: details.filter(d => d.detail).length,
        ordersSkipped:    skipped,
        partial:          Boolean(partialReason),
        partialReason,
        authEndpoint:     _auth?.endpoint,
      });
    }

    if (action === 'raw-sample') {
      const data = await adminGet('team_store_order?page=1&perPage=3');
      const orders = extractList(data, 'data', 'team_store_orders', 'teamStoreOrders', 'orders');
      // Also fetch individual order detail to reveal full field structure (line items location)
      const auth = _auth;
      const ah = { 'Accept': 'application/json', ...BROWSER_HEADERS, ...buildAuthHeaders(auth) };
      let orderDetail = null, orderDetailStatus = null, orderDetailError = null;
      let cartDetail = null, cartDetailStatus = null, cartDetailError = null;
      const first = orders[0];
      if (first) {
        try {
          const r = await fetch(`${API_BASE}/team_store_order/${first.id}`, { headers: ah, signal: AbortSignal.timeout(6000) });
          orderDetailStatus = r.status;
          if (r.ok) orderDetail = await r.json();
          else orderDetailError = (await r.text()).slice(0, 300);
        } catch (e) { orderDetailError = e.message; }
        if (first.cartId) {
          try {
            const r = await fetch(`${API_BASE}/cart/${first.cartId}`, { headers: ah, signal: AbortSignal.timeout(6000) });
            cartDetailStatus = r.status;
            if (r.ok) cartDetail = await r.json();
            else cartDetailError = (await r.text()).slice(0, 300);
          } catch (e) { cartDetailError = e.message; }
        }
      }
      return res.json({
        ok: true, sample: orders.slice(0, 2), totalFetched: orders.length,
        orderDetail, orderDetailStatus, orderDetailError,
        cartDetail, cartDetailStatus, cartDetailError,
        firstOrderId: first?.id, firstCartId: first?.cartId,
        authEndpoint: _auth?.endpoint,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[admin-stores]', e.message);
    return res.status(500).json({ ok: false, error: e.message, probeLog: _probeLog });
  }
}
