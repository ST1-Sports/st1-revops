import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const BASE      = 'https://api.linkedin.com/v2';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

let _cachedToken  = null;
let _tokenExpiry  = 0;

// Supports two auth modes:
//   1. Long-lived (preferred): LINKEDIN_CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN
//   2. Legacy static: LINKEDIN_ACCESS_TOKEN (expires in ~60 days)
async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error(`LinkedIn token refresh failed: ${d.error_description || d.error}`);
    _cachedToken = d.access_token;
    _tokenExpiry = Date.now() + (d.expires_in || 5184000) * 1000;
    return _cachedToken;
  }

  // Legacy fallback — static token, no refresh
  const staticToken = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!staticToken) throw new Error('LINKEDIN_ACCESS_TOKEN not configured');
  return staticToken;
}

async function authHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization':             `Bearer ${token}`,
    'Content-Type':              'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function accountUrn() {
  const id = process.env.LINKEDIN_AD_ACCOUNT_ID;
  if (!id) throw new Error('LINKEDIN_AD_ACCOUNT_ID not configured');
  return `urn:li:sponsoredAccount:${id}`;
}

const DATE_RANGE_DAYS = { yesterday: 1, last_7_days: 7, last_30_days: 30, last_90_days: 90 };

function buildDateRange(preset) {
  const days  = DATE_RANGE_DAYS[preset] || 30;
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400_000);
  return {
    start: { year: start.getFullYear(), month: start.getMonth() + 1, day: start.getDate() },
    end:   { year: end.getFullYear(),   month: end.getMonth() + 1,   day: end.getDate() },
  };
}

async function getInsights(level = 'campaign', datePreset = 'last_30_days') {
  const pivot  = level === 'ad' ? 'CREATIVE' : level === 'adset' ? 'CAMPAIGN_GROUP' : 'CAMPAIGN';
  const dr     = buildDateRange(datePreset);
  const fields = 'costInLocalCurrency,impressions,clicks,externalWebsiteConversions,externalWebsitePostClickConversions,approximateMemberReach';
  const url    = [
    `${BASE}/adAnalyticsV2?q=analytics`,
    `pivot=${pivot}`,
    `dateRange.start.year=${dr.start.year}&dateRange.start.month=${dr.start.month}&dateRange.start.day=${dr.start.day}`,
    `dateRange.end.year=${dr.end.year}&dateRange.end.month=${dr.end.month}&dateRange.end.day=${dr.end.day}`,
    `accounts[0]=${encodeURIComponent(accountUrn())}`,
    `fields=${fields}`,
    'timeGranularity=ALL',
  ].join('&');

  const r = await fetch(url, { headers: await authHeaders() });
  const d = await r.json();
  if (d.status === 401 || d.status === 403) throw new Error(`LinkedIn auth error: ${d.message}`);

  return (d.elements || []).map((el, i) => {
    const spend = parseFloat(el.costInLocalCurrency || 0);
    const conv  = parseFloat(el.externalWebsitePostClickConversions || 0);
    const rev   = conv * 50;
    return {
      id:          el.pivotValue || String(i),
      name:        el.pivotValue || `LinkedIn ${pivot} ${i + 1}`,
      spend:       +spend.toFixed(2),
      revenue:     +rev.toFixed(2),
      roas:        spend > 0 ? +(rev / spend).toFixed(2) : 0,
      impressions: parseInt(el.impressions || 0),
      clicks:      parseInt(el.clicks || 0),
      ctr:         el.impressions > 0 ? +((el.clicks / el.impressions) * 100).toFixed(2) : 0,
      cpc:         el.clicks > 0 ? +(spend / el.clicks).toFixed(2) : 0,
      cpm:         el.impressions > 0 ? +(spend / el.impressions * 1000).toFixed(2) : 0,
      conversions: conv,
      reach:       parseInt(el.approximateMemberReach || 0),
      platform:    'linkedin',
    };
  });
}

async function getCampaigns() {
  const url = `${BASE}/adCampaignsV2?q=search&search.account.values[0]=${encodeURIComponent(accountUrn())}&fields=id,name,status,type,dailyBudget,totalBudget,runSchedule`;
  const r   = await fetch(url, { headers: await authHeaders() });
  const d   = await r.json();
  if (d.status === 401) throw new Error('LinkedIn auth error');
  return (d.elements || []).map(c => ({
    id:          String(c.id),
    name:        c.name,
    status:      c.status,
    objective:   c.type,
    dailyBudget: c.dailyBudget?.amount ? parseFloat(c.dailyBudget.amount) : null,
    startTime:   c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString() : null,
    stopTime:    c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString()   : null,
    platform:    'linkedin',
  }));
}

async function updateCampaign(id, patch) {
  const r = await fetch(`${BASE}/adCampaignsV2/${id}`, {
    method:  'POST',
    headers: { ...(await authHeaders()), 'X-RestLi-Method': 'PARTIAL_UPDATE' },
    body:    JSON.stringify({ patch: { $set: patch } }),
  });
  if (!r.ok) throw new Error(`LinkedIn update failed: ${r.status}`);
  return { success: true };
}

const OBJ_MAP = {
  AWARENESS:   'BRAND_AWARENESS',
  TRAFFIC:     'WEBSITE_VISITS',
  CONVERSIONS: 'WEBSITE_CONVERSIONS',
  LEAD_GEN:    'LEAD_GENERATION',
};

async function createCampaign(campaign) {
  const body = {
    account:     accountUrn(),
    name:        campaign.name,
    status:      'PAUSED',
    type:        OBJ_MAP[campaign.objective] || 'WEBSITE_VISITS',
    costType:    'CPM',
    dailyBudget: { currencyCode: 'USD', amount: String(campaign.budget?.daily || 50) },
    targeting:   { includedTargetingFacets: { locations: [{ urn: 'urn:li:geo:103644278' }] } },
    runSchedule: { start: Date.parse(campaign.schedule?.start || new Date()) },
  };
  if (campaign.schedule?.end) body.runSchedule.end = Date.parse(campaign.schedule.end);

  const r = await fetch(`${BASE}/adCampaignsV2`, {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify(body),
  });
  const d = await r.json();
  if (d.status >= 400) throw new Error(`LinkedIn create: ${d.message}`);
  return { success: true, campaignId: d.id, status: 'PAUSED' };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const { action = 'insights', dateRange: dr = 'last_30_days', level = 'campaign' } = req.query;
      if (action === 'campaigns') return res.status(200).json(await getCampaigns());
      if (action === 'insights')  return res.status(200).json(await getInsights(level, dr));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    if (req.method === 'POST') {
      const { action, id, dailyBudget, campaign } = req.body || {};
      if (action === 'pause')      return res.status(200).json(await updateCampaign(id, { status: 'PAUSED' }));
      if (action === 'resume')     return res.status(200).json(await updateCampaign(id, { status: 'ACTIVE' }));
      if (action === 'set_budget') return res.status(200).json(await updateCampaign(id, { dailyBudget: { currencyCode: 'USD', amount: String(dailyBudget) } }));
      if (action === 'create')     return res.status(201).json(await createCampaign(campaign));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
