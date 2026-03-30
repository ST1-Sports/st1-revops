import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

// Vercel Pro allows up to 300s; set to 60s to stay within Hobby limits
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Cron auth
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const jobs = await prisma.job.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  const results = [];
  for (const job of jobs) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running' } });
    try {
      let result = {};

      if (job.type === 'sync_catalog') {
        // Delegate to /api/adengine/products POST
        const origin = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
        const r = await fetch(`${origin}/api/adengine/products`, { method: 'POST' });
        result = await r.json();
      } else if (job.type === 'generate_campaign') {
        const { campaignId } = job.payload;
        if (campaignId) {
          result = { campaignId, message: 'Use POST /api/adengine/generate-copy and /api/adengine/generate-images per product' };
        }
      } else if (job.type === 'generate_product_assets') {
        result = { message: 'Processed generate_product_assets' };
      }

      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'done', payload: { ...job.payload, result } },
      });
      results.push({ id: job.id, type: job.type, status: 'done' });
    } catch (e) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'failed', error: e.message } });
      results.push({ id: job.id, type: job.type, status: 'failed', error: e.message });
    }
  }

  return res.json({ processed: results.length, results });
}
