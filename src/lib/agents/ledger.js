/**
 * Ledger — ST1's finance/accounting agent.
 *
 * Three capabilities:
 *   invoice      — create a Zoho Books invoice from a CRM "Closed Won" deal
 *   reconcile    — match uncategorized Stripe/Shopify deposits to team stores or invoices
 *   vendor-bill  — parse and map a vendor invoice file to a Zoho Books bill
 *
 * Client-side definition only. Real work runs server-side in
 * api/agents/ledger/reconcile.js.
 */
export default {
  id:           'ledger',
  name:         'Ledger',
  capabilities: ['invoice', 'reconcile', 'vendor-bill'],
  type:         'agent',
  roles:        ['admin', 'manager'],   // finance tasks — not exposed to sales_rep
  enabled:      true,

  description:
    'Handles ST1 finance and accounting tasks. Creates Zoho Books invoices when ' +
    'a CRM deal is marked Closed Won (capability: invoice). Reconciles uncategorized ' +
    'Stripe and Shopify bank deposits to team stores or open invoices and flags ' +
    'anything that needs manual review (capability: reconcile). Parses vendor bill ' +
    'PDFs and maps line items to purchase orders (capability: vendor-bill). ' +
    'Use /reconcile to match deposits, /bill to process a vendor invoice, or ' +
    '"create invoice for [deal]" after a win.',

  dataSources: ['zoho_books', 'stripe', 'agent_memory'],

  guardrails: {
    sideEffects:      true,
    requiresApproval: false,           // reconcile dry-runs by default; invoice writes on confirm
    dryRunDefault:    true,            // reconcile never writes without explicit dryRun:false
  },

  async handler(task, input = {}) {
    // Determine server-side task from explicit input or keyword fallback
    const serverTask =
      input.task ||
      (/reconcil/i.test(task)               ? 'reconcile'   :
       /\bvendor\b|\/bill\b|vendor.?bill/i.test(task) ? 'vendor-bill'  :
       'invoice')

    const body = {
      task:   serverTask,
      dryRun: input.dryRun ?? true,   // always safe-default
      limit:  input.limit  ?? 10,
    }
    if (input.crmDealId)   body.crmDealId   = input.crmDealId
    if (input.crmDealName) body.crmDealName = input.crmDealName

    const r = await fetch('/api/agents/ledger/reconcile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`Ledger ${r.status}: ${await r.text().catch(() => '')}`)

    const d = await r.json()
    const summary =
      d.totals
        ? `Ledger: ${d.totals.polled ?? 0} checked — ` +
          `${d.totals.matchedStore ?? 0} store, ` +
          `${d.totals.matchedInvoice ?? 0} invoice, ` +
          `${d.totals.needsReview ?? 0} needs review`
        : d.message || 'Ledger task complete'

    return { output: summary, metadata: d }
  },
}
