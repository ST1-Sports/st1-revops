/**
 * /api/social-post  — Social media posting via Buffer
 *
 * Buffer is purpose-built for social media scheduling.
 * Plans start at $6/mo. Connects Facebook, Instagram, LinkedIn, Twitter/X, TikTok, Pinterest.
 *
 * Required env vars:
 *   BUFFER_ACCESS_TOKEN   — from buffer.com/developers/apps (personal access token)
 *   BUFFER_PROFILE_IDS    — comma-separated profile IDs, e.g. "abc123,def456,ghi789"
 *                           Get these by calling action:"profiles" after setting the token
 *
 * Optional (for platform-specific routing):
 *   BUFFER_PROFILE_FACEBOOK   — profile ID for your Facebook page
 *   BUFFER_PROFILE_INSTAGRAM  — profile ID for your Instagram business account
 *   BUFFER_PROFILE_LINKEDIN   — profile ID for your LinkedIn company page
 *   BUFFER_PROFILE_TWITTER    — profile ID for your Twitter/X account
 *   BUFFER_PROFILE_TIKTOK     — profile ID for your TikTok account
 *
 * POST body:
 *   { post, platforms, mediaUrls?, scheduleDate?, isStory?, link?, action? }
 *
 *   action="test"     → verify token works
 *   action="profiles" → list all connected Buffer profiles + their IDs
 *   action="post"     → post or schedule (default)
 */

const BUFFER_API = "https://api.bufferapp.com/1";

async function bufferRequest(path, method = "GET", body = null, token) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (body) {
    // Buffer API uses form-encoded bodies
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(body).toString();
  }
  const r = await fetch(`${BUFFER_API}${path}`, opts);
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.BUFFER_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "BUFFER_ACCESS_TOKEN not set",
      setup: "Get your access token at buffer.com/developers/apps and add it to Vercel env vars",
    });
  }

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── List profiles ────────────────────────────────────────────────────────────
  if (action === "profiles") {
    const { ok, data } = await bufferRequest("/profiles.json", "GET", null, token);
    if (!ok) return res.status(400).json({ error: data.message || "Failed to fetch profiles" });
    return res.json({
      ok: true,
      profiles: (data || []).map(p => ({
        id: p.id,
        service: p.service,        // "twitter" | "facebook" | "instagram" | "linkedin" | "tiktok"
        name: p.formatted_username || p.service_username,
        avatar: p.avatar,
        connected: !p.disconnected,
      })),
    });
  }

  // ── Test connection ──────────────────────────────────────────────────────────
  if (action === "test") {
    const { ok, data } = await bufferRequest("/user.json", "GET", null, token);
    if (ok) return res.json({ ok: true, user: { name: data.name, email: data.email, plan: data.plan } });
    return res.status(400).json({ ok: false, error: data.message || "Auth failed" });
  }

  // ── Post / Schedule ──────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });

  // Build profile ID list — use per-platform env vars if set, else fall back to BUFFER_PROFILE_IDS
  const platformMap = {
    facebook:  process.env.BUFFER_PROFILE_FACEBOOK,
    instagram: process.env.BUFFER_PROFILE_INSTAGRAM,
    linkedin:  process.env.BUFFER_PROFILE_LINKEDIN,
    twitter:   process.env.BUFFER_PROFILE_TWITTER,
    tiktok:    process.env.BUFFER_PROFILE_TIKTOK,
  };

  let profileIds = [];
  if (platforms?.length) {
    profileIds = platforms
      .map(p => platformMap[p])
      .filter(Boolean);
  }
  // Fall back to all profiles if no per-platform IDs are set
  if (!profileIds.length && process.env.BUFFER_PROFILE_IDS) {
    profileIds = process.env.BUFFER_PROFILE_IDS.split(",").map(s => s.trim()).filter(Boolean);
  }

  if (!profileIds.length) {
    return res.status(400).json({
      error: "No Buffer profile IDs configured",
      setup: "Go to Integrations → Social Publishing → Load Profiles to find your profile IDs, then add them to Vercel env vars",
    });
  }

  // Only pass public HTTPS image URLs
  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
  );

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // Build Buffer API body
  const body = { text: postText };
  profileIds.forEach((id, i) => { body[`profile_ids[${i}]`] = id; });

  if (scheduleDate) {
    body.scheduled_at = new Date(scheduleDate).toISOString();
  } else {
    body.now = "true";
  }

  if (publicMediaUrls.length) {
    body["media[photo]"] = publicMediaUrls[0];
    body["media[thumbnail]"] = publicMediaUrls[0];
  }

  try {
    const { ok, data } = await bufferRequest("/updates/create.json", "POST", body, token);
    if (ok && (data.success || data.updates?.length)) {
      return res.json({
        status: "success",
        backend: "buffer",
        postIds: (data.updates || []).map(u => u.id),
        scheduled: !!scheduleDate,
        ...(publicMediaUrls.length === 0 && mediaUrls?.length > 0 ? {
          _warning: "Image skipped — must be a public HTTPS URL. Use Ideogram AI or paste a URL.",
        } : {}),
      });
    }
    return res.status(400).json({
      error: data.message || data.error || "Post failed",
      backend: "buffer",
      raw: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "buffer" });
  }
}
