/**
 * /api/agent  — Server-side RevOps AI Agent
 *
 * Upgrades the client-side agent to a proper agentic loop with:
 * - Real-time web search (Anthropic web_search_20250305, executes automatically)
 * - Live Zoho CRM context (fresh deals + contacts fetched server-side)
 * - Tool proposals (create_deal, add_contact, send_email, add_to_nurture)
 *   returned in the actions array for user to confirm before execution
 *
 * POST body:
 *   { messages: ConversationMessage[], localContext: { deals, contacts, rfps, invoices, sequences } }
 *
 * Response:
 *   { message, actions, suggestions, liveZoho: bool, searchUsed: bool }
 */

import { getZohoToken } from './_lib/zoho-token.js';
import { remember, memoryBlock, logInteraction, feedbackBlock } from './_lib/memory.js';
import { ALL_READ_SCOPES } from './_lib/ai-tools/auth.js';
import { AI_TOOLS, getTool, invokeTool } from './_lib/ai-tools/registry.js';
import { mergeScoutActions, st1PriceActionFromPricing } from './_lib/st1PriceAction.js';
import {
  formatLockedQuoteBlock,
  lockedPricingToolResult,
  matchLockedItem,
  overlayLockedPricing,
  pricingQueryOf,
  quoteIntent,
  resolveLockedQuote,
} from '../src/lib/quoteLock.js';

export const config = { maxDuration: 120 };

const ST1 = `ST1 Sports — premium athletic equipment (hurdles, starting blocks, shot puts, throws equipment, training gear) sold directly to high school and college athletic programs, coaches, and athletic directors across the US. Based in Colorado. Owner: Matt Stone (matt@st1sports.com, 719-256-0275). Website: st1sports.com. Direct sales model, volume discounts for teams, fast shipping, personalized service.

BRAND POSITIONING — 5 attributes NO competitor occupies:
1. WARM CONFIDENCE: Approachable, relationship-first tone. Zero competitors own this — 9 of 15 run red/black/white aggressive palettes.
2. ATHLETE IDENTITY: Speak TO the athlete, not just the administrator. Youth baseball culture, sport slang, identity-first. Nobody else does this.
3. HUMAN CONTACT: "One person picks up the phone." Matt answers personally. This narrative is completely unoccupied in the market.
4. ALL-SPORT BREADTH: One contact, one relationship — track, baseball, volleyball, football, all of it. Position this as relief for the AD managing 20 programs.
5. EXCLUSIVE CULTURE: Graphic tees as culture drops ("I Hit Dingers", "Oppo Taco") — limited runs, sport slang, kids actually want to wear them.

BRAND VOICE RULES — apply to every email, response, and campaign:
✓ Warm, direct, first-person: "I'm Matt. I pick up the phone."
✓ Athlete-aware: reference the sport's culture, the kid wearing the gear
✓ Relationship-first: lead with the person, then the product
✓ Specific over generic: real names, real schools, real details — never filler
✓ Short sentences, human language — never corporate or formal
✗ NEVER use efficiency-first hooks: "2-week turnaround", "no minimums", "lowest prices" — every competitor says this
✗ NEVER use corporate "we" language or institutional B2B tone
✗ NEVER use generic inspiration phrases: "Make Winning Possible", "Building Champions", "Welcome to Sporthood"
✗ NEVER lean on social proof as personality: "4.9 stars", "#1 rated"

UNDERSERVED AUDIENCES ST1 can own:
- The Athlete: zero competitors in this category speak directly to them
- Youth baseball/softball culture: graphic tee slang completely unaddressed by any competitor
- The All-Sport AD/Parent: one stop, one contact, every sport — relief for multi-program schools
- The Serious Rec Athlete (25-45)

KEY MESSAGES THAT WIN (competitors run zero ads like these):
- "I'm Matt. I pick up the phone."
- "One contact, every sport your school runs"
- Drop-style graphic tees: named collections, limited runs, culture-driven`;

const INTERNAL_TOOL_AUTH = {
  subject: 'revops-home-chat',
  scopes: new Set(ALL_READ_SCOPES),
};

const KNOWLEDGE_TOOL_NAMES = new Set(AI_TOOLS.map(tool => tool.name));

function anthropicSafeSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema || { type: 'object', properties: {} }));
  // Anthropic custom tool schemas reject top-level anyOf/oneOf/allOf. The ST1
  // tool runtime still validates the strict schema before executing; this copy
  // is only the model-facing schema used to collect arguments.
  delete copy.anyOf;
  delete copy.oneOf;
  delete copy.allOf;
  // After stripping anyOf, pricing/product tools had no required fields and
  // the model often called them with an empty body — then the home chat
  // returned no text. Prefer a name/query so lookups always have a search.
  if (!copy.required?.length && copy.properties) {
    const fallback = ['productName', 'query', 'sku', 'brandName', 'vendorName'].find(k => copy.properties[k]);
    if (fallback) copy.required = [fallback];
  }
  return copy;
}

function usableChatMessage(parsed, finalText) {
  const fromJson = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
  if (fromJson) return fromJson;
  const fromText = String(finalText || '').trim();
  if (fromText && !fromText.startsWith('{')) return fromText;
  return '';
}

function messageFromEdgar(edgar) {
  if (!edgar) return '';
  if (edgar.output?.error) return `I couldn't pull a quote just now (${edgar.output.error}).`;
  const summary = edgar.output?.output || edgar.output?.message;
  if (summary) return String(summary);
  const items = edgar.output?.metadata?.quote?.lineItems;
  if (Array.isArray(items) && items.length) {
    const lines = items.map(li => {
      const sku = li.sku ? ` [${li.sku}]` : '';
      const cost = li.cost != null ? `cost $${Number(li.cost).toFixed(2)}` : 'cost n/a';
      const sell = li.quotedPrice != null ? `quote $${Number(li.quotedPrice).toFixed(2)}` : '';
      return `${li.name}${sku}: ${cost}${sell ? ` · ${sell}` : ''}`;
    });
    return `Edgar pulled this from the dealer price lists:\n${lines.join('\n')}`;
  }
  return '';
}

