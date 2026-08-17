import { setCors } from '../../_lib/cors.js';
import { authenticateToolRequest, requireScope } from '../../_lib/ai-tools/auth.js';
import { saveKnowledgeDocument } from '../../_lib/ai-tools/sources.js';
import { createSign } from 'crypto';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const config = {
  api: { bodyParser: { sizeLimit: '200kb' } },
  maxDuration: 30,
};

let cachedToken = null;
let tokenExpiry = 0;

function sendError(res, status, code, message, details) {
  return res.status(status).json({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

function driveConfig() {
  return {
    serviceAccountJson: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    serviceAccountJsonBase64: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64,
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function parseServiceAccount(cfg) {
  const raw = cfg.serviceAccountJsonBase64
    ? Buffer.from(cfg.serviceAccountJsonBase64, 'base64').toString('utf8')
    : cfg.serviceAccountJson;
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON must include client_email and private_key.');
  }
  return parsed;
}

async function getServiceAccountToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: serviceAccount.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(serviceAccount.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Google Drive service-account auth failed: ${data.error_description || data.error || 'unknown error'}`);
  }
  return data.access_token;
}

async function getDriveToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
  const cfg = driveConfig();
  const serviceAccount = parseServiceAccount(cfg);
  if (serviceAccount) {
    cachedToken = await getServiceAccountToken(serviceAccount);
    tokenExpiry = Date.now() + 3600 * 1000;
    return cachedToken;
  }

  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error('Google Drive is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON, or set GOOGLE_DRIVE_REFRESH_TOKEN plus GOOGLE_DRIVE_CLIENT_ID/SECRET.');
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Google Drive token refresh failed: ${data.error_description || data.error || 'unknown error'}`);
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

function parseFileId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const idParam = value.match(/[?&]id=([^&]+)/);
  if (idParam) return decodeURIComponent(idParam[1]);
  const pathMatch = value.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (pathMatch) return pathMatch[1];
  const foldersMatch = value.match(/\/folders\/([^/?]+)/);
  if (foldersMatch) return foldersMatch[1];
  return value;
}

async function driveGet(path, token) {
  const response = await fetch(`${DRIVE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function driveText(path, token) {
  const response = await fetch(`${DRIVE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.text();
}

function exportMime(mimeType) {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'text/csv';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'text/plain';
  if (mimeType === 'application/vnd.google-apps.document') return 'text/plain';
  return 'text/plain';
}

function isTextLike(mimeType, name = '') {
  return /^text\//.test(mimeType || '')
    || ['application/json', 'application/xml', 'application/csv'].includes(mimeType)
    || /\.(txt|md|csv|json|xml)$/i.test(name);
}

async function readDriveFile(fileId, token) {
  const meta = await driveGet(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`, token);
  let content = '';

  if (meta.mimeType?.startsWith('application/vnd.google-apps.')) {
    content = await driveText(`/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime(meta.mimeType))}`, token);
  } else if (isTextLike(meta.mimeType, meta.name)) {
    content = await driveText(`/files/${encodeURIComponent(fileId)}?alt=media`, token);
  } else {
    throw new Error(`Unsupported Drive file type: ${meta.mimeType || 'unknown'}. Export or upload text, Markdown, CSV, JSON, Google Docs, Sheets, or Slides.`);
  }

  return { meta, content: content.trim() };
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'POST only');

  const auth = authenticateToolRequest(req);
  if (!auth.ok) {
    return sendError(res, auth.status || 401, auth.status === 503 ? 'auth_not_configured' : 'unauthorized', auth.error, auth.details);
  }
  const permissionError = requireScope(auth, 'knowledge:write');
  if (permissionError) {
    return sendError(res, 403, permissionError.code, permissionError.message, { requiredScope: permissionError.requiredScope });
  }

  const fileId = parseFileId(req.body?.fileId || req.body?.url);
  if (!fileId) return sendError(res, 400, 'invalid_input', 'Google Drive file URL or file ID is required.');

  try {
    const token = await getDriveToken();
    const { meta, content } = await readDriveFile(fileId, token);
    if (!content) return sendError(res, 404, 'no_content', 'No readable text content was found in that Drive file.');

    const document = await saveKnowledgeDocument({
      title: req.body?.title || meta.name || 'Google Drive file',
      sourceType: 'google_drive',
      sourceName: meta.webViewLink || req.body?.url || fileId,
      content,
    });

    return res.status(200).json({
      ok: true,
      document,
      driveFile: {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        modifiedTime: meta.modifiedTime || null,
        webViewLink: meta.webViewLink || null,
      },
    });
  } catch (error) {
    console.error('[ai/connectors/google-drive]', error.message);
    return sendError(res, 500, 'google_drive_import_failed', error.message);
  }
}
