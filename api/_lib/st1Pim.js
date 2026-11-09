/**
 * ST1 PIM (home-built catalog on api.st1sports.com).
 *
 * Scout (get_st1_pricing / get_st1_product) and Edgar quote from this catalog —
 * products, dealer cost, sell/MAP/MSRP, inventory, and supplier. Uploaded
 * dealer price lists are no longer the source of truth.
 *
 * Auth is the same service account as team-store sync (st1AdminAuth.js).
 * Search query params are tried in order because the admin app's product
 * search contract is not fully documented; the first 2xx list that looks
 * relevant to the query wins, then we rank locally.
 */

import { createSession } from './st1AdminAuth.js';
import {
  minAcceptableScore,
  rankPriceItems,
  tokenizePriceQuery,
} from './priceSearch.js';

export const PIM_SOURCE = 'ST1 PIM';

export function isPimConfigured() {
  return Boolean(process.env.ST1_ADMIN_SERVICE_EMAIL && process.env.ST1_ADMIN_SERVICE_PASSWORD);
}

export function numOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (value.amount != null) return numOrNull(value.amount);
    if (value.qty != null) return numOrNull(value.qty);
    if (value.quantity != null) return numOrNull(value.quantity);
    if (value.onHand != null) return numOrNull(value.onHand);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(obj, keys) {
  for (const key of keys) {
    const v = obj?.[key];
    if (v == null || v === '') continue;
    return v;
  }
  return null;
}

export function unwrapProductList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ['products', 'data', 'items', 'results', 'rows', 'catalog']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.product && typeof payload.product === 'object') return [payload.product];
  if (payload.id != null && (payload.name || payload.sku || payload.title)) return [payload];
  return [];
}

function nestedProduct(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.product && typeof row.product === 'object') return { ...row.product, ...row, product: undefined };
  return row;
}

export function mapPimProduct(raw) {
  const row = nestedProduct(raw);
  if (!row || typeof row !== 'object') return null;
  const supplierObj = row.supplier && typeof row.supplier === 'object' ? row.supplier : null;
  const name = String(pick(row, ['name', 'title', 'productName', 'description']) || '').trim();
  const sku = pick(row, ['sku', 'SKU', 'itemCode', 'vendorSku', 'code']);
  if (!name && !sku) return null;

  const cost = numOrNull(pick(row, ['baseCost', 'cost', 'dealerCost', 'purchaseCost', 'unitCost', 'lastCost']));
  const ourPrice = numOrNull(pick(row, ['sellPrice', 'ourPrice', 'price', 'unitPrice', 'listPrice', 'sellingPrice']));
  const map = numOrNull(pick(row, ['map', 'mapPrice', 'minimumAdvertisedPrice']));
  const msrp = numOrNull(pick(row, ['msrp', 'retailPrice', 'suggestedRetail']));
  const inventory = numOrNull(pick(row, [
    'quantityOnHand', 'qtyOnHand', 'inventory', 'stock', 'available', 'availableQty',
    'onHand', 'quantity', 'qty',
  ])) ?? numOrNull(row.inventory) ?? numOrNull(row.stock);
  const inStockFlag = row.inStock ?? row.in_stock ?? row.isInStock;
  let stockStatus = null;
  if (typeof inStockFlag === 'boolean') stockStatus = inStockFlag ? 'instock' : 'outofstock';
  else if (inventory != null) stockStatus = inventory > 0 ? 'instock' : 'outofstock';
  else if (row.stockStatus || row.stock_status) stockStatus = String(row.stockStatus || row.stock_status);

  const supplierName = supplierObj?.name
    || pick(row, ['supplierName', 'vendorName', 'vendor'])
    || 'ST1 PIM';

  return {
    id: String(row.id ?? sku ?? name),
    sku: sku ? String(sku) : null,
    name: name || String(sku),
    brand: pick(row, ['brand', 'manufacturer', 'mfg']) || null,
    category: pick(row, ['category', 'sport', 'productType']) || null,
    unit: pick(row, ['unit', 'uom']) || 'each',
    cost,
    lastCost: cost,
    map,
    msrp,
    ourPrice,
    gmFloorPct: numOrNull(pick(row, ['gmFloorPct', 'gmFloor', 'marginFloor'])),
    inventory,
    stockStatus,
    imageUrl: pick(row, ['imageUrl', 'image', 'thumbnail', 'mainImage']) || null,
    description: pick(row, ['shortDescription', 'longDescription', 'notes']) || null,
    supplier: {
      id: supplierObj?.id != null ? String(supplierObj.id) : (row.supplierId != null ? String(row.supplierId) : null),
      name: String(supplierName),
    },
    updatedAt: pick(row, ['updatedAt', 'updated_at', 'modifiedAt']) || null,
  };
}

