# ST1 Internal Knowledge API

This API is the clean service layer for ST1 applications and future AI/MCP tools.
Callers should use these endpoints instead of reading database tables directly.

## Authentication

All endpoints require the existing RevOps user context or an internal API key.

Headers:

```http
x-st1-user-id: <current RevOps user id>
```

For server-to-server/agent access:

```http
Authorization: Bearer <KNOWLEDGE_API_KEY>
```

The API key is optional but recommended for internal agents.

## Defaults

Unless otherwise noted, endpoints return only:

- approved knowledge
- current/effective documents
- non-expired documents
- source provenance where available

Pricing is always calculated by deterministic application code. AI may propose
pricing imports, but AI does not calculate final pricing.

## Endpoints

### Search Knowledge

```http
GET /api/st1/search-knowledge?query=return%20policy&category=Policy&limit=10
```

Returns approved/current documents matching the query.

### Get Pricing

```http
GET /api/st1/pricing?sku=NB-123&brand=New%20Balance&customerId=cust_1&programId=spring_2026
```

Returns:

```json
{
  "pricing": {
    "product": {},
    "sku": "NB-123",
    "brand": "New Balance",
    "msrp": 100,
    "baseCost": 60,
    "adjustments": [],
    "finalCost": 60,
    "effectiveDate": "2026-01-01T00:00:00.000Z",
    "source": {
      "sourceId": "src...",
      "sourceTitle": "New Balance 2026 Price List"
    },
    "confidence": 0.95,
    "explanation": [
      "Base price selected from New Balance 2026 Price List with effective date 2026-01-01."
    ]
  }
}
```

### Get Product

```http
GET /api/st1/product?id=123
GET /api/st1/product?sku=NB-123&brand=New%20Balance
```

Looks up WooCommerce-backed product data by `id`, or pricing-backed product data
by `sku`.

### Get Vendor

```http
GET /api/st1/vendor?name=New%20Balance
```

Returns approved/current vendor-related documents and structured records.

### Get Brand

```http
GET /api/st1/brand?name=New%20Balance
```

Returns approved/current brand-related documents and structured records.

### Get Customer

```http
GET /api/st1/customer?name=Example%20School
```

Returns approved/current customer-related knowledge. This does not replace Zoho
CRM as the operational customer system.

### Get Policy

```http
GET /api/st1/policy?title=Returns
```

Returns the latest approved/current policy document.

### Get Document

```http
GET /api/st1/document?id=<knowledgeDocumentId>
```

Returns one approved/current Knowledge document and its chunks.

Set `includeContent=false` to omit full content:

```http
GET /api/st1/document?id=<knowledgeDocumentId>&includeContent=false
```

## Service functions

The endpoint layer delegates to reusable functions in:

```text
api/st1/_lib/service.js
```

Available functions:

- `searchKnowledge(prisma, input)`
- `getPricing(prisma, input)`
- `getProduct(prisma, input)`
- `getVendor(prisma, input)`
- `getBrand(prisma, input)`
- `getCustomer(prisma, input)`
- `getPolicy(prisma, input)`
- `getDocument(prisma, input)`

These functions are intended to become the underlying implementations for Claude
tools or MCP tools.

## Error handling

Validation failures return `400`.

Missing approved/current records return `404`.

Unexpected errors return `500` and are logged server-side with an `st1/<scope>`
prefix.
