/**
 * ST1 PIM (home-built catalog on api.st1sports.com).
 *
 * Scout (get_st1_pricing / get_st1_product) and Edgar quote from this catalog
 * first — products, dealer cost, sell/MAP/MSRP, inventory, and supplier. When
 * the PIM is unconfigured, errors, times out, or has no match, callers in
 * ai-tools/sources.js fall back to the legacy PriceItem / Supplier tables, so
 * quoting never gets worse than it was before the PIM integration.
 *
 * Auth is the same service account as team-store sync (st1AdminAuth.js).
 *
 * ⚠️ UNVERIFIED ENDPOINTS — the admin app's product search contract is not
 * documented. The GET paths below are guesses tried in order; probing stops
 * at the first one that answers with a non-empty list of product-shaped rows.
 * Everything here is read-only: only GET requests are ever issued, every
 * request is bounded by PIM_TIMEOUT_MS, and the sign-in is shared briefly
 * across lookups instead of repeated per call.
 */

import { createSession } from './st1AdminAuth.js';
import {
  minAcceptableScore,
  rankPriceItems,
  tokenizePriceQuery,
} from './priceSearch.js';

export const PIM_SOURCE = 'ST1 PIM';
export const PIM_TIMEOUT_MS = 8000;
// Upper bound for one whole lookup across all guessed endpoints.
export const PIM_SEARCH_BUDGET_MS = 12_000;
// One sign-in is shared by every PIM lookup on a warm instance for this long.
// Kept short because admin tokens are short-lived; a 401 drops it early, and
// createSession() itself re-signs-in once on a 403.
const SESSION_TTL_MS = 60_000;

let cachedSession = null; // { promise, expiresAt }

export function resetPimSessionCache() {
  cachedSession = null;
}

function getPimSession() {
  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) return cachedSession.promise;
  const promise = createSession({ timeoutMs: PIM_TIMEOUT_MS });
  const entry = { promise, expiresAt: now + SESSION_TTL_MS };
  cachedSession = entry;
  promise.catch(() => {
    if (cachedSession === entry) cachedSession = null;
  });
  return promise;
}

function dropCachedSession(sess) {
  const entry = cachedSession;
  if (!entry) return;
  entry.promise.then(cached => {
    if (cached === sess && cachedSession === entry) cachedSession = null;
  }, () => {});
}

/**
 * Read-only, time-bounded GET — the only way this module talks to the PIM.
 * Each request gets at most PIM_TIMEOUT_MS, and never more than what is left
 * of the caller's overall deadline.
 */
function pimGet(sess, path, deadline) {
  const remaining = deadline ? deadline - Date.now() : PIM_TIMEOUT_MS;
  if (remaining <= 0) {
    const err = new Error('ST1 PIM lookup ran out of time');
    err.code = 'pim_timeout';
    throw err;
  }
  const ms = Math.min(PIM_TIMEOUT_MS, remaining);
  return sess.request(path, { method: 'GET', signal: AbortSignal.timeout(ms) });
}

/**
 * PIM ids are interpolated into /admin/products/{id}, so only plain id
 * characters are allowed — no slashes, dots-dot, query/fragment, percent
 * escapes, whitespace or control characters.
 */
export function isSafePimId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const id = String(value).trim();
  if (!id || id.length > 80) return false;
  if (id.includes('..')) return false;
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id);
}

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

function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['products', 'data', 'items', 'results', 'rows', 'catalog']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return null;
}

function nestedProduct(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (row.product && typeof row.product === 'object') return { ...row.product, ...row, product: undefined };
  return row;
}

const NAME_KEYS = ['name', 'title', 'productName'];
const SKU_KEYS = ['sku', 'SKU', 'itemCode', 'vendorSku'];
// A record needs at least one of these to count as a product. A bare
// { id, name } (supplier, user, team store, order…) is not enough.
const PRODUCT_SIGNAL_KEYS = [
  ...SKU_KEYS,
  'baseCost', 'cost', 'dealerCost', 'purchaseCost', 'unitCost', 'lastCost',
  'sellPrice', 'ourPrice', 'price', 'unitPrice', 'listPrice', 'sellingPrice',
  'map', 'mapPrice', 'minimumAdvertisedPrice', 'msrp', 'retailPrice', 'suggestedRetail',
  'quantityOnHand', 'qtyOnHand', 'inventory', 'stock', 'availableQty', 'variants',
];

export function isProductLike(raw) {
  const row = nestedProduct(raw);
  if (!row) return false;
  const named = pick(row, NAME_KEYS) != null || pick(row, SKU_KEYS) != null;
  if (!named) return false;
  return PRODUCT_SIGNAL_KEYS.some(key => row[key] != null && row[key] !== '');
}

export function unwrapProductList(payload) {
  const list = listFrom(payload);
  if (list) return list;
  if (payload?.product && typeof payload.product === 'object') return [payload.product];
  if (isProductLike(payload)) return [payload];
  return [];
}

