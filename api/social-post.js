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
  const hasMedia = publicMediaUrls.length > 0;

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Publer bulk API: POST /posts/schedule
  // networks = per-platform content; accounts = [{id, scheduled_at}] objects
  // Instagram REQUIRES media — skip it for text-only posts
  const netTypeMap = {
    facebook:  "feed",
    instagram: "image",
    linkedin:  "feed",
    twitter:   "feed",
    tiktok:    "video",
  };

  const allAvailablePlatforms = Object.keys(platformMap).filter(p => platformMap[p]);
  let activePlatforms = platforms?.length
    ? platforms.filter(p => platformMap[p])
    : allAvailablePlatforms;

  // Instagram requires media — remove it from text-only posts to prevent silent job failure
  if (!hasMedia) {
    activePlatforms = activePlatforms.filter(p => p !== "instagram" && p !== "tiktok");
  }

  if (!activePlatforms.length) {
    return res.status(400).json({ error: hasMedia ? "No account IDs configured for selected platforms." : "No text-capable platforms configured. Instagram and TikTok require media/video." });
  }

  const networks = {};
  for (const pl of activePlatforms) {
    networks[pl] = { type: netTypeMap[pl] || "feed", text: postText };
    if (hasMedia) networks[pl].media_urls = publicMediaUrls;
  }

  const accountObjs = accountIds.map(id => ({
    id: String(id),
    // For immediate posts use now; for scheduled posts use the requested time
    // Schedule 5 min from now so Publer has time to process and publish
    scheduled_at: scheduleDate
      ? new Date(scheduleDate).toISOString()
      : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }));

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

    // Publer returns 200/202 + job_id (async) on acceptance
    if (ok || httpStatus === 202) {
      const jobId = data.job_id || data.id || null;
      const warnings = [];
      if (mediaUrls?.length && !hasMedia) warnings.push("Image skipped — must be a public HTTPS URL. Upload to Cloudinary/Imgur and paste the link instead.");

      // Poll job status once after 4s to catch silent failures
      let jobStatus = null;
      if (jobId) {
        await new Promise(r => setTimeout(r, 4000));
        try {
          const { ok: jok, data: jdata } = await publerRequest(`/jobs/${jobId}`, "GET", null, apiKey, workspaceId);
          if (jok) {
            jobStatus = jdata.status || jdata.state || null;
            // If the job failed, surface the error
            if (jobStatus && ["failed","error","cancelled"].includes(String(jobStatus).toLowerCase())) {
              const jobErr = jdata.message || jdata.error || jdata.errors?.[0] || `Job ${jobStatus}`;
              return res.status(400).json({ error: `Publer job failed: ${jobErr}`, backend: "publer", jobId, jobData: jdata });
            }
          }
        } catch { /* job polling is best-effort */ }
      }

      return res.json({
        status: scheduleDate ? "scheduled" : "success",
        backend: "publer",
        jobId,
        jobStatus,
        platforms: activePlatforms,
        postIds: [],
        _warning: warnings[0] || undefined,
        scheduled: !!scheduleDate,
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
