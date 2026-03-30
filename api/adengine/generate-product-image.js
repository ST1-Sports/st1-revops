import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// Ideogram aspect ratio codes
const AR_MAP = {
  square:    'ASPECT_1_1',
  landscape: 'ASPECT_16_9',
  story:     'ASPECT_9_16',
};

const AR_DIMS = {
  ASPECT_1_1:  [1080, 1080],
  ASPECT_16_9: [1200, 628],
  ASPECT_9_16: [1080, 1920],
  ASPECT_4_3:  [1200, 900],
  ASPECT_3_4:  [900, 1200],
};

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'IDEOGRAM_API_KEY not configured' });

  const {
    prompt,
    style      = 'REALISTIC',  // REALISTIC | DESIGN | GENERAL | ANIME | AUTO
    sizeKey    = 'square',      // square | landscape | story
    campaignId,
    productId,
  } = req.body;

  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });

  const aspectRatio = AR_MAP[sizeKey] || 'ASPECT_1_1';

  // Prepend ST1 brand context to help Ideogram
  const fullPrompt = `Athletic sports equipment marketing photo. ${prompt} ST1 Sports brand. Professional commercial photography quality. No text, no logos, no watermarks.`;

  const r = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_request: {
        prompt: fullPrompt,
        model: 'V_2_TURBO',
        style_type: style,
        aspect_ratio: aspectRatio,
        magic_prompt_option: 'AUTO',
        num_images: 1,
      },
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    return res.status(r.status).json({ error: `Ideogram API error ${r.status}: ${errText.slice(0, 300)}` });
  }

  const data = await r.json();
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) {
    return res.status(500).json({ error: 'Ideogram returned no image', raw: data });
  }

  // Save to Asset table if campaign context provided
  let asset = null;
  if (campaignId) {
    const [w, h] = AR_DIMS[aspectRatio] || [1080, 1080];
    asset = await prisma.asset.create({
      data: {
        campaignId,
        productId: productId ? parseInt(productId) : null,
        assetType: 'product_photo',
        width: w,
        height: h,
        templateKey: `ideogram-v2/${style}/${aspectRatio}`,
        platform: 'meta',
        variant: 'A',
        fileKey: `ideogram:${Date.now()}`,
        mimeType: 'image/jpeg',
        metadata: {
          url: imageUrl,
          prompt: fullPrompt,
          originalPrompt: prompt,
          model: 'ideogram-v2-turbo',
          style,
          aspectRatio,
        },
      },
    });
  }

  return res.status(201).json({
    imageUrl,
    asset,
    resolvedPrompt: data.data[0]?.prompt || fullPrompt,
  });
}
