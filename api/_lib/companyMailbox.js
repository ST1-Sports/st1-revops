/**
 * The company's default Gmail sender (login codes, reply notifications, campaigns with no rep).
 * An admin connects it from Settings → Email Status (api/mailboxes.js → Google → api/auth/google.js);
 * the refresh token is stored encrypted here, so it never has to be pasted into Vercel. The
 * GMAIL_REFRESH_TOKEN env var stays only as a fallback for deployments that have not connected yet.
 */
import { prisma } from './prisma.js';
import { encryptSecret, decryptSecret } from './radar/crypto.js';

export const COMPANY_MAILBOX_KEY = 'company_gmail';

export async function readCompanyConnection() {
  const row = await prisma.setting.findUnique({ where: { key: COMPANY_MAILBOX_KEY } }).catch(() => null);
  return row?.value || null;
}

/** Decrypted refresh token for the connected company mailbox, or null. */
export async function companyRefreshToken() {
  try {
    const conn = await readCompanyConnection();
    return conn?.encryptedRefreshToken ? decryptSecret(conn.encryptedRefreshToken) : null;
  } catch (err) {
    console.warn('[company mailbox] token lookup failed:', err.message);
    return null;
  }
}

export async function saveCompanyConnection({ refreshToken, email, scopes, connectedBy }) {
  const value = {
    encryptedRefreshToken: encryptSecret(refreshToken),
    email: String(email || '').trim().toLowerCase(),
    scopes: scopes || '',
    connectedAt: new Date().toISOString(),
    connectedBy: connectedBy || null,
  };
  await prisma.setting.upsert({
    where: { key: COMPANY_MAILBOX_KEY },
    update: { value },
    create: { key: COMPANY_MAILBOX_KEY, value },
  });
}

export async function deleteCompanyConnection() {
  await prisma.setting.deleteMany({ where: { key: COMPANY_MAILBOX_KEY } });
}
