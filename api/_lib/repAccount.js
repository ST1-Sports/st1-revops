/**
 * One place that turns a verified @st1sports.com email into a rep + app user, shared by the
 * email-code login and Sign in with Google so the two can never drift apart.
 *
 * The first person ever to sign in becomes admin (same rule as before). Signing in with Google
 * also marks the rep's Gmail as connected: a rep without a Gmail key gets one derived from
 * their rep id, so every existing sending/inbox path (which looks reps up by gmailEnvKey)
 * resolves to the encrypted connection created at sign-in.
 */
import crypto from 'crypto';
import { updateSettingSafely } from './settingSync.js';
import { normalizeLoginEmail, repNameFromEmail } from './loginCode.js';

function mkId() {
  return 'r_' + crypto.randomBytes(9).toString('base64url');
}

export function gmailKeyForRep(repId) {
  return `REP_${String(repId || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24)}`;
}

/** Pure: next app_state plus the rep/appUser for this email. Exported for tests. */
export function withRepForEmail(value, email, { name, gmailConnected = false, newId = mkId } = {}) {
  const state = value || {};
  const reps = Array.isArray(state.reps) ? state.reps : [];
  const appUsers = Array.isArray(state.appUsers) ? state.appUsers : [];
  const normalized = normalizeLoginEmail(email);

  let rep = reps.find(r => normalizeLoginEmail(r.email) === normalized);
  let repsNext = reps;
  if (!rep) {
    rep = {
      id: newId(),
      name: String(name || '').trim() || repNameFromEmail(normalized),
      email: normalized,
      title: '',
      createdAt: Date.now(),
    };
    repsNext = [...reps, rep];
  }
  if (gmailConnected && !rep.gmailEnvKey) {
    const updated = { ...rep, gmailEnvKey: gmailKeyForRep(rep.id) };
    repsNext = repsNext.map(r => (r.id === rep.id ? updated : r));
    rep = updated;
  }

  let appUser = appUsers.find(u => u.repId === rep.id);
  let appUsersNext = appUsers;
  if (!appUser) {
    appUser = { repId: rep.id, isAdmin: appUsers.length === 0 };
    appUsersNext = [...appUsers, appUser];
  }
  return { state: { ...state, reps: repsNext, appUsers: appUsersNext }, rep, appUser };
}

export async function upsertRepForEmail(email, options = {}) {
  let out;
  await updateSettingSafely('app_state', (value) => {
    out = withRepForEmail(value, email, options);
    return out.state;
  });
  return { rep: out.rep, appUser: { repId: out.appUser.repId, isAdmin: !!out.appUser.isAdmin } };
}
