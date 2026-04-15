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

  // ── Debug ─────────────────────────────────────────────────────────────────────
  if (action === "debug-post") {
    const BASE = "https://app.publer.com/api/v1";

    const { data: wsData }  = await publerRequest("/workspaces", "GET", null, apiKey);
    const liveWorkspaces = Array.isArray(wsData) ? wsData : (wsData?.data || wsData?.workspaces || []);
    const liveWsId = liveWorkspaces[0] ? String(liveWorkspaces[0].id) : workspaceId;

    const { data: accData } = await publerRequest("/accounts", "GET", null, apiKey, liveWsId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const fbAcct  = liveAccounts.find(a=>(a.provider||a.platform||a.type||"").toLowerCase()==="facebook") || liveAccounts[0];
    const igAcct  = liveAccounts.find(a=>(a.provider||a.platform||a.type||"").toLowerCase()==="instagram");
    const acctId  = fbAcct ? String(fbAcct.id) : null;
    if (!acctId) return res.json({ ok:false, error:"No accounts", liveAccounts });

    const sched = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const attempts = [];

    // Full raw fetch with header inspection
    // Pass { "Publer-Workspace-Id": undefined } in extraHeaders to OMIT that header
    const rawFetch = async (label, url, method, reqBody, extraHeaders = {}) => {
      const base = {
        Authorization: `Bearer-API ${apiKey}`,
        Accept: "application/json",
        "Publer-Workspace-Id": liveWsId,
      };
      // Merge, then delete any keys explicitly set to undefined
      const merged = { ...base, ...extraHeaders };
      const headers = Object.fromEntries(Object.entries(merged).filter(([,v]) => v !== undefined));
      if (reqBody !== null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const opts = { method, headers };
      if (reqBody !== null) opts.body = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody);
      try {
        const r = await fetch(url, opts);
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0,1000) }; }
        // Capture any informative response headers
        const hdrs = {};
        for (const [k,v] of r.headers.entries()) {
          if (["content-type","x-error","x-message","x-exception","x-request-id","www-authenticate","cf-ray","x-runtime"].includes(k.toLowerCase())) {
            hdrs[k] = v;
          }
        }
        attempts.push({ label, httpStatus: r.status, ok: r.ok, responseBody: data, responseHeaders: hdrs });
        return { ok: r.ok, status: r.status, data };
      } catch(e) {
        attempts.push({ label, httpStatus: 0, ok: false, responseBody: { error: e.message } });
        return { ok: false, status: 0, data: {} };
      }
    };

    const body = { post: { content: "ST1 test", profiles: [acctId], schedule_time: sched } };

    // ── Diagnostic: does removing the workspace header change 500→401? ──────────
    // If T1 (no header) → 401 and T2 (with header) → 500, the header IS the trigger.
    // If both → 500, the workspace header isn't the problem.

    // T1: NO workspace header at all
    const r1 = await rawFetch("T1: POST /posts/schedule [NO workspace header]",
      `${BASE}/posts/schedule`, "POST", body,
      { "Publer-Workspace-Id": undefined });
    if (r1.ok) return res.json({ ok:true, successPattern:"T1", attempts });

    // T2: workspace ID in URL path instead of header — /workspaces/{id}/posts
    const r2 = await rawFetch("T2: POST /workspaces/{id}/posts [workspace in URL]",
      `${BASE}/workspaces/${liveWsId}/posts`, "POST", body,
      { "Publer-Workspace-Id": undefined });
    if (r2.ok) return res.json({ ok:true, successPattern:"T2", attempts });

    // T3: workspace in URL — /workspaces/{id}/posts/schedule
    const r3 = await rawFetch("T3: POST /workspaces/{id}/posts/schedule [workspace in URL]",
      `${BASE}/workspaces/${liveWsId}/posts/schedule`, "POST", body,
      { "Publer-Workspace-Id": undefined });
    if (r3.ok) return res.json({ ok:true, successPattern:"T3", attempts });

    // T4: use `accounts` instead of `profiles` (alternate field name in Publer docs)
    const r4 = await rawFetch("T4: POST /posts/schedule [accounts[] not profiles[]]",
      `${BASE}/posts/schedule`, "POST",
      { post: { content: "ST1 test", accounts: [acctId], schedule_time: sched } }, {});
    if (r4.ok) return res.json({ ok:true, successPattern:"T4", attempts });

    // T5: use `scheduled_at` instead of `schedule_time`
    const r5 = await rawFetch("T5: POST /posts/schedule [scheduled_at not schedule_time]",
      `${BASE}/posts/schedule`, "POST",
      { post: { content: "ST1 test", profiles: [acctId], scheduled_at: sched } }, {});
    if (r5.ok) return res.json({ ok:true, successPattern:"T5", attempts });

    // T6: URL-encoded body (some Rails APIs only accept this, not JSON, for POST)
    const urlBody = `post[content]=ST1+test&post[profiles][]=${encodeURIComponent(acctId)}&post[schedule_time]=${encodeURIComponent(sched)}`;
    const r6 = await rawFetch("T6: POST /posts/schedule [application/x-www-form-urlencoded]",
      `${BASE}/posts/schedule`, "POST", urlBody,
      { "Content-Type": "application/x-www-form-urlencoded" });
    if (r6.ok) return res.json({ ok:true, successPattern:"T6", attempts });

    // T7: use Authorization: Bearer (not Bearer-API) — maybe POST uses different auth
    const r7 = await rawFetch("T7: POST /posts/schedule [Bearer not Bearer-API]",
      `${BASE}/posts/schedule`, "POST", body,
      { Authorization: `Bearer ${apiKey}` });
    if (r7.ok) return res.json({ ok:true, successPattern:"T7", attempts });

    // T8: plural wrapper — { posts: [{ ... }] } instead of { post: { ... } }
    const r8 = await rawFetch("T8: POST /posts/schedule [posts:[] plural wrapper]",
      `${BASE}/posts/schedule`, "POST",
      { posts: [{ content: "ST1 test", profiles: [acctId], schedule_time: sched }] }, {});
    if (r8.ok) return res.json({ ok:true, successPattern:"T8", attempts });

    return res.json({
      ok: false,
      liveWsId,
      acctId,
      liveAccounts: liveAccounts.map(a=>({ id:a.id, type:a.provider||a.platform||a.type, name:a.name||a.username, needs_reconnect:a.needs_reconnect })),
      attempts,
      note: "Key diagnostic: if T1 (no header) returns 401 but T2/T3+ return 500, the workspace header is the crash trigger. If T2 or T3 return 404 we know the URL path structure.",
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
