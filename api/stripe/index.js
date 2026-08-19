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

// How long the paging loop may run before it stops and returns what it has.
// Comfortably inside this function's maxDuration (see vercel.json) so there's
// always time left to aggregate and answer. Overrunning maxDuration meant
// Vercel replied 504 with an HTML body, which the dashboard could only report
// as a JSON parse error with no numbers on screen at all.
const SCAN_BUDGET_MS = 40_000;

/**
 * Paginate through succeeded store charges in a time window.
 *
 * Bounded three ways — matched count, pages scanned, and wall clock — because
 * "All time" has no upper bound on how many charges Stripe will hand back, and
 * that grows every day the stores are open.
 *
 * @returns {{charges: Array, scanned: number, truncated: boolean, truncatedReason: 'limit'|'time'|null}}
 */
async function fetchCharges(fromTs, toTs, maxCharges = 5000, deadline = Date.now() + SCAN_BUDGET_MS) {
  const all = [];
  let scanned = 0;
  let startingAfter = null;
  let truncatedReason = null;
  const params = { limit: 100, 'expand[]': 'data.payment_intent' };
  if (fromTs) params['created[gte]'] = fromTs;
  if (toTs)   params['created[lte]'] = toTs;

  while (all.length < maxCharges) {
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet('/charges', params);
    scanned += page.data.length;
    // Only keep charges with the store order format: "#ST1-XXXXX / Store Name"
    const succeeded = page.data.filter(c =>
      c.status === 'succeeded' && !c.invoice && c.description && c.description.includes(' / ')
    );
    all.push(...succeeded);
    if (!page.has_more || page.data.length === 0) break;
    // One more page averages ~1s round trip with payment_intent expanded.
    if (Date.now() > deadline - 2000) { truncatedReason = 'time'; break; }
    startingAfter = page.data[page.data.length - 1].id;
  }
  if (!truncatedReason && all.length >= maxCharges) truncatedReason = 'limit';

  return { charges: all, scanned, truncated: Boolean(truncatedReason), truncatedReason };
}

// Parse description format "#ST1-26-00347 / ADM Tigers Cross Country"
// Returns { orderNumber, storeName } — either may be null if not matched.
function parseDescription(desc) {
  if (!desc) return { orderNumber: null, storeName: null };
  const slash = desc.indexOf(' / ');
  if (slash !== -1) {
    return {
      orderNumber: desc.slice(0, slash).trim(),
      storeName:   desc.slice(slash + 3).trim() || null,
    };
  }
  return { orderNumber: null, storeName: null };
}

// Extract store name: metadata first, then description parsing
function storeNameOf(charge) {
  const m = charge.metadata || {};
  const pm = charge.payment_intent?.metadata || {};
  const fromMeta = m.store_name || m.school_name || m.store_id ||
    pm.store_name || pm.school_name || pm.store_id ||
    charge.statement_descriptor_suffix;
  if (fromMeta) return fromMeta;
  return parseDescription(charge.description).storeName;
}

// Extract order number from description (e.g. "#ST1-26-00347")
function orderNumberOf(charge) {
  return parseDescription(charge.description).orderNumber;
}

// Extract a product/item description from a charge (metadata only — description holds order ref)
function productOf(charge) {
  const m = charge.metadata || {};
  const pm = charge.payment_intent?.metadata || {};
  return (
    m.product_name || m.item_name || m.product ||
    pm.product_name || pm.item_name || pm.product ||
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
      const { charges, scanned, truncated, truncatedReason } = await fetchCharges(fromTs, toTs);

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
          totalChargesScanned: scanned,
          truncated,
          truncatedReason,
          days: Number(days) || 'all-time',
        },
      });
    }

    if (action === 'top-sellers') {
      const { charges, truncated, truncatedReason } = await fetchCharges(fromTs, toTs);
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

      return res.json({ ok: true, sellers, truncated, truncatedReason });
    }

    if (action === 'recent') {
      // Only needs `limit` matches, but store charges are sparse among all
      // charges, so this still pages — keep it on a short leash of its own.
      const { charges } = await fetchCharges(fromTs, toTs, Number(limit), Date.now() + 12_000);
      const recent = charges.slice(0, Number(limit)).map(charge => ({
        id:          charge.id,
        date:        new Date(charge.created * 1000).toISOString().slice(0, 10),
        store:       storeNameOf(charge) || 'Unattributed',
        orderNumber: orderNumberOf(charge),
        amount:      (charge.amount - (charge.amount_refunded || 0)) / 100,
        currency:    charge.currency,
        customer:    charge.billing_details?.name || charge.billing_details?.email || null,
        receiptUrl:  charge.receipt_url || null,
      }));
      return res.json({ ok: true, recent });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[stripe] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
