import { prisma } from '../prisma.js';
import { hasScope, requireScope } from './auth.js';
import { cloneJson } from './schema.js';
import {
  AI_TOOL_SAFETY_POLICY,
  CUSTOMER_POLICY,
  POLICY_LIBRARY,
  PRICING_POLICY,
  ST1_BRAND_GUIDANCE,
  fetchZohoItems,
  findProducts,
  getKnowledgeDocuments,
  mapSalesContact,
  mapZohoContact,
  retrievedAt,
  safeLimit,
  searchZohoCrm,
  source,
} from './sources.js';

const PRODUCT_LOOKUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    productId: { type: 'integer', minimum: 1, description: 'ST1 product catalog ID.' },
    sku: { type: 'string', minLength: 1, maxLength: 80, description: 'SKU or vendor item code to look up.' },
    productName: { type: 'string', minLength: 2, maxLength: 160, description: 'Product name or partial name.' },
    brand: { type: 'string', minLength: 2, maxLength: 100, description: 'Optional brand filter.' },
  },
  anyOf: [
    { required: ['productId'] },
    { required: ['sku'] },
    { required: ['productName'] },
  ],
};

function ok(tool, data) {
  return {
    tool,
    ok: true,
    generatedAt: retrievedAt(),
    ...data,
  };
}

function notFound(tool, query, sources = [], limitations = []) {
  return ok(tool, {
    status: 'not_found',
    query,
    result: null,
    sources,
    limitations,
  });
}

function queryFromProductInput(input) {
  return input.sku || input.productName || (input.productId ? String(input.productId) : '');
}

function marginPct(cost, price) {
  if (!cost || !price) return null;
  return Number((((price - cost) / price) * 100).toFixed(2));
}

async function getSt1Pricing(input) {
  const query = queryFromProductInput(input);
  const [products, zoho] = await Promise.all([
    findProducts({
      query,
      productId: input.productId,
      brand: input.brand,
      limit: input.includeAlternatives ? 5 : 1,
    }),
    fetchZohoItems({ query, sku: input.sku, limit: input.includeAlternatives ? 5 : 1 }).catch(error => ({
      configured: true,
      items: [],
      warning: error.message,
      sources: [source('Zoho Books Items', { status: 'lookup_error' })],
    })),
  ]);

  const primaryZoho = zoho.items?.[0] || null;
  const primaryProduct = products[0] || null;
  if (!primaryZoho && !primaryProduct) {
    return notFound('get_st1_pricing', input, zoho.sources || [], [
      zoho.configured === false ? 'Zoho Books is not configured for item cost lookup.' : null,
      'No matching product was found in the ST1 product catalog.',
    ].filter(Boolean));
  }

  const customerPrice =
    primaryZoho?.rate ??
    primaryProduct?.salePrice ??
    primaryProduct?.price ??
    primaryProduct?.regularPrice ??
    null;
  const cost = primaryZoho?.purchaseRate ?? null;

  const result = {
    name: primaryZoho?.name || primaryProduct?.name || null,
    sku: primaryZoho?.sku || input.sku || null,
    productId: primaryProduct?.id || null,
    brand: primaryZoho?.brand || primaryProduct?.brand || input.brand || null,
    currency: primaryZoho?.currency || 'USD',
    cost: cost == null ? null : { amount: cost, source: 'Zoho Books purchase rate' },
    customerPrice: customerPrice == null ? null : { amount: customerPrice, source: primaryZoho?.rate != null ? 'Zoho Books rate' : 'ST1 product catalog price' },
    regularPrice: primaryProduct?.regularPrice ?? null,
    salePrice: primaryProduct?.salePrice ?? null,
    onSale: primaryProduct?.onSale ?? null,
    mapPrice: null,
    marginPct: marginPct(cost, customerPrice),
    stockStatus: primaryProduct?.stockStatus || null,
    updatedAt: primaryProduct?.modifiedAt || null,
  };

  return ok('get_st1_pricing', {
    status: 'ok',
    query: input,
    result,
    alternatives: input.includeAlternatives
      ? {
          zohoItems: (zoho.items || []).slice(1),
          products: products.slice(1),
        }
      : undefined,
    sources: [
      primaryZoho?.source,
      primaryProduct?.source,
      ...(zoho.sources || []),
    ].filter(Boolean),
    limitations: [
      cost == null ? 'Authoritative internal cost was not available for this item.' : null,
      zoho.configured === false ? 'Zoho Books is not configured; cost lookup was skipped.' : null,
      zoho.warning || null,
    ].filter(Boolean),
  });
}

