/**
 * Vercel Serverless Function: /api/zoho-setup
 *
 * One-time OAuth setup helper.
 *
 * Step 1 — GET /api/zoho-setup
 *   Shows a button linking to Zoho's authorization page.
 *
 * Step 2 — After Zoho redirects back with ?code=...
 *   Exchanges the auth code for access + refresh tokens and displays them.
 *   Copy the refresh_token value into your Vercel ZOHO_REFRESH_TOKEN env var.
 *
 * Required env vars before running:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET
 *
 * Redirect URI to register in your Zoho OAuth app:
 *   https://<your-vercel-domain>/api/zoho-setup
 */

const SCOPES = [
  // Zoho Books — invoices, AR, payments, items/inventory, estimates/quotes
  "ZohoBooks.invoices.ALL",
  "ZohoBooks.contacts.ALL",
  "ZohoBooks.customerpayments.ALL",
  "ZohoBooks.estimates.ALL",
  "ZohoBooks.items.ALL",
  // Zoho CRM — contacts, leads, deals
  "ZohoCRM.modules.Contacts.ALL",
  "ZohoCRM.modules.Leads.ALL",
  "ZohoCRM.modules.Deals.ALL",
  "ZohoCRM.users.READ",
  // Zoho Campaigns — email list management, marketing automation
  "ZohoCampaigns.campaign.ALL",
  "ZohoCampaigns.contact.ALL",
  // Zoho Social — post to Facebook, Instagram, LinkedIn, Twitter/X
  "ZohoSocial.account.ALL",
].join(",");

export default async function handler(req, res) {
  const clientId     = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const host         = req.headers.host || "";
  const proto        = host.includes("localhost") ? "http" : "https";
  const redirectUri  = `${proto}://${host}/api/zoho-setup`;

  const { code, error: oauthError } = req.query || {};

  // ── Step 2: Exchange code for tokens ────────────────────────────────────────
  if (code) {
    if (!clientId || !clientSecret) {
      return res.status(500).send(page("Missing env vars", `
        <p style="color:red">ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in Vercel before running setup.</p>
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
          redirect_uri:  redirectUri,
          grant_type:    "authorization_code",
        }).toString(),
      });

      const data = await tokenRes.json();

      if (!data.refresh_token) {
        return res.status(400).send(page("Token Exchange Failed", `
          <p style="color:red">Zoho returned an error:</p>
          <pre style="background:#fee;padding:12px;border-radius:4px">${JSON.stringify(data, null, 2)}</pre>
          <p><a href="/api/zoho-setup">← Try again</a></p>
        `));
      }

      return res.status(200).send(page("✓ Zoho Connected!", `
        <p style="color:#1e8f4e;font-size:16px;margin-bottom:20px">
          Authorization successful. Copy the values below into your Vercel environment variables.
        </p>

        ${tokenRow("ZOHO_REFRESH_TOKEN", data.refresh_token)}
        ${tokenRow("ZOHO_CLIENT_ID", clientId)}
        ${tokenRow("ZOHO_CLIENT_SECRET", clientSecret)}

        <div style="margin-top:24px;padding:14px;background:#fff8e6;border:1px solid #c7780040;border-radius:6px">
          <strong>Where to add these:</strong><br>
          Vercel dashboard → your project → Settings → Environment Variables<br><br>
          Also set <strong>ZOHO_ORG_ID</strong> — find it in Zoho Books → Settings → Organization Profile.
        </div>

        <div style="margin-top:16px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px">
          <strong>Next:</strong> redeploy your Vercel project so the new env vars take effect, then click
          "Test Connection" on the Integrations page.
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
      <p><a href="/api/zoho-setup">← Try again</a></p>
    `));
  }

  if (!clientId) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">Set <strong>ZOHO_CLIENT_ID</strong> and <strong>ZOHO_CLIENT_SECRET</strong>
      in Vercel environment variables first, then come back here.</p>
      <h3 style="margin-top:20px">How to create your Zoho OAuth app</h3>
      <ol style="line-height:2">
        <li>Go to <strong>api-console.zoho.com</strong></li>
        <li>Click <strong>Server-based Applications</strong> → Create</li>
        <li>Set Homepage URL to your Vercel URL</li>
        <li>Set Authorized Redirect URI to: <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">https://YOUR-VERCEL-DOMAIN/api/zoho-setup</code></li>
        <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into Vercel env vars</li>
        <li>Redeploy, then come back to this page</li>
      </ol>
    `));
  }

  const authUrl = "https://accounts.zoho.com/oauth/v2/auth?" + new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    access_type:   "offline",
    scope:         SCOPES,
    redirect_uri:  redirectUri,
    prompt:        "consent",
  }).toString();

  return res.status(200).send(page("Connect Zoho to ST1 RevOps", `
    <p style="color:#424242;margin-bottom:24px">
      Click the button below to authorize ST1 RevOps to access your Zoho Books and CRM accounts.
      You'll be redirected back here with your tokens.
    </p>

    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Authorize with Zoho →</a>

    <div style="margin-top:24px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Permissions being requested:</strong><br>
      Zoho Books: read/write invoices, contacts, payments<br>
      Zoho CRM: read/write Contacts, Leads, and Deals<br>
      Zoho Campaigns: manage mailing lists and subscribers<br>
      Zoho Social: read accounts, publish posts to connected channels
    </div>
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
    <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#1a1a1a}
      h1{color:#f37321;font-size:22px;margin-bottom:8px}</style>
  </head><body>
    <h1>${title}</h1>
    ${body}
  </body></html>`;
}
