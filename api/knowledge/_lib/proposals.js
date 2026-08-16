function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pickProposedPrice(fields = {}) {
  const candidates = [
    ["st1_cost", fields.st1_cost],
    ["dealer_price", fields.dealer_price],
    ["wholesale_price", fields.wholesale_price],
    ["map", fields.map],
    ["msrp", fields.msrp],
  ];
  for (const [field, value] of candidates) {
    const amount = parseMoney(value);
    if (amount !== null) return { field, amount, raw: value };
  }
  return { field: null, amount: null, raw: null };
}

function productSearchName(record) {
  const name = String(record?.fields?.product_name || "").trim();
  if (name.length < 4) return "";
  return name.slice(0, 80);
}

async function findExistingProduct(prisma, record) {
  const name = productSearchName(record);
  if (!name) return null;
  return prisma.product.findFirst({
    where: { name: { contains: name, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      price: true,
      regular_price: true,
      sale_price: true,
      brand: true,
    },
  }).catch(() => null);
}

function existingPrice(product) {
  if (!product) return null;
  return parseMoney(product.sale_price) ?? parseMoney(product.price) ?? parseMoney(product.regular_price);
}

function differencePct(existing, proposed) {
  if (!existing || !proposed) return null;
  return ((proposed - existing) / existing) * 100;
}

function actionLabel({ existing, proposedPrice, flags, confidence }) {
  if (flags.includes("uncertain_mapping") || flags.includes("missing_prices")) return "Needs Review";
  if (!existing) return "Add";
  if (!proposedPrice.amount) return "Needs Review";
  const diff = Math.abs(differencePct(existingPrice(existing), proposedPrice.amount) || 0);
  if (diff <= 0.5) return "No Change";
  if (confidence < 0.7) return "Needs Review";
  return "Update";
}

export async function enrichIngestionForReview(prisma, ingestion) {
  const records = Array.isArray(ingestion.structured_records) ? ingestion.structured_records : [];
  const skuCounts = records.reduce((acc, record) => {
    const sku = String(record?.fields?.sku || "").trim().toLowerCase();
    if (sku) acc[sku] = (acc[sku] || 0) + 1;
    return acc;
  }, {});

  const reviewTable = [];
  const warnings = new Set(Array.isArray(ingestion.warnings) ? ingestion.warnings : []);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const fields = record.fields || {};
    const sku = String(fields.sku || "").trim();
    const proposedPrice = pickProposedPrice(fields);
    const existing = await findExistingProduct(prisma, record);
    const existingAmount = existingPrice(existing);
    const diff = differencePct(existingAmount, proposedPrice.amount);
    const flags = [];

    if (!sku) flags.push("missing_sku");
    if (sku && skuCounts[sku.toLowerCase()] > 1) flags.push("duplicate_sku");
    if (sku && !existing) flags.push("new_sku");
    if (!proposedPrice.amount) flags.push("missing_prices");
    if ((record.confidence || 0) < 0.7) flags.push("uncertain_mapping");
    if (diff !== null && Math.abs(diff) > 10) flags.push("price_change_over_10_percent");

    flags.forEach(flag => warnings.add(`${flag.replace(/_/g, " ")} in row ${record.source_row || i + 1}`));

    const action = actionLabel({ existing, proposedPrice, flags, confidence: record.confidence || 0 });
    reviewTable.push({
      index: i,
      action,
      sku: sku || null,
      product: fields.product_name || null,
      existing_value: existing ? {
        productId: existing.id,
        productName: existing.name,
        brand: existing.brand,
        price: existingAmount,
      } : null,
      proposed_value: proposedPrice.amount !== null ? {
        field: proposedPrice.field,
        amount: proposedPrice.amount,
        raw: proposedPrice.raw,
      } : null,
      difference: diff,
      status: flags.length ? "Needs Review" : "Ready",
      flags,
      source_row: record.source_row || null,
      confidence: record.confidence || 0,
      fields,
    });
  }

  const proposedActions = reviewTable.map(row => ({
    action: row.action === "No Change" ? "no_action" : row.action === "Add" ? "create" : row.action === "Update" ? "update" : "no_action",
    target: row.action === "No Change" ? "none" : "knowledge_structured_record",
    confidence: row.confidence,
    requires_review: true,
    rationale: row.flags.length ? `Requires review: ${row.flags.join(", ")}` : `${row.action} structured knowledge record`,
    payload: row,
  }));

  return {
    ...ingestion,
    review_table: reviewTable,
    proposed_database_actions: [
      ...(Array.isArray(ingestion.proposed_database_actions) ? ingestion.proposed_database_actions : []),
      ...proposedActions,
    ],
    warnings: Array.from(warnings),
  };
}