async function getSt1Product(input) {
  const products = await findProducts({
    query: queryFromProductInput(input),
    productId: input.productId,
    brand: input.brand,
    limit: input.includeAlternatives ? 10 : 1,
  });
  const product = products[0] || null;
  if (!product) return notFound('get_st1_product', input);

  return ok('get_st1_product', {
    status: 'ok',
    query: input,
    result: product,
    alternatives: input.includeAlternatives ? products.slice(1) : undefined,
    sources: [product.source],
  });
}

async function getSt1Brand(input) {
  const name = input.brandName || input.query || 'ST1';
  if (/^st1(\s+sports)?$/i.test(name)) {
    return ok('get_st1_brand', {
      status: 'ok',
      query: input,
      result: {
        name: 'ST1 Sports',
        positioning: ST1_BRAND_GUIDANCE.summary,
        rules: ST1_BRAND_GUIDANCE.rules,
      },
      sources: [source('ST1 internal policy library', { policyId: ST1_BRAND_GUIDANCE.id })],
    });
  }

  const limit = safeLimit(input.limit, 10, 25);
  const products = await findProducts({ query: name, brand: input.brandName || input.query, limit });
  const brandProducts = products.filter(product => product.brand && product.brand.toLowerCase().includes(name.toLowerCase()));
  if (!brandProducts.length) {
    return notFound('get_st1_brand', input, [], ['No matching brand was found in the synced product catalog.']);
  }

  return ok('get_st1_brand', {
    status: 'ok',
    query: input,
    result: {
      name: brandProducts[0].brand,
      productCountReturned: brandProducts.length,
      products: brandProducts.map(product => ({
        id: product.id,
        name: product.name,
        stockStatus: product.stockStatus,
        price: product.price,
        permalink: product.permalink,
      })),
    },
    sources: [...new Map(brandProducts.map(product => [product.source.recordId, product.source])).values()],
  });
}

async function getSt1Vendor(input) {
  const query = input.vendorName || input.query || input.productSku || '';
  const [products, zoho] = await Promise.all([
    findProducts({ query, brand: input.vendorName || input.query, limit: safeLimit(input.limit, 10, 25) }),
    fetchZohoItems({ query, sku: input.productSku, limit: safeLimit(input.limit, 10, 25) }).catch(error => ({
      configured: true,
      items: [],
      warning: error.message,
      sources: [source('Zoho Books Items', { status: 'lookup_error' })],
    })),
  ]);

  const vendors = new Map();
  for (const item of zoho.items || []) {
    const key = item.vendorId || item.vendorName || item.brand || item.name;
    if (!key) continue;
    vendors.set(key, {
      id: item.vendorId || null,
      name: item.vendorName || item.brand || null,
      authority: item.vendorName ? 'vendor_from_zoho_books_item' : 'brand_from_zoho_books_item',
      matchingItems: [{
        id: item.id,
        name: item.name,
        sku: item.sku,
      }],
      source: item.source,
    });
  }

  for (const product of products) {
    if (!product.brand) continue;
    const existing = vendors.get(product.brand);
    const match = {
      id: product.id,
      name: product.name,
      sku: null,
    };
    if (existing) {
      existing.matchingItems.push(match);
    } else {
      vendors.set(product.brand, {
        id: null,
        name: product.brand,
        authority: 'brand_field_from_product_catalog',
        matchingItems: [match],
        source: product.source,
      });
    }
  }

  const result = [...vendors.values()];
  if (!result.length) {
    return notFound('get_st1_vendor', input, zoho.sources || [], [
      zoho.configured === false ? 'Zoho Books is not configured for vendor lookup.' : null,
      'No dedicated vendor directory exists yet; current lookup uses Zoho item vendor fields and product catalog brand fields.',
    ].filter(Boolean));
  }

  return ok('get_st1_vendor', {
    status: 'ok',
    query: input,
    result: result.length === 1 ? result[0] : result,
    sources: result.map(entry => entry.source).filter(Boolean),
    limitations: [
      'Vendor lookup is read-only and limited to configured Zoho Books item vendor fields plus ST1 product catalog brand fields.',
      zoho.warning || null,
    ].filter(Boolean),
  });
}

