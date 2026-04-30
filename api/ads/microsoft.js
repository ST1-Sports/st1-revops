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
      'Authorization':     `Bearer ${token}`,
      'DeveloperToken':    c.devToken,
      'CustomerId':        c.customerId || '',
      'CustomerAccountId': c.accountId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Microsoft Ads error: ${JSON.stringify(d)}`);
  return d;
}

// Poll the report job until Success/Error or timeout
async function pollReport(reportId, maxWaitMs = 22000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const d      = await msRequest('Reporting', 'PollGenerateReport', { ReportRequestId: reportId });
    const status = d.ReportRequestStatus?.Status;
    if (status === 'Success') return d.ReportRequestStatus.ReportDownloadUrl;
    if (status === 'Error' || status === 'Failed') throw new Error(`Report job failed: ${status}`);
    await new Promise(r => setTimeout(r, 2500));
  }
  return null; // timed out — caller returns empty
}

// Minimal quoted-CSV parser that handles Microsoft's format
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      fields.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseMsCsv(text) {
  const lines    = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hdrIdx   = lines.findIndex(l => /CampaignName|AdGroupName|AdId/i.test(l));
  if (hdrIdx < 0) return [];
  const headers  = parseCsvLine(lines[hdrIdx]);
  const footerRe = /^©|^"©/;
  const rows     = [];
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (footerRe.test(lines[i])) break;
    const vals = parseCsvLine(lines[i]);
    if (!vals.length || vals.every(v => !v)) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const DATE_RANGE_DAYS = { yesterday: 1, last_7_days: 7, last_30_days: 30, last_90_days: 90 };

async function getInsights(level = 'campaign', datePreset = 'last_30_days') {
  const days  = DATE_RANGE_DAYS[datePreset] || 30;
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400_000);
  const c     = creds();

  const reportType = level === 'ad'
    ? 'AdPerformanceReport'
    : level === 'adset'
    ? 'AdGroupPerformanceReport'
    : 'CampaignPerformanceReport';

  const submit = await msRequest('Reporting', 'SubmitGenerateReportRequest', {
    ReportRequest: {
      '__type': `${reportType}Request:https://bingads.microsoft.com/Reporting/v13`,
      Format:   'Csv',
      ReportName: `ST1_${reportType}`,
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

  const reportId     = submit.ReportRequestId;
  const downloadUrl  = await pollReport(reportId);

  if (!downloadUrl) return []; // timed out — return empty, retry next refresh

  const csvText = await (await fetch(downloadUrl)).text();
  const rawRows = parseMsCsv(csvText);

  return rawRows.map((r, i) => {
    const name  = r['CampaignName'] || r['AdGroupName'] || r['AdId'] || `Row ${i + 1}`;
    const spend = parseFloat(r['Spend']   || 0);
    const rev   = parseFloat(r['Revenue'] || 0);
    return {
      id:          name.toLowerCase().replace(/\s+/g, '-') + `-${i}`,
      name,
      status:      'ACTIVE',
      spend:       +spend.toFixed(2),
      revenue:     +rev.toFixed(2),
      roas:        spend > 0 ? +(rev / spend).toFixed(2) : 0,
      impressions: parseInt(r['Impressions'] || 0),
      clicks:      parseInt(r['Clicks']      || 0),
      ctr:         parseFloat(r['Ctr']        || 0),
      cpc:         parseFloat(r['AverageCpc'] || 0),
      cpm:         parseFloat(r['AverageCpm'] || 0),
      conversions: parseFloat(r['Conversions'] || 0),
      platform:    'microsoft',
    };
  });
}

async function getCampaigns() {
  const c    = creds();
  const data = await msRequest('CampaignManagement', 'GetCampaignsByAccountId', {
    AccountId:    parseInt(c.accountId),
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
  const c = creds();
  await msRequest('CampaignManagement', 'UpdateCampaigns', {
    AccountId: parseInt(c.accountId),
    Campaigns: { Campaign: ids.map(id => ({ Id: parseInt(id), ...patch })) },
  });
  return { success: true };
}

async function createCampaign(campaign) {
  const c    = creds();
  const data = await msRequest('CampaignManagement', 'AddCampaigns', {
    AccountId: parseInt(c.accountId),
    Campaigns: {
      Campaign: [{
        Name:            campaign.name,
        Status:          'Paused',
        CampaignType:    'Search',
        DailyBudget:     campaign.budget?.daily || 50,
        DailyBudgetType: 'DailyBudgetStandard',
        TimeZone:        'CentralStandardTime',
        Languages:       { string: ['English'] },
      }],
    },
  });
  return { success: true, campaignId: data.CampaignIds?.long?.[0], status: 'PAUSED' };
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
