/**
 * GET/POST /api/crm/deal-pdf
 *
 * Store an externally created quote PDF next to a deal, outside the
 * main app_state blob so a large file cannot wipe CRM sync.
 *
 * POST { dealId, filename, pdfBase64 }
 * GET  ?dealId=
 */
import { prisma } from '../_lib/prisma.js'
import { setCors } from '../_lib/cors.js'

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
}

const keyFor = (dealId) => `deal_pdf:${dealId}`

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const dealId = req.query?.dealId
    if (!dealId) return res.status(400).json({ error: 'dealId required' })
    try {
      const row = await prisma.setting.findUnique({ where: { key: keyFor(String(dealId)) } })
      if (!row?.value?.pdfBase64) return res.status(404).json({ error: 'No PDF on file for this deal' })
      return res.json({ ok: true, filename: row.value.filename || 'quote.pdf', pdfBase64: row.value.pdfBase64 })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'POST') {
    const { dealId, filename, pdfBase64 } = req.body || {}
    if (!dealId) return res.status(400).json({ error: 'dealId required' })
    if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' })
    try {
      const value = {
        filename: String(filename || 'quote.pdf').slice(0, 180),
        pdfBase64,
        uploadedAt: Date.now(),
      }
      await prisma.setting.upsert({
        where: { key: keyFor(String(dealId)) },
        update: { value },
        create: { key: keyFor(String(dealId)), value },
      })
      return res.json({ ok: true, dealId, filename: value.filename })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  return res.status(405).json({ error: 'GET or POST only' })
}
