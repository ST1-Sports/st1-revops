import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "./_lib/auth.js";
import { commitApprovedKnowledge, rejectKnowledgeImport, saveEditedKnowledgeProposal } from "./_lib/commit.js";

export const config = {
  api: { bodyParser: { sizeLimit: "8mb" } },
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
    const { sourceId, importJobId, action, selectedIndexes = [], proposedChanges, warnings, note } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: "sourceId is required" });

    if (action === "approve_all") {
      const result = await commitApprovedKnowledge(prisma, { sourceId, importJobId, mode: "approve_all", actor, note });
      return res.json(result);
    }

    if (action === "approve_selected") {
      const result = await commitApprovedKnowledge(prisma, { sourceId, importJobId, mode: "approve_selected", selectedIndexes, actor, note });
      return res.json(result);
    }

    if (action === "reject") {
      const result = await rejectKnowledgeImport(prisma, { sourceId, importJobId, actor, note });
      return res.json(result);
    }

    if (action === "edit") {
      const result = await saveEditedKnowledgeProposal(prisma, { sourceId, importJobId, proposedChanges, warnings, actor, note });
      return res.json(result);
    }

    return res.status(400).json({ error: "action must be approve_all, approve_selected, reject, or edit" });
  } catch (error) {
    console.error("[knowledge/review] error:", error);
    return res.status(500).json({ error: error.message });
  }
}
