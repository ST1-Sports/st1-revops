/**
 * POST /api/agents/ledger/vendor-bill
 *
 * Vendor AP intake flow. Accepts an uploaded PDF, extracts invoice data via
 * Claude, resolves supplier + line items from the price-list DB, assigns COGS
 * category accounts, creates the Bill in Zoho Books, and writes VendorBill /
 * VendorBillLineItem rows.
 *
 * Actions:
 *   extract — Claude reads the PDF and returns a structured preview (always dry)
 *   create  — full flow: extract → create Zoho Books bill → attach PDF → write DB
 *   status  — return current VendorBill + line items from DB
 *
 * Body (extract / create):
 *   { action, pdfBase64, pdfName?, supplierId?, poNumber?, dryRun? }
 * Body (status):
 *   { action: "status", vendorBillId }
 */

import { setCors }      from '../../_lib/cors.js'
import { prisma }       from '../../_lib/prisma.js'
import { getZohoToken } from '../../_lib/zoho-token.js'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG           = process.env.ZOHO_ORG_ID || '899940777'
const BOOKS         = 'https://www.zohoapis.com/books/v3'
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY

const AP_ACCOUNT = '7255504000000000373'  // Accounts Payable

// COGS account IDs per category — children of Cost of Goods Sold (7255504000000034003)
const COGS_ACCOUNTS = {
  baseball:   '7255504000000699383',
  apparel:    '7255504000000669011',
  uniform:    '7255504000000669011',
  't&f':      '7255504000000669003',
  track:      '7255504000000669003',
  field:      '7255504000000669003',
  volleyball: '7255504000000917005',
  vb:         '7255504000000917005',
  basketball: '7255504000001109003',
  tent:       '7255504000001603057',
  signage:    '7255504000001603057',
  banner:     '7255504000001603057',
  eyewear:    '7255504000001358185',
  glasses:    '7255504000001358185',
  shipping:   '7255504000000474421',
  freight:    '7255504000000474421',
  delivery:   '7255504000000474421',
  packaging:  '7255504000000722115',
}

// ── Zoho Books helpers ────────────────────────────────────────────────────────

