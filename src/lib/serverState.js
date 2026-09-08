export async function loadServerState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    return data?.state && typeof data.state === "object" ? data.state : {};
  } catch {
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
  return payload;
}

export async function updateServerState(updater) {
  const current = await loadServerState();
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
