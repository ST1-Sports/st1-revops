/**
 * /api/intel — Research & Intel library persistence
 *
 * GET  → { items: [...] } saved research entries, most recent first
 * POST { action: "save",   item: {id,query,output,savedAt} } → upsert, capped at 50
 * POST { action: "delete", id } → remove one entry
 *
 * Backed by the Setting model (key "intel_library") — same pattern as
 * /api/state, just its own row rather than folded into the main app-state
 * blob. Previously this data (CommandCenter's "Research & Intel" module)
 * lived only in localStorage with no database backing at all.
 */

import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';

const KEY = 'intel_library';
const MAX_ITEMS = 50;

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const setting = await prisma.setting.findUnique({ where: { key: KEY } });
      return res.json({ items: Array.isArray(setting?.value) ? setting.value : [] });
    } catch (e) {
      console.error('[intel] GET error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const { action, item, id } = req.body || {};
    try {
      const setting = await prisma.setting.findUnique({ where: { key: KEY } });
      let items = Array.isArray(setting?.value) ? setting.value : [];

      if (action === 'delete') {
        if (id == null) return res.status(400).json({ error: 'id required' });
        items = items.filter(i => i.id !== id);
      } else {
        if (!item || typeof item !== 'object') return res.status(400).json({ error: 'item required' });
        const entry = {
          id:      item.id ?? Date.now(),
          query:   String(item.query || '').slice(0, 2000),
          output:  String(item.output || '').slice(0, 20000),
          savedAt: item.savedAt || new Date().toISOString(),
        };
        items = [entry, ...items.filter(i => i.id !== entry.id)].slice(0, MAX_ITEMS);
      }

      await prisma.setting.upsert({
        where:  { key: KEY },
        update: { value: items },
        create: { key: KEY, value: items },
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[intel] POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
