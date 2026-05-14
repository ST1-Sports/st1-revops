/**
 * Vercel Serverless Function: POST /api/sponsorship/calculate
 *
 * Reads the SponsorshipConfig singleton (id=1) from the database and runs
 * the sponsorship guarantee calculation. Result is not persisted — call
 * PATCH /api/sessions/:id to save values to a session.
 *
 * Body: { schoolClass, numSports, numAthletes, hasOnlineStore, hasBoosterClub }
 */

import { prisma }                from '../_lib/prisma.js';
import { setCors }               from '../_lib/cors.js';
import { calculateSponsorship }  from '../_lib/sponsorship-calc.js';

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { schoolClass, numSports, numAthletes, hasOnlineStore, hasBoosterClub } = req.body || {};

  if (!schoolClass)              return res.status(400).json({ error: 'schoolClass is required' });
  if (numSports    == null)      return res.status(400).json({ error: 'numSports is required' });
  if (numAthletes  == null)      return res.status(400).json({ error: 'numAthletes is required' });
  if (hasOnlineStore == null)    return res.status(400).json({ error: 'hasOnlineStore is required' });
  if (hasBoosterClub == null)    return res.status(400).json({ error: 'hasBoosterClub is required' });

  const sports   = Number(numSports);
  const athletes = Number(numAthletes);
  if (!Number.isFinite(sports)   || sports   < 0) return res.status(400).json({ error: 'numSports must be a non-negative number' });
  if (!Number.isFinite(athletes) || athletes < 0) return res.status(400).json({ error: 'numAthletes must be a non-negative number' });

  try {
    const dbConfig = await prisma.sponsorshipConfig.findUnique({ where: { id: 1 } });

    // Fall back to seed defaults if not yet seeded
    const config = dbConfig ?? {
      avgOrderValuePerAthlete:    85,
      avgEquipmentOrderPerSport:  400,
      netMarginPct:               0.18,
      givebackPct:                0.30,
      schoolClassConfidence:      { '1A': 0.40, '2A': 0.50, '3A': 0.60, '4A': 0.70, '5A': 0.78, '6A': 0.85 },
      teamStoreRevenuePerAthlete: 35,
      purchaseFrequencyPerYear:   1.5,
      boosterMultiplier:          1.15,
    };

    const result = calculateSponsorship(
      { schoolClass, numSports: sports, numAthletes: athletes, hasOnlineStore: Boolean(hasOnlineStore), hasBoosterClub: Boolean(hasBoosterClub) },
      config,
    );

    return res.status(200).json(result);
  } catch (e) {
    console.error('[sponsorship/calculate] error:', e.message);
    return res.status(e.message.startsWith('Invalid schoolClass') ? 400 : 500).json({ error: e.message });
  }
}
