/**
 * POST /api/contacts/import
 *
 * Bulk-upsert contacts into SalesContact (the cold prospect pool).
 * Accepts up to 500 records per call; client batches large files.
 * Deduplicates by email — existing records are skipped (not overwritten).
 *
 * Body: { contacts: [{ email, firstName, lastName, title, school,
 *                      phone, linkedIn, score, segment, notes, source }] }
 * Returns: { added, skipped, total }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

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
      const score = Number.isFinite(Number(c.score)) ? Math.min(Math.max(Number(c.score), 0), 1000) : 0
      const segment = c.segment || (c.priority === 'high' ? 'warm' : 'cold')
      const noteParts = [c.sport, c.state && c.city ? `${c.city}, ${c.state}` : (c.state || c.city), c.notes].filter(Boolean)
      return {
        email:       c.email.trim().toLowerCase().slice(0, 255),
        firstName:   ((c.firstName || '').trim() || null)?.slice(0, 100),
        lastName:    ((c.lastName  || '').trim() || null)?.slice(0, 100),
        title:       ((c.title     || '').trim() || null)?.slice(0, 200),
        companyName: ((c.school || c.companyName || '').trim() || null)?.slice(0, 200),
        phone:       ((c.phone     || '').trim() || null)?.slice(0, 50),
        linkedinUrl: ((c.linkedIn  || c.linkedinUrl || '').trim() || null)?.slice(0, 500),
        source:      (c.source     || 'csv-import').slice(0, 50),
        score,
        segment,
        notes:       (noteParts.join(' · ') || null)?.slice(0, 500),
        status:      'new',
      }
    })

  if (data.length === 0) {
    return res.json({ added: 0, skipped: contacts.length, total: 0 })
  }

  try {
    const result = await prisma.salesContact.createMany({ data, skipDuplicates: true })
    return res.json({ added: result.count, skipped: data.length - result.count, total: data.length })
  } catch (err) {
    console.error('[contacts/import]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
