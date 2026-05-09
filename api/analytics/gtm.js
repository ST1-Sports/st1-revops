import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: false } };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _cachedToken = null;
let _tokenExpiry = 0;

function creds() {
  return {
    clientId:     process.env.GTM_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GTM_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GTM_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN,
    accountId:    process.env.GTM_ACCOUNT_ID,
    containerId:  process.env.GTM_CONTAINER_ID,
  };
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;
  const c   = creds();
  if (!c.clientId || !c.refreshToken) throw new Error('GTM OAuth credentials not configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`GTM token error: ${d.error_description}`);
  _cachedToken = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _cachedToken;
}

async function gtmGet(path) {
  const token = await getAccessToken();
  const r = await fetch(`https://tagmanager.googleapis.com/tagmanager/v2/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const d = await r.json();
  if (d.error) throw new Error(`GTM API: ${d.error.message}`);
  return d;
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const c = creds();
  if (!c.accountId) return res.status(400).json({ error: 'GTM_ACCOUNT_ID not configured' });

  try {
    // Fetch containers (and optionally tags for a specific container)
    const containers = await gtmGet(`accounts/${c.accountId}/containers`);
    const containerList = containers.container || [];

    let tags      = [];
    let triggers  = [];
    let workspace = null;

    if (c.containerId) {
      const containerPath = `accounts/${c.accountId}/containers/${c.containerId}`;
      // Get default workspace
      const workspaces = await gtmGet(`${containerPath}/workspaces`);
      workspace = workspaces.workspace?.[0];

      if (workspace) {
        const wsPath = `${containerPath}/workspaces/${workspace.workspaceId}`;
        const [tagData, triggerData] = await Promise.all([
          gtmGet(`${wsPath}/tags`),
          gtmGet(`${wsPath}/triggers`),
        ]);
        tags     = (tagData.tag     || []).map(t => ({ id: t.tagId,     name: t.name,     type: t.type,    paused: t.paused || false  }));
        triggers = (triggerData.trigger || []).map(t => ({ id: t.triggerId, name: t.name, type: t.type }));
      }
    }

    return res.status(200).json({
      containers: containerList.map(c => ({ id: c.containerId, name: c.name, publicId: c.publicId, usageContext: c.usageContext })),
      activeContainer: c.containerId || null,
      workspace:  workspace ? { id: workspace.workspaceId, name: workspace.name, description: workspace.description } : null,
      tags,
      triggers,
      tagCount:     tags.length,
      triggerCount: triggers.length,
      pausedTags:   tags.filter(t => t.paused).length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
