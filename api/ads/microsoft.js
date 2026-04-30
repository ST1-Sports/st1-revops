import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const ADS_BASE  = 'https://api.ads.microsoft.com/v13';

let _cachedToken = null;
let _tokenExpiry = 0;

function creds() {
  const c = {
    clientId:     process.env.MICROSOFT_ADS_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_ADS_CLIENT_SECRET,
    refreshToken: process.env.MICROSOFT_ADS_REFRESH_TOKEN,
    devToken:     process.env.MICROSOFT_ADS_DEVELOPER_TOKEN,
    customerId:   process.env.MICROSOFT_ADS_CUSTOMER_ID,
    accountId:    process.env.MICROSOFT_ADS_ACCOUNT_ID,
  };
  if (!c.devToken || !c.accountId) throw new Error('Microsoft Ads env vars not configured');
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
      scope:         'https://ads.microsoft.com/msads.manage offline_access',
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`Microsoft token error: ${d.error_description}`);
  _cachedToken = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _cachedToken;
}

async function msRequest(service, operation, body) {
  const token = await getAccessToken();
  const c     = creds();
  const r = await fetch(`${ADS_BASE}/${service}/${operation}`, {
    method:  'POST',
    headers: {
      'Authorization':         `Bearer ${token}`,
      'DeveloperToken':        c.devToken,
      'CustomerId':            c.customerId || '',
      'CustomerAccountId':     c.accountId,
      'Content-Type':          'application/json',
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.TrackingId && !r.ok) throw new Error(`Microsoft Ads error: ${JSON.stringify(d)}`);
  return d;
}

function msFmtDate(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

const DATE_RANGE_DAYS = { yesterday: 1, last_7_days: 7, last_30_days: 30, last_90_days: 90 };

async function getInsights(level = 'campaign', datePreset = 'last_30_days') {
  const days  = DATE_RANGE_DAYS[datePreset] || 30;
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400_000);
  const c     = creds();

  const reportType = level === 'ad' ? 'AdPerformanceReport' : level === 'adset' ? 'AdGroupPerformanceReport' : 'CampaignPerformanceReport';

  const data = await msRequest('Reporting', 'SubmitGenerateReportRequest', {
    ReportRequest: {
      '__type':       `${reportType}Request:https://bingads.microsoft.com/Reporting/v13`,
      Format:         'Csv',
      ReportName:     `ST1_${reportType}`,
      ReturnOnlyCompleteData: false,
      Time: {
        CustomDateRangeStart: { Day: start.getDate(), Month: start.getMonth() + 1, Year: start.getFullYear() },
        CustomDateRangeEnd:   { Day: end.getDate(),   Month: end.getMonth() + 1,   Year: end.getFullYear() },
        PredefinedTime: null,
      },
      Scope:   { AccountIds: [parseInt(c.accountId)] },
      Columns: ['CampaignName', 'AdGroupName', 'AdId', 'Impressions', 'Clicks', 'Spend', 'Ctr', 'AverageCpc', 'AverageCpm', 'Conversions', 'Revenue'],
    },
  });

  // Microsoft uses async report generation; return stub with report ID for polling
  // In production you'd poll the report download URL
  return [{
    id:          'ms-report-pending',
    name:        'Microsoft Ads Report',
    status:      'pending',
    reportId:    data.ReportRequestId,
    note:        'Microsoft Ads uses async reporting. Poll /api/ads/microsoft?action=report&reportId=' + data.ReportRequestId,
    platform:    'microsoft',
    spend:       0, revenue: 0, roas: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0,
  }];
}

async function getCampaigns() {
  const c    = creds();
  const data = await msRequest('CampaignManagement', 'GetCampaignsByAccountId', {
    AccountId: parseInt(c.accountId),
    CampaignType: 'Search Shopping DynamicSearchAds',
  });
  return (data.Campaigns?.Campaign || []).map(camp => ({
    id:          String(camp.Id),
    name:        camp.Name,
    status:      camp.Status,
    objective:   camp.CampaignType,
    dailyBudget: camp.DailyBudget ? parseFloat(camp.DailyBudget) : null,
    startTime:   camp.StartDate ? `${camp.StartDate.Year}-${String(camp.StartDate.Month).padStart(2,'0')}-${String(camp.StartDate.Day).padStart(2,'0')}` : null,
    stopTime:    camp.EndDate   ? `${camp.EndDate.Year}-${String(camp.EndDate.Month).padStart(2,'0')}-${String(camp.EndDate.Day).padStart(2,'0')}`   : null,
    platform:    'microsoft',
  }));
}

async function updateCampaigns(ids, patch) {
  const c    = creds();
  const data = await msRequest('CampaignManagement', 'UpdateCampaigns', {
    AccountId: parseInt(c.accountId),
    Campaigns: { Campaign: ids.map(id => ({ Id: parseInt(id), ...patch })) },
  });
  if (data.PartialErrors) throw new Error(`Microsoft update partial error`);
  return { success: true };
}

async function createCampaign(campaign) {
  const c    = creds();
  const data = await msRequest('CampaignManagement', 'AddCampaigns', {
    AccountId: parseInt(c.accountId),
    Campaigns: {
      Campaign: [{
        Name:                 campaign.name,
        Status:               'Paused',
        CampaignType:         'Search',
        DailyBudget:          campaign.budget?.daily || 50,
        DailyBudgetType:      'DailyBudgetStandard',
        TimeZone:             'CentralStandardTime',
        Languages:            { string: ['English'] },
      }],
    },
  });
  const id = data.CampaignIds?.long?.[0];
  return { success: true, campaignId: id, status: 'PAUSED' };
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
      if (action === 'pause')      return res.status(200).json(await updateCampaigns([id], { Status: 'Paused' }));
      if (action === 'resume')     return res.status(200).json(await updateCampaigns([id], { Status: 'Active' }));
      if (action === 'set_budget') return res.status(200).json(await updateCampaigns([id], { DailyBudget: dailyBudget }));
      if (action === 'create')     return res.status(201).json(await createCampaign(campaign));
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
