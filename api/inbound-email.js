/**
 * /api/inbound-email — BCC-to-deal email tracking
 *
 * Works like the HubSpot BCC key: you BCC a specific address when sending
 * a pricing/quote email, and this endpoint receives it and queues a deal.
 *
 * POST — receive inbound email (from SendGrid Inbound Parse, Mailgun, Cloudflare Email, etc.)
 *   Validates optional INBOUND_EMAIL_SECRET env var via `x-inbound-secret` header or ?secret= param.
 *
 * GET  — return unprocessed quotes so the React app can create deals
 *   Requires same secret if INBOUND_EMAIL_SECRET is set.
 *
 * POST { ids: [...] } with header x-action: mark-processed — mark deals as consumed
 *
 * ── SendGrid Inbound Parse setup ───────────────────────────────────────────
 *  1. In SendGrid: Settings → Inbound Parse → Add Host & URL
 *     - Receiving Domain: your MX-configured subdomain (e.g. mail.st1sports.com)
 *     - Destination URL: https://your-app.vercel.app/api/inbound-email?secret=YOUR_SECRET
 *  2. Point MX record for that subdomain to mx.sendgrid.net (priority 10)
 *  3. Give your team the BCC address: quotes@mail.st1sports.com
 *
 * ── Cloudflare Email Workers setup ─────────────────────────────────────────
 *  1. In Cloudflare: Email → Email Routing → Workers
 *  2. Create an email worker that POSTs to this endpoint
 *  3. Use the address: quotes@st1sports.com
 *
 * ── Mailgun setup ──────────────────────────────────────────────────────────
 *  1. In Mailgun: Receiving → Routes → Create Route
 *     - Filter: match_recipient("quotes@your-domain.com")
 *     - Action: forward("https://your-app.vercel.app/api/inbound-email?secret=YOUR_SECRET")
 */

import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
};

function checkSecret(req) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return true; // no secret configured = open
  const provided = req.headers['x-inbound-secret'] || req.query?.secret;
  return provided === secret;
}

// Parse "Name <email@x.com>" or "email@x.com"
function parseAddr(raw = "") {
  const m = raw.match(/^(.+?)\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const email = raw.split(",")[0].trim().toLowerCase();
  return { name: null, email };
}

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: React app polls for pending quotes ────────────────────────────────
  if (req.method === "GET") {
    if (!checkSecret(req)) return res.status(401).json({ error: "unauthorized" });
    try {
      const quotes = await prisma.inboundQuote.findMany({
        where: { processed: false },
        orderBy: { receivedAt: "asc" },
        take: 100,
      });
      return res.json({ quotes });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: mark quotes as processed ────────────────────────────────────────
  if (req.method === "POST" && req.headers["x-action"] === "mark-processed") {
    if (!checkSecret(req)) return res.status(401).json({ error: "unauthorized" });
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids array required" });
    await prisma.inboundQuote.updateMany({
      where: { id: { in: ids } },
      data: { processed: true, processedAt: new Date() },
    });
    return res.json({ ok: true, marked: ids.length });
  }

  // ── POST: inbound email from SendGrid / Mailgun / Cloudflare ──────────────
  if (req.method === "POST") {
    if (!checkSecret(req)) return res.status(401).json({ error: "unauthorized" });

    try {
      const body = req.body || {};

      // SendGrid Inbound Parse fields
      // https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
      const rawFrom    = body.from    || body.sender   || "";
      const rawTo      = body.to      || body.recipient || "";
      const subject    = (body.subject || "(no subject)").slice(0, 500);
      const text       = (body.text   || body["body-plain"] || body.plain || "").slice(0, 10000);

      // Mailgun also sends envelope JSON
      let envelope = {};
      if (body.envelope) {
        try { envelope = JSON.parse(body.envelope); } catch {}
      }

      // Extract Message-ID for dedup (from raw headers)
      let messageId = body["Message-Id"] || body["message-id"] || body.messageId || null;
      if (!messageId && body.headers) {
        const m = body.headers.match(/Message-ID:\s*<([^>]+)>/i);
        if (m) messageId = m[1];
      }
      if (messageId) messageId = messageId.replace(/[<>]/g, "").trim().slice(0, 255);

      // Dedup by messageId
      if (messageId) {
        const existing = await prisma.inboundQuote.findUnique({ where: { messageId } }).catch(() => null);
        if (existing) return res.json({ ok: true, duplicate: true });
      }

      // Parse addresses
      // Use envelope.from/to if available (more reliable than headers)
      const from = parseAddr(envelope.from || rawFrom);
      const to   = parseAddr((Array.isArray(envelope.to) ? envelope.to[0] : envelope.to) || rawTo);

      if (!from.email || !to.email) {
        return res.status(400).json({ error: "Could not parse from/to addresses" });
      }

      await prisma.inboundQuote.create({
        data: {
          messageId:  messageId || null,
          fromEmail:  from.email,
          fromName:   from.name,
          toEmail:    to.email,
          toName:     to.name,
          subject,
          bodyText:   text,
        },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("[inbound-email] error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
