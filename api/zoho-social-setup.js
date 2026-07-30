/**
 * Vercel Serverless Function: /api/zoho-social-setup
 *
 * One-time OAuth setup helper for Zoho Social ONLY.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  This is SEPARATE from the main Zoho Books/CRM setup (/api/zoho-setup)  │
 * │  Zoho Social uses different scopes and a different refresh token.        │
 * │  Do NOT mix up ZOHO_SOCIAL_REFRESH_TOKEN with ZOHO_REFRESH_TOKEN.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Step 1 — GET /api/zoho-social-setup → click Authorize button
 * Step 2 — Copy the refresh_token into Vercel env var ZOHO_SOCIAL_REFRESH_TOKEN
 * Step 3 — Redeploy Vercel project so the new token takes effect
 *
 * Env vars needed before running this setup:
 *   ZOHO_SOCIAL_CLIENT_ID     (falls back to ZOHO_CLIENT_ID)
 *   ZOHO_SOCIAL_CLIENT_SECRET (falls back to ZOHO_CLIENT_SECRET)
 */

const SCOPES = [
  "ZohoSocial.portals.ALL",
  "ZohoSocial.message.ALL",
].join(",");

const REDIRECT_URI = "https://revops.st1sports.com/api/zoho-social-setup";

export default async function handler(req, res) {
  const clientId     = process.env.ZOHO_SOCIAL_CLIENT_ID     || process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_SOCIAL_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET;

  const { code, error: oauthError } = req.query || {};

  // ── Step 2: Exchange code for tokens ────────────────────────────────────────
  if (code) {
    if (!clientId || !clientSecret) {
      return res.status(500).send(page("Missing env vars", `
        <p style="color:red">
          <strong>ZOHO_SOCIAL_CLIENT_ID</strong> (or ZOHO_CLIENT_ID) and
          <strong>ZOHO_SOCIAL_CLIENT_SECRET</strong> (or ZOHO_CLIENT_SECRET)
          must be set in Vercel before running setup.
        </p>
      `));
    }

    try {
      const tokenRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          redirect_uri:  REDIRECT_URI,
          grant_type:    "authorization_code",
        }).toString(),
      });

      const data = await tokenRes.json();

      if (!data.refresh_token) {
        return res.status(400).send(page("Token Exchange Failed", `
          <p style="color:red">Zoho returned an error:</p>
          <pre style="background:#fee;padding:12px;border-radius:4px">${JSON.stringify(data, null, 2)}</pre>
          <p><a href="/api/zoho-social-setup">← Try again</a></p>
        `));
      }

      return res.status(200).send(page("✓ Zoho Social Connected!", `
        <div style="margin-bottom:20px;padding:14px;background:#e8f8ee;border:1px solid #1e8f4e40;border-radius:6px">
          <strong style="color:#1e8f4e">Authorization successful.</strong>
          Copy the value below into your Vercel environment variables.
        </div>

        ${tokenRow("ZOHO_SOCIAL_REFRESH_TOKEN", data.refresh_token)}

        <div style="margin-top:24px;padding:14px;background:#fff8e6;border:1px solid #c7780040;border-radius:6px">
          <strong>Where to add this:</strong><br>
          Vercel dashboard → your project → Settings → Environment Variables<br><br>
          Add it as <strong>ZOHO_SOCIAL_REFRESH_TOKEN</strong> — keep this separate from
          <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">ZOHO_REFRESH_TOKEN</code>
          which is used for Books/CRM.
        </div>

        <div style="margin-top:16px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px">
          <strong>Next:</strong> redeploy your Vercel project so the new env var takes effect.
        </div>

        <div style="margin-top:16px;padding:14px;background:#f8f4ff;border:1px solid #7c3aed40;border-radius:6px;font-size:13px">
          <strong>Note:</strong> This token is only for Zoho Social (portals &amp; posts).
          Your Books/CRM token (<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px">ZOHO_REFRESH_TOKEN</code>) is unaffected.
        </div>
      `));

    } catch (err) {
      return res.status(500).send(page("Error", `<p style="color:red">${err.message}</p>`));
    }
  }

  // ── Step 1: Show the authorization link ─────────────────────────────────────
  if (oauthError) {
    return res.status(400).send(page("Authorization Denied", `
      <p style="color:red">Zoho returned: ${oauthError}</p>
      <p>If you see <strong>"Invalid OAuth Scope"</strong>, make sure Zoho Social is active
      on your Zoho subscription and the OAuth client has Social scopes enabled.</p>
      <p><a href="/api/zoho-social-setup">← Try again</a></p>
    `));
  }

  if (!clientId) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">
        Set <strong>ZOHO_SOCIAL_CLIENT_ID</strong> (or <strong>ZOHO_CLIENT_ID</strong>) and
        <strong>ZOHO_SOCIAL_CLIENT_SECRET</strong> (or <strong>ZOHO_CLIENT_SECRET</strong>)
        in Vercel environment variables first, then come back here.
      </p>
    `));
  }

  const authUrl = "https://accounts.zoho.com/oauth/v2/auth?" + new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    access_type:   "offline",
    scope:         SCOPES,
    redirect_uri:  REDIRECT_URI,
    prompt:        "consent",
  }).toString();

  return res.status(200).send(page("Connect Zoho Social to ST1 RevOps", `

    <div style="margin-bottom:20px;padding:14px;background:#fff3cd;border:1px solid #c7780080;border-radius:6px;font-size:13px">
      <strong>This is the Zoho Social setup — separate from the main Zoho setup.</strong><br>
      If you need Books, CRM, or Campaigns access, use
      <a href="/api/zoho-setup">/api/zoho-setup</a> instead.<br>
      The refresh token generated here goes into
      <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">ZOHO_SOCIAL_REFRESH_TOKEN</code>,
      NOT <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">ZOHO_REFRESH_TOKEN</code>.
    </div>

    <div style="margin-bottom:24px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Permissions being requested:</strong>
      <ul style="margin:10px 0 0;padding-left:20px;line-height:2">
        <li><strong>ZohoSocial.portals.ALL</strong> — read/manage Social portals (workspaces)</li>
        <li><strong>ZohoSocial.message.ALL</strong> — create, schedule, and manage posts</li>
      </ul>
      <p style="margin:10px 0 0;color:#888;font-size:12px">
        No Books, CRM, or Campaigns scopes are included here — those use a separate token.
      </p>
    </div>

    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Authorize Zoho Social →</a>

    <div style="margin-top:20px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px;font-size:13px">
      <strong>After authorizing:</strong>
      <ol style="margin:8px 0 0;padding-left:20px;line-height:2">
        <li>Copy the <strong>ZOHO_SOCIAL_REFRESH_TOKEN</strong> value shown on the next screen</li>
        <li>Go to Vercel → your project → Settings → Environment Variables</li>
        <li>Add or update <strong>ZOHO_SOCIAL_REFRESH_TOKEN</strong> with the new value</li>
        <li><strong>Redeploy</strong> the project — the new token won't take effect until you redeploy</li>
      </ol>
    </div>

    <p style="margin-top:16px;font-size:12px;color:#888">
      Redirect URI: <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">${REDIRECT_URI}</code>
    </p>
  `));
}

function tokenRow(name, value) {
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#7a7a7a;margin-bottom:4px;letter-spacing:1px">${name}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input readonly value="${value}"
          style="flex:1;font-family:monospace;font-size:12px;padding:8px 10px;
                 border:1px solid #e0e0e0;border-radius:4px;background:#f8f8f8"
          onclick="this.select()"/>
        <button onclick="navigator.clipboard.writeText('${value}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)"
          style="padding:8px 14px;background:#f37321;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px">
          Copy
        </button>
      </div>
    </div>`;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>${title} — ST1 RevOps</title>
    <style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1a1a1a}
      h1{color:#f37321;font-size:22px;margin-bottom:8px}</style>
  </head><body>
    <h1>${title}</h1>
    ${body}
  </body></html>`;
}
