/**
 * /api/bdr — each rep's own BDR (outreach persona + mailbox). Signed-in reps only.
 *
 * GET                                   → { bdr, connection, sendingEnabled, team? (admins) }
 * POST { action:"save", name, email }   → set (or change) my BDR
 * POST { action:"connect" }             → { url } to Google; sign in AS the BDR mailbox there
 * POST { action:"test" }                → checks the mailbox token works, returns its address
 * POST { action:"disconnect" }          → forget the mailbox token (BDR stays set up)
 * POST { action:"remove" }              → remove my BDR entirely
 * Admins may pass repId to act on another rep's BDR.
 */
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { requireRep } from './_lib/session.js';
import { getGmailAccessToken } from './_lib/gmailAuth.js';
import { bdrConnectUrl } from './auth/google.js';
import {
  bdrForRep, deleteBdrConnection, loadAssignments, ownerOfBdrKey, readBdrConnection,
  validateBdr, writeAssignments,
} from './_lib/bdr.js';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

async function loadReps() {
  const row = await prisma.setting.findUnique({ where: { key: 'app_state' } }).catch(() => null);
  return Array.isArray(row?.value?.reps) ? row.value.reps : [];
}

function publicConnection(conn) {
  if (!conn?.encryptedRefreshToken) return null;
  return { email: conn.email || null, connectedAt: conn.connectedAt || null };
}

async function view(assignments, repId) {
  const bdr = bdrForRep(assignments, repId);
  const connection = bdr ? publicConnection(await readBdrConnection(bdr.gmailKey)) : null;
  return { bdr, connection };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const me = await requireRep(req, res);
  if (!me) return;

  const body = req.method === 'POST' ? (req.body || {}) : {};
  const askedRepId = String((req.method === 'GET' ? req.query?.repId : body.repId) || '').trim();
  if (askedRepId && askedRepId !== me.repId && !me.isAdmin) {
    return res.status(403).json({ error: 'You can only manage your own BDR.' });
  }
  const repId = askedRepId || me.repId;
  const sendingEnabled = process.env.BRAD_SENDING_ENABLED === 'true';

  try {
    const assignments = await loadAssignments();

    if (req.method === 'GET') {
      const out = { ...(await view(assignments, repId)), sendingEnabled };
      if (me.isAdmin) {
        const reps = await loadReps();
        out.team = await Promise.all(Object.keys(assignments).map(async id => {
          const b = bdrForRep(assignments, id);
          if (!b) return null;
          const conn = await readBdrConnection(b.gmailKey);
          return { repId: id, repName: reps.find(r => r?.id === id)?.name || id, ...b, connected: !!conn?.encryptedRefreshToken };
        })).then(list => list.filter(Boolean));
      }
      return res.json(out);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    const { action } = body;

    if (action === 'save') {
      const reps = await loadReps();
      const { bdr, error } = validateBdr(body, repId, { assignments, reps });
      if (error) return res.status(400).json({ error });
      const before = bdrForRep(assignments, repId);
      await writeAssignments({ ...assignments, [repId]: { ...bdr, updatedAt: new Date().toISOString() } });
      // Moving to a different mailbox drops the old mailbox's token unless another rep still uses it.
      if (before && before.gmailKey !== bdr.gmailKey) {
        const next = { ...assignments, [repId]: bdr };
        if (!ownerOfBdrKey(next, before.gmailKey)) await deleteBdrConnection(before.gmailKey).catch(() => {});
      }
      return res.json({ ok: true, ...(await view({ ...assignments, [repId]: bdr }, repId)), sendingEnabled });
    }

    const bdr = bdrForRep(assignments, repId);
    if (!bdr) return res.status(400).json({ error: 'Set up your BDR (name and mailbox) first.' });

    if (action === 'connect') {
      if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
        return res.status(500).json({ error: 'Google is not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET).' });
      }
      const url = bdrConnectUrl(req, res, { repId, email: bdr.email, by: me.repId });
      if (!url) return res.status(500).json({ error: 'Session signing key missing on the server.' });
      return res.json({ url });
    }

    if (action === 'test') {
      try {
        const token = await getGmailAccessToken(bdr.gmailKey);
        const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const p = await r.json();
        if (!r.ok) return res.json({ ok: false, error: p.error?.message || 'Gmail profile check failed' });
        const matches = String(p.emailAddress || '').toLowerCase() === bdr.email;
        return res.json({
          ok: matches,
          email: p.emailAddress,
          error: matches ? undefined : `Connected mailbox is ${p.emailAddress}, not ${bdr.email}. Reconnect as ${bdr.email}.`,
        });
      } catch (e) {
        return res.json({ ok: false, error: e.message });
      }
    }

    if (action === 'disconnect') {
      await deleteBdrConnection(bdr.gmailKey);
      return res.json({ ok: true, ...(await view(assignments, repId)), sendingEnabled });
    }

    if (action === 'remove') {
      const next = { ...assignments };
      delete next[repId];
      await writeAssignments(next);
      if (!ownerOfBdrKey(next, bdr.gmailKey)) await deleteBdrConnection(bdr.gmailKey).catch(() => {});
      return res.json({ ok: true, bdr: null, connection: null, sendingEnabled });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[bdr]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
