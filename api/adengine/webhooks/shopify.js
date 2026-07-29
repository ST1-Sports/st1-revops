/**
 * Shopify product webhook — /api/adengine/webhooks/shopify
 *
 * Configure in Shopify admin (Settings → Notifications → Webhooks, or via
 * the Admin API) for topics "Product creation" and "Product update",
 * pointing at this URL. Verifies the request using HMAC-SHA256 over the
 * raw body, per Shopify's webhook verification docs.
 *
 * Required env var: SHOPIFY_WEBHOOK_SECRET — for a webhook created via the
 * Admin API this is returned in that response; for one created through
 * Settings → Notifications → Webhooks in the admin UI it's your app's
 * client secret instead. Without this set, all requests are rejected
 * (fails closed, not open — see verifyHmac below).
 */
import crypto from 'crypto';
import { prisma } from '../../_lib/prisma.js';
import { mapShopifyProduct } from '../../_lib/shopify-map.js';

// Disable Vercel's automatic body parser — HMAC verification needs the raw,
// unparsed body bytes (a re-serialized JSON.stringify would not reproduce
// the exact bytes Shopify signed).
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  // Fails closed, not open: an unsigned/unverifiable request must never be
  // able to write into the Product table just because setup isn't finished
  // yet. Nobody has a live Shopify webhook subscription pointed at this URL
  // until SHOPIFY_WEBHOOK_SECRET is set anyway, so there's no legitimate
  // traffic this could block.
  if (!secret) {
    console.warn('[shopify webhook] SHOPIFY_WEBHOOK_SECRET not set — rejecting all requests');
    return false;
  }
  if (!hmacHeader) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(hmacHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];

  if (!verifyHmac(rawBody, hmacHeader)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Explicit allow-list, not a "products/" prefix match: a products/delete
  // payload is just {"id": ...} with no title/variants/etc, and prefix-matching
  // would let it fall through to the upsert below and null out a real
  // product's data via the `update: data` branch. Only handled topics run;
  // anything else (including a future delete subscription) is safely skipped.
  const topic = req.headers['x-shopify-topic'] || '';
  if (topic !== 'products/create' && topic !== 'products/update') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  let p;
  try {
    p = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!p?.id) return res.status(200).json({ ok: true, skipped: true });

  const id = String(p.id);
  const data = mapShopifyProduct(p);

  try {
    await prisma.product.upsert({
      where:  { id },
      create: { id, ...data },
      update: data,
    });
  } catch (e) {
    console.error('Shopify webhook upsert failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true });
}
