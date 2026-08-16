import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { getKnowledgeSource, updateKnowledgeSourceStatus } from "./_lib/repository.js";

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

  const actor = await requireKnowledgeActor(req, res, prisma);
  if (!actor) return;

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: "Document id is required" });

  if (req.method === "GET") {
    try {
      const source = await getKnowledgeSource(prisma, id);
      if (!source) return res.status(404).json({ error: "Knowledge source not found" });
      return res.json({ source });
    } catch (error) {
      console.error("[knowledge/:id] get error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const before = await getKnowledgeSource(prisma, id);
      if (!before) return res.status(404).json({ error: "Knowledge source not found" });

      let source;
      if (body.status) {
        const nextStatus = String(body.status).toUpperCase();
        if (["APPROVED", "REJECTED"].includes(nextStatus) && !actor.isAdmin) {
          return res.status(403).json({ error: "Admin access required to approve or reject knowledge" });
        }
        source = await updateKnowledgeSourceStatus(prisma, id, nextStatus, actor);
      } else {
        source = await prisma.knowledgeSource.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: String(body.title || "").slice(0, 240) } : {}),
            ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl || null } : {}),
            ...(body.storageReference !== undefined ? { storageReference: body.storageReference || null } : {}),
            ...(body.metadata !== undefined ? { metadata: body.metadata || {} } : {}),
          },
          include: {
            documents: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } },
            importJobs: { orderBy: { createdAt: "desc" } },
          },
        });
      }

      return res.json({ source });
    } catch (error) {
      console.error("[knowledge/:id] patch error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
