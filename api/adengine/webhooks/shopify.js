/**
 * Shopify product webhook — /api/adengine/webhooks/shopify
 *
 * Configure in Shopify admin (Settings → Notifications → Webhooks, or via
 * the Admin API) for topics "Product creation" and "Product update",
 * pointing at this URL. Verifies the request using HMAC-SHA256 over the
 * raw body, per Shopify's webhook verification docs.
 *
 * Required env var: SHOPIFY_WEBHOOK_SECRET (the webhook signing secret,
 * shown when the webhook subscription is created).
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
  if (!secret) {
    console.warn('[shopify webhook] SHOPIFY_WEBHOOK_SECRET not set — skipping verification');
    return true;
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

  const topic = req.headers['x-shopify-topic'] || '';
  if (!topic.startsWith('products/')) {
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