function messageFromToolResults(agentResults) {
  const edgar = [...(agentResults || [])].reverse().find(r => r.name === 'call_edgar');
  const fromEdgar = messageFromEdgar(edgar);
  if (fromEdgar) return fromEdgar;
  const pricing = [...(agentResults || [])].reverse().find(r => r.name === 'get_st1_pricing');
  if (pricing?.output) {
    const p = pricing.output.result;
    const asked = pricing.input?.productName || pricing.input?.query || pricing.input?.sku || 'that item';
    if (pricing.output.status === 'not_found' || !p) {
      const why = (pricing.output.limitations || []).filter(Boolean).join(' ');
      return `I don't have a price on file for ${asked}.${why ? ` ${why}` : ''} Try a SKU or a more specific product name.`;
    }
    const price = p.customerPrice?.amount;
    const name = p.name || asked;
    const sku = p.sku ? ` [${p.sku}]` : '';
    const from = p.supplier ? ` · ${p.supplier}` : '';
    if (price != null) return `${name}${sku}${from}: $${Number(price).toFixed(2)}.`;
    return `${name}${sku} is in the price lists, but no customer price is on file.`;
  }
  return '';
}


// ── TOOLS ────────────────────────────────────────────────────────────────────
const TOOLS = [
  // CRM / action proposals — returned in actions[] for user to confirm
  {
    name: "propose_create_deal",
    description: "Propose creating a new deal in the sales pipeline. The user will confirm before it's saved.",
    input_schema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "Deal name, usually org + product" },
        org:     { type: "string", description: "School or organization name" },
        value:   { type: "number", description: "Expected deal value in USD" },
        stage:   { type: "string", description: "Pipeline stage", enum: ["Quoted","Follow-Up 1","Follow-Up 2","Negotiating","PO Received"] },
        product: { type: "string", description: "Product category or specific item" },
        contact_name: { type: "string" },
        note:    { type: "string", description: "Context or next steps" },
      },
      required: ["name", "org"],
    },
  },
  {
    name: "propose_add_contact",
    description: "Propose adding a new prospect to the contact database. The user will confirm.",
    input_schema: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName:  { type: "string" },
        title:     { type: "string", description: "Athletic Director, Head Coach, Procurement, etc." },
        school:    { type: "string" },
        state:     { type: "string" },
        email:     { type: "string" },
        phone:     { type: "string" },
        sport:     { type: "string" },
      },
      required: ["lastName", "school"],
    },
  },
  {
    name: "propose_draft_email",
    description: "Draft an outreach or follow-up email. The user will review before sending.",
    input_schema: {
      type: "object",
      properties: {
        to_name:  { type: "string" },
        to_email: { type: "string" },
        subject:  { type: "string" },
        body:     { type: "string", description: "Full email body, plain text, personalized" },
      },
      required: ["to_name", "subject", "body"],
    },
  },
  {
    name: "propose_schedule_followup",
    description: "Schedule a follow-up on a specific deal.",
    input_schema: {
      type: "object",
      properties: {
        deal_name: { type: "string" },
        date:      { type: "string", description: "YYYY-MM-DD" },
        note:      { type: "string" },
      },
      required: ["deal_name", "date"],
    },
  },
  {
    name: "propose_flag_deal",
    description: "Flag a deal as hot or warm priority.",
    input_schema: {
      type: "object",
      properties: {
        deal_name: { type: "string" },
        priority:  { type: "string", enum: ["hot","warm"] },
        reason:    { type: "string" },
      },
      required: ["deal_name", "priority"],
    },
  },
  {
    name: "propose_add_to_nurture",
    description: "Add a cold or unresponsive lead to the Zoho Campaigns email nurture sequence.",
    input_schema: {
      type: "object",
      properties: {
        email:     { type: "string" },
        firstName: { type: "string" },
        lastName:  { type: "string" },
        company:   { type: "string" },
        reason:    { type: "string", description: "Why this person should be nurtured" },
      },
      required: ["email"],
    },
  },
  {
    name: "propose_log_note",
    description: "Log a note or update on a deal.",
    input_schema: {
      type: "object",
      properties: {
        deal_name: { type: "string" },
        note:      { type: "string" },
      },
      required: ["deal_name", "note"],
    },
  },
  {
    name: "propose_create_quote",
    description: "Build and create a real Zoho CRM Quote (linked to the Account) for a customer based on their needs. Prefer get_st1_pricing for a cost/list check, or call_edgar when the user wants a formal quote. This tool is a fallback when those cannot price the items.",
    input_schema: {
      type: "object",
      properties: {
        customer_name:  { type: "string", description: "Customer or school name" },
        account_city:   { type: "string", description: "City of the customer's Account, to disambiguate same-named schools" },
        account_state:  { type: "string", description: "State of the customer's Account, to disambiguate same-named schools" },
        contact_person: { type: "string", description: "Contact person's name" },
        email:          { type: "string", description: "Email to send the quote to" },
        line_items: {
          type: "array",
          description: "Products/services to quote",
          items: {
            type: "object",
            properties: {
              name:        { type: "string" },
              description: { type: "string" },
              quantity:    { type: "number" },
              rate:        { type: "number", description: "Price per unit after margin" },
              cost:        { type: "number", description: "Dealer cost per unit, for internal margin tracking" },
            },
            required: ["name", "quantity", "rate", "cost"],
          },
        },
        shipping_cost: { type: "number", description: "Total shipping cost, for internal margin tracking" },
        notes:      { type: "string", description: "Notes visible on the quote" },
        send_email: { type: "boolean", description: "Whether to email the quote to the customer" },
      },
      required: ["customer_name", "line_items"],
    },
  },
  {
    name: "propose_store_competitor_intel",
    description: "Save competitor intelligence to the Competitors tab so it persists and the user can reference it. ALWAYS call this when you research or learn anything useful about a competitor — pricing, strengths, weaknesses, customer segments, tactics. This executes automatically (no user confirmation needed).",
    input_schema: {
      type: "object",
      properties: {
        competitor_name: { type: "string", description: "Company name exactly as it should appear (e.g. 'BSN Sports', 'VS Athletics', 'Track Supply Co')" },
        intel: { type: "string", description: "All intelligence gathered — product focus, pricing approach, strengths, weaknesses vs ST1, key states/customers, counter-tactics. Be specific and comprehensive." },
        source: { type: "string", description: "How gathered: 'web search', 'RFP document', 'user provided', 'price list upload'" },
      },
      required: ["competitor_name", "intel"],
    },
  },
  {
    name: "propose_create_campaign_sequence",
    description: "Build a multi-email outreach sequence, match contacts from the CRM, and set it up ready to launch. Use when the user asks to build a campaign, send a sequence to a group, or automate outreach to a segment.",
    input_schema: {
      type: "object",
      properties: {
        campaign_name: { type: "string", description: "Short descriptive name for this campaign" },
        product:       { type: "string", description: "Product or category being promoted" },
        emails: {
          type: "array",
          description: "The email sequence — each is one touch",
          items: {
            type: "object",
            properties: {
              subject:    { type: "string" },
              body:       { type: "string", description: "Full email body, personalized, signed by Matt Stone" },
              delay_days: { type: "number", description: "Days after previous email (0 = send first)" },
            },
            required: ["subject", "body", "delay_days"],
          },
        },
        contact_filters: {
          type: "object",
          description: "Filters to match the right contacts from CRM",
          properties: {
            sports:    { type: "array", items: { type: "string" }, description: "Sports to match (e.g. ['Baseball', 'Softball'])" },
            states:    { type: "array", items: { type: "string" }, description: "State codes to match (e.g. ['IA', 'MN'])" },
            titles:    { type: "array", items: { type: "string" }, description: "Title keywords to match (e.g. ['Athletic Director', 'Coach'])" },
            min_score: { type: "number", description: "Minimum lead score (omit to include all)" },
          },
        },
        notes: { type: "string", description: "Context or strategy notes for this campaign" },
      },
      required: ["campaign_name", "emails"],
    },
  },
  {
    name: "call_edgar",
    description: "Build a formal quote with GM floor and MAP when the user explicitly wants a quote (e.g. 'quote 5 TF-5000s for Lincoln High', 'build a quote', 'price this out for a school', 'update the quote'). Do NOT use this for a casual cost/price/MAP check — use get_st1_pricing for that. On an update, pass the same SKU and keep cost/sell unless they asked to reprice. Pass the user's product text and school in task.",
    input_schema: {
      type: "object",
      properties: {
        task:     { type: "string", description: "Natural language quote request — mention the customer, products, and quantities" },
        customer: { type: "string", description: "Customer or school name for memory lookup (optional)" },
        items: {
          type: "array",
          description: "Specific line items to quote (optional — Edgar extracts from task if omitted)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sku:  { type: "string" },
              qty:  { type: "number" },
            },
            required: ["name"],
          },
        },
        reprice: { type: "boolean", description: "True only if the user asked to refresh dealer-list cost or list price" },
      },
      required: ["task"],
    },
  },
  {
    name: "call_brad",
    description: "Research leads and draft personalized outreach emails using Brad, ST1's SDR agent. Brad checks DNC lists, enforces a 14-day re-touch barrier per contact, and caps daily touches. Returns drafts for human approval — nothing sends automatically. Use for prospecting or bulk outreach; use propose_draft_email for a single specific named contact.",
    input_schema: {
      type: "object",
      properties: {
        task:      { type: "string", description: "Natural language outreach task — who to target, the angle, and any product or seasonal hook" },
        contactId: { type: "string", description: "Specific contact ID to target (optional, single-contact mode)" },
        minScore:  { type: "number", description: "Minimum lead score filter to narrow the contact pool (optional)" },
      },
      required: ["task"],
    },
  },
  {
    name: "remember_this",
    description: "Save an important fact to org memory so it persists across conversations. Use for: customer preferences, pricing anchors, contact context, deal outcomes, competitive intelligence, or anything Matt explicitly shares. Auto-executes silently.",
    input_schema: {
      type: "object",
      properties: {
        key:    { type: "string", description: "Short factual label (e.g. 'budget', 'preferred-contact', 'last-outcome', 'pricing-note')" },
        value:  { type: "string", description: "The fact to remember" },
        entity: { type: "string", description: "What this fact is about — 'org' for general, or namespaced: 'customer:Lincoln High', 'contact:Coach Smith', 'competitor:BSN Sports'" },
      },
      required: ["key", "value", "entity"],
    },
  },
  {
    name: "call_ledger",
    description: "Execute the Ledger agent for finance and accounting tasks. Four modes: (1) invoice — create a Zoho Books invoice when a CRM deal is marked Closed Won; (2) reconcile — match uncategorized Stripe/Shopify deposits; (3) vendor-bill — parse a vendor invoice file; (4) payments — poll open invoices for status changes and send Slack reminders for overdue/upcoming.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          enum: ["invoice", "reconcile", "vendor-bill", "payments"],
          description: '"invoice" — create Zoho Books invoice for a won deal. "reconcile" — match bank deposits. "vendor-bill" — process vendor invoice. "payments" — poll invoice statuses and send overdue/upcoming Slack reminders.',
        },
        crmDealId:     { type: "string",  description: "CRM deal ID (invoice task only)" },
        crmDealName:   { type: "string",  description: "Deal or account name (invoice task only)" },
        dryRun:        { type: "boolean", description: "Preview without writing — defaults true, safe to omit" },
        limit:         { type: "number",  description: "Max items to fetch (reconcile/payments, default 10)" },
        lookAheadDays: { type: "number",  description: "Days ahead to warn for upcoming due dates (payments only, default 7)" },
      },
      required: ["task"],
    },
  },
  ...AI_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: anthropicSafeSchema(tool.input_schema),
  })),
];

