/**
 * Resolves a rep's Gmail refresh token from the encrypted connection created by Sign in with
 * Google, so every existing path that identifies a rep by gmailEnvKey (outreach sends, inbox,
 * sent-mail reconcile, Radar) uses the same connection. Returns null when the rep has not
 * signed in with Google yet; callers then fall back to the older per-rep token. A BDR mailbox
 * connected through Settings → My BDR (api/_lib/bdr.js) is checked first.
 */
import { prisma } from './prisma.js';
import { decryptSecret } from './radar/crypto.js';
import { bdrRefreshToken } from './bdr.js';

export const normalizeGmailKey = (key) => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

export async function connectedRefreshTokenForKey(repEnvKey) {
  const key = normalizeGmailKey(repEnvKey);
  if (!key) return null;
  // A BDR mailbox connected from Settings → My BDR wins over any older token for that key.
  const bdrToken = await bdrRefreshToken(key);
  if (bdrToken) return bdrToken;
  if (key === 'BRAD') return null;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'app_state' } });
    const reps = Array.isArray(setting?.value?.reps) ? setting.value.reps : [];
    const rep = reps.find(r => r?.gmailEnvKey && normalizeGmailKey(r.gmailEnvKey) === key);
    if (!rep) return null;
    const conn = await prisma.inboxConnection.findUnique({
      where: { userId_provider: { userId: rep.id, provider: 'gmail' } },
    });
    if (!conn || conn.status === 'disconnected' || !conn.encryptedRefreshToken) return null;
    return decryptSecret(conn.encryptedRefreshToken);
  } catch (err) {
    console.warn('[gmail] connection lookup failed:', err.message);
    return null;
  }
}
