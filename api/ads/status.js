import { setCors } from '../_lib/cors.js';

// Health-checks each platform by making a minimal API call.
// Returns { meta: 'connected'|'error', google: ..., ... } with error messages.

export const config = { api: { bodyParser: false } };

async function checkMeta() {
  const token = process.env.META_ACCESS_TOKEN;
  const acctId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !acctId) return { status: 'missing_key' };
  const acct = acctId.startsWith('act_') ? acctId : `act_${acctId}`;
  const r = await fetch(`https://graph.facebook.com/v19.0/${acct}?fields=id,name&access_token=${token}`);
  const d = await r.json();
  if (d.error) return { status: 'error', message: d.error.message };
  return { status: 'connected', name: d.name };
}

async function checkGoogle() {
  const devToken    = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId  = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  const clientId    = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret= process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken= process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!devToken || !customerId || !clientId || !clientSecret || !refreshToken) return { status: 'missing_key' };

  // Get access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) return { status: 'error', message: tokenData.error_description };

  const r = await fetch(`https://googleads.googleapis.com/v16/customers/${customerId}`, {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'developer-token': devToken },
  });
  const d = await r.json();
  if (d.error) return { status: 'error', message: d.error.message || JSON.stringify(d.error) };
  return { status: 'connected', name: d.descriptiveName || customerId };
}

async function checkLinkedIn() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return { status: 'missing_key' };
  const r = await fetch('https://api.linkedin.com/v2/me', { headers: { 'Authorization': `Bearer ${token}` } });
  const d = await r.json();
  if (d.status === 401 || d.serviceErrorCode) return { status: 'error', message: d.message || 'Auth failed' };
  return { status: 'connected', name: `${d.localizedFirstName || ''} ${d.localizedLastName || ''}`.trim() };
}

async function checkTikTok() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const advId = process.env.TIKTOK_ADVERTISER_ID;
  if (!token || !advId) return { status: 'missing_key' };
  const r = await fetch(`https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=["${advId}"]`, {
    headers: { 'Access-Token': token },
  });
  const d = await r.json();
  if (d.code !== 0) return { status: 'error', message: d.message };
  return { status: 'connected', name: d.data?.list?.[0]?.name || advId };
}

async function checkMicrosoft() {
  const clientId    = process.env.MICROSOFT_ADS_CLIENT_ID;
  const clientSecret= process.env.MICROSOFT_ADS_CLIENT_SECRET;
  const refreshToken= process.env.MICROSOFT_ADS_REFRESH_TOKEN;
  const devToken    = process.env.MICROSOFT_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !refreshToken || !devToken) return { status: 'missing_key' };

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: 'https://ads.microsoft.com/msads.manage offline_access' }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) return { status: 'error', message: tokenData.error_description };
  return { status: 'connected' };
}

async function checkGA4() {
  const propertyId  = process.env.GA4_PROPERTY_ID;
  const clientId    = process.env.GOOGLE_ANALYTICS_CLIENT_ID    || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret= process.env.GOOGLE_ANALYTICS_CLIENT_SECRET|| process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken= process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN|| process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!propertyId || !clientId || !clientSecret || !refreshToken) return { status: 'missing_key' };

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) return { status: 'error', message: tokenData.error_description };

  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metrics: [{ name: 'activeUsers' }], limit: 1 }),
  });
  const d = await r.json();
  if (d.error) return { status: 'error', message: d.error.message };
  return { status: 'connected', name: `Property ${propertyId}` };
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const checks = await Promise.allSettled([
    checkMeta().catch(e      => ({ status: 'error', message: e.message })),
    checkGoogle().catch(e    => ({ status: 'error', message: e.message })),
    checkLinkedIn().catch(e  => ({ status: 'error', message: e.message })),
    checkTikTok().catch(e    => ({ status: 'error', message: e.message })),
    checkMicrosoft().catch(e => ({ status: 'error', message: e.message })),
    checkGA4().catch(e       => ({ status: 'error', message: e.message })),
  ]);

  const [meta, google, linkedin, tiktok, microsoft, ga4] = checks.map(r =>
    r.status === 'fulfilled' ? r.value : { status: 'error', message: r.reason?.message }
  );

  return res.status(200).json({ meta, google, linkedin, tiktok, microsoft, youtube: google, ga4 });
}
