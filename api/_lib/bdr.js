/**
 * Per-rep BDRs: each rep can have their own outreach persona (a real Google Workspace mailbox,
 * e.g. Matt → Brad Hofer <brad@shopst1sports.com>). Bulk Outreach, Brad's approved sends, the
 * campaign cron and the reply-watching cron send from / read the BDR of the rep who owns the work.
 *
 * Storage (server-only, never part of the app_state the browser syncs):
 *   Setting `bdr_assignments`   { [repId]: { name, email, gmailKey, updatedAt } }
 *   Setting `bdr_gmail_<KEY>`   { encryptedRefreshToken, email, scopes, connectedAt, connectedBy }
 *
 * A BDR's gmailKey is the mailbox's local part (brad@shopst1sports.com → BRAD), so the original
 * shared Brad keeps the key every existing campaign and sent-mail check already uses.
 */
import { prisma } from './prisma.js';
import { encryptSecret, decryptSecret } from './radar/crypto.js';

// Same rule as repGmailToken.js (kept local so the two modules do not import each other).
export const normalizeGmailKey = (key) => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

export const ASSIGNMENTS_KEY = 'bdr_assignments';

/** The original shared BDR; still used for older lists/campaigns that predate per-rep BDRs. */
export const LEGACY_BDR = Object.freeze({ name: 'Brad Hofer', email: 'brad@shopst1sports.com', gmailKey: 'BRAD' });

/** Google scopes a BDR mailbox needs: read replies/bounces, send, and mark replies read. */
export const BDR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];
export const BDR_GMAIL_SCOPES = BDR_SCOPES.filter(s => s.includes('/auth/gmail.'));

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export function bdrKeyForEmail(email) {
  const local = normalizeEmail(email).split('@')[0] || '';
  return normalizeGmailKey(local);
}

export const tokenSettingKey = (gmailKey) => `bdr_gmail_${normalizeGmailKey(gmailKey)}`;

/** Pure: the rep's BDR from the assignments map, or null. */
export function bdrForRep(assignments, repId) {
  const a = repId ? assignments?.[repId] : null;
  if (!a?.email || !a?.gmailKey) return null;
  return { repId, name: a.name || '', email: normalizeEmail(a.email), gmailKey: normalizeGmailKey(a.gmailKey) };
}

/** Pure: the rep whose BDR uses this mailbox key, or null when no rep has claimed it. */
export function ownerOfBdrKey(assignments, gmailKey) {
  const key = normalizeGmailKey(gmailKey);
  if (!key) return null;
  for (const [repId, a] of Object.entries(assignments || {})) {
    if (a?.gmailKey && normalizeGmailKey(a.gmailKey) === key) return repId;
  }
  return null;
}

/** Pure: the BDR used for work with no owner recorded (older lists): whoever claimed Brad, else Brad. */
export function defaultBdr(assignments) {
  const owner = ownerOfBdrKey(assignments, LEGACY_BDR.gmailKey);
  return (owner && bdrForRep(assignments, owner)) || { repId: null, ...LEGACY_BDR };
}

/** Pure: which BDR sends a campaign — the one recorded on it, else the default. */
export function bdrForCampaign(assignments, camp) {
  return bdrForRep(assignments, camp?.bdrRepId) || defaultBdr(assignments);
}

/** Pure: every BDR mailbox to watch for replies (each rep's, plus unclaimed Brad). */
export function allBdrMailboxes(assignments) {
  const out = Object.keys(assignments || {}).map(id => bdrForRep(assignments, id)).filter(Boolean);
  if (!out.some(b => b.gmailKey === LEGACY_BDR.gmailKey)) out.push({ repId: null, ...LEGACY_BDR });
  return out;
}

/**
 * Pure: validates a BDR a rep wants to set. Returns { bdr } or { error }.
 * A BDR must be its own mailbox: not any rep's sign-in address, not another rep's BDR, and its
 * key must not collide with a rep's personal Gmail key.
 */
export function validateBdr({ name, email }, repId, { assignments = {}, reps = [] } = {}) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) return { error: 'Give your BDR a name (the sender name prospects see).' };
  if (!EMAIL_RE.test(cleanEmail)) return { error: 'Enter the BDR mailbox address, e.g. brad@shopst1sports.com.' };
  const gmailKey = bdrKeyForEmail(cleanEmail);
  if (!gmailKey) return { error: 'That address does not work as a mailbox key.' };
  if (reps.some(r => normalizeEmail(r?.email) === cleanEmail)) {
    return { error: 'That is a rep’s own sign-in address. A BDR needs its own mailbox.' };
  }
  if (reps.some(r => r?.gmailEnvKey && normalizeGmailKey(r.gmailEnvKey) === gmailKey)) {
    return { error: `The mailbox key ${gmailKey} is already a rep’s personal Gmail key. Use a different BDR address.` };
  }
  for (const [otherId, a] of Object.entries(assignments)) {
    if (otherId === repId || !a) continue;
    if (normalizeEmail(a.email) === cleanEmail) return { error: 'Another rep already uses that BDR mailbox.' };
    if (normalizeGmailKey(a.gmailKey) === gmailKey) {
      return { error: `Another rep’s BDR already uses the mailbox key ${gmailKey}. Use an address with a different name before the @.` };
    }
  }
  return { bdr: { name: cleanName, email: cleanEmail, gmailKey } };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadAssignments() {
  const row = await prisma.setting.findUnique({ where: { key: ASSIGNMENTS_KEY } }).catch(() => null);
  const v = row?.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export async function writeAssignments(next) {
  await prisma.setting.upsert({
    where: { key: ASSIGNMENTS_KEY },
    update: { value: next },
    create: { key: ASSIGNMENTS_KEY, value: next },
  });
}

/** The BDR for a rep, from storage. */
export async function loadBdrForRep(repId) {
  return bdrForRep(await loadAssignments(), repId);
}

export async function readBdrConnection(gmailKey) {
  const row = await prisma.setting.findUnique({ where: { key: tokenSettingKey(gmailKey) } }).catch(() => null);
  return row?.value || null;
}

/** Decrypted refresh token for a BDR mailbox connected through the BDR flow, or null. */
export async function bdrRefreshToken(gmailKey) {
  const key = normalizeGmailKey(gmailKey);
  if (!key) return null;
  try {
    const conn = await readBdrConnection(key);
    if (!conn?.encryptedRefreshToken) return null;
    return decryptSecret(conn.encryptedRefreshToken);
  } catch (err) {
    console.warn('[bdr] token lookup failed:', err.message);
    return null;
  }
}

export async function saveBdrConnection(gmailKey, { refreshToken, email, scopes, connectedBy }) {
  const value = {
    encryptedRefreshToken: encryptSecret(refreshToken),
    email: normalizeEmail(email),
    scopes: scopes || '',
    connectedAt: new Date().toISOString(),
    connectedBy: connectedBy || null,
  };
  const key = tokenSettingKey(gmailKey);
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function deleteBdrConnection(gmailKey) {
  await prisma.setting.deleteMany({ where: { key: tokenSettingKey(gmailKey) } });
}
