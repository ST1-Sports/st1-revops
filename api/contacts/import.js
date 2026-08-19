/**
 * POST /api/contacts/import
 *
 * Bulk-upsert contacts into SalesContact (the cold prospect pool).
 * Accepts up to 500 records per call; client batches large files.
 * Deduplicates by email — an existing record is enriched (any blank field
 * filled in from the new data) rather than wholesale-overwritten; a
 * non-empty existing field is never clobbered by an incoming one.
 *
 * Body: { contacts: [{ email, firstName, lastName, title, school,
 *                      phone, linkedIn, sport, state, city,
 *                      score, segment, notes, source,
 *                      campaignName, channel, angle, whyNow,
 *                      bradSubject, bradBody, allTouches }] }
 * Returns: { added, updated, total } — "updated" counts records that already
 * existed by email (whether or not any of their blank fields actually got
 * filled in by this call).
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'
import { normalizeStateForStorage } from '../_lib/stateUtils.js'
import { upsertAccountForContact } from '../_lib/accountUtils.js'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

function addLine(lines, label, value) {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : JSON.stringify(value)
  if (text) lines.push(`${label}: ${text}`)
}

function buildNotes(c) {
  const lines = []
  addLine(lines, 'Notes', c.notes)
  addLine(lines, 'Campaign', c.campaignName)
  addLine(lines, 'Channel', c.channel)
  addLine(lines, 'Priority', c.priority)
  addLine(lines, 'Angle', c.angle)
  addLine(lines, 'Action', c.action)
  addLine(lines, 'Why now', c.whyNow || c.personalization)
  addLine(lines, 'Uploaded subject', c.bradSubject || c.emailSubject)
  addLine(lines, 'Uploaded body', c.bradBody || c.emailBody)
  if (Array.isArray(c.allTouches) && c.allTouches.length > 1) {
    addLine(lines, 'Uploaded follow-ups', c.allTouches.slice(1).map((t, i) => `#${i + 2} ${t.subject || ''}\n${t.body || ''}`).join('\n\n'))
  }
  return lines.join('\n').slice(0, 4000)
}

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
      const notes   = buildNotes(c)
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
        notes:       (notes || null),
        status:      'new',
      }
    })

  if (data.length === 0) {
    return res.json({ added: 0, updated: 0, total: 0 })
  }

  // Resolve/create the Account for each row's companyName up front — cheap
  // even when many rows share one company, since the upsert is idempotent.
  await Promise.all(data.map(async d => {
    d.accountId = await upsertAccountForContact(d.companyName, { city: d.city, state: d.state })
  }))

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
            accountId:   contact.accountId   || undefined,
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
