/**
 * /api/gmail  — Gmail API proxy (read-only inbox access + send)
 *
 * Required env vars:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   (get them from /api/gmail-setup)
 *
 * For per-rep sending, tokens are stored in the database (Setting model).
 * Falls back to GMAIL_REFRESH_TOKEN_{REPKEY} env var for backwards compat.
 * Pass repEnvKey:"JOSH" in the request body to use a rep-specific token.
 *
 * POST body: { action: "list" | "get" | "send" | "profile", repEnvKey?: string, ... }
 */

import { prisma } from './_lib/prisma.js';
import { classifyEmailIntent } from './_lib/brad-shared.js';
import { encodeMimeWord, encodeMailbox, encodeFilename } from './_lib/mimeHeader.js';

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

  // Look up refresh token: database first, then env var (backwards compat)
  let refreshToken = null;
  if (repEnvKey) {
    try {
      const dbKey = `gmail_token_${repEnvKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      const row = await prisma.setting.findUnique({ where: { key: dbKey } });
      if (row?.value?.refreshToken) refreshToken = row.value.refreshToken;
    } catch {}
  }
  if (!refreshToken) {
    const refreshTokenVar = repEnvKey
      ? `GMAIL_REFRESH_TOKEN_${repEnvKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
      : "GMAIL_REFRESH_TOKEN";
    refreshToken = process.env[refreshTokenVar];
    if (!refreshToken) {
      if (repEnvKey) throw new Error(`Gmail not configured for "${repEnvKey}" — connect Gmail in your account settings`);
      throw new Error("Gmail not configured — visit /api/gmail-setup");
    }
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

  const { action, messageId, maxResults = 30, query, to_email, to_name, subject, body: emailBody, htmlBody, cc, bcc, replyToMessageId, reply_to, from_name, repEnvKey, attachments } = req.body || {};

  if (!action) return res.status(400).json({ error: "Missing action" });

  // ── DEBUG: check if token exists (DB or env var) and which account it maps to ──
  if (action === "debug") {
    try {
      const tok = await getToken(repEnvKey || "");
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tok}` } });
      const profile = await profileRes.json();
      return res.json({ found: true, email: profile.emailAddress || null });
    } catch(e) {
      return res.json({ found: false, email: null, error: e.message });
    }
  }

  // ── CLASSIFY-INTENT: does a matched inbox message actually show interest,
  //    or is it an out-of-office/bounce/unsubscribe that just happens to be
  //    from the right address? No Gmail token needed — just the LLM call
  //    checkReplies (RevOps.jsx) already uses to filter matches before
  //    crediting a contact's score with a "replied" signal.
  if (action === "classify-intent") {
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
    const results = await Promise.all(
      items.slice(0, 30).map(it => classifyEmailIntent(it.subject || "", it.snippet || ""))
    );
    return res.json({ results });
  }

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
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
              { headers: auth }
            );
            const msg = await msgRes.json();
            const hdrs = msg.payload?.headers || [];
            return {
              id:      msg.id,
              subject: extractHeader(hdrs, "Subject") || "(no subject)",
              from:    extractHeader(hdrs, "From") || "",
              to:      extractHeader(hdrs, "To") || "",
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
      // Hard backstop for Brad-branded sends, enforced here regardless of
      // caller — api/agents/brad-send.js already checks this, but the
      // Campaigns UI's manual "SEND" button (RevOps.jsx's sendOneEmail) and
      // api/cron/send-batches.js both also reach this endpoint with
      // repEnvKey:"BRAD" for fromBrad campaigns, and duplicating this check
      // in every caller is exactly how it got missed once already.
      if (repEnvKey === "BRAD" && process.env.BRAD_SENDING_ENABLED !== "true") {
        return res.status(403).json({ ok: false, sent: false, error: "Brad sending is disabled. Set BRAD_SENDING_ENABLED=true to allow approved sends." });
      }
      if (!to_email) return res.status(400).json({ error: "to_email required" });
      if (!subject)  return res.status(400).json({ error: "subject required" });
      if (!emailBody) return res.status(400).json({ error: "body required" });

      const toHeader = to_name ? encodeMailbox(to_name, to_email) : to_email;
      const contentType = htmlBody ? "text/html; charset=UTF-8" : "text/plain; charset=UTF-8";
      // From: set only when both name and address are provided explicitly.
      // Gmail requires the address to match the authenticated account or a Send As alias.
      const fromEmail = req.body.from_email || null;
      const fromHeader = (from_name && fromEmail)
        ? encodeMailbox(from_name, fromEmail)
        : null;
      // Reply-To points to the rep so replies land in their inbox
      const replyToHeader = reply_to
        ? (from_name ? encodeMailbox(from_name, reply_to) : reply_to)
        : null;
      const subjectHeader = encodeMimeWord(subject);
      const validAttachments = (attachments || []).filter(a => a?.contentBase64 && a?.filename);
      const wrap = (b64) => b64.replace(/(.{76})/g, "$1\r\n");
      const boundary = `st1_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const lines = validAttachments.length
        ? [
            ...(fromHeader ? [`From: ${fromHeader}`] : []),
            `To: ${toHeader}`,
            ...(cc  ? [`Cc: ${cc}`]   : []),
            ...(bcc ? [`Bcc: ${bcc}`] : []),
            ...(replyToHeader ? [`Reply-To: ${replyToHeader}`] : []),
            `Subject: ${subjectHeader}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            ``,
            `--${boundary}`,
            `Content-Type: ${contentType}`,
            `Content-Transfer-Encoding: 8bit`,
            ``,
            htmlBody || emailBody,
            ...validAttachments.flatMap(att => [
              `--${boundary}`,
              `Content-Type: ${att.mimeType || "application/octet-stream"}; name=${encodeFilename(att.filename)}`,
              `Content-Disposition: attachment; filename=${encodeFilename(att.filename)}`,
              `Content-Transfer-Encoding: base64`,
              ``,
              wrap(att.contentBase64),
            ]),
            `--${boundary}--`,
          ]
        : [
            ...(fromHeader ? [`From: ${fromHeader}`] : []),
            `To: ${toHeader}`,
            ...(cc  ? [`Cc: ${cc}`]   : []),
            ...(bcc ? [`Bcc: ${bcc}`] : []),
            ...(replyToHeader ? [`Reply-To: ${replyToHeader}`] : []),
            `Subject: ${subjectHeader}`,
            `MIME-Version: 1.0`,
            `Content-Type: ${contentType}`,
            `Content-Transfer-Encoding: 8bit`,
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
