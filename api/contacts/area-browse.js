/**
 * POST /api/contacts/area-browse
 *
 * Returns paginated SalesContacts matching a focus area's criteria.
 * Used by the "Browse Contacts" view when a focus area card is selected.
 *
 * Body: {
 *   sports: string[],
 *   states: string[],
 *   roles:  string[],
 *   page:        number  (default 1)
 *   limit:       number  (default 50, max 100)
 *   stateFilter: string  (narrow to a specific state)
 *   sportFilter: string  (narrow to a specific sport)
 * }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

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

  const orClauses = []
  for (const sport of sports) {
    const s = typeof sport === 'string' ? sport.trim() : sport?.name || String(sport)
    if (s) orClauses.push({ sport: { contains: s, mode: 'insensitive' } })
  }
  for (const state of states) {
    const s = typeof state === 'string' ? state.trim() : state?.name || String(state)
    if (s) orClauses.push({ state: { contains: s, mode: 'insensitive' } })
  }
  for (const role of roles) {
    const r = typeof role === 'string' ? role.trim() : role?.name || String(role)
    if (r) orClauses.push({ title: { contains: r, mode: 'insensitive' } })
  }

  const andClauses = [{ NOT: { status: 'unsubscribed' } }]
  if (orClauses.length) andClauses.push({ OR: orClauses })
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
