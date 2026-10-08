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
import crypto from 'crypto';
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { updateSettingSafely } from './_lib/settingSync.js';
import { hashLoginCode, isAllowedLoginEmail, normalizeLoginEmail, repNameFromEmail, safeEqual } from './_lib/loginCode.js';

const MAX_ATTEMPTS = 5;

function mkId() {
  return 'r_' + crypto.randomBytes(9).toString('base64url');
}

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

    let repOut, appUserOut;
    await updateSettingSafely('app_state', (value) => {
      const state = value || {};
      const reps = Array.isArray(state.reps) ? state.reps : [];
      const appUsers = Array.isArray(state.appUsers) ? state.appUsers : [];

      let rep = reps.find(r => normalizeLoginEmail(r.email) === email);
      let repsNext = reps;
      if (!rep) {
        rep = { id: mkId(), name: repNameFromEmail(email), email, title: '', createdAt: Date.now() };
        repsNext = [...reps, rep];
      }

      let appUser = appUsers.find(u => u.repId === rep.id);
      let appUsersNext = appUsers;
      if (!appUser) {
        appUser = { repId: rep.id, isAdmin: appUsers.length === 0 };
        appUsersNext = [...appUsers, appUser];
      }

      repOut = rep;
      appUserOut = appUser;
      return { ...state, reps: repsNext, appUsers: appUsersNext };
    });

    return res.json({
      ok: true,
      repId: repOut.id,
      rep: repOut,
      appUser: { repId: appUserOut.repId, isAdmin: !!appUserOut.isAdmin },
    });
  } catch (e) {
    console.error('[login-verify-code]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
