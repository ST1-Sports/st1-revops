/**
 * POST /api/login — { repId, pin } → { ok: true, repId } | 401
 *
 * Verifies a user's PIN against the appUsers list stored server-side in the
 * app_state Setting row. This is the ONLY place a PIN is ever compared — the
 * PIN itself never reaches the browser: /api/state's GET redacts appUsers[].pin
 * from the payload it returns, so a not-yet-authenticated client can see who
 * to pick from but can't read (or brute-force offline) anyone's actual PIN.
 */

import { timingSafeEqual } from 'crypto';
import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { repId, pin } = req.body || {};
  if (!repId || !pin) return res.status(400).json({ error: 'repId and pin required' });

  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'app_state' } });
    const appUsers = Array.isArray(setting?.value?.appUsers) ? setting.value.appUsers : [];
    const user = appUsers.find(u => u?.repId === repId);

    if (!user?.pin || !safeEqual(pin, user.pin)) {
      return res.status(401).json({ ok: false, error: 'Invalid PIN' });
    }

    return res.status(200).json({ ok: true, repId });
  } catch (e) {
    console.error('[login] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
