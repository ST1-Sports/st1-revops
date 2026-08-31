/**
 * Hold cost and sell price on an open quote when chat asks for an update.
 * Dealer lists often have the same SKU on more than one supplier row; Claude
 * re-picks on every call_edgar / get_st1_pricing unless we lock the last quote.
 */

export function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSku(s) {
  return String(s || '').trim().toUpperCase();
}

export function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na));
}

export function userWantsReprice(text) {
  const t = String(text || '').toLowerCase();
  return /\b(re-?price|new cost|update cost|refresh (?:the )?(?:price|list|cost)|latest (?:price|cost|list)|new list|dealer list (?:changed|updated)|cost went|list went|recalculate (?:the )?(?:price|cost)|pull (?:a )?(?:new|fresh|latest) (?:price|cost|list)|from the (?:latest|new) (?:list|dealer list))\b/.test(t);
}

export function userWantsNewSellPrice(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(charge|sell(?:ing)?\s+(?:at|for)|quote\s+(?:at|for)|price(?:\s+it|\s+them)?\s+at|change\s+(?:the\s+)?(?:sell\s+|quote\s+|list\s+)?price\s+to|make\s+(?:the\s+)?(?:price|quote)\s+)\s*\$?\s*\d/.test(t)) {
    return true;
  }
  return /\b(\d+\s*%\s*off|discount|lower the (?:price|quote)|raise the (?:price|quote)|drop the (?:price|quote)|match (?:map|their price))\b/.test(t);
}

export function compactLockItem(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim();
  const sku = String(item.sku || '').trim();
  const cost = numOrNull(item.cost);
  const quoted = numOrNull(item.quotedPrice ?? item.ourPrice ?? item.list ?? item.rate);
  const ourPrice = numOrNull(item.ourPrice ?? item.list ?? item.quotedPrice ?? item.rate);
  if (!name && !sku) return null;
  if (cost == null && quoted == null) return null;
  return {
    name,
    sku,
    qty: Number(item.qty) > 0 ? Number(item.qty) : 1,
    cost,
    ourPrice,
    quotedPrice: quoted,
    map: numOrNull(item.map ?? item.mapPrice),
    brand: item.brand || null,
    supplier: item.supplier || null,
  };
}

export function normalizeLockedQuote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(compactLockItem)
    .filter(Boolean);
  if (!items.length) return null;
  return {
    quoteNumber: raw.quoteNumber || null,
    customer: raw.customer || null,
    source: raw.source || 'chat',
    items,
  };
}

export function matchLockedItem(item, lockedItems) {
  if (!item || !Array.isArray(lockedItems) || !lockedItems.length) return null;
  const sku = normalizeSku(item.sku);
  if (sku) {
    const bySku = lockedItems.find(l => l.sku && normalizeSku(l.sku) === sku);
    if (bySku) return bySku;
  }
  const name = item.name || item.productName || item.query;
  if (name) {
    const byName = lockedItems.find(l => namesMatch(l.name, name));
    if (byName) return byName;
  }
  return null;
}

export function applyLockedPrices(items, lockedItems, { lockSell = true } = {}) {
  if (!Array.isArray(items) || !items.length || !lockedItems?.length) return items || [];
  return items.map(item => {
    const lock = matchLockedItem(item, lockedItems);
    if (!lock) return item;
    const cost = lock.cost != null ? Number(lock.cost) : item.cost;
    const sell = lockSell
      ? (lock.quotedPrice != null ? Number(lock.quotedPrice) : (lock.ourPrice != null ? Number(lock.ourPrice) : item.quotedPrice))
      : (item.quotedPrice ?? item.ourPrice ?? lock.quotedPrice);
    const quoted = numOrNull(sell);
    const ourPrice = lockSell
      ? (lock.ourPrice != null ? Number(lock.ourPrice) : quoted)
      : (numOrNull(item.ourPrice) ?? quoted);
    const gm = cost > 0 && quoted > 0 ? Math.round(((quoted - cost) / quoted) * 1000) / 10 : item.gmPct;
    return {
      ...item,
      sku: item.sku || lock.sku,
      name: item.name || lock.name,
      cost,
      ourPrice,
      quotedPrice: quoted,
      map: lock.map != null ? Number(lock.map) : item.map,
      supplier: item.supplier || lock.supplier,
      brand: item.brand || lock.brand,
      gmPct: gm,
    };
  });
}

export function mergeLockedItemsIntoRequest(requested, lockedItems) {
  if (!lockedItems?.length) return requested;
  if (!Array.isArray(requested) || !requested.length) {
    return lockedItems.map(i => ({ name: i.name, sku: i.sku, qty: i.qty || 1 }));
  }
  return requested.map(r => {
    const lock = matchLockedItem(r, lockedItems);
    if (!lock) return r;
    return {
      ...r,
      sku: r.sku || lock.sku,
      name: r.name || lock.name,
      qty: r.qty || lock.qty || 1,
    };
  });
}

export function extractLockedQuoteFromHistory(history) {
  if (!Array.isArray(history)) return null;
  let priceFallback = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const actions = history[i]?.actions || [];
    for (let j = actions.length - 1; j >= 0; j--) {
      const a = actions[j];
      const kind = a?.type || a?.kind;
      if (kind === 'edgar_quote') {
        const items = a.quote?.lineItems || a.items || [];
        const locked = normalizeLockedQuote({
          quoteNumber: a.quote?.quoteNumber || a.quoteNumber,
          customer: a.quote?.customer || a.customer,
          source: 'chat',
          items,
        });
        if (locked) return locked;
      }
      if (!priceFallback && kind === 'st1_price' && a.item) {
        priceFallback = normalizeLockedQuote({
          customer: null,
          source: 'chat-price',
          items: [{
            name: a.item.name,
            sku: a.item.sku,
            cost: a.item.cost,
            quotedPrice: a.item.list,
            ourPrice: a.item.list,
            map: a.item.map,
            brand: a.item.brand,
            supplier: a.item.supplier,
            qty: 1,
          }],
        });
      }
    }
  }
  return priceFallback;
}

