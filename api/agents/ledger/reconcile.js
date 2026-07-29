/**
 * POST /api/agents/ledger/reconcile
 * { task?, dryRun?: boolean, limit?: number }
 *
 * Ledger reconciliation agent.
 *
 * task values:
 *   "setup"            — idempotently create/verify Zoho Books chart-of-accounts entries
 *   "seed-stores"       — auto-populate TeamStore from Stripe charge history
 *   "configure-card"    — { accountId } — persist which Zoho Books account to poll for
 *                          credit card charges (no fixed ID exists — every org differs)
 *   "reconcile" (default) — pull uncategorized transactions from every configured
 *                          account (deposits: Operating/Stripe/Shopify; expenses:
 *                          Credit Card if configured), propose a coding for each
 *                          (remembered correction → matched invoice/bill/team-store →
 *                          Zoho Books bank rule → nothing), and write them to the
 *                          Deposit table as PENDING_REVIEW. Nothing is pushed to Zoho
 *                          Books at this stage — reconcile only proposes.
 *   "list-pending"      — return all PENDING_REVIEW Deposit rows for the review queue
 *   "accounts-list"     — return the Zoho Books chart of accounts (for a category picker)
 *   "approve"           — { depositId, accountId?, label? } — pushes the (possibly
 *                          edited) categorization into Zoho Books via the bank
 *                          transaction categorize API, marks the Deposit APPROVED,
 *                          and remembers the decision for next time.
 *   "update-suggestion" — { depositId, accountId, label } — edits the proposed
 *                          category without pushing to Zoho yet.
 *
 * Safe defaults: task="reconcile", dryRun=false, limit=10. dryRun=true previews
 * without writing to the Deposit table. Nothing ever reaches Zoho Books itself
 * except via an explicit "approve" call.
 */

import { setCors }                              from '../../_lib/cors.js'
import { prisma }                              from '../../_lib/prisma.js'
import { recall, remember }                    from '../../_lib/memory.js'
import { booksGet, booksPost,
         isPrismaTableMissing }                from '../../_lib/zoho-books.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const STRIPE_KEY      = process.env.STRIPE_SECRET_KEY
const SHOPIFY_URL     = process.env.SHOPIFY_STORE_URL    // e.g. "your-store.myshopify.com"
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN

// Fixed Zoho Books account IDs (never change)
const FIXED = {
  operating:      '7255504000000180097',  // ST1 Operating Account
  ar:             '7255504000000000364',  // Accounts Receivable
  ap:             '7255504000000000373',  // Accounts Payable
  bankFees:       '7255504000000000409',  // Bank Fees and Charges
  stripeClearing: '7255504000000551015',  // Stripe Clearing
}

// Accounts to create idempotently in STEP 0
const ACCT_DEFS = [
  {
    key:      'ledger_acct_team_store_sales',
    name:     'Team Store Sales',
    type:     'income',
    parentId: '7255504000000000391',  // Online Store Sales
  },
  {
    key:      'ledger_acct_team_store_cogs',
    name:     'Team Store COGS',
    type:     'cost_of_goods_sold',
    parentId: '7255504000000034003',  // Cost of Goods Sold
  },
  {
    key:      'ledger_acct_shopify_clearing',
    name:     'Shopify Clearing',
    type:     'payment_clearing',
    parentId: null,
  },
]

// Confidence → Float for Deposit.matchConfidence
const CONF_MAP = { exact: 1.0, high: 0.8, low: 0.4, none: null }

const MEMORY_SCOPE = 'org'
const memoryEntity = (name) => `depositrule:${(name || '').trim().toLowerCase()}`

// ── STEP 0 — Chart of accounts setup (idempotent) ────────────────────────────

