import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

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

  // ── SYNC FROM WOOCOMMERCE ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const wcUrl   = process.env.WC_URL;
    const wcKey   = process.env.WC_KEY;
    const wcSecret= process.env.WC_SECRET;

    if (!wcUrl || !wcKey || !wcSecret) {
      return res.status(400).json({
        error: 'WooCommerce credentials not configured. Set WC_URL, WC_KEY, WC_SECRET env vars.',
      });
    }

    const auth = `Basic ${Buffer.from(`${wcKey}:${wcSecret}`).toString('base64')}`;
    let page = 1, synced = 0, errors = 0;

    while (true) {
      const r = await fetch(
        `${wcUrl}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish`,
        { headers: { Authorization: auth } }
      );
      if (!r.ok) break;
      const products = await r.json();
      if (!Array.isArray(products) || products.length === 0) break;

      for (const p of products) {
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
          synced++;
        } catch (e) {
          console.error(`Product ${p.id} upsert failed:`, e.message);
          errors++;
        }
      }
      page++;
    }

    return res.json({ ok: true, synced, errors });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
