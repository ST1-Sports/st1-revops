import { prisma } from '../prisma.js';
import { SEED_VENDOR_DOMAINS, isPublicEmailDomain } from './filters.js';

// Offers end up in customer drafts, so they start inactive with an expiry: an admin confirms
// each one and turns it on in the Radar config.
const END_OF_2026 = new Date('2026-12-31T23:59:59-07:00');
const SEED_HOOKS = [
  {
    title: 'Baden booking price locked through 12/31',
    body: 'Baden booking price is locked through 12/31 — worth locking if they are still deciding.',
    keywords: ['baden', 'volleyball', 'basketball', 'tf-5000', 'booking'],
    active: false,
    expiresAt: END_OF_2026,
  },
  {
    title: 'Gill track booking specials — order by end of year',
    body: 'Gill track booking specials — order by end of year to hold this season\'s price.',
    keywords: ['gill', 'track', 'field', 'hurdle', 'pit', 'booking'],
    active: false,
    expiresAt: END_OF_2026,
  },
];

const SEED_EVERY_MS = 6 * 60 * 60 * 1000;
const ZOHO_EVERY_MS = 24 * 60 * 60 * 1000;
let lastSeededAt = 0;

/** A vendor domain must never be a public mailbox or school domain (that would hide customers). */
export function isSeedableVendorDomain(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d || !d.includes('.') || d.endsWith('st1sports.com')) return false;
  if (isPublicEmailDomain(d)) return false;
  if (/\.(edu|k12\.[a-z]{2}\.us)$/.test(d) || d.includes('.k12.')) return false;
  return true;
}

/** Seeds defaults at most every few hours per instance (and Zoho vendors at most daily). */
export async function seedRadarConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastSeededAt < SEED_EVERY_MS) return;
  lastSeededAt = now;
  for (const domain of SEED_VENDOR_DOMAINS) {
    await prisma.radarVendorDomain.upsert({
      where: { domain },
      update: {},
      create: { domain, source: 'manual' },
    });
  }
  const existing = await prisma.radarProgramHook.count();
  if (existing === 0) {
    for (const hook of SEED_HOOKS) {
      await prisma.radarProgramHook.create({ data: hook });
    }
  }
  // Clean up any public/school domain an earlier seed may have added.
  const zohoRows = await prisma.radarVendorDomain.findMany({ where: { source: 'zoho' } });
  const bad = zohoRows.filter(r => !isSeedableVendorDomain(r.domain)).map(r => r.domain);
  if (bad.length) await prisma.radarVendorDomain.deleteMany({ where: { domain: { in: bad } } });
  try {
    const latest = zohoRows.reduce((max, r) => Math.max(max, new Date(r.createdAt).getTime()), 0);
    if (force || now - latest > ZOHO_EVERY_MS) await seedZohoVendors();
  } catch (err) {
    console.warn('[radar] zoho vendor seed skipped:', err.message);
  }
}

async function seedZohoVendors() {
  if (!process.env.ZOHO_REFRESH_TOKEN && !process.env.ZOHO_CLIENT_ID) return;
  const { booksGet } = await import('../zoho-books.js');
  let page = 1;
  let added = 0;
  while (page <= 5) {
    const data = await booksGet(`/contacts?contact_type=vendor&per_page=200&page=${page}`);
    const contacts = data.contacts || [];
    for (const c of contacts) {
      const website = String(c.website || c.email || '').toLowerCase();
      const domain = website.includes('@')
        ? website.split('@')[1]
        : website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      if (!isSeedableVendorDomain(domain)) continue;
      await prisma.radarVendorDomain.upsert({
        where: { domain },
        update: {},
        create: { domain, source: 'zoho' },
      });
      added++;
    }
    if (!data.page_context?.has_more_page) break;
    page++;
  }
  return added;
}

export async function vendorDomainSet() {
  const rows = await prisma.radarVendorDomain.findMany();
  return new Set(rows.map(r => r.domain.toLowerCase()));
}

export async function activeProgramHooks() {
  const now = new Date();
  const rows = await prisma.radarProgramHook.findMany({ where: { active: true } });
  return rows.filter(h => !h.expiresAt || h.expiresAt > now);
}
