/**
 * GET /api/crm/deal-lines?dealId=
 * POST /api/crm/deal-lines
 *
 * Read and write quote line items on a Zoho CRM Deal (and its related Quote
 * when one exists). Inventory subforms are attempted first; Description on
 * the deal always carries the same lines so they stay visible in CRM even
 * when Product_Details / Quoted_Items is not enabled on the token.
 */
import { getZohoToken } from '../_lib/zoho-token.js'
import { setCors } from '../_lib/cors.js'
import { zohoCrmHeaders } from '../_lib/zohoCrm.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { filledQuoteLines } from '../../src/lib/quoteLines.js'
import { fetchDealQuoteLines, writeDealQuoteLines } from '../_lib/zohoQuoteLines.js'
import { requireSignedIn } from '../_lib/requireSignedIn.js'

export default async function handler(req, res) {
  setCors(res, 'GET, POST, PUT, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!(await requireSignedIn(req, res))) return
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'GET or POST only' })
  }

  let token
  try { token = await getZohoToken() } catch (err) {
    return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' })
  }
  const headers = zohoCrmHeaders(token)

  if (req.method === 'GET') {
    const dealId = req.query?.dealId
    if (!dealId) return res.status(400).json({ error: 'dealId required' })
    try {
      const data = await fetchDealQuoteLines(dealId, headers)
      return res.json({ ok: true, ...data })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  const { dealId, quoteId, items = [], notes = '', accountName, accountCity, accountState } = req.body || {}
  if (!dealId) return res.status(400).json({ error: 'dealId required' })
  const lines = filledQuoteLines(items)

  try {
    let accountId = null
    if (accountName) {
      try {
        const account = await findOrCreateZohoAccount(
          { name: accountName, city: accountCity, state: accountState },
          headers,
        )
        accountId = account.id
      } catch { /* deal lines still save without a new quote */ }
    }
    const result = await writeDealQuoteLines({
      dealId,
      quoteId: quoteId || null,
      items: lines,
      notes,
      accountId,
      accountName,
      subject: accountName ? `${accountName} — quote` : null,
    }, headers)
    if (!result.ok) return res.status(502).json(result)
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[crm/deal-lines]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