// ── ZOHO CONTEXT FETCH ───────────────────────────────────────────────────────
function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchZohoContext() {
  try {
    const token = await getZohoToken();
    const hdrs = { headers: { Authorization: `Zoho-oauthtoken ${token}` } };
    const [dealsRes, contactsRes] = await Promise.allSettled([
      fetchWithTimeout(
        "https://www.zohoapis.com/crm/v3/Deals?fields=Deal_Name,Account_Name,Amount,Stage,Closing_Date,id&per_page=25&sort_by=Modified_Time&sort_order=desc",
        hdrs
      ),
      fetchWithTimeout(
        "https://www.zohoapis.com/crm/v3/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,id&per_page=20&sort_by=Modified_Time&sort_order=desc",
        hdrs
      ),
    ]);
    const deals    = dealsRes.status === "fulfilled" && dealsRes.value.ok    ? (await dealsRes.value.json()).data || []    : [];
    const contacts = contactsRes.status === "fulfilled" && contactsRes.value.ok ? (await contactsRes.value.json()).data || [] : [];
    return { deals, contacts, ok: true };
  } catch {
    return { deals: [], contacts: [], ok: false };
  }
}

// ── AGENT CALLERS (server-to-server within the same deployment) ───────────────
async function callLedger(input, baseUrl) {
  try {
    const task      = input.task
    const endpoint  = task === 'invoice'     ? `${baseUrl}/api/agents/ledger/invoice`
                    : task === 'payments'    ? `${baseUrl}/api/agents/ledger/payments`
                    : task === 'vendor-bill' ? `${baseUrl}/api/agents/ledger/vendor-bill`
                    :                         `${baseUrl}/api/agents/ledger/reconcile`
    const body = task === 'invoice'
      ? { action: 'draft', crmDealId: input.crmDealId, crmDealName: input.crmDealName, dryRun: input.dryRun ?? true }
      : task === 'payments'
      ? { dryRun: input.dryRun ?? true, lookAheadDays: input.lookAheadDays ?? 7, limit: input.limit ?? 200 }
      : task === 'vendor-bill'
      ? { action: 'extract', pdfBase64: input.pdfBase64 || null, dryRun: input.dryRun ?? true }
      : { task, dryRun: input.dryRun ?? true, limit: input.limit ?? 10 }
    const r = await fetchWithTimeout(
      endpoint,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      },
      20_000
    );
    if (!r.ok) return { error: `Ledger returned HTTP ${r.status}` };
    return r.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function callEdgar(input, baseUrl, lock = {}) {
  try {
    const r = await fetchWithTimeout(
      `${baseUrl}/api/agents/edgar`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          task: input.task,
          input: {
            customer: input.customer,
            items: input.items,
            lockedItems: lock.reprice ? [] : (lock.items || []),
            reprice: !!lock.reprice,
            lockSell: lock.lockSell !== false,
            lockCost: lock.lockCost !== false,
            quoteRates: lock.quoteRates ?? null,
            preferredSupplier: lock.preferredSupplier || null,
          },
        }),
      },
      50_000
    );
    if (!r.ok) return { error: `Edgar returned HTTP ${r.status}` };
    return r.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function callBrad(input, baseUrl, localCtx = {}) {
  try {
    const r = await fetchWithTimeout(
      `${baseUrl}/api/agents/brad`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          task: input.task,
          input: {
            contactId: input.contactId,
            minScore: input.minScore,
            contacts: Array.isArray(localCtx.contacts) ? localCtx.contacts.slice(0, 50) : undefined,
          },
        }),
      },
      20_000
    );
    if (!r.ok) return { error: `Brad returned HTTP ${r.status}` };
    return r.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────
