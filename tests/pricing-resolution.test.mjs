import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePricingCore } from '../api/pricing/_lib/resolve-core.js'

test('selects the latest active base price and returns explainable pricing', () => {
  const result = resolvePricingCore({
    sku: 'NB-100',
    brand: 'New Balance',
    date: '2026-01-15',
    basePrices: [
      { sku: 'NB-100', brand: 'New Balance', st1Cost: 40, msrp: 80, effectiveDate: '2025-01-01', sourceTitle: 'Old List', confidence: 0.8 },
      { sku: 'NB-100', brand: 'New Balance', st1Cost: 45, msrp: 90, effectiveDate: '2026-01-01', sourceTitle: 'Current List', confidence: 0.95 },
    ],
  })

  assert.equal(result.baseCost, 45)
  assert.equal(result.finalCost, 45)
  assert.equal(result.msrp, 90)
  assert.equal(result.source.sourceTitle, 'Current List')
  assert.equal(result.confidence, 0.95)
  assert.match(result.explanation.join(' '), /Current List/)
})

test('applies customer fixed override before program adjustment', () => {
  const result = resolvePricingCore({
    sku: 'NB-200',
    brand: 'New Balance',
    customerOverrides: [
      { customerId: 'cust_1', sku: 'NB-200', overrideCost: 70, adjustmentType: 'FIXED_PRICE', sourceTitle: 'Customer Agreement' },
    ],
    programAdjustments: [
      { programId: 'prog_1', adjustmentType: 'PERCENT_DISCOUNT', amount: 10, priority: 10, programName: 'Sponsorship' },
    ],
    basePrices: [
      { sku: 'NB-200', brand: 'New Balance', dealerCost: 100, msrp: 150, effectiveDate: '2026-01-01', sourceTitle: 'Base List' },
    ],
    date: '2026-03-01',
  })

  assert.equal(result.baseCost, 100)
  assert.equal(result.adjustments.length, 2)
  assert.equal(result.adjustments[0].type, 'CUSTOMER_OVERRIDE')
  assert.equal(result.adjustments[0].after, 70)
  assert.equal(result.adjustments[1].type, 'PROGRAM_ADJUSTMENT')
  assert.equal(result.finalCost, 63)
})

test('returns no price when no active base record exists', () => {
  const result = resolvePricingCore({
    sku: 'NB-300',
    brand: 'New Balance',
    basePrices: [
      { sku: 'NB-300', brand: 'New Balance', st1Cost: 20, effectiveDate: '2025-01-01', expirationDate: '2025-12-31' },
    ],
    date: '2026-01-01',
  })

  assert.equal(result.baseCost, null)
  assert.equal(result.finalCost, null)
  assert.equal(result.confidence, 0)
  assert.match(result.explanation[0], /No active base pricing/)
})

test('applies program adjustments by priority', () => {
  const result = resolvePricingCore({
    sku: 'NB-400',
    basePrices: [{ sku: 'NB-400', st1Cost: 100, effectiveDate: '2026-01-01' }],
    programAdjustments: [
      { programId: 'late', adjustmentType: 'AMOUNT_DISCOUNT', amount: 5, priority: 20 },
      { programId: 'early', adjustmentType: 'MARKUP_AMOUNT', amount: 10, priority: 5 },
    ],
    date: '2026-02-01',
  })

  assert.equal(result.adjustments[0].programId, 'early')
  assert.equal(result.adjustments[0].after, 110)
  assert.equal(result.adjustments[1].programId, 'late')
  assert.equal(result.finalCost, 105)
})
