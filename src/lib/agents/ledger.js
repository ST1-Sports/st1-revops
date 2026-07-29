/**
 * Ledger — ST1's finance/accounting agent.
 *
 * Four capabilities:
 *   invoice      — create a Zoho Books invoice from a CRM "Closed Won" deal
 *   reconcile    — pull uncategorized bank/card transactions, propose a coding for
 *                  each (remembered correction → matched invoice/bill/team-store →
 *                  Zoho Books bank rule), and queue them for human approval. Never
 *                  pushes to Zoho Books itself — only an explicit "approve" does.
 *   vendor-bill  — parse and map a vendor invoice file to a Zoho Books bill
 *   payments     — poll Zoho Books invoice status changes, surface overdue/upcoming
 *
 * Client-side definition only. Real work runs server-side in
 * api/agents/ledger/reconcile.js (+ invoice.js, vendor-bill.js, payments.js).
 */
export default {
  id:           'ledger',
  name:         'Ledger',
  capabilities: ['invoice', 'reconcile', 'vendor-bill', 'payments'],
  type:         'agent',
  roles:        ['admin', 'manager'],   // finance tasks — not exposed to sales_rep
  enabled:      true,

  description:
    'Handles ST1 finance and accounting tasks. Creates Zoho Books invoices when ' +
    'a CRM deal is marked Closed Won (capability: invoice). Pulls uncategorized bank ' +
    'deposits and credit card charges, proposes a coding for each from memory/matched ' +
    'records/Zoho Books rules, and queues them for approval — never auto-categorizes ' +
    'in Zoho on its own (capability: reconcile). Parses vendor bill PDFs and maps line ' +
    'items to purchase orders (capability: vendor-bill). Checks invoice payment status ' +
    'and surfaces overdue/upcoming (capability: payments). Use /reconcile to pull the ' +
    'review queue, /bill to process a vendor invoice, or "create invoice for [deal]" ' +
    'after a win.',

  dataSources: ['zoho_books', 'stripe', 'agent_memory'],

  guardrails: {
    sideEffects:      true,
    requiresApproval: true,            // reconcile only proposes — approval is a separate explicit call
    dryRunDefault:    false,           // reconcile writes proposals to the review queue by default (safe — no Zoho write happens until approve)
  },

  async handler(task, input = {}) {
    const serverTask =
      input.task ||
      (/reconcil/i.test(task)                          ? 'reconcile'   :
       /\bvendor\b|\/bill\b|vendor.?bill/i.test(task)  ? 'vendor-bill' :
       /invoice|closed.?won|deal.?won/i.test(task)     ? 'invoice'     :
       /payment|overdue|reminder/i.test(task)          ? 'payments'    :
       'reconcile')

    const isInvoice    = serverTask === 'invoice'
    const isPayments   = serverTask === 'payments'
    const isVendorBill = serverTask === 'vendor-bill'
    const endpoint     = isInvoice    ? '/api/agents/ledger/invoice'
                       : isPayments   ? '/api/agents/ledger/payments'
                       : isVendorBill ? '/api/agents/ledger/vendor-bill'
                       :                '/api/agents/ledger/reconcile'
    const body         = isInvoice
      ? { action: 'draft', crmDealId: input.crmDealId, crmDealName: input.crmDealName, dryRun: input.dryRun ?? true }
      : isPayments
      ? { dryRun: input.dryRun ?? true, lookAheadDays: input.lookAheadDays ?? 7, limit: input.limit ?? 200 }
      : isVendorBill
      ? { action: 'extract', pdfBase64: input.pdfBase64 || null, dryRun: input.dryRun ?? true }
      : { task: serverTask, dryRun: input.dryRun ?? false, limit: input.limit ?? 10 }

    const r = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`Ledger ${r.status}: ${await r.text().catch(() => '')}`)

    const d = await r.json()
    const summary =
      isVendorBill
        ? d.message || `Vendor bill: ${d.bill?.mappedCount ?? 0} mapped, ${d.bill?.reviewCount ?? 0} need review`
        : isPayments && d.totals
        ? `Payments: ${d.totals.checked ?? 0} checked — ` +
          `${d.totals.updated ?? 0} updated, ` +
          `${d.totals.overdue ?? 0} overdue, ` +
          `${d.totals.upcoming ?? 0} upcoming`
        : d.totals
        ? `Ledger: ${d.totals.polled ?? 0} pulled — ` +
          `${d.totals.withSuggestion ?? 0} coded, ` +
          `${d.totals.pending ?? 0} awaiting approval`
        : d.message || 'Ledger task complete'

    return { output: summary, metadata: d }
  },
}
