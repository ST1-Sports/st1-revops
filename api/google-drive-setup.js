/**
 * /api/google-drive-setup — one-time Google Drive OAuth setup.
 *
 * Required before running:
 *   GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET
 *   or GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET as fallback.
 *
 * Redirect URI:
 *   https://<your-vercel-domain>/api/google-drive-setup
 *
 * Scope:
 *   https://www.googleapis.com/auth/drive.readonly
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenRow(name, value) {
  const safe = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const attr = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#7a7a7a;margin-bottom:4px;letter-spacing:1px">${name}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input readonly value="${attr}" style="flex:1;font-family:monospace;font-size:12px;padding:8px 10px;border:1px solid #e0e0e0;border-radius:4px;background:#f8f8f8" onclick="this.select()"/>
        <button onclick="navigator.clipboard.writeText('${safe}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" style="padding:8px 12px;border:0;border-radius:4px;background:#F37321;color:white;cursor:pointer">Copy</button>
      </div>
    </div>`;
}

function page(title, body) {
  return `<!doctype html>
    <html>
      <head><title>${escHtml(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
      <body style="font-family:Inter,Arial,sans-serif;background:#F2F2F0;color:#1A1A18;margin:0;padding:32px">
        <div style="max-width:760px;margin:0 auto;background:white;border:1px solid #E2E0DB;border-radius:10px;padding:28px;box-shadow:0 1px 6px rgba(0,0,0,.08)">
          <div style="font-size:11px;color:#F37321;letter-spacing:2px;font-weight:800;margin-bottom:8px">ST1 AI KNOWLEDGE</div>
          <h1 style="margin:0 0 18px;font-size:24px">${escHtml(title)}</h1>
          ${body}
        </div>
      </body>
    </html>`;
}

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || `${proto}://${host}/api/google-drive-setup`;
  const { code, error: oauthError } = req.query || {};

  if (oauthError) {
    return res.status(400).send(page('Authorization denied', `<p style="color:#C0392B">Google returned: ${escHtml(oauthError)}</p><p><a href="/api/google-drive-setup">Try again</a></p>`));
  }

  if (!clientId || !clientSecret) {
    return res.status(500).send(page('Setup required', `
      <p style="color:#C0392B">Set <strong>GOOGLE_DRIVE_CLIENT_ID</strong> and <strong>GOOGLE_DRIVE_CLIENT_SECRET</strong> in Vercel first. You can also reuse <strong>GMAIL_CLIENT_ID</strong> and <strong>GMAIL_CLIENT_SECRET</strong>.</p>
      <ol style="line-height:1.9;font-size:14px">
        <li>Go to Google Cloud Console → APIs & Services.</li>
        <li>Enable <strong>Google Drive API</strong>.</li>
        <li>Create OAuth Client ID credentials for a Web application.</li>
        <li>Add redirect URI: <code>${escHtml(redirectUri)}</code></li>
        <li>Redeploy, then visit this page again.</li>
      </ol>
    `));
  }

  if (code) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      const data = await tokenRes.json();
      if (!data.refresh_token) {
        return res.status(400).send(page('Token exchange failed', `
          <p style="color:#C0392B">Google returned no refresh token.</p>
          <pre style="background:#FDECEA;padding:12px;border-radius:6px;white-space:pre-wrap">${escHtml(JSON.stringify(data, null, 2))}</pre>
          <p><a href="/api/google-drive-setup">Try again</a></p>
        `));
      }
      return res.status(200).send(page('Google Drive connected', `
        <p style="color:#1E8F4E;font-size:15px;margin-bottom:18px">Authorization successful. Add this to Vercel Environment Variables, then redeploy.</p>
        ${tokenRow('GOOGLE_DRIVE_REFRESH_TOKEN', data.refresh_token)}
        <div style="margin-top:18px;padding:14px;background:#E8F0FA;border:1px solid #1A5FA840;border-radius:6px;font-size:14px">
          After redeploy, go to <strong>Integrations → AI Knowledge → Connect Google Drive</strong> and paste a Drive file URL.
        </div>
      `));
    } catch (err) {
      return res.status(500).send(page('Error', `<p style="color:#C0392B">${escHtml(err.message)}</p>`));
    }
  }

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    access_type: 'offline',
    scope: SCOPE,
    redirect_uri: redirectUri,
    prompt: 'consent',
  }).toString();

  return res.status(200).send(page('Connect Google Drive', `
    <a href="${authUrl}" style="display:inline-block;background:#F37321;color:white;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px">Connect Google Drive →</a>
    <div style="margin-top:20px;padding:14px;background:#F8F7F5;border:1px solid #E2E0DB;border-radius:6px;font-size:13px;line-height:1.6">
      <strong>Permission requested:</strong> Drive read-only. ST1 RevOps imports selected documents into AI Knowledge when you paste a file URL; it does not modify Drive files.
    </div>
  `));
}
