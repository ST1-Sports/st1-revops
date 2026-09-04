/**
 * Tie a chat-approved quote to the existing CRM school/contact instead of
 * creating a second "Hudson" account next to "Hudson High School".
 *
 * Matching is the same includes-rule CRM already uses for invoiced customers
 * (orgNamesMatch): "Hudson" lands on Hudson High School, but two schools that
 * only share a state stay separate.
 */

export function normalizeOrgName(raw) {
  return (raw || '').trim().replace(/\s+/g, ' ').replace(/[.,]+$/g, '').toLowerCase();
}

export function orgNamesMatch(a, b) {
  const na = normalizeOrgName(a);
  const nb = normalizeOrgName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na));
}

export function schoolKeyOf(c) {
  const sch = (typeof c?.school === 'string' ? c.school : c?.school?.name || '') || '(No School)';
  const st = (c?.state || '').trim();
  return st ? `${sch} — ${st}` : sch;
}

/** Zoho Contacts sync used to omit zohoId, so profile save never pushed and the next pull wiped Hudson edits. */
export function zohoIdFromContact(c) {
  if (!c) return null;
  if (c.zohoId) return String(c.zohoId);
  const m = String(c.id || '').match(/^zoho_[cl]_(.+)$/);
  return m ? m[1] : null;
}

const PROFILE_KEEP = [
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'title',
  'school', 'city', 'state', 'sport', 'schoolClass', 'numAthletes', 'numSports',
  'priority', 'orgType', 'website',
];

const PROFILE_SAVE_MS = 15 * 60 * 1000;

/** Overlay a Zoho/server contact without clobbering a profile Matt just saved. */
export function mergeZohoContactRow(local, incoming, now = Date.now()) {
  if (!local) return incoming;
  if (!incoming) return local;
  const zohoId = zohoIdFromContact(incoming) || zohoIdFromContact(local);
  const merged = {
    ...local,
    ...incoming,
    zohoId: zohoId || local.zohoId || incoming.zohoId || null,
  };
  const savedAt = Number(local.profileSavedAt) || 0;
  if (savedAt && (now - savedAt) < PROFILE_SAVE_MS) {
    for (const k of PROFILE_KEEP) {
      if (local[k] !== undefined) merged[k] = local[k];
    }
    merged.profileSavedAt = savedAt;
  }
  return merged;
}

/** Server list wins for membership (Zoho deletes); recent local profile edits stay. */
export function mergeContactsPreferRecentSaves(localList, serverList, now = Date.now()) {
  if (!Array.isArray(serverList)) return localList || [];
  const localById = new Map((localList || []).map(c => [c.id, c]));
  return serverList.map(sc => {
    const lc = localById.get(sc.id);
    return lc ? mergeZohoContactRow(lc, sc, now) : sc;
  });
}

/** Analytics / lists → CRM person deal tab, or the school page when there is no contact. */
export function crmNavForDeal(deal, contacts) {
  if (!deal) return null;
  const list = contacts || [];
  const named = String(deal.contact || '').trim().toLowerCase();
  const contact = (deal.contactId && list.find(c => c.id === deal.contactId))
    || (named && list.find(c => contactDisplayName(c).toLowerCase() === named))
    || null;
  const schoolName = typeof deal.school === 'string' ? deal.school : (deal.school?.name || '');
  const schoolKey = contact
    ? schoolKeyOf(contact)
    : (deal.state && schoolName ? `${schoolName} — ${deal.state}` : schoolName);
  const usableSchool = schoolKey && schoolKey !== '(No School)' ? schoolKey : '';
  if (contact) return { id: contact.id, school: usableSchool || undefined, tab: 'deal' };
  if (usableSchool) return { school: usableSchool, tab: 'deal' };
  return null;
}

export function cleanSchoolName(key) {
  return (key || '').replace(/ — [^—]*$/, '');
}

export function schoolKeyState(key) {
  const m = String(key || '').match(/ — ([^—]+)$/);
  return (m?.[1] || '').trim();
}

export function statesCompatible(a, b) {
  const sa = (a || '').trim().toLowerCase();
  const sb = (b || '').trim().toLowerCase();
  if (!sa || !sb) return true;
  return sa === sb;
}

/** Same key shape as schoolKeyOf, for a Prisma/Zoho account with no contact yet. */
export function schoolKeyFromAccount(a) {
  const name = (typeof a?.name === 'string' ? a.name : '').trim();
  if (!name) return '';
  const st = (a?.state || '').trim();
  return st ? `${name} — ${st}` : name;
}

/**
 * Accounts created in CRM (or pulled from Prisma) must show in the list even
 * when they have zero contacts. Stamp persisted/Zoho ids onto a matching
 * contact-derived row; otherwise add a standalone group.
 */
