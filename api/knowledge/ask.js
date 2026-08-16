import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { answerFromKnowledge } from "./_lib/ai.js";
import { runKnowledgeSearch } from "./search.js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
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

  const actor = requireKnowledgeActor(req, res);
  if (!actor) return;

  try {
    const { query, limit = 8 } = req.body || {};
    if (!query) return res.status(400).json({ error: "query is required" });

    const results = await runKnowledgeSearch(query, Math.min(Number(limit) || 8, 12));
    const factContext = results.facts.map(fact => ({
      id: fact.chunkId || fact.id,
      documentId: fact.documentId,
      title: fact.document?.title,
      content: [
        `${fact.entityType}: ${fact.entityName}`,
        `${fact.factType}: ${JSON.stringify(fact.value)}`,
        fact.sourceQuote ? `Source quote: ${fact.sourceQuote}` : "",
      ].filter(Boolean).join("\n"),
      document: fact.document,
    }));
    const chunkContext = results.chunks.map(chunk => ({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      document: chunk.document,
    }));
    const contextItems = [...factContext, ...chunkContext].slice(0, Math.min(Number(limit) || 8, 12));

    if (!contextItems.length) {
      return res.json({
        answer: "I could not find matching approved knowledge or document text for that question.",
        citations: [],
        results,
      });
    }

    const answer = await answerFromKnowledge(query, contextItems);
    const citations = (answer.citations || []).map(citation => {
      const refIndex = Number(citation.ref) - 1;
      const item = contextItems[refIndex];
      return {
        ...citation,
        documentId: item?.documentId || null,
        chunkId: item?.id || null,
        title: item?.document?.title || item?.title || null,
      };
    });

    return res.json({
      answer: answer.answer || "",
      citations,
      results,
    });
  } catch (error) {
    console.error("[knowledge/ask] error:", error);
    return res.status(500).json({ error: error.message });
  }
}
