import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LIST ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { campaignId, platform, limit = '50' } = req.query;
    const where = {};
    if (campaignId) where.campaignId = campaignId;
    if (platform) where.platform = platform;

    const assets = await prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: { product: { select: { id: true, name: true, main_image_url: true } } },
    });

    // Attach displayUrl from metadata so the client doesn't need to parse metadata
    const enriched = assets.map(a => ({
      ...a,
      displayUrl: a.metadata?.url || (a.metadata?.b64 ? `data:${a.mimeType};base64,${a.metadata.b64}` : null),
    }));

    return res.json({ assets: enriched });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return res.status(404).json({ error: 'Not found' });

    await prisma.asset.delete({ where: { id } });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
