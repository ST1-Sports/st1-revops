/**
 * POST /api/followups/send { itemId, body } — sends the rep's reviewed draft from their own Gmail,
 * in the original thread. Only the signed-in owner of the follow-up can send it, only by an
 * explicit click, and never while the draft still has placeholders or a [REVIEW] note.
 */
import { setCors } from '../_lib/cors.js';
import { requireRep } from '../_lib/session.js';
import { loadOwnDraft, sendBlocker, sendOwnDraft } from '../_lib/followups/repDraft.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const me = await requireRep(req, res);
  if (!me) return;
  const body = String(req.body?.body ?? '');
  const blocker = sendBlocker(body);
  if (blocker) return res.status(422).json({ error: blocker });
  try {
    const loaded = await loadOwnDraft(me.repId, req.body?.itemId);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const sent = await sendOwnDraft(loaded, body);
    return res.json({ ok: true, ...sent });
  } catch (err) {
    console.error('[followups/send]', err.message);
    return res.status(err.status || 502).json({ error: err.status ? err.message : 'Gmail did not send the message. Nothing was sent; try again.' });
  }
}
