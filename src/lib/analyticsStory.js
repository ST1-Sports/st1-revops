/**
 * Analytics "how we're doing / where to double down" — open pipeline,
 * deals that need a follow-up, and key customers. Campaigns and email
 * blast stats are not part of this view.
 */

import { orgNamesMatch } from './quoteCrmLink.js';

export const ANALYTICS_CLOSED = new Set(['Closed Won', 'Closed Lost', 'PO Received']);

export const ANALYTICS_TABS = [
  ['story', 'Overview'],
  ['open', 'Open Deals'],
  ['attention', 'Needs Attention'],
  ['won', 'Won'],
  ['accounts', 'Key Accounts'],
];

const SKIP_INVOICE = new Set(['void', 'draft']);
const STALE_DAYS = 14;
const DUE_SOON_DAYS = 2;

export function isOpenDeal(deal) {
  return !!(deal && !ANALYTICS_CLOSED.has(deal.stage));
}

export function isWonDeal(deal) {
  return deal?.stage === 'Closed Won';
}

/** Calendar-day delta for a YYYY-MM-DD (or parseable) follow-up date. */
export function daysUntilDate(dateStr, now = Date.now()) {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const due = m
    ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : Date.parse(raw);
  if (!Number.isFinite(due)) return null;
  const n = new Date(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const dueDay = m ? due : Date.UTC(new Date(due).getUTCFullYear(), new Date(due).getUTCMonth(), new Date(due).getUTCDate());
  return Math.round((dueDay - today) / 86400000);
}

export function daysSinceTouch(deal, now = Date.now()) {
  const t = deal?.lastTouch || deal?.createdAt;
  if (t == null || t === '') return null;
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now - ms) / 86400000);
}

/**
 * Highest-priority reason this open deal needs a look. Null if it's current.
 * urgency: 4 overdue, 3 due soon, 2 stale / on hold, 1 no follow-up set.
 */
export function dealAttention(deal, now = Date.now()) {
  if (!isOpenDeal(deal)) return null;
  const until = daysUntilDate(deal.followUpDate, now);
  if (until != null && until < 0) {
    const d = Math.abs(until);
    return { reason: `${d}d overdue`, urgency: 4, kind: 'overdue' };
  }
  if (until != null && until === 0) {
    return { reason: 'due today', urgency: 3, kind: 'due' };
  }
  if (until != null && until <= DUE_SOON_DAYS) {
    return { reason: `due in ${until}d`, urgency: 3, kind: 'due' };
  }
  if (deal.stage === 'On Hold') {
    return { reason: 'on hold', urgency: 2, kind: 'hold' };
  }
  const stale = daysSinceTouch(deal, now);
  if (stale != null && stale >= STALE_DAYS) {
    return { reason: `quiet ${stale}d`, urgency: 2, kind: 'stale' };
  }
  if (!deal.followUpDate) {
    return { reason: 'no follow-up set', urgency: 1, kind: 'nofollow' };
  }
  return null;
}

