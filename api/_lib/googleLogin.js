/**
 * Pure helpers for Sign in with Google (api/auth/google.js), kept free of I/O so the access
 * rules are unit-tested: only verified @st1sports.com Google accounts get in, and Gmail is
 * connected only when both Gmail permissions were actually granted.
 */
import { isAllowedLoginEmail, normalizeLoginEmail } from './loginCode.js';
import { RADAR_SCOPES } from './radar/gmail.js';

const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

/**
 * One consent covers sign-in and the rep's Gmail: read mail and compose. gmail.compose lets the
 * app create drafts and send them, which the app only does when a rep clicks Send.
 */
export const GOOGLE_LOGIN_SCOPES = [...IDENTITY_SCOPES, ...RADAR_SCOPES];

/** Returns the normalized email when this Google identity may sign in, else null. */
export function allowedGoogleEmail(userinfo) {
  if (!userinfo || userinfo.email_verified === false || userinfo.email_verified === 'false') return null;
  const email = normalizeLoginEmail(userinfo.email);
  if (!isAllowedLoginEmail(email)) return null;
  // Workspace accounts carry hd; a consumer account that happens to use the address does not.
  if (userinfo.hd && String(userinfo.hd).toLowerCase() !== 'st1sports.com') return null;
  return email;
}

/** True when the token response granted every Gmail scope the app needs. */
export function grantedGmail(scopeString) {
  const granted = new Set(String(scopeString || '').split(/\s+/).filter(Boolean));
  return RADAR_SCOPES.every(s => granted.has(s));
}

export function loginRedirect(params) {
  const q = new URLSearchParams(params).toString();
  return `/?${q}`;
}
