/**
 * GET /api/contacts/debug-states
 *
 * Diagnostic: shows distinct state values in DB and counts for Iowa contacts.
 * Temporary — remove after diagnosing the Iowa AD count issue.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 1. All distinct state values stored in the DB
  const stateRows = await prisma.salesContact.groupBy({
    by: ['state'],
    _count: { state: true },
    orderBy: { _count: { state: 'desc' } },
    take: 80,
  })

  // 2. Iowa-ish contacts using every plausible filter
  const [byAbbr, byFull, byContains] = await Promise.all([
    prisma.salesContact.count({ where: { state: { equals: 'IA', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: { equals: 'Iowa', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: { contains: 'iowa', mode: 'insensitive' } } }),
  ])

  // 3. Iowa AD / Activities Director count using each title variant
  const [adExact, adContains, aadContains] = await Promise.all([
    prisma.salesContact.count({
      where: {
        AND: [
          { OR: [{ state: { equals: 'IA', mode: 'insensitive' } }, { state: { equals: 'Iowa', mode: 'insensitive' } }, { state: { contains: 'iowa', mode: 'insensitive' } }] },
          { title: { equals: 'Athletic Director', mode: 'insensitive' } },
        ],
      },
    }),
    prisma.salesContact.count({
      where: {
        AND: [
          { OR: [{ state: { equals: 'IA', mode: 'insensitive' } }, { state: { equals: 'Iowa', mode: 'insensitive' } }, { state: { contains: 'iowa', mode: 'insensitive' } }] },
          { title: { contains: 'Athletic Director', mode: 'insensitive' } },
        ],
      },
    }),
    prisma.salesContact.count({
      where: {
        AND: [
          { OR: [{ state: { equals: 'IA', mode: 'insensitive' } }, { state: { equals: 'Iowa', mode: 'insensitive' } }, { state: { contains: 'iowa', mode: 'insensitive' } }] },
          { title: { contains: 'Activities Director', mode: 'insensitive' } },
        ],
      },
    }),
  ])

  // 4. Sample Iowa contacts — show actual state + title values
  const samples = await prisma.salesContact.findMany({
    where: {
      OR: [
        { state: { equals: 'IA', mode: 'insensitive' } },
        { state: { equals: 'Iowa', mode: 'insensitive' } },
        { state: { contains: 'iowa', mode: 'insensitive' } },
      ],
    },
    select: { state: true, title: true, status: true },
    take: 20,
    orderBy: { updatedAt: 'desc' },
  })

  // 5. Iowa AD titles — show all distinct title values for Iowa contacts
  const iowaTitles = await prisma.salesContact.groupBy({
    by: ['title'],
    where: {
      OR: [
        { state: { equals: 'IA', mode: 'insensitive' } },
        { state: { equals: 'Iowa', mode: 'insensitive' } },
        { state: { contains: 'iowa', mode: 'insensitive' } },
      ],
    },
    _count: { title: true },
    orderBy: { _count: { title: 'desc' } },
    take: 50,
  })

  return res.json({
    stateValues: stateRows.map(r => ({ state: r.state, count: r._count.state })),
    iowaByMethod: { byAbbr, byFull, byContains },
    iowaADs: { adExact, adContains, aadContains },
    sampleIowaContacts: samples,
    iowaTitles: iowaTitles.map(r => ({ title: r.title, count: r._count.title })),
  })
}
