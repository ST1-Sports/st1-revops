/**
 * POST /api/contacts/segment-facets
 *
 * Given selected sports + states, returns:
 *   byState  — { [stateAbbr]: count } for selected sports across ALL states (landscape view)
 *   titles   — [{ value, count }] distinct title values for contacts in selected states,
 *              NOT sport-filtered — so Athletic Directors and other sport-agnostic roles appear
 *
 * Body: { sports: string[], states: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

const SPORT_ALIASES = {
  'Cross Country': ['XC', 'cross-country'],
  'Track & Field': ['T&F', 'Track and Field'],
}

function buildSportsClause(sports) {
  if (!sports.length) return null
  const terms = []
  for (const sp of sports) {
    const s = (typeof sp === 'string' ? sp : sp?.name || String(sp)).trim()
    const aliases = SPORT_ALIASES[s] || []
    for (const term of [s, ...aliases]) {
      terms.push({ sport: { contains: term, mode: 'insensitive' } })
      terms.push({ title: { contains: term, mode: 'insensitive' } })
    }
  }
  return { OR: terms }
}

function buildStatesClause(states) {
  if (!states.length) return null
  return { OR: states.map(s => ({ state: { contains: (typeof s === 'string' ? s : s?.name || String(s)).trim(), mode: 'insensitive' } })) }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [] } = req.body || {}
  const notUnsub = { NOT: { status: 'unsubscribed' } }

  const sportsClause = buildSportsClause(sports)
  const statesClause = buildStatesClause(states)

  // byState: count per state for selected sports (shows geographic landscape for sport)
  let byState = {}
  if (sportsClause) {
    const rows = await prisma.salesContact.groupBy({
      by: ['state'],
      where: { AND: [notUnsub, sportsClause] },
      _count: { state: true },
    })
    rows.forEach(r => { if (r.state) byState[r.state] = r._count.state })
  }

  // titles: based on STATE only — not sport-filtered
  // This ensures sport-agnostic roles (Athletic Director, Procurement, etc.) always appear
  let titles = []
  if (statesClause) {
    const rows = await prisma.salesContact.groupBy({
      by: ['title'],
      where: { AND: [notUnsub, statesClause] },
      _count: { title: true },
      orderBy: { _count: { title: 'desc' } },
    })
    titles = rows
      .filter(r => r.title && r.title.trim())
      .map(r => ({ value: r.title, count: r._count.title }))
      .slice(0, 60)
  } else if (sportsClause) {
    // No states selected yet — show titles for the sport across all states
    const rows = await prisma.salesContact.groupBy({
      by: ['title'],
      where: { AND: [notUnsub, sportsClause] },
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
