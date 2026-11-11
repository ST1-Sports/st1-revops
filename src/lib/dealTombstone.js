/**
 * Deleted deals must stay gone across /api/state merge, Zoho sync, and
 * Integrations pull. Contacts already take the server copy outright for this
 * reason; deals still union-merge (see unionDeals) — a device that hasn't
 * pulled recently only has its own stale snapshot of `deals`, and /api/state
 * would otherwise treat that snapshot as the whole truth on every POST — so
 * we keep id + Zoho-id tombstones and filter every rehydrate path instead.
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

function dealKey(deal) {
  const id = deal?.id;
  if (id != null && id !== '') return `id:${id}`;
  const z = zohoIdFromDeal(deal);
  return z ? `zoho:${z}` : null;
}

/**
 * Keeps a deal present on EITHER side instead of only whichever side is
 * posting — a device that hasn't pulled recently still has every other
 * deal in its own local snapshot, and /api/state's POST otherwise replaces
 * the whole stored `deals` array with that snapshot, silently wiping out
 * anything created or synced from a different device since this one last
 * pulled. Where the same deal exists on both sides, the incoming (posting)
 * copy wins — same as today, since deals carry no reliable per-record
 * timestamp to arbitrate an edit conflict — this only changes what happens
 * to a deal that exists on just one side, which used to always mean "gone".
 */
export function unionDeals(previousDeals, incomingDeals) {
  const byKey = new Map();
  for (const d of (Array.isArray(previousDeals) ? previousDeals : [])) {
    const k = dealKey(d);
    if (k) byKey.set(k, d);
  }
  for (const d of (Array.isArray(incomingDeals) ? incomingDeals : [])) {
    const k = dealKey(d);
    if (k) byKey.set(k, d);
  }
  return [...byKey.values()];
}

const REAL_SOURCES = new Set(['zoho-crm', 'quote', 'scout-quote', 'manual', 'uploaded-quote']);

/** A deal that exists in Zoho, or that we just created and are still pushing. */
export function dealIsReal(deal, suppress) {
  if (dealIsSuppressed(deal, suppress)) return false;
  if (zohoIdFromDeal(deal)) return true;
  if (deal.zoho_synced === false) return true;
  return REAL_SOURCES.has(deal.source);
}

export function filterRealDeals(deals, suppress) {
  return (Array.isArray(deals) ? deals : []).filter(d => dealIsReal(d, suppress));
}

/**
 * Union tombstones (they only grow), union deals (a device posting its own
 * stale snapshot must not erase a deal only some OTHER device knows about),
 * then drop suppressed rows from the result.
 */
export function applyDealTombstones(incoming = {}, previous = {}) {
  const suppressedDealIds = mergeIdLists(previous.suppressedDealIds, incoming.suppressedDealIds);
  const suppressedDealZohoIds = mergeIdLists(previous.suppressedDealZohoIds, incoming.suppressedDealZohoIds);
  const suppress = { suppressedDealIds, suppressedDealZohoIds };
  return {
    suppressedDealIds,
    suppressedDealZohoIds,
    deals: filterLiveDeals(unionDeals(previous.deals, incoming.deals), suppress),
  };
}
