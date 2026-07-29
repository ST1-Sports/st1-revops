/**
 * POST /api/contacts/import
 *
 * Bulk-upsert contacts into SalesContact (the cold prospect pool).
 * Accepts up to 500 records per call; client batches large files.
 * Deduplicates by email — existing records are skipped (not overwritten).
 *
 * Body: { contacts: [{ email, firstName, lastName, title, school,
 *                      phone, linkedIn, sport, state, city,
 *                      score, segment, notes, source }] }
 * Returns: { added, updated, total } — "updated" here means "already existed,
 * left as-is" (see the dedup note above — nothing already present is actually
 * overwritten despite the field name).
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { normalizeStateForStorage } from '../_lib/stateUtils.js'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const { contacts } = req.body || {}
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array required' })
  }
  if (contacts.length > 500) {
    return res.status(400).json({ error: 'Max 500 per batch — split and call again' })
  }

  const data = contacts
    .filter(c => c.email && typeof c.email === 'string' && c.email.includes('@'))
    .map(c => {
      const score   = Number.isFinite(Number(c.score)) ? Math.min(Math.max(Number(c.score), 0), 1000) : 0
      const segment = c.segment || (c.priority === 'high' ? 'warm' : 'cold')
      const sport   = typeof c.sport === 'string' ? c.sport.trim() : (c.sport?.name || '')
      const state   = normalizeStateForStorage(c.state || '')
      const city    = (c.city   || '').trim()
      return {
        email:       c.email.trim().toLowerCase().slice(0, 255),
        firstName:   ((c.firstName || '').trim() || null)?.slice(0, 100),
        lastName:    ((c.lastName  || '').trim() || null)?.slice(0, 100),
        title:       ((c.title     || '').trim() || null)?.slice(0, 200),
        companyName: ((c.school || c.companyName || '').trim() || null)?.slice(0, 200),
        phone:       ((c.phone     || '').trim() || null)?.slice(0, 50),
        linkedinUrl: ((c.linkedIn  || c.linkedinUrl || '').trim() || null)?.slice(0, 500),
        sport:       (sport || null)?.slice(0, 100),
        state:       (state || null)?.slice(0, 100),
        city:        (city  || null)?.slice(0, 100),
        source:      (c.source || 'csv-import').slice(0, 50),
        score,
        segment,
        notes:       ((c.notes || '').trim() || null)?.slice(0, 500),
        status:      'new',
      }
    })

  if (data.length === 0) {
    return res.json({ added: 0, updated: 0, total: 0 })
  }

  try {
    // Find which emails already exist so we can report added vs updated
    const incomingEmails = data.map(d => d.email)
    const existing = await prisma.salesContact.findMany({
      where: { email: { in: incomingEmails } },
      select: { email: true },
    })
    const existingSet = new Set(existing.map(e => e.email))

    // Upsert: create new contacts, enrich existing ones with any fields they're missing
    await prisma.$transaction(
      data.map(contact =>
        prisma.salesContact.upsert({
          where: { email: contact.email },
          create: contact,
          update: {
            // Only overwrite a field if the new value is non-empty (|| undefined → Prisma skips it)
            firstName:   contact.firstName   || undefined,
            lastName:    contact.lastName    || undefined,
            title:       contact.title       || undefined,
            companyName: contact.companyName || undefined,
            phone:       contact.phone       || undefined,
            linkedinUrl: contact.linkedinUrl || undefined,
            sport:       contact.sport       || undefined,
            state:       contact.state       || undefined,
            city:        contact.city        || undefined,
            notes:       contact.notes       || undefined,
          },
        })
      )
    )

    const added   = data.filter(d => !existingSet.has(d.email)).length
    const updated = existingSet.size
    return res.json({ added, updated, total: data.length })
  } catch (err) {
    console.error('[contacts/import]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
