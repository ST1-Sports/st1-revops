/**
 * POST /api/agents/ledger/reconcile
 * { task?: "setup"|"reconcile", dryRun?: boolean, limit?: number }
 *
 * Ledger reconciliation agent.
 *
 * STEP 0 (always runs): idempotently create three Zoho Books accounts and
 *   persist their IDs to the Setting table.
 *
 * STEP 1+: poll uncategorized deposits from ST1 Operating Account, Stripe
 *   Clearing, and Shopify Clearing; classify each against TeamStore → open
 *   DealInvoice → NEEDS_REVIEW; write Deposit rows; Slack-notify on review items.
 *
 * Safe defaults: task="reconcile", dryRun=true, limit=10.
 * Nothing is written to Zoho Books or the Deposit table in dry-run mode.
 */

import { setCors }        from '../../_lib/cors.js'
import { prisma }         from '../../_lib/prisma.js'
import { getZohoToken }   from '../../_lib/zoho-token.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG        = process.env.ZOHO_ORG_ID || '899940777'
const BOOKS      = 'https://www.zohoapis.com/books/v3'
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY

// Fixed Zoho Books account IDs (never change)
const FIXED = {
  operating:      '7255504000000180097',  // ST1 Operating Account
  ar:             '7255504000000000364',  // Accounts Receivable
  bankFees:       '7255504000000000409',  // Bank Fees and Charges
  stripeClearing: '7255504000000551015',  // Stripe Clearing
}

// Accounts to create (idempotent) — STEP 0
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

// ── Zoho Books helpers ────────────────────────────────────────────────────────

async function booksHeaders() {
  const token = await getZohoToken()
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

async function booksGet(path) {
  const headers = await booksHeaders()
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, { headers })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Zoho Books GET ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

async function booksPost(path, body) {
  const headers = await booksHeaders()
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${BOOKS}${path}${sep}organization_id=${ORG}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`Zoho Books POST ${path}: ${r.status} — ${txt.slice(0, 200)}`)
  }
  return r.json()
}

// ── STEP 0 — Chart of accounts setup (idempotent) ────────────────────────────

async function setupAccounts() {
  // Fetch all accounts — paginate up to 200 (typical orgs well under that)
  const data     = await booksGet('/chartofaccounts?per_page=200')
  const list     = data.chartofaccounts || data.chart_of_accounts || []
  const byName   = Object.fromEntries(list.map(a => [a.account_name.toLowerCase(), a]))

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

    // Persist to Setting table so Matt can view/edit without a code change
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
    return []  // don't abort the whole run if one account fails
  }
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

// Extract Stripe payout ID (po_xxx) from bank transaction description / reference
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

