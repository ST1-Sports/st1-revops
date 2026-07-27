/**
 * POST /api/contacts/area-count
 *
 * Returns how many SalesContacts in the DB match a segment's criteria.
 * Used to show "N matching contacts" on each segment card.
 *
 * Match logic: AND across groups — sport group OR'd internally, same for states and roles.
 * e.g. (sport=XC OR sport=Track) AND (state=IA OR state=MN) AND (title contains Coach)
 *
 * Body: { sports: string[], states: string[], roles: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [], roles = [] } = req.body || {}

  const andClauses = [{ NOT: { status: 'unsubscribed' } }]

  if (sports.length) {
    andClauses.push({ OR: sports.map(s => ({ sport: { contains: (typeof s === 'string' ? s : s?.name || String(s)).trim(), mode: 'insensitive' } })) })
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
