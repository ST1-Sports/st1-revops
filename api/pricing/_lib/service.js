import { resolvePricingCore } from "./resolve-core.js";

function clean(value) {
  return String(value || "").trim();
}

function activeWindowWhere(date) {
  return {
    AND: [
      { OR: [{ effectiveDate: null }, { effectiveDate: { lte: date } }] },
      { OR: [{ expirationDate: null }, { expirationDate: { gte: date } }] },
    ],
  };
}

export async function getPricing(prisma, { sku, brand, customerId, programId, date } = {}) {
  const cleanSku = clean(sku);
  const cleanBrand = clean(brand);
  if (!cleanSku) throw new Error("sku is required");

  const asOf = date ? new Date(date) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error("date must be a valid date");

  const brandFilter = cleanBrand
    ? { OR: [{ brand: null }, { brand: { equals: cleanBrand, mode: "insensitive" } }] }
    : {};

  const [basePrices, customerOverrides, programAdjustments] = await Promise.all([
    prisma.productPricing.findMany({
      where: {
        sku: { equals: cleanSku, mode: "insensitive" },
        ...brandFilter,
        ...activeWindowWhere(asOf),
      },
      orderBy: [{ effectiveDate: "desc" }, { updatedAt: "desc" }],
      include: {
        product: true,
        source: { select: { id: true, title: true, sourceType: true, sourceUrl: true, originalFilename: true } },
      },
      take: 20,
    }),
    customerId ? prisma.customerPricingOverride.findMany({
      where: {
        customerId,
        sku: { equals: cleanSku, mode: "insensitive" },
        ...brandFilter,
        ...activeWindowWhere(asOf),
      },
      orderBy: [{ effectiveDate: "desc" }, { updatedAt: "desc" }],
      take: 10,
    }) : Promise.resolve([]),
    programId ? prisma.programPricingAdjustment.findMany({
      where: {
        programId,
        ...activeWindowWhere(asOf),
        AND: [
          activeWindowWhere(asOf),
          { OR: [{ sku: null }, { sku: { equals: cleanSku, mode: "insensitive" } }] },
          cleanBrand ? { OR: [{ brand: null }, { brand: { equals: cleanBrand, mode: "insensitive" } }] } : {},
          customerId ? { OR: [{ customerId: null }, { customerId }] } : {},
        ],
      },
      orderBy: [{ priority: "asc" }, { effectiveDate: "desc" }],
      take: 20,
    }) : Promise.resolve([]),
  ]);

  const result = resolvePricingCore({
    sku: cleanSku,
    brand: cleanBrand || undefined,
    basePrices: basePrices.map(row => ({
      ...row,
      sourceTitle: row.sourceTitle || row.source?.title || null,
    })),
    customerOverrides,
    programAdjustments,
    date: asOf,
  });

  return {
    ...result,
    asOf,
    matchedRecords: {
      basePrices: basePrices.length,
      customerOverrides: customerOverrides.length,
      programAdjustments: programAdjustments.length,
    },
  };
}
