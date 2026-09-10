/**
 * WooCommerce product webhook — /api/adengine/webhooks/woocommerce
 *
 * Configure in WooCommerce (Settings → Advanced → Webhooks) for topics
 * "Product created"/"Product updated", pointing at this URL. Verifies the
 * request using HMAC-SHA256 over the raw body, per WooCommerce's webhook
 * signing (the secret set on the webhook is used to sign every delivery
 * into the X-WC-Webhook-Signature header).
 *
 * Required env var: WOOCOMMERCE_WEBHOOK_SECRET — the same secret entered
 * when the webhook was created in WooCommerce. Without this set, all
 * requests are rejected (fails closed, not open — see verifyHmac below),
 * matching the sibling Shopify webhook's convention.
 */
import crypto from 'crypto';
import { prisma } from '../../_lib/prisma.js';

// Disable Vercel's automatic body parser — HMAC verification needs the raw,
// unparsed body bytes (a re-serialized JSON.stringify would not reproduce
// the exact bytes WooCommerce signed).
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyHmac(rawBody, signatureHeader) {
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  // Fails closed, not open: an unsigned/unverifiable request must never be
  // able to write into the Product table just because setup isn't finished
  // yet. Nobody has a live WooCommerce webhook pointed at this URL until
  // WOOCOMMERCE_WEBHOOK_SECRET is set anyway, so there's no legitimate
  // traffic this could block.
  if (!secret) {
    console.warn('[woocommerce webhook] WOOCOMMERCE_WEBHOOK_SECRET not set — rejecting all requests');
    return false;
  }
  if (!signatureHeader) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-wc-webhook-signature'];

  if (!verifyHmac(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.headers['x-wc-webhook-topic'];

  let p;
  try {
    p = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!p?.id || !event?.startsWith('product.')) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const data = {
    name: p.name,
    slug: p.slug,
    permalink: p.permalink,
    price: p.price,
    regular_price: p.regular_price,
    sale_price: p.sale_price || null,
    on_sale: !!p.on_sale,
    stock_status: p.stock_status || 'instock',
    short_description: p.short_description?.replace(/<[^>]*>/g, '') || null,
    main_image_url: p.images?.[0]?.src || null,
    images: p.images || [],
    categories: p.categories || [],
    tags: p.tags || [],
    attributes: p.attributes || [],
    date_modified: p.date_modified ? new Date(p.date_modified) : null,
  };

  try {
    await prisma.product.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  } catch (e) {
    console.error('WC webhook upsert failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true });
}