export function rankOpenDeals(deals) {
  return (deals || [])
    .filter(isOpenDeal)
    .slice()
    .sort((a, b) => (b.value || 0) - (a.value || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

export function rankWonDeals(deals) {
  return (deals || [])
    .filter(isWonDeal)
    .slice()
    .sort((a, b) => (b.value || 0) - (a.value || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

export function rankAttentionDeals(deals, now = Date.now()) {
  return (deals || [])
    .map(d => {
      const att = dealAttention(d, now);
      return att ? { ...d, attention: att.reason, urgency: att.urgency, attentionKind: att.kind } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.urgency - a.urgency) || (b.value || 0) - (a.value || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

function findGroup(groups, name) {
  return groups.find(g => orgNamesMatch(g.name, name));
}

function ensureGroup(groups, name) {
  const n = String(name || '').trim();
  if (!n || n === '(No School)') return null;
  let g = findGroup(groups, n);
  if (!g) {
    g = {
      name: n,
      invoices: [],
      deals: [],
      contacts: [],
      invoiced: 0,
      paid: 0,
      owed: 0,
      pipeline: 0,
      won: 0,
      customer: false,
    };
    groups.push(g);
  } else if (n.length > (g.name || '').length) {
    g.name = n;
  }
  return g;
}

function liveInvoice(inv) {
  return inv && !SKIP_INVOICE.has(inv.status);
}

/**
 * Key accounts = invoiced/won customers, plus schools with open pipeline.
 * Hot-lead scores are not used — this is money in, money owed, money in play.
 */
export function buildKeyAccounts({ invoices = [], deals = [], contacts = [] } = {}) {
  const groups = [];

  for (const inv of invoices) {
    if (!liveInvoice(inv)) continue;
    const g = ensureGroup(groups, inv.customer);
    if (!g) continue;
    g.invoices.push(inv);
    g.customer = true;
    g.invoiced += inv.total || 0;
    g.owed += inv.balance || 0;
    g.paid += (inv.total || 0) - (inv.balance || 0);
  }

  for (const d of deals) {
    const g = ensureGroup(groups, d.school || d.company || d.account);
    if (!g) continue;
    g.deals.push(d);
    if (isOpenDeal(d)) g.pipeline += d.value || 0;
    if (isWonDeal(d)) {
      g.customer = true;
      g.won += d.value || 0;
    }
  }

  for (const c of contacts) {
    const school = typeof c.school === 'string' ? c.school : c.school?.name;
    const g = school ? findGroup(groups, school) : null;
    if (!g) continue;
    g.contacts.push(c);
  }

  return groups
    .filter(g => g.customer || g.pipeline > 0)
    .sort((a, b) => {
      if (a.customer !== b.customer) return a.customer ? -1 : 1;
      return (b.invoiced - a.invoiced)
        || (b.pipeline - a.pipeline)
        || (b.owed - a.owed)
        || a.name.localeCompare(b.name);
    });
}

export function analyticsKpis({ deals = [], invoices = [], accounts = [] } = {}, now = Date.now()) {
  const open = (deals || []).filter(isOpenDeal);
  const won = (deals || []).filter(isWonDeal);
  const lost = (deals || []).filter(d => d.stage === 'Closed Lost');
  const closed = won.length + lost.length;
  const attention = open.filter(d => dealAttention(d, now));
  const liveInv = (invoices || []).filter(liveInvoice);
  return {
    wonCount: won.length,
    wonTotal: won.reduce((a, d) => a + (d.value || 0), 0),
    openCount: open.length,
    openPipeline: open.reduce((a, d) => a + (d.value || 0), 0),
    attentionCount: attention.length,
    lostCount: lost.length,
    winRate: closed ? Math.round((won.length / closed) * 100) : 0,
    avgDeal: won.length ? Math.round(won.reduce((a, d) => a + (d.value || 0), 0) / won.length) : 0,
    keyAccountCount: accounts.length,
    customerCount: accounts.filter(a => a.customer).length,
    invoicedTotal: liveInv.reduce((a, i) => a + (i.total || 0), 0),
    outstanding: liveInv.reduce((a, i) => a + (i.balance || 0), 0),
  };
}

export function pipelineByStage(deals) {
  const map = {};
  for (const d of deals || []) {
    const stage = d.stage || 'Quoted';
    if (!map[stage]) map[stage] = { stage, count: 0, value: 0 };
    map[stage].count += 1;
    map[stage].value += d.value || 0;
  }
  return Object.values(map).sort((a, b) => b.value - a.value || b.count - a.count);
}

export function pipelineByProduct(deals) {
  const map = {};
  for (const d of deals || []) {
    const product = d.product || 'Other';
    if (!map[product]) map[product] = { product, count: 0, value: 0 };
    map[product].count += 1;
    map[product].value += d.value || 0;
  }
  return Object.values(map).sort((a, b) => b.value - a.value || b.count - a.count);
}

export function dealsForFilter(deals, filter, { stage, now = Date.now() } = {}) {
  if (filter === 'won') return rankWonDeals(deals);
  if (filter === 'attention') return rankAttentionDeals(deals, now);
  if (filter === 'open') {
    const open = rankOpenDeals(deals);
    return stage ? open.filter(d => d.stage === stage) : open;
  }
  return [];
}

/**
 * One-line beats for the overview: how we're doing, then where to lean in.
 */
export function storyBeats(kpis) {
  const openBit = kpis.openCount
    ? `${kpis.openCount} open deal${kpis.openCount === 1 ? '' : 's'}`
    : 'No open deals';
  const attentionBit = kpis.attentionCount
    ? `${kpis.attentionCount} need a follow-up`
    : 'pipeline is current';
  const customerBit = kpis.customerCount
    ? `${kpis.customerCount} key customer${kpis.customerCount === 1 ? '' : 's'}`
    : 'no invoiced customers yet';
  return { openBit, attentionBit, customerBit };
}

/**
 * Places to double down: overdue/stale deals first, then customers with
 * money outstanding or more pipeline sitting on an existing account.
 */
export function doubleDownItems({ attentionDeals = [], keyAccounts = [] } = {}) {
  const deals = attentionDeals.slice(0, 8).map(d => ({
    kind: 'deal',
    id: d.id,
    name: d.name,
    school: d.school || d.company || '',
    value: d.value || 0,
    label: d.attention,
    urgency: d.urgency || 0,
    deal: d,
  }));
  const accounts = keyAccounts
    .filter(a => a.owed > 0 || (a.customer && a.pipeline > 0))
    .slice(0, 8)
    .map(a => ({
      kind: 'account',
      id: a.name,
      name: a.name,
      school: a.name,
      value: a.owed > 0 ? a.owed : a.pipeline,
      label: a.owed > 0 ? 'outstanding' : 'upsell in play',
      urgency: a.owed > 0 ? 3 : 2,
      account: a,
    }));
  return [...deals, ...accounts]
    .sort((a, b) => (b.urgency - a.urgency) || (b.value - a.value))
    .slice(0, 8);
}

/** Live deal for the analytics modal — id stays stable while stage/value update. */
export function liveDealFromList(deals, id) {
  if (id == null || id === '') return null;
  return (deals || []).find(d => d && d.id === id) || null;
}

export function plusDaysISO(days, now = Date.now()) {
  return new Date(now + Number(days) * 86400000).toISOString().slice(0, 10);
}

/** Patch applied when a stage chip is clicked in the analytics deal modal. */
export function dealStagePatch(deal, nextStage, now = Date.now()) {
  if (!deal?.id || !nextStage || nextStage === deal.stage) return null;
  return { id: deal.id, stage: nextStage, lastTouch: now };
}

export function matchesAnalyticsQuery(row, q) {
  if (!q) return true;
  const needle = String(q).trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.name,
    row.school,
    row.company,
    row.contact,
    row.stage,
    row.product,
    row.attention,
    row.label,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}
