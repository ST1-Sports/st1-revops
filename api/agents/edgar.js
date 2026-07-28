/**
 * POST /api/agents/edgar
 * { task: string, input?: { customer?: string, items?: { name, qty }[] } }
 *
 * Reads live dealer price data from the DB, respects GM floors and MAP,
 * factors competitor pricing, and returns a structured quote + prose summary.
 * All guardrail checks (GM floor, MAP) run server-side after Claude responds.
 */
import { setCors }             from '../_lib/cors.js'
import { prisma }              from '../_lib/prisma.js'
import { recall, logInteraction } from '../_lib/memory.js'

const COMP_PREFIX   = '__COMPETITOR__:'
const API_KEY       = process.env.ANTHROPIC_KEY
const DEFAULT_FLOOR = 0.20   // 20% GM floor when item has no gmFloorPct

function dec(v) { return v == null ? null : Number(v) }

// ── Price data ────────────────────────────────────────────────────────────────

async function fetchPriceData(task) {
  // Targeted search: find items whose name matches keywords in the task
  const stopWords = new Set([
    'a','an','the','and','or','for','to','of','in','at','by','with',
    'quote','price','cost','need','want','get','us','me','our','their',
    'how','much','many','set','sets','some','please','can','we',
  ])
  const keywords = task.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))

  const [ownSuppliers, matchedItems, competitors] = await Promise.all([
    prisma.supplier.findMany({
      where:   { active: true, NOT: { category: { startsWith: COMP_PREFIX } } },
      include: { items: { orderBy: { name: 'asc' }, take: 30 } },
      orderBy: { name: 'asc' },
    }),
    keywords.length ? prisma.priceItem.findMany({
      where: {
        supplier: { active: true, NOT: { category: { startsWith: COMP_PREFIX } } },
        OR: keywords.map(kw => ({ name: { contains: kw, mode: 'insensitive' } })),
      },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 60,
    }) : Promise.resolve([]),
    prisma.supplier.findMany({
      where:   { active: true, category: { startsWith: COMP_PREFIX } },
      include: { items: { orderBy: { name: 'asc' }, take: 20 } },
      orderBy: { name: 'asc' },
    }),
  ])

  return { ownSuppliers, matchedItems, competitors }
}

// ── Account context (Zoho CRM tie-back + interaction history) ─────────────────

