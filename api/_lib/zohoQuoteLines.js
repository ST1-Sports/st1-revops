import {
  filledQuoteLines,
  quoteLinesDescription,
  quoteLinesFromZohoRecord,
  quoteLinesToZohoProductDetails,
  quoteLinesToZohoQuotedItems,
  quoteLinesTotal,
} from '../../src/lib/quoteLines.js'
import { CRM_BASE, zohoCrmCreateRecord, zohoCrmGetRecord, zohoCrmUpdateRecord, zohoRecordId } from './zohoCrm.js'
import { isScopeError } from './zohoDeal.js'

const DEAL_FIELDS = 'Deal_Name,Amount,Description,Product_Details,Account_Name'
const QUOTE_FIELDS = 'Subject,Quote_Number,Product_Details,Quoted_Items,Grand_Total,Description,Account_Name'

export async function fetchRelatedQuote(dealId, headers) {
  try {
    const res = await fetch(`${CRM_BASE}/Deals/${dealId}/Quotes?fields=id,Subject,Product_Details,Grand_Total,Description`, { headers })
    const data = await res.json().catch(() => null)
    const row = data?.data?.[0]
    if (!row?.id) return null
    const full = await zohoCrmGetRecord('Quotes', row.id, QUOTE_FIELDS, headers)
    return full || row
  } catch {
    return null
  }
}

export async function fetchDealQuoteLines(dealId, headers) {
  const deal = await zohoCrmGetRecord('Deals', dealId, DEAL_FIELDS, headers)
  const quote = await fetchRelatedQuote(dealId, headers)
  const fromQuote = quote ? quoteLinesFromZohoRecord(quote) : []
  const fromDeal = deal ? quoteLinesFromZohoRecord(deal) : []
  const items = fromQuote.length ? fromQuote : fromDeal
  return {
    items,
    quoteId: quote?.id || null,
    amount: Number(quote?.Grand_Total || deal?.Amount || quoteLinesTotal(items) || 0),
    description: deal?.Description || '',
  }
}

function payloadHasLines(payload) {
  return !!(payload?.Product_Details?.length || payload?.Quoted_Items?.length)
}

async function putWithAttempts(module, id, attempts, headers) {
  let last = null
  for (const payload of attempts) {
    last = await zohoCrmUpdateRecord(module, id, payload, headers)
    if (last?.status !== 'error') return { rec: last, payload }
    if (isScopeError(last)) return { rec: last, payload: null }
  }
  return { rec: last, payload: null }
}

export async function writeDealQuoteLines({ dealId, quoteId, items, notes, accountId, accountName, subject }, headers) {
  const lines = filledQuoteLines(items)
  const amount = quoteLinesTotal(lines)
  const description = quoteLinesDescription(lines, notes)
  const quoted = quoteLinesToZohoQuotedItems(lines)
  const products = quoteLinesToZohoProductDetails(lines)
  const amountPayload = { Amount: amount, Description: description }
  let zohoWroteLines = false

  const dealPut = await putWithAttempts('Deals', dealId, [
    { ...amountPayload, Product_Details: products },
    { ...amountPayload, Quoted_Items: quoted },
    amountPayload,
  ], headers)
  const dealRec = dealPut.rec
  const dealOk = dealRec && dealRec.status !== 'error'
  if (dealOk && payloadHasLines(dealPut.payload)) zohoWroteLines = true

  let resolvedQuoteId = quoteId || null
  if (!resolvedQuoteId) {
    const existing = await fetchRelatedQuote(dealId, headers)
    resolvedQuoteId = existing?.id || null
  }

  if (resolvedQuoteId) {
    const quotePut = await putWithAttempts('Quotes', resolvedQuoteId, [
      { Description: description, Quoted_Items: quoted, Grand_Total: amount },
      { Description: description, Product_Details: products, Grand_Total: amount },
      { Description: description },
    ], headers)
    if (quotePut.rec && quotePut.rec.status !== 'error' && payloadHasLines(quotePut.payload)) {
      zohoWroteLines = true
    }
  } else if (accountId && lines.length) {
    const createAttempts = [
      {
        Subject: subject || `${accountName || 'Quote'} — lines`,
        Account_Name: { id: accountId },
        Description: description,
        Quoted_Items: quoted,
        Deal_Name: { id: dealId },
      },
      {
        Subject: subject || `${accountName || 'Quote'} — lines`,
        Account_Name: { id: accountId },
        Description: description,
        Deal_Name: { id: dealId },
      },
    ]
    for (const payload of createAttempts) {
      const rec = await zohoCrmCreateRecord('Quotes', payload, headers)
      const id = zohoRecordId(rec)
      if (id) {
        resolvedQuoteId = id
        if (payloadHasLines(payload)) zohoWroteLines = true
        break
      }
      if (isScopeError(rec)) break
    }
  }

  return {
    ok: !!dealOk,
    items: lines,
    amount,
    quoteId: resolvedQuoteId,
    zohoWroteLines,
    description,
    error: dealOk ? null : (dealRec?.message || 'Zoho deal update failed'),
  }
}
