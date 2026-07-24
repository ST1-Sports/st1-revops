/**
 * Edgar — ST1's quoting agent.
 *
 * Reads the SAME price store the Price List tool writes (suppliers + price_items),
 * respects GM floors, factors in competitor/market data so quotes stay
 * competitive, and formats to the ST1 quote standard. Edgar has NO side effects —
 * he produces a quote; a human sends it.
 *
 * Client-side definition only. The real work (price lookup + memory + logging)
 * runs server-side in api/agents/edgar.js — see CLAUDE_CODE_BUILD.md, Session 3.
 */
export default {
  id:           'edgar',
  name:         'Edgar',
  capabilities: ['quote'],          // replaces the old built-in 'st1-quote' plugin
  type:         'agent',
  roles:        ['admin', 'manager', 'sales_rep'],
  enabled:      true,

  // Routing logic — the orchestrator reads this to decide when to hand off.
  description:
    'Builds accurate, on-brand ST1 quotes. Reads live dealer price lists from the ' +
    'Price List tool, honors category GM floors and MAP, checks competitor/market ' +
    'pricing so the quote stays competitive, and formats to the ST1 quote standard. ' +
    'Use whenever a rep wants to quote a customer for products (e.g. "quote ' +
    'Cheyenne Mtn HS for 12 discus and a set of hurdles"). Does not send anything.',

  dataSources: ['suppliers', 'price_items', 'agent_memory'],

  guardrails: {
    sideEffects:      false,        // produces a quote only
    requiresApproval: false,
    // Hard rules Edgar must never break (also enforced server-side):
    neverPriceBelow:  'gmFloorPct', // fall back to category GM target if unset
    respectMAP:       true,         // never quote below MAP where map is set
  },

  async handler(task, input) {
    const r = await fetch('/api/agents/edgar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ task, input }),  // input may carry { customer, items[] }
    })
    if (!r.ok) throw new Error(`Edgar ${r.status}: ${await r.text().catch(() => '')}`)
    const d = await r.json()
    // d.metadata.quote holds the structured line items; d.output is the prose summary.
    return { output: d.output, metadata: d.metadata || {} }
  },
}
