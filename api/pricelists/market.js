/**
 * POST /api/pricelists/market — persist competitor / market intel for items.
 * Sourced from Market Pricing scans and uploaded RFP result sheets.
 * Body: { updates: [{ id, marketLow, marketHigh, competitors, recommendation, note, scannedAt }] }
 */
import { setCors } from '../_lib/cors.js'
import { prisma }  from '../_lib/prisma.js'

function nullNum(v) { return v != null && v !== '' ? parseFloat(v) : null }

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { updates } = req.body || {}
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates[] is required' })
  }

  try {
    const ops = updates.map(u =>
      prisma.priceItem.update({
        where: { id: u.id },
        data: {
          marketLow:      nullNum(u.marketLow),
          marketHigh:     nullNum(u.marketHigh),
          competitors:    Array.isArray(u.competitors) ? u.competitors : [],
          recommendation: u.recommendation || null,
          marketNote:     u.note || u.marketNote || null,
          scannedAt:      u.scannedAt ? new Date(u.scannedAt) : new Date(),
        },
      })
    )
    const results = await prisma.$transaction(ops)
    return res.json({ ok: true, count: results.length })
  } catch (err) {
    console.error('[pricelists/market]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