async function booksHeaders() {
  const token = await getZohoToken()
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

async function booksGet(path) {
  const h   = await booksHeaders()
  const sep = path.includes('?') ? '&' : '?'
  const r   = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, { headers: h })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Books GET ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

async function booksPost(path, body) {
  const h   = await booksHeaders()
  const sep = path.includes('?') ? '&' : '?'
  const r   = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, {
    method: 'POST', headers: h, body: JSON.stringify(body),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Books POST ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

// ── STEP 1 — Extract invoice data via Claude ──────────────────────────────────

async function extractViaClaude(pdfBase64, pdfName) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not configured')

  const system = `You are an AP specialist. Extract structured data from the vendor invoice PDF.
Return valid JSON only — no prose outside the JSON object.

{
  "vendorName":      "exact vendor/supplier name from the invoice",
  "vendorInvoiceNo": "the vendor's invoice number",
  "poNumber":        "PO or reference number if present, else null",
  "invoiceDate":     "YYYY-MM-DD",
  "dueDate":         "YYYY-MM-DD or null",
  "lineItems": [
    {
      "rawDescription": "item description exactly as printed",
      "rawSku":         "SKU/item code if present, else null",
      "quantity":       1,
      "unitCost":       0.00,
      "lineTotal":      0.00
    }
  ],
  "subtotal":   0.00,
  "taxAmount":  0.00,
  "totalAmount": 0.00,
  "notes": "any relevant notes from the invoice, else null"
}`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            title:  pdfName || 'vendor-invoice.pdf',
          },
          { type: 'text', text: 'Extract all invoice data as JSON per the instructions.' },
        ],
      }],
    }),
  })

  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Claude extract: ${r.status} — ${txt.slice(0, 200)}`)
  }

  const data = await r.json()
  const raw  = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const m    = raw.match(/\{[\s\S]*\}/s)
  if (!m) throw new Error('Claude returned no JSON in extraction response')

  return JSON.parse(m[0])
}

// ── STEP 2 — Resolve Supplier from DB ────────────────────────────────────────

async function resolveSupplier(vendorName, supplierIdOverride) {
  if (supplierIdOverride) {
    const s = await prisma.supplier.findUnique({
      where:   { id: supplierIdOverride },
      include: { items: { orderBy: { name: 'asc' } } },
    })
    return s || null
  }

  if (!vendorName) return null

  // Exact match first, then case-insensitive contains
  const candidates = await prisma.supplier.findMany({
    where: {
      active: true,
      OR: [
        { name: { equals: vendorName, mode: 'insensitive' } },
        { name: { contains: vendorName.split(' ')[0], mode: 'insensitive' } },
      ],
    },
    include: { items: { orderBy: { name: 'asc' } } },
    take: 5,
  })

  if (!candidates.length) return null
  // Prefer exact match
  return candidates.find(s => s.name.toLowerCase() === vendorName.toLowerCase()) || candidates[0]
}

// ── STEP 3 — Match line items against PriceItems ──────────────────────────────

function matchScore(item, rawSku, rawDesc) {
  const sku  = (rawSku  || '').toLowerCase().trim()
  const desc = (rawDesc || '').toLowerCase().trim()

  // Exact SKU match
  if (sku && item.sku && item.sku.toLowerCase().trim() === sku) return { confidence: 1.0, reason: 'sku_exact' }

  // SKU contains match (partial SKU)
  if (sku && item.sku && (
    item.sku.toLowerCase().includes(sku) || sku.includes(item.sku.toLowerCase())
  )) return { confidence: 0.85, reason: 'sku_partial' }

  // Description: name exact
  if (desc && item.name.toLowerCase() === desc) return { confidence: 0.9, reason: 'name_exact' }

  // Description: keywords overlap (≥2 words matching)
  const descWords = desc.split(/\s+/).filter(w => w.length > 2)
  const nameWords = item.name.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const hits = descWords.filter(w => nameWords.some(n => n.includes(w) || w.includes(n))).length
  if (hits >= 2) return { confidence: 0.5 + Math.min(hits, 4) * 0.05, reason: 'desc_keywords' }
  if (hits === 1 && descWords.length === 1) return { confidence: 0.6, reason: 'desc_single_word' }

  return null
}

function matchLineItems(supplier, rawItems) {
  if (!supplier?.items?.length) {
    return rawItems.map(li => ({ ...li, needsReview: true, matchConfidence: null }))
  }

  return rawItems.map(li => {
    let best = null, bestItem = null

    for (const item of supplier.items) {
      const score = matchScore(item, li.rawSku, li.rawDescription)
      if (score && (!best || score.confidence > best.confidence)) {
        best     = score
        bestItem = item
      }
    }

    if (best && best.confidence >= 0.5) {
      return {
        ...li,
        matchedPriceItemId: bestItem.id,
        matchedItemName:    bestItem.name,
        matchedItemSku:     bestItem.sku,
        matchedCategory:    bestItem.category,
        matchConfidence:    best.confidence,
        matchReason:        best.reason,
        needsReview:        best.confidence < 0.75,
      }
    }

    return { ...li, needsReview: true, matchConfidence: null }
  })
}

// ── STEP 4 — Assign COGS accounts ────────────────────────────────────────────

async function loadTeamStoreCogs() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'ledger_acct_team_store_cogs' } })
    return row?.value?.accountId || null
  } catch { return null }
}

async function isTeamStorePO(poNumber) {
  if (!poNumber) return false
  try {
    // A PO is tied to a team store if a TeamStore.orgIdentifiers list contains the PO,
    // or if a DealInvoice with matching poNumber has a linked TeamStore deposit.
    // Simple heuristic: check if any TeamStore name appears in the PO string.
    const stores = await prisma.teamStore.findMany({ where: { active: true }, select: { name: true } })
    const po = poNumber.toLowerCase()
    return stores.some(s => po.includes(s.name.toLowerCase().split(' ')[0]))
  } catch { return false }
}

function cogsAccountForCategory(category, teamStoreCogsId, isTeamStore) {
  if (isTeamStore && teamStoreCogsId) return teamStoreCogsId

  if (!category) return null
  const cat = category.toLowerCase()
  for (const [keyword, accountId] of Object.entries(COGS_ACCOUNTS)) {
    if (cat.includes(keyword)) return accountId
  }
  return null  // unmapped → needsReview will stay true
}

function assignCogsAccounts(resolvedItems, teamStoreCogsId, isTeamStore) {
  return resolvedItems.map(li => {
    const cogsAccountId = cogsAccountForCategory(li.matchedCategory, teamStoreCogsId, isTeamStore)
    return {
      ...li,
      cogsAccountId,
      // Force needsReview if we can't resolve a COGS account
      needsReview: li.needsReview || !cogsAccountId,
    }
  })
}

// ── STEP 5 — Resolve vendor in Zoho Books ────────────────────────────────────

async function resolveVendor(vendorName) {
  if (!vendorName) return null

  // Search by name
  const data = await booksGet(
    `/contacts?search_text=${encodeURIComponent(vendorName)}&contact_type=vendor&per_page=5`
  )
  if (data.contacts?.length) return data.contacts[0].contact_id

  // Create vendor contact
  const resp = await booksPost('/contacts', {
    contact_name: vendorName,
    contact_type: 'vendor',
  })
  return resp.contact?.contact_id || null
}

// ── STEP 6 — Create bill in Zoho Books ───────────────────────────────────────

async function createZohoBill(vendorId, extracted, resolvedItems) {
  const today = new Date().toISOString().split('T')[0]

  const mappedItems = resolvedItems
    .filter(li => !li.needsReview)
    .map(li => ({
      account_id:  li.cogsAccountId,
      name:        li.matchedItemName || li.rawDescription,
      description: li.rawDescription,
      quantity:    Number(li.quantity  || 1),
      rate:        Number(li.unitCost  || 0),
    }))

  if (!mappedItems.length) {
    throw new Error('All line items require review — cannot create bill with zero mapped lines')
  }

  const payload = {
    vendor_id:                  vendorId,
    bill_number:                extracted.vendorInvoiceNo || `VB-${Date.now()}`,
    date:                       extracted.invoiceDate || today,
    due_date:                   extracted.dueDate    || today,
    reference_number:           extracted.poNumber   || '',
    accounts_payable_account_id: AP_ACCOUNT,
    line_items:                 mappedItems,
    ...(extracted.notes ? { notes: extracted.notes } : {}),
  }

  const data = await booksPost('/bills', payload)
  return data.bill || {}
}

// ── STEP 7 — Attach PDF to the bill ──────────────────────────────────────────

async function attachPdf(billId, pdfBase64, pdfName) {
  const token   = await getZohoToken()
  const buffer  = Buffer.from(pdfBase64, 'base64')
  const blob    = new Blob([buffer], { type: 'application/pdf' })
  const form    = new FormData()
  form.append('attachment', blob, pdfName || 'vendor-invoice.pdf')

  const r = await fetch(
    `${BOOKS}/bills/${billId}/attachment?organization_id=${ORG}`,
    { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}` }, body: form }
  )
  if (!r.ok) {
    const txt = await r.text()
    console.warn(`[vendor-bill] PDF attach ${billId}: ${r.status} — ${txt.slice(0, 200)}`)
    return null
  }
  const data = await r.json()
  return data.documents?.[0]?.document_id || null
}

