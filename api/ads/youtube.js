import { setCors } from '../_lib/cors.js';

// YouTube Ads uses the Google Ads API filtered to VIDEO channel type.
// Same OAuth credentials as google.js — reuses GOOGLE_ADS_* env vars.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_BASE  = 'https://googleads.googleapis.com/v16';

let _cachedToken = null;
let _tokenExpiry = 0;

function creds() {
  const c = {
    clientId:     process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    devToken:     process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    customerId:   (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''),
  };
  if (!c.devToken || !c.customerId) throw new Error('Google Ads env vars not configured');
  return c;
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;
  const c   = creds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`Google token error: ${d.error_description}`);
  _cachedToken = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _cachedToken;
}

async function gaqlSearch(query) {
  const c     = creds();
  const token = await getAccessToken();
  const res   = await fetch(`${ADS_BASE}/customers/${c.customerId}/googleAds:search`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'developer-token': c.devToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`YouTube/Google Ads: ${JSON.stringify(d.error)}`);
  return d.results || [];
}

const DATE_GAQL = { yesterday: 'YESTERDAY', last_7_days: 'LAST_7_DAYS', last_30_days: 'LAST_30_DAYS', last_90_days: 'LAST_90_DAYS' };

async function getInsights(level = 'campaign', dateRange = 'last_30_days') {
  const during   = DATE_GAQL[dateRange] || 'LAST_30_DAYS';
  const resource = level === 'ad' ? 'ad_group_ad' : level === 'adset' ? 'ad_group' : 'campaign';

  const rows = await gaqlSearch(`
    SELECT
      ${resource}.id, ${resource}.name, ${resource}.status,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.video_views, metrics.video_view_rate,
      metrics.average_cpv, metrics.view_through_conversions,
      metrics.conversions, metrics.conversions_value
    FROM ${resource}
    WHERE segments.date DURING ${during}
      AND campaign.advertising_channel_type = 'VIDEO'
      AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `);

  return rows.map(r => {
    const obj   = r[resource] || {};
    const m     = r.metrics   || {};
    const spend = parseInt(m.cost_micros || 0) / 1_000_000;
    const rev   = parseFloat(m.conversions_value || 0);
    return {
      id:          String(obj.id || ''),
      name:        obj.name || '',
      status:      obj.status || '',
      spend:       +spend.toFixed(2),
      revenue:     +rev.toFixed(2),
      roas:        spend > 0 ? +(rev / spend).toFixed(2) : 0,
      impressions: parseInt(m.impressions  || 0),
      clicks:      parseInt(m.clicks       || 0),
      views:       parseInt(m.video_views  || 0),
      viewRate:    +(parseFloat(m.video_view_rate || 0) * 100).toFixed(2),
      cpv:         +(parseInt(m.average_cpv || 0) / 1_000_000).toFixed(4),
      ctr:         0,
      cpc:         +(parseInt(m.average_cpv || 0) / 1_000_000).toFixed(2),
      cpm:         0,
      conversions: parseFloat(m.conversions || 0),
      platform:    'youtube',
    };
  });
}

async function getCampaigns() {
  const rows = await gaqlSearch(`
    SELECT campaign.id, campaign.name, campaign.status,
           campaign_budget.amount_micros, campaign.start_date, campaign.end_date
    FROM campaign
    WHERE campaign.advertising_channel_type = 'VIDEO'
      AND campaign.status != 'REMOVED'
    ORDER BY campaign.name LIMIT 200
  `);
  return rows.map(r => ({
    id:          String(r.campaign?.id || ''),
    name:        r.campaign?.name || '',
    status:      r.campaign?.status || '',
    objective:   'VIDEO',
    dailyBudget: r.campaign_budget?.amount_micros ? parseInt(r.campaign_budget.amount_micros) / 1_000_000 : null,
    startTime:   r.campaign?.start_date,
    stopTime:    r.campaign?.end_date,
    platform:    'youtube',
  }));
}

async function mutateCampaign(operations) {
  const c     = creds();
  const token = await getAccessToken();
  const res   = await fetch(`${ADS_BASE}/customers/${c.customerId}/campaigns:mutate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'developer-token': c.devToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`YouTube mutate: ${JSON.stringify(d.error)}`);
  return d;
}

async function pauseCampaign(id)  {
  await mutateCampaign([{ update: { resourceName: `customers/${creds().customerId}/campaigns/${id}`, status: 'PAUSED' },  updateMask: 'status' }]);
  return { success: true };
}
async function resumeCampaign(id) {
  await mutateCampaign([{ update: { resourceName: `customers/${creds().customerId}/campaigns/${id}`, status: 'ENABLED' }, updateMask: 'status' }]);
  return { success: true };
}

async function createCampaign(campaign) {
  const c     = creds();
  const token = await getAccessToken();
  const budgetRes = await fetch(`${ADS_BASE}/customers/${c.customerId}/campaignBudgets:mutate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'developer-token': c.devToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: [{ create: { name: `${campaign.name} Budget`, amountMicros: Math.round((campaign.budget?.daily || 50) * 1_000_000), deliveryMethod: 'STANDARD' } }] }),
  });
  const budgetData = await budgetRes.json();
  if (budgetData.error) throw new Error(`YouTube CreateBudget: ${JSON.stringify(budgetData.error)}`);

  const campRes = await fetch(`${ADS_BASE}/customers/${c.customerId}/campaigns:mutate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'developer-token': c.devToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: [{ create: {
      name: campaign.name, status: 'PAUSED',
      advertisingChannelType: 'VIDEO',
      campaignBudget: budgetData.results?.[0]?.resourceName,
      startDate: (campaign.schedule?.start || new Date().toISOString().slice(0,10)).replace(/-/g,''),
      videoUniversalAppCampaignSettings: {},
      manualCpv: {},
    }}] }),
  });
  const campData = await campRes.json();
  if (campData.error) throw new Error(`YouTube CreateCampaign: ${JSON.stringify(campData.error)}`);
  return { success: true, campaignResourceName: campData.results?.[0]?.resourceName, status: 'PAUSED' };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const { action = 'insights', dateRange = 'last_30_days', level = 'campaign' } = req.query;
      if (action === 'campaigns') return res.status(200).json(await getCampaigns());
      if (action === 'insights')  return res.status(200).json(await getInsights(level, dateRange));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    if (req.method === 'POST') {
      const { action, id, dailyBudget, campaign } = req.body || {};
      if (action === 'pause')      return res.status(200).json(await pauseCampaign(id));
      if (action === 'resume')     return res.status(200).json(await resumeCampaign(id));
      if (action === 'create')     return res.status(201).json(await createCampaign(campaign));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
