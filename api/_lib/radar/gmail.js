/**
 * Gmail client for Follow-Up Radar.
 * Scopes: gmail.readonly + gmail.compose. Never the send scope.
 * drafts.create is allowed; drafts.send / messages.send are refused at the HTTP layer.
 */
import { decryptSecret } from './crypto.js';
import { emailsFromHeader, parseEmail } from './filters.js';

export const RADAR_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export const RADAR_SCOPE_STRING = RADAR_SCOPES.join(' ');

const SEND_VERB = 'send';
const FORBIDDEN_PATH = new RegExp(`\\/((messages|drafts)\\/${SEND_VERB})(?:\\?|$)`, 'i');

export function assertRadarPathAllowed(path) {
  if (FORBIDDEN_PATH.test(String(path || ''))) {
    throw new Error('Radar must never send email');
  }
}

export async function refreshAccessToken(encryptedRefreshToken) {
  const refresh = decryptSecret(encryptedRefreshToken);
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await r.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Gmail token refresh failed');
  }
  return data.access_token;
}

export async function gmailFetch(accessToken, path, { method = 'GET', body, query } = {}) {
  assertRadarPathAllowed(path);
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error?.message || `Gmail ${r.status} ${path}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

function headerMap(payload) {
  const map = {};
  for (const h of payload?.headers || []) {
    if (!h?.name) continue;
    map[h.name.toLowerCase()] = h.value || '';
  }
  return map;
}

function decodeBody(data) {
  if (!data) return '';
  const pad = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(pad, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractText(payload) {
  if (!payload) return '';
  const mime = (payload.mimeType || '').toLowerCase();
  if (mime === 'text/plain' && payload.body?.data) return decodeBody(payload.body.data);
  const parts = payload.parts || [];
  const plain = parts.find(p => (p.mimeType || '').toLowerCase() === 'text/plain');
  if (plain?.body?.data) return decodeBody(plain.body.data);
  for (const p of parts) {
    const nested = extractText(p);
    if (nested) return nested;
  }
  if (mime === 'text/html' && payload.body?.data) {
    return decodeBody(payload.body.data).replace(/<[^>]+>/g, ' ');
  }
  return '';
}

export function parseGmailThread(raw) {
  const messages = (raw.messages || []).map(m => {
    const payload = m.payload || {};
    const h = headerMap(payload);
    return {
      id: m.id,
      internalDate: Number(m.internalDate || 0),
      labelIds: m.labelIds || [],
      from: h.from || '',
      to: emailsFromHeader(h.to).map(p => p.email),
      cc: emailsFromHeader(h.cc).map(p => p.email),
      subject: h.subject || '',
      body: extractText(payload).slice(0, 20000),
      messageIdHeader: h['message-id'] || '',
      inReplyTo: h['in-reply-to'] || '',
      references: h.references || '',
    };
  });
  messages.sort((a, b) => a.internalDate - b.internalDate);
  const last = messages[messages.length - 1];
  return {
    id: raw.id,
    historyId: raw.historyId,
    subject: last?.subject || messages[0]?.subject || '',
    labelIds: [...new Set(messages.flatMap(m => m.labelIds || []))],
    labelNames: [],
    messages,
    lastMessageAt: last ? new Date(last.internalDate) : null,
    lastMessageId: last?.id || null,
  };
}

export function threadHash(thread) {
  const last = thread.messages?.[thread.messages.length - 1];
  return `${thread.id}:${last?.id || ''}:${thread.messages?.length || 0}`;
}

export function threadText(thread) {
  const parts = [`Subject: ${thread.subject || ''}`];
  for (const m of thread.messages || []) {
    const who = parseEmail(m.from).email || m.from;
    const when = m.internalDate ? new Date(m.internalDate).toISOString() : '';
    parts.push(`--- ${who} ${when} ---\n${m.body || ''}`);
  }
  return parts.join('\n\n');
}

export async function listSentThreadIds(accessToken, { afterYmd, pageToken, maxResults = 100 } = {}) {
  const q = afterYmd ? `in:sent after:${afterYmd}` : 'in:sent';
  return gmailFetch(accessToken, '/threads', {
    query: { q, pageToken, maxResults },
  });
}

export async function getFullThread(accessToken, threadId) {
  const raw = await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}`, {
    query: { format: 'full' },
  });
  return parseGmailThread(raw);
}

export async function listHistory(accessToken, startHistoryId, pageToken) {
  try {
    return await gmailFetch(accessToken, '/history', {
      query: { startHistoryId, historyTypes: 'messageAdded', maxResults: 500, pageToken },
    });
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      const e = new Error('history_expired');
      e.code = 'history_expired';
      throw e;
    }
    throw err;
  }
}

export async function listLabels(accessToken) {
  const data = await gmailFetch(accessToken, '/labels');
  return data.labels || [];
}

export async function profile(accessToken) {
  return gmailFetch(accessToken, '/profile');
}

export async function getDefaultSignature(accessToken) {
  try {
    const data = await gmailFetch(accessToken, '/settings/sendAs');
    const list = data.sendAs || [];
    const def = list.find(s => s.isDefault) || list[0];
    const html = def?.signature || '';
    const text = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    return { html, text, displayName: def?.displayName || '', sendAsEmail: def?.sendAsEmail || '' };
  } catch {
    return { html: '', text: '', displayName: '', sendAsEmail: '' };
  }
}

export async function listRecentSent(accessToken, max = 30) {
  const listed = await gmailFetch(accessToken, '/messages', {
    query: { q: 'in:sent', maxResults: max },
  });
  const out = [];
  for (const m of listed.messages || []) {
    const raw = await gmailFetch(accessToken, `/messages/${m.id}`, { query: { format: 'full' } });
    const payload = raw.payload || {};
    const h = headerMap(payload);
    out.push({
      id: raw.id,
      subject: h.subject || '',
      body: extractText(payload).slice(0, 4000),
      from: h.from || '',
    });
  }
  return out;
}

export function encodeRawMime(headers, body) {
  const lines = [];
  for (const [k, v] of Object.entries(headers)) {
    if (v == null || v === '') continue;
    lines.push(`${k}: ${String(v).replace(/\r?\n/g, ' ')}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(body || '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

/** Create an unsent threaded draft. Never sends. */
export async function createThreadedDraft(accessToken, { threadId, raw }) {
  return gmailFetch(accessToken, '/drafts', {
    method: 'POST',
    body: { message: { raw, threadId } },
  });
}

export async function getDraft(accessToken, draftId) {
  return gmailFetch(accessToken, `/drafts/${encodeURIComponent(draftId)}`);
}

export function ymdDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days || 120));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export async function runPool(items, limit, fn) {
  const n = Math.max(1, limit);
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