// ── STEP 8 — Write DB rows ────────────────────────────────────────────────────

async function writeVendorBill(supplierId, extracted, resolvedItems, zohoBill, fileUrl, dryRun) {
  if (dryRun) return null

  const reviewCount = resolvedItems.filter(li => li.needsReview).length
  const allReview   = reviewCount === resolvedItems.length
  const status      = allReview ? 'NEEDS_REVIEW' : reviewCount > 0 ? 'PENDING_REVIEW' : 'MAPPED'

  try {
    const bill = await prisma.vendorBill.create({
      data: {
        supplierId,
        vendorInvoiceNo: extracted.vendorInvoiceNo || null,
        poNumber:        extracted.poNumber        || null,
        zohoBillId:      zohoBill?.bill_id         || null,
        fileUrl:         fileUrl || zohoBill?.bill_id
                           ? `zoho:bill:${zohoBill?.bill_id}`
                           : `upload:${Date.now()}`,
        status,
        totalAmount:     extracted.totalAmount || null,
      },
    })

    const lineRows = await Promise.all(
      resolvedItems.map(li =>
        prisma.vendorBillLineItem.create({
          data: {
            vendorBillId:       bill.id,
            rawDescription:     li.rawDescription,
            rawSku:             li.rawSku           || null,
            quantity:           Number(li.quantity  || 1),
            unitCost:           Number(li.unitCost  || 0),
            matchedPriceItemId: li.matchedPriceItemId || null,
            matchConfidence:    li.matchConfidence     || null,
            needsReview:        Boolean(li.needsReview),
          },
        })
      )
    )

    return { bill, lineRows }
  } catch (e) {
    if (e.code === 'P2021' || e.message?.includes('does not exist')) {
      console.warn('[vendor-bill] VendorBill table not migrated — skipping DB write')
      return null
    }
    throw e
  }
}

// ── Shared extract + resolve pipeline ────────────────────────────────────────

