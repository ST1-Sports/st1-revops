/**
 * Vercel Serverless: /api/zoho-social
 *
 * Proxy for Zoho Social API — post content/ads to connected social channels.
 * Same OAuth credentials as api/zoho.js; requires ZohoSocial scopes.
 *
 * Required env vars: ZOHO_SOCIAL_CLIENT_ID, ZOHO_SOCIAL_CLIENT_SECRET, ZOHO_SOCIAL_REFRESH_TOKEN
 *   (fall back to ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN if Social-specific ones aren't set)
 * Run /api/zoho-social-setup to obtain ZOHO_SOCIAL_REFRESH_TOKEN.
 *
 * Actions:
 *   list_portals   — list Zoho Social portals (workspaces)
 *   list_channels  — list connected social channels for a portal { portalId }
 *   create_post    — publish a post { portalId, channelIds[], message, imageUrl?, scheduledTime? }
 *   list_posts     — recent posts for a portal { portalId, range? }
 */

import { getZohoSocialToken } from './_lib/zoho-social-token.js';
import { setCors } from './_lib/cors.js';

const BASE = "https://social.zoho.com/api/v1";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { action, ...params } = req.body || {};
  if (!action) return res.status(400).json({ error: "action required" });

  let token;
  try {
    token = await getZohoSocialToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: "/api/zoho-social-setup" });
  }

  const headers = {
    Authorization:  `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // ── LIST PORTALS ──────────────────────────────────────────────────────────
    if (action === "list_portals") {
      const r = await fetch(`${BASE}/portals`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Portals fetch failed", raw: data });
      // Normalize portal list
      const portals = (data.portals || []).map(p => ({
        id:      p.portal_id || p.id,
        name:    p.portal_name || p.name,
        timezone: p.timezone || "",
        plan:    p.plan || "",
      }));
      return res.json({ portals });
    }

    // ── LIST CHANNELS (connected social accounts) ─────────────────────────────
    if (action === "list_channels") {
      const { portalId } = params;
      if (!portalId) return res.status(400).json({ error: "portalId required" });
      const r = await fetch(`${BASE}/portals/${portalId}/channels`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Channels fetch failed", raw: data });
      const channels = (data.channels || []).map(c => ({
        id:       c.channel_id || c.id,
        name:     c.display_name || c.name || c.username,
        network:  c.channel_type || c.type,  // Facebook, Instagram, Twitter, LinkedIn, etc.
        avatar:   c.profile_image || null,
      }));
      return res.json({ channels });
    }

    // ── CREATE POST ───────────────────────────────────────────────────────────
    if (action === "create_post") {
      const { portalId, channelIds = [], message, imageUrl, scheduledTime } = params;
      if (!portalId) return res.status(400).json({ error: "portalId required" });
      if (!message?.trim()) return res.status(400).json({ error: "message required" });
      if (!channelIds.length) return res.status(400).json({ error: "channelIds required" });

      const body = {
        message,
        network_ids: channelIds,
      };

      // Attach image if provided (Zoho Social supports image_urls array)
      if (imageUrl) {
        body.image_urls = [imageUrl];
      }

      // Schedule if time provided, else post immediately
      if (scheduledTime) {
        body.scheduled_time = scheduledTime; // ISO string or Zoho format
        body.is_scheduled = true;
      }

      const r = await fetch(`${BASE}/portals/${portalId}/newsfeed`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Post failed", raw: data });
      return res.json({
        ok: true,
        postId: data.newsfeed_id || data.post_id || null,
        status: scheduledTime ? "scheduled" : "published",
        raw: data,
      });
    }

    // ── LIST RECENT POSTS ─────────────────────────────────────────────────────
    if (action === "list_posts") {
      const { portalId, range = 10 } = params;
      if (!portalId) return res.status(400).json({ error: "portalId required" });
      const r = await fetch(`${BASE}/portals/${portalId}/newsfeeds?range=${range}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Posts fetch failed", raw: data });
      const posts = (data.newsfeeds || data.posts || []).map(p => ({
        id:        p.newsfeed_id || p.id,
        message:   p.message || "",
        status:    p.status || "",
        networks:  p.network_ids || [],
        createdAt: p.scheduled_time || p.created_time || null,
      }));
      return res.json({ posts });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
