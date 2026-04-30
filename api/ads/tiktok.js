import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function creds() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const advId = process.env.TIKTOK_ADVERTISER_ID;
  if (!token || !advId) throw new Error('TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID not configured');
  return { token, advId };
}

function formatDate(d) { return d.toISOString().slice(0, 10); }

const DATE_RANGE_DAYS = { yesterday: 1, last_7_days: 7, last_30_days: 30, last_90_days: 90 };

async function tiktokGet(path, params = {}) {
  const { token, advId } = creds();
  const qs = new URLSearchParams({ advertiser_id: advId, ...params }).toString();
  const r  = await fetch(`${BASE}${path}?${qs}`, { headers: { 'Access-Token': token } });
  const d  = await r.json();
  if (d.code !== 0) throw new Error(`TikTok API error ${d.code}: ${d.message}`);
  return d.data;
}

async function tiktokPost(path, body) {
  const { token } = creds();
  const r = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(`TikTok API error ${d.code}: ${d.message}`);
  return d.data;
}

async function getInsights(level = 'campaign', datePreset = 'last_30_days') {
  const days  = DATE_RANGE_DAYS[datePreset] || 30;
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400_000);
  const { advId } = creds();

  const serviceType = level === 'ad' ? 'AD' : level === 'adset' ? 'ADGROUP' : 'CAMPAIGN';
  const data = await tiktokGet('/report/integrated/get/', {
    advertiser_id:  advId,
    report_type:    'BASIC',
    data_level:     serviceType,
    dimensions:     JSON.stringify([`${serviceType.toLowerCase()}_id`, `${serviceType.toLowerCase()}_name`]),
    metrics:        JSON.stringify(['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversion', 'cost_per_conversion', 'real_time_conversion_rate']),
    start_date:     formatDate(start),
    end_date:       formatDate(end),
    page_size:      200,
  });

  return (data?.list || []).map(row => {
    const m     = row.metrics || {};
    const dims  = row.dimensions || {};
    const spend = parseFloat(m.spend || 0);
    const conv  = parseFloat(m.conversion || 0);
    const estRev = conv * 150; // estimated revenue per conversion (ST1 avg order)
    return {
      id:          dims[`${serviceType.toLowerCase()}_id`]   || row.id   || '',
      name:        dims[`${serviceType.toLowerCase()}_name`] || row.name || '',
      spend:       +spend.toFixed(2),
      revenue:     +estRev.toFixed(2),
      roas:        spend > 0 ? +(estRev / spend).toFixed(2) : 0,
      impressions: parseInt(m.impressions || 0),
      clicks:      parseInt(m.clicks      || 0),
      ctr:         parseFloat(m.ctr || 0),
      cpc:         parseFloat(m.cpc || 0),
      cpm:         parseFloat(m.cpm || 0),
      conversions: conv,
      platform:    'tiktok',
    };
  });
}

async function getCampaigns() {
  const { advId } = creds();
  const data = await tiktokGet('/campaign/get/', {
    advertiser_id: advId,
    fields:        JSON.stringify(['campaign_id', 'campaign_name', 'status', 'objective_type', 'budget', 'budget_mode', 'create_time']),
    page_size:     200,
  });
  return (data?.list || []).map(c => ({
    id:          String(c.campaign_id),
    name:        c.campaign_name,
    status:      c.status,
    objective:   c.objective_type,
    dailyBudget: c.budget_mode === 'BUDGET_MODE_DAY' ? parseFloat(c.budget) : null,
    platform:    'tiktok',
  }));
}

async function updateCampaignStatus(id, status) {
  const { advId } = creds();
  await tiktokPost('/campaign/status/update/', {
    advertiser_id: advId,
    campaign_ids:  [id],
    operation_status: status,
  });
  return { success: true };
}

async function setBudget(id, dailyBudget) {
  const { advId } = creds();
  await tiktokPost('/campaign/update/', {
    advertiser_id: advId,
    campaign_id:   id,
    budget:        dailyBudget,
    budget_mode:   'BUDGET_MODE_DAY',
  });
  return { success: true };
}

const OBJ_MAP = { AWARENESS: 'REACH', TRAFFIC: 'TRAFFIC', CONVERSIONS: 'CONVERSIONS', LEAD_GEN: 'LEAD_GENERATION' };

async function createCampaign(campaign) {
  const { advId } = creds();
  const data = await tiktokPost('/campaign/create/', {
    advertiser_id:   advId,
    campaign_name:   campaign.name,
    objective_type:  OBJ_MAP[campaign.objective] || 'TRAFFIC',
    budget_mode:     'BUDGET_MODE_DAY',
    budget:          campaign.budget?.daily || 50,
    operation_status:'DISABLE', // start paused
  });
  return { success: true, campaignId: data.campaign_id, status: 'PAUSED' };
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
      if (action === 'pause')      return res.status(200).json(await updateCampaignStatus(id, 'DISABLE'));
      if (action === 'resume')     return res.status(200).json(await updateCampaignStatus(id, 'ENABLE'));
      if (action === 'set_budget') return res.status(200).json(await setBudget(id, dailyBudget));
      if (action === 'create')     return res.status(201).json(await createCampaign(campaign));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
