/**
 * Minimal Gmail OAuth token + plain-text send, used only by the email-code
 * login flow (api/login-request-code.js). Deliberately NOT shared with
 * api/gmail.js's own getToken()/send — that file is high-traffic (outreach,
 * Brad, campaigns) and far more complex (attachments, threading, per-rep
 * tokens); keeping login's Gmail usage in its own small, simple file means a
 * bug in one can never break the other. Both read the same env vars /
 * Setting rows (GMAIL_CLIENT_ID/SECRET, GMAIL_REFRESH_TOKEN, gmail_token_*),
 * so a Gmail account connected via /api/gmail-setup works for both.
 */
import { prisma } from './prisma.js';
import { encodeMimeWord } from './mimeHeader.js';

const _tokenCache = {};

export async function getGmailAccessToken(repEnvKey = '') {
  const cacheKey = repEnvKey || 'default';
  const cached = _tokenCache[cacheKey];
  if (cached && Date.now() < cached.expiry - 60_000) return cached.token;

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    throw new Error('Gmail not configured — set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel env vars');
  }

  let refreshToken = null;
  if (repEnvKey) {
    try {
      const dbKey = `gmail_token_${repEnvKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      const row = await prisma.setting.findUnique({ where: { key: dbKey } });
      if (row?.value?.refreshToken) refreshToken = row.value.refreshToken;
    } catch {}
  }
  if (!refreshToken) {
    const refreshTokenVar = repEnvKey
      ? `GMAIL_REFRESH_TOKEN_${repEnvKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
      : 'GMAIL_REFRESH_TOKEN';
    refreshToken = process.env[refreshTokenVar];
    if (!refreshToken) {
      throw new Error('Gmail not configured — visit /api/gmail-setup to connect a sending account');
    }
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  _tokenCache[cacheKey] = { token: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

export async function sendGmailPlainText({ to, subject, text }) {
  const token = await getGmailAccessToken('');
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeMimeWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ];
  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = await sendRes.json();
  if (!sendRes.ok) throw new Error(data.error?.message || 'Gmail send failed');
  return data;
}
