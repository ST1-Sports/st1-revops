/**
 * Turn a Brad / segment match list into a Bulk Outreach draft.
 * Does not send. The user still sets copy, MAX PER DAY, 15s drip, and GO.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function schoolOrCompany(c) {
  if (!c) return '';
  if (typeof c.school === 'string' && c.school.trim()) return c.school.trim();
  if (c.school?.name) return String(c.school.name).trim();
  return String(c.companyName || '').trim();
}

export function contactToBulkLead(c) {
  const first = String(c.firstName || '').trim();
  const last = String(c.lastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ') || String(c.email || '').trim() || 'Unnamed';
  const email = String(c.email || '').trim();
  const org = schoolOrCompany(c) || name;
  return {
    id: c.id,
    orgName: org,
    sport: c.sport || '',
    city: c.city || '',
    state: c.state || '',
    contactName: name,
    firstName: first || name.split(' ')[0] || '',
    lastName: last || name.split(' ').slice(1).join(' ') || '',
    email,
    channel: EMAIL_RE.test(email) ? 'Email' : 'Unknown',
    touches: [],
    sendable: EMAIL_RE.test(email),
  };
}

export function defaultOutreachStartDt(now = new Date()) {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}T09:00`;
}

export function listNameForArea(area, now = new Date()) {
  const base = (area?.name || 'Segment').trim() || 'Segment';
  const when = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${base} – ${when}`;
}

async function postJson(fetchImpl, url, body) {
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `${url} ${r.status}`);
  return d;
}

/** All matching salesContact ids. Prefers idsOnly; pages at 100 if the API is older. */
export async function fetchAllAreaContactIds(area, filters = {}, fetchImpl = fetch) {
  const bodyBase = {
    sports: area?.sports || [],
    states: area?.states || [],
    roles: area?.roles || [],
    stateFilter: filters.stateFilter || '',
    sportFilter: filters.sportFilter || '',
  };
  const first = await postJson(fetchImpl, '/api/contacts/area-browse', { ...bodyBase, idsOnly: true });
  if (Array.isArray(first.ids) && first.ids.length) return [...new Set(first.ids.map(String))];

  const PAGE = 100;
  let page = 1;
  const ids = [];
  let total = Infinity;
  let pages = Infinity;
  while (page <= pages && ids.length < total && page <= 80) {
    const d = await postJson(fetchImpl, '/api/contacts/area-browse', { ...bodyBase, page, limit: PAGE });
    const batch = (d.contacts || []).map(c => c.id).filter(Boolean);
    if (!batch.length) break;
    ids.push(...batch);
    total = Number(d.total ?? ids.length);
    pages = Number(d.pages ?? Math.ceil(total / PAGE)) || page;
    page += 1;
  }
  return [...new Set(ids.map(String))];
}

export async function fetchContactsByIds(ids, fetchImpl = fetch) {
  const CHUNK = 500;
  const out = [];
  const list = [...new Set((ids || []).map(String))];
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const r = await fetchImpl(`/api/contacts?ids=${encodeURIComponent(slice.join(','))}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `contacts ${r.status}`);
    out.push(...(d.contacts || []));
  }
  return out;
}

export async function createOutreachBatchFromIds({
  name,
  contactIds,
  createdBy = '',
  batchSize = 25,
  touchGapDays = 5,
  fetchImpl = fetch,
  localContacts = [],
} = {}) {
  const ids = [...new Set((contactIds || []).map(String))];
  if (!ids.length) return { ok: false, error: 'No contacts on that list' };

  const localMap = Object.fromEntries((localContacts || []).map(c => [String(c.id), c]));
  const missing = ids.filter(id => !localMap[id]);
  const fetched = missing.length ? await fetchContactsByIds(missing, fetchImpl) : [];
  const fetchedMap = Object.fromEntries(fetched.map(c => [String(c.id), c]));
  const contacts = ids.map(id => localMap[id] || fetchedMap[id]).filter(Boolean);
  const leads = contacts.map(contactToBulkLead).filter(l => l.email);
  if (!leads.length) return { ok: false, error: 'No contacts with email addresses' };

  const d = await postJson(fetchImpl, '/api/outreach/batches', {
    name: (name || 'Prospecting list').slice(0, 200),
    fileName: `Prospecting: ${name || 'list'}`,
    columnMap: { source: 'prospecting-list' },
    leads,
    startDt: defaultOutreachStartDt(),
    batchSize,
    touchGapDays,
    createdBy,
  });
  if (!d.ok || !d.batch?.id) return { ok: false, error: d.error || 'Could not create outreach batch' };
  return {
    ok: true,
    batch: d.batch,
    leadCount: leads.length,
    skipped: contacts.length - leads.length,
  };
}

export function outreachPathForBatch(batchId) {
  return `/bulk-outreach?batch=${encodeURIComponent(batchId)}&pace=drip`;
}
