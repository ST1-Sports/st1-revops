/**
 * Per-user Gmail OAuth for Follow-Up Radar.
 * Scopes: gmail.readonly + gmail.compose ONLY (never the send scope).
 *
 * Configure the Google Cloud OAuth client as Internal to the st1sports.com
 * Workspace so Google verification is not required.
 *
 * Flow: the signed-in app POSTs here (Bearer session) and gets the Google URL. The OAuth
 * `state` is signed and names the rep; a matching nonce is set as an HttpOnly cookie, so a
 * callback can only complete in the browser that started it (no login CSRF).
 *
 * Redirect URI to register:
 *   https://revops.st1sports.com/api/radar/oauth
 *   http://localhost:3000/api/radar/oauth
 */
import crypto from 'crypto';
import { prisma } from '../_lib/prisma.js';
import { encryptSecret } from '../_lib/radar/crypto.js';
import { requireRep, signPayload, verifyPayload } from '../_lib/session.js';
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

const NONCE_COOKIE = 'radar_oauth_nonce';
const STATE_TTL_MS = 10 * 60 * 1000;

function cookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function nonceCookie(value, maxAgeSeconds) {
  return `${NONCE_COOKIE}=${encodeURIComponent(value)}; Path=/api/radar/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
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
  // Start: the signed-in app asks for the Google URL.
  if (req.method === 'POST') {
    const me = await requireRep(req, res);
    if (!me) return;
    if (!clientId) return res.status(500).json({ error: 'Gmail OAuth is not configured (GMAIL_CLIENT_ID).' });
    const nonce = crypto.randomBytes(18).toString('base64url');
    const state = signPayload('radar-oauth', { sub: me.repId, nonce, exp: Date.now() + STATE_TTL_MS });
    if (!state) return res.status(500).json({ error: 'Radar signing key is not configured.' });
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', uri);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', RADAR_SCOPE_STRING);
    auth.searchParams.set('access_type', 'offline');
    auth.searchParams.set('prompt', 'consent');
    auth.searchParams.set('state', state);
    if (me.email) auth.searchParams.set('login_hint', me.email);
    res.setHeader('Set-Cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
    return res.json({ url: auth.toString() });
  }

  const { code, error: oauthError, state } = req.query || {};
  const signed = verifyPayload('radar-oauth', String(state || ''));
  const nonce = cookie(req, NONCE_COOKIE);
  const nonceOk =
    signed?.nonce &&
    nonce &&
    nonce.length === signed.nonce.length &&
    crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(signed.nonce));
  const userId = nonceOk ? String(signed.sub || '') : '';

  if (oauthError) {
    return res.status(400).send(page('Gmail connect cancelled', `<p>${esc(oauthError)}</p><p><a href="/follow-up-radar">Back to Follow-Up Radar</a></p>`));
  }

  if (code) {
    if (!clientId || !clientSecret) {
      return res.status(500).send(page('Missing Google credentials', '<p>Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.</p>'));
    }
    if (!userId) {
      return res.status(400).send(page('Connect link expired', '<p>Start again from Follow-Up Radar or Settings in the same browser. Links expire after 10 minutes.</p><p><a href="/follow-up-radar">Back to Follow-Up Radar</a></p>'));
    }
    res.setHeader('Set-Cookie', nonceCookie('', 0));
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
          <p>${esc(data.error_description || data.error || '')}</p>
        `));
      }
      // The Gmail profile (covered by gmail.readonly) gives the mailbox address; no extra scope.
      let email = '';
      try {
        const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        }).then(r => r.json());
        email = String(profile.emailAddress || '').toLowerCase();
      } catch { /* filled on first sync */ }

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
          email: email || '',
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

  return res.status(400).send(page('Connect Gmail for Follow-Up Radar', '<p>Open Follow-Up Radar or Settings and choose <strong>Connect Gmail</strong>. This connection can read your mail and create drafts; it never sends.</p><p><a href="/follow-up-radar">Go to Follow-Up Radar</a></p>'));
}
