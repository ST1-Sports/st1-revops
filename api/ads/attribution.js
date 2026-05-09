import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// UTM parameter presets for quick attribution matching
const UTM_SOURCE_MAP = {
  meta:      'facebook',
  google:    'google',
  linkedin:  'linkedin',
  tiktok:    'tiktok',
  microsoft: 'bing',
  youtube:   'youtube',
};

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: fetch attribution records ──────────────────────────────────────
    if (req.method === 'GET') {
      const { limit = 50, platform, dateRange = '30' } = req.query;
      const since = new Date(Date.now() - parseInt(dateRange) * 86400_000);

      const where = {
        created_at: { gte: since },
        ...(platform ? { platform } : {}),
      };

      const records = await prisma.ad_attribution.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take:    parseInt(limit),
      });

      // Aggregate totals
      const totalRevenue     = records.reduce((s, r) => s + (parseFloat(r.attributed_revenue) || 0), 0);
      const byPlatform       = {};
      for (const r of records) {
        if (!byPlatform[r.platform]) byPlatform[r.platform] = { count: 0, revenue: 0 };
        byPlatform[r.platform].count++;
        byPlatform[r.platform].revenue += parseFloat(r.attributed_revenue) || 0;
      }

      return res.status(200).json({ records, totalRevenue, byPlatform, count: records.length });
    }

    // ── POST: create attribution record ─────────────────────────────────────
    if (req.method === 'POST') {
      const {
        platform,
        platformCampaignId,
        platformAdId,
        zohoDealId,
        zohoContactId,
        contactEmail,
        attributedRevenue = 0,
        attributionType   = 'last_click',
        convertedAt,
      } = req.body || {};

      if (!platform) return res.status(400).json({ error: 'platform required' });

      const record = await prisma.ad_attribution.create({
        data: {
          platform,
          platform_campaign_id: platformCampaignId || null,
          platform_ad_id:       platformAdId       || null,
          zoho_deal_id:         zohoDealId         || null,
          zoho_contact_id:      zohoContactId      || null,
          contact_email:        contactEmail        || null,
          attributed_revenue:   parseFloat(attributedRevenue) || 0,
          attribution_type:     attributionType,
          converted_at:         convertedAt ? new Date(convertedAt) : new Date(),
        },
      });

      return res.status(201).json({ record });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    // Graceful fallback if DB not yet migrated
    if (e.code === 'P2021' || e.message?.includes('does not exist')) {
      return res.status(200).json({ records: [], totalRevenue: 0, byPlatform: {}, count: 0, note: 'Run migration 002_ad_hub.sql to enable attribution.' });
    }
    return res.status(500).json({ error: e.message });
  }
}
