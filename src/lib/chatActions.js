/** Keep one real price/quote card; drop empty model echoes and SKU dupes. */

export function priceActionKey(action) {
  if (!action || typeof action !== 'object') return '';
  if (action.type === 'st1_price') {
    const item = action.item || {};
    return String(item.sku || item.name || '').trim().toLowerCase();
  }
  if (action.type === 'edgar_quote') {
    const q = action.quote || {};
    const items = q.lineItems || [];
    return items.map(li => String(li.sku || li.name || '').trim().toLowerCase()).filter(Boolean).join('|');
  }
  return '';
}

export function isUsablePriceAction(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'st1_price') {
    const item = action.item || {};
    return Boolean(item.name || item.sku || item.cost != null || item.list != null);
  }
  if (action.type === 'edgar_quote') {
    const items = action.quote?.lineItems;
    return Array.isArray(items) && items.length > 0;
  }
  return true;
}

export function dedupeChatActions(actions) {
  const seen = new Set();
  return (Array.isArray(actions) ? actions : []).filter(action => {
    if (!action || typeof action !== 'object') return false;
    if (action.type === 'st1_price' || action.type === 'edgar_quote') {
      if (!isUsablePriceAction(action)) return false;
      const key = `${action.type}:${priceActionKey(action)}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
}
