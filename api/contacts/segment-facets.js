/**
 * POST /api/contacts/segment-facets
 *
 * Given selected sports + states, returns:
 *   byState  — { [stateAbbr]: count } for selected sports across ALL states (landscape view)
 *   titles   — [{ value, count }] distinct title values for sport AND state combo, sorted by count desc
 *
 * Used by the dynamic segment builder to show live counts per state and real roles from the DB.
 *
 * Body: { sports: string[], states: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [] } = req.body || {}
  const notUnsub = { NOT: { status: 'unsubscribed' } }

  const sportsClause = sports.length
    ? { OR: sports.map(s => ({ sport: { contains: s.trim(), mode: 'insensitive' } })) }
    : null

  // byState: count per state for selected sports only (no state restriction — shows the landscape)
  let byState = {}
  if (sportsClause) {
    const rows = await prisma.salesContact.groupBy({
      by: ['state'],
      where: { AND: [notUnsub, sportsClause] },
      _count: { state: true },
    })
    rows.forEach(r => { if (r.state) byState[r.state] = r._count.state })
  }

  // titles: distinct titles for selected sports AND states (AND logic)
  let titles = []
  const andForTitles = [notUnsub]
  if (sportsClause) andForTitles.push(sportsClause)
  if (states.length) {
    andForTitles.push({ OR: states.map(s => ({ state: { contains: s.trim(), mode: 'insensitive' } })) })
  }

  if (andForTitles.length > 1) {
    const rows = await prisma.salesContact.groupBy({
      by: ['title'],
      where: { AND: andForTitles },
      _count: { title: true },
      orderBy: { _count: { title: 'desc' } },
    })
    titles = rows
      .filter(r => r.title && r.title.trim())
      .map(r => ({ value: r.title, count: r._count.title }))
      .slice(0, 60)
  }

  return res.json({ byState, titles })
}
