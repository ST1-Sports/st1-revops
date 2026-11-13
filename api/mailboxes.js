/**
 * /api/mailboxes — one live status check of every mailbox the signed-in rep relies on, for
 * Settings → Email Status. Signed-in reps only.
 *
 * GET → {
 *   mine:    your own @st1sports.com Gmail (connected when you sign in with Google)
 *   bdr:     your BDR's mailbox (Settings → My BDR), or null when you have no BDR yet
 *   company: the company sender (login codes, reply alerts, campaigns with no rep)
 * }  each { connected, email, error?, ... }
 *
 * POST { action:"connect-company" }    → { url } to Google (admins)
 * POST { action:"disconnect-company" } → forget the stored company mailbox (admins)
 */
import { setCors } from './_lib/cors.js';
import { requireRep } from './_lib/session.js';
import { getGmailAccessToken } from './_lib/gmailAuth.js';
import { loadBdrForRep, readBdrConnection } from './_lib/bdr.js';
import { deleteCompanyConnection, readCompanyConnection } from './_lib/companyMailbox.js';
import { companyConnectUrl } from './auth/google.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

/** Turns Google's raw refresh errors into something a rep can act on. Pure; exported for tests. */
export function friendlyGmailError(message) {
  const m = String(message || '');
  if (/unauthorized_client/.test(m)) return 'Connected under the old Google app. Reconnect it.';
  if (/invalid_grant/.test(m)) return 'Google revoked or expired this connection. Reconnect it.';
  if (/not connected|not configured/i.test(m)) return 'Not connected.';
  return m.replace(/^Gmail token refresh failed:\s*/, '').slice(0, 200) || 'Not working.';
}

async function liveCheck(key) {
  try {
    const token = await getGmailAccessToken(key);
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const p = await r.json();
    if (!r.ok) return { connected: false, error: friendlyGmailError(p.error?.message || `Gmail ${r.status}`) };
    return { connected: true, email: String(p.emailAddress || '').toLowerCase() };
  } catch (e) {
    return { connected: false, error: friendlyGmailError(e.message) };
  }
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const me = await requireRep(req, res);
  if (!me) return;

  if (req.method === 'POST') {
    if (!me.isAdmin) return res.status(403).json({ error: 'Only an admin can change the company mailbox.' });
    const { action } = req.body || {};
    if (action === 'connect-company') {
      if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
        return res.status(500).json({ error: 'Google is not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET).' });
      }
      const url = companyConnectUrl(req, res, { by: me.repId });
      if (!url) return res.status(500).json({ error: 'Session signing key missing on the server.' });
      return res.json({ url });
    }
    if (action === 'disconnect-company') {
      await deleteCompanyConnection();
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET or POST only' });

  try {
    const [bdr, companyConn] = await Promise.all([loadBdrForRep(me.repId), readCompanyConnection()]);

    const minePromise = me.gmailEnvKey
      ? liveCheck(me.gmailEnvKey).then(r => ({ ...r, expected: me.email }))
      : Promise.resolve({ connected: false, expected: me.email, error: 'Sign in with Google to connect your Gmail.' });

    const bdrPromise = bdr
      ? readBdrConnection(bdr.gmailKey).then(conn => (conn?.encryptedRefreshToken
        ? liveCheck(bdr.gmailKey)
        : { connected: false, error: 'Mailbox not connected yet.' }))
        .then(r => ({
          ...r, name: bdr.name, expected: bdr.email,
          ...(r.connected && r.email !== bdr.email ? { connected: false, error: `Connected to ${r.email}, not ${bdr.email}. Reconnect.` } : {}),
        }))
      : Promise.resolve(null);

    const companySource = companyConn?.encryptedRefreshToken ? 'settings' : (process.env.GMAIL_REFRESH_TOKEN ? 'vercel' : null);
    const companyPromise = companySource
      ? liveCheck('').then(r => ({ ...r, source: companySource, connectedAt: companyConn?.connectedAt || null }))
      : Promise.resolve({ connected: false, source: null, error: 'Not connected.' });

    const [mine, bdrStatus, company] = await Promise.all([minePromise, bdrPromise, companyPromise]);
    return res.json({ mine, bdr: bdrStatus, company, isAdmin: !!me.isAdmin, sendingEnabled: process.env.BRAD_SENDING_ENABLED === 'true' });
  } catch (e) {
    console.error('[mailboxes]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
