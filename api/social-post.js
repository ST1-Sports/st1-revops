/**
 * /api/social-post  — Social media posting via Publer
 *
 * Required env vars:
 *   PUBLER_API_KEY         — from app.publer.com → Settings → API
 *   PUBLER_WORKSPACE_ID    — from Load Accounts step (or Publer dashboard URL)
 *
 * Optional (per-platform account IDs — get from Load Accounts):
 *   PUBLER_ACCOUNT_FACEBOOK / INSTAGRAM / LINKEDIN / TWITTER / TIKTOK
 *   PUBLER_ACCOUNT_IDS  — comma-separated fallback
 *
 * POST body actions:
 *   action="test"     → verify API key + list workspaces
 *   action="profiles" → list connected social accounts
 *   (default)         → post or schedule
 *
 * NOTE: Publer API requires Business plan or higher.
 */

const PUBLER_API = "https://app.publer.com/api/v1";

async function publerRequest(path, method = "GET", body = null, apiKey, workspaceId = null) {
  const headers = {
    Authorization: `Bearer-API ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (workspaceId) headers["Publer-Workspace-Id"] = workspaceId;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${PUBLER_API}${path}`, opts);
  const cloned = r.clone();
  let data;
  try {
    data = await r.json();
  } catch {
    const text = await cloned.text().catch(() => "");
    data = { error: `HTTP ${r.status}: ${text.slice(0, 500)}` };
  }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.PUBLER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "PUBLER_API_KEY not set — add it to Vercel Environment Variables, then redeploy.",
    });
  }

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── Test connection — fetch workspaces (no workspace header needed) ───────────
  if (action === "test") {
    try {
      const { ok, data } = await publerRequest("/workspaces", "GET", null, apiKey);
      if (ok) {
        const workspaces = Array.isArray(data) ? data : (data.data || data.workspaces || []);
        const names = workspaces.map(w => w.name || w.title || w.id).join(", ");
        const firstId = workspaces[0]?.id;
        return res.json({
          ok: true,
          user: {
            name: `Connected — ${workspaces.length} workspace(s): ${names}`,
            plan: "Publer",
          },
          workspaces: workspaces.map(w => ({ id: w.id, name: w.name || w.title })),
          firstWorkspaceId: firstId,
        });
      }
      return res.status(400).json({ ok: false, error: data.errors?.[0] || data.message || data.error || JSON.stringify(data) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── Raw debug — try a minimal post and return the full Publer response ────────
  if (action === "debug_post") {
    const workspaceId = process.env.PUBLER_WORKSPACE_ID || "";
    const firstAccountId = (
      process.env.PUBLER_ACCOUNT_FACEBOOK ||
      process.env.PUBLER_ACCOUNT_INSTAGRAM ||
      process.env.PUBLER_ACCOUNT_LINKEDIN ||
      process.env.PUBLER_ACCOUNT_TWITTER ||
      process.env.PUBLER_ACCOUNT_TIKTOK ||
      (process.env.PUBLER_ACCOUNT_IDS || "").split(",")[0]
    )?.trim();

    const headers = {
      Authorization: `Bearer-API ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (workspaceId) headers["Publer-Workspace-Id"] = workspaceId;

    // Correct Publer bulk format: networks + accounts as objects
    const testPayload = {
      bulk: {
        state: "scheduled",
        posts: [{
          networks: { instagram: { type: "status", text: "ST1 RevOps debug test" } },
          accounts: firstAccountId ? [{ id: firstAccountId }] : [],
        }],
      },
    };

    const r = await fetch(`${PUBLER_API}/posts/schedule`, { method: "POST", headers, body: JSON.stringify(testPayload) });
    const rawText = await r.text();
    return res.json({
      httpStatus: r.status,
      accountUsed: firstAccountId || "NONE",
      workspaceId: workspaceId || "NONE",
      payload: testPayload,
      rawResponse: rawText.slice(0, 1000),
    });
  }

  // All other actions require a workspace ID
  const workspaceId = process.env.PUBLER_WORKSPACE_ID;
  if (!workspaceId) {
    return res.status(400).json({
      error: "PUBLER_WORKSPACE_ID not set — click Test Connection to find your workspace ID, then add it to Vercel env vars.",
    });
  }

  // ── List accounts ────────────────────────────────────────────────────────────
  if (action === "profiles") {
    try {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
      if (!ok) return res.status(400).json({ error: data.errors?.[0] || data.message || data.error || JSON.stringify(data) });
      const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
      return res.json({
        ok: true,
        profiles: accounts.map(a => ({
          id: String(a.id),
          service: (a.provider || a.platform || a.type || "").toLowerCase(),
          name: a.name || a.username || a.display_name,
          avatar: a.picture || a.avatar,
          connected: !a.needs_reconnect,
        })),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Post / Schedule ──────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });

  const platformMap = {
    facebook:  process.env.PUBLER_ACCOUNT_FACEBOOK,
    instagram: process.env.PUBLER_ACCOUNT_INSTAGRAM,
    linkedin:  process.env.PUBLER_ACCOUNT_LINKEDIN,
    twitter:   process.env.PUBLER_ACCOUNT_TWITTER,
    tiktok:    process.env.PUBLER_ACCOUNT_TIKTOK,
  };

  let accountIds = [];
  if (platforms?.length) {
    accountIds = platforms.map(p => platformMap[p]).filter(Boolean);
  }
  if (!accountIds.length && process.env.PUBLER_ACCOUNT_IDS) {
    accountIds = process.env.PUBLER_ACCOUNT_IDS.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (!accountIds.length) {
    return res.status(400).json({
      error: "No Publer account IDs configured. Go to Integrations → Load Accounts to find your IDs, then add them to Vercel.",
    });
  }

  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
  );

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Publer bulk API: POST /posts/schedule
  // networks = per-platform content; accounts = [{id, scheduled_at?}] objects
  const netTypeMap = { facebook:"status", instagram:"status", linkedin:"status", twitter:"status", tiktok:"video" };

  const activePlatforms = platforms?.length
    ? platforms.filter(p => platformMap[p])
    : Object.keys(platformMap).filter(p => platformMap[p]);

  const networks = {};
  for (const pl of (activePlatforms.length ? activePlatforms : Object.keys(platformMap).filter(p => platformMap[p]))) {
    networks[pl] = { type: netTypeMap[pl] || "status", text: postText };
    if (publicMediaUrls.length) networks[pl].media_urls = publicMediaUrls;
  }

  const accountObjs = accountIds.map(id => {
    const obj = { id: String(id) };
    if (scheduleDate) obj.scheduled_at = new Date(scheduleDate).toISOString();
    return obj;
  });

  const payload = {
    bulk: {
      state: "scheduled",
      posts: [{ networks, accounts: accountObjs }],
    },
  };

  console.log("[social-post] payload →", JSON.stringify(payload).slice(0, 600));

  try {
    const { ok, status: httpStatus, data } = await publerRequest("/posts/schedule", "POST", payload, apiKey, workspaceId);
    console.log("[social-post] publer →", httpStatus, JSON.stringify(data).slice(0, 500));

    // Publer returns 202 + job_id (async) on success
    if (ok || httpStatus === 202) {
      return res.json({
        status: scheduleDate ? "scheduled" : "success",
        backend: "publer",
        jobId: data.job_id || data.id || null,
        postIds: [],
        scheduled: !!scheduleDate,
        ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0
          ? { _warning: "Image skipped — must be a public HTTPS URL." }
          : {}),
      });
    }

    const errMsg = (
      data.errors?.[0]?.message || (typeof data.errors?.[0] === "string" ? data.errors[0] : null) ||
      data.message || data.error ||
      (typeof data === "string" ? data.slice(0, 200) : null) ||
      `Publer HTTP ${httpStatus}`
    );
    return res.status(400).json({
      error: `[${httpStatus}] ${errMsg}`,
      backend: "publer",
      detail: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
