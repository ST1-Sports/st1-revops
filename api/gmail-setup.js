/**
 * /api/gmail-setup  — Gmail OAuth setup, supports per-rep accounts
 *
 * Usage:
 *   /api/gmail-setup          → connect the default (Matt's) account → GMAIL_REFRESH_TOKEN
 *   /api/gmail-setup?rep=josh → connect Josh's account → GMAIL_REFRESH_TOKEN_JOSH
 *
 * After authorizing, copy the shown env var into Vercel → Settings → Environment Variables
 * and redeploy. The /api/gmail handler will automatically use the right token per sender.
 *
 * Required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET
 */

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

export default async function handler(req, res) {
  const clientId     = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const host         = req.headers.host || "";
  const proto        = host.includes("localhost") ? "http" : "https";
  const redirectUri  = process.env.GMAIL_REDIRECT_URI || `${proto}://${host}/api/gmail-setup`;

  // rep name comes through query param on initial request, then via OAuth state on callback
  const repFromQuery = (req.query.rep || "").toLowerCase().trim();
  const { code, error: oauthError, state } = req.query || {};

  // Decode rep name from state (passed through OAuth redirect)
  const repName = code ? (state || "") : repFromQuery;
  const envVarName = repName ? `GMAIL_REFRESH_TOKEN_${repName.toUpperCase()}` : "GMAIL_REFRESH_TOKEN";
  const displayName = repName
    ? `${repName.charAt(0).toUpperCase()}${repName.slice(1)}'s Gmail`
    : "Default Gmail (Matt)";

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
          <p><a href="/api/gmail-setup${repName ? `?rep=${repName}` : ""}">← Try again</a></p>
          <p style="font-size:12px;color:#888">Tip: Make sure to accept all permissions and any unverified-app warnings.</p>
        `));
      }
      return res.status(200).send(page(`✓ ${displayName} Connected!`, `
        <p style="color:#1e8f4e;font-size:16px;margin-bottom:20px">
          Authorization successful. Add this to Vercel → Settings → Environment Variables, then redeploy.
        </p>
        ${tokenRow(envVarName, data.refresh_token)}
        <div style="margin-top:20px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px">
          <strong>Next:</strong> Paste <code>${envVarName}</code> into Vercel env vars and redeploy.
          Then campaign emails assigned to ${repName || "Matt"} will send from their own inbox.
        </div>
        <p style="margin-top:16px"><a href="/settings">← Back to Settings</a></p>
      `));
    } catch(err) {
      return res.status(500).send(page("Error", `<p style="color:red">${err.message}</p>`));
    }
  }

  if (oauthError) {
    return res.status(400).send(page("Authorization Denied", `
      <p style="color:red">Google returned: ${oauthError}</p>
      <p><a href="/api/gmail-setup${repName ? `?rep=${repName}` : ""}">← Try again</a></p>
    `));
  }

  if (!clientId) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">Set <strong>GMAIL_CLIENT_ID</strong> and <strong>GMAIL_CLIENT_SECRET</strong>
      in Vercel environment variables, then come back here.</p>
    `));
  }

  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    access_type:   "offline",
    scope:         SCOPE,
    redirect_uri:  redirectUri,
    prompt:        "consent",
    state:         repName,
    login_hint:    repName ? `${repName}@st1sports.com` : "",
  }).toString();

  return res.status(200).send(page(`Connect ${displayName}`, `
    <p style="color:#424242;margin-bottom:8px">
      Connecting: <strong>${displayName}</strong>
    </p>
    ${repName ? `<p style="color:#424242;margin-bottom:24px;font-size:13px">
      Sign in as <strong>${repName}@st1sports.com</strong> when Google prompts for an account.
      Campaign emails assigned to this rep will send from their real inbox.
    </p>` : `<p style="color:#424242;margin-bottom:24px;font-size:13px">
      This connects the default sending account. For per-rep inboxes, use
      <code>/api/gmail-setup?rep=josh</code>, <code>?rep=blake</code>, etc.
    </p>`}
    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Connect ${displayName} →</a>
    <div style="margin-top:20px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Permissions:</strong> Read Gmail inbox + send emails on behalf of this account.<br>
      ST1 RevOps will never delete messages or modify the inbox.
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
      h1{color:#f37321;font-size:22px;margin-bottom:8px}a{color:#1a5fa8}code{background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:12px}</style>
  </head><body>
    <h1>${title}</h1>
    ${body}
  </body></html>`;
}
