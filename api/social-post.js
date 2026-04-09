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

  const url = `${PUBLER_API}${path}`;
  const r = await fetch(url, opts);

  let data;
  try {
    data = await r.json();
  } catch {
    const text = await cloned.text().catch(() => "");
    data = { error: `HTTP ${r.status}: ${text.slice(0, 500)}` };
  }

  // Log for debugging (Vercel function logs)
  console.log(`[publer] ${method} ${path} → ${r.status}`, JSON.stringify(data).slice(0, 500));
  return { ok: r.ok, status: r.status, data };
}

// Parse Publer's response into a normalised success/postIds shape
function parsePostResponse(data, scheduled) {
  // Publer v1 returns: { success: true, data: { job_id: "...", status: "working" } }
  // Or sometimes: { id: 123, status: "success" }
  // Or for bulk: { posts: [...] }
  if (data.success === true) {
    const jobId = data.data?.job_id || data.data?.id;
    return { ok: true, postIds: jobId ? [String(jobId)] : [], scheduled };
  }
  if (data.status === "success" || data.status === "scheduled") {
    const posts = data.posts || (data.id ? [data] : []);
    return { ok: true, postIds: posts.map(p => String(p.id)).filter(Boolean), scheduled };
  }
  if (data.id) {
    return { ok: true, postIds: [String(data.id)], scheduled };
  }
  return null; // not a success
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

  // ── Test connection ────────────────────────────────────────────────────────
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
          },
          workspaces: workspaces.map(w => ({ id: w.id, name: w.name || w.title })),
          firstWorkspaceId: firstId,
        });
      }
      const errMsg = data.errors?.[0] || data.message || data.error || JSON.stringify(data).slice(0, 200);
      return res.status(400).json({ ok: false, error: errMsg });
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

    // Simple test: list scheduled posts to see what Publer actually has
    const listR = await fetch(`${PUBLER_API}/posts?state=scheduled&per_page=5`, { headers });
    const listText = await listR.text();

    // Determine a text-capable platform for debug (not Instagram/TikTok which require media)
    const textPlatform =
      process.env.PUBLER_ACCOUNT_LINKEDIN ? "linkedin" :
      process.env.PUBLER_ACCOUNT_FACEBOOK ? "facebook" :
      process.env.PUBLER_ACCOUNT_TWITTER  ? "twitter"  : "instagram";

    // Also test creating a minimal post
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const testPayload = {
      bulk: {
        state: "scheduled",
        posts: [{
          networks: { [textPlatform]: { type: "feed", text: "ST1 RevOps debug test — please ignore" } },
          accounts: firstAccountId ? [{ id: firstAccountId, scheduled_at: soon }] : [],
        }],
      },
    };

    const r = await fetch(`${PUBLER_API}/posts/schedule`, { method: "POST", headers, body: JSON.stringify(testPayload) });
    const rawText = await r.text();
    return res.json({
      httpStatus: r.status,
      accountUsed: firstAccountId || "NONE",
      workspaceId: workspaceId || "NONE",
      scheduledFor: soon,
      createResponse: rawText.slice(0, 500),
      existingScheduled: listText.slice(0, 500),
    });
  }

  // All other actions require a workspace ID
  const workspaceId = process.env.PUBLER_WORKSPACE_ID;
  if (!workspaceId) {
    return res.status(400).json({
      error: "PUBLER_WORKSPACE_ID not set — click Test Connection to find your workspace ID, then add it to Vercel env vars.",
    });
  }

  // ── List accounts ─────────────────────────────────────────────────────────
  if (action === "profiles") {
    try {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
      if (!ok) {
        const errMsg = data.errors?.[0] || data.message || data.error || JSON.stringify(data).slice(0, 200);
        return res.status(400).json({ error: errMsg });
      }
      const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
      return res.json({
        ok: true,
        profiles: accounts.map(a => ({
          id: String(a.id),
          service: (a.provider || a.platform || a.type || a.service || "").toLowerCase(),
          name: a.name || a.username || a.display_name,
          avatar: a.picture || a.avatar,
          connected: !a.needs_reconnect,
        })),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Post / Schedule ────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });

  const platformMap = {
    facebook:  process.env.PUBLER_ACCOUNT_FACEBOOK,
    instagram: process.env.PUBLER_ACCOUNT_INSTAGRAM,
    linkedin:  process.env.PUBLER_ACCOUNT_LINKEDIN,
    twitter:   process.env.PUBLER_ACCOUNT_TWITTER,
    tiktok:    process.env.PUBLER_ACCOUNT_TIKTOK,
  };

  let rawIds = [];
  if (platforms?.length) {
    rawIds = platforms.map(p => platformMap[p]).filter(Boolean);
  }
  if (!rawIds.length && process.env.PUBLER_ACCOUNT_IDS) {
    rawIds = process.env.PUBLER_ACCOUNT_IDS.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (!rawIds.length) {
    return res.status(400).json({
      error: "No Publer account IDs configured. Go to Settings → Load Accounts to find your IDs, then add them to Vercel.",
    });
  }

  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
  );
  const hasMedia = publicMediaUrls.length > 0;

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Publer expects accounts as an array of objects: [{id: "123", scheduled_at: "..."}]
  // scheduled_at must be at least 1–2 minutes in the future
  const scheduledAt = scheduleDate ? new Date(scheduleDate).toISOString() : null;

  const accountObjs = rawIds.map(id => ({
    id: String(id),
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
  }));

  const payload = {
    accounts: accountObjs,
    text: postText,
    ...(isStory ? { content_type: "story" } : {}),
    ...(publicMediaUrls.length ? { media: publicMediaUrls.map(url => ({ url })) } : {}),
  };

  // Immediate = /posts/schedule/publish, Scheduled = /posts/schedule
  const endpoint = scheduledAt ? "/posts/schedule" : "/posts/schedule/publish";

  try {
    const { ok, status: httpStatus, data } = await publerRequest(endpoint, "POST", payload, apiKey, workspaceId);

    if (ok) {
      const parsed = parsePostResponse(data, !!scheduledAt);
      if (parsed) {
        return res.json({
          status: scheduledAt ? "scheduled" : "success",
          backend: "publer",
          postIds: parsed.postIds,
          scheduled: !!scheduledAt,
          ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0
            ? { _warning: "Image skipped — must be a public HTTPS URL." }
            : {}),
        });
      }
    }

    // Return a useful error including the full Publer response for debugging
    const errMsg = data.errors?.[0] || data.message || data.error || `HTTP ${httpStatus}`;
    return res.status(400).json({
      error: errMsg,
      backend: "publer",
      detail: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
