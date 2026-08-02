/**
 * /api/shopify-setup — one-time Shopify OAuth setup (mirrors zoho-setup.js /
 * gmail-setup.js pattern).
 *
 * Shopify's custom-app flow no longer hands out a static "Admin API access
 * token" directly from the app settings screen — it now requires the same
 * OAuth authorization-code exchange as a public app, even for an app scoped
 * to a single store. This does that exchange once and displays the
 * resulting (non-expiring, offline) access token to paste into
 * SHOPIFY_ACCESS_TOKEN.
 *
 * Step 1 — GET /api/shopify-setup → click Authorize button
 * Step 2 — Copy the access_token shown into Vercel env var SHOPIFY_ACCESS_TOKEN
 * Step 3 — Redeploy Vercel project so the new token takes effect
 *
 * Required env vars before running:
 *   SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET  (from the app's Settings → Credentials tab)
 *   SHOPIFY_STORE_URL                          (e.g. "st1sports.myshopify.com" — already used by api/_lib/shopify.js)
 *
 * Before clicking Authorize, add this exact URL to the app's Configuration →
 * "Redirect URLs" field in Shopify (Settings → Apps and sales channels →
 * Develop apps → your app → Configuration):
 *   https://<your-vercel-domain>/api/shopify-setup
 *
 * Requests a working default scope set — pass ?scope=a,b,c to request a
 * different (or broader, matching whatever the app itself is configured
 * for) list instead.
 */

const DEFAULT_SCOPES = "read_orders,read_all_orders,read_checkouts,read_products";

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const storeUrl     = (process.env.SHOPIFY_STORE_URL || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const host         = req.headers.host || "";
  const proto        = host.includes("localhost") ? "http" : "https";
  const redirectUri  = `${proto}://${host}/api/shopify-setup`;

  const { code, shop, scope: scopeParam, error: oauthError } = req.query || {};

  // ── Step 2: Exchange code for an access token ───────────────────────────────
  if (code) {
    const shopDomain = (shop || storeUrl || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!clientId || !clientSecret) {
      return res.status(500).send(page("Missing env vars", `
        <p style="color:red">SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set in Vercel before running setup.</p>
      `));
    }
    if (!shopDomain) {
      return res.status(400).send(page("Missing shop", `<p style="color:red">No shop domain in the callback and SHOPIFY_STORE_URL isn't set.</p>`));
    }

    try {
      const tokenRes = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = await tokenRes.json();

      if (!data.access_token) {
        return res.status(400).send(page("Token Exchange Failed", `
          <p style="color:red">Shopify returned an error:</p>
          <pre style="background:#fee;padding:12px;border-radius:4px">${escHtml(JSON.stringify(data, null, 2))}</pre>
          <p><a href="/api/shopify-setup">← Try again</a></p>
        `));
      }

      return res.status(200).send(page("✓ Shopify Connected!", `
        <p style="color:#1e8f4e;font-size:16px;margin-bottom:20px">
          Authorization successful. Copy the value below into your Vercel environment variables.
        </p>

        ${tokenRow("SHOPIFY_ACCESS_TOKEN", data.access_token)}

        <div style="margin-top:12px;font-size:12px;color:#888">Granted scopes: ${escHtml(data.scope || "")}</div>

        <div style="margin-top:24px;padding:14px;background:#fff8e6;border:1px solid #c7780040;border-radius:6px">
          <strong>Where to add this:</strong><br>
          Vercel dashboard → your project → Settings → Environment Variables → <strong>SHOPIFY_ACCESS_TOKEN</strong>
        </div>

        <div style="margin-top:16px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px">
          <strong>Next:</strong> redeploy your Vercel project so the new token takes effect. This token doesn't
          expire on its own — no need to repeat this unless the app gets uninstalled or the token is revoked.
        </div>
      `));

    } catch (err) {
      return res.status(500).send(page("Error", `<p style="color:red">${escHtml(err.message)}</p>`));
    }
  }

  // ── Step 1: Show the authorization link ─────────────────────────────────────
  if (oauthError) {
    return res.status(400).send(page("Authorization Denied", `
      <p style="color:red">Shopify returned: ${escHtml(oauthError)}</p>
      <p><a href="/api/shopify-setup">← Try again</a></p>
    `));
  }

  if (!clientId || !storeUrl) {
    return res.status(500).send(page("Setup Required", `
      <p style="color:red">Set <strong>SHOPIFY_CLIENT_ID</strong>, <strong>SHOPIFY_CLIENT_SECRET</strong>, and
      <strong>SHOPIFY_STORE_URL</strong> in Vercel environment variables first, then come back here.</p>
    `));
  }

  const scopes  = scopeParam || DEFAULT_SCOPES;
  const authUrl = `https://${storeUrl}/admin/oauth/authorize?` + new URLSearchParams({
    client_id:    clientId,
    scope:        scopes,
    redirect_uri: redirectUri,
    state:        Math.random().toString(36).slice(2),
  }).toString();

  return res.status(200).send(page("Connect Shopify to ST1 RevOps", `
    <div style="margin-bottom:24px;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;font-size:13px">
      <strong>Requesting scopes:</strong> ${escHtml(scopes)}<br>
      <span style="color:#888;font-size:12px">Add ?scope=a,b,c to this URL to request a different list — must be a
      subset of what the app itself is configured for in Shopify.</span>
    </div>

    <div style="margin-bottom:24px;padding:14px;background:#fdecea;border:1px solid #c0392b40;border-radius:6px;font-size:13px">
      <strong>Before clicking below:</strong> in Shopify → Settings → Apps and sales channels → Develop apps →
      your app → Configuration, add this exact URL to <strong>Redirect URLs</strong> and save:<br>
      <code style="background:#fff;padding:2px 6px;border-radius:3px;display:inline-block;margin-top:6px">${escHtml(redirectUri)}</code>
    </div>

    <a href="${authUrl}" style="
      display:inline-block;background:#F37321;color:white;text-decoration:none;
      padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;
    ">Authorize with Shopify →</a>

    <div style="margin-top:20px;padding:14px;background:#e8f0fa;border:1px solid #1a5fa840;border-radius:6px;font-size:13px">
      <strong>After authorizing:</strong>
      <ol style="margin:8px 0 0;padding-left:20px;line-height:2">
        <li>Copy the <strong>SHOPIFY_ACCESS_TOKEN</strong> value shown on the next screen</li>
        <li>Go to Vercel → your project → Settings → Environment Variables</li>
        <li>Update <strong>SHOPIFY_ACCESS_TOKEN</strong> with the new value</li>
        <li><strong>Redeploy</strong> the project — the new token won't take effect until you redeploy</li>
      </ol>
    </div>
  `));
}

function tokenRow(name, value) {
  const safe = escHtml(value);
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#7a7a7a;margin-bottom:4px;letter-spacing:1px">${name}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input readonly value="${safe}"
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
    <style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1a1a1a}
      h1{color:#f37321;font-size:22px;margin-bottom:8px}</style>
  </head><body>
    <h1>${title}</h1>
    ${body}
  </body></html>`;
}
