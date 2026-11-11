/**
 * GET /api/followups/draft?itemId=… — the rep's latest unsent draft for one of their own
 * follow-ups (to, cc, subject, body), for review before sending. Signed-in rep only.
 */
import { setCors } from '../_lib/cors.js';
import { requireRep } from '../_lib/session.js';
import { loadOwnDraft, sendBlocker } from '../_lib/followups/repDraft.js';

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const me = await requireRep(req, res);
  if (!me) return;
  try {
    const loaded = await loadOwnDraft(me.repId, req.query?.itemId);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    return res.json({ ok: true, ...loaded.view, blocker: sendBlocker(loaded.view.body) });
  } catch (err) {
    console.error('[followups/draft]', err.message);
    return res.status(502).json({ error: 'Could not load the draft from Gmail. Try again.' });
  }
}
