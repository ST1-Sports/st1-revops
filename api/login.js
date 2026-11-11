/**
 * POST /api/login — retired. PIN sign-in was replaced by Sign in with Google (which also
 * connects the rep's Gmail), with the emailed code as the fallback. PINs are no longer stored.
 */
import { setCors } from './_lib/cors.js';

export default function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(410).json({ error: 'PIN sign-in was removed. Sign in with Google or an email code.' });
}
