import { prisma } from '../_lib/prisma.js';
import { logActivity } from '../_lib/activity.js';
import { setCors } from '../_lib/cors.js';
import slugify from 'slugify';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LIST ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { page = '1', pageSize = '20', status, objective } = req.query;
    const where = {};
    if (status) where.status = status;
    if (objective) where.objective = objective;

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(pageSize),
        take: parseInt(pageSize),
        include: {
          _count: { select: { assets: true, copies: true, deliverables: true } },
          activityLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      prisma.campaign.count({ where }),
    ]);
    return res.status(200).json({ items, total });
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body;
    if (!body?.name) return res.status(400).json({ error: 'name is required' });

    const baseSlug = slugify(body.name, { lower: true, strict: true });
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.campaign.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++attempt}`;
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        slug,
        brief: body.brief ?? null,
        audience: body.audience ?? null,
        objective: body.objective ?? 'AWARENESS',
        query: body.query ?? '',
        platforms: body.platforms ?? ['meta'],
        status: 'DRAFT',
        imageStyle: body.imageStyle ?? 'product_only',
        sceneStyle: body.sceneStyle ?? 'action',
        selectedProducts: body.selectedProducts ?? null,
        variantsPerProduct: body.variantsPerProduct ?? 2,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        ownerUserId: body.ownerUserId ?? null,
      },
    });

    await logActivity(campaign.id, body.ownerUserId ?? 'system', 'campaign_created', { name: campaign.name });
    return res.status(201).json({ campaign });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
