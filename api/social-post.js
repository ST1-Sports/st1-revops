/**
 * /api/social-post  — Social media posting via Ayrshare
 *
 * Ayrshare connects Twitter/X, LinkedIn, Instagram, Facebook, TikTok and more
 * under a single API key. No per-platform OAuth needed.
 *
 * Env var required:  AYRSHARE_API_KEY
 *
 * Ayrshare docs: https://docs.ayrshare.com/
 *
 * POST body:
 *   { post, platforms, mediaUrls?, scheduleDate?, isStory?, link?, action? }
 *
 *   action="test"  → verifies the API key and returns connected profiles
 *   action="post"  → posts or schedules (default when action omitted)
 */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.AYRSHARE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "AYRSHARE_API_KEY not set",
      setup: "Add AYRSHARE_API_KEY to your Vercel environment variables. Get a free key at app.ayrshare.com",
    });
  }

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── Test connection ──────────────────────────────────────────────────────────
  if (action === "test") {
    try {
      const r = await fetch("https://app.ayrshare.com/api/user", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await r.json();
      if (r.ok) return res.json({ ok: true, user: data });
      return res.status(400).json({ ok: false, error: data.message || "Connection failed" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── Post / Schedule ──────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });
  if (!platforms?.length) return res.status(400).json({ error: "at least one platform is required" });

  // Build post text — append link if provided and not already in caption
  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  const body = {
    post: postText,
    platforms,
    ...(mediaUrls?.length ? { mediaUrls } : {}),
    ...(scheduleDate ? { scheduleDate } : {}),
    ...(isStory ? { isStory: true } : {}),
  };

  try {
    const r = await fetch("https://app.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    // Ayrshare returns status:"success" on success
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