async function extractAndResolve({ pdfBase64, pdfName, supplierId: supplierIdOverride, poNumber: poOverride }) {
  // 1. Claude PDF extraction
  const extracted = await extractViaClaude(pdfBase64, pdfName)
  if (poOverride) extracted.poNumber = poOverride

  // 2. Supplier resolution
  const supplier = await resolveSupplier(extracted.vendorName, supplierIdOverride)

  // 3. Match line items against PriceItems
  const matched = matchLineItems(supplier, extracted.lineItems || [])

  // 4. Load Team Store COGS + check if PO is team-store-related
  const [teamStoreCogsId, teamStorePO] = await Promise.all([
    loadTeamStoreCogs(),
    isTeamStorePO(extracted.poNumber),
  ])

  // 5. Assign COGS accounts
  const resolvedItems = assignCogsAccounts(matched, teamStoreCogsId, teamStorePO)

  return { extracted, supplier, resolvedItems }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const body   = req.body || {}
  const action = body.action || 'extract'

  try {
    // ── status ──────────────────────────────────────────────────────────────
    if (action === 'status') {
      const { vendorBillId } = body
      if (!vendorBillId) return res.status(400).json({ error: 'vendorBillId required' })

      try {
        const bill = await prisma.vendorBill.findUnique({
          where:   { id: vendorBillId },
          include: { lineItems: true, supplier: { select: { name: true } } },
        })
        if (!bill) return res.json({ ok: false, error: `VendorBill ${vendorBillId} not found` })
        return res.json({
          ok:            true,
          vendorBillId:  bill.id,
          zohoBillId:    bill.zohoBillId,
          status:        bill.status,
          totalAmount:   bill.totalAmount != null ? Number(bill.totalAmount) : null,
          supplierName:  bill.supplier?.name || null,
          lineItems:     bill.lineItems,
        })
      } catch (e) {
        if (e.code === 'P2021' || e.message?.includes('does not exist')) {
          return res.json({ ok: false, error: 'VendorBill table not migrated' })
        }
        throw e
      }
    }

    // ── extract + create ─────────────────────────────────────────────────────
    const { pdfBase64, pdfName, dryRun = true, poNumber: poOverride, supplierId: supplierIdOverride } = body

    if (!pdfBase64) {
      return res.status(400).json({ error: 'pdfBase64 required — upload the vendor invoice PDF' })
    }

    const { extracted, supplier, resolvedItems } = await extractAndResolve({
      pdfBase64,
      pdfName,
      supplierId: supplierIdOverride,
      poNumber:   poOverride,
    })

    const reviewCount = resolvedItems.filter(li => li.needsReview).length
    const mappedCount = resolvedItems.length - reviewCount

    const bill = {
      supplierName:    extracted.vendorName,
      vendorInvoiceNo: extracted.vendorInvoiceNo,
      poNumber:        extracted.poNumber,
      invoiceDate:     extracted.invoiceDate,
      dueDate:         extracted.dueDate,
      totalAmount:     extracted.totalAmount,
      lineItems:       resolvedItems,
      reviewCount,
      mappedCount,
    }

    // ── extract only (dry) ─────────────────────────────────────────────────
    if (action === 'extract' || dryRun) {
      return res.json({
        ok:          true,
        dryRun:      true,
        message:     `Extracted ${resolvedItems.length} line items — ${mappedCount} mapped, ${reviewCount} need review`,
        supplierId:  supplier?.id   || null,
        supplierFound: Boolean(supplier),
        bill,
      })
    }

    // ── create (live) ──────────────────────────────────────────────────────
    if (!supplier) {
      return res.status(422).json({
        ok:      false,
        error:   `Supplier "${extracted.vendorName}" not found in price-list DB — add it first`,
        bill,
      })
    }

    // Resolve vendor in Zoho Books
    const vendorId = await resolveVendor(extracted.vendorName)
    if (!vendorId) {
      return res.status(422).json({
        ok:    false,
        error: `Could not resolve vendor "${extracted.vendorName}" in Zoho Books`,
        bill,
      })
    }

    // Create bill in Zoho Books
    const zohoBill = await createZohoBill(vendorId, extracted, resolvedItems)

    // Attach PDF
    let documentId = null
    if (zohoBill.bill_id) {
      documentId = await attachPdf(zohoBill.bill_id, pdfBase64, pdfName)
    }

    const fileUrl = documentId
      ? `zoho:bill:${zohoBill.bill_id}:doc:${documentId}`
      : `zoho:bill:${zohoBill.bill_id}`

    // Write DB rows
    const dbResult = await writeVendorBill(supplier.id, extracted, resolvedItems, zohoBill, fileUrl, false)

    return res.json({
      ok:           true,
      dryRun:       false,
      action:       'create',
      vendorBillId: dbResult?.bill?.id    || null,
      zohoBillId:   zohoBill.bill_id      || null,
      billNumber:   zohoBill.bill_number  || null,
      status:       dbResult?.bill?.status || 'PENDING_REVIEW',
      reviewUrl:    zohoBill.bill_id
        ? `https://books.zoho.com/app#/bills/${zohoBill.bill_id}`
        : null,
      message: `Bill ${zohoBill.bill_number || zohoBill.bill_id} created — ${mappedCount} lines mapped, ${reviewCount} held for review`,
      bill,
    })

  } catch (err) {
    console.error('[vendor-bill]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
