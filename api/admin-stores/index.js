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

async function getSessionCookies() {
  if (_sessionCookies && Date.now() < _sessionExpiry) return _sessionCookies;

  const { email, password } = creds();
  if (!email || !password) throw new Error('Admin credentials not configured (ADMIN_ST1_EMAIL / ADMIN_ST1_PASSWORD)');

  // Step 1: GET login page to obtain CSRF token + initial session cookie
  const loginPageRes = await fetch(`${BASE}/users/sign_in`, {
    headers: { 'Accept': 'text/html', 'User-Agent': 'ST1-RevOps/1.0' },
  });

  const loginHtml = await loginPageRes.text();
  const rawCookies = parseCookies(loginPageRes.headers.getSetCookie?.() || loginPageRes.headers.get('set-cookie'));

  // Extract Rails authenticity_token from the login form
  const csrfMatch = loginHtml.match(/name="authenticity_token"[^>]*value="([^"]+)"/) ||
                    loginHtml.match(/content="([^"]+)"[^>]*name="csrf-token"/);
  const csrf = csrfMatch?.[1] || '';

  // Step 2: POST credentials
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
      'user[email]':    email,
      'user[password]': password,
      'authenticity_token': csrf,
    }).toString(),
  });

  // After successful Devise login, server redirects (302) and sets a new session cookie
  const status = signInRes.status;
  if (status !== 302 && status !== 200 && status !== 303) {
    throw new Error(`Login failed — server returned HTTP ${status}. Check credentials.`);
  }

  const sessionCookies = parseCookies(signInRes.headers.getSetCookie?.() || signInRes.headers.get('set-cookie'));
  if (!sessionCookies) {
    throw new Error(`Login appeared to succeed (${status}) but no session cookie returned.`);
  }

  _sessionCookies = sessionCookies;
  _sessionExpiry  = Date.now() + 30 * 60 * 1000; // cache 30 min
  return _sessionCookies;
}

async function adminGet(path) {
  const cookies = await getSessionCookies();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'ST1-RevOps/1.0',
      'Cookie': cookies,
    },
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
