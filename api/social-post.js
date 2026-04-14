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
    // Expose workspace ID (last 6 chars) so we can verify it looks right
    const wsIdTail = workspaceId ? `...${String(workspaceId).slice(-6)}` : "NOT SET";
    const wsIdLen  = workspaceId ? String(workspaceId).length : 0;

    // Fetch live accounts
    const { data: accData } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const liveAccountId = liveAccounts[0] ? String(liveAccounts[0].id) : null;

    if (!liveAccountId) {
      return res.json({ ok: false, wsIdTail, wsIdLen, liveAccounts, error: "No account ID found in GET /accounts" });
    }

    const testSchedule = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const attempts = [];

    // Low-level raw fetch — captures full body + selected response headers
    const rawPost = async (label, url, body, extraHeaders = {}) => {
      const headers = {
        Authorization: `Bearer-API ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      };
      try {
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 800) }; }
        // Capture any extra error info from headers
        const xError = r.headers.get("x-error") || r.headers.get("x-message") || r.headers.get("x-exception") || null;
        attempts.push({ label, httpStatus: r.status, ok: r.ok, response: data, xError });
        return { ok: r.ok, status: r.status, data };
      } catch(e) {
        attempts.push({ label, httpStatus: 0, ok: false, response: { error: e.message } });
        return { ok: false, status: 0, data: { error: e.message } };
      }
    };

    const BASE = "https://app.publer.com/api/v1";
    const wsHdr = { "Publer-Workspace-Id": workspaceId };
    const body = { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } };

    // ── Confirm: /posts/schedule with workspace header (from last run → 500) ──
    const rBase = await rawPost("S1: /posts/schedule [WITH workspace header]",
      `${BASE}/posts/schedule`, body, wsHdr);
    if (rBase.ok) return res.json({ ok: true, successPattern: "S1", attempts });

    // ── Key test: /posts/schedule WITHOUT workspace header ─────────────────────
    // If this changes the response (e.g. goes 422/400 instead of 500), the
    // workspace ID is the problem.
    const rNoWs = await rawPost("S2: /posts/schedule [NO workspace header]",
      `${BASE}/posts/schedule`, body, {});
    if (rNoWs.ok) return res.json({ ok: true, successPattern: "S2", attempts });

    // ── Key test: workspace_id in body instead of header ──────────────────────
    const rWsBody = await rawPost("S3: /posts/schedule [workspace_id in body]",
      `${BASE}/posts/schedule`,
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule, workspace_id: workspaceId } },
      {});
    if (rWsBody.ok) return res.json({ ok: true, successPattern: "S3", attempts });

    // ── Key test: workspace ID in URL path ─────────────────────────────────────
    const rWsPath = await rawPost(`S4: /workspaces/${workspaceId}/posts/schedule [ws in URL]`,
      `${BASE}/workspaces/${workspaceId}/posts/schedule`,
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } },
      {});
    if (rWsPath.ok) return res.json({ ok: true, successPattern: "S4", attempts });

    // ── Minimal body: just text, no profiles, no schedule ──────────────────────
    // If this returns a different error (like "profiles required"), we'll learn
    // what fields Publer actually validates.
    const rMin = await rawPost("S5: /posts/schedule [minimal: just text]",
      `${BASE}/posts/schedule`, { post: { content: "ST1 test" } }, wsHdr);
    if (rMin.ok) return res.json({ ok: true, successPattern: "S5", attempts });

    const rEmpty = await rawPost("S6: /posts/schedule [empty body {}]",
      `${BASE}/posts/schedule`, {}, wsHdr);
    if (rEmpty.ok) return res.json({ ok: true, successPattern: "S6", attempts });

    // ── Try Bearer (not Bearer-API) on /posts/schedule ────────────────────────
    // Checks if POST endpoints require different auth header than GET
    try {
      const r7 = await fetch(`${BASE}/posts/schedule`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Publer-Workspace-Id": workspaceId,
        },
        body: JSON.stringify(body),
      });
      const t7 = await r7.text();
      let d7; try { d7 = JSON.parse(t7); } catch { d7 = { _raw: t7.slice(0, 500) }; }
      attempts.push({ label: "S7: /posts/schedule [Bearer (not Bearer-API)]", httpStatus: r7.status, ok: r7.ok, response: d7 });
      if (r7.ok) return res.json({ ok: true, successPattern: "S7", attempts });
    } catch(e) {
      attempts.push({ label: "S7: Bearer", error: e.message });
    }

    // ── Summarize ──────────────────────────────────────────────────────────────
    const byStatus = {};
    for (const a of attempts) {
      const k = String(a.httpStatus);
      byStatus[k] = (byStatus[k] || []);
      byStatus[k].push(a.label);
    }

    return res.json({
      ok: false,
      workspaceIdInfo: { tail: wsIdTail, length: wsIdLen },
      liveAccountId,
      liveAccounts: liveAccounts.map(a => ({ id: a.id, type: a.provider||a.platform||a.type, name: a.name||a.username })),
      statusSummary: byStatus,
      diagnosis: "See statusSummary — if S1 (with ws header) = 500 but S2 (without) = 422/400, the workspace ID is wrong. If both 500, something else.",
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
