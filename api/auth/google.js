/**
 * GET /api/auth/google — Sign in with Google, which also connects the rep's Gmail.
 *
 * Step 1 (no `code`): redirects to Google with a signed `state` and sets a matching HttpOnly
 *   nonce cookie, so the callback only completes in the browser that started it.
 * Step 2 (Google redirects back with `code`): verifies state + nonce, exchanges the code with
 *   the existing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET app, accepts only verified @st1sports.com
 *   accounts, finds or creates the rep, stores the Gmail refresh token encrypted
 *   (InboxConnection), retires the rep's old unencrypted Gmail token, and returns to the app
 *   with a signed session in the URL fragment (never sent to a server or logged).
 *
 * The same callback also finishes "Connect BDR mailbox" (Settings → My BDR): that flow is started
 * by POST /api/bdr {action:"connect"}, carries purpose "bdr" in the signed state, and stores the
 * BDR mailbox's token instead of signing anyone in.
 *
 * Redirect URI to register on the Google OAuth client (consent screen: Internal):
 *   https://revops.st1sports.com/api/auth/google
 */
import crypto from 'crypto';
import { prisma } from '../_lib/prisma.js';
import { encryptSecret } from '../_lib/radar/crypto.js';
import { issueSessionToken, signPayload, verifyPayload } from '../_lib/session.js';
import { upsertRepForEmail } from '../_lib/repAccount.js';
import { GOOGLE_LOGIN_SCOPES, allowedGoogleEmail, grantedGmail, loginRedirect } from '../_lib/googleLogin.js';
import { BDR_SCOPES, BDR_GMAIL_SCOPES, loadBdrForRep, normalizeEmail, saveBdrConnection } from '../_lib/bdr.js';

const NONCE_COOKIE = 'st1_google_nonce';
const STATE_TTL_MS = 10 * 60 * 1000;

function redirectUri(req) {
  if (process.env.GOOGLE_LOGIN_REDIRECT_URI) return process.env.GOOGLE_LOGIN_REDIRECT_URI;
  const host = req.headers.host || '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}/api/auth/google`;
}

function cookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function nonceCookie(value, maxAgeSeconds) {
  return `${NONCE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function go(res, location) {
  res.setHeader('Location', location);
  return res.status(302).end();
}

function startUrl(req, res, { consent }) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const state = signPayload('google-login', { nonce, consent: !!consent, exp: Date.now() + STATE_TTL_MS });
  if (!state) return null;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', process.env.GMAIL_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectUri(req));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', GOOGLE_LOGIN_SCOPES.join(' '));
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('include_granted_scopes', 'true');
  auth.searchParams.set('hd', 'st1sports.com');
  // Consent is forced only when Google must re-issue a refresh token (first connect, or after
  // a disconnect); everyday sign-in is just "choose account".
  auth.searchParams.set('prompt', consent ? 'consent select_account' : 'select_account');
  auth.searchParams.set('state', state);
  res.setHeader('Set-Cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
  return auth.toString();
}

/**
 * Google URL for connecting a rep's BDR mailbox. Called from a signed-in request (api/bdr.js);
 * sets the same nonce cookie as sign-in so the callback only completes in this browser.
 */
export function bdrConnectUrl(req, res, { repId, email, by }) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const state = signPayload('google-login', {
    nonce, purpose: 'bdr', repId, email: normalizeEmail(email), by: by || repId, exp: Date.now() + STATE_TTL_MS,
  });
  if (!state) return null;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', process.env.GMAIL_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectUri(req));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', BDR_SCOPES.join(' '));
  auth.searchParams.set('access_type', 'offline');
  // Always consent so Google issues a fresh refresh token for the BDR mailbox.
  auth.searchParams.set('prompt', 'consent select_account');
  auth.searchParams.set('login_hint', normalizeEmail(email));
  auth.searchParams.set('state', state);
  res.setHeader('Set-Cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
  return auth.toString();
}

const bdrDone = (params) => `/settings?${new URLSearchParams(params).toString()}`;

async function finishBdrConnect(req, res, signed, code) {
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        code: String(code),
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return go(res, bdrDone({ bdr_error: 'google_failed' }));
    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    }).then(r => r.json());
    const email = normalizeEmail(info?.email);
    const verified = !(info?.email_verified === false || info?.email_verified === 'false');

    // The BDR must still be the one this rep set up, and Google must have signed in as exactly it.
    const bdr = await loadBdrForRep(signed.repId);
    if (!bdr || bdr.email !== normalizeEmail(signed.email)) return go(res, bdrDone({ bdr_error: 'changed' }));
    if (!verified || email !== bdr.email) {
      return go(res, bdrDone({ bdr_error: 'wrong_account', got: email || 'unknown', want: bdr.email }));
    }
    const granted = new Set(String(tokens.scope || '').split(/\s+/));
    if (!BDR_GMAIL_SCOPES.every(sc => granted.has(sc))) return go(res, bdrDone({ bdr_error: 'missing_permissions' }));
    if (!tokens.refresh_token) return go(res, bdrDone({ bdr_error: 'no_refresh_token' }));

    await saveBdrConnection(bdr.gmailKey, {
      refreshToken: tokens.refresh_token, email, scopes: tokens.scope, connectedBy: signed.by,
    });
    return go(res, bdrDone({ bdr: 'connected' }));
  } catch (err) {
    console.error('[auth/google bdr]', err.message);
    return go(res, bdrDone({ bdr_error: 'google_failed' }));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return go(res, loginRedirect({ login_error: 'google_not_configured' }));

  const { code, state, error: oauthError } = req.query || {};
  if (!code) {
    if (oauthError) {
      const wasBdr = verifyPayload('google-login', String(state || ''))?.purpose === 'bdr';
      return go(res, wasBdr ? bdrDone({ bdr_error: 'google_cancelled' }) : loginRedirect({ login_error: 'google_cancelled' }));
    }
    const url = startUrl(req, res, { consent: req.query?.consent === '1' });
    return url ? go(res, url) : go(res, loginRedirect({ login_error: 'session_key_missing' }));
  }

  // Callback: the state must be ours, unexpired, and started in this browser.
  const signed = verifyPayload('google-login', String(state || ''));
  const nonce = cookie(req, NONCE_COOKIE);
  const nonceOk =
    signed?.nonce &&
    nonce &&
    nonce.length === signed.nonce.length &&
    crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(signed.nonce));
  res.setHeader('Set-Cookie', nonceCookie('', 0));
  if (!nonceOk) {
    return go(res, signed?.purpose === 'bdr' ? bdrDone({ bdr_error: 'expired' }) : loginRedirect({ login_error: 'expired' }));
  }
  if (signed.purpose === 'bdr') return finishBdrConnect(req, res, signed, code);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return go(res, loginRedirect({ login_error: 'google_failed' }));

    const userinfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    }).then(r => r.json());
    const email = allowedGoogleEmail(userinfo);
    if (!email) return go(res, loginRedirect({ login_error: 'not_st1' }));

    const gmailGranted = grantedGmail(tokens.scope);
    const { rep } = await upsertRepForEmail(email, { name: userinfo.name, gmailConnected: gmailGranted });

    let gmail = gmailGranted ? 'not_connected' : 'missing_permissions';
    if (gmailGranted) {
      const existing = await prisma.inboxConnection.findUnique({
        where: { userId_provider: { userId: rep.id, provider: 'gmail' } },
      });
      if (tokens.refresh_token) {
        const encrypted = encryptSecret(tokens.refresh_token);
        const fresh = !existing || existing.email !== email || existing.status === 'disconnected';
        await prisma.inboxConnection.upsert({
          where: { userId_provider: { userId: rep.id, provider: 'gmail' } },
          update: {
            email,
            encryptedRefreshToken: encrypted,
            scopes: GOOGLE_LOGIN_SCOPES.join(' '),
            status: 'active',
            lastError: null,
            ...(fresh ? { historyId: null, lastSyncAt: null, syncCursor: null } : {}),
          },
          create: {
            userId: rep.id,
            provider: 'gmail',
            email,
            encryptedRefreshToken: encrypted,
            scopes: GOOGLE_LOGIN_SCOPES.join(' '),
            status: 'active',
            backfillDays: 120,
          },
        });
        gmail = 'connected';
      } else if (existing?.encryptedRefreshToken && existing.status !== 'disconnected') {
        gmail = 'connected';
      } else if (!signed.consent) {
        // Google only issues a refresh token with consent; ask once, then come back.
        return go(res, '/api/auth/google?consent=1');
      }
      // The encrypted connection replaces the old unencrypted per-rep token.
      if (gmail === 'connected' && rep.gmailEnvKey) {
        const legacyKey = `gmail_token_${String(rep.gmailEnvKey).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        await prisma.setting.delete({ where: { key: legacyKey } }).catch(() => {});
      }
    }

    const session = issueSessionToken(rep.id);
    if (!session) return go(res, loginRedirect({ login_error: 'session_key_missing' }));
    return go(res, `/?gmail=${gmail}#session=${encodeURIComponent(session)}`);
  } catch (err) {
    console.error('[auth/google]', err.message);
    return go(res, loginRedirect({ login_error: 'google_failed' }));
  }
}
