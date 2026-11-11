/**
 * POST /api/login-request-code — { email } → { ok: true }
 *
 * Email-based login, step 1 of 2 (see api/login-verify-code.js for step 2).
 * Any @st1sports.com address is allowed — there's no pre-existing-rep check
 * here by design, since a first-time login is exactly how someone new (e.g.
 * a rep nobody has added yet) gets in. Generates a 6-digit one-time code,
 * stores only its hash (LoginCode, 10-minute expiry), and emails it via the
 * shared Gmail sender set up at /api/gmail-setup (no repKey — the default,
 * org-wide GMAIL_REFRESH_TOKEN).
 */
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { sendGmailPlainText } from './_lib/gmailAuth.js';
import { generateLoginCode, hashLoginCode, isAllowedLoginEmail, normalizeLoginEmail } from './_lib/loginCode.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const email = normalizeLoginEmail(req.body?.email);
  if (!isAllowedLoginEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid @st1sports.com email address' });
  }

  try {
    const existing = await prisma.loginCode.findUnique({ where: { email } });
    if (existing && Date.now() - new Date(existing.createdAt).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'A code was just sent — wait a moment before requesting another' });
    }

    const code = generateLoginCode();
    await prisma.loginCode.upsert({
      where: { email },
      create: { email, codeHash: hashLoginCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0 },
      update: { codeHash: hashLoginCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, createdAt: new Date() },
    });

    await sendGmailPlainText({
      to: email,
      subject: 'Your ST1 RevOps login code',
      text: `Your ST1 RevOps login code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[login-request-code]', e.message);
    const notConfigured = /not configured/i.test(e.message);
    return res.status(500).json({
      error: notConfigured ? 'Login email couldn\'t be sent — Gmail sending isn\'t set up yet.' : e.message,
      ...(notConfigured ? { setup: '/api/gmail-setup' } : {}),
    });
  }
}
