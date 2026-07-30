/**
 * Shared app-state sync helpers.
 *
 * RevOps.jsx's useStore() is the canonical owner of the "st1_revops_v2"
 * localStorage blob + its /api/state DB sync (pull-merge-push, debounced
 * writes, polling). But RFPTool.jsx and Integrations.jsx are separate
 * top-level routes that also read/write slices of that same blob (rfps,
 * deals, contacts) directly against localStorage — and previously never
 * pushed those writes to /api/state themselves. That meant data created
 * from those routes only reached Postgres incidentally, if the same
 * browser later happened to load the main RevOps dashboard (whose own
 * sync would pick up the localStorage change and push it). A different
 * device, or a browser that only ever visits /rfp or /integrations, would
 * never see that data synced at all.
 *
 * These helpers give any route the same "push what changed" and
 * "pull and merge on load" behavior without duplicating RevOps.jsx's
 * merge logic in three places.
 */

export const APP_STATE_KEY = 'st1_revops_v2'

// Mirrors RevOps.jsx's useStore() exactly: currentUserId is local-session
// only; contacts and agentHistory are intentionally excluded from server
// sync (contacts is a re-pullable Zoho CRM cache, not a durable record —
// real durable contacts live in SalesContact via /api/contacts/*).
const EXCLUDE_ON_SYNC = new Set(['currentUserId', 'contacts', 'agentHistory'])

export function readAppState() {
  try { return JSON.parse(localStorage.getItem(APP_STATE_KEY) || '{}') } catch { return {} }
}

export function writeAppState(state) {
  try { localStorage.setItem(APP_STATE_KEY, JSON.stringify(state)) } catch {}
}

function stripExcluded(state) {
  const out = {}
  for (const [k, v] of Object.entries(state)) {
    if (!EXCLUDE_ON_SYNC.has(k)) out[k] = v
  }
  return out
}

/** Merge two arrays of {id,...} records, server values winning on id conflicts. */
export function mergeById(local = [], server = []) {
  const map = {}
  for (const item of (local || [])) if (item?.id) map[item.id] = item
  for (const item of (server || [])) if (item?.id) map[item.id] = item
  const noId = (local || []).filter(x => !x?.id)
  return [...Object.values(map), ...noId]
}

/** Push whatever's currently in the shared localStorage blob up to /api/state. Fire-and-forget. */
export function pushAppStateToServer() {
  const state = readAppState()
  return fetch('/api/state', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ state: stripExcluded(state) }),
  }).catch(() => {})
}

/**
 * Pull server state and merge ONLY the given array fields into the local
 * blob by id (server records win on id conflicts, matching RevOps.jsx's own
 * merge). Every other field is left exactly as the local copy had it.
 *
 * Deliberately does NOT wholesale-adopt the rest of the server's state, and
 * does NOT push the result back to /api/state. Earlier versions of this
 * function did both, which caused real data loss: a route that only cares
 * about (say) rfps would spread the ENTIRE server snapshot over local state
 * first, silently overwriting other fields (e.g. deals) with whatever the
 * server happened to have at that GET — which could be staler than an edit
 * still sitting in another tab's debounce window — and then push that
 * corrupted blob back up, potentially clobbering the other tab's correct,
 * not-yet-synced write on the server too. A route should only ever be
 * authoritative for the fields it actually owns and writes to; pulling here
 * is purely "give me an up-to-date copy of the field(s) I asked for."
 */
export async function pullAndMergeAppState(mergeFields = []) {
  const local = readAppState()
  let serverState
  try {
    const r = await fetch('/api/state')
    const d = await r.json()
    serverState = d?.state
  } catch {
    return local
  }
  if (!serverState || typeof serverState !== 'object') return local

  const merged = { ...local }
  for (const field of mergeFields) {
    merged[field] = mergeById(local[field], serverState[field])
  }
  writeAppState(merged)
  return merged
}

/**
 * Add items into one array field of the shared blob, deduping by id.
 * Returns the count actually added (0 if all were already present).
 */
export function pushItemsToAppState(key, items) {
  const state = readAppState()
  const existing = Array.isArray(state[key]) ? state[key] : []
  const existingIds = new Set(existing.map(x => x.id))
  const toAdd = (items || []).filter(x => x?.id && !existingIds.has(x.id))
  if (!toAdd.length) return 0
  state[key] = [...toAdd, ...existing]
  writeAppState(state)
  return toAdd.length
}

let pushTimer = null

/**
 * Overwrite one field of the shared blob and sync it up, for standalone
 * routes doing simple CRUD on a single array (add/update/delete one item).
 * The local write is immediate so the UI reflects it right away; the
 * server push is debounced so a burst of edits (e.g. deleting several
 * items back to back) collapses into one request instead of one per edit.
 */
export function setAppStateField(field, value) {
  writeAppState({ ...readAppState(), [field]: value })
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushAppStateToServer, 1500)
}
