import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { factDataFromExtraction } from "./_lib/ai.js";

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
};

function knowledgeCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

async function updateDocumentReviewStatus(documentId) {
  const [pending, approved, rejected] = await Promise.all([
    prisma.knowledgeExtraction.count({ where: { documentId, status: "PENDING" } }),
    prisma.knowledgeExtraction.count({ where: { documentId, status: "APPROVED" } }),
    prisma.knowledgeExtraction.count({ where: { documentId, status: "REJECTED" } }),
  ]);
  if (pending > 0) return;
  if (approved > 0) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "APPROVED", reviewedAt: new Date() },
    });
  } else if (rejected > 0) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });
  }
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = requireKnowledgeActor(req, res);
  if (!actor) return;

  if (req.method === "GET") {
    try {
      const { status = "PENDING", limit = "100" } = req.query || {};
      const extractions = await prisma.knowledgeExtraction.findMany({
        where: { status: String(status).toUpperCase() },
        orderBy: { createdAt: "desc" },
        take: Math.min(parseInt(limit, 10) || 100, 200),
        include: {
          document: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              sourceUrl: true,
              fileName: true,
              summary: true,
              createdAt: true,
            },
          },
        },
      });
      return res.json({ extractions });
    } catch (error) {
      console.error("[knowledge/review] list error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { extractionId, action, edits = {}, note, userId } = req.body || {};
      if (!extractionId) return res.status(400).json({ error: "extractionId is required" });
      if (!["approve", "reject", "update"].includes(action)) {
        return res.status(400).json({ error: "action must be approve, reject, or update" });
      }

      const extraction = await prisma.knowledgeExtraction.findUnique({
        where: { id: extractionId },
        include: {
          document: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } },
        },
      });
      if (!extraction) return res.status(404).json({ error: "Knowledge extraction not found" });

      const reviewer = actor.userId || userId || null;
      const before = {
        entityType: extraction.entityType,
        entityName: extraction.entityName,
        factType: extraction.factType,
        payload: extraction.payload,
        status: extraction.status,
      };

      if (action === "update") {
        const payload = { ...(extraction.payload || {}), ...(edits.payload || {}) };
        const updated = await prisma.knowledgeExtraction.update({
          where: { id: extractionId },
          data: {
            entityType: edits.entityType || extraction.entityType,
            entityName: edits.entityName !== undefined ? edits.entityName : extraction.entityName,
            factType: edits.factType !== undefined ? edits.factType : extraction.factType,
            confidence: edits.confidence !== undefined ? Number(edits.confidence) : extraction.confidence,
            payload: {
              ...payload,
              ...(edits.value !== undefined ? { value: edits.value } : {}),
              ...(edits.sourceQuote !== undefined ? { sourceQuote: edits.sourceQuote } : {}),
            },
            reviewNotes: note || extraction.reviewNotes,
          },
        });
        await prisma.knowledgeReviewEvent.create({
          data: {
            documentId: extraction.documentId,
            extractionId,
            action: "EXTRACTION_UPDATED",
            userId: reviewer,
            note: note || null,
            before,
            after: {
              entityType: updated.entityType,
              entityName: updated.entityName,
              factType: updated.factType,
              payload: updated.payload,
              confidence: updated.confidence,
            },
          },
        });
        return res.json({ extraction: updated });
      }

      if (action === "reject") {
        const rejected = await prisma.knowledgeExtraction.update({
          where: { id: extractionId },
          data: {
            status: "REJECTED",
            reviewedByUserId: reviewer,
            reviewedAt: new Date(),
            reviewNotes: note || null,
          },
        });
        await prisma.knowledgeReviewEvent.create({
          data: {
            documentId: extraction.documentId,
            extractionId,
            action: "EXTRACTION_REJECTED",
            userId: reviewer,
            note: note || null,
            before,
            after: { status: "REJECTED" },
          },
        });
        await updateDocumentReviewStatus(extraction.documentId);
        return res.json({ extraction: rejected });
      }

      const factData = factDataFromExtraction(extraction, edits, extraction.document.chunks || []);
      const [approved, fact] = await prisma.$transaction([
        prisma.knowledgeExtraction.update({
          where: { id: extractionId },
          data: {
            entityType: factData.entityType,
            entityName: factData.entityName,
            factType: factData.factType,
            payload: {
              ...factData.payload,
              value: factData.value ?? {},
              sourceQuote: factData.sourceQuote || "",
            },
            confidence: Number.isFinite(factData.confidence) ? factData.confidence : null,
            status: "APPROVED",
            reviewedByUserId: reviewer,
            reviewedAt: new Date(),
            reviewNotes: note || null,
          },
        }),
        prisma.knowledgeFact.create({
          data: {
            documentId: extraction.documentId,
            chunkId: factData.chunkId,
            extractionId,
            entityType: factData.entityType,
            entityName: factData.entityName || "Unknown",
            factType: factData.factType || "general",
            value: factData.value ?? {},
            sourceQuote: factData.sourceQuote || null,
            confidence: Number.isFinite(factData.confidence) ? factData.confidence : null,
            metadata: { approvedFromExtractionId: extractionId },
          },
        }),
      ]);

      await prisma.knowledgeReviewEvent.create({
        data: {
          documentId: extraction.documentId,
          extractionId,
          action: "EXTRACTION_APPROVED",
          userId: reviewer,
          note: note || null,
          before,
          after: { factId: fact.id, status: "APPROVED" },
        },
      });
      await prisma.knowledgeDocument.update({
        where: { id: extraction.documentId },
        data: { reviewedByUserId: reviewer, reviewedAt: new Date() },
      });
      await updateDocumentReviewStatus(extraction.documentId);

      return res.json({ extraction: approved, fact });
    } catch (error) {
      console.error("[knowledge/review] action error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
