export const KNOWLEDGE_INGESTION_SCHEMA = {
  detected_type: "pricing_list | product_catalog | vendor_information | customer_specific_agreement | sponsorship_agreement | policy | sop | contract | sales_playbook | product_guide | general_company_knowledge | unknown",
  confidence: "number between 0 and 1",
  summary: "short operational summary",
  category: "Pricing | Product | Vendor | Brand | Customer | Policy | SOP | Sales | Operations | Finance | Creative | AI / Agent Instructions | Other",
  effective_date: "YYYY-MM-DD or null",
  expiration_date: "YYYY-MM-DD or null",
  extracted_entities: {
    brands: ["names only, do not invent"],
    vendors: ["names only, do not invent"],
    customers: ["names only, do not invent"],
    products: ["names only, do not invent"],
  },
  important_rules: ["clear rules or obligations"],
  important_amounts_percentages: ["amounts, prices, discounts, percentages exactly as written"],
  structured_facts: [
    {
      fact_type: "short snake_case type",
      fact: "fact exactly supported by source",
      confidence: "number between 0 and 1",
      source_quote: "supporting quote or null",
    },
  ],
  structured_records: [
    {
      record_type: "pricing_row | product | vendor | customer | agreement_term | rule | other",
      confidence: "number between 0 and 1",
      source_row: "row number, sheet name, page, or null",
      fields: {
        brand: "string or null",
        vendor: "string or null",
        sku: "string or null",
        style_number: "string or null",
        product_name: "string or null",
        category: "string or null",
        msrp: "number/string or null",
        map: "number/string or null",
        wholesale_price: "number/string or null",
        dealer_price: "number/string or null",
        st1_cost: "number/string or null",
        discount: "number/string or null",
        effective_date: "YYYY-MM-DD or null",
        expiration_date: "YYYY-MM-DD or null",
      },
      review_reason: "why review is needed, or null",
    },
  ],
  proposed_database_actions: [
    {
      action: "create | update | link | no_action",
      target: "knowledge_document | product | vendor | brand | customer | pricing | existing_table | none",
      confidence: "number between 0 and 1",
      requires_review: true,
      rationale: "why this is proposed",
      payload: "object with proposed values only",
    },
  ],
  warnings: ["unclear columns, low confidence, missing dates, conflicting values"],
  rows_needing_review: [
    {
      source_row: "row number, sheet name, page, or null",
      reason: "what is unclear",
      raw: "raw value or row excerpt",
    },
  ],
}

const TYPE_LIST = [
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
].join(", ");

const CATEGORY_LIST = [
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
].join(", ");

export function buildKnowledgeIngestionPrompt({ source, document, contentSample }) {
  return {
    system: `You are the ST1 Sports Knowledge ingestion engine.

Your job is to understand incoming internal information and propose structured changes for human review.

Critical rules:
- Never invent SKUs, prices, dates, customers, vendors, agreements, discounts, percentages, or product attributes.
- If a value is unclear, null it and add a warning or rows_needing_review item.
- Proposed database actions are proposals only. They must always include requires_review=true.
- Do not overwrite or commit important business data.
- Return ONLY valid JSON. No markdown. No explanation.`,

    prompt: `Analyze this ST1 Knowledge source.

Allowed detected_type values:
${TYPE_LIST}

Allowed category values:
${CATEGORY_LIST}

Source metadata:
- source_id: ${source.id}
- source_title: ${source.title}
- source_type: ${source.sourceType}
- source_url: ${source.sourceUrl || "n/a"}
- original_filename: ${source.originalFilename || "n/a"}

Current document metadata:
- document_id: ${document.id}
- title: ${document.title}
- category: ${document.category || "n/a"}

Return JSON matching this schema:
${JSON.stringify(KNOWLEDGE_INGESTION_SCHEMA, null, 2)}

Spreadsheet guidance:
- Inspect headers and row patterns.
- Try to identify brand, vendor, SKU, style number, product name, category, MSRP, MAP, wholesale price, dealer price, ST1 cost, discount, effective date, expiration date.
- Do not assume a column meaning if confidence is low. Put unclear rows/columns in rows_needing_review.

Document guidance:
- Extract title, summary, category, dates, brands, vendors, customers, rules, amounts/percentages, structured facts, and full searchable concepts.

Content:
${contentSample}`,
  };
}
