import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { searchKnowledge } from "./_lib/repository.js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

function knowledgeCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

export async function runKnowledgeSearch(query, limit = 10) {
  return searchKnowledge(prisma, query, limit);
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = await requireKnowledgeActor(req, res, prisma);
  if (!actor) return;

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const query = req.method === "GET" ? req.query.q : req.body?.query;
    const limit = req.method === "GET" ? req.query.limit : req.body?.limit;
    const results = await runKnowledgeSearch(query, Math.min(Number(limit) || 10, 25));
    return res.json({ query, ...results });
  } catch (error) {
    console.error("[knowledge/search] error:", error);
    return res.status(500).json({ error: error.message });
  }
}
