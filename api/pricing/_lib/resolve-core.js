export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value?.toNumber === "function") return value.toNumber();
  const n = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function isActive(record, dateInput = new Date()) {
  const date = normalizeDate(dateInput);
  const start = record.effectiveDate ? normalizeDate(record.effectiveDate) : null;
  const end = record.expirationDate ? normalizeDate(record.expirationDate) : null;
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

export function selectCurrentBasePrice(records = [], dateInput = new Date()) {
  const active = records.filter(record => isActive(record, dateInput));
  return active.sort((a, b) => {
    const aDate = a.effectiveDate ? normalizeDate(a.effectiveDate).getTime() : 0;
    const bDate = b.effectiveDate ? normalizeDate(b.effectiveDate).getTime() : 0;
    if (aDate !== bDate) return bDate - aDate;
    return normalizeDate(b.updatedAt || b.createdAt || 0) - normalizeDate(a.updatedAt || a.createdAt || 0);
  })[0] || null;
}

export function baseCostFromPrice(price) {
  if (!price) return null;
  return toNumber(price.st1Cost)
    ?? toNumber(price.dealerCost)
    ?? toNumber(price.wholesaleCost);
}

export function msrpFromPrice(price) {
  return toNumber(price?.msrp) ?? toNumber(price?.map) ?? null;
}

function percentToRate(value) {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.abs(n) <= 1 ? n : n / 100;
}

export function applyAdjustment(currentCost, adjustment) {
  const amount = toNumber(adjustment.amount ?? adjustment.discountPct ?? adjustment.overrideCost);
  const type = adjustment.adjustmentType;
  if (currentCost === null && type !== "FIXED_PRICE") return { cost: currentCost, appliedAmount: null };

  if (type === "FIXED_PRICE") {
    return { cost: amount, appliedAmount: amount };
  }
  if (type === "PERCENT_DISCOUNT" || adjustment.discountPct !== undefined) {
    const rate = percentToRate(adjustment.discountPct ?? adjustment.amount);
    const next = currentCost * (1 - rate);
    return { cost: next, appliedAmount: currentCost - next };
  }
  if (type === "AMOUNT_DISCOUNT" || type === "REBATE" || type === "SPONSORSHIP") {
    const next = currentCost - (amount || 0);
    return { cost: next, appliedAmount: amount || 0 };
  }
  if (type === "MARKUP_PERCENT") {
    const rate = percentToRate(adjustment.amount);
    const next = currentCost * (1 + rate);
    return { cost: next, appliedAmount: next - currentCost };
  }
  if (type === "MARKUP_AMOUNT") {
    const next = currentCost + (amount || 0);
    return { cost: next, appliedAmount: amount || 0 };
  }
  return { cost: currentCost, appliedAmount: null };
}

export function resolvePricingCore({ sku, brand, basePrices = [], customerOverrides = [], programAdjustments = [], date = new Date() }) {
  const asOf = normalizeDate(date);
  const basePrice = selectCurrentBasePrice(basePrices, asOf);
  const baseCost = baseCostFromPrice(basePrice);
  const adjustments = [];
  const explanation = [];

  if (!basePrice) {
    return {
      product: null,
      sku,
      brand,
      msrp: null,
      baseCost: null,
      adjustments,
      finalCost: null,
      effectiveDate: null,
      expirationDate: null,
      source: null,
      confidence: 0,
      explanation: ["No active base pricing record matched the request."],
    };
  }

  let finalCost = baseCost;
  explanation.push(`Base price selected from ${basePrice.sourceTitle || basePrice.sourceId || "pricing table"} with effective date ${basePrice.effectiveDate || "unspecified"}.`);

  const activeOverrides = customerOverrides.filter(override => isActive(override, asOf));
  const override = activeOverrides[0] || null;
  if (override) {
    const before = finalCost;
    if (override.overrideCost !== null && override.overrideCost !== undefined) {
      finalCost = toNumber(override.overrideCost);
      adjustments.push({
        type: "CUSTOMER_OVERRIDE",
        adjustmentType: "FIXED_PRICE",
        before,
        after: finalCost,
        source: override.sourceTitle || override.sourceId || null,
        reason: override.notes || "Customer-specific override",
      });
      explanation.push(`Customer override set cost to ${finalCost}.`);
    } else if (override.discountPct !== null && override.discountPct !== undefined && finalCost !== null) {
      const result = applyAdjustment(finalCost, override);
      finalCost = result.cost;
      adjustments.push({
        type: "CUSTOMER_OVERRIDE",
        adjustmentType: "PERCENT_DISCOUNT",
        before,
        after: finalCost,
        appliedAmount: result.appliedAmount,
        source: override.sourceTitle || override.sourceId || null,
        reason: override.notes || "Customer-specific discount",
      });
      explanation.push(`Customer override applied ${override.discountPct}% discount.`);
    }
  }

  const activeProgramAdjustments = programAdjustments
    .filter(adjustment => isActive(adjustment, asOf))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const adjustment of activeProgramAdjustments) {
    const before = finalCost;
    const result = applyAdjustment(finalCost, adjustment);
    finalCost = result.cost;
    adjustments.push({
      type: "PROGRAM_ADJUSTMENT",
      programId: adjustment.programId,
      programName: adjustment.programName || null,
      adjustmentType: adjustment.adjustmentType,
      amount: toNumber(adjustment.amount),
      before,
      after: finalCost,
      appliedAmount: result.appliedAmount,
      source: adjustment.sourceTitle || adjustment.sourceId || null,
      reason: adjustment.notes || "Program adjustment",
    });
    explanation.push(`Program ${adjustment.programName || adjustment.programId} applied ${adjustment.adjustmentType}.`);
  }

  return {
    product: basePrice.product || null,
    sku: basePrice.sku || sku,
    brand: basePrice.brand || brand || null,
    msrp: msrpFromPrice(basePrice),
    baseCost,
    adjustments,
    finalCost,
    effectiveDate: basePrice.effectiveDate || null,
    expirationDate: basePrice.expirationDate || null,
    source: {
      sourceId: basePrice.sourceId || null,
      sourceTitle: basePrice.sourceTitle || null,
    },
    confidence: basePrice.confidence ?? 1,
    explanation,
  };
}
