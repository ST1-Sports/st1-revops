import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStripeCharge,
  chargeReferencesOrder,
  matchOrdersToCharges,
  summarizeMoneyIn,
  normalizeStripePayout,
  normalizeBankTransaction,
  matchPaymentsToSettledTransactions,
  confidenceLabel,
  matchesToReject,
} from './teamStoreReconcile.js';

// ── Stripe charge normalization ──────────────────────────────────────────
describe('normalizeStripeCharge', () => {
  it('converts cents to dollars and the unix timestamp to ISO', () => {
    const n = normalizeStripeCharge({ id: 'ch_1', amount: 29217, created: 1755000000, description: '#ST1-26-00516 / ADM Tigers', metadata: {} });
    assert.equal(n.amount, 292.17);
    assert.equal(n.date, new Date(1755000000 * 1000).toISOString());
    assert.equal(n.feeAmount, null); // balance_transaction not expanded
  });

  it('reads the fee off an expanded balance_transaction, in cents', () => {
    const n = normalizeStripeCharge({ id: 'ch_1', amount: 10000, created: 1755000000, balance_transaction: { fee: 320 } });
    assert.equal(n.feeAmount, 3.20);
  });

  it('handles a charge with no metadata at all, rather than throwing', () => {
    const n = normalizeStripeCharge({ id: 'ch_1', amount: 100, created: 1755000000 });
    assert.deepEqual(n.metadata, {});
    assert.equal(n.description, '');
  });
});

describe('chargeReferencesOrder', () => {
  const order = { referenceNumber: 'ST1-26-00516' };

  it('finds the order reference in the description, the observed real format', () => {
    const charge = normalizeStripeCharge({ id: 'ch_1', amount: 1, created: 1, description: '#ST1-26-00516 / ADM Tigers Cross Country' });
    assert.equal(chargeReferencesOrder(charge, order), true);
  });

  it('finds it in a metadata value even without knowing the key name', () => {
    const charge = normalizeStripeCharge({ id: 'ch_1', amount: 1, created: 1, metadata: { some_unexpected_key: 'order ST1-26-00516 checkout' } });
    assert.equal(chargeReferencesOrder(charge, order), true);
  });

  it('is false when the reference appears nowhere', () => {
    const charge = normalizeStripeCharge({ id: 'ch_1', amount: 1, created: 1, description: '#ST1-26-00999 / Some Other School' });
    assert.equal(chargeReferencesOrder(charge, order), false);
  });
});

// ── Money in: matching orders to charges ─────────────────────────────────
describe('matchOrdersToCharges', () => {
  const order = { id: 'o-1', referenceNumber: 'ST1-26-00516', totalAmount: 292.17, paidAt: '2026-08-12T00:00:00Z' };

  it('gives a reference-confirmed same-day match very high confidence', () => {
    const charge = normalizeStripeCharge({ id: 'ch_1', amount: 29217, created: Math.floor(new Date('2026-08-12T00:00:00Z').getTime() / 1000), description: '#ST1-26-00516 / ADM Tigers' });
    const { matches, unmatchedOrders, unmatchedCharges } = matchOrdersToCharges([order], [charge]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].confidence, 0.99); // same-day + reference match
    assert.equal(matches[0].suggestionBasis, 'reference');
    assert.equal(matches[0].ambiguous, false);
    assert.equal(unmatchedOrders.length, 0);
    assert.equal(unmatchedCharges.length, 0);
  });

  it('still matches on amount+date alone, at a lower confidence, when there is no reference signal', () => {
    const charge = normalizeStripeCharge({ id: 'ch_2', amount: 29217, created: Math.floor(new Date('2026-08-13T00:00:00Z').getTime() / 1000), description: 'no order info here' });
    const { matches } = matchOrdersToCharges([order], [charge]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].suggestionBasis, 'amount_date');
    assert.ok(matches[0].confidence < 0.9, `expected a lower confidence, got ${matches[0].confidence}`);
    assert.ok(matches[0].confidence > 0, `expected a positive confidence, got ${matches[0].confidence}`);
  });

  it('caps confidence and flags ambiguous when two charges both match the same order', () => {
    const day = Math.floor(new Date('2026-08-12T00:00:00Z').getTime() / 1000);
    const chargeA = normalizeStripeCharge({ id: 'ch_a', amount: 29217, created: day });
    const chargeB = normalizeStripeCharge({ id: 'ch_b', amount: 29217, created: day });
    const { matches } = matchOrdersToCharges([order], [chargeA, chargeB]);
    assert.equal(matches.length, 2);
    assert.ok(matches.every(m => m.ambiguous));
    assert.ok(matches.every(m => m.confidence <= 0.5));
  });

  it('puts an order with no candidate charge in unmatchedOrders', () => {
    const charge = normalizeStripeCharge({ id: 'ch_3', amount: 999.99, created: 1 });
    const { matches, unmatchedOrders } = matchOrdersToCharges([order], [charge]);
    assert.equal(matches.length, 0);
    assert.equal(unmatchedOrders.length, 1);
    assert.equal(unmatchedOrders[0].id, 'o-1');
  });

  it('puts a charge that matches no order in unmatchedCharges', () => {
    const charge = normalizeStripeCharge({ id: 'ch_4', amount: 5.00, created: 1 });
    const { unmatchedCharges } = matchOrdersToCharges([order], [charge]);
    assert.equal(unmatchedCharges.length, 1);
    assert.equal(unmatchedCharges[0].id, 'ch_4');
  });

  it('excludes a same-amount charge outside the date tolerance unless a reference confirms it', () => {
    const farCharge = normalizeStripeCharge({ id: 'ch_5', amount: 29217, created: Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000) });
    const { matches, unmatchedOrders } = matchOrdersToCharges([order], [farCharge]);
    assert.equal(matches.length, 0);
    assert.equal(unmatchedOrders.length, 1);
  });
});

