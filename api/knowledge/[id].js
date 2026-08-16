import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
};

function knowledgeCors(res, methods = "GET, PATCH, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = requireKnowledgeActor(req, res);
  if (!actor) return;

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: "Document id is required" });

  if (req.method === "GET") {
    try {
      const document = await prisma.knowledgeDocument.findUnique({
        where: { id },
        include: {
          chunks: { orderBy: { chunkIndex: "asc" } },
          extractions: { orderBy: { createdAt: "desc" } },
          facts: { orderBy: { createdAt: "desc" } },
          reviewEvents: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      });
      if (!document) return res.status(404).json({ error: "Knowledge document not found" });
      return res.json({ document });
    } catch (error) {
      console.error("[knowledge/:id] get error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const data = {};
      if (body.title !== undefined) data.title = String(body.title || "").slice(0, 240);
      if (body.summary !== undefined) data.summary = body.summary || null;
      if (body.status !== undefined) data.status = String(body.status || "").toUpperCase();
      if (body.metadata !== undefined) data.metadata = body.metadata || {};

      const before = await prisma.knowledgeDocument.findUnique({ where: { id } });
      if (!before) return res.status(404).json({ error: "Knowledge document not found" });

      const document = await prisma.knowledgeDocument.update({
        where: { id },
        data,
        include: {
          chunks: { orderBy: { chunkIndex: "asc" } },
          extractions: { orderBy: { createdAt: "desc" } },
          facts: { orderBy: { createdAt: "desc" } },
        },
      });

      await prisma.knowledgeReviewEvent.create({
        data: {
          documentId: id,
          action: "DOCUMENT_UPDATED",
          userId: actor.userId || body.userId || null,
          before: { title: before.title, summary: before.summary, status: before.status },
          after: data,
        },
      });

      return res.json({ document });
    } catch (error) {
      console.error("[knowledge/:id] patch error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
