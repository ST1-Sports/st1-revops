/**
 * Shared sign-in gate for Rev-Ops API routes.
 *
 * Use after CORS / OPTIONS. A request passes with a signed session or a
 * short-lived x-st1-server token minted in this deployment (crons/webhooks
 * calling other routes). Anonymous callers get 401.
 *
 * Routes that must stay reachable without a session are listed in
 * PUBLIC_API_FILES — login, OAuth callbacks, signed webhooks, the email
 * open pixel, and Vercel cron entrypoints (those use CRON_SECRET instead).
 */
import { requireCaller } from './agentGate.js';

export const SIGN_IN_MESSAGE = 'Sign in to use Rev-Ops.';

/** Relative paths under api/ that are allowed without a signed-in rep. */
export const PUBLIC_API_FILES = [
  'login.js',
  'login-request-code.js',
  'login-verify-code.js',
  'auth/google.js',
  'radar/oauth.js',
  'slack/oauth.js',
  'gmail-setup.js',
  'google-drive-setup.js',
  'zoho-setup.js',
  'webhooks/zoho.js',
  'webhooks/sms.js',
  'inbound-email.js',
  'slack/actions.js',
  'track/open.js',
];

/** Signed-in rep or this deployment's server-call token. After OPTIONS. */
export async function requireSignedIn(req, res, opts = {}) {
  return requireCaller(req, res, { message: SIGN_IN_MESSAGE, ...opts });
}

/**
 * Vercel cron only. Fails closed when CRON_SECRET is missing — otherwise the
 * job is publicly callable.
 */
export function requireCronSecret(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(503).json({ error: 'CRON_SECRET is not configured' });
    return false;
  }
  if ((req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Jobs Vercel hits with Bearer CRON_SECRET and the signed-in UI may also hit
 * (Brad inbox poll, campaign pause/resume).
 */
export async function requireCronOrCaller(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') === `Bearer ${cronSecret}`) {
    return { kind: 'cron', server: true, isAdmin: true, repId: null };
  }
  return requireSignedIn(req, res);
}
