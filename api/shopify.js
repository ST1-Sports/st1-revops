/**
 * Vercel Serverless Function: /api/shopify
 *
 * Server-side proxy for the Shopify Admin API.
 * Credentials live in Vercel environment variables — never in the browser
 * (unlike the previous WooCommerce integration, which had the browser hold
 * the consumer key/secret directly).
 *
 * Required env vars — see api/_lib/shopify.js for details:
 *   SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, SHOPIFY_STOREFRONT_DOMAIN (optional)
 *
 * Request body: { endpoint: string, method?: string, body?: object }
 *   endpoint is a REST Admin API path, e.g. "/shop.json", "/products.json?limit=10"
 * Response: the raw Shopify API JSON response
 */

import { shopifyRequest, shopifyConfigured, shopifyMissingEnvVars } from './_lib/shopify.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { endpoint, method = 'GET', body } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing required field: endpoint' });

  if (!shopifyConfigured()) {
    return res.status(500).json({
      error: 'Shopify credentials not configured',
      missing: shopifyMissingEnvVars(),
    });
  }

  try {
    const { data, status } = await shopifyRequest(endpoint, method, body);
    console.log('[shopify]', method, endpoint, '→', status);
    // Always 200 so the client receives the body — the client checks for error fields
    return res.status(200).json({ ...data, _http_status: status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
