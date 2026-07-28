/**
 * GET /api/contacts/debug-states
 *
 * Diagnoses where geographic + sport data lives (or doesn't) in the DB.
 * Returns state distribution, Iowa-specific breakdown, and sport distribution
 * to help identify why Iowa contact counts don't match expectations.
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { STATE_NAMES } from '../_lib/stateUtils.js'

const STATE_ABBRS = Object.keys(STATE_NAMES)

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const [total, withState, withCity, withCompany, withSport] = await Promise.all([
    prisma.salesContact.count(),
    prisma.salesContact.count({ where: { state: { not: null } } }),
    prisma.salesContact.count({ where: { city:  { not: null } } }),
    prisma.salesContact.count({ where: { companyName: { not: null } } }),
    prisma.salesContact.count({ where: { sport: { not: null } } }),
  ])

  // Top 30 state field values (raw, unnormalized) to see what's actually stored
  const stateDistRows = await prisma.salesContact.groupBy({
    by: ['state'],
    _count: { state: true },
    orderBy: { _count: { state: 'desc' } },
    take: 30,
  })

  // Iowa-specific counts: each known storage format for Iowa
  const [iaExact, iaFull, iaCityIA, iaCityIowa, iaNull] = await Promise.all([
    prisma.salesContact.count({ where: { state: { equals: 'IA', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: { equals: 'Iowa', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: { endsWith: ', IA', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: { endsWith: ', Iowa', mode: 'insensitive' } } }),
    prisma.salesContact.count({ where: { state: null } }),
  ])

  // Iowa contacts (any format) — how many have each sport value
  const iowaWhere = {
    OR: [
      { state: { equals: 'IA', mode: 'insensitive' } },
      { state: { equals: 'Iowa', mode: 'insensitive' } },
      { state: { endsWith: ', IA', mode: 'insensitive' } },
      { state: { endsWith: ', Iowa', mode: 'insensitive' } },
    ],
  }
  const iowaSportRows = await prisma.salesContact.groupBy({
    by: ['sport'],
    where: iowaWhere,
    _count: { sport: true },
    orderBy: { _count: { sport: 'desc' } },
    take: 20,
  })
  const iowaTotal = iowaSportRows.reduce((s, r) => s + r._count.sport, 0)

  // Iowa contacts by title (to spot ADs and coaches that might have wrong sport)
  const iowaTitleRows = await prisma.salesContact.groupBy({
    by: ['title'],
    where: iowaWhere,
    _count: { title: true },
    orderBy: { _count: { title: 'desc' } },
    take: 20,
  })

  // How many K-12 emails match each state?
  const k12Total = await prisma.salesContact.count({
    where: { email: { contains: '.k12.', mode: 'insensitive' } },
  })
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

  // 5 sample Iowa contacts to see raw field values
  const iowaContactSamples = await prisma.salesContact.findMany({
    where: iowaWhere,
    take: 5,
    orderBy: { updatedAt: 'desc' },
    select: { email: true, firstName: true, lastName: true, title: true, companyName: true, sport: true, state: true, city: true },
  })

  return res.json({
    totals: { total, withState, withCity, withCompany, withSport, k12EmailsTotal: k12Total },

    // Raw state field distribution — shows EXACTLY what's stored
    stateDistribution: stateDistRows.map(r => ({ value: r.state, count: r._count.state })),

    // Iowa format breakdown — total should match user's imported Iowa count
    iowa: {
      total: iowaTotal,
      byFormat: { 'IA (exact)': iaExact, 'Iowa (full)': iaFull, 'City, IA': iaCityIA, 'City, Iowa': iaCityIowa },
      nullStateTotal: iaNull,  // contacts with NO state — could be Iowa but we can't tell
      bySport: iowaSportRows.map(r => ({ sport: r.sport, count: r._count.sport })),
      byTitle: iowaTitleRows.filter(r => r.title).map(r => ({ title: r.title, count: r._count.title })).slice(0, 15),
      samples: iowaContactSamples,
    },

    k12ByState,
    cityValues: cityRows.map(r => ({ city: r.city, count: r._count.city })),
  })
}
