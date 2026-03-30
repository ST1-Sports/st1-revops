import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { campaignId } = req.query;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  const [campaign, copies] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } }),
    prisma.copy.findMany({
      where: { campaignId },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Product', 'Primary Text V1', 'Primary Text V2', 'Primary Text V3',
    'Headline V1', 'Headline V2', 'Description', 'Headline', 'Subheadline', 'CTA', 'Badge',
  ];

  const rows = [
    headers.map(esc).join(','),
    ...copies.map(c => [
      c.product?.name,
      c.primary_text_v1, c.primary_text_v2, c.primary_text_v3,
      c.headline_v1, c.headline_v2,
      c.description, c.headline, c.subheadline, c.cta, c.badge,
    ].map(esc).join(',')),
  ];

  const filename = `${campaign.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-copy.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(rows.join('\r\n'));
}
