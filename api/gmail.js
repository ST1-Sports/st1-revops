/**
 * /api/gmail  — Gmail API proxy (read-only inbox access)
 *
 * Required env vars:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   (get them from /api/gmail-setup)
 *
 * POST body: { action: "list" | "get", messageId?: string, maxResults?: number, query?: string }
 *
 * action "list"  → returns [{id, subject, from, date, snippet}]
 * action "get"   → returns {id, subject, from, date, body (plain text)}
 */

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Gmail not configured — visit /api/gmail-setup");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }).toString(),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _token;
}

function extractHeader(headers, name) {
  return (headers || []).find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload) {
  if (!payload) return "";
  // Try direct body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  // Try parts
  const parts = payload.parts || [];
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return Buffer.from(p.body.data, "base64url").toString("utf8");
    }
  }
  // Try nested parts
  for (const p of parts) {
    const nested = p.parts || [];
    for (const np of nested) {
      if (np.mimeType === "text/plain" && np.body?.data) {
        return Buffer.from(np.body.data, "base64url").toString("utf8");
      }
    }
  }
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { action, messageId, maxResults = 30, query } = req.body || {};

  if (!action) return res.status(400).json({ error: "Missing action" });

  try {
    const token = await getToken();
    const auth  = { Authorization: `Bearer ${token}` };

    // ── LIST: fetch recent messages ───────────────────────────────────────────
    if (action === "list") {
      const q = query || "newer_than:14d category:primary -from:me";
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
        { headers: auth }
      );
      const listData = await listRes.json();
      if (!listRes.ok) return res.status(listRes.status).json({ error: listData.error?.message || "Gmail list failed" });

      const messages = listData.messages || [];
      if (!messages.length) return res.json({ messages: [] });

      // Fetch metadata for each (subject, from, date, snippet) in parallel (batch 20)
      const details = await Promise.all(
        messages.slice(0, 30).map(async m => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
              { headers: auth }
            );
            const msg = await msgRes.json();
            const hdrs = msg.payload?.headers || [];
            return {
              id:      msg.id,
              subject: extractHeader(hdrs, "Subject") || "(no subject)",
              from:    extractHeader(hdrs, "From") || "",
              date:    extractHeader(hdrs, "Date") || "",
              snippet: msg.snippet || "",
            };
          } catch { return null; }
        })
      );

      return res.json({ messages: details.filter(Boolean) });
    }

    // ── GET: fetch full email body ────────────────────────────────────────────
    if (action === "get") {
      if (!messageId) return res.status(400).json({ error: "messageId required" });
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: auth }
      );
      const msg = await msgRes.json();
      if (!msgRes.ok) return res.status(msgRes.status).json({ error: msg.error?.message });
      const hdrs = msg.payload?.headers || [];
      const body = extractBody(msg.payload);
      return res.json({
        id:      msg.id,
        subject: extractHeader(hdrs, "Subject"),
        from:    extractHeader(hdrs, "From"),
        date:    extractHeader(hdrs, "Date"),
        body:    body.slice(0, 3000), // cap body length
        snippet: msg.snippet || "",
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch(err) {
    return res.status(500).json({ error: err.message, setup: "/api/gmail-setup" });
  }
}
