/**
 * POST /api/contacts/area-count
 *
 * Returns how many SalesContacts in the DB match a focus area's criteria.
 * Used to show "N matching contacts" on each area card.
 *
 * Body: { sports: string[], states: string[], roles: string[] }
 * Match logic: any contact whose notes contains a sport OR state name,
 * or whose title contains a role keyword.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [], roles = [] } = req.body || {}

  const orClauses = []

  for (const sport of sports) {
    if (sport) orClauses.push({ notes: { contains: sport, mode: 'insensitive' } })
  }
  for (const state of states) {
    const s = typeof state === 'string' ? state : state?.name || String(state)
    if (s) orClauses.push({ notes: { contains: s, mode: 'insensitive' } })
  }
  for (const role of roles) {
    const r = typeof role === 'string' ? role : role?.name || String(role)
    if (r) orClauses.push({ title: { contains: r, mode: 'insensitive' } })
  }

  try {
    const count = await prisma.salesContact.count({
      where: {
        NOT: { status: 'unsubscribed' },
        ...(orClauses.length ? { OR: orClauses } : {}),
      },
    })
    return res.json({ count })
  } catch (err) {
    console.error('[contacts/area-count]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