export function mapPimToCatalogProduct(item) {
  if (!item) return null;
  const price = item.ourPrice ?? item.msrp ?? item.map ?? null;
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    slug: null,
    permalink: null,
    brand: item.brand,
    price,
    regularPrice: item.msrp ?? price,
    salePrice: item.ourPrice,
    onSale: false,
    stockStatus: item.stockStatus,
    inventory: item.inventory,
    shortDescription: item.description || null,
    imageUrl: item.imageUrl,
    categories: item.category ? [item.category] : [],
    tags: [],
    attributes: [],
    modifiedAt: item.updatedAt,
    supplier: item.supplier?.name || null,
    cost: item.cost,
    map: item.map,
    source: {
      system: PIM_SOURCE,
      recordId: String(item.id),
    },
  };
}

export function mapPimSupplier(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || raw.title || '').trim();
  if (!name) return null;
  return {
    id: String(raw.id ?? name),
    name,
    category: raw.category || raw.sport || null,
    rep: raw.rep || raw.repName || null,
    itemCount: numOrNull(raw.itemCount ?? raw.productCount ?? raw._count?.products) || 0,
    notes: raw.notes ? String(raw.notes).slice(0, 240) : null,
  };
}

function looksRelevant(mapped, query, sku) {
  if (!mapped.length) return false;
  const q = String(query || sku || '').trim();
  if (!q) return true;
  const tokens = tokenizePriceQuery([q, sku].filter(Boolean).join(' '));
  const ranked = rankPriceItems(mapped, q, { sku });
  if (!ranked.length) return mapped.length <= 8;
  const floor = minAcceptableScore(tokens);
  if (ranked.some(r => r.score >= floor)) return true;
  // Small payloads are likely already filtered by the API.
  return mapped.length <= 8;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function searchPaths({ q, sku, productId, limit }) {
  const per = encodeURIComponent(String(limit));
  const paths = [];
  if (productId) {
    paths.push(`/admin/products/${encodeURIComponent(productId)}`);
  }
  if (sku) {
    const s = encodeURIComponent(sku);
    paths.push(`/admin/products?sku=${s}&perPage=${per}`);
    paths.push(`/admin/search?q=${s}`);
  }
  if (q) {
    const enc = encodeURIComponent(q);
    paths.push(`/admin/products/search?q=${enc}&perPage=${per}`);
    paths.push(`/admin/search?q=${enc}`);
    paths.push(`/admin/products?q=${enc}&perPage=${per}`);
    paths.push(`/admin/products?search=${enc}&perPage=${per}`);
    paths.push(`/admin/products?query=${enc}&perPage=${per}`);
  }
  return paths;
}

async function fetchMapped(session, path) {
  const res = await session.request(path);
  if (res.status === 404) return { status: 404, mapped: [] };
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(`ST1 PIM ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  const payload = await readJson(res);
  const mapped = unwrapProductList(payload).map(mapPimProduct).filter(Boolean);
  return { status: res.status, mapped };
}

/**
 * Search the PIM and return price-item-shaped rows (cost / ourPrice / MAP /
 * inventory / supplier) ready for rankPriceItems.
 */
export async function searchPimProducts({ query, sku, productId, limit = 25, session } = {}) {
  if (!isPimConfigured() && !session) {
    const err = new Error('ST1 PIM is not configured (ST1_ADMIN_SERVICE_EMAIL / ST1_ADMIN_SERVICE_PASSWORD).');
    err.code = 'pim_not_configured';
    throw err;
  }
  const q = String(query || sku || '').trim();
  if (q.length < 2 && !sku && !productId) return [];

  const sess = session || await createSession();
  const take = Math.max(10, Math.min(80, Number(limit) || 25));
  const paths = searchPaths({ q, sku, productId, limit: take });

  let lastError = null;
  for (const path of paths) {
    try {
      const { mapped } = await fetchMapped(sess, path);
      if (looksRelevant(mapped, q, sku)) return mapped;
    } catch (err) {
      lastError = err;
    }
  }

  if (q) {
    try {
      const res = await sess.request('/admin/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, query: q, sku, limit: take }),
      });
      if (res.ok) {
        const mapped = unwrapProductList(await readJson(res)).map(mapPimProduct).filter(Boolean);
        if (looksRelevant(mapped, q, sku)) return mapped;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError && lastError.code !== 'pim_not_configured') {
    console.warn('[pim] search failed:', lastError.message);
  }
  return [];
}

export async function listPimSuppliers({ query = '', limit = 40, session } = {}) {
  if (!isPimConfigured() && !session) {
    const err = new Error('ST1 PIM is not configured (ST1_ADMIN_SERVICE_EMAIL / ST1_ADMIN_SERVICE_PASSWORD).');
    err.code = 'pim_not_configured';
    throw err;
  }
  const sess = session || await createSession();
  const paths = ['/admin/supplier?perPage=100', '/admin/suppliers?perPage=100', '/admin/supplier'];
  for (const path of paths) {
    try {
      const res = await sess.request(path);
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const rows = unwrapProductList(await readJson(res)).map(mapPimSupplier).filter(Boolean);
      if (!rows.length) continue;
      const q = String(query || '').trim().toLowerCase();
      const filtered = q ? rows.filter(s => s.name.toLowerCase().includes(q) || String(s.category || '').toLowerCase().includes(q)) : rows;
      return filtered.slice(0, Math.max(1, Math.min(100, Number(limit) || 40)));
    } catch {
      /* try next path */
    }
  }
  return [];
}
