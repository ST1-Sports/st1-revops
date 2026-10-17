/**
 * /api/team-store/names — distinct synced Team Store names, for the Account
 * page's "link to a store" picker. GET ?q=foo filters client-side-style
 * (simple substring, case-insensitive) since the full list is small enough
 * to not need a real search index.
 */
import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const rows = await prisma.teamStoreOrder.findMany({
      where: { storeName: { not: null } },
      distinct: ['storeName'],
      select: { storeName: true },
      orderBy: { storeName: 'asc' },
    });
    let names = rows.map(r => r.storeName).filter(Boolean);
    const q = String(req.query?.q || '').trim().toLowerCase();
    if (q) names = names.filter(n => n.toLowerCase().includes(q));
    return res.json({ ok: true, names: names.slice(0, 200) });
  } catch (err) {
    console.error('[team-store/names]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
