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
    description: "Build and create a Zoho Books estimate/quote for a customer based on their needs. Use product catalog rates as base cost and apply appropriate margin.",
    input_schema: {
      type: "object",
      properties: {
        customer_name:  { type: "string", description: "Customer or school name" },
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
            },
            required: ["name", "quantity", "rate"],
          },
        },
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
    description: "Build an accurate quote using ST1's live dealer price database. Edgar reads real costs, enforces GM floor and MAP minimums, and returns verified line-item pricing. Always prefer this over propose_create_quote whenever the user asks for a quote, estimate, or 'how much would X cost' for specific products.",
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
              qty:  { type: "number" },
            },
            required: ["name"],
          },
        },
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

// ── ZOHO BOOKS INVENTORY ──────────────────────────────────────────────────────
async function fetchZohoInventory() {
  try {
    const orgId = process.env.ZOHO_ORG_ID;
    if (!orgId) return [];
    const token = await getZohoToken();
    const res = await fetchWithTimeout(
      `https://www.zohoapis.com/books/v3/items?organization_id=${orgId}&per_page=50&filter_by=Status.Active`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(i => ({
      name: i.name,
      rate: parseFloat(i.rate || i.selling_price || 0),
      sku:  i.sku  || "",
      unit: i.unit || "",
    }));
  } catch {
    return [];
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

async function callEdgar(input, baseUrl) {
  try {
    const r = await fetchWithTimeout(
      `${baseUrl}/api/agents/edgar`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task: input.task, input: { customer: input.customer, items: input.items } }),
      },
      20_000
    );
    if (!r.ok) return { error: `Edgar returned HTTP ${r.status}` };
    return r.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function callBrad(input, baseUrl) {
  try {
    const r = await fetchWithTimeout(
      `${baseUrl}/api/agents/brad`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task: input.task, input: { contactId: input.contactId, minScore: input.minScore } }),
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
function buildSystemPrompt(localCtx, zoho, inventory = []) {
  const deals    = localCtx.deals    || [];
  const contacts = localCtx.contacts || [];
  const rfps     = localCtx.rfps     || [];
  const invoices = localCtx.invoices || [];
  const sequences = localCtx.sequences || [];
  const priceLists = localCtx.priceLists || [];
  const storedIntel = localCtx.competeIntel || [];
  const brandVoice = localCtx.brandVoice || "";

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

  return `You are the ST1 Sports RevOps AI Agent — a senior sales & outreach strategist with full visibility into the pipeline, contacts, and business context.
${ST1}
Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}

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

${inventory.length > 0 ? `=== PRODUCT CATALOG (${inventory.length} active items from Zoho Books) ===
${inventory.slice(0, 35).map(i => `· ${i.name}${i.sku ? " ["+i.sku+"]" : ""} — $${i.rate.toFixed(2)}${i.unit ? " / "+i.unit : ""}`).join("\n")}
(Use these rates as the base cost when building quotes — apply margin on top)
` : ""}${(() => {
  const own = priceLists.filter(pl => pl.type === "own");
  const comp = priceLists.filter(pl => pl.type === "competitor");
  let out = "";
  if (own.length > 0) {
    out += `\n=== OUR PRICE LISTS (${own.length} lists) ===\n`;
    for (const pl of own) {
      out += `${pl.name}${pl.source ? " ["+pl.source+"]" : ""} — ${pl.itemCount || pl.items?.length || 0} items\n`;
      const items = (pl.items || []).slice(0, 20);
      for (const it of items) {
        out += `  · ${it.name}${it.sku ? " ["+it.sku+"]" : ""}${it.category ? " ("+it.category+")" : ""}`;
        if (it.cost > 0) out += ` — Our Cost: $${Number(it.cost).toFixed(2)}`;
        if (it.price > 0) {
          out += ` — Our Price: $${Number(it.price).toFixed(2)}`;
          if (it.cost > 0) out += ` (${Math.round((it.price - it.cost) / it.price * 100)}% margin)`;
        }
        out += "\n";
      }
      if ((pl.items || []).length > 20) out += `  ... and ${(pl.items||[]).length - 20} more items\n`;
    }
    out += `Use these costs when answering pricing questions or building quotes. List price = what we charge customers.\n`;
  }
  if (comp.length > 0) {
    out += `\n=== COMPETITOR PRICING INTEL (${comp.length} sources) ===\n`;
    for (const pl of comp) {
      out += `${pl.competitorName || pl.name}${pl.source ? " ["+pl.source+"]" : ""}${pl.notes ? " — "+pl.notes : ""} — ${pl.itemCount || pl.items?.length || 0} items\n`;
      const items = (pl.items || []).slice(0, 20);
      for (const it of items) {
        out += `  · ${it.name}${it.sku ? " ["+it.sku+"]" : ""}`;
        if (it.price > 0) out += ` — $${Number(it.price).toFixed(2)}`;
        if (it.notes) out += ` (${it.notes})`;
        out += "\n";
      }
      if ((pl.items || []).length > 20) out += `  ... and ${(pl.items||[]).length - 20} more items\n`;
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

RESPOND DIRECTLY (no tools) when:
- User asks a question answerable from the context above (pipeline status, deal details, contact lookup, AR balance, RFP status, pricing from price list)
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

USE call_edgar (preferred for all quoting) when:
- User asks to "build a quote", "price this out", "what would X cost", "create an estimate", or names specific products
- Always prefer call_edgar over propose_create_quote — Edgar reads live dealer costs and enforces GM floor + MAP
- After Edgar returns, chain propose_create_deal if a deal should be tracked, or propose_log_note to record it

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
8. propose_create_quote — Zoho Books estimate fallback (use call_edgar instead when possible)
9. propose_store_competitor_intel — save competitor research to the Competitors tab (auto-executes, no user confirm needed)
10. propose_create_campaign_sequence — write a multi-email sequence, match contacts by sport/state/title/score, and set up the campaign ready to schedule and launch
11. call_edgar — build an accurate quote from live dealer prices (GM floor + MAP enforced server-side; returns edgar_quote action)
12. call_brad — research leads and draft outreach with guardrails (DNC + 14-day re-touch + daily cap; returns brad_outreach action for human approval)
13. call_ledger — create invoices (deal-won), reconcile deposits, process vendor bills, poll payment status (returns ledger_invoice / ledger_reconcile / ledger_vendor_bill / ledger_payments action)

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
- When asked "how much should we charge", "what's our cost", or "what's the price" — reference OUR PRICE LISTS first, then fall back to the Zoho Books product catalog.
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
call_edgar executes server-side and returns type:"edgar_quote" with the full verified quote automatically.
call_brad executes server-side and returns type:"brad_outreach" with requiresApproval drafts for human review.
call_ledger executes server-side and returns type:"ledger_invoice"|"ledger_reconcile"|"ledger_vendor_bill"|"ledger_payments" depending on the task.`;
}

// ── CALL CLAUDE ───────────────────────────────────────────────────────────────
async function callClaude(messages, system, tools, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:       "claude-sonnet-4-6",
        max_tokens:  2000,
        system,
        tools,
        tool_choice: { type: "auto" },
        messages,
      }),
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

  // Fetch fresh Zoho context + inventory in parallel
  const [zoho, inventory] = await Promise.all([fetchZohoContext(), fetchZohoInventory()]);

  const system  = buildSystemPrompt(localContext, zoho, inventory);
  const baseUrl = `https://${req.headers.host}`;

  // Convert history to Anthropic format
  const messages = rawMessages.map(m => ({
    role:    m.role === "user" ? "user" : "assistant",
    content: m.role === "user" ? m.content : (m.raw || m.content || ""),
  }));

  // Tool call loop — max 2 iterations
  const MAX_LOOPS   = 2;
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
        const output = await callEdgar(t.input, baseUrl);
        agentResults.push({ name: "call_edgar", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      if (t.name === "call_brad") {
        const output = await callBrad(t.input, baseUrl);
        agentResults.push({ name: "call_brad", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      if (t.name === "call_ledger") {
        const output = await callLedger(t.input, baseUrl);
        agentResults.push({ name: "call_ledger", input: t.input, output });
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(output) };
      }
      return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify({ proposed: true, ...t.input }) };
    }));
    messages.push({ role: "user", content: toolResults });
    loopCount++;
  }

  // Parse final response — should be JSON
  let parsed = null;
  try {
    const m = finalText.match(/\{[\s\S]*\}/s);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* fallback to plain text */ }

  // Actions from Edgar/Brad executions (surfaced directly — no user confirm for edgar_quote shape;
  // brad_outreach drafts already carry requiresApproval: true from the agent)
  const agentActions = agentResults.map(r => {
    if (r.name === "call_edgar") {
      const quote = r.output?.metadata?.quote;
      if (!quote) return null;
      return { type: "edgar_quote", quote, warnings: r.output?.metadata?.warnings || [], task: r.input.task, customer: r.input.customer };
    }
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
    .filter(t => t.name !== "call_edgar" && t.name !== "call_brad" && t.name !== "call_ledger")
    .map(t => ({ type: typeMap[t.name] || t.name, ...t.input }));

  const actions     = [...agentActions, ...proposedActions, ...(parsed?.actions || [])];
  const suggestions = parsed?.suggestions || [];
  const message     = parsed?.message || finalText;

  return res.json({ message, actions, suggestions, liveZoho: zoho.ok, searchUsed });
}