describe('summarizeMoneyIn', () => {
  it('sums gross, fees, and net across matches', () => {
    const matches = [
      { charge: { amount: 100.00, feeAmount: 3.20 } },
      { charge: { amount: 50.00, feeAmount: 1.75 } },
    ];
    const s = summarizeMoneyIn(matches);
    assert.equal(s.matchedCount, 2);
    assert.equal(s.grossCollected, 150.00);
    assert.equal(s.totalFees, 4.95);
    assert.equal(s.netRetained, 145.05);
  });

  it('handles a charge with no known fee as zero, not NaN', () => {
    const s = summarizeMoneyIn([{ charge: { amount: 20.00, feeAmount: null } }]);
    assert.equal(s.totalFees, 0);
    assert.equal(s.netRetained, 20.00);
  });
});

// ── Money out: the generic settled-transaction shape ─────────────────────
describe('normalizeStripePayout', () => {
  it('converts cents to dollars and prefers arrival_date over created', () => {
    const n = normalizeStripePayout({ id: 'po_1', amount: 278975, arrival_date: 1755100000, created: 1755000000, description: 'PMP Printing payout' });
    assert.equal(n.amount, 2789.75);
    assert.equal(n.date, new Date(1755100000 * 1000).toISOString());
    assert.equal(n.direction, 'debit');
    assert.equal(n.source, 'stripe_payout');
  });
});

describe('normalizeBankTransaction', () => {
  it('takes the shape as given, absolute-valuing the amount', () => {
    const n = normalizeBankTransaction({ id: 'txn_1', date: '2026-08-15', amount: -435.68, direction: 'debit', counterparty: 'ADM Tigers', reference: 'CHK-1042' });
    assert.equal(n.amount, 435.68);
    assert.equal(n.source, 'bank_transaction');
    assert.equal(n.counterparty, 'ADM Tigers');
  });
});

