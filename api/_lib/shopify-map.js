/**
 * Maps a Shopify Admin API product object onto this app's generic `Product`
 * row shape (originally modeled after WooCommerce's product object — kept
 * as-is rather than reshaped, since nothing downstream needs Shopify-specific
 * fields beyond what's already here).
 */
import { shopifyPublicDomain } from './shopify.js';

export function mapShopifyProduct(p) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const primary  = variants[0] || {};

  const price        = primary.price != null ? String(primary.price) : null;
  const compareAt    = primary.compare_at_price != null ? String(primary.compare_at_price) : null;
  const onSale       = !!(compareAt && price && parseFloat(compareAt) > parseFloat(price));
  const totalInv     = variants.reduce((s, v) => s + (typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 0), 0);
  // Shopify tracks inventory per-variant, not as a single in/out-of-stock flag on the
  // product — if none of the variants report a quantity at all (inventory tracking off),
  // fall back to the product's own `status` rather than assuming out-of-stock.
  const anyTracked   = variants.some(v => typeof v.inventory_quantity === 'number');
  const stockStatus  = anyTracked ? (totalInv > 0 ? 'instock' : 'outofstock') : (p.status === 'active' ? 'instock' : 'outofstock');

  const domain = shopifyPublicDomain();

  return {
    name:              p.title,
    slug:              p.handle,
    permalink:         domain && p.handle ? `https://${domain}/products/${p.handle}` : null,
    price,
    regular_price:     compareAt || price,
    sale_price:        onSale ? price : null,
    on_sale:           onSale,
    stock_status:      stockStatus,
    short_description: (p.body_html || '').replace(/<[^>]*>/g, '').trim().slice(0, 500) || null,
    main_image_url:    p.image?.src || p.images?.[0]?.src || null,
    images:            p.images || [],
    categories:        p.product_type ? [{ name: p.product_type }] : [],
    tags:              typeof p.tags === 'string' ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    attributes:        Array.isArray(p.options) ? p.options.map(o => ({ name: o.name, options: o.values || [] })) : [],
    brand:             p.vendor || null,
    date_modified:     p.updated_at ? new Date(p.updated_at) : null,
  };
}
