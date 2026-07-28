/**
 * GET /api/contacts/debug-states
 *
 * Diagnoses where geographic data lives (or doesn't) in the DB.
 * Checks state field, city field, and email domain patterns.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { STATE_NAMES } from '../_lib/stateUtils.js'

const STATE_ABBRS = Object.keys(STATE_NAMES)

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const [total, withState, withCity, withCompany] = await Promise.all([
    prisma.salesContact.count(),
    prisma.salesContact.count({ where: { state: { not: null } } }),
    prisma.salesContact.count({ where: { city:  { not: null } } }),
    prisma.salesContact.count({ where: { companyName: { not: null } } }),
  ])

  // How many emails match the K-12 .k12.XX.us pattern?
  const k12Total = await prisma.salesContact.count({
    where: { email: { contains: '.k12.', mode: 'insensitive' } },
  })

  // Sample K-12 emails to confirm format
  const k12Samples = await prisma.salesContact.findMany({
    where: { email: { contains: '.k12.', mode: 'insensitive' } },
    select: { email: true, state: true, city: true, companyName: true },
    take: 10,
  })

  // How many K-12 emails match each state? (.k12.ia.us, .k12.mn.us, etc.)
  const k12ByState = {}
  await Promise.all(
    STATE_ABBRS.map(async abbr => {
      const count = await prisma.salesContact.count({
        where: { email: { contains: `.k12.${abbr.toLowerCase()}.`, mode: 'insensitive' } },
      })
      if (count > 0) k12ByState[abbr] = count
    })
  )

  // Top city values
  const cityRows = await prisma.salesContact.groupBy({
    by: ['city'],
    where: { city: { not: null } },
    _count: { city: true },
    orderBy: { _count: { city: 'desc' } },
    take: 20,
  })

  // 5 sample contacts — every field
  const samples = await prisma.salesContact.findMany({
    take: 5,
    orderBy: { updatedAt: 'desc' },
    select: {
      email: true, firstName: true, lastName: true,
      title: true, companyName: true, sport: true,
      state: true, city: true, source: true,
    },
  })

  return res.json({
    totals: { total, withState, withCity, withCompany, k12EmailsTotal: k12Total },
    k12ByState,
    k12Samples,
    cityValues: cityRows.map(r => ({ city: r.city, count: r._count.city })),
    sampleContacts: samples,
  })
}
