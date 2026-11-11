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

/** Fired when /api/state rejects the session: the app signs the user out and asks them to sign in. */
export const SIGNED_OUT_EVENT = 'st1:signed-out';

function sameOriginApiPath(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/') ? u.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Attaches the signed session to every same-origin /api/ request (the app has hundreds of
 * fetch calls; the server now requires a session for workspace data and Gmail). A request
 * that already sets Authorization is left alone; other origins are never touched.
 */
export function installSessionFetch() {
  if (typeof window === 'undefined' || window.__st1SessionFetch) return;
  window.__st1SessionFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
    const path = sameOriginApiPath(url);
    if (!path) return original(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) {
      const session = sessionHeaders().Authorization;
      if (session) headers.set('Authorization', session);
    }
    const response = await original(input, { ...init, headers });
    if (response.status === 401 && path === '/api/state') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    return response;
  };
}
