/**
 * /api/gmail-setup  — one-time Gmail OAuth setup (mirrors zoho-setup pattern)
 *
 * Step 1 — GET /api/gmail-setup
 *   Shows a button linking to Google's authorization page.
 *
 * Step 2 — After Google redirects back with ?code=...
 *   Exchanges the code for access + refresh tokens and displays them.
 *   Copy GMAIL_REFRESH_TOKEN into your Vercel env vars.
 *
 * Required env vars before running:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET
 *
 * Redirect URI to register in Google Cloud Console → APIs & Services → Credentials:
 *   https://<your-vercel-domain>/api/gmail-setup
 *
 * Scopes: gmail.readonly (read inbox) + gmail.send (send emails)
 */

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

export default async function handler(req, res) {
  const clientId     = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const host         = req.headers.host || "";
  const proto        = host.includes("localhost") ? "http" : "https";
  const redirectUri  = process.env.GMAIL_REDIRECT_URI || `${proto}://${host}/api/gmail-setup`;

  const { code, error: oauthError, repKey } = req.query || {};
  const repKeyClean = repKey ? repKey.toUpperCase().replace(/[^A-Z0-9]/g, "_") : "";
  const refreshTokenVar = repKeyClean ? `GMAIL_REFRESH_TOKEN_${repKeyClean}` : "GMAIL_REFRESH_TOKEN";

  // ── Step 2: exchange code ───────────────────────────────────────────────────
  if (code) {
    if (!clientId || !clientSecret) {
      return res.status(500).send(page("Missing env vars",
        `<p style="color:red">Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel first.</p>`));
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          redirect_uri:  redirectUri,
          grant_type:    "authorization_code",
        }).toString(),
      });
      const data = await tokenRes.json();
      if (!data.refresh_token) {
        return res.status(400).send(page("Token Exchange Failed", `
          <p style="color:red">Google returned:</p>
          <pre style="background:#fee;padding:12px;border-radius:4px">${JSON.stringify(data,null,2)}</pre>
          <p><a href="/api/gmail-setup">← Try again</a></p>
          <p style="font-size:12px;color:#888">Tip: Make sure to select "All" when Google asks about your data and accept any warnings about unverified apps.</p>
        `));
      }
      return res.status(200).send(page("✓ Gmail Connected!", `
        <p style="color:#1e8f4e;font-size:16px;margin-bottom:20px">
          Authorization successful. Add ${repKeyClean ? `<strong>${refreshTokenVar}</strong> (for rep ${repKeyClean})` : "these"} to Vercel → Settings → Environment Variables.
        </p>
        ${tokenRow(refreshTokenVar, data.refresh_token)}
        ${!repKeyClean ? tokenRow("GMAIL_CLIENT_ID", clientId) : ""}
        ${!repKeyClean ? tokenRow("GMAIL_CLIENT_SECRET", clientSecret) : ""}
        <div style="margin-top:20px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px">
          <strong>Next:</strong> Add <code>${refreshTokenVar}</code> to Vercel env vars, then redeploy.
          ${repKeyClean ? `In Settings → Sales Reps, make sure the Gmail Key for this rep is set to <strong>${repKeyClean}</strong>.` : 'Click "Test Gmail" in the Integrations → Email tab to confirm.'}
        </div>
      `));
    } catch(err) {
      return res.status(500).send(page("Error", `<p style="color:red">${err.message}</p>`));
    }
  }

  if (oauthError) {
    return res.status(400).send(page("Authorization Denied", `
      <p style="color:red">Google returned: ${oauthError}</p>
      <p><a href="/api/gmail-setup">← Try again</a></p>
    `));
  }

  if (!clientId) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">Set <strong>GMAIL_CLIENT_ID</strong> and <strong>GMAIL_CLIENT_SECRET</strong>
      in Vercel environment variables, then come back here.</p>
      <h3 style="margin-top:20px">How to create a Google OAuth app</h3>
      <ol style="line-height:2.2;font-size:14px">
        <li>Go to <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a></li>
        <li>Create a new project (or use an existing one)</li>
        <li>Enable the <strong>Gmail API</strong> (APIs & Services → Library → search Gmail)</li>
        <li>Create OAuth credentials (APIs & Services → Credentials → Create Credentials → OAuth client ID)</li>
        <li>Type: <strong>Web application</strong></li>
        <li>Add Authorized redirect URI: <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">https://YOUR-VERCEL-DOMAIN/api/gmail-setup</code></li>
        <li>Copy Client ID + Client Secret into Vercel env vars as <code>GMAIL_CLIENT_ID</code> / <code>GMAIL_CLIENT_SECRET</code></li>
        <li>Redeploy Vercel, then come back here</li>
      </ol>
      <p style="font-size:12px;color:#888;margin-top:12px">For the OAuth consent screen, set it to "Internal" if your Google account is a Workspace account, or "External" + add your email as a test user.</p>
    `));
  }

  // Carry repKey through state so we know which env var to display after redirect
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    access_type:   "offline",
    scope:         SCOPE,
    redirect_uri:  redirectUri + (repKeyClean ? `?repKey=${repKeyClean}` : ""),
    prompt:        "consent",
  }).toString();

  const pageTitle = repKeyClean ? `Connect Gmail for ${repKeyClean}` : "Connect Gmail to ST1 RevOps";
  return res.status(200).send(page(pageTitle, `
    <p style="color:#424242;margin-bottom:24px">
      Click below to authorize read-only access to your Gmail inbox.
      ST1 RevOps will scan for customer order emails and turn them into deals automatically.
    </p>
    ${repKeyClean ? `<p style="background:#fff8e6;padding:10px 14px;border-radius:6px;border:1px solid #f0c040;font-size:13px">Setting up Gmail for rep key: <strong>${repKeyClean}</strong>. This will generate <code>GMAIL_REFRESH_TOKEN_${repKeyClean}</code>.</p>` : ""}
    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">${repKeyClean ? `Connect ${repKeyClean}'s Gmail →` : "Connect Gmail →"}</a>
    <div style="margin-top:20px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Permissions requested:</strong> Read Gmail inbox (gmail.readonly) + Send emails on your behalf (gmail.send)<br>
      ST1 RevOps will never delete messages or modify your inbox. Send permission is used only when you click "Send Now" on an agent-drafted email.
    </div>
  `));
}

function tokenRow(name, value) {
  const safe = value.replace(/'/g, "\\'");
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#7a7a7a;margin-bottom:4px;letter-spacing:1px">${name}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input readonly value="${value}"
          style="flex:1;font-family:monospace;font-size:12px;padding:8px 10px;
                 border:1px solid #e0e0e0;border-radius:4px;background:#f8f8f8"
          onclick="this.select()"/>
        <button onclick="navigator.clipboard.writeText('${safe}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)"
          style="padding:8px 14px;background:#f37321;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px">
          Copy
        </button>
      </div>
    </div>`;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>${title} — ST1 RevOps</title>
    <style>body{font-family:system-ui,sans-serif;max-width:660px;margin:40px auto;padding:0 20px;color:#1a1a1a}
      h1{color:#f37321;font-size:22px;margin-bottom:8px}a{color:#1a5fa8}</style>
  </head><body>
    <h1>${title}</h1>
    ${body}
  </body></html>`;
}