async function setupAccounts() {
  const data   = await booksGet('/chartofaccounts?per_page=200')
  const list   = data.chartofaccounts || data.chart_of_accounts || []
  const byName = Object.fromEntries(list.map(a => [a.account_name.toLowerCase(), a]))
  const results = []

  for (const def of ACCT_DEFS) {
    const found = byName[def.name.toLowerCase()]
    let accountId, created = false

    if (found) {
      accountId = found.account_id
    } else {
      const payload = { account_name: def.name, account_type: def.type }
      if (def.parentId) payload.parent_account_id = def.parentId
      const resp = await booksPost('/chartofaccounts', payload)
      const acct = resp.chart_of_account
      if (!acct?.account_id) {
        throw new Error(`Failed to create "${def.name}": ${JSON.stringify(resp)}`)
      }
      accountId = acct.account_id
      created   = true
    }

    await prisma.setting.upsert({
      where:  { key: def.key },
      update: { value: { accountId, accountName: def.name } },
      create: { key: def.key, value: { accountId, accountName: def.name } },
    })

    results.push({ name: def.name, accountId, created, settingKey: def.key })
  }

  return results
}

async function listChartOfAccounts() {
  try {
    const data = await booksGet('/chartofaccounts?per_page=200')
    const list = data.chartofaccounts || data.chart_of_accounts || []
    return list.map(a => ({ id: a.account_id, name: a.account_name, type: a.account_type }))
  } catch (e) {
    console.warn('[ledger] listChartOfAccounts:', e.message)
    return []
  }
}

// ── STEP 1 — Load dynamic account IDs from Settings ──────────────────────────

async function loadAccountIds() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...ACCT_DEFS.map(d => d.key), 'ledger_acct_credit_card'] } },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    teamStoreSales:  map['ledger_acct_team_store_sales']?.accountId  || null,
    teamStoreCogs:   map['ledger_acct_team_store_cogs']?.accountId   || null,
    shopifyClearing: map['ledger_acct_shopify_clearing']?.accountId  || null,
    creditCard:      map['ledger_acct_credit_card']?.accountId       || null,
  }
}

// ── STEP 2 — Fetch uncategorized transactions from one account ──────────────

async function fetchUncategorized(accountId, limit, transactionType = 'deposit') {
  try {
    const data = await booksGet(
      `/banktransactions?account_id=${accountId}` +
      `&filter_by=Status.Uncategorized&transaction_type=${transactionType}` +
      `&per_page=${limit}&sort_column=date&sort_order=D`
    )
    return data.banktransactions || []
  } catch (e) {
    console.warn(`[ledger] fetchUncategorized(${accountId}, ${transactionType}):`, e.message)
    return []
  }
}

// ── Zoho Books' own Bank Rules — read, don't reinvent ────────────────────────
//
// Best-effort against Zoho's documented bank-rules shape. Rule field names can
// vary by account setup; this defensively checks a few likely shapes rather
// than assuming one. If nothing matches the response shape, it just yields no
// rule suggestions instead of throwing.

let _ruleCache = null // { accountId -> rules[] }, per-request cache (module survives warm invocations only)

async function fetchBankRules(accountId) {
  if (_ruleCache?.[accountId]) return _ruleCache[accountId]
  try {
    const data  = await booksGet(`/bankrules?account_id=${accountId}`)
    const rules = data.bankrules || data.bank_rules || data.rules || []
    _ruleCache = { ..._ruleCache, [accountId]: rules }
    return rules
  } catch (e) {
    console.warn(`[ledger] fetchBankRules(${accountId}):`, e.message)
    return []
  }
}

function ruleConditions(rule) {
  return rule.criteria || rule.conditions || rule.rule_criteria || []
}

function ruleTargetAccount(rule) {
  return rule.account_id
    || rule.applied_values?.account_id
    || rule.applied_account_id
    || null
}

function matchBankRule(txn, rules) {
  const haystack = `${txn.description || ''} ${txn.payee || ''} ${txn.reference_number || ''}`.toLowerCase()
  for (const rule of rules) {
    const conditions = ruleConditions(rule)
    const accountId  = ruleTargetAccount(rule)
    if (!accountId) continue

    // No parseable conditions — skip rather than guess a false match
    if (!Array.isArray(conditions) || !conditions.length) continue

    const matched = conditions.some(c => {
      const field = (c.field || c.criteria_field || '').toLowerCase()
      const value = (c.value || c.criteria_value || '').toLowerCase()
      if (!value) return false
      if (field && !field.includes('desc') && !field.includes('payee') && !field.includes('narration')) return false
      return haystack.includes(value)
    })

    if (matched) {
      return { accountId, label: `Bank Rule: ${rule.rule_name || rule.name || 'Matched'}` }
    }
  }
  return null
}

