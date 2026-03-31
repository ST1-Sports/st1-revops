/**
 * /api/social-post  — Social media posting via Publer
 *
 * Publer is purpose-built for social media scheduling.
 * Plans start at $12/mo. Connects Facebook, Instagram, LinkedIn, Twitter/X, TikTok, Pinterest, YouTube.
 * API key is in your account Settings — no app creation required.
 *
 * Required env vars:
 *   PUBLER_API_KEY    — from app.publer.io → Settings → API
 *
 * Optional (for platform-specific routing):
 *   PUBLER_ACCOUNT_FACEBOOK   — account ID for your Facebook page
 *   PUBLER_ACCOUNT_INSTAGRAM  — account ID for your Instagram business account
 *   PUBLER_ACCOUNT_LINKEDIN   — account ID for your LinkedIn company page
 *   PUBLER_ACCOUNT_TWITTER    — account ID for your Twitter/X account
 *   PUBLER_ACCOUNT_TIKTOK     — account ID for your TikTok account
 *   PUBLER_ACCOUNT_IDS        — comma-separated fallback if per-platform IDs not set
 *
 * POST body:
 *   { post, platforms, mediaUrls?, scheduleDate?, isStory?, link?, action? }
 *
 *   action="test"     → verify API key works
 *   action="profiles" → list all connected Publer accounts + their IDs
 *   action="post"     → post or schedule (default)
 */

const PUBLER_API = "https://app.publer.io/api/v1";

async function publerRequest(path, method = "GET", body = null, apiKey) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${PUBLER_API}${path}`, opts);
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.PUBLER_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "PUBLER_API_KEY not set",
      setup: "Get your API key at app.publer.io → Settings → API and add it to Vercel env vars",
    });
  }

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── List accounts ────────────────────────────────────────────────────────────
  if (action === "profiles") {
    const { ok, data } = await publerRequest("/social_accounts", "GET", null, apiKey);
    if (!ok) return res.status(400).json({ error: data.message || data.error || "Failed to fetch accounts" });
    const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
    return res.json({
      ok: true,
      profiles: accounts.map(a => ({
        id: String(a.id),
        service: (a.platform || a.social_network || "").toLowerCase(),
        name: a.name || a.username || a.display_name,
        avatar: a.picture || a.avatar,
        connected: !a.needs_reconnect,
      })),
    });
  }

  // ── Test connection ──────────────────────────────────────────────────────────
  if (action === "test") {
    const { ok, data } = await publerRequest("/user", "GET", null, apiKey);
    if (ok) {
      const user = data.user || data;
      return res.json({ ok: true, user: { name: user.name || user.display_name, email: user.email, plan: user.plan } });
    }
    return res.status(400).json({ ok: false, error: data.message || data.error || "Auth failed" });
  }

  // ── Post / Schedule ──────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });

  // Build account ID list — use per-platform env vars if set, else fall back to PUBLER_ACCOUNT_IDS
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
      error: "No Publer account IDs configured",
      setup: "Go to Integrations → Social Publishing → Load Profiles to find your account IDs, then add them to Vercel env vars",
    });
  }

  // Only pass public HTTPS image URLs
  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
  );

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Build Publer API body
  const payload = {
    account_ids: accountIds,
    text: postText,
  };

  if (scheduleDate) {
    payload.scheduled_at = new Date(scheduleDate).toISOString();
  }

  if (isStory) {
    payload.type = "STORY";
  }

  if (publicMediaUrls.length) {
    payload.media = publicMediaUrls.map(url => ({ url }));
  }

  try {
    const { ok, data } = await publerRequest("/post", "POST", payload, apiKey);

    if (ok && (data.status === "success" || data.id || Array.isArray(data.posts))) {
      const posts = data.posts || (data.id ? [data] : []);
      return res.json({
        status: scheduleDate ? "scheduled" : "success",
        backend: "publer",
        postIds: posts.map(p => p.id).filter(Boolean),
        scheduled: !!scheduleDate,
        ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0 ? {
          _warning: "Image skipped — must be a public HTTPS URL. Use Ideogram AI or paste a URL.",
        } : {}),
      });
    }

    return res.status(400).json({
      error: data.message || data.error || "Post failed",
      backend: "publer",
      raw: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "publer" });
  }
}