describe('matchPaymentsToSettledTransactions', () => {
  const payment = { payableKey: 'ST1-26-00706~team_store~adm-tigers', amountPaid: 435.68, paidOn: '2026-08-15T00:00:00Z', reference: 'CHK-1042' };

  it('gives a reference match (check number found in the transaction) very high confidence', () => {
    const txn = normalizeBankTransaction({ id: 'txn_1', date: '2026-08-16T00:00:00Z', amount: 435.68, direction: 'debit', reference: 'CHK-1042 cleared' });
    const { matches } = matchPaymentsToSettledTransactions([payment], [txn]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].suggestionBasis, 'reference');
    assert.ok(matches[0].confidence >= 0.85);
  });

  it('still matches on amount+date alone at a lower confidence with no reference', () => {
    const txn = normalizeBankTransaction({ id: 'txn_2', date: '2026-08-17T00:00:00Z', amount: 435.68, direction: 'debit', reference: null, counterparty: 'CHECK 9999' });
    const { matches } = matchPaymentsToSettledTransactions([payment], [txn]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].suggestionBasis, 'amount_date');
    assert.ok(matches[0].confidence < 0.85);
  });

  it('ignores a credit (money in) transaction even if the amount matches — only debits count for money out', () => {
    const txn = normalizeBankTransaction({ id: 'txn_3', date: '2026-08-15T00:00:00Z', amount: 435.68, direction: 'credit' });
    const { matches, unmatchedPayments } = matchPaymentsToSettledTransactions([payment], [txn]);
    assert.equal(matches.length, 0);
    assert.equal(unmatchedPayments.length, 1);
  });

  it('a Stripe payout and a bank transaction are interchangeable inputs to the same matcher', () => {
    const stripePayout = normalizeStripePayout({ id: 'po_1', amount: 43568, arrival_date: Math.floor(new Date('2026-08-15T00:00:00Z').getTime() / 1000) });
    const { matches } = matchPaymentsToSettledTransactions([payment], [stripePayout]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].transaction.source, 'stripe_payout');
  });

  it('caps confidence and flags ambiguous when two transactions both match one payment', () => {
    const txnA = normalizeBankTransaction({ id: 'txn_a', date: '2026-08-15T00:00:00Z', amount: 435.68, direction: 'debit' });
    const txnB = normalizeBankTransaction({ id: 'txn_b', date: '2026-08-15T00:00:00Z', amount: 435.68, direction: 'debit' });
    const { matches } = matchPaymentsToSettledTransactions([payment], [txnA, txnB]);
    assert.equal(matches.length, 2);
    assert.ok(matches.every(m => m.ambiguous && m.confidence <= 0.5));
  });

  it('unmatched payments and unmatched transactions are both reported', () => {
    const unrelatedTxn = normalizeBankTransaction({ id: 'txn_z', date: '2026-08-15T00:00:00Z', amount: 12.34, direction: 'debit' });
    const { matches, unmatchedPayments, unmatchedTransactions } = matchPaymentsToSettledTransactions([payment], [unrelatedTxn]);
    assert.equal(matches.length, 0);
    assert.equal(unmatchedPayments.length, 1);
    assert.equal(unmatchedTransactions.length, 1);
  });
});

describe('confidenceLabel', () => {
  it('buckets the numeric score for a UI badge', () => {
    assert.equal(confidenceLabel(0.95), 'high');
    assert.equal(confidenceLabel(0.85), 'high');
    assert.equal(confidenceLabel(0.7), 'medium');
    assert.equal(confidenceLabel(0.6), 'medium');
    assert.equal(confidenceLabel(0.4), 'low');
    assert.equal(confidenceLabel(null), 'none');
  });
});

describe('matchesToReject', () => {
  const approved = { id: 'm-approved', targetType: 'order', targetId: 'o-1', sourceType: 'stripe_charge', sourceId: 'ch_1' };

  it('rejects another pending candidate for the same target', () => {
    const sibling = { id: 'm-sib', targetType: 'order', targetId: 'o-1', sourceType: 'stripe_charge', sourceId: 'ch_2' };
    assert.deepEqual(matchesToReject([approved, sibling], approved), ['m-sib']);
  });

  it('rejects another pending candidate for the same source', () => {
    const sibling = { id: 'm-sib', targetType: 'order', targetId: 'o-2', sourceType: 'stripe_charge', sourceId: 'ch_1' };
    assert.deepEqual(matchesToReject([sibling], approved), ['m-sib']);
  });

  it('never includes the approved match itself', () => {
    assert.deepEqual(matchesToReject([approved], approved), []);
  });

  it('leaves an unrelated candidate (different target AND different source) alone', () => {
    const unrelated = { id: 'm-other', targetType: 'order', targetId: 'o-9', sourceType: 'stripe_charge', sourceId: 'ch_9' };
    assert.deepEqual(matchesToReject([unrelated], approved), []);
  });

  it('handles an empty candidate list', () => {
    assert.deepEqual(matchesToReject([], approved), []);
    assert.deepEqual(matchesToReject(null, approved), []);
  });
});
