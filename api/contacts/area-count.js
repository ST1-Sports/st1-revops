/**
 * POST /api/contacts/area-count
 *
 * Returns how many SalesContacts in the DB match a segment's criteria.
 * Match logic: AND across groups — each group is internally OR'd.
 * Sport matching includes aliases (XC = Cross Country) and also checks the title field.
 *
 * Body: { sports: string[], states: string[], roles: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

const SPORT_ALIASES = {
  'Cross Country': ['XC', 'cross-country'],
  'Track & Field': ['T&F', 'Track and Field'],
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [], roles = [] } = req.body || {}

  const andClauses = [{ NOT: { status: 'unsubscribed' } }]

  if (sports.length) {
    const sportTerms = []
    for (const sp of sports) {
      const s = (typeof sp === 'string' ? sp : sp?.name || String(sp)).trim()
      const aliases = SPORT_ALIASES[s] || []
      for (const term of [s, ...aliases]) {
        sportTerms.push({ sport: { contains: term, mode: 'insensitive' } })
        sportTerms.push({ title: { contains: term, mode: 'insensitive' } })
      }
    }
    andClauses.push({ OR: sportTerms })
  }

  if (states.length) {
    andClauses.push({ OR: states.map(s => ({ state: { contains: (typeof s === 'string' ? s : s?.name || String(s)).trim(), mode: 'insensitive' } })) })
  }

  if (roles.length) {
    andClauses.push({ OR: roles.map(r => ({ title: { contains: (typeof r === 'string' ? r : r?.name || String(r)).trim(), mode: 'insensitive' } })) })
  }

  const where = andClauses.length === 1 ? andClauses[0] : { AND: andClauses }

  try {
    const count = await prisma.salesContact.count({ where })
    return res.json({ count })
  } catch (err) {
    console.error('[contacts/area-count]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
