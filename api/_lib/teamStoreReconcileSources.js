/**
 * Real-money data sources for Team Store reconciliation. Each fetcher here
 * hits an API this codebase already talks to for other purposes — no new
 * integration is added. Every raw shape is normalized (via
 * src/lib/teamStoreReconcile.js's normalize* functions) before it reaches
 * the pure matcher, so the matcher itself never depends on any of these
 * providers' actual field names.
 */
import { booksGet } from './zoho-books.js';
import { normalizeStripeCharge, normalizeStripePayout, normalizeBankTransaction } from '../../src/lib/teamStoreReconcile.js';

// ── Stripe (money in: charges; money out: payouts) ───────────────────────
// Same raw-fetch pattern already used in api/stripe/index.js and
// api/agents/ledger/reconcile.js — there's no shared Stripe client in this
// codebase to import, so this replicates the established approach rather
// than inventing a fourth, different one.
const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

async function stripeGet(path, params = {}) {
  const url = new URL(`${STRIPE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${stripeKey()}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Stripe ${res.status}`);
  return body;
}

/** Charges in [sinceDate, untilDate), normalized, with the processing fee expanded. */
export async function fetchStripeChargesNormalized(sinceDate, untilDate) {
  const charges = [];
  let hasMore = true;
  let startingAfter;
  while (hasMore) {
    const data = await stripeGet('/charges', {
      limit: 100,
      'created[gte]': Math.floor(new Date(sinceDate).getTime() / 1000),
      'created[lt]': Math.floor(new Date(untilDate).getTime() / 1000),
      'expand[]': 'data.balance_transaction',
      starting_after: startingAfter,
    });
    for (const c of data.data || []) if (c.status === 'succeeded') charges.push(normalizeStripeCharge(c));
    hasMore = !!data.has_more;
    startingAfter = data.data?.[data.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return charges;
}

/**
 * Stripe payout field names are UNVERIFIED here — nothing in this codebase
 * has ever listed payouts (only charges, and balance_transactions filtered
 * by a payout id). Confirm against a real payout object before trusting
 * this; normalizeStripePayout() is the one place to correct it.
 */
export async function fetchStripePayoutsNormalized(sinceDate, untilDate) {
  const data = await stripeGet('/payouts', {
    limit: 100,
    'arrival_date[gte]': Math.floor(new Date(sinceDate).getTime() / 1000),
    'arrival_date[lt]': Math.floor(new Date(untilDate).getTime() / 1000),
  });
  return (data.data || []).map(normalizeStripePayout);
}

// ── Zoho Books' bank feed (money out: check clearing) ────────────────────
// There is no direct bank connector ("Grasshopper" or otherwise) anywhere
// in this codebase — verified by searching the full repo and git history.
// What actually plays that role today is Zoho Books' own bank-transactions
// feed for the ST1 Operating Account, already used for this exact account
// by api/agents/ledger/reconcile.js (its FIXED.operating constant — same
// id, reproduced here since that file's constant isn't exported).
const ST1_OPERATING_ACCOUNT_ID = '7255504000000180097';

/**
 * Settled EXPENSE transactions (money leaving the Operating account) in a
 * date range, normalized to the generic settled-transaction shape.
 * Deliberately does not filter by categorization status — unlike Ledger's
 * own `fetchUncategorized`, this needs every settled outflow regardless of
 * whether it's already been GL-coded, since that's an orthogonal concern to
 * "did this payable actually clear."
 */
export async function fetchOperatingAccountDebitsNormalized(sinceDate, untilDate) {
  const dateStart = new Date(sinceDate).toISOString().slice(0, 10);
  const dateEnd = new Date(untilDate).toISOString().slice(0, 10);
  const data = await booksGet(
    `/banktransactions?account_id=${ST1_OPERATING_ACCOUNT_ID}` +
    `&transaction_type=expense&date_start=${dateStart}&date_end=${dateEnd}&per_page=200`,
  );
  return (data.banktransactions || []).map(txn => normalizeBankTransaction({
    id: txn.transaction_id,
    date: txn.date,
    amount: txn.amount,
    direction: 'debit',
    counterparty: txn.payee || txn.description || null,
    reference: txn.reference_number || null,
  }));
}
