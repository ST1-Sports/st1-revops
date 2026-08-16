function readUserId(req) {
  return req.headers["x-st1-user-id"] || req.body?.userId || req.query?.userId || null;
}

async function lookupExistingUser(prisma, userId) {
  if (!userId) return null;

  const setting = await prisma.setting.findUnique({ where: { key: "app_state" } }).catch(() => null);
  const state = setting?.value || {};
  const reps = Array.isArray(state.reps) ? state.reps : [];
  const appUsers = Array.isArray(state.appUsers) ? state.appUsers : [];
  const hasAdmin = appUsers.some(user => user?.isAdmin);

  if (userId === "__owner__" && !hasAdmin) {
    return { userId, isAdmin: true, source: "owner-bootstrap" };
  }

  const rep = reps.find(item => item?.id === userId);
  const appUser = appUsers.find(item => item?.repId === userId);
  if (!rep && !appUser) return null;

  return {
    userId,
    isAdmin: Boolean(appUser?.isAdmin),
    rep,
    source: "app_state",
  };
}

/**
 * Basic Knowledge permission checks based on the existing RevOps auth shape.
 *
 * Existing app auth is client-side PIN plus app_state users, so this validates
 * the caller-provided x-st1-user-id against app_state where possible. Internal
 * agents can use KNOWLEDGE_API_KEY for server-to-server access.
 */
export async function getKnowledgeActor(req, prisma, options = {}) {
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
      userId: readUserId(req) || "knowledge-api",
      isAdmin: true,
    };
  }

  const userId = readUserId(req);
  const user = prisma ? await lookupExistingUser(prisma, userId) : { userId, isAdmin: false };
  if (!user) return { ok: false, status: 401, error: "Knowledge access requires a known RevOps user" };
  if (options.requireAdmin && !user.isAdmin) return { ok: false, status: 403, error: "Admin access required" };

  return { ok: true, actorType: "ui", ...user };
}

export async function requireKnowledgeActor(req, res, prisma, options = {}) {
  const actor = await getKnowledgeActor(req, prisma, options);
  if (!actor.ok) {
    res.status(actor.status || 401).json({ error: actor.error || "Unauthorized" });
    return null;
  }
  return actor;
}
