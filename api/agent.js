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

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
  maxDuration: 60,
};

const ST1 = `ST1 Sports — premium athletic equipment (hurdles, starting blocks, shot puts, throws equipment, training gear) sold directly to high school and college athletic programs, coaches, and athletic directors across the US. Based in Colorado. Owner: Matt Stone (matt@st1sports.com, 719-256-0275). Website: st1sports.com. Direct sales model, volume discounts for teams, fast shipping, personalized service.`;

// ── TOOLS ────────────────────────────────────────────────────────────────────
const TOOLS = [
  // Web search — Anthropic executes this automatically server-side
  {
    type: "web_search_20250305",
    name: "web_search",
  },
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
];

// ── ZOHO CONTEXT FETCH ───────────────────────────────────────────────────────
async function fetchZohoContext() {
  try {
    const token = await getZohoToken();
    const [dealsRes, contactsRes] = await Promise.allSettled([
      fetch(
        "https://www.zohoapis.com/crm/v3/Deals?fields=Deal_Name,Account_Name,Amount,Stage,Closing_Date,id&per_page=25&sort_by=Modified_Time&sort_order=desc",
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      ),
      fetch(
        "https://www.zohoapis.com/crm/v3/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,id&per_page=20&sort_by=Modified_Time&sort_order=desc",
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      ),
    ]);
    const deals    = dealsRes.status === "fulfilled" && dealsRes.value.ok    ? (await dealsRes.value.json()).data || []    : [];
    const contacts = contactsRes.status === "fulfilled" && contactsRes.value.ok ? (await contactsRes.value.json()).data || [] : [];
    return { deals, contacts, ok: true };
  } catch {
    return { deals: [], contacts: [], ok: false };
  }
}

// ── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────
function buildSystemPrompt(localCtx, zoho) {
  const deals    = localCtx.deals    || [];
  const contacts = localCtx.contacts || [];
  const rfps     = localCtx.rfps     || [];
  const invoices = localCtx.invoices || [];
  const sequences = localCtx.sequences || [];

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
${sequences.filter(s=>s.status==="active").length === 0 ? "None" : sequences.filter(s=>s.status==="active").map(s=>`· "${s.name}" — ${s.enrollments?.filter(e=>e.status==="active").length||0} active`).join("\n")}

=== OPEN RFPs ===
${activeRfps.length === 0 ? "None" : activeRfps.map(r=>`· ${r.name} — ${r.stage}${r.dueDate?` — due ${r.dueDate}`:""}`).join("\n")}

=== AR ===
$${Math.round(ar).toLocaleString()} outstanding${invoices.filter(i=>i.status==="overdue").length>0?` — ${invoices.filter(i=>i.status==="overdue").length} overdue`:""}

=== YOUR CAPABILITIES ===
You have access to:
1. web_search — search the web in real-time for prospect research, competitor intel, school budgets, coaching news
2. propose_create_deal — suggest creating a deal (user confirms)
3. propose_add_contact — suggest adding a prospect (user confirms)
4. propose_draft_email — compose a personalized email (user reviews + sends)
5. propose_schedule_followup — set a follow-up date on a deal
6. propose_flag_deal — mark a deal as hot/warm priority
7. propose_add_to_nurture — add cold leads to email nurture campaign
8. propose_log_note — log notes on a deal

IMPORTANT BEHAVIORS:
- Use web_search proactively when asked about specific prospects, schools, competitors, or market data
- Always personalize emails with real names, real school names, real products
- Be specific and tactical — use actual deal names, contact names, dollar amounts from context
- Flag 🔥 when you see genuine urgency or high value
- When drafting emails, include Matt's signature: Matt Stone | ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com

After using tools, respond with a JSON object:
{"message":"your response text","actions":[...tool proposals...],"suggestions":["follow-up 1","follow-up 2","follow-up 3"]}

Each tool proposal maps to an action in the actions array with the same fields from the tool input plus type: "create_deal"|"add_contact"|"draft_email"|"schedule_followup"|"flag_deal"|"add_to_nurture"|"log_note"`;
}

// ── CALL CLAUDE ───────────────────────────────────────────────────────────────
async function callClaude(messages, system, tools, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":  "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 3000,
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_KEY not configured" });

  const { messages: rawMessages, localContext = {} } = req.body || {};
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    return res.status(400).json({ error: "messages array required" });
  }

  // Fetch fresh Zoho context in parallel with nothing blocking
  const zoho = await fetchZohoContext();

  const system = buildSystemPrompt(localContext, zoho);

  // Convert history to Anthropic format
  const messages = rawMessages.map(m => ({
    role:    m.role === "user" ? "user" : "assistant",
    content: m.role === "user" ? m.content : (m.raw || m.content || ""),
  }));

  // Tool call loop — max 4 iterations to handle web_search + proposals
  const MAX_LOOPS = 4;
  let allToolCalls = [];
  let loopCount   = 0;
  let finalText   = "";
  let searchUsed  = false;

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

    // Track tool usage
    for (const t of toolUseBlocks) {
      if (t.name === "web_search") searchUsed = true;
      else allToolCalls.push(t);
    }

    // Done when no tool calls or stop reason is end_turn
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") break;

    // Add assistant turn, add synthetic tool results, loop
    messages.push({ role: "assistant", content: response.content });
    const toolResults = toolUseBlocks.map(t => ({
      type:        "tool_result",
      tool_use_id: t.id,
      content:     t.name === "web_search"
        ? "Search completed."
        : JSON.stringify({ proposed: true, ...t.input }),
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

  // Build actions from tool proposals + any in parsed.actions
  const proposedActions = allToolCalls
    .filter(t => t.name !== "web_search")
    .map(t => {
      const typeMap = {
        propose_create_deal:     "create_deal",
        propose_add_contact:     "add_contact",
        propose_draft_email:     "draft_email",
        propose_schedule_followup: "schedule_followup",
        propose_flag_deal:       "flag_deal",
        propose_add_to_nurture:  "add_to_nurture",
        propose_log_note:        "log_note",
      };
      return { type: typeMap[t.name] || t.name, ...t.input };
    });

  const actions     = [...proposedActions, ...(parsed?.actions || [])];
  const suggestions = parsed?.suggestions || [];
  const message     = parsed?.message || finalText;

  return res.json({ message, actions, suggestions, liveZoho: zoho.ok, searchUsed });
}
