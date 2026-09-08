let stateCache = null;
let stateCacheAt = 0;
let stateLoadPromise = null;
const STATE_CACHE_MS = 1000;

export async function loadServerState(options = {}) {
  try {
    const force = Boolean(options.force);
    if (!force && stateCache && Date.now() - stateCacheAt < STATE_CACHE_MS) return stateCache;
    if (!force && stateLoadPromise) return stateLoadPromise;
    stateLoadPromise = fetch("/api/state")
      .then(res => res.json())
      .then(data => {
        const state = data?.state && typeof data.state === "object" ? data.state : {};
        stateCache = state;
        stateCacheAt = Date.now();
        return state;
      })
      .finally(() => { stateLoadPromise = null; });
    return await stateLoadPromise;
  } catch {
    stateLoadPromise = null;
    return {};
  }
}

export async function saveServerState(state) {
  const { currentUserId: _currentUserId, ...toSync } = state || {};
  const payload = {
    ...toSync,
    agentHistory: Array.isArray(toSync.agentHistory) ? toSync.agentHistory.slice(-40) : [],
    contacts: Array.isArray(toSync.contacts) ? toSync.contacts : [],
  };
  await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: payload }),
  });
  stateCache = payload;
  stateCacheAt = Date.now();
  return payload;
}

export async function updateServerState(updater) {
  const current = await loadServerState({ force: true });
  const next = typeof updater === "function" ? updater(current) : { ...current, ...(updater || {}) };
  return saveServerState(next);
}

export function mergeById(existing = [], additions = []) {
  const map = new Map();
  for (const item of existing || []) if (item?.id) map.set(item.id, item);
  for (const item of additions || []) if (item?.id) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  const noId = [...(existing || []), ...(additions || [])].filter(item => item && !item.id);
  return [...map.values(), ...noId];
}

export function clearLegacyLocalKeys(keys = []) {
  try {
    keys.forEach(key => localStorage.removeItem(key));
  } catch {}
}
