/**
 * POST /api/contacts/backfill-sport
 *
 * Updates the sport field for existing contacts that have sport=null/"General"
 * within a given state. Useful when contacts were imported without a sport
 * fallback set, leaving them as "General" while the list was clearly T&F etc.
 *
 * Body: { state: "IA", sport: "Track & Field", dryRun?: boolean, onlyGeneral?: boolean }
 *   state       — 2-letter abbreviation to scope the update
 *   sport       — new sport value to apply
 *   dryRun      — default false; if true, returns count without writing
 *   onlyGeneral — default true; if false, overwrites ALL non-null sport values too
 *
 * Returns: { updated, dryRun }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { STATE_NAMES } from '../_lib/stateUtils.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { state, sport, dryRun = false, onlyGeneral = true } = req.body || {}

  if (!state || state.length !== 2 || !STATE_NAMES[state.toUpperCase()]) {
    return res.status(400).json({ error: 'state must be a valid 2-letter abbreviation' })
  }
  if (!sport || typeof sport !== 'string' || !sport.trim()) {
    return res.status(400).json({ error: 'sport is required' })
  }

  const stateUp = state.toUpperCase()

  // Match Iowa contacts in any stored format
  const stateWhere = {
    OR: [
      { state: { equals: stateUp, mode: 'insensitive' } },
      { state: { equals: STATE_NAMES[stateUp], mode: 'insensitive' } },
      { state: { endsWith: `, ${stateUp}`, mode: 'insensitive' } },
      { state: { endsWith: `, ${STATE_NAMES[stateUp]}`, mode: 'insensitive' } },
    ],
  }

  const sportWhere = onlyGeneral
    ? { OR: [{ sport: null }, { sport: '' }, { sport: { equals: 'General', mode: 'insensitive' } }] }
    : {}

  const where = {
    AND: [
      stateWhere,
      ...(onlyGeneral ? [sportWhere] : []),
    ],
  }

  const count = await prisma.salesContact.count({ where })

  if (dryRun) {
    return res.json({ updated: count, dryRun: true })
  }

  const result = await prisma.salesContact.updateMany({
    where,
    data: { sport: sport.trim() },
  })

  return res.json({ updated: result.count, dryRun: false })
}
