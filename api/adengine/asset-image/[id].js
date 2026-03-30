import { prisma } from '../../_lib/prisma.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).end();

  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { metadata: true, mimeType: true },
  });
  if (!asset) return res.status(404).end();

  // External URL (Ideogram CDN) — proxy it so render-ad.jsx can use it cross-origin
  if (asset.metadata?.url) {
    const r = await fetch(asset.metadata.url);
    if (!r.ok) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', asset.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.end(buf);
  }

  // Base64 inline (gpt-image-1 fallback)
  if (asset.metadata?.b64) {
    const buf = Buffer.from(asset.metadata.b64, 'base64');
    res.setHeader('Content-Type', asset.mimeType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(buf);
  }

  return res.status(404).end();
}
