/**
 * Pure helpers for the email-code login flow (api/login-request-code.js,
 * api/login-verify-code.js) — kept separate from those Prisma/Gmail-touching
 * handlers so the actual logic (email validation, name derivation, code
 * generation/hashing) is unit-testable without a database.
 */
import crypto from 'crypto';

const EMAIL_RE = /^[a-z0-9._%+-]+@st1sports\.com$/i;

export function normalizeLoginEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isAllowedLoginEmail(email) {
  return EMAIL_RE.test(normalizeLoginEmail(email));
}

/** "keith.jones" → "Keith Jones"; falls back to something non-empty either way. */
export function repNameFromEmail(email) {
  const local = normalizeLoginEmail(email).split('@')[0] || '';
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return name || 'New User';
}

export function generateLoginCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashLoginCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
