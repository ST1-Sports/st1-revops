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

  // ── Debug: confirm workspace ID is the problem + try live workspace ID ────────
  if (action === "debug-post") {
    // Show stored workspace ID details
    const storedWsId = workspaceId;
    const wsIdTail = storedWsId ? `...${String(storedWsId).slice(-6)}` : "NOT SET";
    const wsIdLen  = storedWsId ? String(storedWsId).length : 0;

    // Fetch live workspace IDs directly from Publer (no workspace header needed for this)
    const { ok: wsOk, data: wsData } = await publerRequest("/workspaces", "GET", null, apiKey);
    const liveWorkspaces = Array.isArray(wsData) ? wsData : (wsData?.data || wsData?.workspaces || []);
    const liveWsId = liveWorkspaces[0] ? String(liveWorkspaces[0].id) : null;

    // Fetch live accounts
    const { data: accData } = await publerRequest("/accounts", "GET", null, apiKey, storedWsId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const liveAccountId = liveAccounts[0] ? String(liveAccounts[0].id) : null;

    if (!liveAccountId) {
      return res.json({ ok: false, wsIdTail, wsIdLen, storedWsId, liveWsId, liveWorkspaces, liveAccounts, error: "No account ID found in GET /accounts" });
    }

    const testSchedule = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const attempts = [];
    const BASE = "https://app.publer.com/api/v1";
    const postBody = { post: { content: "ST1 test", profiles: [liveAccountId], schedule_time: testSchedule } };

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
        attempts.push({ label, httpStatus: r.status, ok: r.ok, response: data });
        return { ok: r.ok, status: r.status, data };
      } catch(e) {
        attempts.push({ label, httpStatus: 0, ok: false, response: { error: e.message } });
        return { ok: false, status: 0, data: { error: e.message } };
      }
    };

    // S1: stored workspace ID — we know this 500s
    const r1 = await rawPost("S1: /posts/schedule [STORED workspace ID]",
      `${BASE}/posts/schedule`, postBody,
      storedWsId ? { "Publer-Workspace-Id": storedWsId } : {});
    if (r1.ok) return res.json({ ok: true, successPattern: "S1", usedWsId: storedWsId, attempts });

    // S2: live workspace ID fetched fresh from GET /workspaces — the real fix
    if (liveWsId && liveWsId !== storedWsId) {
      const r2 = await rawPost(`S2: /posts/schedule [LIVE workspace ID ${liveWsId}]`,
        `${BASE}/posts/schedule`, postBody,
        { "Publer-Workspace-Id": liveWsId });
      if (r2.ok) return res.json({ ok: true, successPattern: "S2", usedWsId: liveWsId, note: "SUCCESS with live workspace ID — update PUBLER_WORKSPACE_ID env var to: " + liveWsId, attempts });
    } else if (liveWsId) {
      attempts.push({ label: "S2: skipped (live ID == stored ID)", httpStatus: 0, ok: false, response: { note: "same as S1" } });
    }

    // S3: try each live workspace ID if there are multiple
    for (let i = 0; i < liveWorkspaces.length; i++) {
      const wsId = String(liveWorkspaces[i].id);
      if (wsId === storedWsId) continue; // already tried in S1
      const r = await rawPost(`S3.${i}: /posts/schedule [workspace ${wsId}]`,
        `${BASE}/posts/schedule`, postBody,
        { "Publer-Workspace-Id": wsId });
      if (r.ok) return res.json({ ok: true, successPattern: `S3.${i}`, usedWsId: wsId, note: "SUCCESS — update PUBLER_WORKSPACE_ID to: " + wsId, attempts });
    }

    // S4: try without any workspace header (got 401 last time — expected but confirms endpoint exists)
    const r4 = await rawPost("S4: /posts/schedule [no workspace header]",
      `${BASE}/posts/schedule`, postBody, {});
    if (r4.ok) return res.json({ ok: true, successPattern: "S4", attempts });

    // S5: if still failing with live workspace ID, try the workspace ID as integer
    if (liveWsId) {
      const wsInt = parseInt(liveWsId, 10);
      if (!isNaN(wsInt) && String(wsInt) !== liveWsId) {
        const r5 = await rawPost(`S5: /posts/schedule [live workspace as integer ${wsInt}]`,
          `${BASE}/posts/schedule`, postBody,
          { "Publer-Workspace-Id": String(wsInt) });
        if (r5.ok) return res.json({ ok: true, successPattern: "S5", usedWsId: wsInt, attempts });
      }
    }

    const byStatus = {};
    for (const a of attempts) {
      const k = String(a.httpStatus);
      if (!byStatus[k]) byStatus[k] = [];
      byStatus[k].push(a.label);
    }

    return res.json({
      ok: false,
      storedWsId,
      liveWsId,
      wsIdMatch: storedWsId === liveWsId,
      workspaceIdInfo: { tail: wsIdTail, length: wsIdLen },
      liveWorkspaces: liveWorkspaces.map(w => ({ id: w.id, name: w.name || w.title })),
      liveAccountId,
      liveAccounts: liveAccounts.map(a => ({ id: a.id, type: a.provider||a.platform||a.type, name: a.name||a.username })),
      statusSummary: byStatus,
      diagnosis: liveWsId && liveWsId !== storedWsId
        ? `Stored PUBLER_WORKSPACE_ID (${wsIdTail}) != live workspace ID (${liveWsId}). Update the env var and redeploy.`
        : "Workspace IDs match but still 500 — Publer server error on this workspace or plan restriction.",
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

  // Use /posts/schedule (confirmed live endpoint). Always fetch the workspace ID
  // fresh from GET /workspaces so a stale env var doesn't break posting.
  let effectiveWsId = workspaceId;
  try {
    const { ok: wsOk, data: wsData } = await publerRequest("/workspaces", "GET", null, apiKey);
    const ws = Array.isArray(wsData) ? wsData : (wsData?.data || wsData?.workspaces || []);
    if (ws[0]?.id) effectiveWsId = String(ws[0].id);
  } catch {}

  try {
    const allPostIds = [];
    const errors = [];

    for (const post of posts) {
      const { ok, status: httpStatus, data } = await publerRequest(
        "/posts/schedule", "POST", { post }, apiKey, effectiveWsId);
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
