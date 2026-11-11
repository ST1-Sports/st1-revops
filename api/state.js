/**
 * /api/state — Cross-device app state sync
 *
 * GET  → returns the saved app state from the database
 * POST { state: {...} } → upserts the app state
 *
 * Uses the Setting model with key "app_state".
 * This lets RevOps data (deals, campaigns, contacts, etc.) sync across
 * any device that logs in — instead of being trapped in localStorage.
 */

import { guardAccessFields } from "./_lib/appUsersGuard.js";
import { readRep } from "./_lib/session.js";
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { updateSettingSafely } from './_lib/settingSync.js';
import { applyDealTombstones } from '../src/lib/dealTombstone.js';
import { applyContactTombstones } from '../src/lib/contactTombstone.js';

export const config = {
  api: { bodyParser: { sizeLimit: "8mb" } },
};

// Fields that should never be synced (local-session only).
const EXCLUDE_KEYS = new Set(["currentUserId"]);

// priceLists held uploaded dealer catalogs. The Price Lists screen is gone
// and quoting reads the ST1 PIM (falling back to PriceItem rows), but the
// stored blob is historical data and must never be erased by this endpoint:
//   - clients can no longer write it (dropped from incoming state), and
//   - every write carries the stored value forward untouched.
// GET leaves it out of the response only to keep the payload small.
const PRESERVED_SERVER_KEYS = ["priceLists"];

function omitKeys(state, keys) {
  if (!state || typeof state !== "object") return state;
  const out = { ...state };
  for (const key of keys) delete out[key];
  return out;
}

export function carryForwardPreserved(next, previous) {
  const out = omitKeys(next, PRESERVED_SERVER_KEYS);
  if (!previous || typeof previous !== "object") return out;
  for (const key of PRESERVED_SERVER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) out[key] = previous[key];
  }
  return out;
}

// appUsers[].pin is checked server-side by /api/login and must never reach an
// unauthenticated browser — a device only needs to know who's pickable, not
// their PIN. The real pin still gets written on POST (see below); only what
// GET hands back to the client is redacted.
function redactAppUserPins(state) {
  if (!Array.isArray(state?.appUsers)) return state;
  return { ...state, appUsers: state.appUsers.map(({ pin, ...rest }) => rest) };
}

function sanitize(state) {
  if (!state || typeof state !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (EXCLUDE_KEYS.has(k)) continue;
    // Trim agent history to last 40 to keep payload reasonable
    if (k === "agentHistory" && Array.isArray(v)) {
      out[k] = v.slice(-40);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const setting = await prisma.setting.findUnique({ where: { key: "app_state" } });
      if (!setting) return res.json({ state: null });
      const raw = setting.value || {};
      const tombs = applyDealTombstones(raw, raw);
      const contactTombs = applyContactTombstones(raw, raw);
      return res.json({ state: omitKeys(redactAppUserPins({ ...raw, ...tombs, ...contactTombs }), PRESERVED_SERVER_KEYS) });
    } catch (e) {
      console.error("[state] GET error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { state } = req.body || {};
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "state object required" });
    }
    try {
      const clean = sanitize(state);
      // Access fields (appUsers, admin flags, Gmail keys) change only for a signed-in admin.
      const caller = await readRep(req);
      // updateSettingSafely, not a plain findUnique-then-upsert — this is the
      // single most frequently written endpoint in the app (every dispatch()
      // POSTs here), so two near-simultaneous writes from different actions,
      // tabs, or devices are routine, not an edge case. A blind read-then-
      // write lets the second one silently clobber the first's changes with
      // a merge computed against an already-stale "previous" — e.g. a deal
      // added in one request can vanish because another request's write
      // lands a split second later, unioned against a previous snapshot that
      // never had it. updateSettingSafely retries the whole read-merge-write
      // against the fresh row instead of ever blindly overwriting it.
      await updateSettingSafely("app_state", (previousRaw) => {
        const previous = previousRaw && typeof previousRaw === "object" ? previousRaw : {};
        const tombs = applyDealTombstones(clean, previous);
        const contactTombs = applyContactTombstones(clean, previous);
        const guarded = guardAccessFields(clean, previous, { callerIsAdmin: !!caller?.isAdmin });
        return carryForwardPreserved({ ...guarded, ...tombs, ...contactTombs }, previous);
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error("[state] POST error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