async function getSt1Customer(input, auth) {
  const includeNotes = Boolean(input.includeNotes);
  if (includeNotes && !hasScope(auth, 'customer:read:notes')) {
    return {
      tool: 'get_st1_customer',
      ok: false,
      error: {
        code: 'permission_denied',
        message: 'includeNotes requires customer:read:notes',
        requiredScope: 'customer:read:notes',
      },
    };
  }

  const limit = safeLimit(input.limit, 10, 25);
  const where = {};
  const or = [];
  if (input.customerId) where.id = input.customerId;
  if (input.email) where.email = { equals: input.email, mode: 'insensitive' };
  if (input.query) {
    or.push(
      { firstName: { contains: input.query, mode: 'insensitive' } },
      { lastName: { contains: input.query, mode: 'insensitive' } },
      { companyName: { contains: input.query, mode: 'insensitive' } },
      { email: { contains: input.query, mode: 'insensitive' } },
    );
  }
  if (or.length) where.OR = or;

  const [localContacts, zoho] = await Promise.all([
    prisma.salesContact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        title: true,
        companyName: true,
        phone: true,
        linkedinUrl: true,
        source: true,
        score: true,
        segment: true,
        status: true,
        notes: includeNotes,
      },
    }),
    input.query || input.email ? searchZohoCrm(input.query || input.email, limit) : Promise.resolve({ configured: true, contacts: [], leads: [] }),
  ]);

  const results = [
    ...localContacts.map(contact => mapSalesContact(contact, includeNotes)),
    ...(zoho.contacts || []).map(record => mapZohoContact(record, 'Contact')),
    ...(zoho.leads || []).map(record => mapZohoContact(record, 'Lead')),
  ];

  const seen = new Map();
  for (const customer of results) {
    const key = customer.email || `${customer.source?.system}:${customer.id}`;
    if (!seen.has(key)) seen.set(key, customer);
  }
  const deduped = [...seen.values()].slice(0, limit);

  if (!deduped.length) {
    return notFound('get_st1_customer', input, [], [
      zoho.configured === false ? 'Zoho CRM is not configured; only local ST1 sales contacts were searched.' : null,
    ].filter(Boolean));
  }

  return ok('get_st1_customer', {
    status: 'ok',
    query: input,
    result: deduped.length === 1 ? deduped[0] : deduped,
    sources: deduped.map(customer => customer.source).filter(Boolean),
    limitations: [
      includeNotes ? null : 'Private notes were not requested and are omitted.',
      zoho.configured === false ? 'Zoho CRM is not configured; only local ST1 sales contacts were searched.' : null,
    ].filter(Boolean),
  });
}

