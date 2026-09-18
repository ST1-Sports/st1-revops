/**
 * Minimal shared-secret gate for the highest-risk internal endpoints — mass
 * deletes, direct invoice/vendor-bill creation, the raw Zoho/Shopify proxies,
 * and ad-spend mutations. This app has no real per-user auth yet; this is not
 * that — it's a static shared secret, same trust model as the existing
 * Zoho/Twilio webhook secrets, meant to stop a stray/scanning request or an
 * unrelated site from blindly hitting these routes, not a determined
 * attacker who has the deployed JS bundle.
 *
 * Fails OPEN when INTERNAL_SECRET isn't configured, so shipping this code
 * doesn't break the live app before the env var exists. To actually turn the
 * gate on: set INTERNAL_SECRET (server) and VITE_INTERNAL_SECRET (same
 * value, baked into the frontend build at build time) in Vercel, then
 * redeploy.
 */
import { timingSafeEqual } from 'crypto'

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Returns true and lets the caller proceed; on failure, writes the 401 itself and returns false. */
export function requireInternalSecret(req, res) {
  const configured = process.env.INTERNAL_SECRET
  if (!configured) return true // gate not turned on yet — see file header
  const provided = req.headers['x-internal-secret'] || req.query?.secret
  if (provided && safeEqual(provided, configured)) return true
  res.status(401).json({ error: 'Missing or invalid internal secret' })
  return false
}