// ── Memory — remembered corrections from prior approvals ─────────────────────

async function recallCategorization(name) {
  if (!name) return null
  try {
    const facts = await recall({ entity: memoryEntity(name), scope: MEMORY_SCOPE, key: 'category' })
    if (!facts.length) return null
    const value = typeof facts[0].value === 'string' ? JSON.parse(facts[0].value) : facts[0].value
    if (!value?.accountId) return null
    return { accountId: value.accountId, label: value.label || 'Remembered' }
  } catch { return null }
}

async function rememberCategorization(name, accountId, label) {
  if (!name || !accountId) return
  await remember({
    scope: MEMORY_SCOPE, entity: memoryEntity(name), key: 'category',
    value: { accountId, label }, agentId: 'ledger', confidence: 1,
  }).catch(() => {})
}

// ── Stripe name extraction ────────────────────────────────────────────────────

function extractPayoutId(txn) {
  const haystack = `${txn.description || ''} ${txn.reference_number || ''}`
  const m = haystack.match(/po_[a-zA-Z0-9]+/)
  return m ? m[0] : null
}

async function fetchStripeBalanceTxns(payoutId) {
  if (!STRIPE_KEY || !payoutId) return []
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/balance_transactions?payout=${payoutId}&limit=100&expand[]=data.source`,
      { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
    )
    if (!r.ok) return []
    const d = await r.json()
    return (d.data || []).filter(t => t.type === 'charge' && t.source)
  } catch { return [] }
}

function storeNameFromSource(source) {
  if (!source) return null
  const m  = source.metadata || {}
  const pm = source.payment_intent?.metadata || {}
  const fromMeta = m.store_name || m.school_name || m.store_id ||
                   pm.store_name || pm.school_name || pm.store_id ||
                   source.statement_descriptor_suffix
  if (fromMeta) return String(fromMeta).trim()

  // "#ST1-26-00347 / ADM Tigers Cross Country" → "ADM Tigers Cross Country"
  const match = (source.description || '').match(/\/\s*(.+)$/)
  return match ? match[1].trim() : null
}

async function extractStoreNameFromStripe(txn) {
  const payoutId = extractPayoutId(txn)
  if (!payoutId) return null
  const charges = await fetchStripeBalanceTxns(payoutId)
  const names   = charges.map(t => storeNameFromSource(t.source)).filter(Boolean)
  if (!names.length) return null
  // Most frequent name wins (handles multi-store payouts)
  const freq = {}
  for (const n of names) freq[n] = (freq[n] || 0) + 1
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
}

// ── Shopify name extraction ───────────────────────────────────────────────────

// Extracts order number from bank transaction description/reference, then
// calls the Shopify Admin API to get the order note (often the team store name)
// or the customer's full name as a fallback.
async function extractStoreNameFromShopify(txn) {
  if (!SHOPIFY_URL || !SHOPIFY_TOKEN) return null

  const haystack = `${txn.description || ''} ${txn.reference_number || ''}`

  // Shopify order numbers are typically 4–6 digits, often preceded by #
  const m = haystack.match(/#?(\d{4,6})\b/)
  if (!m) return null

  try {
    const r = await fetch(
      `https://${SHOPIFY_URL}/admin/api/2024-01/orders.json` +
      `?name=%23${m[1]}&status=any&fields=id,note,customer`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } }
    )
    if (!r.ok) return null
    const d     = await r.json()
    const order = (d.orders || [])[0]
    if (!order) return null

    // Prefer order note (often set to team store / school name)
    if (order.note?.trim()) return order.note.trim()

    // Fall back to customer full name
    const c = order.customer
    if (c) return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null
    return null
  } catch { return null }
}

// ── STEP 3 — Matching logic ───────────────────────────────────────────────────

async function matchTeamStore(name) {
  if (!name) return null
  try {
    return await prisma.teamStore.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, active: true },
    })
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

