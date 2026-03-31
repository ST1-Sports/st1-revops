/**
 * /api/social-post  — Social media posting via Publer
 *
 * Required env vars:
 *   PUBLER_API_KEY    — from app.publer.io → Settings → API
 *
 * Optional (per-platform account IDs):
 *   PUBLER_ACCOUNT_FACEBOOK / INSTAGRAM / LINKEDIN / TWITTER / TIKTOK
 *   PUBLER_ACCOUNT_IDS  — comma-separated fallback
 *
 * POST body actions:
 *   action="test"     → verify API key
 *   action="profiles" → list connected accounts
 *   (default)         → post or schedule
 */

const PUBLER_API = "https://app.publer.com/api/v1";

async function publerRequest(path, method = "GET", body = null, apiKey) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer-API ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${PUBLER_API}${path}`, opts);
  let data;
  try {
    data = await r.json();
  } catch {
    const text = await r.text().catch(() => "");
    data = { error: `HTTP ${r.status}: ${text.slice(0, 300)}` };
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

  // ── Test connection ──────────────────────────────────────────────────────────
  if (action === "test") {
    try {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey);
      if (ok) {
        const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
        return res.json({ ok: true, user: { name: `${accounts.length} account(s) connected`, plan: "Publer" } });
      }
      return res.status(400).json({ ok: false, error: data.message || data.error || JSON.stringify(data) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── List accounts ────────────────────────────────────────────────────────────
  if (action === "profiles") {
    try {
      const { ok, data } = await publerRequest("/accounts", "GET", null, apiKey);
      if (!ok) return res.status(400).json({ error: data.message || data.error || JSON.stringify(data) });
      const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
      return res.json({
        ok: true,
        profiles: accounts.map(a => ({
          id: String(a.id),
          service: (a.platform || a.social_network || a.type || "").toLowerCase(),
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

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  const payload = { accounts: accountIds, text: postText };
  if (scheduleDate) payload.scheduled_at = new Date(scheduleDate).toISOString();
  else payload.publish_at = "now";
  if (isStory) payload.content_type = "story";
  if (publicMediaUrls.length) payload.media = publicMediaUrls.map(url => ({ url }));

  try {
    const { ok, data } = await publerRequest("/posts/schedule", "POST", payload, apiKey);

    if (ok && (data.status === "success" || data.id || Array.isArray(data.posts))) {
      const posts = data.posts || (data.id ? [data] : []);
      return res.json({
        status: scheduleDate ? "scheduled" : "success",
        backend: "publer",
        postIds: posts.map(p => p.id).filter(Boolean),
        scheduled: !!scheduleDate,
        ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0
          ? { _warning: "Image skipped — must be a public HTTPS URL." }
          : {}),
      });
    }

    return res.status(400).json({
      error: data.message || data.error || "Post failed",
      backend: "publer",
      detail: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
