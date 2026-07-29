/**
 * POST /api/agents/ledger/payments
 *
 * Polls Zoho Books for open invoice status changes, updates DealInvoice rows,
 * and sends Slack reminders for overdue and upcoming-due invoices.
 *
 * Body: { dryRun?: boolean, lookAheadDays?: number, limit?: number }
 * Defaults: dryRun=true, lookAheadDays=7, limit=200
 *
 * Zoho Books status → local DealInvoice status:
 *   sent            → SENT
 *   overdue         → OVERDUE
 *   partially_paid  → PARTIAL
 *   paid            → PAID
 *   void            → VOID
 */

import { setCors }             from '../../_lib/cors.js'
import { prisma }             from '../../_lib/prisma.js'
import { booksGet,
         isPrismaTableMissing } from '../../_lib/zoho-books.js'

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } }

// Zoho Books → local DealInvoice status
const STATUS_MAP = {
  sent:           'SENT',
  overdue:        'OVERDUE',
  partially_paid: 'PARTIAL',
  paid:           'PAID',
  void:           'VOID',
}

// ── Slack helper ──────────────────────────────────────────────────────────────

async function postSlack(text, blocks) {
  const token   = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_PAYMENT_CHANNEL
                  || process.env.SLACK_LEDGER_REVIEW_CHANNEL
                  || process.env.SLACK_REDDIT_REVIEW_CHANNEL
  if (!token || !channel) return

  const payload = { channel, text }
  if (blocks) payload.blocks = blocks

  await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  }).catch(e => console.warn('[payments] slack:', e.message))
}

function invoiceUrl(zohoInvoiceId) {
  return `https://books.zoho.com/app#/invoices/${zohoInvoiceId}`
}

function fmt$(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d) {
  return d ? new Date(d).toISOString().split('T')[0] : '—'
}

function daysFromNow(date) {
  return Math.round((new Date(date) - Date.now()) / 86_400_000)
}

// ── Backfill: adopt Zoho Books invoices RevOps has never tracked ─────────────
//
// DealInvoice rows are normally only written by the ledger's own invoice-draft
// flow (a CRM "Closed Won" webhook, or a manual draft). Real invoices created
// directly in Zoho Books — the common case day to day — never appear here
// unless we go pull them in. This adopts any currently-open (sent/overdue/
// partial) Books invoice that has no local row yet, so the Finance tab and
// reconcile's invoice-matching always reflect what's actually in Zoho Books.
async function backfillOpenInvoices(limit) {
  const filters = ['Status.Sent', 'Status.Overdue', 'Status.PartiallyPaid']
  const zohoMap = {}

  await Promise.all(filters.map(async filter => {
    try {
      const data = await booksGet(`/invoices?filter_by=${filter}&per_page=${limit}&sort_column=due_date&sort_order=A`)
      for (const inv of data.invoices || []) zohoMap[inv.invoice_id] = inv
    } catch (e) {
      console.warn('[payments] backfill booksGet', filter, ':', e.message)
    }
  }))

  const ids = Object.keys(zohoMap)
  if (!ids.length) return 0

  const existing = await prisma.dealInvoice.findMany({
    where:  { zohoInvoiceId: { in: ids } },
    select: { zohoInvoiceId: true },
  })
  const known    = new Set(existing.map(e => e.zohoInvoiceId))
  const toCreate = ids.filter(id => !known.has(id))
  if (!toCreate.length) return 0

  await prisma.dealInvoice.createMany({
    data: toCreate.map(id => {
      const zoho = zohoMap[id]
      return {
        crmDealId:     `zoho-inv-${id}`,
        crmDealName:   zoho.customer_name || 'Unknown',
        zohoInvoiceId: id,
        status:        STATUS_MAP[zoho.status] || 'SENT',
        amountTotal:   parseFloat(zoho.total || 0) || null,
        dueDate:       zoho.due_date ? new Date(zoho.due_date) : null,
        triggerSource: 'ZOHO_BACKFILL',
      }
    }),
    skipDuplicates: true,
  })

  return toCreate.length
}

// ── Core poll ─────────────────────────────────────────────────────────────────

