/**
 * Vercel Serverless Function: /api/zoho-setup
 *
 * One-time OAuth setup helper.
 *
 * !! IMPORTANT — Complete Step 0 in Zoho API Console BEFORE clicking Authorize !!
 *
 * Step 0 — Configure your Zoho API Console app (one-time):
 *   1. Go to https://api-console.zoho.com/
 *   2. Click your existing app (or create a new "Server-based Applications" one)
 *   3. Click "Edit" → open the "Scopes" tab
 *   4. Search for and add ALL of the following services + scopes:
 *        Zoho Books:     invoices.ALL, contacts.ALL, customerpayments.ALL, estimates.ALL, items.ALL
 *        Zoho CRM:       modules.Contacts.ALL, modules.Leads.ALL, modules.Deals.ALL, users.READ
 *        Zoho Campaigns: campaign.ALL, contact.ALL
 *        Zoho Social:    portals.ALL, message.ALL
 *   5. Save the app.  Redirect URI must be: https://revops.st1sports.com/api/zoho-setup
 *
 * Step 1 — GET /api/zoho-setup → click Authorize button
 * Step 2 — Copy the refresh_token into Vercel env var ZOHO_REFRESH_TOKEN, then redeploy
 */

const SCOPES = [
  // Zoho Books
  "ZohoBooks.invoices.ALL",
  "ZohoBooks.contacts.ALL",
  "ZohoBooks.customerpayments.ALL",
  "ZohoBooks.estimates.ALL",
  "ZohoBooks.items.ALL",
  // Zoho CRM
  "ZohoCRM.modules.Contacts.ALL",
  "ZohoCRM.modules.Leads.ALL",
  "ZohoCRM.modules.Deals.ALL",
  "ZohoCRM.users.READ",
  // Zoho Campaigns
  "ZohoCampaigns.campaign.ALL",
  "ZohoCampaigns.contact.ALL",
  // Zoho Social
  "ZohoSocial.portals.ALL",
  "ZohoSocial.message.ALL",
].join(",");

export default async function handler(req, res) {
  const clientId     = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const host         = req.headers.host || "";
  const proto        = host.includes("localhost") ? "http" : "https";
  const redirectUri  = process.env.ZOHO_REDIRECT_URI || `${proto}://${host}/api/zoho-setup`;

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
          <strong>Next:</strong> redeploy your Vercel project so the new env vars take effect.
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
      <p>If you see <strong>"Invalid OAuth Scope"</strong>, you need to add the missing product scopes
      to your app at <a href="https://api-console.zoho.com/" target="_blank">api-console.zoho.com</a>
      before authorizing. See Step 0 at the top of this page.</p>
      <p><a href="/api/zoho-setup">← Try again</a></p>
    `));
  }

  if (!clientId) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">Set <strong>ZOHO_CLIENT_ID</strong> and <strong>ZOHO_CLIENT_SECRET</strong>
      in Vercel environment variables first, then come back here.</p>
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

    <div style="margin-bottom:28px;padding:18px;background:#fff3cd;border:2px solid #f0ad00;border-radius:8px">
      <div style="font-size:15px;font-weight:700;color:#7a4f00;margin-bottom:12px">⚠ Complete Step 0 in Zoho API Console FIRST</div>
      <p style="color:#5a3a00;margin:0 0 10px">
        Before clicking Authorize, your Zoho API Console app must have <strong>all four products</strong> enabled.
        If any product is missing, Zoho will show "Invalid OAuth Scope."
      </p>
      <ol style="color:#5a3a00;margin:0;padding-left:20px;line-height:2">
        <li>Go to <a href="https://api-console.zoho.com/" target="_blank" style="color:#c47a00;font-weight:700">api-console.zoho.com</a></li>
        <li>Open your app → click <strong>Edit</strong> → <strong>Scopes</strong> tab</li>
        <li>Add <strong>Zoho Books</strong>, <strong>Zoho CRM</strong>, <strong>Zoho Campaigns</strong>, and <strong>Zoho Social</strong></li>
        <li>For each, enable the <strong>ALL</strong> permission level on the scopes listed below</li>
        <li>Save, then come back here and click Authorize</li>
      </ol>
    </div>

    <div style="margin-bottom:24px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Scopes being requested (all must be enabled in API Console):</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px">
        ${[
          ["Zoho Books","ZohoBooks.invoices.ALL, contacts.ALL, customerpayments.ALL, estimates.ALL, items.ALL"],
          ["Zoho CRM","ZohoCRM.modules.Contacts.ALL, Leads.ALL, Deals.ALL, users.READ"],
          ["Zoho Campaigns","ZohoCampaigns.campaign.ALL, contact.ALL"],
          ["Zoho Social","ZohoSocial.portals.ALL, message.ALL"],
        ].map(([product, scopes]) => `
          <div style="padding:8px;background:white;border:1px solid #e8e8e8;border-radius:4px">
            <div style="font-weight:700;font-size:11px;color:#f37321;margin-bottom:3px">${product}</div>
            <div style="font-size:11px;color:#555;font-family:monospace">${scopes}</div>
          </div>
        `).join("")}
      </div>
    </div>

    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Authorize with Zoho →</a>

    <p style="margin-top:16px;font-size:12px;color:#888">
      Redirect URI registered in your app: <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">${redirectUri}</code>
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
