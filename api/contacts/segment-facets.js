/**
 * POST /api/contacts/segment-facets
 *
 * Given selected sports + states, returns:
 *   byState  — { [stateAbbr]: count } for selected sports across ALL states.
 *              Keys are normalized to 2-letter abbreviations.
 *   titles   — [{ value, count }] distinct title values for contacts in selected
 *              states (state-only filter — Athletic Directors always appear).
 *
 * Body: { sports: string[], states: string[] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { buildStatesClause, toStateAbbr, STATE_NAMES } from '../_lib/stateUtils.js'
import { buildSportsClause } from './_shared.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { sports = [], states = [] } = req.body || {}
  const notUnsub = { NOT: { status: 'unsubscribed' } }

  const sportsClause = buildSportsClause(sports)
  const statesClause = buildStatesClause(states)

  // byState: count per state for selected sports — normalized to 2-letter abbreviations
  let byState = {}
  if (sportsClause) {
    const rows = await prisma.salesContact.groupBy({
      by: ['state'],
      where: { AND: [notUnsub, sportsClause] },
      _count: { state: true },
    })
    rows.forEach(r => {
      if (!r.state) return
      const abbr = toStateAbbr(r.state) || r.state
      byState[abbr] = (byState[abbr] || 0) + r._count.state
    })
  }

  // titles: state-only filter so sport-agnostic roles (Athletic Director etc.) always appear
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