async function fetchAccountContext({ contactId, contactEmail }) {
  let contact = null
  if (contactId) {
    contact = await prisma.salesContact.findUnique({ where: { id: contactId } }).catch(() => null)
  }
  if (!contact && contactEmail) {
    contact = await prisma.salesContact.findUnique({ where: { email: contactEmail } }).catch(() => null)
  }
  if (!contact) return { block: '', entityKey: null }

  const interactions = await prisma.agentInteraction.findMany({
    where:   { entity: `contact:${contact.id}` },
    orderBy: { createdAt: 'desc' },
    take:    8,
  }).catch(() => [])

  const lines = []
  lines.push(`Name: ${[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email}`)
  if (contact.title)       lines.push(`Title: ${contact.title}`)
  if (contact.companyName) lines.push(`School/Company: ${contact.companyName}`)
  if (contact.state)       lines.push(`State: ${contact.state}`)
  lines.push(`Score: ${contact.score} · Segment: ${contact.segment}`)
  lines.push(`In Zoho CRM: ${contact.pushedToZoho ? 'yes' : 'no'}${contact.zohoCrmId ? ` (Contact ID ${contact.zohoCrmId})` : ''}`)
  if (contact.notes) lines.push(`Notes: ${contact.notes}`)

  if (interactions.length) {
    lines.push('Recent activity:')
    for (const i of interactions) {
      const when = i.createdAt.toISOString().slice(0, 10)
      const summary = i.action === 'reply_intent'
        ? `replied with interest${i.output?.assignedName ? ` — assigned to ${i.output.assignedName}` : ''}`
        : i.action === 'quote'
          ? `Edgar quoted ${i.output?.itemCount ?? '?'} item(s), $${i.output?.totalRevenue ?? '?'} total`
          : i.action
      lines.push(`- [${when}] ${i.agentId}: ${summary}`)
    }
  }

  return { block: lines.join('\n'), entityKey: `contact:${contact.id}` }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystem(ownSuppliers, matchedItems, competitors, memoryBlock, accountBlock) {
  const intro =
    'You are Edgar, ST1 Sports\'s quoting agent. ST1 Sports is a nationwide B2B athletic equipment ' +
    'supplier. You build accurate, professional quotes for K-12 athletic directors and coaches. ' +
    'Quote only from the real price data below. If a product is not in the price list, say so — ' +
    'never invent a price.'

  // Deduplicate matched items by id (may overlap with supplier context items)
  const matchedIds = new Set(matchedItems.map(i => i.id))

  let priceSection = '\n=== SEARCH RESULTS (items matching this request) ===\n'
  if (matchedItems.length === 0) {
    priceSection += '(no close matches found — see full catalog below)\n'
  } else {
    for (const item of matchedItems) {
      priceSection += formatItem(item, item.supplier.name)
    }
  }

  priceSection += '\n=== FULL CATALOG (context — first 30 per supplier) ===\n'
  for (const sup of ownSuppliers) {
    if (!sup.items.length) continue
    priceSection += `\n${sup.name}:\n`
    for (const item of sup.items) {
      if (matchedIds.has(item.id)) continue   // already shown above
      priceSection += formatItem(item, null)
    }
  }

  let compSection = ''
  if (competitors.length > 0) {
    compSection = '\n=== COMPETITOR PRICING (reference only) ===\n'
    for (const comp of competitors) {
      const cname = comp.category.slice(COMP_PREFIX.length)
      compSection += `\n${cname}:\n`
      for (const item of comp.items) {
        const price = dec(item.cost)   // competitor: cost field = their sell price
        compSection += `  • ${item.name}${price != null ? ' — $' + price.toFixed(2) : ''}\n`
      }
    }
    compSection += '\nUse competitor pricing to confirm ST1 is competitive. Never lower ST1 prices below GM floor or MAP just to match a competitor.\n'
  }

  const acctSection = accountBlock ? `\n=== ACCOUNT ON FILE (from CRM/Brad's prospect history) ===\n${accountBlock}\nUse this to inform tone, urgency, and whether to reference prior contact — but only quote real prices from the price data above.\n` : ''
  const memSection = memoryBlock ? `\n=== CUSTOMER HISTORY (recalled facts) ===\n${memoryBlock}\n` : ''

  const rules = `
=== HARD PRICING RULES ===
1. Never quote below dealer cost.
2. Never quote below MAP where MAP is listed. Flag it if a customer pushes lower.
3. Never quote below GM floor. Formula: minimum price = cost ÷ (1 − gmFloor%).
   Default GM floor = 20% if none listed.
4. Standard price = "Our list price" — already reviewed by Matt. Use it as your default.
5. Quantity discounts: only if cost is known; always stay above GM floor.
6. Not found: respond "Not in current price list — Matt will confirm pricing."

=== RESPONSE FORMAT ===
Return valid JSON only (no prose outside the JSON):
{
  "summary": "1-2 sentence plain-English summary",
  "customer": "<name or null>",
  "lineItems": [
    {
      "name": "product name",
      "sku": "sku or null",
      "qty": 1,
      "cost": 0.00,
      "ourPrice": 0.00,
      "quotedPrice": 0.00,
      "gmPct": 0.0,
      "map": 0.00,
      "mapFlag": false,
      "notFound": false,
      "notes": "optional"
    }
  ],
  "totalCost": 0.00,
  "totalRevenue": 0.00,
  "overallGmPct": 0.0,
  "warnings": []
}`

  return `${intro}${priceSection}${compSection}${acctSection}${memSection}${rules}`
}

function formatItem(item, supplierName) {
  const cost     = dec(item.cost)
  const ourPrice = dec(item.ourPrice)
  const map      = dec(item.map)
  const floor    = item.gmFloorPct ?? DEFAULT_FLOOR
  let line = `  • ${item.name}`
  if (item.sku)         line += ` [${item.sku}]`
  if (item.category)    line += ` (${item.category})`
  if (supplierName)     line += ` — ${supplierName}`
  if (cost != null)     line += ` | cost $${cost.toFixed(2)}`
  if (ourPrice != null) line += ` | list $${ourPrice.toFixed(2)}`
  if (map != null)      line += ` | MAP $${map.toFixed(2)}`
  line += ` | GM floor ${Math.round(floor * 100)}%`
  return line + '\n'
}

// ── Server-side guardrail enforcement ─────────────────────────────────────────

// Build name → {map, gmFloorPct} from DB results so guardrails use real values,
// not whatever Claude chose to echo back in its JSON output.
function buildItemLookup(ownSuppliers, matchedItems) {
  const lookup = new Map()
  const register = item => {
    const key = item.name.toLowerCase()
    if (!lookup.has(key)) {
      lookup.set(key, { map: dec(item.map), gmFloorPct: item.gmFloorPct ?? DEFAULT_FLOOR })
    }
  }
  for (const item of matchedItems) register(item)
  for (const sup of ownSuppliers) for (const item of sup.items) register(item)
  return lookup
}

function enforceGuardrails(quote, itemLookup) {
  const warnings = [...(quote.warnings || [])]

  const lineItems = (quote.lineItems || []).map(item => {
    if (item.notFound) return item

    const cost   = item.cost || 0
    const dbData = itemLookup?.get(item.name?.toLowerCase())
    const floor  = dbData?.gmFloorPct ?? DEFAULT_FLOOR
    const map    = dbData?.map ?? (item.map || 0)   // DB is authoritative; Claude's echo is fallback

    const minByGm  = cost > 0 ? cost / (1 - floor) : 0
    const minByMap = map > 0 ? map : 0
    const minPrice = Math.max(minByGm, minByMap)
    let   quoted   = item.quotedPrice || 0

    if (minPrice > 0 && quoted < minPrice) {
      quoted = Math.round(minPrice * 100) / 100
      if (map > 0 && minByMap >= minByGm) {
        warnings.push(`${item.name}: price set to MAP minimum $${map.toFixed(2)}`)
      } else {
        warnings.push(`${item.name}: price raised to $${quoted.toFixed(2)} to meet ${Math.round(floor * 100)}% GM floor`)
      }
    }

    const gm = quoted > 0 && cost > 0 ? (quoted - cost) / quoted : null
    return {
      ...item,
      quotedPrice: quoted,
      gmPct:       gm != null ? Math.round(gm * 1000) / 10 : item.gmPct,
    }
  })

  const totalCost    = lineItems.reduce((s, i) => s + (i.cost || 0) * (i.qty || 1), 0)
  const totalRevenue = lineItems.reduce((s, i) => s + (i.quotedPrice || 0) * (i.qty || 1), 0)
  const overallGm    = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0

  return {
    ...quote,
    lineItems,
    totalCost:    Math.round(totalCost    * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    overallGmPct: Math.round(overallGm   * 1000) / 10,
    warnings,
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' })
  if (!API_KEY)                return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' })

  const { task, input = {} } = req.body || {}
  if (!task) return res.status(400).json({ error: 'task is required' })

  const customer     = input.customer || null
  const contactId    = input.contactId || null
  const contactEmail = input.contactEmail || null

  try {
    const [{ ownSuppliers, matchedItems, competitors }, memFacts, accountCtx] = await Promise.all([
      fetchPriceData(task),
      customer
        ? recall({ entity: `customer:${customer}` }).catch(() => [])
        : Promise.resolve([]),
      fetchAccountContext({ contactId, contactEmail }),
    ])

    const memoryBlock = memFacts.length
      ? memFacts.map(f => `- ${f.key}: ${f.value}`).join('\n')
      : ''

    const itemLookup = buildItemLookup(ownSuppliers, matchedItems)
    const system = buildSystem(ownSuppliers, matchedItems, competitors, memoryBlock, accountCtx.block)

    // Build user message — embed structured items if provided
    let userMsg = task
    if (Array.isArray(input.items) && input.items.length) {
      userMsg += '\n\nRequested items:\n' +
        input.items.map(i => `- ${i.qty || 1}x ${i.name}`).join('\n')
    }
    if (customer) userMsg += `\n\nCustomer: ${customer}`

    // Call Claude
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25_000)
    let claudeData
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        signal:  ctrl.signal,
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 2000,
          system,
          messages:   [{ role: 'user', content: userMsg }],
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`Anthropic ${r.status}: ${txt.slice(0, 200)}`)
      }
      claudeData = await r.json()
    } finally {
      clearTimeout(timer)
    }

    const raw = (claudeData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    // Parse structured quote
    let quote = null
    try {
      const m = raw.match(/\{[\s\S]*\}/s)
      if (m) quote = JSON.parse(m[0])
    } catch {}

    if (!quote) {
      return res.json({ output: raw, metadata: { quote: null, warnings: [] } })
    }

    const guarded = enforceGuardrails(quote, itemLookup)

    // Fire-and-forget interaction log
    logInteraction({
      agentId: 'edgar',
      action:  'quote',
      entity:  accountCtx.entityKey || (customer ? `customer:${customer}` : null),
      input:   { task },
      output:  { itemCount: guarded.lineItems?.length ?? 0, totalRevenue: guarded.totalRevenue },
      outcome: 'pending',
    }).catch(() => {})

    return res.json({
      output:   guarded.summary || raw,
      metadata: { quote: guarded, warnings: guarded.warnings },
    })

  } catch (err) {
    console.error('[agents/edgar]', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
