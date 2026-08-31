/** Compact Scout price-card payload from a get_st1_pricing tool result. */
export function st1PriceActionFromPricing(output) {
  const p = output?.result;
  if (!p || output?.status === 'not_found') return null;
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
  };
}