async function getSt1Policy(input) {
  const policyType = input.policyType || 'ai_tool_safety';
  const byType = {
    brand_voice: ST1_BRAND_GUIDANCE,
    ai_tool_safety: AI_TOOL_SAFETY_POLICY,
    pricing: PRICING_POLICY,
    customer_data: CUSTOMER_POLICY,
  };

  if (policyType === 'sponsorship') {
    const config = await prisma.sponsorshipConfig.findUnique({ where: { id: 1 } });
    return ok('get_st1_policy', {
      status: 'ok',
      query: input,
      result: {
        id: 'st1-sponsorship-policy',
        name: 'ST1 sponsorship calculation policy',
        summary: 'Sponsorship calculations use the configured singleton values and do not persist results.',
        config: config ? {
          avgOrderValuePerAthlete: config.avgOrderValuePerAthlete,
          avgEquipmentOrderPerSport: config.avgEquipmentOrderPerSport,
          netMarginPct: config.netMarginPct,
          givebackPct: config.givebackPct,
          teamStoreRevenuePerAthlete: config.teamStoreRevenuePerAthlete,
          purchaseFrequencyPerYear: config.purchaseFrequencyPerYear,
          boosterMultiplier: config.boosterMultiplier,
          updatedAt: config.updatedAt.toISOString(),
        } : null,
      },
      sources: [source('ST1 sponsorship configuration', { recordId: '1' })],
      limitations: config ? [] : ['SponsorshipConfig has not been seeded yet.'],
    });
  }

  if (policyType === 'sales_talk_track') {
    const questions = await prisma.talkTrackQuestion.findMany({
      where: { isActive: true },
      orderBy: [{ phase: 'asc' }, { order: 'asc' }],
      take: 100,
      select: {
        id: true,
        phase: true,
        order: true,
        questionText: true,
        helpText: true,
        inputType: true,
        selectOptions: true,
        isRequired: true,
      },
    });
    return ok('get_st1_policy', {
      status: 'ok',
      query: input,
      result: {
        id: 'st1-sales-talk-track',
        name: 'ST1 sales talk track',
        questions,
      },
      sources: [source('ST1 talk track questions', { count: questions.length })],
    });
  }

  const policy = byType[policyType];
  if (!policy) return notFound('get_st1_policy', input);

  return ok('get_st1_policy', {
    status: 'ok',
    query: input,
    result: policy,
    sources: [source('ST1 internal policy library', { policyId: policy.id })],
  });
}

async function searchSt1Knowledge(input, auth) {
  const domains = input.domains?.length
    ? input.domains
    : ['products', 'pricing', 'vendors', 'brands', 'policies', 'documents'];
  const limit = safeLimit(input.limit, 10, 25);
  const results = {};
  const deniedDomains = [];

  async function ifAllowed(domain, scope, fn) {
    if (!hasScope(auth, scope)) {
      deniedDomains.push({ domain, requiredScope: scope });
      return;
    }
    results[domain] = await fn();
  }

  await Promise.all(domains.map(domain => {
    switch (domain) {
      case 'products':
        return ifAllowed(domain, 'product:read', async () => ({
          items: await findProducts({ query: input.query, limit }),
        }));
      case 'pricing':
        return ifAllowed(domain, 'pricing:read', async () => ({
          item: await getSt1Pricing({ productName: input.query, includeAlternatives: true }),
        }));
      case 'vendors':
        return ifAllowed(domain, 'vendor:read', async () => ({
          item: await getSt1Vendor({ query: input.query, limit }),
        }));
      case 'brands':
        return ifAllowed(domain, 'brand:read', async () => ({
          item: await getSt1Brand({ query: input.query, limit }),
        }));
      case 'customers':
        return ifAllowed(domain, 'customer:read', async () => ({
          item: await getSt1Customer({ query: input.query, limit }, auth),
        }));
      case 'policies':
        return ifAllowed(domain, 'policy:read', async () => ({
          items: POLICY_LIBRARY
            .filter(policy => `${policy.name} ${policy.summary} ${policy.rules.join(' ')}`.toLowerCase().includes(input.query.toLowerCase()))
            .slice(0, limit),
          sources: [source('ST1 internal policy library')],
        }));
      case 'documents':
        return ifAllowed(domain, 'knowledge:read', async () => ({
          items: await getKnowledgeDocuments({ query: input.query, limit }),
        }));
      default:
        return Promise.resolve();
    }
  }));

  return ok('search_st1_knowledge', {
    status: 'ok',
    query: input,
    result: results,
    deniedDomains,
    limitations: deniedDomains.length ? ['Some domains were omitted because the caller lacks the required scope.'] : [],
  });
}

