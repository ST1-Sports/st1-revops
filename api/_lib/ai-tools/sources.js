import { prisma } from '../prisma.js';
import { getZohoToken } from '../zoho-token.js';

const CRM_BASE = 'https://www.zohoapis.com/crm/v3';
const BOOKS_BASE = 'https://www.zohoapis.com/books/v3';

export const ST1_BRAND_GUIDANCE = {
  id: 'st1-brand-voice',
  name: 'ST1 brand voice',
  summary: 'Warm, direct, relationship-first, athlete-aware, and specific.',
  rules: [
    'Lead with the person and the program before the product.',
    'Use plain, direct sentences and first-person language where appropriate.',
    'Reference the athlete and sport culture when it is relevant.',
    'Avoid generic efficiency claims, corporate tone, and filler inspiration phrases.',
    'Sign customer-facing outreach with ST1 Sports, matt@st1sports.com, 719-256-0275, st1sports.com.',
  ],
};

export const AI_TOOL_SAFETY_POLICY = {
  id: 'st1-ai-tool-safety',
  name: 'ST1 AI tool safety policy',
  summary: 'External AI applications may call only named, read-only business tools with scoped authentication.',
  rules: [
    'Do not expose raw SQL, database credentials, access tokens, or integration secrets.',
    'Do not provide arbitrary database access or free-form query execution.',
    'Return structured JSON with source metadata and limitations.',
    'Require a bearer token with the tool-specific read scope.',
    'Do not implement autonomous write actions until a separate human-approval workflow exists.',
    'If an authoritative internal tool exists for a question, the AI should call it instead of guessing.',
  ],
};

export const PRICING_POLICY = {
  id: 'st1-pricing-policy',
  name: 'ST1 pricing policy',
  summary: 'Use authoritative internal price and cost sources first; never invent missing pricing.',
  rules: [
    'Use Zoho Books item cost and price data when configured and available.',
    'Use the synced product catalog for customer-facing list/sale prices.',
    'When cost is not available, return null and explain the limitation.',
    'Never estimate internal cost unless the user explicitly asks for a non-authoritative estimate.',
    'Include source records and retrieval timestamps in pricing answers.',
  ],
};

export const CUSTOMER_POLICY = {
  id: 'st1-customer-data-policy',
  name: 'ST1 customer data policy',
  summary: 'Customer data is restricted to callers with customer read permissions.',
  rules: [
    'Return only selected contact and organization fields needed for business use.',
    'Do not expose private notes unless the caller also has customer:read:notes.',
    'Do not expose OAuth tokens, integration credentials, or raw upstream responses.',
  ],
};

export const POLICY_LIBRARY = [
  ST1_BRAND_GUIDANCE,
  AI_TOOL_SAFETY_POLICY,
  PRICING_POLICY,
  CUSTOMER_POLICY,
];

export function retrievedAt() {
  return new Date().toISOString();
}

export function source(system, record = {}) {
  return {
    system,
    ...record,
    retrievedAt: retrievedAt(),
  };
}

export function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function safeLimit(limit, fallback = 10, max = 50) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function jsonText(value) {
  try {
    return JSON.stringify(value || '').toLowerCase();
  } catch {
    return '';
  }
}

export function productMatches(product, query) {
  const q = normalizeText(query);
  if (!q) return true;
  return [
    product.id,
    product.name,
    product.slug,
    product.permalink,
    product.brand,
    jsonText(product.categories),
    jsonText(product.tags),
    jsonText(product.attributes),
  ].some(value => normalizeText(value).includes(q));
}

export function mapProduct(product) {
  if (!product) return null;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug || null,
    permalink: product.permalink || null,
    brand: product.brand || null,
    price: toNumberOrNull(product.price),
    regularPrice: toNumberOrNull(product.regular_price),
    salePrice: toNumberOrNull(product.sale_price),
    onSale: Boolean(product.on_sale),
    stockStatus: product.stock_status || null,
    shortDescription: product.short_description || null,
    imageUrl: product.main_image_url || null,
    categories: product.categories || [],
    tags: product.tags || [],
    attributes: product.attributes || [],
    modifiedAt: product.date_modified ? product.date_modified.toISOString() : null,
    source: source('ST1 product catalog (WooCommerce sync)', { recordId: String(product.id) }),
  };
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  permalink: true,
  price: true,
  regular_price: true,
  sale_price: true,
  on_sale: true,
  stock_status: true,
  short_description: true,
  main_image_url: true,
  categories: true,
  tags: true,
  attributes: true,
  brand: true,
  date_modified: true,
};

