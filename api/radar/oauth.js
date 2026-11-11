/**
 * Per-user Gmail OAuth for Follow-Up Radar.
 * Scopes: gmail.readonly + gmail.compose ONLY (never the send scope).
 *
 * Configure the Google Cloud OAuth client as Internal to the st1sports.com
 * Workspace so Google verification is not required.
 *
 * Redirect URI to register:
 *   https://revops.st1sports.com/api/radar/oauth
 *   http://localhost:3000/api/radar/oauth
 */
import { prisma } from '../_lib/prisma.js';
import { encryptSecret } from '../_lib/radar/crypto.js';
import { RADAR_SCOPE_STRING } from '../_lib/radar/gmail.js';
import { seedRadarConfig } from '../_lib/radar/seed.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>${esc(title)} — ST1 Follow-Up Radar</title>
    <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#1a1a1a}
      h1{color:#f37321;font-size:22px}a{color:#1a5fa8}.ok{background:#e8f5e9;border:2px solid #43a047;border-radius:8px;padding:20px;text-align:center}</style>
  </head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}

function redirectUri(req) {
  if (process.env.RADAR_GMAIL_REDIRECT_URI) return process.env.RADAR_GMAIL_REDIRECT_URI;
  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}/api/radar/oauth`;
}

export default async function handler(req, res) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const uri = redirectUri(req);
  const { code, error: oauthError, userId: qUser, state } = req.query || {};

  let userId = qUser || '';
  if (state && !userId) {
    try { userId = decodeURIComponent(state).split('|')[0] || ''; } catch { userId = ''; }
  }
  userId = String(userId || '').trim();

  if (oauthError) {
    return res.status(400).send(page('Gmail connect cancelled', `<p>${esc(oauthError)}</p><p><a href="/follow-up-radar">Back to Follow-Up Radar</a></p>`));
  }

  if (code) {
    if (!clientId || !clientSecret) {
      return res.status(500).send(page('Missing Google credentials', '<p>Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.</p>'));
    }
    if (!userId) {
      return res.status(400).send(page('Missing user', '<p>OAuth state did not include a userId.</p>'));
    }
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: uri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      const data = await tokenRes.json();
      if (!data.refresh_token) {
        return res.status(400).send(page('Token exchange failed', `
          <p>Google did not return a refresh token. Disconnect the app from Google Account → Security → Third-party access and retry, making sure to grant inbox + compose.</p>
          <pre>${esc(JSON.stringify(data, null, 2))}</pre>
        `));
      }
      let email = '';
      try {
        const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        }).then(r => r.json());
        email = String(info.email || '').toLowerCase();
      } catch { /* profile is optional; Gmail profile fills it on first sync */ }

      const packed = encryptSecret(data.refresh_token);
      await seedRadarConfig();
      await prisma.inboxConnection.upsert({
        where: { userId_provider: { userId, provider: 'gmail' } },
        update: {
          email: email || undefined,
          encryptedRefreshToken: packed,
          scopes: RADAR_SCOPE_STRING,
          status: 'active',
          lastError: null,
          historyId: null,
          lastSyncAt: null,
          syncCursor: null,
        },
        create: {
          userId,
          provider: 'gmail',
          email: email || userId,
          encryptedRefreshToken: packed,
          scopes: RADAR_SCOPE_STRING,
          status: 'active',
          backfillDays: 120,
        },
      });

      res.setHeader('Location', '/follow-up-radar?connected=1');
      return res.status(302).end();
    } catch (err) {
      return res.status(500).send(page('Connect failed', `<p>${esc(err.message)}</p>`));
    }
  }

  if (!clientId) {
    return res.status(500).send(page('Gmail OAuth not configured', '<p>Set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET. Mark the OAuth app Internal to st1sports.com Workspace.</p>'));
  }
  if (!userId) {
    return res.status(400).send(page('Missing user', '<p>Open this from Settings or Follow-Up Radar so we know which inbox to connect.</p>'));
  }

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', uri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', RADAR_SCOPE_STRING);
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent');
  auth.searchParams.set('state', `${userId}|radar`);
  if (String(userId).includes('@')) auth.searchParams.set('login_hint', userId);

  return res.status(200).send(page('Connect Gmail for Follow-Up Radar', `
    <p>This connection can <strong>read</strong> your mail and <strong>create drafts</strong>. It cannot send. Drafts stay in your Gmail until you hit send.</p>
    <p>Use your own <strong>@st1sports.com</strong> inbox. The OAuth app should be Internal to the ST1 Workspace.</p>
    <p><a href="${esc(auth.toString())}" style="display:inline-block;background:#F37321;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700">Connect my Gmail →</a></p>
  `));
}