export function foldPersistedAccountsIntoGroups(groups, accounts, searchQuery = '') {
  const out = groups || {};
  const sq = String(searchQuery || '').toLowerCase().trim();
  for (const a of accounts || []) {
    const name = (a?.name || '').trim();
    if (!name) continue;
    if (sq) {
      const hay = `${name} ${a.city || ''} ${a.state || ''}`.toLowerCase();
      if (!hay.includes(sq)) continue;
    }
    const key = schoolKeyFromAccount(a);
    let matchedKey = null;
    for (const [k, g] of Object.entries(out)) {
      if (k === key) {
        matchedKey = k;
        break;
      }
      if (!statesCompatible(schoolKeyState(k), a.state)) continue;
      if (orgNamesMatch(g.name, name) || orgNamesMatch(cleanSchoolName(k), name)) {
        matchedKey = k;
        break;
      }
    }
    if (matchedKey) {
      const g = out[matchedKey];
      g.persistedId = a.id || g.persistedId;
      g.zohoAccountId = a.zohoAccountId || g.zohoAccountId;
      if (!g.city && a.city) g.city = a.city;
      if (!g.state && a.state) g.state = a.state;
      continue;
    }
    out[key] = {
      name,
      contacts: [],
      deals: [],
      value: 0,
      invoiced: false,
      persistedId: a.id || null,
      zohoAccountId: a.zohoAccountId || null,
      city: a.city || '',
      state: a.state || '',
    };
  }
  return out;
}

export function contactBelongsToSchoolKey(c, selSchool) {
  if (!c || c.deadStatus) return false;
  if (schoolKeyOf(c) === selSchool) return true;
  const selName = cleanSchoolName(selSchool);
  if (!statesCompatible(schoolKeyState(selSchool), c.state)) return false;
  return orgNamesMatch(c.school, selName) || orgNamesMatch(c.company, selName);
}