export async function findProducts({ query, productId, brand, limit = 10 } = {}) {
  const take = safeLimit(limit, 10, 50);
  const where = {};
  const or = [];

  if (Number.isInteger(productId)) {
    where.id = productId;
  } else {
    if (query) {
      or.push(
        { name: { contains: query, mode: 'insensitive' } },
        { slug: { contains: query, mode: 'insensitive' } },
        { brand: { contains: query, mode: 'insensitive' } },
      );
      const numericId = Number(query);
      if (Number.isInteger(numericId)) or.push({ id: numericId });
    }
    if (brand) {
      where.brand = { contains: brand, mode: 'insensitive' };
    }
    if (or.length) where.OR = or;
  }

  const directMatches = await prisma.product.findMany({
    where,
    orderBy: { name: 'asc' },
    take,
    select: PRODUCT_SELECT,
  });

  if (!query || directMatches.length >= take || Number.isInteger(productId)) {
    return directMatches.map(mapProduct);
  }

  // SKU-like values often live in synced attributes/tags. Search a bounded product
  // slice in memory so callers still cannot issue arbitrary database queries.
  const fallbackProducts = await prisma.product.findMany({
    orderBy: [{ date_modified: 'desc' }, { name: 'asc' }],
    take: 250,
    select: PRODUCT_SELECT,
  });
  const merged = new Map(directMatches.map(product => [product.id, product]));
  for (const product of fallbackProducts) {
    if (productMatches(product, query)) merged.set(product.id, product);
    if (merged.size >= take) break;
  }
  return [...merged.values()].slice(0, take).map(mapProduct);
}

export async function fetchZohoItems({ query, sku, limit = 10 } = {}) {
  const orgId = process.env.ZOHO_ORG_ID;
  if (!orgId) {
    return { configured: false, items: [], sources: [] };
  }

  const token = await getZohoToken();
  const search = (sku || query || '').trim();
  const params = new URLSearchParams({
    organization_id: orgId,
    per_page: String(safeLimit(limit, 10, 50)),
    filter_by: 'Status.Active',
  });
  if (search) params.set('search_text', search);

  const response = await fetch(`${BOOKS_BASE}/items?${params.toString()}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });

  if (!response.ok) {
    return {
      configured: true,
      items: [],
      sources: [source('Zoho Books Items', { status: `HTTP ${response.status}` })],
      warning: 'Zoho Books item lookup failed',
    };
  }

  const data = await response.json();
  const items = (data.items || []).map(item => ({
    id: item.item_id || item.id || null,
    name: item.name || '',
    sku: item.sku || '',
    unit: item.unit || null,
    status: item.status || null,
    brand: item.brand || item.manufacturer || null,
    vendorName: item.vendor_name || null,
    vendorId: item.vendor_id || null,
    rate: toNumberOrNull(item.rate ?? item.selling_price),
    purchaseRate: toNumberOrNull(item.purchase_rate),
    currency: item.currency_code || 'USD',
    source: source('Zoho Books Items', { recordId: item.item_id || item.id || null }),
  }));

  return {
    configured: true,
    items,
    sources: [source('Zoho Books Items', { count: items.length })],
  };
}

export async function searchZohoCrm(query, limit = 10) {
  const q = String(query || '').trim();
  if (q.length < 2) return { configured: true, contacts: [], leads: [] };

  let token;
  try {
    token = await getZohoToken();
  } catch {
    return { configured: false, contacts: [], leads: [] };
  }

  async function search(module, field) {
    const criteria = encodeURIComponent(`(${field}:contains:${q})`);
    const res = await fetch(`${CRM_BASE}/${module}/search?criteria=${criteria}&per_page=${safeLimit(limit, 10, 25)}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (res.status === 204) return [];
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  }

  const [contactsByName, contactsByAccount, contactsByEmail, leadsByName, leadsByCompany, leadsByEmail] = await Promise.all([
    search('Contacts', 'Full_Name'),
    search('Contacts', 'Account_Name'),
    search('Contacts', 'Email'),
    search('Leads', 'Full_Name'),
    search('Leads', 'Company'),
    search('Leads', 'Email'),
  ]);

  return {
    configured: true,
    contacts: [...contactsByName, ...contactsByAccount, ...contactsByEmail],
    leads: [...leadsByName, ...leadsByCompany, ...leadsByEmail],
  };
}

export function mapZohoContact(record, module = 'Contact') {
  return {
    id: record.id || null,
    module,
    firstName: record.First_Name || '',
    lastName: record.Last_Name || '',
    fullName: record.Full_Name || `${record.First_Name || ''} ${record.Last_Name || ''}`.trim(),
    title: record.Title || null,
    organization: module === 'Lead' ? (record.Company || null) : (record.Account_Name?.name || record.Account_Name || null),
    email: record.Email || null,
    phone: record.Phone || null,
    source: source('Zoho CRM', { module, recordId: record.id || null }),
  };
}

export function mapSalesContact(contact, includeNotes = false) {
  return {
    id: contact.id,
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    title: contact.title || null,
    organization: contact.companyName || null,
    email: contact.email || null,
    phone: contact.phone || null,
    linkedinUrl: contact.linkedinUrl || null,
    sourceType: contact.source || null,
    segment: contact.segment || null,
    status: contact.status || null,
    score: contact.score,
    notes: includeNotes ? (contact.notes || null) : undefined,
    source: source('ST1 sales contacts', { recordId: contact.id }),
  };
}
