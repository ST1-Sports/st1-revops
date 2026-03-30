/**
 * Vercel Serverless Function: /api/zoho-setup
 *
 * One-time OAuth setup helper.
 *
 * Step 1 — GET /api/zoho-setup → click Authorize button
 * Step 2 — Copy the refresh_token into Vercel env var ZOHO_REFRESH_TOKEN
 * Step 3 — Redeploy Vercel project so the new token takes effect
 *
 * NOTE: Zoho Social is NOT included — it's a separate paid product with its own
 * OAuth that cannot be bundled here. Social posting uses direct platform links instead.
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
      <p>If you see <strong>"Invalid OAuth Scope"</strong>, one of the requested scopes is not available
      on your Zoho account. Make sure Zoho Books, CRM, and Campaigns are active in your Zoho subscription.</p>
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

    <div style="margin-bottom:24px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Permissions being requested:</strong>
      <ul style="margin:10px 0 0;padding-left:20px;line-height:2">
        <li><strong>Zoho Books</strong> — invoices, contacts, payments, estimates, items</li>
        <li><strong>Zoho CRM</strong> — Contacts, Leads, Deals (read/write)</li>
        <li><strong>Zoho Campaigns</strong> — mailing lists, subscribers, campaigns</li>
      </ul>
      <p style="margin:10px 0 0;color:#888;font-size:12px">Social media posting uses direct platform links — no Zoho Social subscription needed.</p>
    </div>

    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Authorize with Zoho →</a>

    <div style="margin-top:20px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px;font-size:13px">
      <strong>After authorizing:</strong>
      <ol style="margin:8px 0 0;padding-left:20px;line-height:2">
        <li>Copy the <strong>ZOHO_REFRESH_TOKEN</strong> value shown on the next screen</li>
        <li>Go to Vercel → your project → Settings → Environment Variables</li>
        <li>Update <strong>ZOHO_REFRESH_TOKEN</strong> with the new value</li>
        <li><strong>Redeploy</strong> the project — the new token won't take effect until you redeploy</li>
      </ol>
    </div>

    <p style="margin-top:16px;font-size:12px;color:#888">
      Redirect URI: <code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">${redirectUri}</code>
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
