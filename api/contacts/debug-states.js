/**
 * GET /api/contacts/debug-states
 *
 * Shows what geographic data actually exists in the DB so we know
 * which field(s) to query for state-based segment filtering.
 * Temporary — remove after diagnosing the state issue.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const [totalContacts, withState, withCity, withCompany] = await Promise.all([
    prisma.salesContact.count(),
    prisma.salesContact.count({ where: { state: { not: null } } }),
    prisma.salesContact.count({ where: { city:  { not: null } } }),
    prisma.salesContact.count({ where: { companyName: { not: null } } }),
  ])

  // Distinct non-null state values
  const stateRows = await prisma.salesContact.groupBy({
    by: ['state'],
    where: { state: { not: null } },
    _count: { state: true },
    orderBy: { _count: { state: 'desc' } },
    take: 30,
  })

  // Distinct non-null city values — do they look like "City, ST"?
  const cityRows = await prisma.salesContact.groupBy({
    by: ['city'],
    where: { city: { not: null } },
    _count: { city: true },
    orderBy: { _count: { city: 'desc' } },
    take: 30,
  })

  // City values containing Iowa-ish patterns
  const [cityIA, cityIowa] = await Promise.all([
    prisma.salesContact.count({ where: { city: { endsWith: ', IA', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { city: { contains: 'iowa', mode: 'insensitive' } } }),
  ])

  // 5 sample contacts — every field
  const samples = await prisma.salesContact.findMany({
    take: 5,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      title: true, companyName: true, sport: true,
      state: true, city: true, source: true, segment: true, status: true,
      score: true, notes: true,
    },
  })

  return res.json({
    totals: { totalContacts, withState, withCity, withCompany },
    stateValues: stateRows.map(r => ({ state: r.state, count: r._count.state })),
    cityValues:  cityRows.map(r =>  ({ city:  r.city,  count: r._count.city  })),
    iowaCityMatches: { cityIA, cityIowa },
    sampleContacts: samples,
  })
}
