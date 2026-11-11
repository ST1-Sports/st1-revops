# Team Store Settlement

Where every number on the settlement/AP/statement screens actually comes
from, and how much to trust each one.

## Data flow

```
ST1 admin app (api.st1sports.com)          RevOps (this app)
──────────────────────────────    sync    ──────────────────────────
GET /admin/team_store_order   ──────────▶  TeamStoreOrder
  → order.items[]             ──────────▶  TeamStoreOrderLine
  → order.payables[]          ──────────▶  TeamStorePayable

RevOps only, never synced from anywhere:   PayablePayment
                                            SettlementMatch (see below)
```

`api/_lib/teamStoreSync.js`'s `runSync()` is **one-way and read-only against
the admin app** — no endpoint to write a payable back was ever found there
(see `st1AdminAuth.js`'s doc comment), so nothing in this repo ever attempts
it. Every sync is a full upsert keyed on stable identifiers
(`TeamStoreOrder.id`, `payableKey(referenceNumber, type, label)`), safe to
re-run at any time.

## Authoritative vs. indicative figures

| Figure | Source | Trust level |
|---|---|---|
| `TeamStoreOrder.totalAmount/subTotal/tax/shipping` | admin app, order record | **Authoritative** — the actual order totals |
| `TeamStorePayable.amount` | admin app, `payables[].amount` | **Authoritative** — the stored payable figure. Settlement math (`src/lib/teamStoreSettlement.js`) always sums this; it never recomputes a payable from cost data |
| `TeamStoreOrderLine.baseCost` | admin app, `product.baseCost` (the CURRENT catalog price) | **Indicative only** — this is live catalog data at sync time, not what the order actually paid. A product's cost can change after the order shipped, so re-syncing an old order can silently shift this number. Use it for margin trend-watching, never as a payout figure |
| `TeamStoreOrderLine.decorationCost` | admin app, `/admin/decoration_cost` resolved against the line's design | **Indicative only**, same caveat as `baseCost` — also the one upstream shape in this module that's still unverified against a real response (see `decorationCostFor()`'s doc comment) |
| `TeamStorePayable.platformPaid` | admin app, `payables[].paid` | A flag only — no date, amount, or reference behind it. Refreshed on every sync |
| `PayablePayment` (date, method, reference, amount) | **RevOps only** — recorded by a human on the AP screen | **Authoritative for "did ST1 actually pay this"** — a sync never creates, updates, or deletes this row. `platformPaid` and `PayablePayment` are two independent signals, shown side by side, never merged into one |
| `SettlementMatch` | **RevOps only** — proposed by `src/lib/teamStoreReconcile.js`, confirmed by a human | Confirms a `PayablePayment` or `TeamStoreOrder` against real money movement (a Stripe charge/payout, a bank transaction). A proposed match is never auto-applied — `sourceType`/`sourceId` on an `APPROVED` row is the record of which source confirmed it |

## The one-way payment record

RevOps records payments; it does not send them, and it does not report them
back to the admin app. `PayablePayment` exists purely so RevOps has its own
opinion of what's been paid, independent of (and more trustworthy than)
`platformPaid`. Every screen that shows payment status says this plainly —
recording a payment here is bookkeeping, not an instruction to pay anyone.
