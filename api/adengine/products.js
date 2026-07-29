import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { shopifyRequest, shopifyConfigured, shopifyMissingEnvVars } from '../_lib/shopify.js';
import { mapShopifyProduct } from '../_lib/shopify-map.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LIST ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { search, page = '1', pageSize = '60' } = req.query;
    const where = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (parseInt(page) - 1) * parseInt(pageSize),
        take: parseInt(pageSize),
        select: { id: true, name: true, slug: true, price: true, sale_price: true, on_sale: true,
          stock_status: true, main_image_url: true, categories: true, brand: true },
      }),
      prisma.product.count({ where }),
    ]);
    return res.json({ products, total });
  }

  // ── SYNC FROM SHOPIFY ────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!shopifyConfigured()) {
      return res.status(400).json({
        error: `Shopify credentials not configured. Missing: ${shopifyMissingEnvVars().join(', ')}`,
      });
    }

    let synced = 0, errors = 0;
    // Shopify REST pagination is cursor-based (page_info in the Link response
    // header), not page-number based like WooCommerce — follow rel="next"
    // until it's absent.
    let endpoint = '/products.json?limit=250&status=active';
    // Shopify's Admin REST API enforces a leaky-bucket rate limit (~2 req/sec
    // sustained) — without backoff, any catalog beyond the initial burst
    // allowance hits 429 mid-sync and the sync silently stops partway
    // through with a misleadingly-normal {ok:true} response.
    const REQUEST_DELAY_MS = 550;
    const MAX_RATE_LIMIT_RETRIES = 5;

    while (endpoint) {
      let r, attempt = 0;
      while (true) {
        try {
          r = await shopifyRequest(endpoint);
        } catch (e) {
          return res.json({ ok: false, synced, errors, shopifyError: e.message });
        }
        if (r.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
          const retryAfterSec = parseFloat(r.headers?.get?.('retry-after')) || 2;
          await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
          attempt++;
          continue;
        }
        break;
      }
      if (!r.ok) {
        return res.json({ ok: false, synced, errors, shopifyError: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0,200)}` });
      }

      const products = Array.isArray(r.data?.products) ? r.data.products : [];
      if (!products.length) break;

      for (const p of products) {
        const data = mapShopifyProduct(p);
        const id = String(p.id);
        try {
          await prisma.product.upsert({
            where: { id },
            create: { id, ...data },
            update: data,
          });
          synced++;
        } catch (e) {
          console.error(`Product ${id} upsert failed:`, e.message);
          errors++;
        }
      }

      // Parse Link header for the next cursor: <...&page_info=xxx>; rel="next"
      const link = r.headers?.get?.('link') || '';
      const nextMatch = link.split(',').map(s => s.trim()).find(s => s.endsWith('rel="next"'));
      if (nextMatch) {
        const urlMatch = nextMatch.match(/<([^>]+)>/);
        if (urlMatch) {
          const nextUrl = new URL(urlMatch[1]);
          endpoint = `/products.json?${nextUrl.searchParams.toString()}`;
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
          continue;
        }
      }
      endpoint = null;
    }

    return res.json({ ok: true, synced, errors });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
