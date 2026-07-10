/**
 * /api/admin-stores — Pulls team store + order data from admin.st1sports.com.
 *
 * Authenticates via Rails/Devise session (CSRF + cookie) then fetches:
 *   GET /team_stores.json  — list of stores with slug, name, status
 *   GET /store_orders.json — orders with store reference
 *
 * Env vars required:
 *   ADMIN_ST1_EMAIL     — login email for admin.st1sports.com
 *   ADMIN_ST1_PASSWORD  — login password
 *
 * Actions (POST body: { action }):
 *   status  — check if credentials are configured
 *   stores  — return all team stores with status
 *   orders  — return store orders (optional: ?storeSlug=xxx to filter)
 */

import { setCors } from '../_lib/cors.js';

const BASE = 'https://admin.st1sports.com';

// Simple in-process session cache (reuse across Vercel invocations while warm)
let _sessionCookies = null;
let _sessionExpiry  = 0;

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

// Returns { type: 'cookie'|'bearer', value: string }
async function getAuth() {
  if (_sessionCookies && Date.now() < _sessionExpiry) {
    return JSON.parse(_sessionCookies);
  }

  const { email, password } = creds();
  if (!email || !password) throw new Error('Admin credentials not configured (ADMIN_ST1_EMAIL / ADMIN_ST1_PASSWORD)');

  // Try JSON token-based auth first (SPA / API pattern — returns 200 + token in body)
  const tokenRes = await fetch(`${BASE}/users/sign_in`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'ST1-RevOps/1.0',
    },
    body: JSON.stringify({ user: { email, password } }),
  });

  if (tokenRes.status === 200 || tokenRes.status === 201) {
    const ct = tokenRes.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await tokenRes.json();
      // Common token field names across Devise JWT, devise_token_auth, etc.
      const token = body.token || body.access_token || body.auth_token ||
                    body.jwt || body.data?.token || body.user?.token;
      if (token) {
        const auth = { type: 'bearer', value: token };
        _sessionCookies = JSON.stringify(auth);
        _sessionExpiry  = Date.now() + 30 * 60 * 1000;
        return auth;
      }
      // 200 but no recognisable token — surface the body for debugging
      throw new Error(`Login returned 200 but no token found. Body keys: ${Object.keys(body).join(', ')}`);
    }
  }

  // Fallback: cookie-based auth (Devise HTML form flow)
  const loginPageRes = await fetch(`${BASE}/users/sign_in`, {
    headers: { 'Accept': 'text/html', 'User-Agent': 'ST1-RevOps/1.0' },
  });
  const loginHtml = await loginPageRes.text();
  const rawCookies = parseCookies(loginPageRes.headers.getSetCookie?.() || loginPageRes.headers.get('set-cookie'));
  const csrfMatch = loginHtml.match(/name="authenticity_token"[^>]*value="([^"]+)"/) ||
                    loginHtml.match(/content="([^"]+)"[^>]*name="csrf-token"/);
  const csrf = csrfMatch?.[1] || '';

  const signInRes = await fetch(`${BASE}/users/sign_in`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/json',
      'User-Agent': 'ST1-RevOps/1.0',
      'Cookie': rawCookies,
      'X-CSRF-Token': csrf,
    },
    body: new URLSearchParams({
      'user[email]': email, 'user[password]': password, 'authenticity_token': csrf,
    }).toString(),
  });

  const status = signInRes.status;
  if (status !== 302 && status !== 200 && status !== 303) {
    throw new Error(`Login failed — HTTP ${status}`);
  }
  const sessionCookies = parseCookies(signInRes.headers.getSetCookie?.() || signInRes.headers.get('set-cookie'));
  if (!sessionCookies) {
    throw new Error(`Login returned ${status} but no session cookie or token found`);
  }
  const auth = { type: 'cookie', value: sessionCookies };
  _sessionCookies = JSON.stringify(auth);
  _sessionExpiry  = Date.now() + 30 * 60 * 1000;
  return auth;
}

async function adminGet(path) {
  const auth = await getAuth();
  const authHeader = auth.type === 'bearer'
    ? { 'Authorization': `Bearer ${auth.value}` }
    : { 'Cookie': auth.value };
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'ST1-RevOps/1.0', ...authHeader },
  });
  if (res.status === 401 || res.status === 403) {
    _sessionCookies = null; // clear cache so next call re-authenticates
    throw new Error(`Admin returned ${res.status} — session may have expired`);
  }
  if (!res.ok) throw new Error(`Admin returned HTTP ${res.status} for ${path}`);

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();

  // Some Rails apps redirect to HTML on unauthenticated — detect that
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    throw new Error(`Admin returned HTML instead of JSON for ${path} — may not be authenticated`);
  }
  return JSON.parse(text);
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
      const data = await adminGet('/team_stores.json');
      // Normalise — handle both array and { team_stores: [...] }
      const stores = Array.isArray(data) ? data : (data.team_stores || data.stores || data);
      return res.json({ ok: true, stores });
    }

    if (action === 'orders') {
      const data = await adminGet('/store_orders.json');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);
      return res.json({ ok: true, orders });
    }

    if (action === 'top-sellers') {
      const data = await adminGet('/store_orders.json');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);

      // Aggregate line items across all orders — try common Rails field patterns
      const productMap = {};
      for (const order of orders) {
        // Try every common field name for order line items
        const lineItems =
          order.line_items || order.items || order.order_items ||
          order.products || order.order_lines || [];

        const storeName =
          order.store_name || order.team_store_name || order.store?.name ||
          order.team_store?.name || order.school_name || 'Unknown Store';

        for (const item of lineItems) {
          const name =
            item.name || item.product_name || item.title ||
            item.description || item.sku || null;
          if (!name) continue;

          const qty = Number(item.quantity || item.qty || 1);
          const price = Number(item.price || item.unit_price || item.amount || 0);
          const revenue = qty * price;

          if (!productMap[name]) {
            productMap[name] = { name, revenue: 0, orders: 0, quantity: 0, stores: new Set() };
          }
          productMap[name].revenue += revenue;
          productMap[name].orders++;
          productMap[name].quantity += qty;
          productMap[name].stores.add(storeName);
        }
      }

      const sellers = Object.values(productMap)
        .map(p => ({ ...p, stores: p.stores.size }))
        .sort((a, b) => b.quantity - a.quantity);

      return res.json({ ok: true, sellers, rawOrderCount: orders.length });
    }

    // raw: return a sample order so we can inspect the data shape
    if (action === 'raw-sample') {
      const data = await adminGet('/store_orders.json');
      const orders = Array.isArray(data) ? data : (data.store_orders || data.orders || data);
      return res.json({ ok: true, sample: orders.slice(0, 2), totalOrders: orders.length });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[admin-stores]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
