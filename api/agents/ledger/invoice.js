/**
 * POST /api/agents/ledger/invoice
 *
 * Propose-then-confirm invoice flow for Zoho Books.
 *
 * Actions:
 *   draft   — fetch deal + quote from Zoho CRM → resolve/create Books contact
 *             → POST invoice (DRAFT) → write DealInvoice row → return for review
 *   confirm — send invoice in Zoho Books → update local DealInvoice to SENT
 *   status  — return current DealInvoice + live Zoho Books status
 *
 * Also accepts raw Zoho CRM webhook payload (deal.Stage = "Closed Won"),
 * which auto-runs a draft (dryRun: false) for each qualifying deal.
 *
 * dryRun: true (default) returns a preview without writing to Zoho Books or DB.
 */

import { setCors }                       from '../../_lib/cors.js'
import { prisma }                       from '../../_lib/prisma.js'
import { getZohoToken }                 from '../../_lib/zoho-token.js'
import { booksGet, booksPost,
         isPrismaTableMissing }          from '../../_lib/zoho-books.js'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

const CRM   = 'https://www.zohoapis.com/crm/v3'
const NET30 = 30   // default payment terms in days

// ── CRM helpers ───────────────────────────────────────────────────────────────

async function crmGet(path) {
  const token = await getZohoToken()
  const r     = await fetch(`${CRM}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`CRM GET ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

async function fetchDeal(dealId) {
  const data = await crmGet(`/Deals/${dealId}?fields=Deal_Name,Account_Name,Amount,PO_Number,Contact_Email,Email,Owner`)
  return data.data?.[0] || null
}

async function fetchLinkedQuote(dealId) {
  try {
    const data = await crmGet(`/Deals/${dealId}/Quotes?fields=id,Subject,PO_Number,Product_Details,Grand_Total`)
    const quotes = data.data || []
    if (!quotes.length) return null
    // Fetch full quote detail for the most recent one
    const detail = await crmGet(`/Quotes/${quotes[0].id}?fields=Subject,PO_Number,Product_Details,Grand_Total,Account_Name`)
    return detail.data?.[0] || null
  } catch {
    return null
  }
}

// ── Books contact resolver ────────────────────────────────────────────────────

async function resolveContact(accountName, email) {
  // 1. Search by name
  if (accountName) {
    const data = await booksGet(`/contacts?search_text=${encodeURIComponent(accountName)}&contact_type=customer&per_page=5`)
    if (data.contacts?.length) return data.contacts[0].contact_id
  }
  // 2. Search by email
  if (email) {
    const data = await booksGet(`/contacts?email=${encodeURIComponent(email)}&contact_type=customer&per_page=5`)
    if (data.contacts?.length) return data.contacts[0].contact_id
  }
  // 3. Create new contact
  const payload = {
    contact_name: accountName || email || 'Customer',
    contact_type: 'customer',
    ...(email ? { email } : {}),
  }
  const created = await booksPost('/contacts', payload)
  return created.contact?.contact_id || null
}

// ── Line item builder ─────────────────────────────────────────────────────────

function buildLineItems(edgarQuote, crmQuote, dealAmount) {
  // Prefer Edgar quote (has verified costs + GM data)
  if (edgarQuote?.lineItems?.length) {
    return edgarQuote.lineItems
      .filter(li => !li.notFound)
      .map(li => ({
        name:        li.name || 'Item',
        description: li.sku  || '',
        quantity:    Number(li.qty || 1),
        rate:        Number(li.quotedPrice || 0),
      }))
  }

  // Fall back to CRM quote Product_Details
  const products = crmQuote?.Product_Details || []
  if (products.length) {
    return products.map(p => ({
      name:     p.product?.name || p.Product_Name || 'Item',
      quantity: Number(p.Quantity || 1),
      rate:     Number(p.Unit_Price || p.List_Price || 0),
    }))
  }

  // Last resort: single line from deal amount
  return [{ name: 'Athletic Equipment / Services', quantity: 1, rate: Number(dealAmount || 0) }]
}

// ── DRAFT: propose the invoice ────────────────────────────────────────────────

async function createDraft({ crmDealId, crmDealName, crmAccountName, crmEmail, dealAmount, poNumber, edgarQuote, dryRun = true }) {
  let acctName  = crmAccountName || crmDealName || 'Customer'
  let email     = crmEmail || ''
  let amount    = Number(dealAmount || 0)
  let po        = poNumber || ''
  let deal      = null
  let crmQuote  = null
  let quoteRef  = null

  if (crmDealId) {
    try {
      deal     = await fetchDeal(crmDealId)
      acctName = deal.Account_Name?.name || deal.Account_Name || acctName
      email    = (deal.Contact_Email || deal.Email || email).toLowerCase().trim()
      amount   = parseFloat(deal.Amount || amount) || 0
      po       = deal.PO_Number || po
    } catch (e) {
      console.warn('[invoice] fetchDeal:', e.message)
    }

    try {
      crmQuote = await fetchLinkedQuote(crmDealId)
      if (crmQuote) {
        po       = crmQuote.PO_Number || po
        quoteRef = crmQuote.id || null
        if (!amount) amount = parseFloat(crmQuote.Grand_Total || 0) || 0
      }
    } catch { /* no linked quote is fine */ }
  }

  const lineItems   = buildLineItems(edgarQuote, crmQuote, amount)
  const totalAmount = lineItems.reduce((s, li) => s + li.rate * li.quantity, 0)
  const today       = new Date().toISOString().split('T')[0]
  const dueDate     = new Date(Date.now() + NET30 * 86_400_000).toISOString().split('T')[0]

  if (dryRun) {
    return {
      ok:      true,
      dryRun:  true,
      preview: { customerName: acctName, lineItems, poNumber: po, dueDate, total: totalAmount },
      message: `Preview only — confirm to create in Zoho Books`,
    }
  }

  const contactId = await resolveContact(acctName, email)

  const invoicePayload = {
    customer_id:      contactId,
    date:             today,
    due_date:         dueDate,
    payment_terms:    NET30,
    ...(po ? { reference_number: po } : {}),
    line_items: lineItems,
  }

  const invoiceData = await booksPost('/invoices', invoicePayload)
  const inv = invoiceData.invoice || {}

  let dealInvoiceId = null
  try {
    const row = await prisma.dealInvoice.create({
      data: {
        crmDealId:     crmDealId   || `manual-${Date.now()}`,
        crmDealName:   crmDealName || acctName,
        zohoInvoiceId: inv.invoice_id || null,
        quoteRef:      quoteRef || null,
        poNumber:      po || null,
        status:        'DRAFT',
        amountTotal:   inv.total ?? totalAmount,
        dueDate:       new Date(dueDate),
        triggerSource: crmDealId ? 'CRM_WEBHOOK' : 'MANUAL',
      },
    })
    dealInvoiceId = row.id
  } catch (e) {
    if (!isPrismaTableMissing(e)) throw e
    console.warn('[invoice] DealInvoice table not migrated — skipping DB write')
  }

  return {
    ok:            true,
    dryRun:        false,
    action:        'draft',
    zohoInvoiceId: inv.invoice_id    || null,
    invoiceNumber: inv.invoice_number || null,
    status:        'DRAFT',
    customerName:  acctName,
    total:         inv.total ?? totalAmount,
    dueDate,
    dealInvoiceId,
    reviewUrl:     inv.invoice_id ? `https://books.zoho.com/app#/invoices/${inv.invoice_id}` : null,
    message:       `Invoice ${inv.invoice_number || inv.invoice_id} created as DRAFT — click Send to deliver to customer`,
  }
}

// ── CONFIRM: send the invoice ─────────────────────────────────────────────────

async function confirmAndSend(dealInvoiceId) {
  let local
  try {
    local = await prisma.dealInvoice.findUnique({ where: { id: dealInvoiceId } })
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      throw new Error('DealInvoice table not migrated')
    }
    throw e
  }
  if (!local) throw new Error(`DealInvoice ${dealInvoiceId} not found`)
  if (!local.zohoInvoiceId) throw new Error('No Zoho invoice ID — cannot send')
  if (local.status === 'SENT') return { ok: true, status: 'SENT', message: 'Already sent', dealInvoiceId, zohoInvoiceId: local.zohoInvoiceId }

  // Trigger Zoho Books "submit for approval" / email send
  await booksPost(`/invoices/${local.zohoInvoiceId}/email`, {
    send_from_org_email_id: true,
    to_mail_ids: [],   // Books uses the contact's email
  })

  await prisma.dealInvoice.update({
    where: { id: dealInvoiceId },
    data:  { status: 'SENT', updatedAt: new Date() },
  })

  return {
    ok:            true,
    action:        'confirm',
    dealInvoiceId,
    zohoInvoiceId: local.zohoInvoiceId,
    status:        'SENT',
    message:       'Invoice sent to customer',
  }
}

// ── STATUS check ──────────────────────────────────────────────────────────────

async function getInvoiceStatus(dealInvoiceId) {
  try {
    const local = await prisma.dealInvoice.findUnique({ where: { id: dealInvoiceId } })
    if (!local) return { ok: false, error: `DealInvoice ${dealInvoiceId} not found` }

    let liveStatus = null
    if (local.zohoInvoiceId) {
      try {
        const data = await booksGet(`/invoices/${local.zohoInvoiceId}`)
        liveStatus = data.invoice?.status || null
      } catch { /* live status unavailable */ }
    }

    return {
      ok:            true,
      dealInvoiceId: local.id,
      zohoInvoiceId: local.zohoInvoiceId,
      localStatus:   local.status,
      liveStatus,
      amountTotal:   local.amountTotal != null ? Number(local.amountTotal) : null,
      dueDate:       local.dueDate?.toISOString().split('T')[0] || null,
      crmDealName:   local.crmDealName,
    }
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      return { ok: false, error: 'DealInvoice table not migrated' }
    }
    throw e
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  try {
    const body = req.body || {}

    // Zoho CRM webhook passthrough — body.data contains deal records
    const webhookItems = Array.isArray(body.data) ? body.data
                       : body.data                 ? [body.data]
                       : null
    if (webhookItems) {
      const results = []
      for (const item of webhookItems) {
        const stage = item.Stage || item.Deal_Stage
        if (stage !== 'Closed Won') continue
        const result = await createDraft({
          crmDealId:    item.id || item.ID || item.Id,
          crmDealName:  item.Deal_Name || item.Name || '',
          crmAccountName: typeof item.Account_Name === 'object' ? item.Account_Name?.name : item.Account_Name || '',
          crmEmail:     (item.Contact_Email || item.Email || '').toLowerCase().trim(),
          dealAmount:   parseFloat(item.Amount || 0),
          dryRun:       false,
        })
        results.push(result)
      }
      return res.json({ ok: true, invoices: results })
    }

    const { action = 'draft', ...params } = body

    if (action === 'draft') {
      const result = await createDraft(params)
      return res.json(result)
    }

    if (action === 'confirm') {
      if (!params.dealInvoiceId) return res.status(400).json({ error: 'dealInvoiceId required' })
      const result = await confirmAndSend(params.dealInvoiceId)
      return res.json(result)
    }

    if (action === 'status') {
      if (!params.dealInvoiceId) return res.status(400).json({ error: 'dealInvoiceId required' })
      const result = await getInvoiceStatus(params.dealInvoiceId)
      return res.json(result)
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('[invoice]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
