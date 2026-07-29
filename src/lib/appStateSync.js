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
 * Pull server state, merge the given array fields into the local blob by id
 * (server records win on id conflicts, matching RevOps.jsx's own merge),
 * write the result back to localStorage, and push it back up so this
 * route's data and any other route's data converge to the same DB row.
 * Returns the merged state (or the untouched local state on failure).
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

  const { contacts: _c, agentHistory: _ah, ...serverClean } = serverState
  const merged = { ...local, ...serverClean, currentUserId: local.currentUserId }
  for (const field of mergeFields) {
    merged[field] = mergeById(local[field], serverClean[field])
  }
  writeAppState(merged)
  pushAppStateToServer()
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
