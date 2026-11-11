import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { seedRadarConfig } from '../_lib/radar/seed.js';
import { requireRep } from '../_lib/session.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const me = await requireRep(req, res);
  if (!me) return;
  const isAdmin = me.isAdmin;
  if (req.method === 'GET') {
    await seedRadarConfig();
    const vendors = await prisma.radarVendorDomain.findMany({ orderBy: { domain: 'asc' } });
    const hooks = await prisma.radarProgramHook.findMany({ orderBy: { createdAt: 'desc' } });
    return res.json({ vendors, hooks });
  }

  if (!isAdmin) return res.status(403).json({ error: 'admin only' });

  if (req.method === 'POST') {
    const { kind } = req.body || {};
    if (kind === 'vendor') {
      const domain = String(req.body.domain || '').toLowerCase().replace(/^@/, '').trim();
      if (!domain.includes('.')) return res.status(400).json({ error: 'invalid domain' });
      const row = await prisma.radarVendorDomain.upsert({
        where: { domain },
        update: {},
        create: { domain, source: 'manual' },
      });
      return res.json({ ok: true, vendor: row });
    }
    if (kind === 'hook') {
      const data = {
        title: String(req.body.title || '').slice(0, 200),
        body: String(req.body.body || '').slice(0, 1000),
        keywords: Array.isArray(req.body.keywords) ? req.body.keywords : String(req.body.keywords || '').split(',').map(s => s.trim()).filter(Boolean),
        active: req.body.active !== false,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      };
      if (req.body.id) {
        const row = await prisma.radarProgramHook.update({ where: { id: req.body.id }, data });
        return res.json({ ok: true, hook: row });
      }
      const row = await prisma.radarProgramHook.create({ data });
      return res.json({ ok: true, hook: row });
    }
    return res.status(400).json({ error: 'kind must be vendor or hook' });
  }

  if (req.method === 'DELETE') {
    if (req.body?.kind === 'vendor' && req.body.domain) {
      await prisma.radarVendorDomain.delete({ where: { domain: String(req.body.domain).toLowerCase() } }).catch(() => {});
      return res.json({ ok: true });
    }
    if (req.body?.kind === 'hook' && req.body.id) {
      await prisma.radarProgramHook.delete({ where: { id: req.body.id } }).catch(() => {});
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'missing target' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
