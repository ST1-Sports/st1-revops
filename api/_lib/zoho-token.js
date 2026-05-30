/**
 * Shared Zoho OAuth token helper.
 * In-memory cache survives within a warm serverless function instance.
 * Imported by api/zoho.js, api/zoho-campaigns.js, api/zoho-social.js.
 */

let _cachedToken = null;
let _tokenExpiry = 0;

export async function getZohoToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) {
    return _cachedToken;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error(
      "Zoho credentials not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, " +
      "and ZOHO_REFRESH_TOKEN in Vercel environment variables. Visit /api/zoho-setup to obtain them."
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  let res;
  try {
    res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     ZOHO_CLIENT_ID,
        client_secret: ZOHO_CLIENT_SECRET,
        refresh_token: ZOHO_REFRESH_TOKEN,
        grant_type:    "refresh_token",
      }).toString(),
    });
  } finally {
    clearTimeout(timer);
  }

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
