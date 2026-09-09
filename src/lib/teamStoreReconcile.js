/**
 * Team Store money-movement reconciliation — pure matching, no I/O. Matches
 * real-money events (Stripe charges for money in; Stripe payouts or a bank
 * feed's settled transactions for money out) against TeamStoreOrder /
 * PayablePayment rows already synced/recorded elsewhere.
 *
 * Nothing here decides anything on its own — every candidate carries a
 * confidence score for a human to accept or reject (see SettlementMatch in
 * the schema, which is the only place a match becomes real). A fuzzy match
 * is never auto-applied.
 *
 * Money-out sources are normalized to one GENERIC settled-transaction shape
 * before matching — { source, id, date, amount, direction, counterparty,
 * reference } — so a bank feed is a second source for the same matcher,
 * not a rewrite of it.
 */

function num(v) { return Number(v) || 0; }
function roundCents(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function roundTo(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function daysBetween(a, b) {
  const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

// ── Money in: Stripe charges ─────────────────────────────────────────────

/**
 * Stripe's own documented, versioned API shape (not a guess, unlike the ST1
 * admin app's endpoints): `amount` is an integer in cents, `created` a
 * unix-seconds timestamp. The processing fee lives on the charge's balance
 * transaction and is only present if the charges list was fetched with
 * `expand[]=data.balance_transaction` — also in cents. If it wasn't
 * expanded, `balance_transaction` is just a string id and feeAmount is null.
 */
export function normalizeStripeCharge(charge) {
  const bt = charge?.balance_transaction;
  const fee = bt && typeof bt === 'object' ? num(bt.fee) / 100 : null;
  return {
    id: charge?.id,
    amount: roundCents(num(charge?.amount) / 100),
    date: charge?.created ? new Date(num(charge.created) * 1000).toISOString() : null,
    feeAmount: fee != null ? roundCents(fee) : null,
    description: charge?.description || '',
    metadata: charge?.metadata || {},
  };
}

/**
 * Does this (already-normalized) charge carry the order's own reference
 * number anywhere on it? Grounded in this codebase's existing Stripe usage
 * (api/stripe/index.js's `stores`/`recent` actions), which already parses
 * the order reference out of `description` in the observed format
 * "#ST1-26-00347 / <store name>" — but since metadata KEYS aren't
 * guaranteed (only that format was actually observed), this scans every
 * metadata VALUE rather than assuming a specific key exists.
 */
export function chargeReferencesOrder(normalizedCharge, order) {
  const ref = String(order?.referenceNumber || '').trim();
  if (!ref) return false;
  if (normalizedCharge.description && normalizedCharge.description.includes(ref)) return true;
  return Object.values(normalizedCharge.metadata || {}).some(v => String(v).includes(ref));
}

function moneyInConfidence(referenceMatched, dayDiff) {
  if (referenceMatched) return dayDiff == null ? 0.95 : Math.max(0.9, roundTo(0.99 - dayDiff * 0.02, 2));
  if (dayDiff == null) return 0.4;
  return Math.max(0.3, roundTo(0.85 - dayDiff * 0.15, 2));
}

/**
 * Matches unconfirmed orders to (already-normalized) Stripe charges. Every
 * candidate within tolerance is returned, not just the best one — an order
 * with more than one candidate is `ambiguous` and every candidate's
 * confidence is capped, since only a human can tell which charge is real.
 */
export function matchOrdersToCharges(orders, charges, opts = {}) {
  const amountTolerance = opts.amountTolerance ?? 0.01;
  const dateToleranceDays = opts.dateToleranceDays ?? 3;

  const matches = [];
  const unmatchedOrders = [];

  for (const order of orders || []) {
    const orderAmount = roundCents(num(order.totalAmount));
    const orderDate = order.paidAt || order.createdAt;

    const candidates = (charges || [])
      .map(charge => ({
        charge,
        dayDiff: orderDate && charge.date ? daysBetween(orderDate, charge.date) : null,
        referenceMatched: chargeReferencesOrder(charge, order),
      }))
      .filter(c => Math.abs(c.charge.amount - orderAmount) <= amountTolerance)
      .filter(c => c.referenceMatched || (c.dayDiff != null && c.dayDiff <= dateToleranceDays));

    if (!candidates.length) { unmatchedOrders.push(order); continue; }

    const ambiguous = candidates.length > 1;
    for (const c of candidates) {
      const confidence = moneyInConfidence(c.referenceMatched, c.dayDiff);
      matches.push({
        order,
        charge: c.charge,
        confidence: ambiguous ? Math.min(confidence, 0.5) : confidence,
        ambiguous,
        suggestionBasis: c.referenceMatched ? 'reference' : 'amount_date',
        dayDiff: c.dayDiff,
      });
    }
  }

  const matchedChargeIds = new Set(matches.map(m => m.charge.id));
  const unmatchedCharges = (charges || []).filter(c => !matchedChargeIds.has(c.id));

  return { matches, unmatchedOrders, unmatchedCharges };
}

/** Gross collected / fees / net for a set of confirmed (or proposed) money-in matches. */
export function summarizeMoneyIn(matches) {
  let gross = 0;
  let fees = 0;
  for (const m of matches || []) {
    gross += m.charge.amount;
    fees += m.charge.feeAmount || 0;
  }
  return {
    matchedCount: (matches || []).length,
    grossCollected: roundCents(gross),
    totalFees: roundCents(fees),
    netRetained: roundCents(gross - fees),
  };
}

// ── Money out: a generic settled-transaction shape ───────────────────────

/**
 * Stripe payout/transfer field names here are UNVERIFIED — nothing in this
 * codebase has ever listed payouts or transfers (only charges, via
 * api/stripe/index.js and the balance_transaction lookups in
 * api/agents/ledger/reconcile.js). Confirm against a real payout object
 * before trusting this; everything else in this module only depends on the
 * normalized shape below, not on Stripe's actual payout fields.
 */
export function normalizeStripePayout(payout) {
  const dateSeconds = payout?.arrival_date ?? payout?.created;
  return {
    source: 'stripe_payout',
    id: payout?.id,
    date: dateSeconds ? new Date(num(dateSeconds) * 1000).toISOString() : null,
    amount: roundCents(num(payout?.amount) / 100),
    direction: 'debit',
    counterparty: payout?.description || null,
    reference: payout?.id || null,
  };
}

/**
 * A bank feed's settled-transaction shape is intentionally NOT guessed here
 * — no bank connector's real field names are assumed. Whatever the actual
 * source (a bank API, an export, Zoho Books' own bank-transactions feed),
 * the caller normalizes into this shape before calling the matcher below.
 */
export function normalizeBankTransaction({ id, date, amount, direction, counterparty, reference } = {}) {
  return {
    source: 'bank_transaction',
    id,
    date,
    amount: roundCents(Math.abs(num(amount))),
    direction, // 'debit' | 'credit'
    counterparty: counterparty || null,
    reference: reference || null,
  };
}

function paymentReferenceMatched(payment, transaction) {
  const needle = String(payment.reference || '').trim();
  if (!needle) return false;
  const haystack = `${transaction.reference || ''} ${transaction.counterparty || ''}`;
  return haystack.includes(needle);
}

function moneyOutConfidence(referenceMatched, dayDiff) {
  if (referenceMatched) return dayDiff == null ? 0.9 : Math.max(0.85, roundTo(0.97 - dayDiff * 0.02, 2));
  if (dayDiff == null) return 0.3;
  return Math.max(0.25, roundTo(0.75 - dayDiff * 0.1, 2));
}

/**
 * Matches PayablePayment rows (already recorded on the AP screen — this
 * never creates a payment, only confirms one that exists) to settled
 * transactions from ANY source, as long as each is normalized to the
 * generic shape above — a Stripe payout and a bank feed row are
 * interchangeable here. Only debit (money leaving the account) transactions
 * are ever considered, since these are all ST1-pays-a-partner events.
 */
export function matchPaymentsToSettledTransactions(payments, transactions, opts = {}) {
  const amountTolerance = opts.amountTolerance ?? 0.01;
  const dateToleranceDays = opts.dateToleranceDays ?? 5;
  const debits = (transactions || []).filter(t => t.direction === 'debit');

  const matches = [];
  const unmatchedPayments = [];

  for (const payment of payments || []) {
    const amount = roundCents(num(payment.amountPaid));
    const candidates = debits
      .map(t => ({
        t,
        dayDiff: payment.paidOn && t.date ? daysBetween(payment.paidOn, t.date) : null,
        referenceMatched: paymentReferenceMatched(payment, t),
      }))
      .filter(c => Math.abs(c.t.amount - amount) <= amountTolerance)
      .filter(c => c.referenceMatched || (c.dayDiff != null && c.dayDiff <= dateToleranceDays));

    if (!candidates.length) { unmatchedPayments.push(payment); continue; }

    const ambiguous = candidates.length > 1;
    for (const c of candidates) {
      const confidence = moneyOutConfidence(c.referenceMatched, c.dayDiff);
      matches.push({
        payment,
        transaction: c.t,
        confidence: ambiguous ? Math.min(confidence, 0.5) : confidence,
        ambiguous,
        suggestionBasis: c.referenceMatched ? 'reference' : 'amount_date',
        dayDiff: c.dayDiff,
      });
    }
  }

  const matchedTxnIds = new Set(matches.map(m => m.transaction.id));
  const unmatchedTransactions = debits.filter(t => !matchedTxnIds.has(t.id));

  return { matches, unmatchedPayments, unmatchedTransactions };
}

/** Coarse label for a confidence score, for a UI badge — the number itself is what's stored. */
export function confidenceLabel(confidence) {
  if (confidence == null) return "none";
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * A source confirms at most one target, and a target has at most one
 * confirmed source. Given the still-pending candidates competing with a
 * just-approved match on either axis, returns the ids that must now be
 * rejected — every one of them is for a target or a source that already has
 * its answer.
 */
export function matchesToReject(pendingCandidates, approvedMatch) {
  return (pendingCandidates || [])
    .filter(c => c.id !== approvedMatch.id)
    .filter(c =>
      (c.targetType === approvedMatch.targetType && c.targetId === approvedMatch.targetId) ||
      (c.sourceType === approvedMatch.sourceType && c.sourceId === approvedMatch.sourceId))
    .map(c => c.id);
}