function contactDisplayName(c) {
  return (c?.fullName || `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || '').trim();
}

export function dealBelongsToContact(deal, contact) {
  if (!deal || !contact) return false;
  if (deal.contactId && deal.contactId === contact.id) return true;
  const nm = contactDisplayName(contact).toLowerCase();
  if (nm && String(deal.contact || '').trim().toLowerCase() === nm) return true;
  if (deal.contactId || String(deal.contact || '').trim()) return false;
  if (!statesCompatible(deal.state, contact.state)) return false;
  const dealSchool = typeof deal.school === 'string' ? deal.school : deal.school?.name;
  return orgNamesMatch(dealSchool, contact.school) || orgNamesMatch(deal.company, contact.school);
}

export function dealBelongsToSchool(deal, schoolContacts, schoolCleanName) {
  if (!deal) return false;
  const contacts = schoolContacts || [];
  if (contacts.some(c => c.id && c.id === deal.contactId)) return true;
  if (contacts.some(c => {
    const n = contactDisplayName(c);
    return n && n.toLowerCase() === String(deal.contact || '').trim().toLowerCase();
  })) return true;
  const dealSchool = typeof deal.school === 'string' ? deal.school : deal.school?.name;
  if (dealSchool && orgNamesMatch(dealSchool, schoolCleanName)) return true;
  if (deal.company && orgNamesMatch(deal.company, schoolCleanName)) return true;
  return false;
}

export function resolveQuoteCrmTarget(contacts, { school, contact, email, city, state } = {}) {
  const list = (contacts || []).filter(c => !c.deadStatus);
  const schoolQ = (school || '').trim();
  const contactQ = (contact || '').trim();
  const emailQ = (email || '').trim().toLowerCase();

  const schoolMatches = list.filter(c =>
    orgNamesMatch(c.school, schoolQ) || orgNamesMatch(c.company, schoolQ)
  );

  let person = null;
  if (emailQ) {
    person = list.find(c => (c.email || '').toLowerCase() === emailQ) || null;
  }
  if (!person && contactQ) {
    const cn = contactQ.toLowerCase();
    const nameOf = c => contactDisplayName(c).toLowerCase();
    person = schoolMatches.find(c => nameOf(c) === cn) || list.find(c => nameOf(c) === cn) || null;
  }

  const schoolContact = person || schoolMatches[0] || null;
  const resolvedSchool = (schoolContact?.school || schoolQ).trim();
  const resolvedState = (schoolContact?.state || state || '').trim();
  const resolvedCity = (schoolContact?.city || city || '').trim();
  const contactName = person ? contactDisplayName(person) : contactQ;

  return {
    school: resolvedSchool,
    city: resolvedCity,
    state: resolvedState,
    contactId: person?.id || '',
    contactName,
    email: (person?.email || email || '').trim(),
    isNewContact: !person && !!(contactQ || emailQ),
    schoolKey: resolvedState ? `${resolvedSchool} — ${resolvedState}` : resolvedSchool,
  };
}

export function lineItemsToQuoteItems(lineItems) {
  return (lineItems || []).map(li => ({
    name: li.name || '',
    qty: Number(li.quantity) || 1,
    rate: Number(li.rate) || 0,
    cost: Number(li.cost) || 0,
    description: li.description || '',
  }));
}

export function findExistingQuoteDeal(deals, quoteNumber) {
  const qn = String(quoteNumber || '').trim();
  if (!qn) return null;
  return (deals || []).find(d => d.quoteNumber && String(d.quoteNumber) === qn) || null;
}

export function buildLocalQuoteDeal({ id, quoteNumber, resolved, lineItems, notes, zohoId, createdAt }) {
  const items = lineItemsToQuoteItems(lineItems);
  const total = items.reduce((sum, i) => sum + (Number(i.rate) || 0) * (Number(i.qty) || 1), 0);
  const itemNotes = items.map(i => `• ${i.name} × ${i.qty} @ $${Number(i.rate || 0).toFixed(2)}`).join('\n');
  return {
    id,
    name: `${resolved.school} — ${quoteNumber}`,
    school: resolved.school,
    state: resolved.state || '',
    city: resolved.city || '',
    contact: resolved.contactName || '',
    contactId: resolved.contactId || '',
    value: total,
    stage: 'Quoted',
    product: items[0]?.name || '',
    priority: 'warm',
    createdAt: createdAt || new Date().toISOString().slice(0, 10),
    followUpDate: '',
    notes: [`Quote ${quoteNumber}`, notes, itemNotes].filter(Boolean).join('\n'),
    quoteNumber,
    quoteAmount: total,
    quoteItems: items,
    quoteNotes: notes || '',
    zohoId: zohoId || null,
    source: 'scout-quote',
  };
}

export function quoteDealUpdate({ quoteNumber, resolved, lineItems, notes, zohoId }) {
  const items = lineItemsToQuoteItems(lineItems);
  const total = items.reduce((sum, i) => sum + (Number(i.rate) || 0) * (Number(i.qty) || 1), 0);
  return {
    stage: 'Quoted',
    value: total,
    contact: resolved.contactName || '',
    contactId: resolved.contactId || '',
    school: resolved.school,
    state: resolved.state || '',
    quoteNumber,
    quoteAmount: total,
    quoteItems: items,
    quoteNotes: notes || '',
    ...(zohoId ? { zohoId } : {}),
  };
}

function dedupeDeals(list) {
  const seen = new Set();
  const out = [];
  for (const d of list || []) {
    if (d?.id) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
    }
    out.push(d);
  }
  return out;
}

/** Fold "Hudson" into "Hudson High School — IA" when state is compatible. */
export function mergeAccountGroups(groups) {
  const entries = Object.entries(groups || {});
  const absorbed = new Set();
  const out = {};

  for (let i = 0; i < entries.length; i++) {
    const [key, g] = entries[i];
    if (absorbed.has(key)) continue;
    let keepKey = key;
    let keep = {
      ...g,
      contacts: [...(g.contacts || [])],
      deals: [...(g.deals || [])],
    };

    for (let j = i + 1; j < entries.length; j++) {
      const [k2, g2] = entries[j];
      if (absorbed.has(k2)) continue;
      if (!statesCompatible(schoolKeyState(keepKey), schoolKeyState(k2))) continue;
      if (!orgNamesMatch(keep.name, g2.name) && !orgNamesMatch(cleanSchoolName(keepKey), cleanSchoolName(k2))) continue;

      const preferIncoming =
        (g2.name || '').length > (keep.name || '').length
        || ((g2.name || '').length === (keep.name || '').length
          && (g2.contacts?.length || 0) > (keep.contacts?.length || 0));

      const winner = preferIncoming ? g2 : keep;
      const loser = preferIncoming ? keep : g2;
      const winnerKey = preferIncoming ? k2 : keepKey;
      const loserKey = preferIncoming ? keepKey : k2;

      keep = {
        ...winner,
        name: winner.name,
        contacts: [...(winner.contacts || []), ...(loser.contacts || [])],
        deals: dedupeDeals([...(winner.deals || []), ...(loser.deals || [])]),
        invoiced: !!(winner.invoiced || loser.invoiced),
        persistedId: winner.persistedId || loser.persistedId,
        zohoAccountId: winner.zohoAccountId || loser.zohoAccountId,
        city: winner.city || loser.city || '',
        state: winner.state || loser.state || '',
        value: 0,
      };
      keep.value = keep.deals
        .filter(d => !['Closed Won', 'Closed Lost'].includes(d.stage))
        .reduce((a, d) => a + (d.value || 0), 0);
      absorbed.add(loserKey);
      keepKey = winnerKey;
    }

    keep.deals = dedupeDeals(keep.deals);
    keep.value = keep.deals
      .filter(d => !['Closed Won', 'Closed Lost'].includes(d.stage))
      .reduce((a, d) => a + (d.value || 0), 0);
    out[keepKey] = keep;
  }
  return out;
}

export function attachOpenDealsToAccountGroups(groups, deals) {
  for (const d of deals || []) {
    if (['Closed Won', 'Closed Lost'].includes(d.stage)) continue;
    for (const g of Object.values(groups || {})) {
      if (!dealBelongsToSchool(d, g.contacts, g.name)) continue;
      if (g.deals.some(x => x.id && x.id === d.id)) continue;
      g.deals.push(d);
      g.value += d.value || 0;
    }
  }
  return groups;
}
