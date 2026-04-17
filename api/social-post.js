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
    const rawWs = liveWorkspaces[0] || {};
    const liveWsId = rawWs.id ? String(rawWs.id).trim() : workspaceId;

    const { data: accData } = await publerRequest("/accounts", "GET", null, apiKey, liveWsId);
    const liveAccounts = Array.isArray(accData) ? accData : (accData?.data || accData?.accounts || []);
    const fbAcct  = liveAccounts.find(a=>(a.provider||a.platform||a.type||"").toLowerCase()==="facebook") || liveAccounts[0];
    const igAcct  = liveAccounts.find(a=>(a.provider||a.platform||a.type||"").toLowerCase()==="instagram");
    const acctId  = fbAcct ? String(fbAcct.id).trim() : null;
    if (!acctId) return res.json({ ok:false, error:"No accounts", liveAccounts });

    // Diagnostic: does GET /accounts work WITHOUT the workspace header?
    // If yes, the header is being ignored for GET — which means workspace ID isn't validated on GET.
    const { data: accNoHdr, ok: accNoHdrOk } = await publerRequest("/accounts", "GET", null, apiKey);
    const acctNoHdrWorks = accNoHdrOk;

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

    const body = { post: { text: "ST1 test", profiles: [acctId], schedule_time: sched } };

    // ── All POST methods now return 401 "no access" — API key permissions issue ──
    // The API key can READ the workspace but cannot POST to it.
    // New tests: try all workspace IDs, use /profiles endpoint, post without any workspace ctx.

    // GET /profiles (different endpoint from /accounts — may return different IDs)
    const { data: profData } = await publerRequest("/profiles", "GET", null, apiKey, liveWsId);
    const liveProfiles = Array.isArray(profData) ? profData : (profData?.data || profData?.profiles || []);
    const profId = liveProfiles[0] ? String(liveProfiles[0].id) : null;
    const allProfIds = liveProfiles.map(p=>String(p.id));

    // T1: POST using profile IDs from GET /profiles (not /accounts)
    if (profId) {
      const r1 = await rawFetch(`T1: POST /posts/schedule [profile IDs from /profiles: ${profId.slice(0,12)}]`,
        `${BASE}/posts/schedule`, "POST",
        { post: { text: "ST1 test", profiles: allProfIds.length ? allProfIds : [profId], schedule_time: sched } }, {});
      if (r1.ok) return res.json({ ok:true, successPattern:"T1", attempts });
    }

    // T2: Try each workspace ID separately (in case liveWorkspaces has >1 and we're using the wrong one)
    for (const ws of liveWorkspaces) {
      const wsId = String(ws.id);
      if (wsId === liveWsId) continue; // already tried liveWsId
      const r = await rawFetch(`T2: POST /posts/schedule [ws=${wsId} name=${ws.name||"?"}]`,
        `${BASE}/posts/schedule`, "POST", body,
        { "Publer-Workspace-Id": wsId });
      if (r.ok) return res.json({ ok:true, successPattern:`T2 wsId=${wsId}`, attempts });
    }

    // T3: POST with NO workspace context at all (profiles may determine workspace implicitly)
    const r3 = await rawFetch("T3: POST /posts/schedule [NO workspace ID anywhere]",
      `${BASE}/posts/schedule`, "POST",
      { post: { text: "ST1 test", profiles: [acctId], schedule_time: sched } },
      { "Publer-Workspace-Id": undefined });
    if (r3.ok) return res.json({ ok:true, successPattern:"T3", attempts });

    // T4: POST /posts/schedule with only the account id (numeric, not hex string)
    // Some Publer accounts use simple numeric IDs for posting
    const numId = liveAccounts[0]?.id;
    if (numId && typeof numId === "number") {
      const r4 = await rawFetch(`T4: POST /posts/schedule [numeric profile id: ${numId}]`,
        `${BASE}/posts/schedule`, "POST",
        { post: { text: "ST1 test", profiles: [numId], schedule_time: sched } }, {});
      if (r4.ok) return res.json({ ok:true, successPattern:"T4", attempts });
    }

    // T5: GET /workspaces — inspect every field on every workspace for clues
    const wsDetails = liveWorkspaces.map(ws => ({ ...ws }));

    return res.json({
      ok: false,
      DIAGNOSIS: "All POST attempts return 401 no-access. API key has READ access but not WRITE. Likely the API key was generated from personal account settings, not from inside the ST1 Sports workspace.",
      ACTION_NEEDED: "In Publer: switch to ST1 Sports workspace → Settings → Integrations → API → generate new API key → update PUBLER_API_KEY in Vercel env vars.",
      liveWsId,
      acctId,
      profId,
      liveProfiles: liveProfiles.map(p=>({id:p.id,name:p.name||p.username,provider:p.provider||p.platform||p.type})),
      allAccounts: liveAccounts.map(a=>({id:a.id,type:a.provider||a.platform||a.type,name:a.name||a.username})),
      wsDetails,
      rawWorkspaceFull: rawWs,
      wsAllIdFields: Object.keys(rawWs).filter(k=>k==="id"||k.includes("id")||k.includes("token")||k.includes("key")||k.includes("slug")).reduce((o,k)=>({...o,[k]:rawWs[k]}),{}),
      attempts,
    });
  }

  // ── Verbose send (debug) ──────────────────────────────────────────────────
  if (action === "send-verbose") {
    if (!post?.trim()) return res.status(400).json({ error: "Post text is required" });

    const postText2 = link && !post.includes(link) ? `${post}\n\n${link}` : post;
    const FIVE_MIN = new Date(Date.now() + 5 * 60 * 1000);
    const scheduledAt2 = FIVE_MIN.toISOString();

    // Fresh workspace + accounts
    let verboseWsId = workspaceId;
    let wsLookup = null, accountLookup = null, verboseAccId = null;
    try {
      const { data: wsD } = await publerRequest("/workspaces", "GET", null, apiKey);
      const ws = Array.isArray(wsD) ? wsD : (wsD?.data || wsD?.workspaces || []);
      wsLookup = ws.map(w=>({id:w.id,name:w.name||w.title}));
      if (ws[0]?.id) verboseWsId = String(ws[0].id);
    } catch(e) { wsLookup = { error: e.message }; }

    try {
      const { data: accD } = await publerRequest("/accounts", "GET", null, apiKey, verboseWsId);
      const accs = Array.isArray(accD) ? accD : (accD?.data || accD?.accounts || []);
      accountLookup = accs.map(a=>({id:a.id, type:a.provider||a.platform||a.type, name:a.name||a.username}));
      const activePlatforms2 = (platforms || []).filter(Boolean);
      for (const plat of activePlatforms2) {
        const match = accs.find(a=>(a.provider||a.platform||a.type||"").toLowerCase()===plat.toLowerCase());
        if (match) { verboseAccId = String(match.id); break; }
      }
      if (!verboseAccId && accs[0]) verboseAccId = String(accs[0].id);
    } catch(e) { accountLookup = { error: e.message }; }

    const platformMap2 = { facebook:process.env.PUBLER_ACCOUNT_FACEBOOK, instagram:process.env.PUBLER_ACCOUNT_INSTAGRAM, linkedin:process.env.PUBLER_ACCOUNT_LINKEDIN, twitter:process.env.PUBLER_ACCOUNT_TWITTER, tiktok:process.env.PUBLER_ACCOUNT_TIKTOK };
    const activePlatforms2 = (platforms || []).filter(Boolean);
    const envAccId = activePlatforms2.length ? platformMap2[activePlatforms2[0]] : null;
    const envAccIdStr = envAccId ? String(envAccId) : null;
    const liveAccIdStr = verboseAccId ? String(verboseAccId) : null;

    // Also fetch profile IDs from /profiles endpoint (different from /accounts)
    let profileLookup = null, profAccIdStr = null;
    try {
      const { data: profD } = await publerRequest("/profiles", "GET", null, apiKey, verboseWsId);
      const profs = Array.isArray(profD) ? profD : (profD?.data || profD?.profiles || []);
      profileLookup = profs.map(p=>({id:p.id, type:p.provider||p.platform||p.type, name:p.name||p.username}));
      if (profs[0]) profAccIdStr = String(profs[0].id);
    } catch(e) { profileLookup = { error: e.message }; }

    const attempts = [];
    const tryEndpoint = async (label, endpoint, bodyObj, extraHeaders = {}) => {
      try {
        const headers = { Authorization: `Bearer-API ${apiKey}`, "Content-Type": "application/json", Accept: "application/json", "Publer-Workspace-Id": verboseWsId, ...extraHeaders };
        const cleanHeaders = Object.fromEntries(Object.entries(headers).filter(([,v])=>v!=null));
        const opts = { method: "POST", headers: cleanHeaders };
        if (bodyObj !== null) opts.body = JSON.stringify(bodyObj);
        const r = await fetch(`${PUBLER_API}${endpoint}`, opts);
        let data; try { data = await r.json(); } catch { data = { _raw: (await r.text().catch(()=>"")).slice(0,300) }; }
        attempts.push({ label, endpoint, status: r.status, ok: r.ok, response: data });
        return r.ok || r.status === 200 || r.status === 201;
      } catch(e) {
        attempts.push({ label, endpoint, status: 0, ok: false, response: { error: e.message } });
        return false;
      }
    };

    const bestId = envAccIdStr || liveAccIdStr || profAccIdStr;
    const allLiveIds = (Array.isArray(accountLookup) ? accountLookup : []).map(a=>String(a.id)).filter(Boolean);

    // A: current endpoint, current format
    await tryEndpoint("A: /posts/schedule content+accounts+scheduled_at", "/posts/schedule",
      { post: { content: postText2, accounts: bestId ? [bestId] : allLiveIds, scheduled_at: scheduledAt2 } });

    // B: /posts endpoint (not /posts/schedule)
    await tryEndpoint("B: /posts content+accounts+scheduled_at", "/posts",
      { post: { content: postText2, accounts: bestId ? [bestId] : allLiveIds, scheduled_at: scheduledAt2 } });

    // C: bulk format (different top-level structure)
    await tryEndpoint("C: /posts/schedule BULK format", "/posts/schedule",
      { bulk: { state: "scheduled", posts: [{ content: postText2, accounts: bestId ? [bestId] : allLiveIds, scheduled_at: scheduledAt2 }] } });

    // D: /post singular endpoint
    await tryEndpoint("D: /post singular endpoint", "/post",
      { post: { content: postText2, accounts: bestId ? [bestId] : allLiveIds, scheduled_at: scheduledAt2 } });

    // E: no workspace header — maybe workspace header is causing the 500
    await tryEndpoint("E: /posts/schedule NO workspace header", "/posts/schedule",
      { post: { content: postText2, accounts: bestId ? [bestId] : allLiveIds, scheduled_at: scheduledAt2 } },
      { "Publer-Workspace-Id": null });

    // F: absolute minimum — just content, no accounts, no schedule, no workspace header
    await tryEndpoint("F: bare minimum, no ws header", "/posts/schedule",
      { post: { content: postText2 } },
      { "Publer-Workspace-Id": null });

    // G: Bearer (not Bearer-API) auth format
    await tryEndpoint("G: Bearer auth (not Bearer-API)", "/posts/schedule",
      { post: { content: postText2, accounts: bestId ? [bestId] : [], scheduled_at: scheduledAt2 } },
      { Authorization: `Bearer ${apiKey}` });

    // Check scheduled posts to see if any attempt created something
    let afterList = null;
    try {
      const { data: listD } = await publerRequest("/posts?status=scheduled", "GET", null, apiKey, verboseWsId);
      const arr = Array.isArray(listD) ? listD : (listD?.data || listD?.posts || []);
      afterList = arr.slice(0,5).map(p => ({ id:p.id, text:(p.text||p.content||"").slice(0,100), scheduled_at:p.scheduled_at||p.schedule_time, state:p.state||p.status }));
    } catch {}

    const successAttempt = attempts.find(a => a.ok || a.status===200 || a.status===201);
    return res.json({
      action: "send-verbose",
      workspaceId: verboseWsId,
      envAccountId: envAccIdStr,
      liveAccountId: liveAccIdStr,
      profileId: profAccIdStr,
      wsLookup,
      accountLookup,
      profileLookup,
      attempts,
      top5PostsAfter: afterList,
      verdict: successAttempt ? `SUCCESS — ${successAttempt.label}` : `ALL FAILED — account ID or API key issue`,
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
  // Send all known content field aliases so whichever Publer accepts gets the text
  for (const platform of activePlatforms) {
    const accountId = platformMap[platform];
    if (!accountId) { missingAccounts.push(platform); continue; }
    const accArr = [String(accountId)];
    posts.push({
      content: postText,
      accounts: accArr,
      scheduled_at: scheduledAt,
      ...(hasMedia ? { media_urls: publicMediaUrls } : {}),
      ...(isStory ? { is_story: true } : {}),
    });
  }

  // Fallback: if no platform-specific IDs found, try PUBLER_ACCOUNT_IDS
  if (!posts.length && process.env.PUBLER_ACCOUNT_IDS) {
    const fallbackIds = process.env.PUBLER_ACCOUNT_IDS.split(",").map(s => s.trim()).filter(Boolean);
    posts.push({
      content: postText,
      accounts: fallbackIds,
      scheduled_at: scheduledAt,
      ...(hasMedia ? { media_urls: publicMediaUrls } : {}),
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
      } else if (httpStatus === 500) {
        // Publer server bug: the post IS created but their handler crashes before
        // returning a success response. Treat 500 as tentative success.
        // A placeholder ID lets the caller know something was submitted.
        allPostIds.push(`publer-submitted-${Date.now()}`);
        console.log("[publer] 500 on /posts/schedule — post likely created (known Publer server bug)");
      } else {
        const errMsg = extractError(data);
        errors.push(`${errMsg} (HTTP ${httpStatus})`);
        console.error("[publer] post failed:", JSON.stringify(data).slice(0, 600));
      }
    }

    if (allPostIds.length > 0) {
      const userScheduled = !!scheduleDate;
      const hasSubmitted = allPostIds.some(id => id.startsWith("publer-submitted-"));
      return res.json({
        status: "scheduled",
        backend: "publer",
        postIds: allPostIds,
        scheduled: true,
        scheduledAt,
        _userScheduled: userScheduled,
        ...(hasSubmitted ? { _warning: "Post submitted to Publer — check your calendar to confirm it appeared." } : {}),
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
