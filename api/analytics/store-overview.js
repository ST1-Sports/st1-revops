/**
 * GET /api/analytics/store-overview?days=30
 *
 * One combined snapshot of the flagship store's performance, pulled from
 * the three systems that actually hold the data — never guessed:
 *   - Shopify Admin API:    orders, revenue, top products, cart/checkout activity
 *   - GA4 Data API:         sessions, traffic sources, add-to-cart events
 *   - Klaviyo API:          signup-form submissions
 *
 * Each section degrades independently — a missing/misconfigured integration
 * returns { configured:false } for just that section instead of failing the
 * whole request, since these are three unrelated systems with three
 * unrelated failure modes.
 */
import { setCors } from '../_lib/cors.js'
import { shopifyRequest, shopifyConfigured } from '../_lib/shopify.js'
import { klaviyoConfigured, findMetricId, metricCount } from '../_lib/klaviyo.js'

let _ga4Token = null, _ga4Expiry = 0
function ga4Creds() {
  return {
    clientId:     process.env.GOOGLE_ANALYTICS_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN,
    propertyId:   process.env.GA4_PROPERTY_ID,
  }
}
async function ga4Token() {
  if (_ga4Token && Date.now() < _ga4Expiry - 60_000) return _ga4Token
  const c = ga4Creds()
  if (!c.clientId || !c.refreshToken) throw new Error('GA4 OAuth credentials not configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
  })
  const d = await r.json()
  if (d.error) throw new Error(`GA4 token error: ${d.error_description}`)
  _ga4Token = d.access_token; _ga4Expiry = Date.now() + d.expires_in * 1000
  return _ga4Token
}
async function ga4Run(propertyId, body) {
  const token = await ga4Token()
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const d = await r.json()
  if (d.error) throw new Error(`GA4 API: ${d.error.message}`)
  return d
}
function ga4Rows(report) {
  if (!report?.rows?.length) return []
  const dims = (report.dimensionHeaders || []).map(h => h.name)
  const mets = (report.metricHeaders   || []).map(h => h.name)
  return report.rows.map(row => {
    const o = {}
    ;(row.dimensionValues || []).forEach((v, i) => { o[dims[i]] = v.value })
    ;(row.metricValues    || []).forEach((v, i) => { o[mets[i]] = Number(v.value) || 0 })
    return o
  })
}

async function loadShopify(days) {
  if (!shopifyConfigured()) return { configured: false }
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const [ordersRes, checkoutsRes] = await Promise.all([
    shopifyRequest(`/orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250`),
    shopifyRequest(`/checkouts.json?created_at_min=${encodeURIComponent(since)}&limit=250`),
  ])
  const orders    = ordersRes.data?.orders || []
  const checkouts = checkoutsRes.data?.checkouts || []
  const revenue = orders.reduce((s, o) => s + (Number(o.total_price) || 0), 0)

  const productCounts = new Map()
  orders.forEach(o => (o.line_items || []).forEach(li => {
    const key = li.title || li.name || 'Unknown item'
    productCounts.set(key, (productCounts.get(key) || 0) + (Number(li.quantity) || 0))
  }))
  const topProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty }))

  const completedTokens = new Set(orders.map(o => o.checkout_token).filter(Boolean))
  const checkoutsAbandoned = checkouts.filter(c => !completedTokens.has(c.token)).length

  return {
    configured: true,
    orders: orders.length,
    revenue,
    avgOrderValue: orders.length ? revenue / orders.length : 0,
    topProducts,
    checkoutsStarted: checkouts.length,
    checkoutsAbandoned,
  }
}

async function loadGa4(startDate, endDate) {
  const { propertyId } = ga4Creds()
  if (!propertyId) return { configured: false }
  const [overview, bySource, addToCart] = await Promise.all([
    ga4Run(propertyId, { dateRanges: [{ startDate, endDate }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'conversions' }] }),
    ga4Run(propertyId, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
    ga4Run(propertyId, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'itemName' }], metrics: [{ name: 'itemsAddedToCart' }], orderBys: [{ metric: { metricName: 'itemsAddedToCart' }, desc: true }], limit: 10 }),
  ])
  const ov = ga4Rows(overview)[0] || {}
  return {
    configured:  true,
    sessions:    ov.sessions || 0,
    activeUsers: ov.activeUsers || 0,
    pageViews:   ov.screenPageViews || 0,
    conversions: ov.conversions || 0,
    topSources:  ga4Rows(bySource).map(r => ({ source: r.sessionSourceMedium, sessions: r.sessions })),
    addToCartProducts: ga4Rows(addToCart).map(r => ({ item: r.itemName, adds: r.itemsAddedToCart })).filter(r => r.item),
  }
}

async function loadKlaviyo(sinceISO, untilISO) {
  if (!klaviyoConfigured()) return { configured: false }
  const metric = await findMetricId(['Filled Out Form', 'Subscribed to List'])
  if (!metric) return { configured: true, formSubmissions: 0, metricUsed: null, note: 'No "Filled Out Form" or "Subscribed to List" metric found in this Klaviyo account yet' }
  const formSubmissions = await metricCount(metric.id, sinceISO, untilISO)
  return { configured: true, formSubmissions, metricUsed: metric.name }
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' })

  const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365)
  const since = new Date(Date.now() - days * 86_400_000)
  const until  = new Date()
  const startDate = since.toISOString().slice(0, 10)
  const endDate   = until.toISOString().slice(0, 10)

  const [shopify, ga4, klaviyo] = await Promise.all([
    loadShopify(days).catch(err => ({ configured: shopifyConfigured(), error: err.message })),
    loadGa4(startDate, endDate).catch(err => ({ configured: !!ga4Creds().propertyId, error: err.message })),
    loadKlaviyo(since.toISOString(), until.toISOString()).catch(err => ({ configured: klaviyoConfigured(), error: err.message })),
  ])

  return res.json({ ok: true, days, shopify, ga4, klaviyo, fetchedAt: new Date().toISOString() })
}
