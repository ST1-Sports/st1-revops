/**
 * Background task registry — module-level (survives React unmounting).
 *
 * Tasks write their state here. Components read it on mount.
 * When a task completes, a 'st1:task:done' CustomEvent fires on window
 * so the global notification layer can pick it up regardless of which
 * page is currently visible.
 */

const _tasks = {};
let _persistTimer = null;

// ── Hydrate from localStorage on module load ──────────────────────────────────
try {
  const saved = JSON.parse(localStorage.getItem('st1_bg_tasks_v2') || '{}');
  // Only keep tasks from the last 2 hours to avoid stale data
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  Object.entries(saved).forEach(([id, t]) => {
    if (t.startedAt > cutoff) _tasks[id] = t;
  });
} catch {}

function _persist(immediate = false) {
  if (immediate) {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    try { localStorage.setItem('st1_bg_tasks_v2', JSON.stringify(_tasks)); } catch {}
    return;
  }
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try { localStorage.setItem('st1_bg_tasks_v2', JSON.stringify(_tasks)); } catch {}
  }, 500);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createTask(id, label) {
  _tasks[id] = {
    id, label,
    status:      'running',
    progress:    0,
    log:         [],
    contacts:    [],
    preview:     null,
    startedAt:   Date.now(),
  };
  _persist(true);
  return _tasks[id];
}

export function updateTask(id, updates) {
  if (!_tasks[id]) return;
  Object.assign(_tasks[id], updates);
  _persist(true);
}

export function appendLog(id, msg, type = 'info') {
  if (!_tasks[id]) return;
  _tasks[id].log = [{ id: Math.random().toString(36).slice(2), msg, type, ts: Date.now() }, ..._tasks[id].log.slice(0, 199)];
  _persist();
}

export function appendContacts(id, newContacts) {
  if (!_tasks[id]) return;
  _tasks[id].contacts = [..._tasks[id].contacts, ...newContacts];
  _persist();
}

export function completeTask(id, { summary, data } = {}) {
  if (!_tasks[id]) return;
  _tasks[id].status      = 'done';
  _tasks[id].completedAt = Date.now();
  if (summary) _tasks[id].summary = summary;
  if (data !== undefined) _tasks[id].data = data;
  _persist(true);
  window.dispatchEvent(new CustomEvent('st1:task:done', { detail: { ..._tasks[id] } }));
}

export function failTask(id, errorMsg) {
  if (!_tasks[id]) return;
  _tasks[id].status  = 'error';
  _tasks[id].summary = errorMsg;
  _persist(true);
  window.dispatchEvent(new CustomEvent('st1:task:done', { detail: { ..._tasks[id] } }));
}

export function getTask(id) {
  return _tasks[id] || null;
}

export function clearTask(id) {
  delete _tasks[id];
  _persist(true);
}
