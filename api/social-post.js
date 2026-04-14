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

    // Fetch live accounts
    const { data: accData } = await publerRequest("/accounts", "GET", null, apiKey, workspaceId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const liveAccount = liveAccounts.find(a => {
      const svc = (a.provider || a.platform || a.type || a.service || "").toLowerCase();
      return svc === targetPlatform;
    }) || liveAccounts[0];
    const liveAccountId = liveAccount ? String(liveAccount.id) : envAccountId;
    const liveAccountNum = liveAccountId ? parseInt(liveAccountId, 10) : null;

    if (!liveAccountId) {
      return res.json({ ok: false, liveAccounts, error: `No account ID for ${targetPlatform}` });
    }

    const testSchedule = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const attempts = [];

    // Low-level raw fetch — captures full body regardless of status
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
        try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 500) }; }
        attempts.push({ label, url, httpStatus: r.status, ok: r.ok, response: data });
        return { ok: r.ok, status: r.status, data };
      } catch(e) {
        attempts.push({ label, url, httpStatus: 0, ok: false, response: { error: e.message } });
        return { ok: false, status: 0, data: { error: e.message } };
      }
    };

    const BASE = "https://app.publer.com/api/v1";
    const wsHdr = { "Publer-Workspace-Id": workspaceId };

    // ── Round 1: Confirm /posts is definitely dead ─────────────────────────────
    const r1 = await rawPost("R1: POST /posts [baseline confirm]",
      `${BASE}/posts`,
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } },
      wsHdr);
    if (r1.ok) return res.json({ ok: true, successPattern: "R1", attempts });

    // ── Round 2: /posts/schedule — the 500 endpoint from last run ─────────────
    // Format A: { post: { content, profiles, schedule_time } }
    const r2a = await rawPost("R2a: POST /posts/schedule [post+profiles+schedule_time]",
      `${BASE}/posts/schedule`,
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } },
      wsHdr);
    if (r2a.ok) return res.json({ ok: true, successPattern: "R2a", attempts });

    // Format B: { content, profiles, schedule_time } (flat, no post wrapper)
    const r2b = await rawPost("R2b: POST /posts/schedule [flat+profiles+schedule_time]",
      `${BASE}/posts/schedule`,
      { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule },
      wsHdr);
    if (r2b.ok) return res.json({ ok: true, successPattern: "R2b", attempts });

    // Format C: { post: { content, account_ids: [num], scheduled_at } }
    const idArr = liveAccountNum ? [liveAccountNum] : [liveAccountId];
    const r2c = await rawPost("R2c: POST /posts/schedule [account_ids numeric, scheduled_at]",
      `${BASE}/posts/schedule`,
      { post: { content: "ST1 test", account_ids: idArr, scheduled_at: testSchedule } },
      wsHdr);
    if (r2c.ok) return res.json({ ok: true, successPattern: "R2c", attempts });

    // Format D: profiles as integers
    const r2d = await rawPost("R2d: POST /posts/schedule [profiles numeric]",
      `${BASE}/posts/schedule`,
      { post: { content: "ST1 test", profiles: idArr, schedule_time: testSchedule } },
      wsHdr);
    if (r2d.ok) return res.json({ ok: true, successPattern: "R2d", attempts });

    // Format E: no schedule (immediate)
    const r2e = await rawPost("R2e: POST /posts/schedule [no schedule time]",
      `${BASE}/posts/schedule`,
      { post: { content: "ST1 test", profiles: [liveAccountId] } },
      wsHdr);
    if (r2e.ok) return res.json({ ok: true, successPattern: "R2e", attempts });

    // ── Round 3: Publer v2 API variations ─────────────────────────────────────
    const r3a = await rawPost("R3a: POST /api/v2/posts [v2, profiles array]",
      "https://app.publer.com/api/v2/posts",
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } });
    if (r3a.ok) return res.json({ ok: true, successPattern: "R3a", attempts });

    const r3b = await rawPost("R3b: POST /api/v2/posts/schedule [v2 schedule]",
      "https://app.publer.com/api/v2/posts/schedule",
      { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } },
      wsHdr);
    if (r3b.ok) return res.json({ ok: true, successPattern: "R3b", attempts });

    // ── Round 4: Form-encoded (the other 500 endpoint) ────────────────────────
    try {
      const fHeaders = {
        Authorization: `Bearer-API ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Publer-Workspace-Id": workspaceId,
      };
      // Build form manually to avoid bracket issues
      const formParts = [
        `post[content]=ST1+test`,
        `post[profiles][]=${encodeURIComponent(liveAccountId)}`,
        `post[schedule_time]=${encodeURIComponent(testSchedule)}`,
      ];
      const r4a = await fetch(`${BASE}/posts`, { method: "POST", headers: fHeaders, body: formParts.join("&") });
      const t4a = await r4a.text();
      let d4a; try { d4a = JSON.parse(t4a); } catch { d4a = { _raw: t4a.slice(0, 500) }; }
      attempts.push({ label: "R4a: POST /posts [form-encoded, brackets]", url: `${BASE}/posts`, httpStatus: r4a.status, ok: r4a.ok, response: d4a });
      if (r4a.ok) return res.json({ ok: true, successPattern: "R4a", attempts });

      // Also try /posts/schedule form-encoded
      const r4b = await fetch(`${BASE}/posts/schedule`, { method: "POST", headers: fHeaders, body: formParts.join("&") });
      const t4b = await r4b.text();
      let d4b; try { d4b = JSON.parse(t4b); } catch { d4b = { _raw: t4b.slice(0, 500) }; }
      attempts.push({ label: "R4b: POST /posts/schedule [form-encoded]", url: `${BASE}/posts/schedule`, httpStatus: r4b.status, ok: r4b.ok, response: d4b });
      if (r4b.ok) return res.json({ ok: true, successPattern: "R4b", attempts });
    } catch(fe) {
      attempts.push({ label: "R4: form-encoded", error: fe.message });
    }

    // ── Round 5: Alternative paths ─────────────────────────────────────────────
    for (const [label, path] of [
      ["R5a: POST /schedule", "/schedule"],
      ["R5b: POST /scheduled_posts", "/scheduled_posts"],
      ["R5c: POST /publish", "/publish"],
    ]) {
      const r = await rawPost(label, `${BASE}${path}`,
        { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } },
        wsHdr);
      if (r.ok) return res.json({ ok: true, successPattern: label, attempts });
    }

    // Summarize which returned non-404 (those endpoints exist)
    const nonFour04 = attempts.filter(a => a.httpStatus !== 404 && a.httpStatus !== 0);

    return res.json({
      ok: false,
      liveAccountId,
      liveAccountNum,
      liveAccounts: liveAccounts.map(a => ({ id: a.id, type: a.provider||a.platform||a.type, name: a.name||a.username })),
      diagnosis: nonFour04.length
        ? `These endpoints responded with non-404 (may exist!): ${nonFour04.map(a=>`${a.label} → HTTP ${a.httpStatus}`).join(" | ")}`
        : "All endpoints returned 404 — API key may be read-only or Publer has changed their API paths.",
      nonFour04Attempts: nonFour04,
      allAttempts: attempts,
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
