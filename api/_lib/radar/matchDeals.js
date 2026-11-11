import { prisma } from '../prisma.js';
import { domainOf, isPublicEmailDomain } from './filters.js';

function liveDealsFromState(value) {
  const deals = value?.deals || value?.state?.deals || [];
  if (!Array.isArray(deals)) return [];
  return deals.filter(d => d && !d.deleted && d.status !== 'removed');
}

export async function loadLiveDeals() {
  const setting = await prisma.setting.findUnique({ where: { key: 'app_state' } }).catch(() => null);
  return liveDealsFromState(setting?.value || {});
}

export function matchDealFromList(deals, { contactEmail, organization } = {}) {
  const email = String(contactEmail || '').toLowerCase();
  const domain = domainOf(email);
  const org = String(organization || '').toLowerCase().trim();

  const scored = [];
  for (const d of deals || []) {
    const emails = [d.email, d.contactEmail, d.contact?.email, d.repEmail]
      .filter(Boolean)
      .map(e => String(e).toLowerCase());
    const names = [d.school, d.account, d.org, d.organization, d.name, d.customer, d.title]
      .filter(Boolean)
      .map(n => String(n).toLowerCase());

    let score = 0;
    if (email && emails.includes(email)) score += 100;
    if (domain && !isPublicEmailDomain(domain) && emails.some(e => domainOf(e) === domain)) score += 40;
    if (org && names.some(n => n.includes(org) || org.includes(n))) score += 30;
    if (score > 0) scored.push({ deal: d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { dealId: null, dealStage: null, dealName: null };
  const d = top.deal;
  return {
    dealId: d.id || d.zohoId || null,
    dealStage: d.stage || d.status || null,
    dealName: d.school || d.name || d.title || null,
  };
}

export async function matchContactDeal({ contactEmail, organization }) {
  const email = String(contactEmail || '').toLowerCase();
  let contact = null;
  if (email) {
    contact = await prisma.salesContact.findUnique({ where: { email } }).catch(() => null);
  }
  let account = null;
  if (contact?.accountId) {
    account = await prisma.account.findUnique({ where: { id: contact.accountId } }).catch(() => null);
  }
  const domain = domainOf(email);
  if (!account && domain && !isPublicEmailDomain(domain)) {
    account = await prisma.account.findFirst({ where: { domain } }).catch(() => null);
  }
  const deals = await loadLiveDeals();
  const matched = matchDealFromList(deals, {
    contactEmail: email,
    organization: organization || account?.name || contact?.companyName,
  });
  if (matched.dealId) return { ...matched, accountName: account?.name || null };
  return {
    dealId: null,
    dealStage: null,
    dealName: null,
    accountName: account?.name || contact?.companyName || null,
  };
}

export function summarizeDeals(deals) {
  return (deals || []).slice(0, 200).map(d => ({
    id: d.id,
    name: d.school || d.name || d.title || 'Deal',
    stage: d.stage || d.status || '',
    email: d.email || d.contactEmail || '',
  }));
}
