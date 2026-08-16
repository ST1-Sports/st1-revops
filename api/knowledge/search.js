import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

function knowledgeCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

function searchTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"']+/)
    .filter(term => term.length > 2)
    .slice(0, 8);
}

function scoreText(text, terms) {
  const low = String(text || "").toLowerCase();
  return terms.reduce((score, term) => score + (low.includes(term) ? 1 : 0), 0);
}

export async function runKnowledgeSearch(query, limit = 10) {
  const q = String(query || "").trim();
  if (!q) return { documents: [], chunks: [], facts: [] };

  const terms = searchTerms(q);
  const orText = [
    { title: { contains: q, mode: "insensitive" } },
    { rawText: { contains: q, mode: "insensitive" } },
    { summary: { contains: q, mode: "insensitive" } },
  ];
  const orChunks = [
    { content: { contains: q, mode: "insensitive" } },
    ...terms.map(term => ({ content: { contains: term, mode: "insensitive" } })),
  ];
  const orFacts = [
    { entityName: { contains: q, mode: "insensitive" } },
    { entityType: { contains: q, mode: "insensitive" } },
    { factType: { contains: q, mode: "insensitive" } },
    { sourceQuote: { contains: q, mode: "insensitive" } },
    ...terms.flatMap(term => ([
      { entityName: { contains: term, mode: "insensitive" } },
      { factType: { contains: term, mode: "insensitive" } },
      { sourceQuote: { contains: term, mode: "insensitive" } },
    ])),
  ];

  const [documents, chunks, facts] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { OR: orText },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 30),
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceUrl: true,
        fileName: true,
        summary: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.knowledgeChunk.findMany({
      where: { OR: orChunks },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit * 2, 40),
      include: {
        document: {
          select: { id: true, title: true, sourceType: true, sourceUrl: true, status: true },
        },
      },
    }),
    prisma.knowledgeFact.findMany({
      where: { OR: orFacts },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit * 2, 40),
      include: {
        document: { select: { id: true, title: true, sourceType: true, sourceUrl: true } },
        chunk: { select: { id: true, chunkIndex: true, content: true } },
      },
    }),
  ]);

  const rankedChunks = chunks
    .map(chunk => ({ ...chunk, score: scoreText(chunk.content, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const rankedFacts = facts
    .map(fact => ({ ...fact, score: scoreText(`${fact.entityType} ${fact.entityName} ${fact.factType} ${fact.sourceQuote}`, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { documents, chunks: rankedChunks, facts: rankedFacts };
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = requireKnowledgeActor(req, res);
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
