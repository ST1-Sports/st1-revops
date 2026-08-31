/**
 * POST /api/crm/quote
 *
 * Builds a customer PDF in RevOps first, then writes what Zoho will accept:
 * Account, Contact, Quote (if the token has Quotes scope), and a Deal so
 * the school shows in open pipeline. A missing Quotes OAuth scope must not
 * block the PDF or the deal.
 *
 * Body: {
 *   customerName, accountCity?, accountState?, contactPerson?, email?,
 *   lineItems: [{name, description?, quantity, rate, cost}],
 *   shippingCost?, notes?, validDays?  (default 30)
 * }
 */
import { getZohoToken } from '../_lib/zoho-token.js'
import { setCors }      from '../_lib/cors.js'
import { generateQuotePdf } from '../_lib/quotePdf.js'
import { findOrCreateZohoAccount } from '../_lib/zohoAccount.js'
import { findOrCreateZohoContact } from '../_lib/zohoContact.js'
import { createZohoDeal, isScopeError } from '../_lib/zohoDeal.js'
import { CRM_BASE, zohoCrmHeaders, zohoCrmCreateRecord, zohoRecordId, zohoRecordError } from '../_lib/zohoCrm.js'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

function localQuoteNumber(dateStr) {
  const stamp = String(dateStr || '').replace(/-/g, '')
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ST1-${stamp}-${tail}`
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' })

  if (req.method === 'GET') {
    let token
    try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' }) }
    const headers = zohoCrmHeaders(token)
    try {
      const fields = ['Subject', 'Account_Name', 'Quote_Stage', 'Valid_Till', 'Created_Time', 'Grand_Total', 'Total_Dealer_Cost', 'Gross_Profit', 'GP_Percent'].join(',')
      const r = await fetch(`${CRM_BASE}/Quotes?fields=${fields}&sort_by=Created_Time&sort_order=desc&per_page=50`, { headers })
      const data = await r.json().catch(() => null)
      if (!r.ok && r.status !== 204) return res.status(r.status).json({ error: data?.message || 'Failed to list quotes' })
      return res.json({ quotes: data?.data || [] })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  const {
    customerName, accountCity, accountState, contactPerson, email,
    lineItems = [], shippingCost = 0, notes = '', validDays = 30,
  } = req.body || {}

  if (!customerName)    return res.status(400).json({ error: 'customerName required' })
  if (!lineItems.length) return res.status(400).json({ error: 'lineItems required' })

  let token
  try { token = await getZohoToken() } catch (err) { return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' }) }
  const headers = zohoCrmHeaders(token)

  const subtotal    = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.rate) || 0), 0)
  const totalCost   = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.cost)  || 0), 0) + Number(shippingCost || 0)
  const grossProfit = subtotal - totalCost
  const gpPercent    = subtotal > 0 ? (grossProfit / subtotal) * 100 : 0
  const today     = new Date()
  const dateStr   = today.toISOString().slice(0, 10)
  const validTill = new Date(today.getTime() + Number(validDays || 30) * 86_400_000).toISOString().slice(0, 10)
  const itemBlock = lineItems.map(li => {
    const qty = Number(li.quantity) || 1
    const rate = Number(li.rate) || 0
    return `• ${li.name || 'Item'} × ${qty} @ $${rate.toFixed(2)} = $${(qty * rate).toFixed(2)}`
  }).join('\n')
  const description = [notes, itemBlock, `Subtotal: $${subtotal.toFixed(2)}`].filter(Boolean).join('\n\n')

  let accountId = null
  let accountCreated = false
  let contactId = null
  let quoteId = null
  let quoteNumber = localQuoteNumber(dateStr)
  let quoteError = null
  let dealId = null
  let dealError = null
  let attachmentOk = false

  try {
    const account = await findOrCreateZohoAccount(
      { name: customerName, city: accountCity, state: accountState }, headers
    )
    accountId = account.id
    accountCreated = account.created
  } catch (err) {
    quoteError = err.message
  }

  if (contactPerson || email) {
    try {
      const contact = await findOrCreateZohoContact({ fullName: contactPerson, email, accountId }, headers)
      contactId = contact.id
      if (contact.error && !quoteError) quoteError = contact.error
    } catch (err) {
      if (!quoteError) quoteError = err.message
    }
  }

  if (accountId) {
    const quotePayload = {
      Subject:           `${customerName} — ${dateStr}`,
      Account_Name:      { id: accountId },
      Valid_Till:        validTill,
      Description:       description,
      Total_Dealer_Cost: Number(totalCost.toFixed(2)),
      Total_Shipping:    Number(Number(shippingCost || 0).toFixed(2)),
      Gross_Profit:      Number(grossProfit.toFixed(2)),
      GP_Percent:        Number(gpPercent.toFixed(2)),
      Quoted_Items: lineItems.map(li => ({
        Product_Name: li.name || 'Item',
        Quantity:     Number(li.quantity) || 1,
        List_Price:   Number(li.rate) || 0,
      })),
    }
    const attempts = [
      quotePayload,
      (({ Quoted_Items, ...rest }) => rest)(quotePayload),
      (({ Quoted_Items, Total_Dealer_Cost, Total_Shipping, Gross_Profit, GP_Percent, ...rest }) => rest)(quotePayload),
      { Subject: quotePayload.Subject, Account_Name: quotePayload.Account_Name, Description: description, Valid_Till: validTill },
    ]
    let rec = null
    for (const payload of attempts) {
      rec = await zohoCrmCreateRecord('Quotes', payload, headers)
      if (rec?.status !== 'error' && zohoRecordId(rec)) break
      if (isScopeError(rec)) break
    }
    quoteId = zohoRecordId(rec)
    if (!quoteId) {
      quoteError = zohoRecordError(rec, 'Zoho Quotes is not available on this token — PDF and deal still created')
    } else {
      try {
        const numRes = await fetch(`${CRM_BASE}/Quotes/${quoteId}?fields=Quote_Number`, { headers })
        const numData = await numRes.json().catch(() => null)
        quoteNumber = numData?.data?.[0]?.Quote_Number || quoteId
      } catch { /* keep local number */ }
    }
  }

  let pdfBase64 = null
  try {
    const pdfBytes = await generateQuotePdf({
      quoteNumber, date: dateStr, validUntil: validTill,
      customerName, contactPerson, lineItems, notes,
    })
    pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    if (quoteId) {
      const form = new FormData()
      form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), `Quote-${quoteNumber}.pdf`)
      const attachRes = await fetch(`${CRM_BASE}/Quotes/${quoteId}/Attachments`, {
        method:  'POST',
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        body:    form,
      })
      const attachData = await attachRes.json().catch(() => null)
      attachmentOk = attachRes.ok && attachData?.data?.[0]?.status !== 'error'
    }
  } catch (err) {
    console.error('[crm/quote] PDF generation failed:', err.message)
    return res.status(500).json({ error: `Could not build the quote PDF: ${err.message}` })
  }

  try {
    const deal = await createZohoDeal({
      dealName: `${customerName} — ${quoteNumber}`,
      amount: subtotal,
      stage: 'Quoted',
      description,
      accountId,
      contactId,
    }, headers)
    dealId = deal.id
    if (!dealId) dealError = zohoRecordError(deal.rec, 'Zoho deal was not created')
  } catch (err) {
    dealError = err.message
  }

  return res.json({
    ok: true,
    quoteId,
    quoteNumber,
    accountId,
    accountCreated,
    contactId,
    dealId,
    attachmentOk,
    pdfBase64,
    total: subtotal,
    quoteError,
    dealError,
    reviewUrl: quoteId ? `https://crm.zoho.com/crm/tab/Quotes/${quoteId}` : (dealId ? `https://crm.zoho.com/crm/tab/Deals/${dealId}` : null),
  })
}
