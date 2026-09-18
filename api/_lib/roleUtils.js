/**
 * Server-side sport/role inference from a contact's job title, also imported
 * directly by src/pages/RevOps.jsx for its role quick-pick UI (COACH_ROLES) —
 * this file has no server-only dependencies, so it's shared as-is rather than
 * duplicated. inferSportFromTitle here still duplicates RevOps.jsx's own copy
 * (kept in sync by hand) since that one closes over UI-local state.
 */

export const ACCOUNT_SPORTS = ["Football","Basketball","Baseball","Softball","Soccer","Volleyball","Track & Field","Cross Country","Wrestling","Swimming & Diving","Tennis","Golf","Hockey","Lacrosse","Gymnastics","Cheerleading","Dance","Bowling","Badminton","Water Polo","Rowing / Crew"]

export const COACH_ROLES = ["Athletic Director","Head Coach","Assistant Coach","Coach","Other"]

const SPORT_TITLE_PATTERNS = [
  [/track|cross.?country|\bxc\b|t&f/i, "Track & Field"],
  [/football/i, "Football"], [/basketball/i, "Basketball"], [/baseball/i, "Baseball"],
  [/softball/i, "Softball"], [/soccer/i, "Soccer"], [/volleyball/i, "Volleyball"],
  [/wrestling/i, "Wrestling"], [/swim|diving/i, "Swimming & Diving"], [/tennis/i, "Tennis"],
  [/golf/i, "Golf"], [/hockey/i, "Hockey"], [/lacrosse/i, "Lacrosse"], [/gymnastics/i, "Gymnastics"],
  [/cheer/i, "Cheerleading"], [/dance/i, "Dance"], [/bowling/i, "Bowling"], [/badminton/i, "Badminton"],
  [/water polo/i, "Water Polo"], [/rowing|crew/i, "Rowing / Crew"],
]

export function inferSportFromTitle(title) {
  const t = title || ''
  for (const [re, sport] of SPORT_TITLE_PATTERNS) { if (re.test(t)) return sport }
  return null
}

/** Best-effort sport for a contact: trust an already-clean sport field, else infer from title. */
export function resolveSport(sport, title) {
  const s = typeof sport === 'string' ? sport.trim() : ''
  if (s && s !== 'General' && ACCOUNT_SPORTS.includes(s)) return s
  return inferSportFromTitle(title)
}

export function inferRoleFromTitle(title) {
  const t = (title || '').toLowerCase()
  if (/athletic director/.test(t)) return 'Athletic Director'
  if (/head.*coach/.test(t)) return 'Head Coach'
  if (/assistant.*coach|asst\.?.*coach/.test(t)) return 'Assistant Coach'
  if (/coach/.test(t)) return 'Coach'
  return 'Other'
}
