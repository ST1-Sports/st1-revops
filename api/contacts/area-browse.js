/**
 * POST /api/contacts/area-browse
 *
 * Returns paginated SalesContacts matching a segment's criteria.
 * Sport matching includes aliases (XC = Cross Country) and also checks the title field.
 *
 * Body: {
 *   sports: string[], states: string[], roles: string[],
 *   page: number, limit: number, stateFilter: string, sportFilter: string
 * }
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

  const {
    sports = [], states = [], roles = [],
    page = 1, limit = 50,
    stateFilter = '', sportFilter = '',
  } = req.body || {}

  const pg = Math.max(1, parseInt(String(page), 10))
  const lm = Math.min(100, Math.max(1, parseInt(String(limit), 10)))

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

  if (stateFilter.trim()) andClauses.push({ state: { contains: stateFilter.trim(), mode: 'insensitive' } })
  if (sportFilter.trim()) andClauses.push({ sport: { contains: sportFilter.trim(), mode: 'insensitive' } })

  const where = andClauses.length === 1 ? andClauses[0] : { AND: andClauses }

  try {
    const [contacts, total] = await Promise.all([
      prisma.salesContact.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        skip:  (pg - 1) * lm,
        take:  lm,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          title: true, companyName: true, phone: true,
          sport: true, state: true, city: true,
          score: true, segment: true, status: true,
          pushedToZoho: true, notes: true, createdAt: true,
        },
      }),
      prisma.salesContact.count({ where }),
    ])
    return res.json({ contacts, total, page: pg, pages: Math.ceil(total / lm) })
  } catch (err) {
    console.error('[contacts/area-browse]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
