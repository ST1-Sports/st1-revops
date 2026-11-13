/**
 * POST /api/agents/ledger/invoice
 *
 * Propose-then-confirm invoice flow for Zoho Books.
 *
 * Actions:
 *   draft   — resolve Books customer (exact match only) → map quote lines →
 *             POST invoice (DRAFT) or return the existing one for that quote number
 *   confirm — send invoice in Zoho Books → update local DealInvoice to SENT
 *   status  — return current DealInvoice + live Zoho Books status
 *   audit   — dry-run list of API invoices with the generic fallback line or no
 *             reference_number (never deletes)
 *
 * api/webhooks/zoho.js, Closed Won in RevOps, Finance, chat, and Order Manager
 * all call action:'draft' so they share customer / line / idempotency guards.
 */

import { setCors }                       from '../../_lib/cors.js'
import { prisma }                       from '../../_lib/prisma.js'
import { getZohoToken }                 from '../../_lib/zoho-token.js'
import { booksGet, booksPost,
         isPrismaTableMissing }          from '../../_lib/zoho-books.js'
import { requireInternalSecret }        from '../../_lib/internalAuth.js'
import { bindCaller, requireCaller } from '../../_lib/agentGate.js'
import {
  CustomerResolutionError,
  LineMappingError,
  createGuardedInvoice,
  recordInvoiceSyncFailure,
  listBogusApiInvoices,
} from '../../_lib/booksInvoice.js'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

const CRM = 'https://www.zohoapis.com/crm/v3'

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
  const data = await crmGet(`/Deals/${dealId}?fields=Deal_Name,Account_Name,Amount,PO_Number,Contact_Email,Email,Owner,Description`)
  return data.data?.[0] || null
}

async function fetchLinkedQuote(dealId) {
  try {
    const data = await crmGet(`/Deals/${dealId}/Quotes?fields=id,Subject,Quote_Number,PO_Number,Product_Details,Quoted_Items,Grand_Total,Description,Terms_and_Conditions`)
    const quotes = data.data || []
    if (!quotes.length) return null
    const detail = await crmGet(
      `/Quotes/${quotes[0].id}?fields=Subject,Quote_Number,PO_Number,Product_Details,Quoted_Items,Grand_Total,Account_Name,Description,Terms_and_Conditions`
    )
    return detail.data?.[0] || null
  } catch {
    return null
  }
}

function accountNameOf(deal) {
  const raw = deal?.Account_Name
  if (!raw) return ''
  return typeof raw === 'object' ? (raw.name || '') : String(raw)
}

async function createDraft(params) {
  let crmQuote = params.crmQuote || null
  let deal = null
  let acctName = params.crmAccountName || params.customerName || params.crmDealName || ''
  let email = params.crmEmail || ''
  let po = params.poNumber || ''
  let quoteRef = params.quoteRef || null
  let quoteNumber = params.quoteNumber || ''
  let zohoContactId = params.zohoContactId || params.storedContactId || ''

  if (params.crmDealId) {
    try {
      deal = await fetchDeal(params.crmDealId)
      acctName = accountNameOf(deal) || acctName
      email = (deal?.Contact_Email || deal?.Email || email).toLowerCase().trim()
      po = deal?.PO_Number || po
    } catch (e) {
      console.warn('[invoice] fetchDeal:', e.message)
    }
    try {
      crmQuote = crmQuote || await fetchLinkedQuote(params.crmDealId)
      if (crmQuote) {
        po = crmQuote.PO_Number || po
        quoteRef = crmQuote.id || quoteRef
        quoteNumber = quoteNumber || crmQuote.Quote_Number || ''
      }
    } catch { /* no linked quote is fine — line mapping will fail loudly */ }
  }

  const input = {
    ...params,
    customerName: acctName,
    crmAccountName: acctName,
    crmEmail: email,
    poNumber: po,
    quoteRef,
    quoteNumber,
    zohoContactId,
    crmQuote,
    notes: params.notes || crmQuote?.Description || deal?.Description || '',
    terms: params.terms || crmQuote?.Terms_and_Conditions || '',
    triggerSource: params.triggerSource || (params.crmDealId ? 'CRM_WEBHOOK' : 'MANUAL'),
  }

  try {
    return await createGuardedInvoice(input, { booksGet, booksPost, prisma })
  } catch (err) {
    if (err instanceof CustomerResolutionError || err instanceof LineMappingError) {
      await recordInvoiceSyncFailure(prisma, input, err)
    }
    throw err
  }
}

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

  await booksPost(`/invoices/${local.zohoInvoiceId}/email`, {
    send_from_org_email_id: true,
    to_mail_ids: [],
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
      quoteNumber:   local.quoteNumber,
      syncError:     local.syncError,
    }
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      return { ok: false, error: 'DealInvoice table not migrated' }
    }
    throw e
  }
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!bindCaller(await requireCaller(req, res))) return
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  if (!requireInternalSecret(req, res)) return

  try {
    const body = req.body || {}
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

    if (action === 'audit') {
      const flagged = await listBogusApiInvoices(booksGet)
      return res.json({
        ok: true,
        dryRun: true,
        count: flagged.length,
        invoices: flagged,
        message: flagged.length
          ? `Found ${flagged.length} API invoice(s) with no reference_number or a generic Athletic Equipment / Services line. Nothing was deleted.`
          : 'No matching API invoices found.',
      })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('[invoice]', err.message)
    const status = (err instanceof CustomerResolutionError || err instanceof LineMappingError) ? 422 : 500
    return res.status(status).json({
      ok: false,
      error: err.message,
      code: err.code || null,
      invoiceSyncFailed: !!err.invoiceSyncFailed,
    })
  }
}