// Match an open invoice by amount ± $0.01 and txnDate within ±60 days of dueDate.
// Returns { invoice, confidence } — 'exact' when reference also matches, 'high' otherwise.
async function matchInvoice(amount, txnDate, referenceNumber) {
  try {
    const dateMs = txnDate ? new Date(txnDate).getTime() : null
    const where = {
      amountTotal: { gte: amount - 0.01, lte: amount + 0.01 },
      status:      { in: ['SENT', 'OVERDUE', 'PARTIAL'] },
    }
    // Narrow by due-date window when we have a transaction date
    if (dateMs) {
      where.dueDate = {
        gte: new Date(dateMs - 60 * 86_400_000),
        lte: new Date(dateMs + 60 * 86_400_000),
      }
    }
    const invoice = await prisma.dealInvoice.findFirst({ where, orderBy: { createdAt: 'desc' } })
    if (!invoice) return null

    // Boost to 'exact' when the bank reference matches the invoice PO
    const refMatch = referenceNumber && invoice.poNumber &&
                     invoice.poNumber.toLowerCase() === referenceNumber.toLowerCase()
    const confidence = refMatch ? 'exact' : 'high'
    return { invoice, confidence }
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

// Match an open vendor bill by amount ± $0.01 — the AP-side counterpart to
// matchInvoice, used for credit card charges instead of bank deposits.
async function matchVendorBill(amount) {
  try {
    const bill = await prisma.vendorBill.findFirst({
      where: {
        totalAmount: { gte: amount - 0.01, lte: amount + 0.01 },
        status:      { in: ['PENDING_REVIEW', 'MAPPED', 'CREATED'] },
      },
      orderBy: { createdAt: 'desc' },
    })
    return bill || null
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

async function findExistingDeposit(zohoBankTxnId) {
  try {
    return await prisma.deposit.findUnique({ where: { zohoBankTxnId } })
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

async function findDuplicate(amount, dateMs, source) {
  try {
    return await prisma.deposit.findFirst({
      where: {
        amount:  { gte: amount - 0.01, lte: amount + 0.01 },
        txnDate: {
          gte: new Date(dateMs - 86_400_000),
          lte: new Date(dateMs + 86_400_000),
        },
        source,
        status: { not: 'PENDING_REVIEW' },
      },
    })
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

async function findOriginalForReversal(absAmount, source) {
  try {
    return await prisma.deposit.findFirst({
      where: {
        amount: { gte: absAmount - 0.01, lte: absAmount + 0.01 },
        source,
        status: { notIn: ['PENDING_REVIEW', 'REVERSED'] },
      },
      orderBy: { txnDate: 'desc' },
    })
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}

// ── STEP 4 — Classify one deposit (AR side) — always returns a proposal ──────

async function classifyTxn(txn, source, accountIds) {
  const amount = parseFloat(txn.amount) || 0
  const dateMs = new Date(txn.date).getTime()

  const existing = await findExistingDeposit(txn.transaction_id)
  if (existing && existing.status !== 'PENDING_REVIEW') {
    return { txn, source, skip: true, status: 'ALREADY_RECONCILED', existingId: existing.id }
  }

  // Refund / chargeback — negative deposit amount
  if (amount < 0) {
    const absAmt   = Math.abs(amount)
    const original = await findOriginalForReversal(absAmt, source)
    return {
      txn, source, amount,
      isReversal:   true,
      reversalOfId: original?.id || null,
      status:       'REVERSED',
      confidence:   original ? 'exact' : 'none',
      notes:        original
        ? `Reverses deposit ${original.id} (${original.txnDate.toISOString().slice(0, 10)})`
        : 'Negative deposit — no matching original found',
    }
  }

  // Duplicate — same amount ± $0.01 on same day from same source, already reconciled
  const dup = await findDuplicate(amount, dateMs, source)
  if (dup) {
    return {
      txn, source, amount,
      isDuplicate: true,
      status:      'DUPLICATE',
      confidence:  'exact',
      notes:       `Duplicate of deposit ${dup.id} (${dup.txnDate.toISOString().slice(0, 10)})`,
    }
  }

  // Extract store / org name from platform metadata
  let extractedName = null
  if (source === 'stripe') {
    extractedName = await extractStoreNameFromStripe(txn)
  } else if (source === 'shopify') {
    extractedName = await extractStoreNameFromShopify(txn)
  }
  if (!extractedName) {
    const desc  = txn.description || txn.payee || ''
    const match = desc.match(/\/\s*(.+)$/)
    if (match) extractedName = match[1].trim()
  }

  const base = { txn, source, amount, extractedName, status: 'PENDING_REVIEW' }

  // 1. Remembered correction for this exact payer/description wins outright
  const remembered = await recallCategorization(extractedName)
  if (remembered) {
    return { ...base, confidence: 'exact', suggestionSource: 'memory',
      suggestedAccountId: remembered.accountId, suggestedLabel: remembered.label,
      notes: `Remembered: previously coded to ${remembered.label}` }
  }

  // 2. Team store exact match
  const teamStore = await matchTeamStore(extractedName)
  if (teamStore) {
    return { ...base, confidence: 'exact', suggestionSource: 'teamstore',
      suggestedAccountId: accountIds.teamStoreSales, suggestedLabel: 'Team Store Sales',
      matchedTeamStoreId: teamStore.id, matchedTeamStoreName: teamStore.name,
      notes: `Matches team store "${teamStore.name}"` }
  }

  // 3. Open invoice match — amount ± $0.01, date ± 60 days, optional reference boost
  const invoiceMatch = await matchInvoice(amount, txn.date, txn.reference_number)
  if (invoiceMatch) {
    const { invoice, confidence } = invoiceMatch
    return { ...base, confidence, suggestionSource: 'invoice',
      suggestedAccountId: FIXED.ar, suggestedLabel: 'Accounts Receivable',
      matchedInvoiceId: invoice.id, matchedInvoiceName: invoice.crmDealName || null,
      notes: confidence === 'exact'
        ? `Matches invoice ${invoice.crmDealName || invoice.id} (PO confirmed)`
        : `Possible invoice match: ${invoice.crmDealName || invoice.id} — verify before approving` }
  }

  // 4. Zoho Books' own bank rules
  const rules = await fetchBankRules(txn.account_id || '')
  const ruleHit = rules.length ? matchBankRule(txn, rules) : null
  if (ruleHit) {
    return { ...base, confidence: 'high', suggestionSource: 'rule',
      suggestedAccountId: ruleHit.accountId, suggestedLabel: ruleHit.label,
      notes: `Matched Zoho Books rule: ${ruleHit.label}` }
  }

  // No signal at all
  return { ...base, confidence: 'none', suggestionSource: 'none',
    suggestedAccountId: null, suggestedLabel: null,
    notes: extractedName
      ? `"${extractedName}" — no matching team store, invoice, or bank rule`
      : 'No payer name found — needs manual coding' }
}

// ── STEP 4b — Classify one credit card charge (AP side) — same shape ────────

async function classifyExpenseTxn(txn) {
  const amount = Math.abs(parseFloat(txn.amount) || 0)

  const existing = await findExistingDeposit(txn.transaction_id)
  if (existing && existing.status !== 'PENDING_REVIEW') {
    return { txn, source: 'creditcard', skip: true, status: 'ALREADY_RECONCILED', existingId: existing.id }
  }

  const extractedName = (txn.description || txn.payee || '').trim() || null
  const base = { txn, source: 'creditcard', amount, extractedName, status: 'PENDING_REVIEW' }

  const remembered = await recallCategorization(extractedName)
  if (remembered) {
    return { ...base, confidence: 'exact', suggestionSource: 'memory',
      suggestedAccountId: remembered.accountId, suggestedLabel: remembered.label,
      notes: `Remembered: previously coded to ${remembered.label}` }
  }

  const bill = await matchVendorBill(amount)
  if (bill) {
    return { ...base, confidence: 'high', suggestionSource: 'vendorbill',
      suggestedAccountId: FIXED.ap, suggestedLabel: 'Accounts Payable',
      matchedVendorBillId: bill.id, matchedBillName: bill.vendorInvoiceNo || bill.id,
      notes: `Matches vendor bill ${bill.vendorInvoiceNo || bill.id}` }
  }

  const rules = await fetchBankRules(txn.account_id || '')
  const ruleHit = rules.length ? matchBankRule(txn, rules) : null
  if (ruleHit) {
    return { ...base, confidence: 'high', suggestionSource: 'rule',
      suggestedAccountId: ruleHit.accountId, suggestedLabel: ruleHit.label,
      notes: `Matched Zoho Books rule: ${ruleHit.label}` }
  }

  return { ...base, confidence: 'none', suggestionSource: 'none',
    suggestedAccountId: null, suggestedLabel: null,
    notes: `${extractedName || 'Charge'} — no matching vendor bill or bank rule (upload the bill to link)` }
}

// ── STEP 5 — Persist proposal to Deposit table (always — this is the queue) ──

async function writeDeposit(result) {
  const { txn, source } = result

  const createData = {
    source,
    zohoBankTxnId:       txn.transaction_id || `noid-${source}-${Math.abs(result.amount)}-${Date.now()}`,
    amount:              Math.abs(result.amount),
    txnDate:             new Date(txn.date),
    orgNameRaw:          result.extractedName || txn.description || txn.payee || null,
    status:              result.status,
    matchedTeamStoreId:  result.matchedTeamStoreId  || null,
    matchedInvoiceId:    result.matchedInvoiceId     || null,
    matchedVendorBillId: result.matchedVendorBillId  || null,
    suggestedAccountId:  result.suggestedAccountId    || null,
    suggestedLabel:      result.suggestedLabel        || null,
    suggestionSource:    result.suggestionSource       || null,
    matchConfidence:     CONF_MAP[result.confidence] ?? null,
  }

  try {
    if (txn.transaction_id) {
      return await prisma.deposit.upsert({
        where:  { zohoBankTxnId: txn.transaction_id },
        update: {
          status:              createData.status,
          matchedTeamStoreId:  createData.matchedTeamStoreId,
          matchedInvoiceId:    createData.matchedInvoiceId,
          matchedVendorBillId: createData.matchedVendorBillId,
          suggestedAccountId:  createData.suggestedAccountId,
          suggestedLabel:      createData.suggestedLabel,
          suggestionSource:    createData.suggestionSource,
          matchConfidence:     createData.matchConfidence,
        },
        create: createData,
      })
    }
    return await prisma.deposit.create({ data: createData })
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      console.warn('[ledger] Deposit table not migrated yet — skipping write')
      return null
    }
    throw e
  }
}

// ── STEP 6 — Reverse a prior Deposit on chargeback ───────────────────────────

async function reverseDeposit(reversalOfId) {
  if (!reversalOfId) return
  try {
    await prisma.deposit.update({
      where: { id: reversalOfId },
      data: {
        status:             'REVERSED',
        matchedTeamStoreId: null,
        matchedInvoiceId:   null,
        categorizedAs:      null,
      },
    })
  } catch (e) {
    if (!isPrismaTableMissing(e)) throw e
  }
}

// ── TeamStore seeding — auto-populate from Stripe charge history ──────────────

async function seedTeamStores() {
  if (!STRIPE_KEY) return { seeded: 0, note: 'STRIPE_KEY not set' }

  const since = Math.floor((Date.now() - 90 * 86_400_000) / 1000)
  const names  = new Set()
  let startAfter = null

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      limit:           '100',
      'created[gte]':  String(since),
      'expand[]':      'data.payment_intent',
    })
    if (startAfter) params.set('starting_after', startAfter)

    const r = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    })
    if (!r.ok) break
    const d = await r.json()

    for (const charge of d.data || []) {
      const name = storeNameFromSource(charge)
      if (name) names.add(name)
    }
    if (!d.has_more) break
    startAfter = (d.data || []).at(-1)?.id
  }

  let seeded = 0
  for (const name of names) {
    try {
      const exists = await prisma.teamStore.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      })
      if (!exists) {
        await prisma.teamStore.create({ data: { name } })
        seeded++
      }
    } catch (e) {
      if (isPrismaTableMissing(e)) break
      console.warn('[ledger] seed-stores insert error:', name, e.message)
    }
  }

  return { seeded, discovered: names.size }
}

// ── Slack notification for new pending items ─────────────────────────────────

async function notifySlack(pending) {
  const token   = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_LEDGER_REVIEW_CHANNEL
                  || process.env.SLACK_REDDIT_REVIEW_CHANNEL
  if (!token || !channel || !pending.length) return

  const lines = pending.map(r => {
    const amt  = `$${Math.abs(r.amount || 0).toFixed(2)}`
    const name = r.extractedName ? `"${r.extractedName}"` : '(no name found)'
    const coded = r.suggestedLabel ? ` → suggested: ${r.suggestedLabel}` : ''
    return `• ${r.txn.date} | ${amt} | ${r.source} | ${name}${coded}`
  })

  await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel,
      text: `*Ledger: ${pending.length} transaction${pending.length !== 1 ? 's' : ''} ready for review*\n${lines.join('\n')}`,
    }),
  }).catch(() => {})
}

