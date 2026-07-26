/**
 * POST /api/agents/ledger/reconcile
 * { task?: "setup"|"seed-stores"|"reconcile", dryRun?: boolean, limit?: number }
 *
 * Ledger reconciliation agent.
 *
 * STEP 0 (idempotent): create/verify three Zoho Books chart-of-accounts entries and
 *   persist their IDs to the Setting table.
 *
 * STEP 1+: poll uncategorized deposits from ST1 Operating Account, Stripe Clearing,
 *   and Shopify Clearing; classify each against TeamStore → open DealInvoice →
 *   NEEDS_REVIEW; write Deposit rows; Slack-notify review items.
 *
 * Safe defaults: task="reconcile", dryRun=true, limit=10.
 * Nothing is written to Zoho Books or the Deposit table in dry-run mode.
 */

import { setCors }                              from '../../_lib/cors.js'
import { prisma }                              from '../../_lib/prisma.js'
import { ORG, BOOKS, booksGet, booksPost,
         isPrismaTableMissing }                from '../../_lib/zoho-books.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const STRIPE_KEY      = process.env.STRIPE_SECRET_KEY
const SHOPIFY_URL     = process.env.SHOPIFY_STORE_URL    // e.g. "your-store.myshopify.com"
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN

// Fixed Zoho Books account IDs (never change)
const FIXED = {
  operating:      '7255504000000180097',  // ST1 Operating Account
  ar:             '7255504000000000364',  // Accounts Receivable
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

// ── STEP 1 — Load dynamic account IDs from Settings ──────────────────────────

async function loadAccountIds() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ACCT_DEFS.map(d => d.key) } },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    teamStoreSales:  map['ledger_acct_team_store_sales']?.accountId  || null,
    teamStoreCogs:   map['ledger_acct_team_store_cogs']?.accountId   || null,
    shopifyClearing: map['ledger_acct_shopify_clearing']?.accountId  || null,
  }
}

// ── STEP 2 — Fetch uncategorized deposits from one account ───────────────────

async function fetchUncategorized(accountId, limit) {
  try {
    const data = await booksGet(
      `/banktransactions?account_id=${accountId}` +
      `&filter_by=Status.Uncategorized&transaction_type=deposit` +
      `&per_page=${limit}&sort_column=date&sort_order=D`
    )
    return data.banktransactions || []
  } catch (e) {
    console.warn(`[ledger] fetchUncategorized(${accountId}):`, e.message)
    return []
  }
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
        status: { not: 'NEEDS_REVIEW' },
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
        status: { notIn: ['NEEDS_REVIEW', 'REVERSED'] },
      },
      orderBy: { txnDate: 'desc' },
    })
  } catch (e) {
    if (isPrismaTableMissing(e)) return null
    throw e
  }
}


// ── STEP 4 — Classify one transaction ────────────────────────────────────────

