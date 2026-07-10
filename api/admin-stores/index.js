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

  const tokenStatus = tokenRes.status;
  const tokenCt = tokenRes.headers.get('content-type') || '';
  const tokenCookies = parseCookies(tokenRes.headers.getSetCookie?.() || tokenRes.headers.get('set-cookie'));

  // If cookies came back on the JSON attempt, use them
  if (tokenCookies) {
    const auth = { type: 'cookie', value: tokenCookies };
    _sessionCookies = JSON.stringify(auth);
    _sessionExpiry  = Date.now() + 30 * 60 * 1000;
    return auth;
  }

  if (tokenStatus === 200 || tokenStatus === 201) {
    if (tokenCt.includes('application/json')) {
      const body = await tokenRes.json();
      const token = body.token || body.access_token || body.auth_token ||
                    body.jwt || body.data?.token || body.user?.token;
      if (token) {
        const auth = { type: 'bearer', value: token };
        _sessionCookies = JSON.stringify(auth);
        _sessionExpiry  = Date.now() + 30 * 60 * 1000;
        return auth;
      }
      throw new Error(`Login 200/JSON but no token. Body keys: [${Object.keys(body).join(', ')}]`);
    }
    // Non-JSON 200 — read a snippet of the body to diagnose
    const snippet = (await tokenRes.text()).slice(0, 300).replace(/\n/g, ' ');
    throw new Error(`Login 200 but content-type="${tokenCt}". Body snippet: ${snippet}`);
  }

  throw new Error(`Login attempt returned HTTP ${tokenStatus} (content-type: ${tokenCt})`);
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
