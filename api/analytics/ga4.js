import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _cachedToken = null;
let _tokenExpiry = 0;

function creds() {
  return {
    clientId:     process.env.GOOGLE_ANALYTICS_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN,
    propertyId:   process.env.GA4_PROPERTY_ID,
  };
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;
  const c   = creds();
  if (!c.clientId || !c.refreshToken) throw new Error('GA4 OAuth credentials not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`GA4 token error: ${d.error_description}`);
  _cachedToken = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _cachedToken;
}

async function ga4Report(propertyId, body) {
  const token = await getAccessToken();
  const res   = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const d = await res.json();
  if (d.error) throw new Error(`GA4 API: ${d.error.message}`);
  return d;
}

function parseRows(report) {
  if (!report?.rows?.length) return [];
  const dimHeaders = (report.dimensionHeaders || []).map(h => h.name);
  const metHeaders = (report.metricHeaders   || []).map(h => h.name);
  return report.rows.map(row => {
    const obj = {}
    ;(row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value })
    ;(row.metricValues    || []).forEach((v, i) => { obj[metHeaders[i]] = parseInt(v.value) || 0 })
    return obj
  });
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { propertyId: qPropId } = req.query;
  const { propertyId } = creds();
  const pid = qPropId || propertyId;
  if (!pid) return res.status(400).json({ error: 'GA4_PROPERTY_ID not configured' });

  try {
    // Run 4 realtime reports in parallel
    const [overview, byPage, bySource, byDevice, byCountry] = await Promise.all([
      // Active users + page views
      ga4Report(pid, {
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'eventCount' },
        ],
      }),
      // Top pages
      ga4Report(pid, {
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics:    [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        limit:      10,
        orderBys:   [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      // Traffic sources
      ga4Report(pid, {
        dimensions: [{ name: 'firstUserMedium' }],
        metrics:    [{ name: 'activeUsers' }],
        limit:      8,
        orderBys:   [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      // Device breakdown
      ga4Report(pid, {
        dimensions: [{ name: 'deviceCategory' }],
        metrics:    [{ name: 'activeUsers' }],
        limit:      5,
      }),
      // Top countries
      ga4Report(pid, {
        dimensions: [{ name: 'country' }],
        metrics:    [{ name: 'activeUsers' }],
        limit:      5,
        orderBys:   [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
    ]);

    return res.status(200).json({
      activeUsers:  overview.rows?.[0]?.metricValues?.[0]?.value || 0,
      pageViews:    overview.rows?.[0]?.metricValues?.[1]?.value || 0,
      eventCount:   overview.rows?.[0]?.metricValues?.[2]?.value || 0,
      topPages:     parseRows(byPage),
      bySources:    parseRows(bySource),
      byDevice:     parseRows(byDevice),
      byCountry:    parseRows(byCountry),
      fetchedAt:    new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
