import { getPricing as resolvePricing } from "../../pricing/_lib/service.js";

function asOfDate(date) {
  return date || new Date();
}

function currentDocumentWhere(date) {
  const asOf = asOfDate(date);
  return {
    status: "APPROVED",
    source: { status: "APPROVED" },
    AND: [
      { OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOf } }] },
      { OR: [{ expirationDate: null }, { expirationDate: { gte: asOf } }] },
    ],
  };
}

function sourceInfo(source) {
  if (!source) return null;
  return {
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    originalFilename: source.originalFilename,
    uploadedBy: source.uploadedBy,
    processedAt: source.processedAt,
  };
}

function documentResponse(document, includeContent = false) {
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    summary: document.summary,
    status: document.status,
    owner: document.owner,
    effectiveDate: document.effectiveDate,
    expirationDate: document.expirationDate,
    source: sourceInfo(document.source),
    ...(includeContent ? { content: document.content } : {}),
  };
}

function structuredRecordResponse(record) {
  return {
    id: record.id,
    recordType: record.recordType,
    action: record.action,
    fields: record.fields,
    existingValue: record.existingValue,
    proposedValue: record.proposedValue,
    difference: record.difference,
    flags: record.flags,
    confidence: record.confidence,
    approvedAt: record.approvedAt,
    source: sourceInfo(record.source),
  };
}

export async function searchKnowledge(prisma, { query, category, date, limit = 20 }) {
  const q = String(query || "").trim();
  if (!q) {
    const error = new Error("query is required");
    error.statusCode = 400;
    throw error;
  }

  const where = {
    ...currentDocumentWhere(date),
    ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
    ],
  };

  const documents = await prisma.knowledgeDocument.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { source: true, _count: { select: { chunks: true } } },
  });

  return {
    query: q,
    results: documents.map(document => ({
      ...documentResponse(document),
      chunkCount: document._count?.chunks || 0,
    })),
  };
}

export async function getDocument(prisma, { id, date, includeContent = true }) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id, ...currentDocumentWhere(date) },
    include: {
      source: true,
      chunks: { orderBy: { chunkIndex: "asc" }, take: 20 },
    },
  });
  if (!document) {
    const error = new Error("Approved/current document not found");
    error.statusCode = 404;
    throw error;
  }
  return {
    document: {
      ...documentResponse(document, includeContent),
      chunks: document.chunks.map(chunk => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        content: includeContent ? chunk.content : undefined,
        metadata: chunk.metadata,
      })),
    },
  };
}

export async function getPolicy(prisma, { title, date }) {
  const where = {
    ...currentDocumentWhere(date),
    category: { equals: "Policy", mode: "insensitive" },
    ...(title ? { title: { contains: title, mode: "insensitive" } } : {}),
  };
  const document = await prisma.knowledgeDocument.findFirst({
    where,
    orderBy: [{ effectiveDate: "desc" }, { updatedAt: "desc" }],
    include: { source: true },
  });
  if (!document) {
    const error = new Error("Approved/current policy not found");
    error.statusCode = 404;
    throw error;
  }
  return { policy: documentResponse(document, true) };
}

export async function getPricing(prisma, input) {
  return { pricing: await resolvePricing(prisma, input) };
}

export async function getProduct(prisma, { id, sku, brand, date }) {
  let product = null;
  let pricing = null;

  if (id) {
    const productId = Number(id);
    if (!Number.isInteger(productId)) {
      const error = new Error("id must be a numeric Product id");
      error.statusCode = 400;
      throw error;
    }
    product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        pricingRecords: {
          where: {
            AND: [
              { OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOfDate(date) } }] },
              { OR: [{ expirationDate: null }, { expirationDate: { gte: asOfDate(date) } }] },
            ],
          },
          orderBy: [{ effectiveDate: "desc" }, { updatedAt: "desc" }],
          take: 5,
          include: { source: true },
        },
      },
    });
  }

  if (!product && sku) {
    pricing = await resolvePricing(prisma, { sku, brand, date });
    product = pricing.product;
  }

  if (!id && !sku) {
    const error = new Error("Product lookup requires id or sku");
    error.statusCode = 400;
    throw error;
  }
  if (id && !product && !pricing) {
    const error = new Error("Product not found");
    error.statusCode = 404;
    throw error;
  }
  if (sku && !product && pricing?.confidence === 0) {
    const error = new Error("Product not found for SKU");
    error.statusCode = 404;
    throw error;
  }
  if (!product && pricing?.sku) {
    return {
      product: {
        id: null,
        name: pricing.product?.name || null,
        sku: pricing.sku,
        brand: pricing.brand,
        pricing,
        source: pricing.source,
      },
    };
  }
  if (!product) {
    const error = new Error("Product not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      price: product.price,
      regularPrice: product.regular_price,
      salePrice: product.sale_price,
      stockStatus: product.stock_status,
      imageUrl: product.main_image_url,
      source: product.permalink ? { type: "WooCommerce", url: product.permalink } : null,
      pricingRecords: (product.pricingRecords || []).map(record => ({
        id: record.id,
        sku: record.sku,
        brand: record.brand,
        st1Cost: record.st1Cost,
        dealerCost: record.dealerCost,
        wholesaleCost: record.wholesaleCost,
        effectiveDate: record.effectiveDate,
        expirationDate: record.expirationDate,
        source: sourceInfo(record.source) || { title: record.sourceTitle },
      })),
      ...(pricing ? { pricing } : {}),
    },
  };
}

async function getEntityKnowledge(prisma, { entityType, name, date, limit = 10 }) {
  const q = String(name || "").trim();
  if (!q) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }

  const categoryMap = {
    vendor: "Vendor",
    brand: "Brand",
    customer: "Customer",
  };
  const category = categoryMap[entityType];
  const textMatch = {
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
    ],
  };

  const [documents, records] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: {
        ...currentDocumentWhere(date),
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
        ...textMatch,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { source: true },
    }),
    prisma.knowledgeStructuredRecord.findMany({
      where: {
        status: "APPROVED",
        source: { status: "APPROVED" },
        OR: [
          { recordType: { contains: entityType, mode: "insensitive" } },
          { fields: { path: [entityType], string_contains: q } },
          { fields: { path: [`${entityType}_name`], string_contains: q } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { source: true },
    }).catch(() => []),
  ]);

  return {
    [entityType]: {
      name: q,
      documents: documents.map(document => documentResponse(document)),
      records: records.map(structuredRecordResponse),
      sourceCount: documents.length + records.length,
    },
  };
}

export function getVendor(prisma, input) {
  return getEntityKnowledge(prisma, { ...input, entityType: "vendor" });
}

export function getBrand(prisma, input) {
  return getEntityKnowledge(prisma, { ...input, entityType: "brand" });
}

export function getCustomer(prisma, input) {
  return getEntityKnowledge(prisma, { ...input, entityType: "customer" });
}
