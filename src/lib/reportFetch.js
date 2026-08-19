/**
 * Shared fetch helper for the reporting screens (Team Stores, Flagship Store).
 *
 * Both screens read from serverless functions that fan out to slow third
 * parties — Stripe, admin.st1sports.com, Shopify, GA4, Klaviyo. When one of
 * those functions runs past its Vercel maxDuration, the platform answers with a
 * 504 whose body is an HTML error page, not JSON. `res.json()` then rejects
 * with "Unexpected token 'A' … is not valid JSON" — and because both screens
 * awaited all of their requests together, that single rejection threw away the
 * reports that HAD loaded. The tab collapsed to a raw parser message with no
 * data on it at all, which is what "can't access the reporting" looked like.
 *
 * fetchReport() never rejects and never throws a parser error at the user. It
 * always resolves to { ok, data, error } so a caller can render every section
 * that came back and put a plain-English note next to the ones that didn't.
 */

// Generous — the point is to fail with a useful message instead of hanging
// forever, not to beat the server's own deadline.
const DEFAULT_TIMEOUT_MS = 70_000

function describeHttp(status, raw) {
  if (status === 504 || status === 502 || status === 408) {
    return `The report timed out on the server (HTTP ${status}). Try a shorter date range.`
  }
  if (status === 401 || status === 403) {
    return `Not authorized (HTTP ${status}) — the stored credentials for this report were rejected.`
  }
  const snippet = (raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  return `Server returned HTTP ${status}${snippet ? ` — ${snippet}` : ''}.`
}

/**
 * Fetch a JSON report endpoint without ever throwing.
 *
 * @param {string} url
 * @param {object} [init] - standard fetch init, plus `timeoutMs`
 * @returns {Promise<{ok: boolean, data: object|null, error: string|null}>}
 */
export async function fetchReport(url, init = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init

  let res
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return {
      ok: false,
      data: null,
      error: timedOut
        ? `No response after ${Math.round(timeoutMs / 1000)}s — the report is taking longer than the server allows. Try a shorter date range.`
        : `Couldn't reach the server (${e?.message || 'network error'}).`,
    }
  }

  // Read as text first: a timed-out or crashed function returns HTML, and
  // res.json() on that is exactly the failure this helper exists to prevent.
  const raw = await res.text().catch(() => '')
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (data === null || typeof data !== 'object') {
    return { ok: false, data: null, error: describeHttp(res.status, raw) }
  }
  if (!res.ok || data.ok === false) {
    return { ok: false, data, error: data.error || describeHttp(res.status, raw) }
  }
  return { ok: true, data, error: null }
}

/** POST { action, ...params } to one of the reporting endpoints. */
export function postReport(url, body, init = {}) {
  return fetchReport(url, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
