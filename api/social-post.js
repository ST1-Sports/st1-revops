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
  let data;
  try {
    data = await r.json();
  } catch {
    data = { error: `HTTP ${r.status}: (non-JSON response)` };
  }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  // Top-level try/catch — API always returns JSON, never a raw Vercel error page
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.PUBLER_API_KEY;
    if (!apiKey) {
      return res.json({
        status: "not_configured",
        error: "PUBLER_API_KEY not set — add it in Vercel → Settings → Environment Variables, then redeploy.",
      });
    }

    const { post, platforms, mediaUrls, scheduleDate, isStory, link, action, postNow } = req.body || {};

    // ── Test connection — fetch workspaces (no workspace header needed) ───────────
    if (action === "test") {
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
      return res.json({ ok: false, error: data.errors?.[0] || data.message || data.error || JSON.stringify(data) });
    }

    // All other actions require a workspace ID
    const workspaceId = process.env.PUBLER_WORKSPACE_ID;
    if (!workspaceId) {
      return res.json({
        status: "not_configured",
        error: "PUBLER_WORKSPACE_ID not set — go to Integrations → Test Connection to find your workspace ID, then add it to Vercel.",
      });
    }

    // ── Fetch post stats ─────────────────────────────────────────────────────────
    if (action === "stats") {
      const { postId } = req.body;
      if (!postId) return res.json({ ok: false, error: "postId required" });
      const { ok, data } = await publerRequest(`/posts/${postId}`, "GET", null, apiKey, workspaceId);
      if (!ok) return res.json({ ok: false, error: data.error || data.message || "Failed to fetch stats" });
      return res.json({ ok: true, raw: data });
    }

    // ── List accounts ────────────────────────────────────────────────────────────
    if (action === "profiles") {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
      if (!ok) return res.json({ ok: false, error: data.errors?.[0] || data.message || data.error || JSON.stringify(data) });
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
    }

    // ── Post / Schedule ──────────────────────────────────────────────────────────
    if (!post?.trim()) return res.json({ status: "error", error: "post text is required" });

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
      return res.json({
        status: "not_configured",
        error: "No Publer account IDs configured. Go to Integrations → Load Accounts to find your IDs, then add them to Vercel.",
      });
    }

    const publicMediaUrls = (mediaUrls || []).filter(
      u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
    );

    const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

    const payload = { accounts: accountIds, text: postText };
    if (scheduleDate && !postNow) {
      payload.scheduled_at = new Date(scheduleDate).toISOString();
    } else {
      // Set to current time so Publer publishes immediately.
      // Omitting scheduled_at makes Publer fall back to its default queue time (e.g. 9am).
      payload.scheduled_at = new Date().toISOString();
    }
    if (isStory) payload.content_type = "story";
    if (publicMediaUrls.length) payload.media = publicMediaUrls.map(url => ({ url }));

    const { ok, data } = await publerRequest("/posts/schedule", "POST", payload, apiKey, workspaceId);

    if (ok && (data.status === "success" || data.id || Array.isArray(data.posts))) {
      const posts = data.posts || (data.id ? [data] : []);
      return res.json({
        status: (scheduleDate && !postNow) ? "scheduled" : "success",
        backend: "publer",
        postIds: posts.map(p => p.id).filter(Boolean),
        scheduled: !!scheduleDate,
        ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0
          ? { _warning: "Image skipped — must be a public HTTPS URL." }
          : {}),
      });
    }

    return res.json({
      status: "error",
      error: data.errors?.[0] || data.message || data.error || "Post failed",
      backend: "publer",
      detail: data,
    });

  } catch (e) {
    // Catch-all — never let an unhandled exception return a raw Vercel error page
    return res.json({ status: "error", error: e.message || "Unexpected server error" });
  }
}
