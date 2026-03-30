import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { campaignId, status, limit = '50' } = req.query;
    const where = {};
    if (campaignId) where.campaignId = campaignId;
    if (status) where.status = status;
    const jobs = await prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });
    return res.json({ jobs });
  }

  if (req.method === 'POST') {
    const { type, payload, campaignId } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    const validTypes = ['sync_catalog', 'generate_campaign', 'generate_product_assets'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
    const job = await prisma.job.create({
      data: { type, payload: payload ?? {}, campaignId: campaignId ?? null },
    });
    return res.status(201).json({ job });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
