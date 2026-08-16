import { createKnowledgeAiProvider } from "./ai-provider.js";
import { cleanText } from "./text.js";
import { buildKnowledgeIngestionPrompt } from "../prompts/ingestion.js";

const ALLOWED_TYPES = new Set([
  "pricing_list",
  "product_catalog",
  "vendor_information",
  "customer_specific_agreement",
  "sponsorship_agreement",
  "policy",
  "sop",
  "contract",
  "sales_playbook",
  "product_guide",
  "general_company_knowledge",
  "unknown",
]);

const ALLOWED_CATEGORIES = new Set([
  "Pricing",
  "Product",
  "Vendor",
  "Brand",
  "Customer",
  "Policy",
  "SOP",
  "Sales",
  "Operations",
  "Finance",
  "Creative",
  "AI / Agent Instructions",
  "Other",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : [];
}

function confidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function cleanDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function normalizeRecord(record = {}) {
  return {
    record_type: String(record.record_type || "other"),
    confidence: confidence(record.confidence),
    source_row: record.source_row ?? null,
    fields: {
      brand: record.fields?.brand ?? null,
      vendor: record.fields?.vendor ?? null,
      sku: record.fields?.sku ?? null,
      style_number: record.fields?.style_number ?? null,
      product_name: record.fields?.product_name ?? null,
      category: record.fields?.category ?? null,
      msrp: record.fields?.msrp ?? null,
      map: record.fields?.map ?? null,
      wholesale_price: record.fields?.wholesale_price ?? null,
      dealer_price: record.fields?.dealer_price ?? null,
      st1_cost: record.fields?.st1_cost ?? null,
      discount: record.fields?.discount ?? null,
      effective_date: cleanDate(record.fields?.effective_date),
      expiration_date: cleanDate(record.fields?.expiration_date),
    },
    review_reason: record.review_reason || null,
  };
}

function normalizeAction(action = {}) {
  return {
    action: String(action.action || "no_action"),
    target: String(action.target || "none"),
    confidence: confidence(action.confidence),
    requires_review: true,
    rationale: action.rationale || "AI-proposed change requires human review.",
    payload: action.payload && typeof action.payload === "object" ? action.payload : {},
  };
}

function normalizeIngestionResult(raw = {}) {
  const detectedType = ALLOWED_TYPES.has(raw.detected_type) ? raw.detected_type : "unknown";
  const category = ALLOWED_CATEGORIES.has(raw.category) ? raw.category : "Other";
  const structuredRecords = asArray(raw.structured_records).map(normalizeRecord);
  const rowsNeedingReview = asArray(raw.rows_needing_review).map(item => ({
    source_row: item?.source_row ?? null,
    reason: item?.reason || "Needs human review",
    raw: item?.raw ?? null,
  }));

  const lowConfidenceRows = structuredRecords
    .filter(record => record.confidence > 0 && record.confidence < 0.7)
    .map(record => ({
      source_row: record.source_row,
      reason: record.review_reason || "Low confidence structured record",
      raw: record.fields,
    }));

  return {
    detected_type: detectedType,
    confidence: confidence(raw.confidence),
    summary: cleanText(raw.summary || ""),
    category,
    effective_date: cleanDate(raw.effective_date),
    expiration_date: cleanDate(raw.expiration_date),
    extracted_entities: {
      brands: asArray(raw.extracted_entities?.brands).map(String),
      vendors: asArray(raw.extracted_entities?.vendors).map(String),
      customers: asArray(raw.extracted_entities?.customers).map(String),
      products: asArray(raw.extracted_entities?.products).map(String),
    },
    important_rules: asArray(raw.important_rules).map(String),
    important_amounts_percentages: asArray(raw.important_amounts_percentages).map(String),
    structured_facts: asArray(raw.structured_facts).map(fact => ({
      fact_type: String(fact?.fact_type || "general"),
      fact: String(fact?.fact || ""),
      confidence: confidence(fact?.confidence),
      source_quote: fact?.source_quote || null,
    })).filter(fact => fact.fact),
    structured_records: structuredRecords,
    proposed_database_actions: asArray(raw.proposed_database_actions).map(normalizeAction),
    warnings: [...asArray(raw.warnings).map(String)],
    rows_needing_review: [...rowsNeedingReview, ...lowConfidenceRows],
  };
}

function sampleDocumentContent(document) {
  return cleanText(document.content || "").slice(0, 90000);
}

export async function runKnowledgeAiIngestion({ source, document }) {
  const provider = createKnowledgeAiProvider();
  const prompt = buildKnowledgeIngestionPrompt({
    source,
    document,
    contentSample: sampleDocumentContent(document),
  });

  console.info("[knowledge/ingestion] starting", {
    sourceId: source.id,
    documentId: document.id,
    sourceType: source.sourceType,
  });

  const raw = await provider.json({
    system: prompt.system,
    prompt: prompt.prompt,
    maxTokens: 9000,
  });
  const normalized = normalizeIngestionResult(raw);

  console.info("[knowledge/ingestion] complete", {
    sourceId: source.id,
    documentId: document.id,
    detectedType: normalized.detected_type,
    confidence: normalized.confidence,
    records: normalized.structured_records.length,
    warnings: normalized.warnings.length,
    reviewRows: normalized.rows_needing_review.length,
  });

  return normalized;
}
