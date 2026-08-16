import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { chunkText, cleanText, decodeBase64Text, fetchUrlText, normalizeSourceType, sha256 } from "./_lib/text.js";
import { processKnowledgeDocument } from "./_lib/ai.js";

export const config = {
  api: { bodyParser: { sizeLimit: "24mb" } },
  maxDuration: 120,
};

function knowledgeCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

async function createChunks(documentId, rawText) {
  const chunks = chunkText(rawText);
  if (!chunks.length) return [];
  await prisma.knowledgeChunk.createMany({
    data: chunks.map(chunk => ({ documentId, ...chunk })),
  });
  return chunks;
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = requireKnowledgeActor(req, res);
  if (!actor) return;

  if (req.method === "GET") {
    try {
      const { status, q, limit = "30" } = req.query || {};
      const where = {};
      if (status) where.status = String(status).toUpperCase();
      if (q) {
        where.OR = [
          { title: { contains: String(q), mode: "insensitive" } },
          { rawText: { contains: String(q), mode: "insensitive" } },
          { summary: { contains: String(q), mode: "insensitive" } },
        ];
      }

      const documents = await prisma.knowledgeDocument.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: Math.min(parseInt(limit, 10) || 30, 100),
        select: {
          id: true,
          title: true,
          sourceType: true,
          sourceUrl: true,
          fileName: true,
          mimeType: true,
          summary: true,
          status: true,
          error: true,
          createdByUserId: true,
          reviewedByUserId: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { chunks: true, extractions: true, facts: true } },
        },
      });
      return res.json({ documents });
    } catch (error) {
      console.error("[knowledge] list error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const sourceType = normalizeSourceType(body.sourceType);
      let rawText = cleanText(body.rawText || body.text || body.content || "");
      let contentType = body.mimeType || null;

      if (sourceType === "URL") {
        const fetched = await fetchUrlText(body.sourceUrl);
        rawText = fetched.text;
        contentType = fetched.contentType || contentType;
      } else if (!rawText && body.fileBase64) {
        rawText = decodeBase64Text(body.fileBase64);
      }

      if (!rawText) {
        return res.status(400).json({ error: "text, rawText, fileBase64, or a fetchable sourceUrl is required" });
      }

      const textHash = sha256(`${sourceType}:${body.sourceUrl || body.fileName || ""}:${rawText}`);
      const duplicate = await prisma.knowledgeDocument.findUnique({
        where: { sha256: textHash },
        include: {
          chunks: true,
          extractions: { orderBy: { createdAt: "desc" } },
          facts: true,
        },
      }).catch(() => null);
      if (duplicate) {
        return res.status(200).json({ duplicate: true, document: duplicate });
      }

      const title = cleanText(body.title)
        || cleanText(body.fileName)
        || cleanText(body.sourceUrl)
        || `Knowledge ${new Date().toISOString().slice(0, 10)}`;

      const document = await prisma.knowledgeDocument.create({
        data: {
          title: title.slice(0, 240),
          sourceType,
          sourceUrl: body.sourceUrl || null,
          fileName: body.fileName || null,
          mimeType: contentType || null,
          sha256: textHash,
          rawText,
          status: "INGESTED",
          metadata: {
            originalCharLength: rawText.length,
            uploadSize: body.uploadSize || null,
            clientMimeType: body.mimeType || null,
          },
          createdByUserId: actor.userId || body.userId || null,
        },
      });
      await createChunks(document.id, rawText);
      await prisma.knowledgeReviewEvent.create({
        data: {
          documentId: document.id,
          action: "INGESTED",
          userId: actor.userId || body.userId || null,
          after: { sourceType, title: document.title },
        },
      });

      if (body.processNow === false) {
        const withChildren = await prisma.knowledgeDocument.findUnique({
          where: { id: document.id },
          include: { chunks: true, extractions: true, facts: true },
        });
        return res.status(201).json({ document: withChildren });
      }

      try {
        const processed = await processKnowledgeDocument(prisma, document.id, actor);
        return res.status(201).json({ document: processed });
      } catch (processingError) {
        const errored = await prisma.knowledgeDocument.findUnique({
          where: { id: document.id },
          include: { chunks: true, extractions: true, facts: true },
        });
        return res.status(201).json({ document: errored, processingError: processingError.message });
      }
    } catch (error) {
      console.error("[knowledge] ingest error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
