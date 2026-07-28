export const SPORT_ALIASES = {
  'Cross Country': ['XC', 'cross-country'],
  'Track & Field': ['T&F', 'Track and Field'],
}

export function buildSportsClause(sports) {
  if (!sports?.length) return null
  const terms = []
  for (const sp of sports) {
    const s = (typeof sp === 'string' ? sp : sp?.name || String(sp)).trim()
    for (const term of [s, ...(SPORT_ALIASES[s] || [])]) {
      terms.push({ sport: { contains: term, mode: 'insensitive' } })
      terms.push({ title: { contains: term, mode: 'insensitive' } })
    }
  }
  return terms.length ? { OR: terms } : null
}
