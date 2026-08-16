# ST1 AI Tool Layer

The ST1 Knowledge API exposes safe, read-only business capabilities for Claude,
OpenAI, MCP servers, and future ST1 agents. It is not an autonomous agent system
and it does not perform write actions.

## Endpoint

All tools are exposed through one provider-neutral endpoint:

```http
GET  /api/ai/tools?formats=true
POST /api/ai/tools
Authorization: Bearer <ST1_AI_TOOL_API_KEY>
Content-Type: application/json
```

`GET` returns the tools permitted for the caller, their descriptions, strict input
schemas, and optional provider-specific formats for Anthropic, OpenAI, and MCP.

`POST` invokes one named tool:

```json
{
  "tool": "get_st1_pricing",
  "input": {
    "sku": "MT123",
    "brand": "New Balance"
  }
}
```

The response is structured JSON with status, result data, sources, and limitations.
If a value is not available from an authoritative internal source, the tool returns
`null` or `not_found`; it does not guess.

## Authentication and scopes

Configure at least one server-side key:

```bash
ST1_AI_TOOL_API_KEY=st1_live_long_random_value
```

For multiple scoped clients, use JSON:

```bash
ST1_AI_TOOL_API_KEYS='{
  "claude": {
    "token": "st1_live_claude_long_random_value",
    "scopes": ["knowledge:read", "product:read", "pricing:read", "vendor:read", "brand:read", "policy:read"]
  },
  "crm_reader": {
    "token": "st1_live_crm_long_random_value",
    "scopes": ["customer:read"]
  }
}'
```

Available scopes:

- `knowledge:read`
- `pricing:read`
- `product:read`
- `vendor:read`
- `brand:read`
- `customer:read`
- `customer:read:notes`
- `policy:read`

Tokens must stay server-side. Do not put them in browser code.

## Tools

- `search_st1_knowledge` — broad safe search across permitted ST1 domains.
- `get_st1_pricing` — authoritative product pricing/cost lookup.
- `get_st1_product` — product catalog lookup.
- `get_st1_vendor` — vendor/supplier context from safe item/vendor sources.
- `get_st1_brand` — ST1 brand guidance or product brand context.
- `get_st1_customer` — permitted customer/contact/lead lookup.
- `get_st1_policy` — AI safety, pricing, brand, customer-data, sponsorship, or sales talk-track policy.

Every tool is read-only and schema-validated. Unknown fields are rejected.

## Example Claude flow

User:

> What is our cost on New Balance SKU MT123?

Claude should not guess. It should call:

```json
{
  "name": "get_st1_pricing",
  "input": {
    "sku": "MT123",
    "brand": "New Balance"
  }
}
```

The application calculates the answer from configured sources such as Zoho Books
items and the synced ST1 product catalog, then returns JSON:

```json
{
  "tool": "get_st1_pricing",
  "ok": true,
  "status": "ok",
  "result": {
    "sku": "MT123",
    "cost": { "amount": 42.5, "source": "Zoho Books purchase rate" },
    "customerPrice": { "amount": 68, "source": "Zoho Books rate" },
    "marginPct": 37.5
  },
  "sources": [
    { "system": "Zoho Books Items", "recordId": "123456", "retrievedAt": "..." }
  ],
  "limitations": []
}
```

Claude can then explain the answer and cite the source.

## Provider adapters

The registry is provider-neutral. `GET /api/ai/tools?formats=true` returns:

- `providerFormats.neutral` for custom callers.
- `providerFormats.anthropic` for Anthropic `tools`.
- `providerFormats.openai` for OpenAI function tools.
- `providerFormats.mcp` guidance for MCP wrapping.

An MCP server should register each neutral tool as a read-only MCP tool and forward
validated calls to `POST /api/ai/tools`. The MCP server should not add raw SQL or
write capabilities.

## Safety boundaries

The tool layer:

- requires bearer authentication;
- enforces per-tool read scopes;
- validates every input against strict schemas;
- selects only approved fields from Prisma and integrations;
- returns sources and limitations;
- never exposes raw SQL;
- never exposes secrets, OAuth tokens, API keys, or credentials;
- never allows arbitrary database access;
- does not implement autonomous write actions.

Add write tools only after a separate human-approval design exists.
