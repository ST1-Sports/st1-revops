/**
 * Signed session tokens for routes that expose per-rep data (Follow-Up Radar).
 *
 * The rest of the app still identifies the user client-side, and /api/state exposes every rep
 * id, so a rep id or an `isAdmin` flag from the request proves nothing. Login
 * (api/login-verify-code.js) issues an HMAC-signed token for the verified rep; Radar routes
 * take the rep from that token and read admin status from app_state on the server.
 *
 * Signing key: SESSION_SECRET, else the Radar token key (RADAR_TOKEN_KEY / TOKEN_ENCRYPTION_KEY),
 * with a purpose-specific subkey so the encryption key is never used directly for signing.
 * Fails closed: without a key no token is issued and protected routes answer 401.
 */
import crypto from 'crypto';
import { prisma } from './prisma.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingKey(purpose) {
  const secret = process.env.SESSION_SECRET || process.env.RADAR_TOKEN_KEY || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) return null;
  return crypto.createHmac('sha256', secret).update(`st1-revops:${purpose}:v1`).digest();
}

function mac(key, body) {
  return crypto.createHmac('sha256', key).update(body).digest('base64url');
}

export function signPayload(purpose, payload) {
  const key = signingKey(purpose);
  if (!key) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

export function verifyPayload(purpose, token, now = Date.now()) {
  const key = signingKey(purpose);
  if (!key || typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(key, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) return null;
  return payload;
}

/** Issued by login after the emailed code is verified. Null when no signing key is configured. */
export function issueSessionToken(repId, now = Date.now()) {
  if (!repId) return null;
  return signPayload('session', { sub: String(repId), exp: now + SESSION_TTL_MS });
}

function bearer(req) {
  const header = String(req.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Resolves the signed-in rep, or writes a 401 and returns null. Admin status comes from the
 * stored appUsers list, never from the request.
 */
export async function requireRep(req, res) {
  const session = verifyPayload('session', bearer(req));
  if (!session?.sub) {
    res.status(401).json({ error: 'Sign in again with your email code to use Follow-Up Radar.' });
    return null;
  }
  const setting = await prisma.setting.findUnique({ where: { key: 'app_state' } }).catch(() => null);
  const state = setting?.value || {};
  const appUser = (Array.isArray(state.appUsers) ? state.appUsers : []).find(u => u?.repId === session.sub);
  if (!appUser) {
    res.status(401).json({ error: 'This account is no longer active. Sign in again.' });
    return null;
  }
  const rep = (Array.isArray(state.reps) ? state.reps : []).find(r => r?.id === session.sub);
  return { repId: session.sub, isAdmin: !!appUser.isAdmin, email: String(rep?.email || '').toLowerCase() };
}
