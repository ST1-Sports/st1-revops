/**
 * Chat actions on disk are either a list (legacy) or { items, vote, votedAt }.
 * Keep vote off the action list so quote/price cards stay clean.
 */

export function splitChatPayload(raw) {
  if (Array.isArray(raw)) return { actions: raw, vote: null, votedAt: null };
  if (raw && typeof raw === 'object') {
    const actions = Array.isArray(raw.items)
      ? raw.items
      : (Array.isArray(raw.actions) ? raw.actions : []);
    const vote = raw.vote === 'up' || raw.vote === 'down' ? raw.vote : null;
    return { actions, vote, votedAt: raw.votedAt || null };
  }
  return { actions: [], vote: null, votedAt: null };
}

export function packChatPayload(actions, vote, votedAt) {
  const items = Array.isArray(actions) ? actions : [];
  if (!vote) return items.length ? items : null;
  return {
    items,
    vote,
    votedAt: votedAt || new Date().toISOString(),
  };
}

export function clipText(s, n = 180) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function feedbackMemoryKey(vote, query) {
  const slug = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'note';
  return `${vote === 'down' ? 'avoid' : 'good'}:${slug}`;
}

export const CHAT_FEEDBACK_ENTITY = 'chat-feedback';
export const CHAT_FEEDBACK_MAX = 24;
