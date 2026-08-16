import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { chunkText } from "./_lib/text.js";
import { processKnowledgeDocument } from "./_lib/ai.js";

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 120,
};

function knowledgeCors(res, methods = "POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

async function ensureChunks(document) {
  const count = await prisma.knowledgeChunk.count({ where: { documentId: document.id } });
  if (count > 0) return;
  const chunks = chunkText(document.rawText);
  if (!chunks.length) return;
  await prisma.knowledgeChunk.createMany({
    data: chunks.map(chunk => ({ documentId: document.id, ...chunk })),
  });
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const actor = requireKnowledgeActor(req, res);
  if (!actor) return;

  try {
    const { documentId, limit = 3 } = req.body || {};
    if (documentId) {
      const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
      if (!document) return res.status(404).json({ error: "Knowledge document not found" });
      await ensureChunks(document);
      const processed = await processKnowledgeDocument(prisma, documentId, actor);
      return res.json({ processed: [processed] });
    }

    const pending = await prisma.knowledgeDocument.findMany({
      where: { status: { in: ["INGESTED", "ERROR"] } },
      orderBy: { createdAt: "asc" },
      take: Math.min(Number(limit) || 3, 10),
    });

    const processed = [];
    const errors = [];
    for (const document of pending) {
      try {
        await ensureChunks(document);
        processed.push(await processKnowledgeDocument(prisma, document.id, actor));
      } catch (error) {
        errors.push({ documentId: document.id, error: error.message });
      }
    }

    return res.json({ processed, errors });
  } catch (error) {
    console.error("[knowledge/process] error:", error);
    return res.status(500).json({ error: error.message });
  }
}