// ── Approve — push the (possibly edited) coding into Zoho Books ─────────────

async function approveDeposit({ depositId, accountId, label }) {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } })
  if (!deposit) throw new Error(`Deposit ${depositId} not found`)
  if (deposit.status === 'APPROVED') return { ok: true, already: true, deposit }

  const finalAccountId = accountId || deposit.suggestedAccountId
  if (!finalAccountId) throw new Error('No account chosen — pick a category before approving')
  const finalLabel = label || deposit.suggestedLabel || 'Categorized'

  // Push the categorization into Zoho Books so the transaction actually
  // leaves "Uncategorized" there too, not just in our local mirror.
  await booksPost(`/banktransactions/${deposit.zohoBankTxnId}/categorize`, {
    account_id: finalAccountId,
  })

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: {
      status:            'APPROVED',
      categorizedAs:     finalLabel,
      approvedAccountId: finalAccountId,
      approvedAt:        new Date(),
    },
  })

  rememberCategorization(deposit.orgNameRaw, finalAccountId, finalLabel).catch(() => {})

  return { ok: true, deposit: updated }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const {
    task   = 'reconcile',
    dryRun = false,
    limit  = 10,
  } = req.body || {}

  try {
    if (task === 'configure-card') {
      const { accountId } = req.body || {}
      if (!accountId) return res.status(400).json({ error: 'accountId required' })
      await prisma.setting.upsert({
        where:  { key: 'ledger_acct_credit_card' },
        update: { value: { accountId } },
        create: { key: 'ledger_acct_credit_card', value: { accountId } },
      })
      return res.json({ ok: true, accountId })
    }

    if (task === 'accounts-list') {
      const accounts = await listChartOfAccounts()
      return res.json({ ok: true, accounts })
    }

    if (task === 'list-pending') {
      try {
        const pending = await prisma.deposit.findMany({
          where:   { status: 'PENDING_REVIEW' },
          orderBy: { txnDate: 'desc' },
          take:    200,
        })
        return res.json({ ok: true, pending })
      } catch (e) {
        if (isPrismaTableMissing(e)) return res.json({ ok: true, pending: [] })
        throw e
      }
    }

    if (task === 'update-suggestion') {
      const { depositId, accountId, label } = req.body || {}
      if (!depositId) return res.status(400).json({ error: 'depositId required' })
      const updated = await prisma.deposit.update({
        where: { id: depositId },
        data:  { suggestedAccountId: accountId || undefined, suggestedLabel: label || undefined, suggestionSource: 'manual' },
      })
      return res.json({ ok: true, deposit: updated })
    }

    if (task === 'approve') {
      const { depositId, accountId, label } = req.body || {}
      if (!depositId) return res.status(400).json({ error: 'depositId required' })
      const result = await approveDeposit({ depositId, accountId, label })
      return res.json(result)
    }

    // STEP 0 — idempotently create / verify Zoho Books accounts
    const accountSetup = await setupAccounts()

    if (task === 'setup') {
      return res.json({ ok: true, accounts: accountSetup })
    }

    if (task === 'seed-stores') {
      const result = await seedTeamStores()
      return res.json({ ok: true, accounts: accountSetup, seedStores: result })
    }

    // STEP 1 — load dynamic account IDs and build poll list
    const accountIds = await loadAccountIds()

    // Auto-seed TeamStore on very first reconcile run if table is empty
    try {
      const storeCount = await prisma.teamStore.count()
      if (storeCount === 0) await seedTeamStores()
    } catch (e) {
      if (!isPrismaTableMissing(e)) console.warn('[ledger] auto-seed check:', e.message)
    }

    const pollAccounts = [
      { id: FIXED.operating,      source: 'other',   label: 'ST1 Operating Account', txnType: 'deposit' },
      { id: FIXED.stripeClearing, source: 'stripe',  label: 'Stripe Clearing',       txnType: 'deposit' },
    ]
    if (accountIds.shopifyClearing) {
      pollAccounts.push({ id: accountIds.shopifyClearing, source: 'shopify', label: 'Shopify Clearing', txnType: 'deposit' })
    }
    if (accountIds.creditCard) {
      pollAccounts.push({ id: accountIds.creditCard, source: 'creditcard', label: 'Credit Card', txnType: 'expense' })
    }

    // STEP 2 — fetch uncategorized transactions from each account
    const allTxns = []
    const accountsPolled = []
    for (const acct of pollAccounts) {
      const txns = await fetchUncategorized(acct.id, limit, acct.txnType)
      accountsPolled.push({ label: acct.label, source: acct.source, found: txns.length })
      for (const t of txns) allTxns.push({ ...t, account_id: acct.id, _source: acct.source, _label: acct.label, _txnType: acct.txnType })
    }
    if (!accountIds.creditCard) {
      accountsPolled.push({ label: 'Credit Card', source: 'creditcard', found: null, notConfigured: true })
    }

    // Deduplicate by transaction_id (same txn can appear across accounts)
    const seenIds = new Set()
    const uniq = allTxns.filter(t => {
      if (!t.transaction_id || seenIds.has(t.transaction_id)) return false
      seenIds.add(t.transaction_id)
      return true
    })

    // STEP 3 — classify (propose a coding), guard, write to the review queue
    const results = []

    for (const txn of uniq) {
      try {
        const result = txn._txnType === 'expense'
          ? await classifyExpenseTxn(txn)
          : await classifyTxn(txn, txn._source, accountIds)

        if (result.skip) continue  // already approved/settled

        if (result.isReversal && result.reversalOfId && !dryRun) {
          await reverseDeposit(result.reversalOfId)
        }

        if (!dryRun) await writeDeposit(result)
        results.push(result)
      } catch (e) {
        console.error('[ledger] classify error:', txn.transaction_id, e.message)
        results.push({
          txn,
          source:     txn._source,
          status:     'PENDING_REVIEW',
          confidence: 'none',
          notes:      `Classification error: ${e.message}`,
        })
      }
    }

    // STEP 4 — Slack notification for genuinely new pending items (skip live-mode-only gate — this never touches Zoho)
    const pendingNew = results.filter(r => r.status === 'PENDING_REVIEW')
    if (!dryRun) notifySlack(pendingNew).catch(() => {})

    // STEP 5 — return report
    const transactions = results.map(r => ({
      date:             r.txn?.date || null,
      amount:           r.txn?.amount || r.amount || 0,
      source:           r.source,
      account:          r.txn?._label || null,
      description:      r.txn?.description || r.txn?.payee || null,
      extractedName:    r.extractedName || null,
      status:           r.status,
      confidence:       r.confidence || null,
      suggestedAccountId: r.suggestedAccountId || null,
      suggestedLabel:     r.suggestedLabel || null,
      suggestionSource:   r.suggestionSource || null,
      match:            r.matchedTeamStoreName || r.matchedInvoiceName || r.matchedBillName || null,
      notes:            r.notes || null,
    }))

    const zeroPolledHint = uniq.length === 0
      ? 'No uncategorized transactions found in any polled account — either everything is already categorized in Zoho Books, the bank feed isn\'t syncing new transactions, or (for credit card charges) no account is configured yet.'
      : null

    return res.json({
      ok:     true,
      dryRun,
      accounts: accountSetup,
      accountsPolled,
      message: zeroPolledHint,
      totals: {
        polled:     uniq.length,
        pending:    pendingNew.length,
        withSuggestion: pendingNew.filter(r => r.suggestedAccountId).length,
        duplicates: results.filter(r => r.status === 'DUPLICATE').length,
        reversals:  results.filter(r => r.status === 'REVERSED').length,
      },
      transactions,
    })

  } catch (err) {
    console.error('[ledger/reconcile]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
