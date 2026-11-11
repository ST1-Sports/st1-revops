import { prisma } from '../prisma.js';
import { SEED_VENDOR_DOMAINS } from './filters.js';

const SEED_HOOKS = [
  {
    title: 'Baden booking price locked through 12/31',
    body: 'Baden booking price is locked through 12/31 — worth locking if they are still deciding.',
    keywords: ['baden', 'volleyball', 'basketball', 'tf-5000', 'booking'],
  },
  {
    title: 'Gill track booking specials — order by end of year',
    body: 'Gill track booking specials — order by end of year to hold this season\'s price.',
    keywords: ['gill', 'track', 'field', 'hurdle', 'pit', 'booking'],
  },
];

export async function seedRadarConfig() {
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
  try {
    await seedZohoVendors();
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
      if (!domain || !domain.includes('.') || domain.endsWith('st1sports.com')) continue;
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
