/**
 * /api/state accepts the whole app state from any browser, so access control fields must not be
 * writable that way. Who can sign in (appUsers), who is admin, and which Gmail key belongs to
 * which rep only change through sign-in on the server or from a signed-in admin's session.
 * Before any admin exists (first-time setup) the old behaviour is kept. PINs are no longer used
 * and are never stored.
 */
const withoutPin = (users) => users.map(({ pin: _pin, ...rest }) => rest);

export function guardAccessFields(incoming, previous, { callerIsAdmin = false } = {}) {
  const prevUsers = Array.isArray(previous?.appUsers) ? previous.appUsers : [];
  const prevReps = Array.isArray(previous?.reps) ? previous.reps : [];
  const trusted = callerIsAdmin || !prevUsers.some(u => u?.isAdmin);
  const out = { ...incoming };

  const nextUsers = trusted && Array.isArray(incoming?.appUsers) ? incoming.appUsers : prevUsers;
  out.appUsers = withoutPin(nextUsers);

  if (!trusted && Array.isArray(incoming?.reps)) {
    const prevById = new Map(prevReps.map(r => [r?.id, r]));
    out.reps = incoming.reps.map(r => {
      const before = prevById.get(r?.id);
      if (!before) return { ...r, gmailEnvKey: undefined };
      return { ...r, gmailEnvKey: before.gmailEnvKey, email: before.email ?? r.email };
    });
  }
  return out;
}
