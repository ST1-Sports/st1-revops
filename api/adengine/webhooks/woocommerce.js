import { prisma } from '../../_lib/prisma.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.headers['x-wc-webhook-topic'];
  const p = req.body;

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
