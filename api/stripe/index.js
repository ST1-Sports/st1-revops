/**
 * /api/stripe — Team Store sales reporting via Stripe REST API.
 *
 * Actions (POST body: { action, ...params }):
 *   status      — verify STRIPE_SECRET_KEY is configured
 *   stores      — revenue + order metrics grouped by store (metadata.store_name/school_name/store_id)
 *   top-sellers — products ranked by revenue (from metadata.product_name or charge description)
 *   recent      — most recent N charges across all stores
 *
 * Optional params:
 *   days (number) — lookback window, default 30. Pass 0 for all-time.
 */

import { setCors } from '../_lib/cors.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';

function sk() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

async function stripeGet(path, params = {}) {
  const url = new URL(`${STRIPE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${sk()}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Stripe ${res.status}`);
  return body;
}

// Paginate through all succeeded charges in a time window (up to 1000 to avoid timeout)
async function fetchCharges(fromTs, toTs, maxCharges = 1000) {
  const all = [];
  let startingAfter = null;
  const params = { limit: 100, 'expand[]': 'data.payment_intent' };
  if (fromTs) params['created[gte]'] = fromTs;
  if (toTs)   params['created[lte]'] = toTs;

  while (all.length < maxCharges) {
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet('/charges', params);
    const succeeded = page.data.filter(c => c.status === 'succeeded');
    all.push(...succeeded);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

// Extract a human-readable store name from charge metadata (tries several common keys)
function storeNameOf(charge) {
  const m = charge.metadata || {};
  const pm = charge.payment_intent?.metadata || {};
  return (
    m.store_name || m.school_name || m.store_id ||
    pm.store_name || pm.school_name || pm.store_id ||
    charge.statement_descriptor_suffix ||
    null
  );
}

// Extract a product/item description from a charge
function productOf(charge) {
  const m = charge.metadata || {};
  const pm = charge.payment_intent?.metadata || {};
  return (
    m.product_name || m.item_name || m.product ||
    pm.product_name || pm.item_name || pm.product ||
    charge.description ||
    null
  );
}

function tsRange(days) {
  if (!days || days === 0) return { fromTs: null, toTs: null };
  const now = Math.floor(Date.now() / 1000);
  return { fromTs: now - days * 86400, toTs: now };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action = 'status', days = 30, limit = 20 } = req.body || {};

  if (action === 'status') {
    const configured = Boolean(process.env.STRIPE_SECRET_KEY);
    if (!configured) return res.json({ ok: true, configured: false });
    try {
      // Light check — fetch 1 charge to verify key works
      await stripeGet('/charges', { limit: 1 });
      return res.json({ ok: true, configured: true });
    } catch (e) {
      return res.json({ ok: true, configured: false, error: e.message });
    }
  }

  try {
    const { fromTs, toTs } = tsRange(Number(days));

    if (action === 'stores') {
      const charges = await fetchCharges(fromTs, toTs);

      // Aggregate by store
      const storeMap = {};
      for (const charge of charges) {
        const name = storeNameOf(charge) || 'Unattributed';
        if (!storeMap[name]) {
          storeMap[name] = { storeName: name, revenue: 0, orders: 0, lastSale: null, products: {} };
        }
        const entry = storeMap[name];
        const amountDollars = (charge.amount - (charge.amount_refunded || 0)) / 100;
        entry.revenue += amountDollars;
        entry.orders++;
        const saleDate = new Date(charge.created * 1000).toISOString().slice(0, 10);
        if (!entry.lastSale || saleDate > entry.lastSale) entry.lastSale = saleDate;

        const product = productOf(charge);
        if (product) {
          entry.products[product] = (entry.products[product] || 0) + amountDollars;
        }
      }

      const stores = Object.values(storeMap)
        .map(s => ({
          ...s,
          avgOrder: s.orders > 0 ? s.revenue / s.orders : 0,
          topProduct: Object.entries(s.products).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      const totalRevenue = stores.reduce((sum, s) => sum + s.revenue, 0);
      const totalOrders  = stores.reduce((sum, s) => sum + s.orders, 0);
      const activeStores = stores.filter(s => s.storeName !== 'Unattributed').length;

      return res.json({
        ok: true,
        stores,
        summary: {
          totalRevenue,
          totalOrders,
          activeStores,
          totalChargesScanned: charges.length,
          days: Number(days) || 'all-time',
        },
      });
    }

    if (action === 'top-sellers') {
      const charges = await fetchCharges(fromTs, toTs);
      const productMap = {};
      for (const charge of charges) {
        const product = productOf(charge);
        if (!product) continue;
        const store = storeNameOf(charge) || 'Unattributed';
        const key = product;
        if (!productMap[key]) productMap[key] = { name: product, revenue: 0, orders: 0, stores: new Set() };
        productMap[key].revenue += (charge.amount - (charge.amount_refunded || 0)) / 100;
        productMap[key].orders++;
        productMap[key].stores.add(store);
      }

      const sellers = Object.values(productMap)
        .map(p => ({ ...p, stores: p.stores.size }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, Number(limit));

      return res.json({ ok: true, sellers });
    }

    if (action === 'recent') {
      const charges = await fetchCharges(fromTs, toTs, Number(limit));
      const recent = charges.slice(0, Number(limit)).map(charge => ({
        id:        charge.id,
        date:      new Date(charge.created * 1000).toISOString().slice(0, 10),
        store:     storeNameOf(charge) || 'Unattributed',
        product:   productOf(charge),
        amount:    (charge.amount - (charge.amount_refunded || 0)) / 100,
        currency:  charge.currency,
        customer:  charge.billing_details?.name || charge.billing_details?.email || null,
        receiptUrl: charge.receipt_url || null,
      }));
      return res.json({ ok: true, recent });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[stripe] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
