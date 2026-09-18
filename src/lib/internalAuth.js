/**
 * Client-side half of api/_lib/internalAuth.js's shared-secret gate. Spread
 * this into the headers of any fetch to a route that checks
 * requireInternalSecret() server-side (the raw Zoho/Shopify proxies, ad-spend
 * mutations, direct invoice/vendor-bill creation, the deals mass-rebuild).
 * A no-op object when VITE_INTERNAL_SECRET isn't set at build time, matching
 * the server's fail-open default until both are configured in Vercel.
 */
export function internalAuthHeaders() {
  const secret = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_INTERNAL_SECRET || '') : '';
  return secret ? { 'x-internal-secret': secret } : {};
}
