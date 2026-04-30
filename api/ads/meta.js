import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const BASE = 'https://graph.facebook.com/v19.0';

function token() {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('META_ACCESS_TOKEN not configured');
  return t;
}
function accountId() {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('META_AD_ACCOUNT_ID not configured');
  return id.startsWith('act_') ? id : `act_${id}`;
}

const INSIGHT_FIELDS = [
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'spend', 'impressions', 'clicks', 'cpm', 'cpc', 'ctr',
  'actions', 'action_values', 'reach', 'frequency',
].join(',');

function parseRoas(actions, actionValues) {
  const purchases = (actionValues || []).find(a => a.action_type === 'purchase');
  const spend = parseFloat(purchases?.value || 0);
  return spend;
}

function normaliseInsight(row) {
  const purchaseVal = parseRoas(row.actions, row.action_values);
  const spend       = parseFloat(row.spend || 0);
  const leads       = (row.actions || []).find(a => a.action_type === 'lead');
  return {
    id:           row.campaign_id || row.adset_id || row.ad_id,
    name:         row.campaign_name || row.adset_name || row.ad_name,
    spend,
    revenue:      purchaseVal,
    roas:         spend > 0 ? +(purchaseVal / spend).toFixed(2) : 0,
    impressions:  parseInt(row.impressions || 0),
    clicks:       parseInt(row.clicks || 0),
    cpm:          parseFloat(row.cpm || 0),
    cpc:          parseFloat(row.cpc || 0),
    ctr:          parseFloat(row.ctr || 0),
    leads:        parseInt(leads?.value || 0),
    reach:        parseInt(row.reach || 0),
    platform:     'meta',
  };
}

async function getInsights(level = 'campaign', datePreset = 'last_30_days') {
  const acct = accountId();
  const url  = `${BASE}/${acct}/insights?fields=${INSIGHT_FIELDS}&level=${level}&date_preset=${datePreset}&limit=200&access_token=${token()}`;
  const r    = await fetch(url);
  const d    = await r.json();
  if (d.error) throw new Error(`Meta Insights: ${d.error.message}`);
  return (d.data || []).map(normaliseInsight);
}

async function getCampaigns() {
  const acct = accountId();
  const fields = 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,budget_remaining';
  const url  = `${BASE}/${acct}/campaigns?fields=${fields}&limit=200&access_token=${token()}`;
  const r    = await fetch(url);
  const d    = await r.json();
  if (d.error) throw new Error(`Meta Campaigns: ${d.error.message}`);
  return (d.data || []).map(c => ({
    id:            c.id,
    name:          c.name,
    status:        c.status,
    objective:     c.objective,
    dailyBudget:   c.daily_budget   ? parseInt(c.daily_budget)   / 100 : null,
    lifetimeBudget:c.lifetime_budget? parseInt(c.lifetime_budget)/ 100 : null,
    budgetRemaining: c.budget_remaining ? parseInt(c.budget_remaining) / 100 : null,
    startTime:     c.start_time,
    stopTime:      c.stop_time,
    platform:      'meta',
  }));
}

async function pauseCampaign(id) {
  const r = await fetch(`${BASE}/${id}?access_token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PAUSED' }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`Meta Pause: ${d.error.message}`);
  return { success: true };
}

async function resumeCampaign(id) {
  const r = await fetch(`${BASE}/${id}?access_token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`Meta Resume: ${d.error.message}`);
  return { success: true };
}

async function setBudget(id, dailyBudgetUsd) {
  // Meta budgets are in cents
  const r = await fetch(`${BASE}/${id}?access_token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_budget: Math.round(dailyBudgetUsd * 100) }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`Meta SetBudget: ${d.error.message}`);
  return { success: true };
}

// Map normalized objective → Meta objective
const OBJ_MAP = {
  AWARENESS:   'BRAND_AWARENESS',
  TRAFFIC:     'LINK_CLICKS',
  CONVERSIONS: 'CONVERSIONS',
  LEAD_GEN:    'LEAD_GENERATION',
};

async function createCampaign(campaign) {
  const acct = accountId();
  // 1. Create campaign
  const campRes = await fetch(`${BASE}/${acct}/campaigns?access_token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:                   campaign.name,
      objective:              OBJ_MAP[campaign.objective] || 'LINK_CLICKS',
      status:                 'PAUSED', // always start paused for review
      special_ad_categories:  [],
    }),
  });
  const camp = await campRes.json();
  if (camp.error) throw new Error(`Meta CreateCampaign: ${camp.error.message}`);

  // 2. Create ad set
  const targeting = buildMetaTargeting(campaign.audience);
  const adsetRes  = await fetch(`${BASE}/${acct}/adsets?access_token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:              `${campaign.name} — Ad Set`,
      campaign_id:       camp.id,
      billing_event:     'IMPRESSIONS',
      optimization_goal: campaign.objective === 'LEAD_GEN' ? 'LEAD_GENERATION' : 'OFFSITE_CONVERSIONS',
      daily_budget:      Math.round((campaign.budget?.daily || 50) * 100),
      targeting,
      status:            'PAUSED',
      start_time:        campaign.schedule?.start || new Date().toISOString(),
      end_time:          campaign.schedule?.end   || undefined,
    }),
  });
  const adset = await adsetRes.json();
  if (adset.error) throw new Error(`Meta CreateAdSet: ${adset.error.message}`);

  return { success: true, campaignId: camp.id, adsetId: adset.id, status: 'PAUSED' };
}

function buildMetaTargeting(audience) {
  const base = {
    geo_locations: { countries: ['US'] },
    age_min: 25,
    age_max: 65,
  };
  if (audience?.preset === 'athletic_directors') {
    return { ...base, job_titles: [{ id: '113579075348613', name: 'Athletic Director' }] };
  }
  if (audience?.preset === 'coaches') {
    return { ...base, job_titles: [{ id: '105763666133882', name: 'Coach' }] };
  }
  return base;
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
      if (action === 'set_budget') return res.status(200).json(await setBudget(id, dailyBudget));
      if (action === 'create')     return res.status(201).json(await createCampaign(campaign));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
