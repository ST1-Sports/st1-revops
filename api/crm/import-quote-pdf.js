/**
 * POST /api/crm/import-quote-pdf
 *
 * Read a quote PDF created outside RevOps and return structured fields
 * so the account page can open a deal. Does not rewrite the official
 * quote PDF generator.
 */
import { setCors } from '../_lib/cors.js'
import { normalizeExtractedQuote, parseJsonObject } from '../_lib/quotePdfImport.js'

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
  maxDuration: 60,
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { pdfBase64, pdfName } = req.body || {}
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' })
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1600,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              title: pdfName || 'quote.pdf',
            },
            {
              type: 'text',
              text: 'This is a customer quote or proposal PDF (not a vendor invoice). Extract JSON only: {"quoteNumber":"","customerName":"","contactName":"","total":0,"notes":"","lineItems":[{"name":"","qty":1,"rate":0}]}. Use 0 when a number is missing. Return ONLY the JSON object.',
            },
          ],
        }],
      }),
    })
    if (!r.ok) {
      const txt = await r.text()
      return res.status(502).json({ error: `Could not read PDF: ${r.status} ${txt.slice(0, 160)}` })
    }
    const data = await r.json()
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    const parsed = parseJsonObject(text)
    if (!parsed) return res.status(422).json({ error: 'Could not find quote fields in that PDF' })
    return res.json({ ok: true, ...normalizeExtractedQuote(parsed) })
  } catch (e) {
    console.error('[import-quote-pdf]', e.message)
    return res.status(500).json({ error: e.message })
  }
}
