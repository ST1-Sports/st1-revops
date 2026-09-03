/**
 * Deleted deals must stay gone across /api/state merge, Zoho sync, and
 * Integrations pull. Contacts already take the server copy outright for this
 * reason; deals still union-merge, so we keep id + Zoho-id tombstones and
 * filter every rehydrate path.
 */

export function zohoIdFromDeal(deal) {
  if (!deal) return null;
  if (deal.zohoId) return String(deal.zohoId);
  const m = String(deal.id || '').match(/^zoho_d_(.+)$/);
  return m ? m[1] : null;
}

export function mergeIdLists(...lists) {
  const out = new Set();
  for (const list of lists) {
    for (const id of list || []) {
      if (id != null && id !== '') out.add(String(id));
    }
  }
  return [...out];
}

export function dealIsSuppressed(deal, { suppressedDealIds = [], suppressedDealZohoIds = [] } = {}) {
  if (!deal) return true;
  const ids = new Set((suppressedDealIds || []).map(String));
  const zoho = new Set((suppressedDealZohoIds || []).map(String));
  if (deal.id != null && ids.has(String(deal.id))) return true;
  const z = zohoIdFromDeal(deal);
  return !!(z && zoho.has(String(z)));
}

export function filterLiveDeals(deals, suppress) {
  return (Array.isArray(deals) ? deals : []).filter(d => !dealIsSuppressed(d, suppress));
}

export function suppressFromRemovedDeals(gone, payloadIds = []) {
  const ids = mergeIdLists(payloadIds, (gone || []).map(d => d?.id));
  const zoho = mergeIdLists((gone || []).map(zohoIdFromDeal));
  return { suppressedDealIds: ids, suppressedDealZohoIds: zoho };
}

const REAL_SOURCES = new Set(['zoho-crm', 'quote', 'scout-quote']);

/** A deal that exists in Zoho, or that we just created and are still pushing. */
export function dealIsReal(deal, suppress) {
  if (dealIsSuppressed(deal, suppress)) return false;
  if (zohoIdFromDeal(deal)) return true;
  if (deal.zoho_synced === false) return true;
  return REAL_SOURCES.has(deal.source);
}

/** Local leftover with no Zoho id and no in-flight create — not pipeline truth. */
export function dealIsOrphanLocal(deal) {
  if (!deal) return false;
  if (zohoIdFromDeal(deal)) return false;
  if (deal.zoho_synced === false) return false;
  if (REAL_SOURCES.has(deal.source)) return false;
  return true;
}

export function filterRealDeals(deals, suppress) {
  return (Array.isArray(deals) ? deals : []).filter(d => dealIsReal(d, suppress));
}

/** Union tombstones (they only grow) and drop suppressed rows from a state blob. */
export function applyDealTombstones(incoming = {}, previous = {}) {
  const suppressedDealIds = mergeIdLists(previous.suppressedDealIds, incoming.suppressedDealIds);
  const suppressedDealZohoIds = mergeIdLists(previous.suppressedDealZohoIds, incoming.suppressedDealZohoIds);
  const suppress = { suppressedDealIds, suppressedDealZohoIds };
  return {
    suppressedDealIds,
    suppressedDealZohoIds,
    deals: filterLiveDeals(incoming.deals, suppress),
  };
}