async function pollPayments({ dryRun = true, lookAheadDays = 7, limit = 200 }) {
  // 0. Adopt any Zoho Books invoices RevOps doesn't know about yet — this is a
  // passive local mirror of what already exists in Books, not a write to
  // Zoho, so it runs regardless of dryRun.
  let backfilled = 0
  try {
    backfilled = await backfillOpenInvoices(limit)
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      return { ok: true, message: 'DealInvoice table not migrated — nothing to poll', totals: {} }
    }
    console.warn('[payments] backfill failed:', e.message)
  }

  // 1. Load all in-flight local invoices (not DRAFT, PAID, VOID)
  let localInvoices
  try {
    localInvoices = await prisma.dealInvoice.findMany({
      where: {
        status:        { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
        zohoInvoiceId: { not: null },
      },
      orderBy: { dueDate: 'asc' },
    })
  } catch (e) {
    if (isPrismaTableMissing(e)) {
      return { ok: true, message: 'DealInvoice table not migrated — nothing to poll', totals: {} }
    }
    throw e
  }

  if (!localInvoices.length) {
    return { ok: true, message: 'No open invoices to track', totals: { checked: 0, backfilled } }
  }

  // 2. Fetch open invoices from Zoho Books (parallel: sent, overdue, partial)
  const zohoMap = {} // invoice_id → zoho invoice object
  const filters = ['Status.Sent', 'Status.Overdue', 'Status.PartiallyPaid']

  await Promise.all(filters.map(async filter => {
    try {
      const data = await booksGet(`/invoices?filter_by=${filter}&per_page=${limit}&sort_column=due_date&sort_order=A`)
      for (const inv of data.invoices || []) {
        zohoMap[inv.invoice_id] = inv
      }
    } catch (e) {
      console.warn('[payments] booksGet', filter, ':', e.message)
    }
  }))

  // For local invoices not found in open filters — fetch individually to catch paid/void
  const missingIds = localInvoices
    .map(li => li.zohoInvoiceId)
    .filter(id => id && !zohoMap[id])

  await Promise.all(missingIds.map(async id => {
    try {
      const data = await booksGet(`/invoices/${id}`)
      if (data.invoice) zohoMap[id] = data.invoice
    } catch { /* skip — Zoho may 404 if deleted */ }
  }))

  // 3. Diff local vs live and collect changes
  const changes   = []
  const nowPaid   = []
  const updates   = []

  for (const local of localInvoices) {
    const zoho = zohoMap[local.zohoInvoiceId]
    if (!zoho) continue

    const newStatus  = STATUS_MAP[zoho.status] || local.status
    const amountPaid = parseFloat(zoho.payment_made || 0) || null
    const changed    = newStatus !== local.status

    if (changed) {
      changes.push({
        dealInvoiceId: local.id,
        zohoInvoiceId: local.zohoInvoiceId,
        crmDealName:   local.crmDealName,
        amountTotal:   local.amountTotal != null ? Number(local.amountTotal) : null,
        amountPaid,
        from:          local.status,
        to:            newStatus,
        dueDate:       fmtDate(local.dueDate),
      })
      if (newStatus === 'PAID') nowPaid.push({ ...local, amountPaid })
    }

    if (!dryRun && changed) {
      updates.push(
        prisma.dealInvoice.update({
          where: { id: local.id },
          data:  {
            status:     newStatus,
            amountPaid: amountPaid ?? undefined,
            updatedAt:  new Date(),
          },
        }).catch(e => console.warn('[payments] update', local.id, ':', e.message))
      )
    }
  }

  if (updates.length) await Promise.all(updates)

  // 4. Reload current state for reminder collection
  let current
  try {
    current = await prisma.dealInvoice.findMany({
      where: {
        status:        { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
        zohoInvoiceId: { not: null },
        dueDate:       { not: null },
      },
      orderBy: { dueDate: 'asc' },
    })
  } catch {
    current = localInvoices // fall back to pre-update snapshot
  }

  const today          = Date.now()
  const lookAheadMs    = lookAheadDays * 86_400_000
  const overdueList    = []
  const upcomingList   = []

  // AR aging — the full open-invoice universe, not just the 7-day lookahead window
  const arBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
  let arTotal = 0

  for (const inv of current) {
    if (!inv.dueDate) continue
    const dueMs = new Date(inv.dueDate).getTime()
    if (inv.status === 'OVERDUE' || dueMs < today) {
      overdueList.push(inv)
    } else if (dueMs - today <= lookAheadMs) {
      upcomingList.push(inv)
    }

    const amt = inv.amountTotal != null ? Number(inv.amountTotal) : 0
    arTotal += amt
    const daysOverdue = Math.floor((today - dueMs) / 86_400_000)
    if (daysOverdue <= 0)       arBuckets.current += amt
    else if (daysOverdue <= 30) arBuckets.d1_30    += amt
    else if (daysOverdue <= 60) arBuckets.d31_60   += amt
    else if (daysOverdue <= 90) arBuckets.d61_90   += amt
    else                        arBuckets.d90plus  += amt
  }

  // 5. Slack notify (live mode only)
  if (!dryRun) {
    await buildAndSendSlack(overdueList, upcomingList, nowPaid, changes)
  }

  return {
    ok:      true,
    dryRun,
    totals: {
      checked:    localInvoices.length,
      backfilled,
      updated:    changes.length,
      overdue:    overdueList.length,
      upcoming:   upcomingList.length,
      paid:       nowPaid.length,
    },
    ar: {
      total:   Math.round(arTotal * 100) / 100,
      buckets: Object.fromEntries(Object.entries(arBuckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    },
    changes,
    overdue:  overdueList.map(summarise),
    upcoming: upcomingList.map(summarise),
  }
}

function summarise(inv) {
  return {
    dealInvoiceId: inv.id,
    zohoInvoiceId: inv.zohoInvoiceId,
    crmDealName:   inv.crmDealName,
    status:        inv.status,
    amountTotal:   inv.amountTotal != null ? Number(inv.amountTotal) : null,
    dueDate:       fmtDate(inv.dueDate),
    daysFromNow:   inv.dueDate ? daysFromNow(inv.dueDate) : null,
  }
}

// ── Slack message builder ─────────────────────────────────────────────────────

async function buildAndSendSlack(overdueList, upcomingList, nowPaid, changes) {
  const sections = []

  if (overdueList.length) {
    const lines = overdueList.map(inv => {
      const ago  = Math.abs(daysFromNow(inv.dueDate))
      const link = inv.zohoInvoiceId ? ` — <${invoiceUrl(inv.zohoInvoiceId)}|View>` : ''
      return `• ${inv.crmDealName || 'Unknown'} — ${fmt$(inv.amountTotal)} — due ${fmtDate(inv.dueDate)} (${ago}d overdue)${link}`
    })
    sections.push(`🔴 *${overdueList.length} invoice${overdueList.length > 1 ? 's' : ''} OVERDUE*\n${lines.join('\n')}`)
  }

  if (upcomingList.length) {
    const lines = upcomingList.map(inv => {
      const days = daysFromNow(inv.dueDate)
      const link = inv.zohoInvoiceId ? ` — <${invoiceUrl(inv.zohoInvoiceId)}|View>` : ''
      return `• ${inv.crmDealName || 'Unknown'} — ${fmt$(inv.amountTotal)} — due ${fmtDate(inv.dueDate)} (${days}d)${link}`
    })
    sections.push(`🟡 *${upcomingList.length} invoice${upcomingList.length > 1 ? 's' : ''} due soon*\n${lines.join('\n')}`)
  }

  if (nowPaid.length) {
    const lines = nowPaid.map(inv =>
      `• ${inv.crmDealName || 'Unknown'} — ${fmt$(inv.amountPaid || inv.amountTotal)} paid`
    )
    sections.push(`✅ *${nowPaid.length} invoice${nowPaid.length > 1 ? 's' : ''} paid*\n${lines.join('\n')}`)
  }

  if (!sections.length) return

  await postSlack(sections.join('\n\n'))
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })

  const {
    dryRun       = true,
    lookAheadDays = 7,
    limit         = 200,
  } = req.body || {}

  try {
    const result = await pollPayments({ dryRun, lookAheadDays, limit })
    return res.json(result)
  } catch (err) {
    console.error('[payments]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
