/**
 * Vercel Serverless Function: /api/admin/sponsorship-config
 *
 * GET — returns the SponsorshipConfig singleton (id = 1)
 * PUT — replaces all config fields; sets lastUpdatedBy from request body
 */

import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const config = await prisma.sponsorshipConfig.findUnique({ where: { id: 1 } });
      if (!config) {
        return res.status(404).json({ error: 'Config not seeded. Run: npx prisma db seed' });
      }
      return res.status(200).json({ config });
    } catch (e) {
      console.error('[admin/sponsorship-config] GET error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PUT ─────────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const body = req.body || {};
    const { updatedBy, ...fields } = body;

    const data = {};
    if (fields.avgOrderValuePerAthlete    != null) data.avgOrderValuePerAthlete    = Number(fields.avgOrderValuePerAthlete);
    if (fields.avgEquipmentOrderPerSport  != null) data.avgEquipmentOrderPerSport  = Number(fields.avgEquipmentOrderPerSport);
    if (fields.netMarginPct               != null) data.netMarginPct               = Number(fields.netMarginPct);
    if (fields.givebackPct                != null) data.givebackPct                = Number(fields.givebackPct);
    if (fields.schoolClassConfidence      != null) data.schoolClassConfidence      = fields.schoolClassConfidence;
    if (fields.teamStoreRevenuePerAthlete != null) data.teamStoreRevenuePerAthlete = Number(fields.teamStoreRevenuePerAthlete);
    if (fields.purchaseFrequencyPerYear   != null) data.purchaseFrequencyPerYear   = Number(fields.purchaseFrequencyPerYear);
    if (fields.boosterMultiplier          != null) data.boosterMultiplier          = Number(fields.boosterMultiplier);
    if (updatedBy)                                 data.lastUpdatedBy              = String(updatedBy);

    try {
      const config = await prisma.sponsorshipConfig.upsert({
        where:  { id: 1 },
        update: data,
        create: { id: 1, ...data },
      });
      return res.status(200).json({ config });
    } catch (e) {
      console.error('[admin/sponsorship-config] PUT error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
