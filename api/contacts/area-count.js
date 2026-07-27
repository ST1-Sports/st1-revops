/**
 * POST /api/contacts/area-count
 *
 * Counts SalesContacts matching a segment's criteria using AND-across-groups logic.
 * Handles state stored as abbreviation ("IA"), full name ("Iowa"), or "City, IA".
 * Sport matching includes aliases (XC = Cross Country) and checks the title field.
 *
 * Body: { sports: string[], states: string[], roles: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { buildStatesClause } from '../_lib/stateUtils.js'

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
      for (const term of [s, ...(SPORT_ALIASES[s] || [])]) {
        sportTerms.push({ sport: { contains: term, mode: 'insensitive' } })
        sportTerms.push({ title: { contains: term, mode: 'insensitive' } })
      }
    }
    andClauses.push({ OR: sportTerms })
  }

  const statesClause = buildStatesClause(states)
  if (statesClause) andClauses.push(statesClause)

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
