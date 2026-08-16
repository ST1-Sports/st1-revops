import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { processKnowledgeImport } from "./_lib/repository.js";

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
  maxDuration: 120,
};

function knowledgeCors(res, methods = "POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const actor = await requireKnowledgeActor(req, res, prisma);
  if (!actor) return;

  try {
    const { sourceId, limit = 3 } = req.body || {};
    if (sourceId) {
      const processed = await processKnowledgeImport(prisma, sourceId, actor);
      return res.json({ processed: [processed] });
    }

    const pending = await prisma.knowledgeSource.findMany({
      where: { status: { in: ["UPLOADED", "FAILED"] } },
      orderBy: { createdAt: "asc" },
      take: Math.min(Number(limit) || 3, 10),
    });

    const processed = [];
    const errors = [];
    for (const source of pending) {
      try {
        processed.push(await processKnowledgeImport(prisma, source.id, actor));
      } catch (error) {
        errors.push({ sourceId: source.id, error: error.message });
      }
    }

    return res.json({ processed, errors });
  } catch (error) {
    console.error("[knowledge/process] error:", error);
    return res.status(500).json({ error: error.message });
  }
}
