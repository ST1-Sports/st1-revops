/**
 * POST /api/login-verify-code — { email, code } → { ok, repId, rep, appUser }
 *
 * Email-based login, step 2. Checks the code against what request-code
 * stored (one-time use — deleted on success), then resolves this email to
 * an existing rep or creates one on the spot (first-time @st1sports.com
 * login), using updateSettingSafely so a concurrent login/other app_state
 * write can't clobber it. The first person ever to log in this way becomes
 * admin, same as the existing "no admin configured yet" bypass on the
 * Login screen.
 *
 * Returns the rep/appUser objects so the client can dispatch ADD_REP/
 * SET_APP_USER locally right away — this device won't see a brand-new rep
 * via /api/state until its next pull otherwise.
 */
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { hashLoginCode, isAllowedLoginEmail, normalizeLoginEmail, safeEqual } from './_lib/loginCode.js';
import { upsertRepForEmail } from './_lib/repAccount.js';
import { issueSessionToken } from './_lib/session.js';

const MAX_ATTEMPTS = 5;

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const email = normalizeLoginEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  if (!isAllowedLoginEmail(email) || !code) {
    return res.status(400).json({ error: 'email and code required' });
  }

  try {
    const row = await prisma.loginCode.findUnique({ where: { email } });
    if (!row || row.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Code expired or not found — request a new one' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts — request a new code' });
    }
    if (!safeEqual(hashLoginCode(code), row.codeHash)) {
      await prisma.loginCode.update({ where: { email }, data: { attempts: { increment: 1 } } });
      return res.status(401).json({ error: 'Incorrect code' });
    }
    await prisma.loginCode.delete({ where: { email } }).catch(() => {});

    const { rep: repOut, appUser: appUserOut } = await upsertRepForEmail(email);

    return res.json({
      ok: true,
      repId: repOut.id,
      rep: repOut,
      appUser: { repId: appUserOut.repId, isAdmin: !!appUserOut.isAdmin },
      // Proves this rep's identity to routes with per-rep data (Follow-Up Radar).
      sessionToken: issueSessionToken(repOut.id),
    });
  } catch (e) {
    console.error('[login-verify-code]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
