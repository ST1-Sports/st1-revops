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

// Simple in-memory token cache (survives within a warm function instance)
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) {
    return _cachedToken;
  }

  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Zoho token refresh failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`No access_token in Zoho response: ${JSON.stringify(data)}`);
  }

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

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

    const data = await zohoRes.json();
    return res.status(zohoRes.ok ? 200 : zohoRes.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
