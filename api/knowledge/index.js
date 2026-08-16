import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { cleanText, decodeBase64Text, fetchUrlText, normalizeSourceType } from "./_lib/text.js";
import { createKnowledgeSourceWithDocument, getKnowledgeSource, listKnowledgeSources, processKnowledgeImport } from "./_lib/repository.js";

export const config = {
  api: { bodyParser: { sizeLimit: "24mb" } },
  maxDuration: 120,
};

function knowledgeCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

export default async function handler(req, res) {
  knowledgeCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = await requireKnowledgeActor(req, res, prisma);
  if (!actor) return;

  if (req.method === "GET") {
    try {
      const sources = await listKnowledgeSources(prisma, req.query || {});
      return res.json({ sources });
    } catch (error) {
      console.error("[knowledge] list error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const sourceType = normalizeSourceType(body.sourceType);
      let content = cleanText(body.content || body.rawText || body.text || "");
      let mimeType = body.mimeType || null;

      if (sourceType === "URL") {
        const fetched = await fetchUrlText(body.sourceUrl);
        content = fetched.text;
        mimeType = fetched.contentType || mimeType;
      } else if (sourceType === "GOOGLE_DRIVE" && !content && body.storageReference) {
        content = `Google Drive source reference: ${body.storageReference}`;
      } else if (!content && body.fileBase64) {
        content = decodeBase64Text(body.fileBase64);
      }

      if (!content) {
        return res.status(400).json({ error: "content, text, rawText, fileBase64, or a fetchable sourceUrl is required" });
      }

      const result = await createKnowledgeSourceWithDocument(prisma, {
        ...body,
        content,
        sourceType,
        mimeType,
        originalFilename: body.originalFilename || body.fileName || null,
      }, actor);

      if (body.processNow === false || result.duplicate) {
        return res.status(result.duplicate ? 200 : 201).json(result);
      }

      try {
        const processed = await processKnowledgeImport(prisma, result.source.id, actor);
        return res.status(201).json({ ...processed, duplicate: false });
      } catch (processingError) {
        const failedSource = await getKnowledgeSource(prisma, result.source.id).catch(() => result.source);
        return res.status(201).json({
          source: failedSource,
          importJob: processingError.importJob || null,
          processingError: processingError.message,
          duplicate: false,
        });
      }
    } catch (error) {
      console.error("[knowledge] ingest error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