export function mapPimProduct(raw) {
  if (!isProductLike(raw)) return null;
  const row = nestedProduct(raw);
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
    dataSource: 'pim',
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

/**
 * Catalog-card shape for get_st1_product / search_st1_knowledge / brand and
 * vendor lookups. Those tools only need product:read (or brand/vendor:read),
 * so dealer cost and MAP are deliberately left off — cost lives behind
 * pricing:read in get_st1_pricing.
 */
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
    dataSource: 'pim',
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
  if (productId != null && productId !== '') {
    if (isSafePimId(productId)) {
      paths.push({ path: `/admin/products/${encodeURIComponent(String(productId).trim())}`, exactId: true });
    } else {
      console.warn('[pim] ignoring unsafe productId');
    }
  }
  if (sku) {
    const s = encodeURIComponent(sku);
    paths.push({ path: `/admin/products?sku=${s}&perPage=${per}` });
    paths.push({ path: `/admin/search?q=${s}` });
  }
  if (q) {
    const enc = encodeURIComponent(q);
    paths.push({ path: `/admin/products/search?q=${enc}&perPage=${per}` });
    paths.push({ path: `/admin/search?q=${enc}` });
    paths.push({ path: `/admin/products?q=${enc}&perPage=${per}` });
    paths.push({ path: `/admin/products?search=${enc}&perPage=${per}` });
    paths.push({ path: `/admin/products?query=${enc}&perPage=${per}` });
  }
  return paths;
}

/**
 * One GET. Returns { valid, mapped } where valid means a 2xx answer that
 * unwrapped to at least one product-shaped row. 404s, other 4xx/5xx and
 * non-product payloads are "not valid, try the next guess". Timeouts,
 * network errors and auth failures throw so the caller stops probing and
 * falls back.
 */
async function fetchMapped(sess, path, { cached, deadline } = {}) {
  const res = await pimGet(sess, path, deadline);
  if (res.status === 401 || res.status === 403) {
    if (cached) dropCachedSession(sess);
    const err = new Error(`ST1 PIM ${path.split('?')[0]} rejected the service account (${res.status})`);
    err.code = 'pim_auth';
    throw err;
  }
  if (!res.ok) return { valid: false, mapped: [] };
  const payload = await readJson(res);
  const mapped = unwrapProductList(payload).map(mapPimProduct).filter(Boolean);
  return { valid: mapped.length > 0, mapped };
}

function notConfiguredError() {
  const err = new Error('ST1 PIM is not configured (ST1_ADMIN_SERVICE_EMAIL / ST1_ADMIN_SERVICE_PASSWORD).');
  err.code = 'pim_not_configured';
  return err;
}

/**
 * Search the PIM and return price-item-shaped rows (cost / ourPrice / MAP /
 * inventory / supplier) ready for rankPriceItems. Throws when the PIM is
 * unconfigured or unreachable; returns [] when it answered but had nothing
 * relevant. GET only.
 */
export async function searchPimProducts({ query, sku, productId, limit = 25, session } = {}) {
  if (!isPimConfigured() && !session) throw notConfiguredError();
  const q = String(query || sku || '').trim();
  if (q.length < 2 && !sku && !productId) return [];

  const take = Math.max(10, Math.min(80, Number(limit) || 25));
  const paths = searchPaths({ q, sku, productId, limit: take });
  if (!paths.length) return [];
  const sess = session || await getPimSession();
  const cached = !session;
  const deadline = Date.now() + PIM_SEARCH_BUDGET_MS;

  for (const { path, exactId } of paths) {
    const { valid, mapped } = await fetchMapped(sess, path, { cached, deadline });
    if (!valid) continue;
    // First endpoint with a real product list ends the probing. If it is an
    // unfiltered catalog page that ignored our query, report no match rather
    // than walking every other guessed endpoint.
    if (exactId) return mapped;
    return looksRelevant(mapped, q, sku) ? mapped : [];
  }
  return [];
}

export async function listPimSuppliers({ query = '', limit = 40, session } = {}) {
  if (!isPimConfigured() && !session) throw notConfiguredError();
  const sess = session || await getPimSession();
  const deadline = Date.now() + PIM_SEARCH_BUDGET_MS;
  const paths = ['/admin/supplier?perPage=100', '/admin/suppliers?perPage=100', '/admin/supplier'];
  for (const path of paths) {
    // Timeouts / network errors propagate: stop probing and let the caller fall back.
    const res = await pimGet(sess, path, deadline);
    if (res.status === 401 && !session) dropCachedSession(sess);
    if (!res.ok) continue;
    const rows = unwrapProductList(await readJson(res)).map(mapPimSupplier).filter(Boolean);
    if (!rows.length) continue;
    const q = String(query || '').trim().toLowerCase();
    const filtered = q ? rows.filter(s => s.name.toLowerCase().includes(q) || String(s.category || '').toLowerCase().includes(q)) : rows;
    return filtered.slice(0, Math.max(1, Math.min(100, Number(limit) || 40)));
  }
  return [];
}
