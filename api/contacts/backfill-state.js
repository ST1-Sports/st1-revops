/**
 * POST /api/contacts/backfill-state
 *
 * One-time backfill: populates the state field on existing contacts that have
 * null state by extracting it from email domains (.k12.ia.us etc.) and/or
 * normalizing city values that contain state info ("Des Moines, IA").
 *
 * Body: { dryRun?: boolean }  — default false (actually writes)
 * Returns: { updated, skipped, byState, dryRun }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { STATE_NAMES, normalizeStateForStorage } from '../_lib/stateUtils.js'

const STATE_ABBRS = Object.keys(STATE_NAMES)

function extractStateFromEmail(email) {
  if (!email) return null
  const lower = email.toLowerCase()

  // K-12 school email: something@district.k12.ia.us
  const k12Match = lower.match(/\.k12\.([a-z]{2})\./)
  if (k12Match) {
    const abbr = k12Match[1].toUpperCase()
    if (STATE_NAMES[abbr]) return abbr
  }

  // State university / state agency: something@uni.ia.edu or @iowa.edu, @mn.gov etc.
  for (const abbr of STATE_ABBRS) {
    const a = abbr.toLowerCase()
    // @XX.edu, @XX.gov  (exact domain segment)
    if (lower.includes(`@${a}.edu`) || lower.includes(`.${a}.edu`) ||
        lower.includes(`@${a}.gov`) || lower.includes(`.${a}.gov`)) {
      return abbr
    }
  }

  // Named state in domain: @iowa.edu, @minnesota.edu etc.
  const fullNames = Object.entries(STATE_NAMES)
  for (const [abbr, full] of fullNames) {
    const f = full.toLowerCase().replace(/\s+/g, '')
    if (lower.includes(`@${f}.`) || lower.includes(`.${f}.`)) {
      return abbr
    }
  }

  return null
}

function extractStateFromCity(city) {
  if (!city) return null
  return normalizeStateForStorage(city) || null
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const dryRun = req.body?.dryRun === true

  // Process in pages to avoid memory issues
  const PAGE = 500
  let cursor = undefined
  let updated = 0
  let skipped = 0
  const byState = {}
  const updates = []

  while (true) {
    const batch = await prisma.salesContact.findMany({
      where: { state: null },
      select: { id: true, email: true, city: true },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    })

    if (batch.length === 0) break
    cursor = batch[batch.length - 1].id

    for (const contact of batch) {
      const state =
        extractStateFromEmail(contact.email) ||
        extractStateFromCity(contact.city)

      if (state) {
        updates.push({ id: contact.id, state })
        byState[state] = (byState[state] || 0) + 1
        updated++
      } else {
        skipped++
      }
    }
  }

  if (!dryRun && updates.length > 0) {
    // Write in batches of 100 to stay under transaction limits
    const WRITE_BATCH = 100
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const chunk = updates.slice(i, i + WRITE_BATCH)
      await prisma.$transaction(
        chunk.map(u =>
          prisma.salesContact.update({
            where: { id: u.id },
            data:  { state: u.state },
          })
        )
      )
    }
  }

  return res.json({ updated, skipped, byState, dryRun })
}