export const AI_TOOLS = [
  {
    name: 'search_st1_knowledge',
    description: 'Search the safe ST1 knowledge layer across permitted read-only business domains. Use this before answering broad ST1 questions that may require internal product, pricing, vendor, brand, customer, or policy context.',
    permission: 'knowledge:read',
    readOnly: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 200, description: 'Business question or search term.' },
        domains: {
          type: 'array',
          maxItems: 7,
          uniqueItems: true,
          description: 'Optional knowledge domains to search. Omit to search safe default domains.',
          items: { type: 'string', enum: ['products', 'pricing', 'vendors', 'brands', 'customers', 'policies', 'documents'] },
        },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum results per domain.' },
      },
    },
    handler: searchSt1Knowledge,
  },
  {
    name: 'get_st1_pricing',
    description: 'Return authoritative ST1 pricing and cost data for a specific product or SKU when available. The tool returns null for unavailable cost fields instead of estimating.',
    permission: 'pricing:read',
    readOnly: true,
    input_schema: {
      ...PRODUCT_LOOKUP_SCHEMA,
      properties: {
        ...PRODUCT_LOOKUP_SCHEMA.properties,
        includeAlternatives: { type: 'boolean', description: 'Return close matches when the first match may not be exact.' },
      },
    },
    handler: getSt1Pricing,
  },
  {
    name: 'get_st1_product',
    description: 'Look up a product from the ST1 synced product catalog by product ID, SKU-like code, name, or brand.',
    permission: 'product:read',
    readOnly: true,
    input_schema: {
      ...PRODUCT_LOOKUP_SCHEMA,
      properties: {
        ...PRODUCT_LOOKUP_SCHEMA.properties,
        includeAlternatives: { type: 'boolean', description: 'Return close product matches.' },
      },
    },
    handler: getSt1Product,
  },
  {
    name: 'get_st1_vendor',
    description: 'Return safe vendor or supplier context from configured item vendor fields and product catalog brand fields. Does not expose vendor credentials or arbitrary vendor database access.',
    permission: 'vendor:read',
    readOnly: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vendorName: { type: 'string', minLength: 2, maxLength: 120, description: 'Vendor, supplier, manufacturer, or brand name.' },
        productSku: { type: 'string', minLength: 1, maxLength: 80, description: 'SKU used to infer vendor context from an item.' },
        query: { type: 'string', minLength: 2, maxLength: 160, description: 'General vendor lookup query.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      anyOf: [
        { required: ['vendorName'] },
        { required: ['productSku'] },
        { required: ['query'] },
      ],
    },
    handler: getSt1Vendor,
  },
  {
    name: 'get_st1_brand',
    description: 'Return ST1 brand guidance or product-catalog brand context for a named brand. Use ST1 brand guidance for customer-facing copy and positioning questions.',
    permission: 'brand:read',
    readOnly: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        brandName: { type: 'string', minLength: 2, maxLength: 100, description: 'Brand name, such as ST1 Sports or a product brand.' },
        query: { type: 'string', minLength: 2, maxLength: 120, description: 'Brand search term.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      anyOf: [
        { required: ['brandName'] },
        { required: ['query'] },
      ],
    },
    handler: getSt1Brand,
  },
  {
    name: 'get_st1_customer',
    description: 'Look up a customer, contact, or lead from permitted ST1 customer sources. Requires customer read scope and omits private notes unless explicitly permitted.',
    permission: 'customer:read',
    readOnly: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', minLength: 1, maxLength: 80, description: 'ST1 local customer/contact ID.' },
        email: { type: 'string', minLength: 3, maxLength: 180, description: 'Customer email address.' },
        query: { type: 'string', minLength: 2, maxLength: 160, description: 'Name, organization, or email search term.' },
        includeNotes: { type: 'boolean', description: 'Include private notes. Requires customer:read:notes.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      anyOf: [
        { required: ['customerId'] },
        { required: ['email'] },
        { required: ['query'] },
      ],
    },
    handler: getSt1Customer,
  },
  {
    name: 'get_st1_policy',
    description: 'Return an internal ST1 policy or operating guide relevant to AI usage, pricing, brand voice, customer data, sponsorship calculations, or sales talk tracks.',
    permission: 'policy:read',
    readOnly: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['policyType'],
      properties: {
        policyType: {
          type: 'string',
          enum: ['ai_tool_safety', 'pricing', 'brand_voice', 'customer_data', 'sponsorship', 'sales_talk_track'],
          description: 'Policy category to retrieve.',
        },
      },
    },
    handler: getSt1Policy,
  },
];

