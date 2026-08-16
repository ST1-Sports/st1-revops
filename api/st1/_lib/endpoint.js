import { prisma } from "../../_lib/prisma.js";
import { setCors } from "../../_lib/cors.js";
import { requireKnowledgeActor } from "../../knowledge/_lib/auth.js";
import { handleApiError, readInput } from "./validation.js";

export function st1Endpoint(scope, serviceFn, options = {}) {
  return async function handler(req, res) {
    setCors(res, options.methods || "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const actor = await requireKnowledgeActor(req, res, prisma);
    if (!actor) return;

    try {
      const input = readInput(req);
      console.info(`[st1/${scope}] request`, {
        actorType: actor.actorType,
        userId: actor.userId,
      });
      const result = await serviceFn(prisma, input, actor);
      return res.json(result);
    } catch (error) {
      return handleApiError(res, scope, error);
    }
  };
}
