/**
 * GET /api/contacts
 *
 * Paginated server-side contact browser for the 120k cold prospect pool.
 *
 * Query params:
 *   page         — 1-based page number (default 1)
 *   limit        — records per page (default 50, max 100)
 *   search       — full-text search on email / name / company / title
 *   segment      — filter by segment (warm / cold / etc.)
 *   state        — filter by state abbreviation or name
 *   sport        — filter by sport (partial match)
 *   pushedToZoho — "true" | "false" to filter by Zoho sync status
 *   minScore     — minimum score filter
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' })

  const page     = Math.max(1, parseInt(req.query.page  || '1',   10))
  const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)))
  const search   = (req.query.search  || '').trim()
  const segment  = (req.query.segment || '').trim()
  const stateF   = (req.query.state   || '').trim()
  const sportF   = (req.query.sport   || '').trim()
  const zoho     = req.query.pushedToZoho
  const minScore = req.query.minScore != null ? Number(req.query.minScore) : null

  const where = { NOT: { status: 'unsubscribed' } }

  if (search) {
    where.OR = [
      { email:       { contains: search, mode: 'insensitive' } },
      { firstName:   { contains: search, mode: 'insensitive' } },
      { lastName:    { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
      { title:       { contains: search, mode: 'insensitive' } },
      { state:       { contains: search, mode: 'insensitive' } },
      { city:        { contains: search, mode: 'insensitive' } },
    ]
  }
  if (segment) where.segment = segment
  if (stateF)  where.state   = { contains: stateF, mode: 'insensitive' }
  if (sportF)  where.sport   = { contains: sportF, mode: 'insensitive' }
  if (zoho === 'true')  where.pushedToZoho = true
  if (zoho === 'false') where.pushedToZoho = false
  if (Number.isFinite(minScore)) where.score = { gte: minScore }

  try {
    const [contacts, total] = await Promise.all([
      prisma.salesContact.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        skip:  (page - 1) * limit,
        take:  limit,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          title: true, companyName: true, phone: true,
          sport: true, state: true, city: true,
          score: true, segment: true, status: true,
          pushedToZoho: true, zohoCrmId: true, notes: true,
          source: true, createdAt: true,
        },
      }),
      prisma.salesContact.count({ where }),
    ])

    return res.json({ contacts, total, page, pages: Math.ceil(total / limit) })
  } catch (err) {
    console.error('[contacts/index]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