const TOOL_MAP = new Map(AI_TOOLS.map(tool => [tool.name, tool]));

export const TOOL_USE_GUIDANCE = {
  version: '2026-08-17',
  principle: 'When an authoritative ST1 tool exists for a business question, the AI must call the tool instead of guessing.',
  requiredToolUse: [
    {
      intent: 'Product cost, price, margin, MAP, SKU, or quote-rate lookup',
      tool: 'get_st1_pricing',
    },
    {
      intent: 'Product details, availability, catalog link, category, image, or brand field',
      tool: 'get_st1_product',
    },
    {
      intent: 'Vendor, supplier, manufacturer, or source-of-supply context',
      tool: 'get_st1_vendor',
    },
    {
      intent: 'ST1 brand voice, positioning, or brand-specific product context',
      tool: 'get_st1_brand',
    },
    {
      intent: 'Customer, contact, school, lead, or CRM lookup',
      tool: 'get_st1_customer',
    },
    {
      intent: 'Internal policy, AI safety rule, pricing rule, customer-data rule, sponsorship config, or sales talk track',
      tool: 'get_st1_policy',
    },
    {
      intent: 'Uploaded knowledge documents or broad ST1 business search across multiple domains',
      tool: 'search_st1_knowledge',
    },
  ],
  responseRules: [
    'Explain answers in natural language only after receiving tool results.',
    'Cite the returned sources when sources are present.',
    'State limitations from the tool result instead of filling gaps with guesses.',
    'If a tool returns not_found or unavailable, ask a clarifying question or say the authoritative source does not contain the answer.',
    'Do not request or reveal SQL, credentials, tokens, raw upstream responses, or hidden implementation details.',
    'Do not perform writes or propose autonomous writes through this tool layer.',
  ],
};

export function getTool(name) {
  return TOOL_MAP.get(name);
}

export function listToolsForAuth(auth) {
  return AI_TOOLS
    .filter(tool => hasScope(auth, tool.permission))
    .map(tool => publicToolDefinition(tool));
}

export function publicToolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: cloneJson(tool.input_schema),
    permission: tool.permission,
    readOnly: tool.readOnly,
  };
}

export function anthropicToolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: cloneJson(tool.input_schema),
  };
}

export function openAiToolDefinition(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: cloneJson(tool.input_schema),
    },
  };
}

export async function invokeTool(tool, input, auth) {
  const permissionError = requireScope(auth, tool.permission);
  if (permissionError) {
    return {
      tool: tool.name,
      ok: false,
      error: permissionError,
    };
  }
  return tool.handler(input, auth);
}

export function listProviderFormats(auth) {
  const permitted = AI_TOOLS.filter(tool => hasScope(auth, tool.permission));
  return {
    neutral: permitted.map(publicToolDefinition),
    anthropic: permitted.map(anthropicToolDefinition),
    openai: permitted.map(openAiToolDefinition),
    mcp: {
      note: 'Expose the neutral tool definitions through an MCP server by registering each name as a read-only tool and forwarding calls to POST /api/ai/tools.',
      tools: permitted.map(publicToolDefinition),
    },
  };
}

export function rawToolCount() {
  return AI_TOOLS.length;
}
