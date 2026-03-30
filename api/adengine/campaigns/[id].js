import { prisma } from '../../_lib/prisma.js';
import { logActivity } from '../../_lib/activity.js';
import { setCors } from '../../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        copies: {
          orderBy: { createdAt: 'desc' },
          include: { product: { select: { id: true, name: true } } },
        },
        jobs: { orderBy: { createdAt: 'desc' }, take: 10 },
        channelPlans: true,
        activityLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { assets: true, copies: true, deliverables: true } },
      },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    return res.status(200).json({ campaign });
  }

  // ── PATCH ───────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body;
    const data = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.brief !== undefined) data.brief = body.brief;
    if (body.audience !== undefined) data.audience = body.audience;
    if (body.objective !== undefined) data.objective = body.objective;
    if (body.status !== undefined) data.status = body.status;
    if (body.platforms !== undefined) data.platforms = body.platforms;
    if (body.imageStyle !== undefined) data.imageStyle = body.imageStyle;
    if (body.sceneStyle !== undefined) data.sceneStyle = body.sceneStyle;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;

    const campaign = await prisma.campaign.update({ where: { id }, data });
    await logActivity(id, 'system', 'campaign_updated', data);
    return res.status(200).json({ campaign });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await prisma.campaign.delete({ where: { id } });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