export function extractLockedQuoteFromDeals(deals, hintText = '') {
  const withItems = (Array.isArray(deals) ? deals : []).filter(d => Array.isArray(d.quoteItems) && d.quoteItems.length);
  if (!withItems.length) return null;
  const hint = String(hintText || '').toLowerCase();
  const scored = withItems.map(d => {
    const school = String(typeof d.school === 'string' ? d.school : d.school?.name || d.company || '').toLowerCase();
    let score = d.stage === 'Quoted' ? 2 : 0;
    if (hint && school && (hint.includes(school) || school.split(/\s+/).some(w => w.length > 4 && hint.includes(w)))) score += 3;
    return { d, score };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.d.createdAt || '').localeCompare(String(a.d.createdAt || ''));
  });
  const d = scored[0].d;
  return normalizeLockedQuote({
    quoteNumber: d.quoteNumber,
    customer: typeof d.school === 'string' ? d.school : d.school?.name || d.company || null,
    source: 'crm-deal',
    items: d.quoteItems.map(i => ({
      name: i.name,
      sku: i.sku,
      qty: i.qty,
      cost: i.cost,
      quotedPrice: i.rate ?? i.quotedPrice,
      ourPrice: i.ourPrice ?? i.rate,
      map: i.map,
    })),
  });
}

export function buildLockedQuotePayload({ history, deals } = {}) {
  const lastUser = [...(history || [])].reverse().find(m => m.role === 'user')?.content || '';
  return extractLockedQuoteFromHistory(history) || extractLockedQuoteFromDeals(deals, lastUser);
}

export function resolveLockedQuote(localContext = {}, hintText = '') {
  if (localContext.lockedQuote?.items?.length) {
    return normalizeLockedQuote(localContext.lockedQuote);
  }
  return extractLockedQuoteFromDeals(localContext.deals, hintText);
}

export function formatLockedQuoteBlock(locked) {
  if (!locked?.items?.length) return '';
  const head = [locked.quoteNumber, locked.customer].filter(Boolean).join(' · ');
  const lines = locked.items.map(i => {
    const bits = [
      i.name || 'item',
      i.sku ? `[${i.sku}]` : null,
      `qty ${i.qty || 1}`,
      i.cost != null ? `cost $${Number(i.cost).toFixed(2)}` : null,
      i.quotedPrice != null ? `quote $${Number(i.quotedPrice).toFixed(2)}` : null,
    ].filter(Boolean);
    return `- ${bits.join(' · ')}`;
  });
  return `${head ? `${head}\n` : ''}${lines.join('\n')}`;
}

export function lockedPricingToolResult(input, lock) {
  const cost = numOrNull(lock.cost);
  const sell = numOrNull(lock.quotedPrice ?? lock.ourPrice ?? lock.list);
  const map = numOrNull(lock.map);
  return {
    tool: 'get_st1_pricing',
    ok: true,
    status: 'ok',
    query: input,
    result: {
      name: lock.name,
      sku: lock.sku || input?.sku || null,
      productId: null,
      brand: lock.brand || null,
      supplier: lock.supplier || null,
      currency: 'USD',
      cost: cost == null ? null : { amount: cost, source: 'Open quote (held)' },
      customerPrice: sell == null ? null : { amount: sell, source: 'Open quote (held)' },
      regularPrice: sell,
      salePrice: sell,
      onSale: null,
      mapPrice: map,
      marginPct: cost != null && sell ? Number((((sell - cost) / sell) * 100).toFixed(2)) : null,
      stockStatus: null,
      updatedAt: null,
      locked: true,
      matches: [],
    },
    sources: [{ system: 'Open quote', note: 'Cost and sell price held from the last quote' }],
    limitations: ['Held from the open quote. Ask to reprice or pull the latest dealer list to refresh.'],
  };
}

export function overlayLockedPricing(output, lockedItems) {
  if (!output?.result || !lockedItems?.length) return output;
  const lock = matchLockedItem({ sku: output.result.sku, name: output.result.name }, lockedItems);
  if (!lock) return output;
  const cost = numOrNull(lock.cost);
  const sell = numOrNull(lock.quotedPrice ?? lock.ourPrice ?? lock.list);
  return {
    ...output,
    result: {
      ...output.result,
      sku: output.result.sku || lock.sku,
      name: output.result.name || lock.name,
      cost: cost == null ? output.result.cost : { amount: cost, source: 'Open quote (held)' },
      customerPrice: sell == null ? output.result.customerPrice : { amount: sell, source: 'Open quote (held)' },
      salePrice: sell ?? output.result.salePrice,
      mapPrice: numOrNull(lock.map) ?? output.result.mapPrice,
      marginPct: cost != null && sell ? Number((((sell - cost) / sell) * 100).toFixed(2)) : output.result.marginPct,
      locked: true,
    },
    limitations: [
      ...(output.limitations || []),
      'Held from the open quote. Ask to reprice or pull the latest dealer list to refresh.',
    ],
  };
}

export function pricingQueryOf(input) {
  return String(input?.sku || input?.productName || input?.query || '').trim();
}
