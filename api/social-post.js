/**
 * /api/social-post  — Social media posting via Publer
 *
 * Required env vars:
 *   PUBLER_API_KEY         — from app.publer.com → Settings → API
 *   PUBLER_WORKSPACE_ID    — from Publer dashboard URL or Test Connection
 *
 * Optional (per-platform account IDs — get from Load Accounts):
 *   PUBLER_ACCOUNT_FACEBOOK / INSTAGRAM / LINKEDIN / TWITTER / TIKTOK
 *   PUBLER_ACCOUNT_IDS  — comma-separated fallback (used when platform-specific IDs missing)
 *
 * POST body actions:
 *   action="test"     → verify API key + list workspaces
 *   action="profiles" → list connected social accounts
 *   (default)         → post or schedule
 *
 * Publer API v1 docs: https://publer.com/docs/api-reference/posts
 * Correct payload wraps everything in { bulk: { state, posts: [{ networks, accounts }] } }
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
    const text = await r.text().catch(() => "");
    data = { _rawError: `HTTP ${r.status}: ${text.slice(0, 400)}` };
  }

  console.log(`[publer] ${method} ${path} → ${r.status}`, JSON.stringify(data).slice(0, 600));
  return { ok: r.ok, status: r.status, data };
}

function extractError(data) {
  if (!data) return "Unknown error";
  if (data._rawError) return data._rawError;
  if (data.errors && Array.isArray(data.errors)) return data.errors.join("; ");
  if (data.message) return data.message;
  if (data.error) return data.error;
  return JSON.stringify(data).slice(0, 300);
}

function parseSuccess(data, scheduled) {
  // Publer bulk API returns: { success: true, data: { job_id, status } }
  if (data.success === true) {
    const jobId = data.data?.job_id || data.data?.id;
    return { ok: true, postIds: jobId ? [String(jobId)] : [] };
  }
  // Fallback shapes from older Publer versions
  if (data.status === "success" || data.status === "scheduled" || data.id) {
    const posts = data.posts || (data.id ? [data] : []);
    return { ok: true, postIds: posts.map(p => String(p.id)).filter(Boolean) };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.PUBLER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "PUBLER_API_KEY not configured — add it to Vercel Environment Variables.",
    });
  }

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── Test connection ────────────────────────────────────────────────────────
  if (action === "test") {
    try {
      const { ok, data } = await publerRequest("/workspaces", "GET", null, apiKey);
      if (ok) {
        const workspaces = Array.isArray(data) ? data : (data.data || data.workspaces || []);
        return res.json({
          ok: true,
          user: { name: `Connected — ${workspaces.length} workspace(s): ${workspaces.map(w => w.name || w.title || w.id).join(", ")}` },
          workspaces: workspaces.map(w => ({ id: w.id, name: w.name || w.title })),
          firstWorkspaceId: workspaces[0]?.id,
        });
      }
      return res.status(400).json({ ok: false, error: extractError(data) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Workspace required for all posting actions
  const workspaceId = process.env.PUBLER_WORKSPACE_ID;
  if (!workspaceId) {
    return res.status(400).json({
      error: "PUBLER_WORKSPACE_ID not configured — click Test Connection, copy the workspace ID shown, then add it to Vercel env vars.",
    });
  }

  // ── List accounts ─────────────────────────────────────────────────────────
  if (action === "profiles") {
    try {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
      if (!ok) return res.status(400).json({ error: extractError(data) });
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
  if (!post?.trim()) return res.status(400).json({ error: "Post text is required" });

  const platformMap = {
    facebook:  process.env.PUBLER_ACCOUNT_FACEBOOK,
    instagram: process.env.PUBLER_ACCOUNT_INSTAGRAM,
    linkedin:  process.env.PUBLER_ACCOUNT_LINKEDIN,
    twitter:   process.env.PUBLER_ACCOUNT_TWITTER,
    tiktok:    process.env.PUBLER_ACCOUNT_TIKTOK,
  };

  // Collect account IDs for the requested platforms
  let accountIds = [];
  const activePlatforms = (platforms || []).filter(Boolean);
  if (activePlatforms.length) {
    accountIds = activePlatforms.map(p => platformMap[p]).filter(Boolean);
  }
  if (!accountIds.length && process.env.PUBLER_ACCOUNT_IDS) {
    accountIds = process.env.PUBLER_ACCOUNT_IDS.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (!accountIds.length) {
    return res.status(400).json({
      error: "No account IDs configured. In Settings → Load Accounts, copy the IDs, then add PUBLER_ACCOUNT_FACEBOOK (etc.) to Vercel env vars.",
    });
  }

  // Only include public HTTP image URLs — base64 / blob URLs won't work with Publer
  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("https://") && !u.startsWith("data:")
  );
  const hasMedia = publicMediaUrls.length > 0;
  const skippedMedia = !hasMedia && (mediaUrls || []).length > 0;

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Resolve scheduling time — must be at least 2 min in the future
  let scheduledAt = null;
  if (scheduleDate) {
    const t = new Date(scheduleDate);
    const minAllowed = new Date(Date.now() + 2 * 60 * 1000);
    scheduledAt = (t > minAllowed ? t : minAllowed).toISOString();
  }

  // Build the network-specific content block
  // Use the same text for all platforms; type="photo" when media present, "status" otherwise
  const contentType = isStory ? "story" : hasMedia ? "photo" : "status";
  const networkContent = {
    type: contentType,
    text: postText,
    ...(hasMedia ? { media: publicMediaUrls.map(url => ({ url })) } : {}),
  };

  // Build networks object — one entry per platform we're posting to
  // If we can't identify the platforms from env vars, fall back to platform list
  const networkKeys = activePlatforms.length > 0 ? activePlatforms : ["facebook"];
  const networks = Object.fromEntries(networkKeys.map(p => [p, networkContent]));

  // Build accounts array — objects with id and optional scheduled_at
  const accountObjs = accountIds.map(id => ({
    id: String(id),
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
  }));

  // Publer v1 bulk payload
  const payload = {
    bulk: {
      state: "scheduled",
      posts: [
        {
          networks,
          accounts: accountObjs,
        },
      ],
    },
  };

  // Immediate = /posts/schedule/publish, Scheduled = /posts/schedule
  const endpoint = scheduledAt ? "/posts/schedule" : "/posts/schedule/publish";

  try {
    const { ok, status: httpStatus, data } = await publerRequest(endpoint, "POST", payload, apiKey, workspaceId);

    if (ok) {
      const parsed = parseSuccess(data, !!scheduledAt);
      if (parsed) {
        return res.json({
          status: scheduledAt ? "scheduled" : "success",
          backend: "publer",
          postIds: parsed.postIds,
          scheduled: !!scheduledAt,
          ...(skippedMedia ? { _warning: "Image skipped — must be a public HTTPS URL." } : {}),
        });
      }
    }

    return res.status(400).json({
      error: extractError(data),
      backend: "publer",
      detail: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
