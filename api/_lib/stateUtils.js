/**
 * State matching utilities shared across segment/contact API endpoints.
 * Handles the reality that contacts in the DB may have state stored as
 * abbreviation ("IA"), full name ("Iowa"), or "City, IA" format.
 */

export const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DC:"District of Columbia",DE:"Delaware",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",IA:"Iowa",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",
  NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",
  NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
  PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
  WA:"Washington",WI:"Wisconsin",WV:"West Virginia",WY:"Wyoming",
}

// Full name → abbreviation (lowercase keys for case-insensitive lookup)
export const STATE_BY_FULL = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbr, full]) => [full.toLowerCase(), abbr])
)

/**
 * Normalize a raw state string (from DB) to its 2-letter abbreviation.
 * Returns the original string if it can't be recognized.
 */
export function toStateAbbr(raw) {
  if (!raw) return null
  const s = raw.trim()
  const up = s.toUpperCase()
  // Already a 2-letter abbreviation
  if (s.length === 2 && STATE_NAMES[up]) return up
  // Full name ("Iowa" → "IA")
  const fromFull = STATE_BY_FULL[s.toLowerCase()]
  if (fromFull) return fromFull
  // "City, IA" or "City IA" — last 2 chars
  const lastTwo = s.slice(-2).toUpperCase()
  if (STATE_NAMES[lastTwo]) return lastTwo
  return s
}

/**
 * Normalize a state string to 2-letter abbreviation for import/storage.
 * Same logic as toStateAbbr but returns empty string instead of fallback.
 */
export function normalizeStateForStorage(raw) {
  const result = toStateAbbr(raw)
  // Only return the result if it's a known 2-letter abbreviation
  return (result && result.length === 2 && STATE_NAMES[result]) ? result : (raw || '')
}

/**
 * Build a Prisma WHERE OR-clause that matches a state value stored in any
 * of the common formats: "IA", "Iowa", "Des Moines, IA", "Des Moines, Iowa".
 */
function stateTerms(rawState) {
  const abbr = toStateAbbr(rawState) || rawState.trim()
  const abbrUp = abbr.toUpperCase()
  const full = STATE_NAMES[abbrUp]
  const terms = []
  // Exact abbreviation
  terms.push({ state: { equals: abbrUp, mode: 'insensitive' } })
  // Full name
  if (full) terms.push({ state: { equals: full, mode: 'insensitive' } })
  // "City, IA" format
  terms.push({ state: { endsWith: `, ${abbrUp}`, mode: 'insensitive' } })
  terms.push({ state: { endsWith: ` ${abbrUp}`, mode: 'insensitive' } })
  // "City, Iowa" format
  if (full) {
    terms.push({ state: { endsWith: `, ${full}`, mode: 'insensitive' } })
    terms.push({ state: { contains: full, mode: 'insensitive' } })
  }
  return terms
}

export function buildStatesClause(states) {
  if (!states.length) return null
  const allTerms = states.flatMap(s =>
    stateTerms(typeof s === 'string' ? s : s?.name || String(s))
  )
  return { OR: allTerms }
}
