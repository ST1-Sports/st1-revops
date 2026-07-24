/**
 * Brad — ST1's SDR agent.
 *
 * Works leads to grow the business: researches a contact, drafts outreach, and
 * proposes next touches. Reads leads from Zoho CRM (via /api/crm/search) with the
 * local SalesContact mirror for speed. Brad DRAFTS ONLY — nothing sends without a
 * human click, and hard guardrails (below) are enforced in code, not just prose.
 *
 * Client-side definition only. The real work runs server-side in api/agents/brad.js
 * — see CLAUDE_CODE_BUILD.md, Session 4. The guardrail pattern mirrors the existing
 * Reddit subsystem (feature flags + rate caps + audit), which already works.
 */
export default {
  id:           'brad',
  name:         'Brad',
  capabilities: ['prospecting', 'outreach'],
  type:         'agent',
  roles:        ['admin', 'manager', 'sales_rep'],
  enabled:      true,

  description:
    'ST1 sales development rep. Researches leads, drafts personalized outreach in ' +
    'the ST1 voice, suggests who to contact next and why, and logs every touch so ' +
    'no one is double-contacted. Use to grow pipeline: "find me 10 ADs in Minnesota ' +
    'to reach out to" or "draft a first-touch email to the Woodbridge AD." Brad only ' +
    'drafts and queues — a human approves every send.',

  dataSources: ['crm_search', 'sales_contacts', 'agent_memory'],

  // ── HARD GUARDRAILS — enforced in api/agents/brad.js, NOT just the prompt ────
  guardrails: {
    sideEffects:      true,          // Brad can queue sends → must be gated
    requiresApproval: true,          // every send needs an explicit human click
    // Enforced server-side, all default-safe:
    gates: {
      sendingEnabled:      'env:BRAD_SENDING_ENABLED',  // default false — Brad drafts, never auto-sends
      respectDoNotContact: true,                        // skip any contact flagged DNC / unsubscribed
      dailyTouchCap:       'env:BRAD_DAILY_TOUCH_CAP',   // default 25 — max drafts queued per day
      oneTouchPerContact:  '14d',                        // no re-touch of same contact within 14 days
      dryRun:              'env:BRAD_DRY_RUN',           // simulate without writing/queuing
    },
  },

  async handler(task, input) {
    const r = await fetch('/api/agents/brad', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ task, input }),
    })
    if (!r.ok) throw new Error(`Brad ${r.status}: ${await r.text().catch(() => '')}`)
    const d = await r.json()
    // d.metadata.drafts holds queued drafts awaiting approval; d.metadata.blockedBy
    // is set if a guardrail stopped an action (surface it in the UI).
    return { output: d.output, metadata: d.metadata || {} }
  },
}
