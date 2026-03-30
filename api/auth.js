/**
 * /api/auth — PIN authentication
 *
 * POST { userId: "matt"|"rep2"|"rep3", pin: "..." }
 * Returns { ok: true, userId } on success, 401 on failure.
 *
 * Required env vars:
 *   AUTH_PIN_MATT, AUTH_PIN_REP2, AUTH_PIN_REP3
 */

import { setCors } from './_lib/cors.js';

export default function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, pin } = req.body || {};
  if (!userId || !pin) return res.status(400).json({ error: "userId and pin required" });

  const envKey = `AUTH_PIN_${userId.toUpperCase()}`;
  const expected = process.env[envKey];

  if (!expected) {
    return res.status(500).json({ error: `Auth not configured for user: ${userId}` });
  }

  if (pin !== expected) {
    return res.status(401).json({ error: "Invalid PIN" });
  }

  return res.status(200).json({ ok: true, userId });
}
