/**
 * /api/state — Cross-device app state sync
 *
 * GET  → returns the saved app state from the database
 * POST { state: {...} } → upserts the app state
 *
 * Uses the Setting model with key "app_state".
 * This lets RevOps data (deals, campaigns, contacts, etc.) sync across
 * any device that logs in — instead of being trapped in localStorage.
 */

import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';
import { applyDealTombstones } from '../src/lib/dealTombstone.js';

export const config = {
  api: { bodyParser: { sizeLimit: "8mb" } },
};

// Fields that should never be synced (local-session only)
const EXCLUDE_KEYS = new Set(["currentUserId"]);

function sanitize(state) {
  if (!state || typeof state !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (EXCLUDE_KEYS.has(k)) continue;
    // Trim agent history to last 40 to keep payload reasonable
    if (k === "agentHistory" && Array.isArray(v)) {
      out[k] = v.slice(-40);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const setting = await prisma.setting.findUnique({ where: { key: "app_state" } });
      if (!setting) return res.json({ state: null });
      const raw = setting.value || {};
      const tombs = applyDealTombstones(raw, raw);
      return res.json({ state: { ...raw, ...tombs } });
    } catch (e) {
      console.error("[state] GET error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { state } = req.body || {};
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "state object required" });
    }
    try {
      const clean = sanitize(state);
      const existing = await prisma.setting.findUnique({ where: { key: "app_state" } });
      const previous = existing?.value && typeof existing.value === "object" ? existing.value : {};
      const tombs = applyDealTombstones(clean, previous);
      const value = { ...clean, ...tombs };
      await prisma.setting.upsert({
        where: { key: "app_state" },
        update: { value },
        create: { key: "app_state", value },
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error("[state] POST error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
