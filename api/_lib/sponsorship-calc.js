/**
 * Sponsorship guarantee calculator.
 * Pure function — no DB access, no side effects.
 * Server-side only; never imported by frontend code.
 */

const VALID_CLASSES = ['1A', '2A', '3A', '4A', '5A', '6A'];

export function calculateSponsorship(inputs, config) {
  const { schoolClass, numSports, numAthletes, hasOnlineStore, hasBoosterClub } = inputs;

  if (!VALID_CLASSES.includes(schoolClass)) {
    throw new Error(`Invalid schoolClass "${schoolClass}". Must be one of: ${VALID_CLASSES.join(', ')}`);
  }

  const athleteRevenue  = numAthletes * config.avgOrderValuePerAthlete * config.purchaseFrequencyPerYear;
  const equipRevenue    = numSports   * config.avgEquipmentOrderPerSport;
  const storeRevenue    = hasOnlineStore ? numAthletes * config.teamStoreRevenuePerAthlete : 0;
  const boostMult       = hasBoosterClub ? config.boosterMultiplier : 1.0;
  const projectedRevenue = (athleteRevenue + equipRevenue + storeRevenue) * boostMult;
  const netProfit        = projectedRevenue * config.netMarginPct;
  const givebackPool     = netProfit        * config.givebackPct;

  // schoolClassConfidence is a JSON object stored in DB — access by string key
  const confidence    = (config.schoolClassConfidence)[schoolClass] ?? 0;
  const guaranteedMin = Math.round(givebackPool * confidence);
  const upsideMax     = Math.round(givebackPool * 1.0);

  return {
    guaranteedMin,
    upsideMax,
    breakdown: {
      projectedRevenue,
      netProfit,
      givebackPool,
      athleteRevenue,
      equipRevenue,
      storeRevenue,
      confidence,
    },
    configLastUpdated: config.updatedAt,
  };
}
