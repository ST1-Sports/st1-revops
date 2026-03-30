import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { campaignId, productId, productName, productDesc, productPrice } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const prompt = `Generate Meta/Instagram ad copy for ST1 Sports athletic equipment.

Campaign: "${campaign.name}"
Objective: ${campaign.objective}
Audience: ${campaign.audience || 'Athletic Directors and Coaches at K-12 schools'}
${productName ? `Product: ${productName}` : ''}
${productDesc ? `Description: ${productDesc}` : ''}
${productPrice ? `Price: ${productPrice}` : ''}

ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa. Owner: Matt Stone. Brands include Blazer, Gill Athletics, Diamond, Molten, Wilson, DeMarini, FinishLynx.

Return ONLY valid JSON with no markdown fences:
{
  "headline": "primary headline, max 40 chars",
  "subheadline": "supporting line, max 60 chars",
  "cta": "button text (Shop Now / Get Quote / Learn More / Order Today)",
  "badge": "optional badge e.g. NEW or SALE, or null",
  "primary_text_v1": "attention-grabbing variant, max 125 chars",
  "primary_text_v2": "benefit-focused variant, max 125 chars",
  "primary_text_v3": "urgency or social proof variant, max 125 chars",
  "headline_v1": "headline variant A, max 40 chars",
  "headline_v2": "headline variant B, max 40 chars",
  "description": "link description, max 30 chars"
}`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await upstream.json();
  let copyData = {};
  try {
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    copyData = JSON.parse(match ? match[0] : text);
  } catch {
    return res.status(500).json({ error: 'Failed to parse AI response', raw: data });
  }

  const copy = await prisma.copy.create({
    data: {
      campaignId,
      productId: productId ? parseInt(productId) : null,
      headline: copyData.headline ?? null,
      subheadline: copyData.subheadline ?? null,
      cta: copyData.cta ?? null,
      badge: copyData.badge ?? null,
      primary_text_v1: copyData.primary_text_v1 ?? null,
      primary_text_v2: copyData.primary_text_v2 ?? null,
      primary_text_v3: copyData.primary_text_v3 ?? null,
      headline_v1: copyData.headline_v1 ?? null,
      headline_v2: copyData.headline_v2 ?? null,
      description: copyData.description ?? null,
    },
  });

  return res.status(201).json({ copy });
}
