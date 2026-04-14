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
  // Publer bulk API: { success: true, data: { job_id, status } }
  if (data.success === true) {
    const jobId = data.data?.job_id || data.data?.id;
    return { ok: true, postIds: jobId ? [String(jobId)] : [] };
  }
  // Publer sometimes returns { job_id: "..." } directly at the top level
  if (data.job_id) {
    return { ok: true, postIds: [String(data.job_id)] };
  }
  // Older Publer response shapes
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

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action, jobId } = req.body || {};

  // ── Check job status ───────────────────────────────────────────────────────
  if (action === "job-status") {
    if (!jobId) return res.status(400).json({ error: "jobId required" });
    const workspaceId = process.env.PUBLER_WORKSPACE_ID;
    try {
      const { ok, data } = await publerRequest(`/job_status/${jobId}`, "GET", null, apiKey, workspaceId);
      const failures = data.payload?.failures;
      const failureList = Array.isArray(failures)
        ? failures.map(f => `${f.account_name || f.provider}: ${f.message}`)
        : failures?.error ? [failures.error] : [];
      return res.json({
        ok,
        status: data.status,
        done: data.status === "complete" || data.status === "failed",
        failures: failureList,
        raw: data,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── List posts (debug) ────────────────────────────────────────────────────
  // Queries scheduled + failed + draft so we can see what's landing
  if (action === "list-posts") {
    const workspaceId = process.env.PUBLER_WORKSPACE_ID;
    try {
      // Query all three states to get full picture
      const [sched, failed, drafts] = await Promise.all([
        publerRequest("/posts?status=scheduled&per_page=15", "GET", null, apiKey, workspaceId),
        publerRequest("/posts?status=failed&per_page=10", "GET", null, apiKey, workspaceId),
        publerRequest("/posts?status=draft&per_page=10", "GET", null, apiKey, workspaceId),
      ]);

      const normAccts = (raw) => {
        const singularId = raw.account_id;
        if (singularId) return [{ id: String(singularId), name: "", provider: "" }];
        const arr = raw.accounts || raw.social_accounts || raw.profiles || [];
        if (!Array.isArray(arr) || !arr.length) return [];
        return arr.map(a => {
          if (typeof a === "string" || typeof a === "number") return { id: String(a), name: "", provider: "" };
          return {
            id: String(a.id || a.account_id || ""),
            name: a.name || a.username || a.display_name || "",
            provider: (a.provider || a.platform || a.service || a.type || "").toLowerCase(),
          };
        });
      };

      const normPosts = (r, label) => {
        if (!r.ok) return [];
        const arr = Array.isArray(r.data) ? r.data : (r.data?.data || r.data?.posts || []);
        return arr.map(p => ({
          id: p.id,
          text: (p.text || p.content || "").slice(0, 80),
          scheduled_at: p.scheduled_at || p.scheduledAt,
          state: p.state || p.status || label,
          accounts: normAccts(p),
          networks: p.networks ? Object.keys(p.networks) : [],
          error: p.error || p.error_message || null,
        }));
      };

      const schedPosts = normPosts(sched, "scheduled");
      const failedPosts = normPosts(failed, "failed");
      const draftPosts = normPosts(drafts, "draft");
      const rawFirstPost = (() => {
        const arr = Array.isArray(sched.data) ? sched.data : (sched.data?.data || sched.data?.posts || []);
        const darr = Array.isArray(drafts.data) ? drafts.data : (drafts.data?.data || drafts.data?.posts || []);
        return arr[0] || darr[0] || null;
      })();

      return res.json({
        ok: true,
        workspaceId,
        scheduled: { count: schedPosts.length, posts: schedPosts },
        failed: { count: failedPosts.length, posts: failedPosts },
        draft: { count: draftPosts.length, posts: draftPosts },
        // Keep top-level count/posts for backwards compat with UI
        count: schedPosts.length,
        posts: schedPosts,
        // Raw first post from Publer so we can see the actual field names
        _rawSample: rawFirstPost,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

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

  // ── Debug: try multiple endpoint patterns and return full raw responses ───────
  if (action === "debug-post") {
    const targetPlatform = req.body.platform || "instagram";
    const platformMap2 = {
      facebook:  process.env.PUBLER_ACCOUNT_FACEBOOK,
      instagram: process.env.PUBLER_ACCOUNT_INSTAGRAM,
      linkedin:  process.env.PUBLER_ACCOUNT_LINKEDIN,
      twitter:   process.env.PUBLER_ACCOUNT_TWITTER,
    };
    const envAccountId = platformMap2[targetPlatform] || process.env.PUBLER_ACCOUNT_IDS?.split(",")[0]?.trim();
    const envConfigured = Object.fromEntries(
      Object.entries(platformMap2).map(([k,v]) => [k, v ? `...${String(v).slice(-4)}` : "NOT SET"])
    );

    // Always fetch live account list so we can compare env IDs vs what Publer actually has
    const { ok: accOk, data: accData } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const liveAccount = liveAccounts.find(a => {
      const svc = (a.provider || a.platform || a.type || a.service || "").toLowerCase();
      return svc === targetPlatform;
    }) || liveAccounts[0];
    const liveAccountId = liveAccount ? String(liveAccount.id) : envAccountId;
    const liveAccountProvider = liveAccount ? (liveAccount.provider || liveAccount.platform || liveAccount.type || "").toLowerCase() : targetPlatform;

    if (!liveAccountId) {
      return res.json({ ok: false, envConfigured, liveAccounts, error: `No account ID found (env or live) for ${targetPlatform}` });
    }

    const testSchedule = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const attempts = [];

    // Helper: try a pattern, record result
    const tryPost = async (label, path, body, wsHeader = false) => {
      const r = await publerRequest(path, "POST", body, apiKey, wsHeader ? workspaceId : null);
      attempts.push({ path: label, httpStatus: r.status, ok: r.ok, publerResponse: r.data });
      return r;
    };

    // ── Pattern A: profiles array + schedule_time (current format, live account ID)
    const bodyA = { post: { content: "ST1 debug test ✓", profiles: [liveAccountId], schedule_time: testSchedule } };
    const rA = await tryPost(`POST /posts  [profiles+schedule_time, live ID ${liveAccountId.slice(-6)}]`, "/posts", bodyA, true);
    if (rA.ok) return res.json({ ok: true, successPattern: "A", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern B: account_id singular (matches what GET /posts returns in existing posts)
    const bodyB = { post: { content: "ST1 debug test ✓", account_id: liveAccountId, schedule_time: testSchedule } };
    const rB = await tryPost(`POST /posts  [account_id singular, live ID]`, "/posts", bodyB, true);
    if (rB.ok) return res.json({ ok: true, successPattern: "B", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern C: networks object format (mirrors Publer's own GET response structure)
    const bodyC = { post: { content: "ST1 debug test ✓", networks: { [liveAccountProvider]: { account_id: liveAccountId } }, schedule_time: testSchedule } };
    const rC = await tryPost(`POST /posts  [networks object, provider=${liveAccountProvider}]`, "/posts", bodyC, true);
    if (rC.ok) return res.json({ ok: true, successPattern: "C", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern D: scheduled_at instead of schedule_time (some Publer versions use this)
    const bodyD = { post: { content: "ST1 debug test ✓", profiles: [liveAccountId], scheduled_at: testSchedule } };
    const rD = await tryPost(`POST /posts  [profiles+scheduled_at]`, "/posts", bodyD, true);
    if (rD.ok) return res.json({ ok: true, successPattern: "D", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern E: no schedule (immediate post) — strips schedule_time entirely
    const bodyE = { post: { content: "ST1 debug test ✓", profiles: [liveAccountId] } };
    const rE = await tryPost(`POST /posts  [profiles only, no schedule]`, "/posts", bodyE, true);
    if (rE.ok) return res.json({ ok: true, successPattern: "E", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern F: try /social_accounts/{id}/posts (some platforms use account-scoped URLs)
    const rF = await tryPost(`POST /social_accounts/${liveAccountId}/posts`, `/social_accounts/${liveAccountId}/posts`, bodyE, false);
    if (rF.ok) return res.json({ ok: true, successPattern: "F", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern G: bulk format (documented in older Publer API)
    const bodyG = { bulk: { state: "scheduled", posts: [{ content: "ST1 debug test ✓", profiles: [liveAccountId], schedule_time: testSchedule }] } };
    const rG = await tryPost(`POST /posts  [bulk: wrapper]`, "/posts", bodyG, true);
    if (rG.ok) return res.json({ ok: true, successPattern: "G", liveAccountId, envConfigured, liveAccounts, attempts });

    // ── Pattern H: verify GET /accounts matches env var IDs
    const getCheck = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
    attempts.push({ path: "GET /accounts (verify IDs)", httpStatus: getCheck.status, ok: getCheck.ok, publerResponse: getCheck.data });

    return res.json({
      ok: false,
      liveAccountId,
      envAccountId,
      idsMatch: liveAccountId === envAccountId,
      envConfigured,
      liveAccounts: liveAccounts.map(a => ({ id: a.id, provider: a.provider || a.platform || a.type, name: a.name || a.username })),
      scheduleTime: testSchedule,
      attempts,
    });
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

  const activePlatforms = (platforms || []).filter(Boolean);

  // Only include public HTTPS image URLs — base64 / blob URLs won't work with Publer
  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("https://") && !u.startsWith("data:")
  );
  const hasMedia = publicMediaUrls.length > 0;
  const skippedMedia = !hasMedia && (mediaUrls || []).length > 0;

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Always schedule via /posts/schedule so posts appear in Publer's calendar.
  // For "immediate" posts (no scheduleDate), queue 2 min from now so the user
  // can see and cancel in Publer before it fires.
  const TWO_MIN = new Date(Date.now() + 2 * 60 * 1000);
  let scheduledAt;
  if (scheduleDate) {
    const t = new Date(scheduleDate);
    scheduledAt = (t > TWO_MIN ? t : TWO_MIN).toISOString();
  } else {
    scheduledAt = TWO_MIN.toISOString();
  }

  // Publer POST /posts API v1 format:
  //   { post: { content, profiles: [id], schedule_time, media: [{url}], is_story } }
  // One request per platform so each succeeds/fails independently.
  const missingAccounts = [];
  const posts = [];
  for (const platform of activePlatforms) {
    const accountId = platformMap[platform];
    if (!accountId) { missingAccounts.push(platform); continue; }
    posts.push({
      content: postText,
      profiles: [String(accountId)],
      schedule_time: scheduledAt,
      ...(hasMedia ? { media: publicMediaUrls.map(url => ({ url })) } : {}),
      ...(isStory ? { is_story: true } : {}),
    });
  }

  // Fallback: if no platform-specific IDs found, try PUBLER_ACCOUNT_IDS
  if (!posts.length && process.env.PUBLER_ACCOUNT_IDS) {
    const fallbackIds = process.env.PUBLER_ACCOUNT_IDS.split(",").map(s => s.trim()).filter(Boolean);
    posts.push({
      content: postText,
      profiles: fallbackIds,
      schedule_time: scheduledAt,
      ...(hasMedia ? { media: publicMediaUrls.map(url => ({ url })) } : {}),
      ...(isStory ? { is_story: true } : {}),
    });
  }

  if (!posts.length) {
    const missing = missingAccounts.join(", ");
    return res.status(400).json({
      error: `No account IDs configured for: ${missing}. In Settings → Load Accounts, copy the IDs, then add PUBLER_ACCOUNT_FACEBOOK / PUBLER_ACCOUNT_INSTAGRAM (etc.) to Vercel env vars.`,
    });
  }

  // Try workspace-scoped endpoint first (/workspaces/{id}/posts), fall back to /posts with header.
  const postPath = workspaceId ? `/workspaces/${workspaceId}/posts` : "/posts";
  const postApiKey = apiKey;
  const postWsId = workspaceId ? null : null; // workspace already in path

  try {
    const allPostIds = [];
    const errors = [];

    for (const post of posts) {
      const { ok, status: httpStatus, data } = await publerRequest(postPath, "POST", { post }, postApiKey, null);
      if (ok) {
        const parsed = parseSuccess(data, true);
        if (parsed) allPostIds.push(...parsed.postIds);
        else if (data.id) allPostIds.push(String(data.id));
        else if (data.job_id) allPostIds.push(String(data.job_id));
      } else {
        const errMsg = extractError(data);
        errors.push(`${errMsg} (HTTP ${httpStatus})`);
        console.error("[publer] post failed:", JSON.stringify(data).slice(0, 600));
      }
    }

    if (allPostIds.length > 0) {
      const userScheduled = !!scheduleDate;
      return res.json({
        status: "scheduled",
        backend: "publer",
        postIds: allPostIds,
        scheduled: true,
        scheduledAt,
        _userScheduled: userScheduled,
        ...(errors.length ? { _partialErrors: errors } : {}),
        ...(skippedMedia ? { _warning: "Image skipped — must be a public HTTPS URL." } : {}),
        ...(missingAccounts.length ? { _missing: `No account ID configured for: ${missingAccounts.join(", ")} — add to Vercel env vars.` } : {}),
      });
    }

    return res.status(400).json({
      error: errors.join(" | ") || "All platform posts failed",
      backend: "publer",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
