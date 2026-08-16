import { findBestChunk } from "./text.js";

const MODEL = process.env.KNOWLEDGE_ANTHROPIC_MODEL || "claude-sonnet-4-6";

function extractText(data) {
  return (data?.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");
}

export function parseJsonLoose(raw) {
  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try { return JSON.parse(text); } catch {}

  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(text.slice(objStart, objEnd + 1)); } catch {}
  }

  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch {}
  }

  return null;
}

async function callAnthropic(body) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_KEY not configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Anthropic returned non-JSON: ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic ${response.status}`);
  }
  return extractText(data);
}

export async function callKnowledgeJson(prompt, maxTokens = 5000) {
  const raw = await callAnthropic({
    model: MODEL,
    max_tokens: maxTokens,
    system: "You extract internal ST1 Sports knowledge. Return ONLY valid JSON. No markdown fences, no commentary.",
    messages: [{ role: "user", content: prompt }],
  });
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error("Claude did not return valid JSON");
  return parsed;
}

function normalizeExtraction(item) {
  const entityType = String(item.entityType || item.type || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const entityName = String(item.entityName || item.name || item.vendor || item.brand || item.product || "Unknown").trim();
  const factType = String(item.factType || item.field || item.category || "general").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const confidence = Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : null;
  return {
    entityType: entityType || "other",
    entityName: entityName || "Unknown",
    factType: factType || "general",
    confidence,
    payload: {
      value: item.value ?? item.fact ?? item.details ?? item,
      sourceQuote: item.sourceQuote || item.quote || "",
      notes: item.notes || "",
      raw: item,
    },
  };
}

export async function processKnowledgeDocument(prisma, documentId, actor = {}) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
  });
  if (!document) throw new Error("Knowledge document not found");

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: "PROCESSING", error: null },
  });

  const chunks = document.chunks?.length ? document.chunks : [];
  const context = chunks.slice(0, 16)
    .map(chunk => `--- CHUNK ${chunk.chunkIndex} (${chunk.id}) ---\n${chunk.content}`)
    .join("\n\n")
    .slice(0, 60000);

  const prompt = `Analyze this internal ST1 Sports knowledge source and extract practical facts for Rev Ops and future AI agents.

Source title: ${document.title}
Source type: ${document.sourceType}
Source URL: ${document.sourceUrl || "n/a"}

Return JSON in this exact shape:
{
  "summary": "2-4 sentence operational summary",
  "extractions": [
    {
      "entityType": "product | brand | vendor | supplier | customer | pricing | competitor | policy | sales_process | other",
      "entityName": "specific entity name",
      "factType": "short_snake_case_fact_type",
      "value": {"structured": "data or text"},
      "sourceQuote": "short quote from the source supporting this fact",
      "confidence": 0.0
    }
  ]
}

Rules:
- Extract only facts supported by the source.
- Prefer concrete product, vendor, pricing, customer, competitor, policy, and sales-process facts.
- Do not invent missing values.
- Keep each extraction atomic enough for human review.
- Include sourceQuote for every extraction when possible.

SOURCE TEXT:
${context || document.rawText.slice(0, 60000)}`;

  try {
    const parsed = await callKnowledgeJson(prompt, 7000);
    const normalized = Array.isArray(parsed.extractions)
      ? parsed.extractions.map(normalizeExtraction).slice(0, 80)
      : [];

    await prisma.knowledgeExtraction.deleteMany({
      where: { documentId, status: "PENDING" },
    });

    for (const extraction of normalized) {
      await prisma.knowledgeExtraction.create({
        data: {
          documentId,
          entityType: extraction.entityType,
          entityName: extraction.entityName,
          factType: extraction.factType,
          confidence: extraction.confidence,
          payload: extraction.payload,
        },
      });
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        summary: parsed.summary || null,
        status: normalized.length ? "NEEDS_REVIEW" : "APPROVED",
        error: null,
      },
      include: {
        chunks: true,
        extractions: { orderBy: { createdAt: "desc" } },
        facts: true,
      },
    });

    await prisma.knowledgeReviewEvent.create({
      data: {
        documentId,
        action: "AI_PROCESSED",
        userId: actor.userId || null,
        after: { extractionCount: normalized.length },
      },
    });

    return updated;
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "ERROR", error: error.message },
    });
    throw error;
  }
}

export async function answerFromKnowledge(query, contextItems) {
  const context = contextItems.map((item, idx) => {
    const label = `[${idx + 1}] document=${item.documentId || item.document?.id || ""} chunk=${item.id || item.chunkId || ""} title=${item.document?.title || item.title || ""}`;
    return `${label}\n${item.content || item.sourceQuote || JSON.stringify(item.value || item.payload || {})}`;
  }).join("\n\n").slice(0, 55000);

  const prompt = `Answer the user's question using only the ST1 Knowledge context below.

Return JSON:
{
  "answer": "concise answer",
  "citations": [{"ref": 1, "reason": "why this source supports the answer"}]
}

If the context does not answer the question, say that clearly.

Question: ${query}

Knowledge context:
${context}`;

  return callKnowledgeJson(prompt, 3000);
}

export function factDataFromExtraction(extraction, edits = {}, chunks = []) {
  const payload = {
    ...(extraction.payload || {}),
    ...(edits.payload || {}),
  };
  const merged = {
    entityType: edits.entityType || extraction.entityType || "other",
    entityName: edits.entityName || extraction.entityName || "Unknown",
    factType: edits.factType || extraction.factType || "general",
    value: edits.value !== undefined ? edits.value : payload.value,
    sourceQuote: edits.sourceQuote !== undefined ? edits.sourceQuote : payload.sourceQuote,
    confidence: edits.confidence !== undefined ? Number(edits.confidence) : extraction.confidence,
  };
  const chunk = findBestChunk(chunks, merged);
  return { ...merged, chunkId: chunk?.id || null, payload };
}