async function buildSystemPrompt(localCtx, zoho) {
  const deals    = localCtx.deals    || [];
  const contacts = localCtx.contacts || [];
  const rfps     = localCtx.rfps     || [];
  const invoices = localCtx.invoices || [];
  const sequences = localCtx.sequences || [];
  const priceLists = localCtx.priceLists || [];
  const storedIntel = localCtx.competeIntel || [];
  const brandVoice = localCtx.brandVoice || "";
  const lockedQuote = localCtx.lockedQuote || null;

  const open = deals.filter(d => !["Closed Won","Closed Lost"].includes(d.stage));
  const pipeline = open.reduce((a,d) => a + (d.value||0), 0);
  const overdue  = open.filter(d => d.followUpDate && new Date(d.followUpDate) < new Date());
  const hot      = open.filter(d => d.priority === "hot");
  const ar       = invoices.filter(i => !["paid","void","draft"].includes(i.status)).reduce((a,i) => a+(i.balance||0), 0);
  const activeRfps = rfps.filter(r => !["Won","Lost","No Bid"].includes(r.stage));
  const topContacts = [...contacts].filter(c => (c.score||0) > 0).sort((a,b) => (b.score||0)-(a.score||0)).slice(0,8);

  const zohoSection = zoho.ok && zoho.deals.length
    ? `\n=== LIVE ZOHO CRM (${new Date().toLocaleTimeString()}) ===\nDeals: ${zoho.deals.map(d => `${d.Deal_Name} (${d.Account_Name}) — ${d.Stage} — $${d.Amount||"?"}`).join(" | ")}\nContacts: ${zoho.contacts.slice(0,6).map(c => `${c.First_Name||""} ${c.Last_Name} / ${c.Title||""} @ ${c.Account_Name||""}`).join(" | ")}\n`
    : "\n(Zoho CRM not connected — using local data)\n";

  let orgMemory = '';
  let ratedAnswers = '';
  try {
    [orgMemory, ratedAnswers] = await Promise.all([
      memoryBlock('org', 'org'),
      feedbackBlock(10),
    ]);
  } catch { /* non-fatal */ }

  return `You are Scout — the home desk for ST1 Sports. You help with prices, pipeline, contacts, and next actions. For a cost, list, MAP, or "what's the price" question, call get_st1_pricing — that is the fast lookup on the same dealer lists Edgar uses. Only call call_edgar when the user explicitly wants a quote built (a school, qty, or the word quote). Do not invent prices. Do not ask for a SKU until a lookup has returned no match.
${ST1}
Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
${orgMemory ? `\n=== ORG MEMORY ===\n${orgMemory}\n` : ''}${ratedAnswers ? `\n=== MATT'S RATED ANSWERS — FOLLOW THESE ===\n${ratedAnswers}\n` : ''}
${zohoSection}
=== LOCAL PIPELINE ===
${open.length} open deals · $${Math.round(pipeline).toLocaleString()} total · ${overdue.length} overdue · ${hot.length} hot 🔥
${overdue.slice(0,5).map(d=>`OVERDUE: ${d.name} (${d.school||""}) — ${d.stage}`).join("\n")}
${open.slice(0,15).map(d=>`· ${d.name} — ${d.stage} — $${(d.value||0).toLocaleString()}${d.followUpDate?` — due ${d.followUpDate}`:""}${d.priority==="hot"?" 🔥":""}`).join("\n")}

=== TOP CONTACTS (by lead score) ===
${topContacts.length === 0 ? "No scored contacts yet" : topContacts.map(c=>`· ${c.fullName||[c.firstName,c.lastName].filter(Boolean).join(" ")} (${c.score||0}pts) — ${c.title||""}, ${c.school||""}, ${c.state||""} — ${c.email||"no email"}`).join("\n")}
${contacts.filter(c=>c.email).length} contacts with email

=== ACTIVE CAMPAIGNS ===
${sequences.filter(s=>s.status==="active").length === 0 ? "None" : sequences.filter(s=>s.status==="active").map(s=>`· "${s.name}" — ${s.activeCount||0} active`).join("\n")}

=== OPEN RFPs ===
${activeRfps.length === 0 ? "None" : activeRfps.map(r=>`· ${r.name} — ${r.stage}${r.dueDate?` — due ${r.dueDate}`:""}`).join("\n")}

=== AR ===
$${Math.round(ar).toLocaleString()} outstanding${invoices.filter(i=>i.status==="overdue").length>0?` — ${invoices.filter(i=>i.status==="overdue").length} overdue`:""}

Product catalog lives on the dealer price lists. Call get_st1_pricing for a cost or list. Call call_edgar only for a formal quote.
${(() => {
  const own = priceLists.filter(pl => pl.type === "own");
  const comp = priceLists.filter(pl => pl.type === "competitor");
  let out = "";
  if (own.length > 0) {
    out += `\n=== OUR PRICE LISTS (${own.length} lists — names and counts only) ===\n`;
    for (const pl of own) {
      out += `${pl.name}${pl.source ? " ["+pl.source+"]" : ""} — ${pl.itemCount || pl.items?.length || 0} items\n`;
    }
    out += `These lists can have thousands of SKUs. Never answer a product price from a sample. Always call get_st1_pricing with the product name/model. Use call_edgar only when they want a formal quote.\n`;
  }
  if (comp.length > 0) {
    out += `\n=== COMPETITOR PRICING INTEL (${comp.length} sources) ===\n`;
    for (const pl of comp) {
      out += `${pl.competitorName || pl.name}${pl.source ? " ["+pl.source+"]" : ""}${pl.notes ? " — "+pl.notes : ""} — ${pl.itemCount || pl.items?.length || 0} items\n`;
      const items = (pl.items || []).slice(0, 15);
      for (const it of items) {
        out += `  · ${it.name}${it.sku ? " ["+it.sku+"]" : ""}`;
        if (it.price > 0) out += ` — $${Number(it.price).toFixed(2)}`;
        if (it.notes) out += ` (${it.notes})`;
        out += "\n";
      }
      if ((pl.itemCount || (pl.items || []).length) > 15) {
        const extra = (pl.itemCount || pl.items.length) - 15;
        out += `  ... and ${extra} more items\n`;
      }
    }
    out += `Use competitor pricing to position ST1 competitively. When responding to RFPs, reference how ST1's pricing compares to known competitors — highlight our advantages (service, speed, quality) even when we're not cheapest.\n`;
  }
  return out;
})()}
${storedIntel.length > 0 ? `=== STORED COMPETITOR INTEL (${storedIntel.length} competitors) ===
${storedIntel.map(c => `· ${c.name}: ${c.summary}`).join("\n")}
(Use this when answering questions about competitors or building counter-strategies)
` : ""}=== BRAND VOICE — ALWAYS APPLY ===
Every email draft, campaign sequence, and customer-facing response must reflect ST1's brand:
• Lead with the relationship: "We were thinking about your program" not "We offer the fastest turnaround"
• Reference the athlete and the sport culture — not just the coach or the product SKU
• Use plain, direct sentences. No bullet-pointed sales decks. No formal closings like "Best regards"
• Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com
• If a prospect mentions a competitor (BSN, Dick's, gearUP, SquadLocker, etc.), acknowledge it and pivot to what ST1 uniquely offers: human contact, all-sport breadth, culture-driven product
• Graphic tee drops are a culture play — not a commodity item. Frame them as limited collections with names, not "custom apparel"

=== ROUTING — CHOOSE THE RIGHT ACTION ===
For every message, first classify the intent, then act:

AUTHORITATIVE ST1 KNOWLEDGE — DO NOT GUESS:
- Use search_st1_knowledge for broad questions about uploaded docs, policies, products, vendors, brands, customers, or internal ST1 knowledge.
- For a named product cost, list, MAP, or margin check: call get_st1_pricing. Do not ask for a SKU first. Do not call Edgar unless they asked for a quote.
- Use call_edgar only when they want a formal quote built (school/customer, quantity, "quote this", "build a quote", "price this out for").
- Use get_st1_product for product details, availability, catalog fields, or product source questions.
- Use get_st1_customer for customer/contact/school/lead lookups when the answer depends on internal data.
- Use get_st1_policy for AI safety, pricing rules, brand voice, sponsorship config, customer-data rules, or sales talk track.
- Use the tool result's sources and limitations in your answer. If a tool says not_found or unavailable, say the authoritative source did not have it.

RESPOND DIRECTLY (no tools) when:
- User asks a question answerable from the context above and no authoritative ST1 tool is needed
- User asks for analysis, prioritization, or strategy recommendations
- User asks "what should I do next" or "what's my pipeline looking like"
- Greeting or clarification

USE propose_draft_email when:
- User says "write", "draft", "send", "email", or "reach out" to a specific person or school
- ALWAYS chain: draft_email → log_note (summarizing outreach) → schedule_followup (3 business days out)
- ALWAYS write a COMPLETE, personalized email body — no placeholders
- Apply ST1 brand voice: warm, direct, athlete-aware — never efficiency-first or corporate
- Lead with the person or their program, not the product
- Under 100 words for follow-ups; under 150 for cold outreach — shorter is better
- Sign all emails as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com

USE propose_create_deal when:
- User says "add a deal", "create a deal", "new opportunity", or describes a new sales opportunity

USE propose_add_contact when:
- User says "add", "save", or "track" a new prospect or contact

USE propose_create_campaign_sequence when:
- User says "build a campaign", "send to a group", "email all [sport] coaches", "reach out to [segment]", or describes outbound to multiple people
- Write COMPLETE email bodies for every touch in the sequence

USE get_st1_pricing (fast — default for price questions) when:
- User asks cost, list, MAP, "how much", "what's our price", or names a model/SKU without asking to quote a school
- After it returns, write 1-2 short sentences only. Do not paste markdown tables or cost dumps — the UI shows the price card. Offer to quote if they name a school.
- If not found, then ask for a SKU or a more specific name

USE call_edgar (formal quotes only) when:
- User says "quote", "build a quote", "update the quote", "price this out for [school]", or gives a customer + qty they want on a quote
- After Edgar returns, write 1-2 short sentences only. Do not paste markdown tables — the UI shows the quote card
- After Edgar returns, chain propose_create_deal if a deal should be tracked, or propose_log_note to record it
- If an OPEN QUOTE is listed below, keep that SKU's cost and sell price. Only change qty or add/remove lines. Set reprice:true only if they asked to refresh the dealer list.

USE call_ledger when:
- A CRM deal is marked "Closed Won" and an invoice needs to be created → task:"invoice", pass crmDealId and crmDealName
- User says "/reconcile", "reconcile my deposits", "match deposits", "what's unmatched", "check bank transactions" → task:"reconcile"
- User says "/bill", "process a vendor bill", "map this vendor invoice", "vendor invoice" → task:"vendor-bill"
- User asks about payment status, overdue invoices, "who hasn't paid", "check invoice status", "send reminders" → task:"payments"
- Finance or accounting tasks that are not about quoting customers or prospecting leads

USE call_brad (preferred for prospecting outreach) when:
- User asks to "prospect", "find leads", "reach out to coaches/ADs", "run outreach", or "email [segment]" without naming a specific person
- Brad automatically applies DNC checks, 14-day re-touch barriers, and daily caps
- Brad returns drafts flagged requiresApproval — nothing sends without a human click
- For a single specific named person ("email Coach Smith at Lincoln High"), use propose_draft_email instead

USE propose_create_quote when:
- Edgar is unavailable or the items are clearly custom/not in the price database

USE propose_flag_deal when:
- User says a deal is urgent, high priority, or mentions a hot lead

USE propose_schedule_followup when:
- User says "remind me", "follow up on", "check back with" — or as part of the email chain

USE propose_add_to_nurture when:
- User says to put a contact in nurture, or a contact has gone cold/unresponsive

USE propose_log_note when:
- User says "log", "note", "record" something on a deal — or as part of the email chain

USE remember_this (auto-executes silently) when:
- Matt tells you something factual about a customer, school, or contact that should persist
- A customer states their budget, timeline, contact preference, or sport priority
- A deal closes (won or lost) — record the outcome and reason
- Matt shares any preference, constraint, or context he expects you to recall next time
- You learn something new about a competitor beyond what propose_store_competitor_intel captures
- Always entity-namespace correctly: 'customer:Name', 'contact:Name', 'competitor:Name', or 'org' for general

USE propose_store_competitor_intel (auto-executes silently) when:
- ANYTHING about a competitor is mentioned, researched, or discussed — always save it

=== YOUR TOOLS ===
1. propose_create_deal — suggest creating a deal (user confirms)
2. propose_add_contact — suggest adding a prospect (user confirms)
3. propose_draft_email — compose a personalized email for a single known contact (user reviews + sends)
4. propose_schedule_followup — set a follow-up date on a deal
5. propose_flag_deal — mark a deal as hot/warm priority
6. propose_add_to_nurture — add cold leads to email nurture campaign
7. propose_log_note — log notes on a deal
8. propose_create_quote — build and create a real Zoho CRM Quote (linked to the Account) for a customer; fallback for when call_edgar can't price the items
9. propose_store_competitor_intel — save competitor research to the Competitors tab (auto-executes, no user confirm needed)
10. propose_create_campaign_sequence — write a multi-email sequence, match contacts by sport/state/title/score, and set up the campaign ready to schedule and launch
11. call_edgar — formal quote only. Searches dealer lists, applies GM floor + MAP, returns edgar_quote. On an update of an open quote, hold cost and sell price unless they asked to reprice. Not for casual price checks.
12. call_brad — research leads and draft outreach with guardrails (DNC + 14-day re-touch + daily cap; returns brad_outreach action for human approval)
13. call_ledger — create invoices (deal-won), reconcile deposits, process vendor bills, poll payment status (returns ledger_invoice / ledger_reconcile / ledger_vendor_bill / ledger_payments action)
14. remember_this — save a fact to org memory so it persists across conversations (auto-executes, no user confirm)
15. search_st1_knowledge — search uploaded docs and safe ST1 business knowledge
16. get_st1_pricing / get_st1_product / get_st1_vendor / get_st1_brand / get_st1_customer / get_st1_policy — authoritative read-only lookups with sources

IMPORTANT BEHAVIORS:
- Always personalize emails with real names, real school names, real products
- Be specific and tactical — use actual deal names, contact names, dollar amounts from context
- Flag 🔥 when you see genuine urgency or high value

AUTOMATION — ALWAYS DO THIS:
- When you propose_draft_email, ALWAYS also propose_log_note (summarizing the outreach) AND propose_schedule_followup (3 business days out) in the SAME response. Never draft an email without the follow-up chain.
- When a user says an email was sent, immediately propose_log_note with a summary and propose_schedule_followup for 3 days out. These will be auto-executed without user clicks.
- Always propose the full next-step chain: email → follow-up in 3 days → "if no response" nurture add at 7 days.
- If asked "what's next" or "auto-execute", respond with propose_log_note + propose_schedule_followup right away.
- Never end a conversation with just an email draft — always add the follow-up scaffolding.

COMPETITOR INTEL — ALWAYS DO THIS:
- Whenever you research, discuss, learn, or look up ANYTHING about a competitor (BSN Sports, VS Athletics, MF Athletic, School Specialty, Varsity Group, Gopher Sport, Anderson's, Epic Sports, or any other athletic equipment supplier), ALWAYS call propose_store_competitor_intel to save the intel.
- This auto-executes silently — the user just sees a "✓ Saved" chip. It does not require confirmation.
- Include: product/category focus, pricing approach (premium/value/volume), key states/markets, their strengths, their weaknesses vs ST1, and how Matt should counter them.
- If the user mentions a competitor in passing ("BSN Sports bid lower on that RFP"), save that pricing intel too.
- If new info about an already-stored competitor is found, update it with the combined/latest intel.

PRICING & RFP STRATEGY:
- When asked "how much should we charge", "what's our cost", or "what's the price" — call get_st1_pricing. Do not guess from list-name samples in this prompt. Call call_edgar only if they want a quote for a named school.
- For RFP responses: always check COMPETITOR PRICING INTEL. If we have a competitor's price on the same or similar item, proactively note the comparison and suggest a strategy (match, undercut slightly, or justify higher with service/speed/quality).
- When we have no price data, suggest 20–40% margin over cost as a general rule for athletic equipment, and recommend Matt reviews before submitting.
- Always include confidence level when quoting prices: "Based on our price list" vs "Estimated — confirm with Matt before quoting".

CAMPAIGN BUILDING:
- When a user asks to "send a sequence", "build a campaign", "email X coaches", or "reach out to Y group", use propose_create_campaign_sequence.
- Always write COMPLETE email bodies — not placeholders. Every email should be fully personalized and ready to send.
- For contact_filters, be specific: if the user says "baseball coaches in Iowa" → sports:["Baseball","Baseball/Softball"], states:["IA"], titles:["Coach","Head Coach","Athletic Director"].
- Each email in the sequence should be a distinct touch with its own angle:
  • Email 1 = personal intro, relationship hook — reference their sport or program specifically
  • Email 2 = value angle — a specific product, a school they know, a season timing hook — NO generic "checking in"
  • Email 3 = direct ask or low-friction offer — "Worth a 10-minute call?" or "Want me to send a quick quote?"
- delay_days: email 1 = 0, email 2 = 3–5 days, email 3 = 7–10 days.
- Apply ST1 brand voice throughout: warm, direct, athlete-aware, short sentences
- Never use "hope this finds you well", "I wanted to reach out", "as per my last email", or efficiency-first angles
- Always sign emails: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com

After using tools, respond with a JSON object:
{"message":"your response text","actions":[...tool proposals...],"suggestions":["follow-up 1","follow-up 2","follow-up 3"]}

Each tool proposal maps to an action in the actions array with the same fields from the tool input plus type: "create_deal"|"add_contact"|"draft_email"|"schedule_followup"|"flag_deal"|"add_to_nurture"|"log_note"|"create_quote"|"create_campaign_sequence"
get_st1_pricing executes server-side and returns type:"st1_price" with cost / list / GM automatically.
call_edgar executes server-side and returns type:"edgar_quote" with the full verified quote automatically. Open-quote cost and sell price are held unless the user asked to reprice.
call_brad executes server-side and returns type:"brad_outreach" with requiresApproval drafts for human review.
call_ledger executes server-side and returns type:"ledger_invoice"|"ledger_reconcile"|"ledger_vendor_bill"|"ledger_payments" depending on the task.
${lockedQuote?.items?.length ? `
=== OPEN QUOTE — HOLD COST AND SELL PRICE ===
${formatLockedQuoteBlock(lockedQuote)}
This quote is already priced. On "update the quote", a qty change, add/remove a line, or a CREATE IN ZOHO follow-up:
- call_edgar and keep the same SKU, cost, and quotedPrice
- only change quantity or add/remove items they asked about
- do NOT pick a new dealer-list cost or a new sell price
Only refresh cost/list if they say reprice, new cost, latest list, refresh price, or dealer list changed.
If they name prices, apply each to the right line only: ball/program $ stays on the goods, customization/add-on $ stays on that add-on, shipping $ stays on shipping. Never copy the ball price onto customization. A line total like $2,294.60 is not a unit price. If they say cost is from Spalding, search Spalding — do not keep an Athletic Connection cost.
` : ''}`;
}

// ── CALL CLAUDE ───────────────────────────────────────────────────────────────
async function callClaude(messages, system, tools, apiKey, { forceText } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28_000);
  try {
    const body = {
      model:       "claude-sonnet-4-6",
      max_tokens:  2000,
      system,
      messages,
    };
    if (forceText) {
      body.tool_choice = { type: "none" };
      if (tools?.length) body.tools = tools;
    } else if (tools?.length) {
      body.tools = tools;
      body.tool_choice = { type: "auto" };
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers first — guaranteed even if the function crashes below
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Hard deadline — ensures we always send a response before Vercel can drop the connection
  const deadline = new Promise(resolve =>
    setTimeout(() => resolve("timeout"), 55_000)
  );
  try {
    const result = await Promise.race([_handler(req, res), deadline]);
    if (result === "timeout" && !res.headersSent) {
      res.status(504).json({ error: "Agent timed out — try a shorter question" });
    }
  } catch (err) {
    console.error("[agent] unhandled crash:", err.message, err.stack);
    if (!res.headersSent) res.status(500).json({ error: `Agent crashed: ${err.message}` });
  }
}

async function _handler(req, res) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_KEY not configured" });

  const { messages: rawMessages, localContext = {} } = req.body || {};
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    return res.status(400).json({ error: "messages array required" });
  }

  const lastUser = [...rawMessages].reverse().find(m => m.role === 'user')?.content || '';
  const lockedQuote = resolveLockedQuote(localContext, lastUser);
  const intent = quoteIntent(lastUser);
  const ctx = { ...localContext, lockedQuote, quoteRates: intent.rates };

  const zoho = await fetchZohoContext();

  const system  = await buildSystemPrompt(ctx, zoho);
  const baseUrl = `https://${req.headers.host}`;

  // Convert history to Anthropic format
  const messages = rawMessages.map(m => ({
    role:    m.role === "user" ? "user" : "assistant",
    content: m.role === "user" ? m.content : (m.raw || m.content || ""),
  }));

  // Tool call loop — enough room for a lookup + a follow-up + a written answer
  const MAX_LOOPS   = 3;
  let allToolCalls  = [];   // all tool_use blocks across all loops
  let agentResults  = [];   // { name, input, output } for call_edgar / call_brad
  let loopCount     = 0;
  let finalText     = "";
  let searchUsed    = false;

  while (loopCount < MAX_LOOPS) {
    let response;
    try {
      response = await callClaude(messages, system, TOOLS, apiKey);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const textBlocks    = (response.content || []).filter(b => b.type === "text");
    const toolUseBlocks = (response.content || []).filter(b => b.type === "tool_use");

    if (textBlocks.length) finalText = textBlocks.map(b => b.text).join("");

    for (const t of toolUseBlocks) allToolCalls.push(t);

    // Done when no tool calls or stop reason is end_turn
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") break;

    // Build tool results — execute Edgar/Brad for real, synthetic for everything else
    messages.push({ role: "assistant", content: response.content });
    const toolResults = await Promise.all(toolUseBlocks.map(async t => {
      if (t.name === "call_edgar") {
        const output = await callEdgar(t.input, baseUrl, {
          items: lockedQuote?.items || [],
          reprice: intent.reprice || t.input?.reprice === true,
          lockSell: intent.lockSell,
          lockCost: intent.lockCost,
          quoteRates: intent.rates,
          preferredSupplier: intent.preferredSupplier,
        });
        agentResults.push({ name: "call_edgar", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      if (t.name === "call_brad") {
        const output = await callBrad(t.input, baseUrl, localContext);
        agentResults.push({ name: "call_brad", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      if (t.name === "call_ledger") {
        const output = await callLedger(t.input, baseUrl);
        agentResults.push({ name: "call_ledger", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      if (t.name === "remember_this") {
        try {
          await remember({
            scope: 'org',
            entity: t.input.entity || 'org',
            key: t.input.key,
            value: t.input.value,
            agentId: 'revops-agent',
          });
        } catch { /* non-fatal */ }
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify({ ok: true, remembered: true }) };
      }
      if (KNOWLEDGE_TOOL_NAMES.has(t.name)) {
        if (t.name === 'get_st1_pricing' && lockedQuote?.items?.length && !intent.reprice) {
          const lockHit = matchLockedItem({
            sku: t.input?.sku,
            name: t.input?.productName || t.input?.query || t.input?.sku,
            query: pricingQueryOf(t.input),
          }, lockedQuote.items);
          if (lockHit) {
            const output = lockedPricingToolResult(t.input, lockHit);
            agentResults.push({ name: t.name, input: t.input, output });
            return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
          }
        }
        const tool = getTool(t.name);
        let output = tool
          ? await invokeTool(tool, t.input || {}, INTERNAL_TOOL_AUTH)
          : { ok: false, error: { code: 'unknown_tool', message: `Unknown knowledge tool ${t.name}` } };
        if (t.name === 'get_st1_pricing' && lockedQuote?.items?.length && !intent.reprice) {
          output = overlayLockedPricing(output, lockedQuote.items);
        }
        agentResults.push({ name: t.name, input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify({ proposed: true, ...t.input }) };
    }));
    messages.push({ role: "user", content: toolResults });
    loopCount++;
  }

  // Parse final response — should be JSON. Pricing questions often end on a
  // tool_use turn with no text; force one text-only pass, then fall back to
  // a sentence built from the tool results so the chat never goes blank.
  let parsed = null;
  try {
    const m = finalText.match(/\{[\s\S]*\}/s);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* fallback to plain text */ }

  let message = usableChatMessage(parsed, finalText);
  if (!message) {
    try {
      const wrapUp = await callClaude(
        [
          ...messages,
          { role: "user", content: "Answer the user now as JSON only: {\"message\":\"...\",\"actions\":[],\"suggestions\":[\"...\"]}. Use the tool results already in this conversation. Do not call tools. If a price lookup or Edgar quote is present, message must be 1-2 short sentences — no markdown tables, no **bold** dump, no SKU/cost grid. The UI already shows the card." },
        ],
        system,
        TOOLS,
        apiKey,
        { forceText: true }
      );
      const wrapText = (wrapUp.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      if (wrapText) {
        finalText = wrapText;
        try {
          const m = wrapText.match(/\{[\s\S]*\}/s);
          if (m) parsed = JSON.parse(m[0]);
        } catch { /* keep wrapText */ }
        message = usableChatMessage(parsed, wrapText);
      }
    } catch { /* fall through to tool-result summary */ }
  }
  if (!message) message = messageFromToolResults(agentResults);
  if (!message) message = "I looked that up but did not get a readable answer. Try the product name or SKU again.";

  // Actions from Edgar/Brad executions (surfaced directly — no user confirm for edgar_quote shape;
  // brad_outreach drafts already carry requiresApproval: true from the agent)
  const agentActions = agentResults.map(r => {
    if (r.name === "call_edgar") {
      const quote = r.output?.metadata?.quote;
      if (!quote) return null;
      return { type: "edgar_quote", quote, warnings: r.output?.metadata?.warnings || [], task: r.input.task, customer: r.input.customer };
    }
    if (r.name === "get_st1_pricing") return st1PriceActionFromPricing(r.output);
    if (r.name === "call_brad") {
      const drafts = r.output?.metadata?.drafts || [];
      if (!drafts.length) return null;
      return { type: "brad_outreach", drafts, skipped: r.output?.metadata?.skipped || [], task: r.input.task };
    }
    if (r.name === "call_ledger") {
      if (r.output?.error) return null;
      // action type mirrors the task: ledger_invoice | ledger_reconcile | ledger_vendor_bill
      const actionType = `ledger_${(r.input.task || 'reconcile').replace('-', '_')}`;
      return { type: actionType, task: r.input.task, result: r.output, dryRun: r.input.dryRun ?? true };
    }
    return null;
  }).filter(Boolean);
  const hasEdgarQuote = agentActions.some(a => a.type === "edgar_quote");
  const surfacedActions = hasEdgarQuote ? agentActions.filter(a => a.type !== "st1_price") : agentActions;

  // Actions from proposal tools (exclude agent tools — they're handled above)
  const typeMap = {
    propose_create_deal:              "create_deal",
    propose_add_contact:              "add_contact",
    propose_draft_email:              "draft_email",
    propose_schedule_followup:        "schedule_followup",
    propose_flag_deal:                "flag_deal",
    propose_add_to_nurture:           "add_to_nurture",
    propose_log_note:                 "log_note",
    propose_create_quote:             "create_quote",
    propose_store_competitor_intel:   "store_competitor_intel",
    propose_create_campaign_sequence: "create_campaign_sequence",
  };
  const proposedActions = allToolCalls
    .filter(t => t.name !== "call_edgar" && t.name !== "call_brad" && t.name !== "call_ledger" && t.name !== "remember_this" && !KNOWLEDGE_TOOL_NAMES.has(t.name))
    .map(t => ({ type: typeMap[t.name] || t.name, ...t.input }));

  const actions     = mergeScoutActions(surfacedActions, proposedActions, parsed?.actions);
  const suggestions = parsed?.suggestions || [];

  // Fire-and-forget: log this interaction to agent memory
  logInteraction({
    agentId: 'revops-agent',
    action: 'chat',
    input: { query: rawMessages[rawMessages.length - 1]?.content?.slice(0, 200) },
    output: { actionCount: actions.length, message: String(message || '').slice(0, 200) },
    dryRun: false,
  }).catch(() => {});

  return res.json({ message, actions, suggestions, liveZoho: zoho.ok, searchUsed });
}
