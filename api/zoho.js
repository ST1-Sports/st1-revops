/**
 * Vercel Serverless Function: /api/zoho
 *
 * Server-side proxy for Zoho Books and Zoho CRM.
 * Credentials live in Vercel environment variables — never in the browser.
 *
 * Required env vars (set in Vercel dashboard):
 *   ZOHO_CLIENT_ID       — from api-console.zoho.com OAuth app
 *   ZOHO_CLIENT_SECRET   — from api-console.zoho.com OAuth app
 *   ZOHO_REFRESH_TOKEN   — obtained once via /api/zoho-setup
 *   ZOHO_ORG_ID          — Zoho Books org ID (Settings → Organization Profile)
 *
 * Request body: { service: "books"|"crm", endpoint: string, method?: string, body?: object }
 * Response: the raw Zoho API JSON response
 */

import { getZohoToken as getAccessToken } from './_lib/zoho-token.js';

export default async function handler(req, res) {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { service, endpoint, method = "GET", body } = req.body || {};

  if (!service || !endpoint) {
    return res.status(400).json({ error: "Missing required fields: service, endpoint" });
  }

  // Validate env vars are configured
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN) {
    return res.status(500).json({
      error: "Zoho credentials not configured",
      missing: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"]
        .filter(k => !process.env[k]),
      setup: "Visit /api/zoho-setup to complete OAuth setup",
    });
  }

  try {
    const token = await getAccessToken();

    let url;
    if (service === "books") {
      if (!process.env.ZOHO_ORG_ID) {
        return res.status(500).json({ error: "ZOHO_ORG_ID env var not set" });
      }
      const sep = endpoint.includes("?") ? "&" : "?";
      url = `https://www.zohoapis.com/books/v3${endpoint}${sep}organization_id=${process.env.ZOHO_ORG_ID}`;
    } else if (service === "crm") {
      url = `https://www.zohoapis.com/crm/v3${endpoint}`;
    } else {
      return res.status(400).json({ error: `Unknown service "${service}". Use "books" or "crm".` });
    }

    const zohoRes = await fetch(url, {
      method,
      headers: {
        Authorization:   `Zoho-oauthtoken ${token}`,
        "Content-Type":  "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    let data;
    try {
      data = await zohoRes.json();
    } catch {
      data = { _raw_status: zohoRes.status, error: "Zoho returned non-JSON response" };
    }
    // Always return 200 so the client receives the body — the client checks for error fields
    console.log("[zoho]", method, url.replace("https://www.zohoapis.com",""), "→", zohoRes.status, data?.status||data?.code||"ok");
    return res.status(200).json({ ...data, _http_status: zohoRes.status });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
