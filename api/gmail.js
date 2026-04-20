/**
 * /api/gmail  — Gmail API proxy (read-only inbox access + send)
 *
 * Required env vars:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   (get them from /api/gmail-setup)
 *
 * For per-rep sending, add GMAIL_REFRESH_TOKEN_{REPKEY} e.g. GMAIL_REFRESH_TOKEN_JOSH
 * and pass repEnvKey:"JOSH" in the request body.
 *
 * POST body: { action: "list" | "get" | "send" | "profile", repEnvKey?: string, ... }
 */

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

// Per-key token cache: { [envKey]: { token, expiry } }
const _tokenCache = {};

async function getToken(repEnvKey = "") {
  const cacheKey = repEnvKey || "default";
  const cached = _tokenCache[cacheKey];
  if (cached && Date.now() < cached.expiry - 60_000) return cached.token;

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    throw new Error("Gmail not configured — set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel env vars");
  }

  // Look up per-rep refresh token, fall back to default
  const refreshTokenVar = repEnvKey
    ? `GMAIL_REFRESH_TOKEN_${repEnvKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
    : "GMAIL_REFRESH_TOKEN";
  const refreshToken = process.env[refreshTokenVar];

  if (!refreshToken) {
    if (repEnvKey) {
      throw new Error(`Gmail not configured for rep key "${repEnvKey}" — add ${refreshTokenVar} to Vercel env vars (visit /api/gmail-setup?repKey=${repEnvKey})`);
    }
    throw new Error("Gmail not configured — visit /api/gmail-setup");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }).toString(),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  _tokenCache[cacheKey] = { token: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
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

  const { action, messageId, maxResults = 30, query, to_email, to_name, subject, body: emailBody, htmlBody, cc, bcc, replyToMessageId, reply_to, from_name, repEnvKey } = req.body || {};

  if (!action) return res.status(400).json({ error: "Missing action" });

  try {
    const token = await getToken(repEnvKey || "");
    const auth  = { Authorization: `Bearer ${token}` };

    // ── PROFILE: return connected account email ───────────────────────────────
    if (action === "profile") {
      const profileRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: auth }
      );
      const profile = await profileRes.json();
      if (!profileRes.ok) return res.status(profileRes.status).json({ error: profile.error?.message || "Profile fetch failed" });
      return res.json({
        email: profile.emailAddress,
        messagesTotal: profile.messagesTotal,
        threadsTotal: profile.threadsTotal,
      });
    }


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

    // ── SEND: compose and send email via Gmail ────────────────────────────────
    if (action === "send") {
      if (!to_email) return res.status(400).json({ error: "to_email required" });
      if (!subject)  return res.status(400).json({ error: "subject required" });
      if (!emailBody) return res.status(400).json({ error: "body required" });

      const toHeader = to_name ? `${to_name} <${to_email}>` : to_email;
      const contentType = htmlBody ? "text/html; charset=UTF-8" : "text/plain; charset=UTF-8";
      // Reply-To points to the rep so replies land in their inbox, not the sending Gmail account
      const replyToHeader = reply_to
        ? (from_name ? `${from_name} <${reply_to}>` : reply_to)
        : null;
      const lines = [
        `To: ${toHeader}`,
        ...(cc  ? [`Cc: ${cc}`]   : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        ...(replyToHeader ? [`Reply-To: ${replyToHeader}`] : []),
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: ${contentType}`,
        ``,
        htmlBody || emailBody,
      ];

      // If replying to an existing thread, fetch the thread ID + references
      let threadId;
      if (replyToMessageId) {
        try {
          const origRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${replyToMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
            { headers: auth }
          );
          const orig = await origRes.json();
          threadId = orig.threadId;
          const msgIdHdr = (orig.payload?.headers || []).find(h => h.name === "Message-ID")?.value;
          const refsHdr  = (orig.payload?.headers || []).find(h => h.name === "References")?.value;
          if (msgIdHdr) {
            lines.splice(lines.indexOf(""), 0, `In-Reply-To: ${msgIdHdr}`);
            lines.splice(lines.indexOf(""), 0, `References: ${refsHdr ? refsHdr + " " + msgIdHdr : msgIdHdr}`);
          }
        } catch { /* ignore thread fetch errors */ }
      }

      const raw = Buffer.from(lines.join("\r\n"))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method:  "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body:    JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok) return res.status(sendRes.status).json({ error: sendData.error?.message || "Send failed", raw: sendData });
      return res.json({ sent: true, messageId: sendData.id, threadId: sendData.threadId });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch(err) {
    return res.status(500).json({ error: err.message, setup: "/api/gmail-setup" });
  }
}
