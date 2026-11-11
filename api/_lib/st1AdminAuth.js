/**
 * Auth against the ST1 admin app (api.st1sports.com) — where team store
 * orders actually live, not Shopify and not this database.
 *
 * ⚠️ UNVERIFIED SHAPE — /admin/signin's request/response fields below are a
 * reasonable guess, not a confirmed contract: POST /admin/signin returns 400
 * to an empty body (so it takes credentials) but its exact field names have
 * not been observed against a live response. Do not trust this file until
 * someone has actually signed in with real credentials and confirmed (or
 * corrected) the `body` sent in signIn() and the token field read out of
 * `data` below. Everything else in this module (the session wrapper, the
 * re-auth-on-403 retry) is shape-independent and does not need re-checking.
 *
 * Access tokens are short-lived. GET /admin/refresh_access exists and the
 * admin SPA calls it, but calling it with either the access or refresh token
 * as a Bearer returns 401 — its real mechanism is unverified too, so this
 * module does not use it at all. Every session just re-authenticates fully
 * when its token is rejected, which is simpler and safe even if a proper
 * refresh flow turns out to exist and would have been cheaper.
 *
 * A 403 from GET /admin/team_store_order or GET /admin/decoration_cost
 * specifically means "token aged out", not "no permission" (GET
 * /admin/supplier has been observed to keep answering with a stale token
 * that those two endpoints already reject) — createSession()'s request()
 * re-authenticates and retries once on any 403, since there is no reliable
 * way from here to tell "expired" apart from a real permission error.
 */

const API_BASE = process.env.ST1_ADMIN_API_BASE || 'https://api.st1sports.com';

async function signIn() {
  const email = process.env.ST1_ADMIN_SERVICE_EMAIL;
  const password = process.env.ST1_ADMIN_SERVICE_PASSWORD;
  if (!email || !password) {
    throw new Error('ST1_ADMIN_SERVICE_EMAIL / ST1_ADMIN_SERVICE_PASSWORD are not set — create a dedicated service-account user in the ST1 admin app and set these in Vercel env vars.');
  }

  const res = await fetch(`${API_BASE}/admin/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // UNVERIFIED — confirm these field names against a real signin call.
    body: JSON.stringify({ email, password }),
  });

  let data;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    throw new Error(`ST1 admin signin failed (${res.status}): ${JSON.stringify(data)}`);
  }

  // UNVERIFIED — the real response almost certainly uses one specific key;
  // this checks several plausible ones so a first real signin has the best
  // chance of working, but whichever one actually matches should replace
  // this list once confirmed rather than being left as a guessing game.
  const token = data?.accessToken || data?.access_token || data?.token || data?.jwt || null;
  if (!token) {
    throw new Error(`ST1 admin signin succeeded but no recognizable token field was found in the response: ${JSON.stringify(data)} — update st1AdminAuth.js's signIn() to read the real field name.`);
  }

  return { token, raw: data };
}

/**
 * One admin-API session for a single sync run. Signs in once and holds the
 * token in memory only for the lifetime of this object — never cached at
 * module scope across invocations, since the token is short-lived and a
 * warm serverless instance reusing a stale cached token would just
 * reintroduce the 403 problem this is meant to avoid. Call createSession()
 * fresh at the start of every sync run.
 */
export async function createSession() {
  let current = await signIn();

  async function request(path, opts = {}) {
    const doFetch = () => fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${current.token}` },
    });

    let res = await doFetch();
    if (res.status === 403) {
      current = await signIn();
      res = await doFetch();
    }
    return res;
  }

  return { request };
}
