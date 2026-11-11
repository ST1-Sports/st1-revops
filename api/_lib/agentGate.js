/**
 * Gate for the agent and AI routes (Scout, Claude, Edgar, Brad, Annie, Ledger, knowledge).
 *
 * A request passes when it carries a signed-in rep's session, or a short-lived server-call
 * token that only code in this deployment can mint (same key chain as sessions, its own
 * purpose), for crons and webhooks that call agent routes over HTTP. The caller is kept in
 * the request's async context so agent interactions are logged against the rep who asked.
 *
 * Use in a handler as: if (!bindCaller(await requireCaller(req, res))) return
 * bindCaller is synchronous on purpose: async context set inside an awaited helper does not
 * flow back to the handler, so it must be entered in the handler's own frame.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readRep, signPayload, verifyPayload } from './session.js';

const context = new AsyncLocalStorage();
const SERVER_HEADER = 'x-st1-server';
const SERVER_TTL_MS = 2 * 60 * 1000;

/** The caller of the current request: { repId, isAdmin, server } or null. */
export const currentCaller = () => context.getStore() || null;

/** Headers for a server job calling another route in this deployment. */
export function serverCallHeaders() {
  const token = signPayload('server-call', { exp: Date.now() + SERVER_TTL_MS });
  return token ? { [SERVER_HEADER]: token } : {};
}

export async function resolveCaller(req) {
  if (verifyPayload('server-call', String(req.headers?.[SERVER_HEADER] || ''))) {
    return { server: true, repId: null, isAdmin: true };
  }
  const rep = await readRep(req);
  return rep ? { ...rep, server: false } : null;
}

/** Records the caller for the rest of this request (call in the handler's own frame). */
export function bindCaller(caller) {
  if (caller) context.enterWith(caller);
  return caller;
}

/** Writes 401/403 and returns null when the caller may not use this route. */
export async function requireCaller(req, res, { adminOnly = false } = {}) {
  const caller = await resolveCaller(req);
  if (!caller) {
    res.status(401).json({ error: 'Sign in again to use the agents.' });
    return null;
  }
  if (adminOnly && !caller.isAdmin) {
    res.status(403).json({ error: 'Admins only.' });
    return null;
  }
  return caller;
}
