/**
 * Client half of api/_lib/session.js. The email-code login returns a signed session token;
 * routes with per-rep data (Follow-Up Radar) require it as a Bearer header. PIN logins and
 * the no-admin bypass have no token, so Radar asks those users to sign in with their email code.
 */
const KEY = 'st1_revops_session';

export function saveSessionToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: Radar will ask to sign in again */
  }
}

export function sessionHeaders() {
  try {
    const token = localStorage.getItem(KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** fetch() for /api/radar/* with the session header attached. */
export function radarFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), ...sessionHeaders() } });
}
