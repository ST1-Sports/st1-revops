/**
 * Deleted-in-Zoho contacts must stay gone across /api/state merge and Zoho
 * sync — the exact problem dealTombstone.js already solved for deals (see
 * that file's header). Contacts had no equivalent: membership was decided by
 * "does the server's contacts array currently contain this id", which is
 * only as good as whatever the last device to POST /api/state happened to
 * have in memory. A device that hasn't pulled recently, or a syncContacts
 * run that treated one Zoho pull's absence as a confirmed delete (pagination
 * gaps, rate limiting, or a Lead→Contact conversion changing the record's id
 * for a cycle or two all produce false positives), could silently erase a
 * real contact everywhere the next time it posted. Same fix as deals: union
 * both sides instead of trusting either one alone, and only actually drop a
 * contact once it's explicitly tombstoned.
 */
import { mergeIdLists } from './dealTombstone.js';
import { zohoIdFromContact } from './quoteCrmLink.js';

export { mergeIdLists };

export function contactIsSuppressed(contact, { suppressedContactIds = [], suppressedContactZohoIds = [] } = {}) {
  if (!contact) return true;
  const ids = new Set((suppressedContactIds || []).map(String));
  const zoho = new Set((suppressedContactZohoIds || []).map(String));
  if (contact.id != null && ids.has(String(contact.id))) return true;
  const z = zohoIdFromContact(contact);
  return !!(z && zoho.has(String(z)));
}

export function filterLiveContacts(contacts, suppress) {
  return (Array.isArray(contacts) ? contacts : []).filter(c => !contactIsSuppressed(c, suppress));
}

/** Build tombstone entries for contacts being removed right now. */
export function suppressFromRemovedContacts(gone, payloadIds = []) {
  const ids = mergeIdLists(payloadIds, (gone || []).map(c => c?.id));
  const zoho = mergeIdLists((gone || []).map(zohoIdFromContact));
  return { suppressedContactIds: ids, suppressedContactZohoIds: zoho };
}

function contactKey(contact) {
  const id = contact?.id;
  if (id != null && id !== '') return `id:${id}`;
  const z = zohoIdFromContact(contact);
  return z ? `zoho:${z}` : null;
}

/**
 * Keeps a contact present on EITHER side instead of only whichever side is
 * posting — same reasoning as unionDeals in dealTombstone.js. Where the same
 * contact exists on both sides, the incoming (posting) copy wins here; a
 * caller that wants to protect a just-saved profile field from being
 * clobbered layers mergeZohoContactRow/mergeContactsPreferRecentSaves on top
 * of this (quoteCrmLink.js) — this function only decides membership.
 */
export function unionContacts(previousContacts, incomingContacts) {
  const byKey = new Map();
  for (const c of (Array.isArray(previousContacts) ? previousContacts : [])) {
    const k = contactKey(c);
    if (k) byKey.set(k, c);
  }
  for (const c of (Array.isArray(incomingContacts) ? incomingContacts : [])) {
    const k = contactKey(c);
    if (k) byKey.set(k, c);
  }
  return [...byKey.values()];
}

/**
 * Union tombstones (they only grow), union contacts (a device posting its
 * own stale snapshot must not erase a contact only some OTHER device knows
 * about), then drop suppressed rows from the result.
 */
export function applyContactTombstones(incoming = {}, previous = {}) {
  const suppressedContactIds = mergeIdLists(previous.suppressedContactIds, incoming.suppressedContactIds);
  const suppressedContactZohoIds = mergeIdLists(previous.suppressedContactZohoIds, incoming.suppressedContactZohoIds);
  const suppress = { suppressedContactIds, suppressedContactZohoIds };
  return {
    suppressedContactIds,
    suppressedContactZohoIds,
    contacts: filterLiveContacts(unionContacts(previous.contacts, incoming.contacts), suppress),
  };
}
