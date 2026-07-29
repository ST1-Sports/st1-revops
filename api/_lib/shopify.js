/**
 * Shared Shopify Admin API helper.
 *
 * Required env vars:
 *   SHOPIFY_STORE_DOMAIN     — e.g. "st1sports.myshopify.com" (the *.myshopify.com admin domain)
 *   SHOPIFY_ACCESS_TOKEN     — Admin API access token from a custom app
 *                              (Shopify admin → Settings → Apps and sales channels →
 *                              Develop apps → create an app → Admin API access token)
 *   SHOPIFY_STOREFRONT_DOMAIN (optional) — public storefront domain (e.g. "st1sports.com"),
 *                              used only to build product permalinks. Falls back to the
 *                              myshopify.com domain if unset.
 *
 * REST Admin API (not GraphQL) — kept consistent with this repo's existing Zoho/WooCommerce
 * proxy pattern (simple endpoint + method + body passthrough) rather than introducing a
 * second query paradigm for one integration.
 */

export const SHOPIFY_API_VERSION = '2024-10';

export function shopifyConfigured() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN);
}

export function shopifyMissingEnvVars() {
  return ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'].filter(k => !process.env[k]);
}

export function shopifyPublicDomain() {
  return process.env.SHOPIFY_STOREFRONT_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || '';
}

/**
 * Call the Shopify Admin REST API.
 * @param {string} endpoint - e.g. "/products.json?limit=10" (leading slash, no /admin/api/version prefix)
 * @param {string} [method]
 * @param {object} [body]
 * @returns {Promise<{ok: boolean, status: number, data: any, headers: Headers}>}
 */
export async function shopifyRequest(endpoint, method = 'GET', body = null) {
  if (!shopifyConfigured()) {
    const missing = shopifyMissingEnvVars();
    throw new Error(`Shopify credentials not configured. Missing: ${missing.join(', ')}`);
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

  const r = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data;
  try {
    data = await r.json();
  } catch {
    const text = await r.text().catch(() => '');
    data = { _rawError: `HTTP ${r.status}: ${text.slice(0, 300)}` };
  }

  return { ok: r.ok, status: r.status, data, headers: r.headers };
}
