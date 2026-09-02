import { vendorRatesFor } from './priceSearch.js';

function vendorRatesFromPricing(p) {
  if (Array.isArray(p.vendorRates) && p.vendorRates.length) return p.vendorRates;
  const winner = {
    name: p.name,
    sku: p.sku,
    brand: p.brand,
    cost: p.cost?.amount ?? p.cost ?? null,
    supplier: p.supplier,
  };
  return vendorRatesFor([winner, ...(p.matches || [])], winner);
}

/** Compact Scout price-card payload from a get_st1_pricing tool result. */
export function st1PriceActionFromPricing(output) {
  const p = output?.result;
  if (!p || output?.status === 'not_found') return null;
  if (!p.name && !p.sku && p.cost?.amount == null && p.customerPrice?.amount == null) return null;
  const cost = p.cost?.amount ?? null;
  const list = p.customerPrice?.amount ?? p.salePrice ?? p.regularPrice ?? null;
  return {
    type: 'st1_price',
    item: {
      name: p.name,
      sku: p.sku || null,
      brand: p.brand || null,
      supplier: p.supplier || null,
      cost,
      list,
      map: p.mapPrice ?? null,
      marginPct: p.marginPct ?? null,
      source: p.customerPrice?.source || p.cost?.source || 'ST1 price list',
    },
    matches: Array.isArray(p.matches) ? p.matches : [],
    vendorRates: vendorRatesFromPricing(p),
  };
}

/** Tool cards win. Drop empty model echoes and the same SKU twice. */
export function mergeScoutActions(toolActions, proposedActions, parsedActions) {
  const parsed = (parsedActions || []).filter(a => a?.type !== 'st1_price' && a?.type !== 'edgar_quote');
  const seen = new Set();
  return [...(toolActions || []), ...(proposedActions || []), ...parsed].filter(a => {
    if (!a || typeof a !== 'object') return false;
    if (a.type === 'st1_price') {
      const item = a.item || {};
      if (!item.name && !item.sku && item.cost == null && item.list == null) return false;
      const key = `st1:${String(item.sku || item.name || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
}
