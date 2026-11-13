/**
 * Extra shared-secret layer for the highest-risk internal endpoints — mass
 * deletes, direct invoice/vendor-bill creation, the raw Zoho/Shopify proxies.
 * Sign-in (requireSignedIn / requireCaller) is the real gate on those routes;
 * this is a static secret on top, same idea as the Zoho/Twilio webhook secrets.
 *
 * Fails OPEN when INTERNAL_SECRET isn't configured, so a missing env var does
 * not lock signed-in reps out. To turn the extra gate on: set INTERNAL_SECRET
 * (server) and VITE_INTERNAL_SECRET (same value, baked into the frontend build)
 * in Vercel, then redeploy.
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
