import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';
import { OpenAI } from 'openai';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' }, responseLimit: '15mb' },
};

const STYLE_GUIDE = {
  product_only: 'clean professional product shot on white or light grey background, no people, studio lighting',
  lifestyle:    'lifestyle photography with a young athlete using the equipment in a real setting',
  team:         'team of athletes in matching uniforms with the equipment, energetic group shot',
  action:       'dynamic action shot of the equipment being used in live athletic competition',
};

const SCENE_GUIDE = {
  action:    'during athletic competition or intense practice',
  studio:    'in a clean studio with professional commercial lighting',
  outdoor:   'on an outdoor athletic field or all-weather track',
  classroom: 'in a school athletic facility or gym',
};

const SIZE_MAP = {
  meta_square:    '1024x1024',
  meta_landscape: '1792x1024',
  meta_story:     '1024x1792',
};

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const {
    campaignId,
    productId,
    productName,
    imageStyle = 'product_only',
    sceneStyle = 'action',
    platform = 'meta',
    sizeKey = 'meta_square',
  } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const size = SIZE_MAP[sizeKey] || SIZE_MAP.meta_square;
  const imagePrompt = [
    'High quality marketing photography for ST1 Sports athletic equipment brand.',
    productName ? `Featured product: ${productName}.` : 'Athletic equipment.',
    `Visual style: ${STYLE_GUIDE[imageStyle] || STYLE_GUIDE.product_only}.`,
    `Scene: ${SCENE_GUIDE[sceneStyle] || SCENE_GUIDE.action}.`,
    'Brand colors: orange (#F37321) and black.',
    `Suitable for ${platform === 'meta' ? 'Facebook and Instagram' : platform} advertising.`,
    'Professional marketing quality. No text overlays. No watermarks.',
  ].join(' ');

  const openai = new OpenAI({ apiKey: openaiKey });
  let imageB64;
  try {
    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: imagePrompt,
      size,
      quality: 'standard',
      n: 1,
      response_format: 'b64_json',
    });
    imageB64 = response.data[0].b64_json;
  } catch (e) {
    return res.status(500).json({ error: `Image generation failed: ${e.message}` });
  }

  // Store base64 directly in the database (no external storage needed)
  const fileKey = `inline:${Date.now()}`;
  const [w, h] = size.split('x').map(Number);
  const asset = await prisma.asset.create({
    data: {
      campaignId,
      productId: productId || null,
      assetType: 'generated_image',
      width: w,
      height: h,
      templateKey: `gpt-image-1/${imageStyle}/${sceneStyle}`,
      platform,
      variant: 'A',
      fileKey,
      mimeType: 'image/png',
      metadata: {
        prompt: imagePrompt,
        model: 'gpt-image-1',
        size,
        b64: imageB64,
      },
    },
  });

  return res.status(201).json({
    asset,
    imageUrl: `data:image/png;base64,${imageB64}`,
  });
}
