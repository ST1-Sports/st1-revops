/**
 * Zoho Social OAuth token helper.
 * In-memory cache separate from the Books/CRM token (zoho-token.js).
 *
 * Env vars (Social-specific preferred, falls back to shared Zoho creds):
 *   ZOHO_SOCIAL_CLIENT_ID      → falls back to ZOHO_CLIENT_ID
 *   ZOHO_SOCIAL_CLIENT_SECRET  → falls back to ZOHO_CLIENT_SECRET
 *   ZOHO_SOCIAL_REFRESH_TOKEN  → falls back to ZOHO_REFRESH_TOKEN
 *
 * Obtain ZOHO_SOCIAL_REFRESH_TOKEN via /api/zoho-social-setup
 */

let _cachedToken = null;
let _tokenExpiry = 0;

export async function getZohoSocialToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) {
    return _cachedToken;
  }

  const clientId     = process.env.ZOHO_SOCIAL_CLIENT_ID     || process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_SOCIAL_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_SOCIAL_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Zoho Social credentials not configured. Set ZOHO_SOCIAL_CLIENT_ID, ZOHO_SOCIAL_CLIENT_SECRET, " +
      "and ZOHO_SOCIAL_REFRESH_TOKEN in Vercel environment variables. Visit /api/zoho-social-setup to obtain them."
    );
  }

  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Zoho Social token refresh failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`No access_token in Zoho Social response: ${JSON.stringify(data)}`);
  }

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}
