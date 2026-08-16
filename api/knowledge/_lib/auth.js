/**
 * Lightweight Knowledge API access helper.
 *
 * Existing RevOps auth is client-side, so the Knowledge API supports both:
 * - KNOWLEDGE_API_KEY for internal agents and server-to-server callers.
 * - x-st1-user-id for the current app UI, matching existing rep-id patterns.
 *
 * If KNOWLEDGE_API_KEY is configured, callers that provide a key must match it.
 * UI calls without a key are still allowed so this feature remains usable inside
 * the current app while broader auth hardening is handled separately.
 */
export function getKnowledgeActor(req) {
  const configuredKey = process.env.KNOWLEDGE_API_KEY || "";
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerKey = req.headers["x-knowledge-api-key"] || "";
  const providedKey = bearer || headerKey;

  if (providedKey) {
    if (!configuredKey || providedKey !== configuredKey) {
      return { ok: false, status: 401, error: "Invalid Knowledge API key" };
    }
    return {
      ok: true,
      actorType: "api",
      userId: req.headers["x-st1-user-id"] || "knowledge-api",
    };
  }

  return {
    ok: true,
    actorType: "ui",
    userId: req.headers["x-st1-user-id"] || req.body?.userId || req.query?.userId || null,
  };
}

export function requireKnowledgeActor(req, res) {
  const actor = getKnowledgeActor(req);
  if (!actor.ok) {
    res.status(actor.status || 401).json({ error: actor.error || "Unauthorized" });
    return null;
  }
  return actor;
}
