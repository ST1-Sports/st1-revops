/**
 * GET  /api/sponsorship/config  — return current SponsorshipConfig (or defaults)
 * PATCH /api/sponsorship/config — update the SponsorshipConfig singleton (id=1)
 */

import { prisma }   from '../_lib/prisma.js';
import { setCors }  from '../_lib/cors.js';

const DEFAULTS = {
  avgOrderValuePerAthlete:    85,
  avgEquipmentOrderPerSport:  400,
  netMarginPct:               0.18,
  givebackPct:                0.30,
  schoolClassConfidence:      { '1A': 0.40, '2A': 0.50, '3A': 0.60, '4A': 0.70, '5A': 0.78, '6A': 0.85 },
  teamStoreRevenuePerAthlete: 35,
  purchaseFrequencyPerYear:   1.5,
  boosterMultiplier:          1.15,
};

export default async function handler(req, res) {
  setCors(res, 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const row = await prisma.sponsorshipConfig.findUnique({ where: { id: 1 } });
      return res.status(200).json({ config: row ?? { id: 1, ...DEFAULTS, lastUpdatedBy: null } });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const {
      avgOrderValuePerAthlete,
      avgEquipmentOrderPerSport,
      netMarginPct,
      givebackPct,
      schoolClassConfidence,
      teamStoreRevenuePerAthlete,
      purchaseFrequencyPerYear,
      boosterMultiplier,
      lastUpdatedBy,
    } = req.body || {};

    try {
      const data = {};
      if (avgOrderValuePerAthlete    != null) data.avgOrderValuePerAthlete    = Number(avgOrderValuePerAthlete);
      if (avgEquipmentOrderPerSport  != null) data.avgEquipmentOrderPerSport  = Number(avgEquipmentOrderPerSport);
      if (netMarginPct               != null) data.netMarginPct               = Number(netMarginPct);
      if (givebackPct                != null) data.givebackPct                = Number(givebackPct);
      if (teamStoreRevenuePerAthlete != null) data.teamStoreRevenuePerAthlete = Number(teamStoreRevenuePerAthlete);
      if (purchaseFrequencyPerYear   != null) data.purchaseFrequencyPerYear   = Number(purchaseFrequencyPerYear);
      if (boosterMultiplier          != null) data.boosterMultiplier          = Number(boosterMultiplier);
      if (schoolClassConfidence      != null) data.schoolClassConfidence      = schoolClassConfidence;
      if (lastUpdatedBy              != null) data.lastUpdatedBy              = lastUpdatedBy;

      const row = await prisma.sponsorshipConfig.upsert({
        where:  { id: 1 },
        update: data,
        create: { id: 1, ...DEFAULTS, ...data },
      });
      return res.status(200).json({ ok: true, config: row });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'GET or PATCH only' });
}
