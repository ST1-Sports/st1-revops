/**
 * One-time check for Zoho Books invoices our API created on the wrong
 * customer or as a lump-sum "Athletic Equipment / Services" line.
 *
 * Dry-run by default — lists matches, never deletes.
 *
 *   node scripts/audit-bogus-invoices.mjs
 *   node scripts/audit-bogus-invoices.mjs --apply   # still does not delete; same list
 *
 * Requires ZOHO_* env (same as the app). Prefer POST
 * /api/agents/ledger/invoice { action: "audit" } against production if you
 * don't have local Zoho credentials.
 */
import { booksGet } from '../api/_lib/zoho-books.js'
import { listBogusApiInvoices } from '../api/_lib/booksInvoice.js'

const apply = process.argv.includes('--apply')
if (apply) {
  console.log('Note: --apply does not delete anything. This script is list-only.')
}

const flagged = await listBogusApiInvoices(booksGet)
console.log(JSON.stringify({
  dryRun: true,
  deleted: 0,
  count: flagged.length,
  invoices: flagged,
}, null, 2))

if (!flagged.length) {
  console.error('No API invoices with a missing reference_number or generic Athletic Equipment / Services line.')
} else {
  console.error(`Found ${flagged.length} invoice(s). Nothing was deleted.`)
}