async function classifyTxn(txn, source, accountIds) {
  const amount = parseFloat(txn.amount) || 0
  const dateMs = new Date(txn.date).getTime()

  // Idempotency — skip if already reconciled with a terminal status
  const existing = await findExistingDeposit(txn.transaction_id)
  if (existing && existing.status !== 'NEEDS_REVIEW') {
    return { txn, source, skip: true, status: 'ALREADY_RECONCILED', existingId: existing.id }
  }

  // Refund / chargeback — negative deposit amount
  if (amount < 0) {
    const absAmt  = Math.abs(amount)
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
  // Fallback: parse " / Name" pattern from description
  if (!extractedName) {
    const desc  = txn.description || txn.payee || ''
    const match = desc.match(/\/\s*(.+)$/)
    if (match) extractedName = match[1].trim()
  }

  // Team store exact match
  const teamStore = await matchTeamStore(extractedName)
  if (teamStore) {
    return {
      txn, source, amount, extractedName,
      status:               'MATCHED_STORE',
      confidence:           'exact',
      categorizedAs:        'Team Store Sales',
      cogsAccountId:        accountIds.teamStoreCogs,
      targetAccountId:      accountIds.teamStoreSales,
      matchedTeamStoreId:   teamStore.id,
      matchedTeamStoreName: teamStore.name,
    }
  }

  // Invoice match — amount ± $0.01, date ± 60 days, optional reference boost
  const invoiceMatch = await matchInvoice(amount, txn.date, txn.reference_number)
  if (invoiceMatch) {
    const { invoice, confidence } = invoiceMatch
    // Only auto-categorize on 'exact' (reference matched) — 'high' goes to review
    if (confidence === 'exact') {
      return {
        txn, source, amount, extractedName,
        status:             'MATCHED_INVOICE',
        confidence:         'exact',
        categorizedAs:      'Accounts Receivable',
        matchedInvoiceId:   invoice.id,
        matchedInvoiceName: invoice.crmDealName || null,
      }
    }
    // high confidence but not exact — surface for review with the candidate attached
    return {
      txn, source, amount, extractedName,
      status:     'NEEDS_REVIEW',
      confidence: 'high',
      notes:      `Possible invoice match: ${invoice.crmDealName || invoice.id} — verify and confirm`,
      matchedInvoiceId:   invoice.id,
      matchedInvoiceName: invoice.crmDealName || null,
    }
  }

  // No match — surface for manual review
  return {
    txn, source, amount, extractedName,
    status:     'NEEDS_REVIEW',
    confidence: 'none',
    notes:      extractedName
      ? `"${extractedName}" not found in TeamStore table or open invoices`
      : 'No store name found — manual review required',
  }
}

// ── STEP 5 — Persist to Deposit table ────────────────────────────────────────

async function writeDeposit(result, dryRun) {
  if (dryRun) return null
  const { txn, source } = result

  const createData = {
    source,
    zohoBankTxnId:      txn.transaction_id || `noid-${source}-${Math.abs(result.amount)}-${Date.now()}`,
    amount:             Math.abs(result.amount),
    txnDate:            new Date(txn.date),
    orgNameRaw:         result.extractedName || txn.description || txn.payee || null,
    status:             result.status,
    categorizedAs:      result.categorizedAs      || null,
    matchedTeamStoreId: result.matchedTeamStoreId || null,
    matchedInvoiceId:   result.matchedInvoiceId   || null,
    matchConfidence:    CONF_MAP[result.confidence] ?? null,
  }

  try {
    if (txn.transaction_id) {
      return await prisma.deposit.upsert({
        where:  { zohoBankTxnId: txn.transaction_id },
        update: {
          status:             createData.status,
          categorizedAs:      createData.categorizedAs,
          matchedTeamStoreId: createData.matchedTeamStoreId,
          matchedInvoiceId:   createData.matchedInvoiceId,
          matchConfidence:    createData.matchConfidence,
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

async function reverseDeposit(reversalOfId, dryRun) {
  if (dryRun || !reversalOfId) return
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

// ── STEP 7 — Slack notification for NEEDS_REVIEW items ───────────────────────

async function notifySlack(needsReview) {
  const token   = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_LEDGER_REVIEW_CHANNEL
                  || process.env.SLACK_REDDIT_REVIEW_CHANNEL
  if (!token || !channel || !needsReview.length) return

  const lines = needsReview.map(r => {
    const amt  = `$${Math.abs(r.amount || 0).toFixed(2)}`
    const name = r.extractedName ? `"${r.extractedName}"` : '(no name found)'
    return `• ${r.txn.date} | ${amt} | ${r.source} | ${name} — ${r.notes || r.status}`
  })

  await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel,
      text: `*Ledger: ${needsReview.length} deposit${needsReview.length !== 1 ? 's' : ''} need review*\n${lines.join('\n')}`,
    }),
  }).catch(() => {})
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const {
    task   = 'reconcile',
    dryRun = true,
    limit  = 10,
  } = req.body || {}

  try {
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
      { id: FIXED.operating,      source: 'other',   label: 'ST1 Operating Account' },
      { id: FIXED.stripeClearing, source: 'stripe',  label: 'Stripe Clearing' },
    ]
    if (accountIds.shopifyClearing) {
      pollAccounts.push({ id: accountIds.shopifyClearing, source: 'shopify', label: 'Shopify Clearing' })
    }

    // STEP 2 — fetch uncategorized deposits from each account
    const allTxns = []
    for (const acct of pollAccounts) {
      const txns = await fetchUncategorized(acct.id, limit)
      for (const t of txns) allTxns.push({ ...t, _source: acct.source, _label: acct.label })
    }

    // Deduplicate by transaction_id (same txn can appear across accounts)
    const seenIds = new Set()
    const uniq = allTxns.filter(t => {
      if (!t.transaction_id || seenIds.has(t.transaction_id)) return false
      seenIds.add(t.transaction_id)
      return true
    })

    // STEP 3 — classify, guard, write
    const results = []

    for (const txn of uniq) {
      try {
        const result = await classifyTxn(txn, txn._source, accountIds)

        if (result.skip) continue  // already reconciled with terminal status

        if (result.isReversal && result.reversalOfId) {
          await reverseDeposit(result.reversalOfId, dryRun)
        }

        await writeDeposit(result, dryRun)
        results.push(result)
      } catch (e) {
        console.error('[ledger] classify error:', txn.transaction_id, e.message)
        results.push({
          txn,
          source:     txn._source,
          status:     'NEEDS_REVIEW',
          confidence: 'none',
          notes:      `Classification error: ${e.message}`,
        })
      }
    }

    // STEP 4 — Slack notification (live mode only)
    const needsReview = results.filter(r => r.status === 'NEEDS_REVIEW')
    if (!dryRun) notifySlack(needsReview).catch(() => {})

    // STEP 5 — return report
    const transactions = results.map(r => ({
      date:          r.txn?.date || null,
      amount:        r.txn?.amount || r.amount || 0,
      source:        r.source,
      account:       r.txn?._label || null,
      description:   r.txn?.description || r.txn?.payee || null,
      extractedName: r.extractedName || null,
      status:        r.status,
      confidence:    r.confidence || null,
      categorizedAs: r.categorizedAs || null,
      cogsAccountId: r.cogsAccountId || null,
      match:         r.matchedTeamStoreName || r.matchedInvoiceName || null,
      notes:         r.notes || null,
    }))

    return res.json({
      ok:     true,
      dryRun,
      accounts: accountSetup,
      totals: {
        polled:         uniq.length,
        matchedStore:   results.filter(r => r.status === 'MATCHED_STORE').length,
        matchedInvoice: results.filter(r => r.status === 'MATCHED_INVOICE').length,
        needsReview:    needsReview.length,
        duplicates:     results.filter(r => r.status === 'DUPLICATE').length,
        reversals:      results.filter(r => r.status === 'REVERSED').length,
      },
      transactions,
    })

  } catch (err) {
    console.error('[ledger/reconcile]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
