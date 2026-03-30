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

    // If stored in S3, optionally delete (requires AWS creds)
    if (asset.metadata?.url && process.env.AWS_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET, Key: asset.fileKey }));
      } catch (e) {
        console.error('S3 delete failed:', e.message);
      }
    }

    await prisma.asset.delete({ where: { id } });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