// Mirrors the existing stripe/index.js storeNameOf pattern
function storeNameFromSource(source) {
  if (!source) return null
  const m  = source.metadata || {}
  const pm = source.payment_intent?.metadata || {}
  const fromMeta = m.store_name || m.school_name || m.store_id ||
                   pm.store_name || pm.school_name || pm.store_id ||
                   source.statement_descriptor_suffix
  if (fromMeta) return String(fromMeta).trim()

  // "#ST1-26-00347 / ADM Tigers Cross Country" → "ADM Tigers Cross Country"
  const desc = source.description || ''
  const match = desc.match(/\/\s*(.+)$/)
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

async function matchInvoice(amount) {
  try {
    return await prisma.dealInvoice.findFirst({
      where: {
        amountTotal: { gte: amount - 0.01, lte: amount + 0.01 },
        status:      { in: ['SENT'] },
      },
      orderBy: { createdAt: 'desc' },
    })
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

function isPrismaTableMissing(e) {
  return e.code === 'P2021' || e.message?.includes('does not exist')
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
      isReversal:  true,
      reversalOfId: original?.id || null,
      status:      'REVERSED',
      confidence:  original ? 'exact' : 'none',
      notes:       original
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

  // Extract store / org name from Stripe metadata or description
  let extractedName = null
  if (source === 'stripe') {
    extractedName = await extractStoreNameFromStripe(txn)
  }
  if (!extractedName) {
    // Fallback: parse description for " / Name" pattern
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
      targetAccountId:      accountIds.teamStoreSales,
      matchedTeamStoreId:   teamStore.id,
      matchedTeamStoreName: teamStore.name,
    }
  }

  // Invoice match — amount within $0.01 against SENT invoices
  const invoice = await matchInvoice(amount)
  if (invoice) {
    return {
      txn, source, amount, extractedName,
      status:             'MATCHED_INVOICE',
      confidence:         'exact',
      categorizedAs:      'Accounts Receivable',
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

  const confMap = { exact: 1.0, high: 0.8, low: 0.4 }
  const createData = {
    source,
    zohoBankTxnId:      txn.transaction_id || `noid-${Date.now()}`,
    amount:             Math.abs(result.amount),
    txnDate:            new Date(txn.date),
    orgNameRaw:         result.extractedName || txn.description || txn.payee || null,
    status:             result.status,
    categorizedAs:      result.categorizedAs      || null,
    matchedTeamStoreId: result.matchedTeamStoreId || null,
    matchedInvoiceId:   result.matchedInvoiceId   || null,
    matchConfidence:    confMap[result.confidence] ?? null,
  }

  try {
    if (txn.transaction_id) {
      const updateData = {
        status:             createData.status,
        categorizedAs:      createData.categorizedAs,
        matchedTeamStoreId: createData.matchedTeamStoreId,
        matchedInvoiceId:   createData.matchedInvoiceId,
        matchConfidence:    createData.matchConfidence,
      }
      return await prisma.deposit.upsert({
        where:  { zohoBankTxnId: txn.transaction_id },
        update: updateData,
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
        status:        'REVERSED',
        matchedTeamStoreId: null,
        matchedInvoiceId:   null,
        categorizedAs: null,
        notes:         'Reversed by chargeback/refund',
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

  // Page through up to 500 recent charges (5 pages × 100)
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
      const exists = await prisma.teamStore.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
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
    dryRun = true,          // safe default: never write without explicit opt-in
    limit  = 10,
  } = req.body || {}

  try {
    // ── STEP 0 — Create / verify Zoho Books accounts ─────────────────────────
    const accountSetup = await setupAccounts()

    if (task === 'setup') {
      return res.json({ ok: true, accounts: accountSetup })
    }

    // ── seed-stores — pull unique store names from Stripe charge history ─────
    if (task === 'seed-stores') {
      const result = await seedTeamStores()
      return res.json({ ok: true, accounts: accountSetup, seedStores: result })
    }

    // ── STEP 1 — Determine which clearing accounts to poll ───────────────────
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
      pollAccounts.push({
        id:     accountIds.shopifyClearing,
        source: 'shopify',
        label:  'Shopify Clearing',
      })
    }

    // ── STEP 2 — Fetch uncategorized deposits ────────────────────────────────
    const allTxns = []
    for (const acct of pollAccounts) {
      const txns = await fetchUncategorized(acct.id, limit)
      for (const t of txns) allTxns.push({ ...t, _source: acct.source, _label: acct.label })
    }

    // Deduplicate by transaction_id (same txn can appear in multiple accounts)
    const seenIds = new Set()
    const uniq = allTxns.filter(t => {
      if (!t.transaction_id || seenIds.has(t.transaction_id)) return false
      seenIds.add(t.transaction_id)
      return true
    })

    // ── STEP 3 — Classify, guard, write ─────────────────────────────────────
    const results = []

    for (const txn of uniq) {
      try {
        const result = await classifyTxn(txn, txn._source, accountIds)

        if (result.skip) continue  // already reconciled with terminal status

        // Reversal: update the original deposit before writing the reversal row
        if (result.isReversal && result.reversalOfId) {
          await reverseDeposit(result.reversalOfId, dryRun)
        }

        await writeDeposit(result, dryRun)
        results.push(result)
      } catch (e) {
        console.error('[ledger] classify error:', txn.transaction_id, e.message)
        results.push({
          txn,
          source:    txn._source,
          status:    'NEEDS_REVIEW',
          confidence: 'none',
          notes:     `Classification error: ${e.message}`,
        })
      }
    }

    // ── STEP 4 — Slack notification (live mode only) ─────────────────────────
    const needsReview = results.filter(r => r.status === 'NEEDS_REVIEW')
    if (!dryRun) notifySlack(needsReview).catch(() => {})

    // ── STEP 5 — Return report ───────────────────────────────────────────────
    const rows = results.map(r => ({
      date:          r.txn?.date || null,
      amount:        r.txn?.amount || r.amount || 0,
      source:        r.source,
      account:       r.txn?._label || null,
      description:   r.txn?.description || r.txn?.payee || null,
      extractedName: r.extractedName || null,
      status:        r.status,
      confidence:    r.confidence || null,
      categorizedAs: r.categorizedAs || null,
      match:         r.matchedTeamStoreName || r.matchedInvoiceName || null,
      notes:         r.notes || null,
    }))

    return res.json({
      ok:     true,
      dryRun,
      accounts: accountSetup,
      totals: {
        polled:          uniq.length,
        matchedStore:    results.filter(r => r.status === 'MATCHED_STORE').length,
        matchedInvoice:  results.filter(r => r.status === 'MATCHED_INVOICE').length,
        needsReview:     needsReview.length,
        duplicates:      results.filter(r => r.status === 'DUPLICATE').length,
        reversals:       results.filter(r => r.status === 'REVERSED').length,
      },
      transactions: rows,
    })

  } catch (err) {
    console.error('[ledger/reconcile]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
