/**
 * /api/social-post  — Social media posting
 *
 * Supports two backends — use whichever you set up:
 *
 * OPTION A: Make (Integromat) — $9/mo, recommended
 *   Env var: MAKE_WEBHOOK_URL
 *   Setup: app.make.com → Create scenario → Webhooks → Custom webhook
 *          Add modules for each platform (Facebook Pages, Instagram, LinkedIn, etc.)
 *          Copy the webhook URL into Vercel as MAKE_WEBHOOK_URL
 *
 * OPTION B: Ayrshare — $29/mo starter (not $149 — use the Starter plan)
 *   Env var: AYRSHARE_API_KEY
 *   Setup: app.ayrshare.com → connect social accounts → copy API key
 *
 * POST body:
 *   { post, platforms, mediaUrls?, scheduleDate?, isStory?, link?, action? }
 *   action="test" → test the connection
 */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const makeUrl    = process.env.MAKE_WEBHOOK_URL;
  const ayrshareKey = process.env.AYRSHARE_API_KEY;

  const { post, platforms, mediaUrls, scheduleDate, isStory, link, action } = req.body || {};

  // ── Test connection ──────────────────────────────────────────────────────────
  if (action === "test") {
    if (makeUrl) {
      try {
        const r = await fetch(makeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test", platforms: ["test"] }),
        });
        return res.json({ ok: true, backend: "make", status: r.status });
      } catch (e) {
        return res.status(500).json({ ok: false, backend: "make", error: e.message });
      }
    }
    if (ayrshareKey) {
      try {
        const r = await fetch("https://app.ayrshare.com/api/user", {
          headers: { Authorization: `Bearer ${ayrshareKey}` },
        });
        const data = await r.json();
        if (r.ok) return res.json({ ok: true, backend: "ayrshare", user: data });
        return res.status(400).json({ ok: false, backend: "ayrshare", error: data.message });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }
    return res.status(500).json({
      ok: false,
      error: "No social posting backend configured",
      setup: "Add MAKE_WEBHOOK_URL (recommended, $9/mo at make.com) or AYRSHARE_API_KEY to Vercel env vars",
    });
  }

  // ── Validate ─────────────────────────────────────────────────────────────────
  if (!post?.trim()) return res.status(400).json({ error: "post text is required" });
  if (!platforms?.length) return res.status(400).json({ error: "at least one platform is required" });

  if (!makeUrl && !ayrshareKey) {
    return res.status(500).json({
      error: "No social posting backend configured",
      setup: "Add MAKE_WEBHOOK_URL (recommended, $9/mo at make.com) or AYRSHARE_API_KEY to Vercel env vars",
    });
  }

  // Only pass public HTTPS image URLs — data URLs and relative paths won't work
  const publicMediaUrls = (mediaUrls || []).filter(
    u => typeof u === "string" && u.startsWith("http") && !u.startsWith("data:")
  );
  const droppedImages = (mediaUrls || []).length - publicMediaUrls.length;

  const postText = link && !post.includes(link) ? `${post}\n\n${link}` : post;

  // ── Make webhook ─────────────────────────────────────────────────────────────
  if (makeUrl) {
    try {
      const r = await fetch(makeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post: postText,
          platforms,
          mediaUrls: publicMediaUrls.length ? publicMediaUrls : undefined,
          scheduleDate: scheduleDate || undefined,
          isStory: isStory || undefined,
        }),
      });
      // Make webhooks return 200 with "Accepted" on success
      const text = await r.text();
      const ok = r.ok || text.includes("Accepted");
      return res.json({
        status: ok ? "success" : "error",
        backend: "make",
        ...(droppedImages > 0 ? { _warning: `${droppedImages} image(s) skipped — must be public HTTPS URLs` } : {}),
        ...(ok ? {} : { error: `Make webhook returned ${r.status}: ${text.slice(0, 200)}` }),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message, backend: "make" });
    }
  }

  // ── Ayrshare ─────────────────────────────────────────────────────────────────
  try {
    const r = await fetch("https://app.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ayrshareKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post: postText,
        platforms,
        ...(publicMediaUrls.length ? { mediaUrls: publicMediaUrls } : {}),
        ...(scheduleDate ? { scheduleDate } : {}),
        ...(isStory ? { isStory: true } : {}),
      }),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({
      ...data,
      backend: "ayrshare",
      ...(droppedImages > 0 ? { _warning: `${droppedImages} image(s) skipped — must be public HTTPS URLs` } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, backend: "ayrshare" });
  }
}
