/**
 * /api/agent  — Server-side RevOps AI Agent
 *
 * Upgrades the client-side agent to a proper agentic loop with:
 * - Real-time web search (Anthropic web_search_20250305, executes automatically)
 * - Live Zoho CRM context (fresh deals + contacts/leads fetched server-side)
 * - Live Zoho Books context (recent invoices + estimates)
 * - Query-specific retrieval over local app state: price lists, orders/store sales,
 *   invoices, reorders, campaigns, activity, contacts, deals, RFPs
 * - Tool proposals (create_deal, add_contact, send_email, add_to_nurture)
 *   returned in the actions array for user to confirm before execution
 *
 * POST body:
 *   { messages: ConversationMessage[], localContext: { deals, contacts, rfps, invoices, orders, reorders, campaigns, sequences, activity, priceLists } }
 *
 * Response:
 *   { message, actions, suggestions, liveZoho: bool, searchUsed: bool }
 */

import { getZohoToken } from './_lib/zoho-token.js';
import { prisma } from './_lib/prisma.js';

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
              item_id:     { type: "string", description: "Zoho Books item_id when the line item came from active Zoho inventory" },
              name:        { type: "string" },
              description: { type: "string" },
              quantity:    { type: "number" },
              rate:        { type: "number", description: "Price per unit after margin" },
              unit:        { type: "string", description: "Unit of measure, e.g. each, dozen, set" },
              source:      { type: "string", description: "Price source used, e.g. uploaded price list, seed catalog, Zoho Books" },
              confidence:  { type: "string", enum: ["high", "medium", "low"], description: "Confidence in the item/price match" },
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
    const [dealsRes, contactsRes, leadsRes] = await Promise.allSettled([
      fetchWithTimeout(
        "https://www.zohoapis.com/crm/v3/Deals?fields=Deal_Name,Account_Name,Amount,Stage,Closing_Date,id&per_page=25&sort_by=Modified_Time&sort_order=desc",
        hdrs
      ),
      fetchWithTimeout(
        "https://www.zohoapis.com/crm/v3/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,id&per_page=100&sort_by=Modified_Time&sort_order=desc",
        hdrs
      ),
      fetchWithTimeout(
        "https://www.zohoapis.com/crm/v3/Leads?fields=First_Name,Last_Name,Email,Phone,Title,Company,City,State,Lead_Source,Lead_Status,Rating,No_of_Calls,No_of_Chats,Last_Activity_Time,id&per_page=100&sort_by=Modified_Time&sort_order=desc",
        hdrs
      ),
    ]);
    const deals    = dealsRes.status === "fulfilled" && dealsRes.value.ok    ? (await dealsRes.value.json()).data || []    : [];
    const contacts = contactsRes.status === "fulfilled" && contactsRes.value.ok ? (await contactsRes.value.json()).data || [] : [];
    const leads    = leadsRes.status === "fulfilled" && leadsRes.value.ok    ? (await leadsRes.value.json()).data || []    : [];
    return { deals, contacts, leads, ok: true };
  } catch {
    return { deals: [], contacts: [], leads: [], ok: false };
  }
}

// ── ZOHO BOOKS INVENTORY ──────────────────────────────────────────────────────
async function fetchZohoInventory() {
  try {
    const orgId = process.env.ZOHO_ORG_ID;
    if (!orgId) return [];
    const token = await getZohoToken();
    const res = await fetchWithTimeout(
      `https://www.zohoapis.com/books/v3/items?organization_id=${orgId}&per_page=200&filter_by=Status.Active`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(i => ({
      item_id:     i.item_id,
      name:        i.name,
      description: i.description || "",
      rate:        parseFloat(i.rate || i.selling_price || 0),
      sku:         i.sku  || "",
      unit:        i.unit || "",
    }));
  } catch {
    return [];
  }
}

async function fetchZohoBooksContext() {
  try {
    const orgId = process.env.ZOHO_ORG_ID;
    if (!orgId) return { invoices: [], quotes: [], ok: false };
    const token = await getZohoToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    const [invoicesRes, quotesRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&per_page=50&sort_column=date&sort_order=D`,
        { headers }
      ),
      fetchWithTimeout(
        `https://www.zohoapis.com/books/v3/estimates?organization_id=${orgId}&per_page=50&sort_column=created_time&sort_order=D`,
        { headers }
      ),
    ]);

    const invoicesData = invoicesRes.status === "fulfilled" && invoicesRes.value.ok ? await invoicesRes.value.json() : {};
    const quotesData = quotesRes.status === "fulfilled" && quotesRes.value.ok ? await quotesRes.value.json() : {};
    const invoices = (invoicesData.invoices || []).map(inv => ({
      id: inv.invoice_id,
      number: inv.invoice_number || "",
      customer: inv.customer_name || "",
      customerId: inv.customer_id || "",
      status: inv.status || "",
      date: inv.date || "",
      dueDate: inv.due_date || "",
      total: Number(inv.total) || 0,
      balance: Number(inv.balance) || 0,
      source: "Zoho Books",
    }));
    const quotes = (quotesData.estimates || []).map(q => ({
      id: q.estimate_id,
      number: q.estimate_number || "",
      customer: q.customer_name || "",
      status: q.status || "",
      date: q.date || "",
      expiryDate: q.expiry_date || "",
      total: Number(q.total) || 0,
      source: "Zoho Books",
    }));
    return { invoices, quotes, ok: true };
  } catch {
    return { invoices: [], quotes: [], ok: false };
  }
}

async function fetchPersistedState() {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "app_state" } });
    return setting?.value && typeof setting.value === "object" ? setting.value : {};
  } catch {
    return {};
  }
}

async function fetchStoreProducts() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { updatedAt: "desc" },
      take: 150,
      select: {
        id: true,
        name: true,
        price: true,
        regular_price: true,
        sale_price: true,
        stock_status: true,
        short_description: true,
        categories: true,
        tags: true,
        brand: true,
        permalink: true,
      },
    });
    return products.map(p => ({
      id: p.id,
      name: p.name || "",
      price: Number.parseFloat(p.sale_price || p.price || p.regular_price || "0") || 0,
      stockStatus: p.stock_status || "",
      description: p.short_description || "",
      categories: Array.isArray(p.categories) ? p.categories : [],
      tags: Array.isArray(p.tags) ? p.tags : [],
      brand: p.brand || "",
      permalink: p.permalink || "",
      source: "WooCommerce/store product catalog",
    }));
  } catch {
    return [];
  }
}

function mergeByIdOrSignature(primary = [], fallback = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...primary, ...fallback]) {
    if (!item || typeof item !== "object") continue;
    const key = item.id || item.zohoId || item.number || item.name || JSON.stringify(item).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeIntelEntries(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => ({ name: item.name || item.competitor_name || "", summary: item.summary || item.intel || "" }))
      .filter(item => item.name);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, summary]) => ({ name, summary: String(summary || "") }));
  }
  return [];
}

function mergeAgentContext(clientCtx = {}, persisted = {}) {
  const keys = ["deals", "contacts", "rfps", "invoices", "orders", "reorders", "campaigns", "sequences", "priceLists", "quotes", "activity"];
  const merged = { ...persisted, ...clientCtx };
  for (const key of keys) {
    merged[key] = mergeByIdOrSignature(clientCtx[key] || [], persisted[key] || []);
  }
  const priceLists = new Map();
  for (const pl of persisted.priceLists || []) priceLists.set(pl.id || pl.name, pl);
  for (const pl of clientCtx.priceLists || []) {
    const key = pl.id || pl.name;
    const base = priceLists.get(key) || {};
    priceLists.set(key, {
      ...base,
      ...pl,
      items: mergeByIdOrSignature(pl.items || [], base.items || []),
    });
  }
  merged.priceLists = [...priceLists.values()];
  const intelMap = {};
  for (const entry of normalizeIntelEntries(persisted.competeIntel)) intelMap[entry.name] = entry.summary;
  for (const entry of normalizeIntelEntries(clientCtx.competeIntel)) intelMap[entry.name] = entry.summary;
  merged.competeIntel = Object.entries(intelMap).map(([name, summary]) => ({ name, summary }));
  merged.brandVoice = clientCtx.brandVoice || persisted.brandVoice || "";
  return merged;
}

const DEFAULT_CATALOG = [
  { source: "Seed Catalog", supplierName: "Blazer Athletic", sport: "Track & Field", sku: "BL-39AL", name: "Aluminum Hurdle 39\"", category: "Hurdles", unit: "each", cost: 224, price: 280 },
  { source: "Seed Catalog", supplierName: "Blazer Athletic", sport: "Track & Field", sku: "BL-30AL", name: "Aluminum Hurdle 30\"", category: "Hurdles", unit: "each", cost: 212, price: 265 },
  { source: "Seed Catalog", supplierName: "Blazer Athletic", sport: "Track & Field", sku: "BL-SB", name: "Starting Blocks Aluminum", category: "Sprint", unit: "each", cost: 156, price: 195 },
  { source: "Seed Catalog", supplierName: "Blazer Athletic", sport: "Track & Field", sku: "BL-HH39", name: "Steel Hurdle 39\" High Boy", category: "Hurdles", unit: "each", cost: 248, price: 315 },
  { source: "Seed Catalog", supplierName: "Gill Athletics", sport: "Track & Field", sku: "GA-SP8", name: "Soft Shot Put 8lb Girls", category: "Throws", unit: "each", cost: 112, price: 154 },
  { source: "Seed Catalog", supplierName: "Gill Athletics", sport: "Track & Field", sku: "GA-SP12", name: "Soft Shot Put 12lb Boys", category: "Throws", unit: "each", cost: 118, price: 154 },
  { source: "Seed Catalog", supplierName: "Gill Athletics", sport: "Track & Field", sku: "GA-DM16", name: "Discus 1.6kg HS Men", category: "Throws", unit: "each", cost: 70.4, price: 88 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-DOL1", name: "DOL-1 Official Game Ball", category: "Game Balls", unit: "dozen", cost: 52, price: 72 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-D1", name: "D1 Pro Game Ball", category: "Game Balls", unit: "dozen", cost: 66, price: 88 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-OB", name: "D1-OB Official Baseball", category: "Game Balls", unit: "dozen", cost: 58, price: 78 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-BP", name: "DBX-1 BP Ball", category: "Practice Balls", unit: "dozen", cost: 24, price: 34 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-SB", name: "DSB-1 Softball 12\"", category: "Softballs", unit: "dozen", cost: 44, price: 60 },
  { source: "Seed Catalog", supplierName: "Diamond Baseballs", sport: "Baseball/Softball", sku: "DIA-HEL", name: "DBX-1 Batter Helmet", category: "Helmets", unit: "each", cost: 98, price: 125 },
  { source: "Seed Catalog", supplierName: "Wilson / DeMarini", sport: "Baseball/Softball", sku: "WIL-A2000", name: "A2000 1786 11.5\" Glove", category: "Gloves", unit: "each", cost: 169, price: 282, map: 282 },
  { source: "Seed Catalog", supplierName: "Wilson / DeMarini", sport: "Baseball/Softball", sku: "DEM-VOO1", name: "DeMarini Voodoo One BBCOR", category: "Bats BBCOR", unit: "each", cost: 179, price: 299, map: 299 },
  { source: "Seed Catalog", supplierName: "Molten Volleyballs", sport: "Volleyball", sku: "MOL-V5M5", name: "V5M5000 Game Ball", category: "Game Balls", unit: "each", cost: 52, price: 68, map: 68 },
  { source: "Seed Catalog", supplierName: "Molten Volleyballs", sport: "Volleyball", sku: "MOL-V5M4", name: "V5M4500 Practice Ball", category: "Practice Balls", unit: "each", cost: 38, price: 49, map: 49 },
  { source: "Seed Catalog", supplierName: "FinishLynx / Lynx", sport: "Timing Systems", sku: "FL-1A205U", name: "Capture Button + USB Cord", category: "Hardware", unit: "each", cost: 398, price: 498 },
  { source: "Seed Catalog", supplierName: "FinishLynx / Lynx", sport: "Timing Systems", sku: "FL-EV", name: "EtherLynx Vision Camera", category: "Cameras", unit: "each", cost: 3200, price: 3995 },
];

const SPORT_KEYWORDS = {
  "Baseball/Softball": ["baseball", "baseballs", "softball", "softballs", "diamond", "bat", "bats", "glove", "gloves", "helmet", "helmets", "bbcor", "fastpitch", "game ball", "game balls", "bp ball", "bp balls"],
  Basketball: ["basketball", "basketballs", "basket"],
  Volleyball: ["volleyball", "volleyballs", "volley"],
  Football: ["football", "footballs"],
  "Track & Field": ["track", "field", "hurdle", "hurdles", "starting block", "starting blocks", "shot put", "shot puts", "discus", "javelin", "relay", "baton", "batons", "throws", "spikes"],
  "Cross Country": ["cross country", "xc"],
  Wrestling: ["wrestling", "wrestle"],
};

const STOP_WORDS = new Set(["the","and","for","with","from","this","that","into","onto","quote","quotes","build","create","estimate","price","pricing","list","lists","look","looking","find","show","need","want","some","about","what","should","would","could","please","customer","school","team","program"]);

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function singularize(token) {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ses") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function queryTokens(text = "") {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function detectSports(text = "") {
  const norm = normalizeText(text);
  return Object.entries(SPORT_KEYWORDS)
    .filter(([, terms]) => terms.some(term => norm.includes(normalizeText(term))))
    .map(([sport]) => sport);
}

function catalogIntent(text = "") {
  return /\b(price|pricing|catalog|sku|item|items|product|products|inventory|cost|map|list|lists)\b/i.test(text);
}

function catalogSport(item) {
  const joined = normalizeText(`${item.sport || ""} ${item.supplierName || ""} ${item.category || ""} ${item.name || ""} ${item.description || ""} ${item.notes || ""}`);
  for (const [sport, terms] of Object.entries(SPORT_KEYWORDS)) {
    if (terms.some(term => joined.includes(normalizeText(term)))) return sport;
  }
  return item.sport || "";
}

function flattenNames(value) {
  if (!Array.isArray(value)) return "";
  return value
    .map(item => typeof item === "string" ? item : item?.name || item?.slug || "")
    .filter(Boolean)
    .join(", ");
}

function buildCatalog(localCtx = {}, inventory = [], storeProducts = []) {
  const uploaded = (localCtx.priceLists || []).flatMap(pl => (pl.items || []).map(it => ({
    source: pl.source || pl.name || "Uploaded price list",
    listName: pl.name || "",
    listType: pl.type || "own",
    supplierName: pl.supplierName || pl.competitorName || pl.name || "",
    competitorName: pl.competitorName || "",
    name: it.name || "",
    sku: it.sku || "",
    category: it.category || "",
    unit: it.unit || "each",
    cost: Number(it.cost) || 0,
    price: Number(it.price) || 0,
    map: Number(it.map) || 0,
    notes: it.notes || pl.notes || "",
  })));

  const zoho = inventory.map(it => ({
    source: "Zoho Books active inventory",
    item_id: it.item_id,
    name: it.name || "",
    sku: it.sku || "",
    category: "",
    unit: it.unit || "each",
    cost: 0,
    price: Number(it.rate) || 0,
    description: it.description || "",
  }));

  const store = storeProducts.map(p => ({
    source: p.source || "WooCommerce/store product catalog",
    item_id: `store_${p.id}`,
    name: p.name || "",
    sku: "",
    category: flattenNames(p.categories),
    unit: "each",
    cost: 0,
    price: Number(p.price) || 0,
    description: [p.description, flattenNames(p.tags), p.brand, p.stockStatus, p.permalink].filter(Boolean).join(" | "),
  }));

  return [...uploaded, ...DEFAULT_CATALOG, ...zoho, ...store].map(item => ({
    ...item,
    sport: catalogSport(item),
  }));
}

function rankCatalogMatches(catalog, query, limit = 45) {
  const tokens = queryTokens(query);
  const requestedSports = detectSports(query);
  if (!tokens.length && !requestedSports.length) {
    return catalogIntent(query)
      ? catalog.filter(item => Number(item.price || item.rate || item.cost || 0) > 0).slice(0, limit)
      : [];
  }

  return catalog
    .map(item => {
      const haystack = normalizeText(`${item.name} ${item.sku} ${item.category} ${item.supplierName} ${item.description || ""} ${item.notes || ""} ${item.sport || ""}`);
      let score = 0;
      for (const token of tokens) {
        if (haystack.split(/\s+/).includes(token)) score += 8;
        else if (haystack.includes(token)) score += 2;
      }
      if (requestedSports.includes(item.sport)) score += 25;
      if (item.listType === "own" || item.source === "Zoho Books active inventory") score += 4;
      if (Number(item.price) > 0) score += 2;
      return { ...item, _score: score };
    })
    .filter(item => item._score > 0)
    .sort((a, b) => b._score - a._score || Number(b.price || 0) - Number(a.price || 0))
    .slice(0, limit);
}

function recordText(record, aliases = "") {
  return normalizeText(`${aliases} ${JSON.stringify(record || {})}`);
}

function rankRecords(records = [], query = "", aliases = "", limit = 8) {
  const tokens = queryTokens(query);
  if (!Array.isArray(records) || !records.length) return [];
  const sports = detectSports(query);
  const terms = tokens.length ? tokens : sports.map(normalizeText);

  return records
    .map(record => {
      const haystack = recordText(record, aliases);
      const words = new Set(haystack.split(/\s+/).map(singularize));
      let score = 0;
      for (const token of terms) {
        if (words.has(token)) score += 8;
        else if (haystack.includes(token)) score += 2;
      }
      for (const sport of sports) {
        if (haystack.includes(normalizeText(sport))) score += 8;
      }
      if (!terms.length) score = 1;
      return { record, _score: score };
    })
    .filter(x => x._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(x => x.record);
}

function mapZohoDeal(d) {
  return {
    id: d.id,
    name: d.Deal_Name || "",
    school: typeof d.Account_Name === "string" ? d.Account_Name : d.Account_Name?.name || "",
    value: Number(d.Amount) || 0,
    stage: d.Stage || "",
    closeDate: d.Closing_Date || "",
    source: "Zoho CRM Deal",
  };
}

function mapZohoPerson(r, module) {
  return {
    id: r.id,
    fullName: `${r.First_Name || ""} ${r.Last_Name || ""}`.trim(),
    firstName: r.First_Name || "",
    lastName: r.Last_Name || "",
    title: r.Title || "",
    school: typeof r.Account_Name === "string" ? r.Account_Name : r.Account_Name?.name || r.Company || "",
    city: r.City || "",
    state: r.State || "",
    email: r.Email || "",
    phone: r.Phone || "",
    status: r.Lead_Status || "",
    rating: r.Rating || "",
    source: module,
  };
}

function summarizeRecord(record, fields) {
  return fields
    .map(([label, key, fmt]) => {
      const raw = typeof key === "function" ? key(record) : record?.[key];
      if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return "";
      return `${label}: ${fmt ? fmt(raw) : raw}`;
    })
    .filter(Boolean)
    .join(" | ");
}

function money(value) {
  const n = Number(value) || 0;
  return `$${Math.round(n).toLocaleString()}`;
}

function retrieveAgentData(localCtx = {}, zoho = {}, books = {}, query = "", relevantCatalog = []) {
  const liveDeals = (zoho.deals || []).map(mapZohoDeal);
  const livePeople = [
    ...(zoho.leads || []).map(l => mapZohoPerson(l, "Zoho CRM Lead")),
    ...(zoho.contacts || []).map(c => mapZohoPerson(c, "Zoho CRM Contact")),
  ];
  const localPeople = localCtx.contacts || [];

  const retrieval = {
    priceMatches: relevantCatalog.slice(0, 12),
    deals: rankRecords([...(localCtx.deals || []), ...liveDeals], query, "deal pipeline opportunity account school quote sales", 8),
    people: rankRecords([...localPeople, ...livePeople], query, "lead contact prospect customer coach athletic director school CRM", 10),
    invoices: rankRecords([...(localCtx.invoices || []), ...(books.invoices || [])], query, "invoice invoices zoho books paid overdue balance sale sales purchase customer line item", 10),
    orders: rankRecords(localCtx.orders || [], query, "order orders store sale sales purchase fulfillment customer product item email", 10),
    reorders: rankRecords(localCtx.reorders || [], query, "reorder reorders restock renewal previous order last order customer product season", 8),
    quotes: rankRecords([...(localCtx.quotes || []), ...(books.quotes || [])], query, "quote quotes estimate estimates proposal pricing customer product", 10),
    campaigns: rankRecords([...(localCtx.campaigns || []), ...(localCtx.sequences || [])], query, "campaign campaigns sequence outreach email nurture enrollment touch", 8),
    activity: rankRecords(localCtx.activity || [], query, "activity log note action history sent email quote order call follow up", 8),
  };

  const customerTerms = ["customer", "school", "account", "history", "profile", "bought", "ordered", "invoice", "quote"];
  const shouldProfile = customerTerms.some(term => normalizeText(query).includes(term));
  if (shouldProfile) {
    const names = new Set();
    for (const rec of [...retrieval.deals, ...retrieval.people, ...retrieval.invoices, ...retrieval.orders, ...retrieval.quotes]) {
      const name = rec.school || rec.customer || rec.company || rec.org || rec.name;
      if (name && String(name).length > 2) names.add(String(name).toLowerCase());
    }
    retrieval.customerProfiles = [...names].slice(0, 5).map(name => {
      const includesName = rec => recordText(rec).includes(name);
      return {
        name,
        contacts: (localCtx.contacts || []).filter(includesName).slice(0, 4),
        deals: (localCtx.deals || []).filter(includesName).slice(0, 4),
        invoices: [...(localCtx.invoices || []), ...(books.invoices || [])].filter(includesName).slice(0, 4),
        orders: (localCtx.orders || []).filter(includesName).slice(0, 4),
        quotes: [...(localCtx.quotes || []), ...(books.quotes || [])].filter(includesName).slice(0, 4),
      };
    });
  } else {
    retrieval.customerProfiles = [];
  }

  return retrieval;
}

function formatRetrievalSection(retrieval) {
  const lines = [];
  const addSection = (title, rows, formatter) => {
    if (!rows?.length) return;
    lines.push(`\n${title}`);
    rows.forEach((row, idx) => lines.push(`${idx + 1}. ${formatter(row)}`));
  };

  addSection("PRICE/CATALOG MATCHES", retrieval.priceMatches, item => formatCatalogSuggestion(item));
  addSection("DEALS", retrieval.deals, d => summarizeRecord(d, [["Name","name"],["School","school"],["Stage","stage"],["Value","value",money],["Product","product"],["Source","source"]]));
  addSection("LEADS/CONTACTS", retrieval.people, p => summarizeRecord(p, [["Name", r => r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim()],["Title","title"],["School","school"],["State","state"],["Email","email"],["Status", r => r.zohoStatus || r.status || r.outreachStatus],["Source","source"]]));
  addSection("INVOICES / SALES HISTORY", retrieval.invoices, inv => summarizeRecord(inv, [["Number", r => r.number || r.invoice_number],["Customer", r => r.customer || r.customer_name],["Status","status"],["Date", r => r.date || r.dueDate],["Total","total",money],["Balance","balance",money],["Items", r => (r.items || []).map(i => i.name || i.item_name).filter(Boolean).join(", ")],["Source","source"]]));
  addSection("ORDERS / STORE SALES", retrieval.orders, order => summarizeRecord(order, [["Name","name"],["Customer", r => r.school || r.contact],["Stage","stage"],["Value","value",money],["Items", r => (r.items || []).map(i => i.name).filter(Boolean).join(", ")],["Source","source"],["Notes","notes"]]));
  addSection("REORDER OPPORTUNITIES", retrieval.reorders, r => summarizeRecord(r, [["School","school"],["Contact","contact"],["Sport","sport"],["Last order","lastOrderDate"],["Items", r2 => (r2.lastItems || []).join(", ")],["Value","lastOrderValue",money],["Status","status"]]));
  addSection("QUOTES / ESTIMATES", retrieval.quotes, q => summarizeRecord(q, [["Number", r => r.number || r.estimate_number],["Customer", r => r.customer || r.customer_name],["Status","status"],["Date","date"],["Total","total",money],["Source","source"]]));
  addSection("CAMPAIGNS / SEQUENCES", retrieval.campaigns, c => summarizeRecord(c, [["Name", r => r.name || r.campaign_name],["Product","product"],["Status","status"],["Active", r => r.activeCount || r.active_count],["Enrollments", r => r.enrollmentCount || (r.enrollments || []).length],["Notes","notes"]]));
  addSection("ACTIVITY LOG", retrieval.activity, a => summarizeRecord(a, [["When", r => r.ts ? new Date(r.ts).toISOString().slice(0, 10) : ""],["Message", r => r.msg || r.note || r.action],["User","userId"]]));

  if (retrieval.customerProfiles?.length) {
    lines.push("\nCUSTOMER PROFILE ROLLUPS");
    for (const profile of retrieval.customerProfiles) {
      lines.push(`- ${profile.name}: ${profile.contacts.length} contacts, ${profile.deals.length} deals, ${profile.invoices.length} invoices, ${profile.orders.length} orders, ${profile.quotes.length} quotes`);
    }
  }

  return lines.length
    ? lines.join("\n")
    : "No matching records found in local app state, live Zoho CRM, live Zoho Books, or loaded price lists for this query.";
}

function latestUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return String(messages[i].content || "");
  }
  return "";
}

function quoteIntent(text = "") {
  return /\b(quote|estimate|price\s*(this|it)?\s*out|cost\s*(this|it)?\s*out|build\s+a\s+quote|create\s+a\s+quote)\b/i.test(text);
}

function formatCatalogSuggestion(item) {
  const price = Number(item.price || item.rate || 0);
  return `${item.name}${item.sku ? ` [${item.sku}]` : ""}${item.unit ? ` (${item.unit})` : ""}${price > 0 ? ` — $${price.toFixed(2)}` : ""}`;
}

function validateQuoteAction(action, query, relevantCatalog = []) {
  if (!action || action.type !== "create_quote") return { ok: true };
  const requestedSports = detectSports(query);
  if (!requestedSports.length) return { ok: true };

  const issues = [];
  const lineItems = Array.isArray(action.line_items) ? action.line_items : [];
  for (const li of lineItems) {
    const itemText = `${li.name || ""} ${li.description || ""}`;
    const itemSports = detectSports(itemText);
    const conflicts = itemSports.filter(sport => !requestedSports.includes(sport));
    if (conflicts.length) {
      issues.push(`"${li.name || "line item"}" appears to be ${conflicts.join("/")} while the request is for ${requestedSports.join("/")}`);
    }
  }

  if (!issues.length) return { ok: true };
  const suggested = relevantCatalog
    .filter(item => requestedSports.includes(item.sport))
    .slice(0, 5)
    .map(formatCatalogSuggestion);

  return { ok: false, issues, suggested, requestedSports };
}

function applyQuoteGuardrails(actions, query, relevantCatalog) {
  if (!quoteIntent(query)) return { actions, message: null };

  const kept = [];
  const blocked = [];
  for (const action of actions) {
    const result = validateQuoteAction(action, query, relevantCatalog);
    if (result.ok) kept.push(action);
    else blocked.push(result);
  }

  if (!blocked.length) return { actions: kept, message: null };

  const suggestions = [...new Set(blocked.flatMap(b => b.suggested || []))];
  const issueText = blocked.flatMap(b => b.issues).join("; ");
  const suggestionText = suggestions.length
    ? `\n\nRelevant catalog matches I found:\n${suggestions.map(s => `- ${s}`).join("\n")}`
    : "";

  return {
    actions: kept,
    message: `I caught a product mismatch before creating the quote: ${issueText}. I will not substitute another sport's item for the requested product.${suggestionText}\n\nConfirm the customer and quantity you want quoted, or give me the exact SKU, and I will build the correct quote.`,
  };
}

// ── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────
function buildSystemPrompt(localCtx, zoho, inventory = [], relevantCatalog = [], retrieval = null, books = { invoices: [], quotes: [], ok: false }) {
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

  const zohoSection = zoho.ok && (zoho.deals.length || zoho.contacts.length || zoho.leads.length)
    ? `\n=== LIVE ZOHO CRM (${new Date().toLocaleTimeString()}) ===\nDeals: ${zoho.deals.length ? zoho.deals.map(d => `${d.Deal_Name} (${d.Account_Name}) — ${d.Stage} — $${d.Amount||"?"}`).join(" | ") : "None returned"}\nContacts: ${zoho.contacts.length ? zoho.contacts.slice(0,6).map(c => `${c.First_Name||""} ${c.Last_Name||""} / ${c.Title||""} @ ${c.Account_Name||""}`).join(" | ") : "None returned"}\nLeads: ${zoho.leads.length ? zoho.leads.slice(0,12).map(l => `${l.First_Name||""} ${l.Last_Name||""} / ${l.Title||""} @ ${l.Company||""}${l.State?`, ${l.State}`:""} — ${l.Lead_Status||"status unknown"}${l.Rating?` — ${l.Rating}`:""}`).join(" | ") : "None returned"}\n`
    : "\n(Zoho CRM not connected — using local data)\n";

  const booksSection = books.ok && (books.invoices.length || books.quotes.length)
    ? `\n=== LIVE ZOHO BOOKS ===\nRecent invoices: ${books.invoices.length ? books.invoices.slice(0,10).map(i => `${i.number || i.id} — ${i.customer} — ${i.status} — $${i.total || 0}${i.balance ? ` (${i.balance} balance)` : ""}`).join(" | ") : "None returned"}\nRecent quotes/estimates: ${books.quotes.length ? books.quotes.slice(0,10).map(q => `${q.number || q.id} — ${q.customer} — ${q.status} — $${q.total || 0}`).join(" | ") : "None returned"}\n`
    : "\n(Zoho Books invoices/quotes not connected or no recent records returned)\n";

  const relevantCatalogSection = relevantCatalog.length
    ? `\n=== QUERY-RELEVANT PRICE/CATALOG MATCHES ===\n${relevantCatalog.map((i, idx) => {
        const price = Number(i.price || i.rate || 0);
        const cost = Number(i.cost || 0);
        const parts = [
          `${idx + 1}. ${i.name}${i.sku ? ` [${i.sku}]` : ""}`,
          i.item_id ? `Zoho item_id: ${i.item_id}` : "",
          i.sport ? `sport: ${i.sport}` : "",
          i.category ? `category: ${i.category}` : "",
          i.supplierName ? `supplier: ${i.supplierName}` : "",
          i.source ? `source: ${i.source}` : "",
          i.unit ? `unit: ${i.unit}` : "",
          cost > 0 ? `cost: $${cost.toFixed(2)}` : "",
          price > 0 ? `sell/rate: $${price.toFixed(2)}` : "",
          i.map > 0 ? `MAP: $${Number(i.map).toFixed(2)}` : "",
          i.notes ? `notes: ${i.notes}` : "",
        ].filter(Boolean);
        return parts.join(" — ");
      }).join("\n")}\nUse these query-relevant rows first. If none match the requested sport/product exactly, ask a clarifying question instead of substituting a nearby sport.\n`
    : "\n=== QUERY-RELEVANT PRICE/CATALOG MATCHES ===\nNo exact price-list or catalog match was found for this query. If the user is asking for a quote or price, say that explicitly and ask what exact product/SKU to use rather than guessing.\n";

  return `You are the ST1 Sports RevOps AI Agent — a senior sales & outreach strategist with full visibility into the pipeline, contacts, and business context.
${ST1}
Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}

${zohoSection}
${booksSection}
${relevantCatalogSection}
=== AGENT DATA RETRIEVAL RESULTS ===
${retrieval ? formatRetrievalSection(retrieval) : "No retrieval results generated for this turn."}

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

DATA ACCESS RULES:
- AGENT DATA RETRIEVAL RESULTS is the freshest query-specific lookup across local app state, uploaded price lists, live Zoho CRM, live Zoho Books, orders/store sales, reorders, campaigns, and activity logs.
- For questions about leads, contacts, customers, sales, invoices, orders, quotes, reorders, campaigns, or prices, use AGENT DATA RETRIEVAL RESULTS before the general summary sections.
- State the source of important facts in plain language: "from Zoho Books invoices", "from local orders", "from uploaded price list", or "from Zoho CRM Leads".
- If retrieval says no matching records were found, say that clearly and ask whether to broaden the search or sync/import data. Never invent customers, invoices, orders, or prices.

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

USE propose_create_quote when:
- User asks to "build a quote", "create an estimate", or "price this out" with specific products and a customer
- Match the requested product and sport exactly from QUERY-RELEVANT PRICE/CATALOG MATCHES first. Baseball/baseballs means Baseball/Softball catalog items, never basketballs or generic balls.
- If the query lacks customer, quantity, or an exact enough item, ask for the missing detail instead of proposing a quote action.
- If using a Zoho Books item, include its exact item_id in the line item when available.
- Include source and confidence in notes, e.g. "Based on Diamond Baseballs price list" or "Estimated — confirm with Matt before sending."

LEAD / CONTACT LOOKUPS:
- When the user asks to find, look for, prioritize, or work leads, use LIVE ZOHO CRM Leads plus TOP CONTACTS first.
- Distinguish Leads from Contacts in your answer. Mention status/rating/source when available.
- If there are not enough matches in the provided CRM context, say that and suggest using CRM search/import rather than inventing names.

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
3. propose_draft_email — compose a personalized email (user reviews + sends)
4. propose_schedule_followup — set a follow-up date on a deal
5. propose_flag_deal — mark a deal as hot/warm priority
6. propose_add_to_nurture — add cold leads to email nurture campaign
7. propose_log_note — log notes on a deal
8. propose_create_quote — build and create a Zoho Books estimate/quote for a customer
9. propose_store_competitor_intel — save competitor research to the Competitors tab (auto-executes, no user confirm needed)
10. propose_create_campaign_sequence — write a multi-email sequence, match contacts by sport/state/title/score, and set up the campaign ready to schedule and launch

IMPORTANT BEHAVIORS:
- Always personalize emails with real names, real school names, real products
- Be specific and tactical — use actual deal names, contact names, dollar amounts from context
- Flag 🔥 when you see genuine urgency or high value
- Do not infer a product from a similar word fragment. "Baseball" and "basketball" are different products. "Game ball" must still match the user's sport.
- If context is thin or missing, ask one focused clarifying question and state what information is missing.

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

Each tool proposal maps to an action in the actions array with the same fields from the tool input plus type: "create_deal"|"add_contact"|"draft_email"|"schedule_followup"|"flag_deal"|"add_to_nurture"|"log_note"|"create_quote"|"create_campaign_sequence"`;
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

  const { messages: rawMessages, localContext: rawLocalContext = {} } = req.body || {};
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    return res.status(400).json({ error: "messages array required" });
  }

  const userQuery = latestUserText(rawMessages);

  // Fetch fresh Zoho context + persisted app/store records in parallel
  const [zoho, inventory, books, persistedState, storeProducts] = await Promise.all([
    fetchZohoContext(),
    fetchZohoInventory(),
    fetchZohoBooksContext(),
    fetchPersistedState(),
    fetchStoreProducts(),
  ]);
  const localContext = mergeAgentContext(rawLocalContext, persistedState);
  const catalog = buildCatalog(localContext, inventory, storeProducts);
  const relevantCatalog = rankCatalogMatches(catalog, userQuery);
  const retrieval = retrieveAgentData(localContext, zoho, books, userQuery, relevantCatalog);

  const system = buildSystemPrompt(localContext, zoho, inventory, relevantCatalog, retrieval, books);

  // Convert history to Anthropic format
  const messages = rawMessages.map(m => ({
    role:    m.role === "user" ? "user" : "assistant",
    content: m.role === "user" ? m.content : (m.raw || m.content || ""),
  }));

  // Tool call loop — max 2 iterations (no web search, just proposal tools)
  const MAX_LOOPS = 2;
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
      allToolCalls.push(t);
    }

    // Done when no tool calls or stop reason is end_turn
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") break;

    // Add assistant turn, add synthetic tool results, loop
    messages.push({ role: "assistant", content: response.content });
    const toolResults = toolUseBlocks.map(t => ({
      type:        "tool_result",
      tool_use_id: t.id,
      content:     JSON.stringify({ proposed: true, ...t.input }),
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
    .map(t => {
      const typeMap = {
        propose_create_deal:     "create_deal",
        propose_add_contact:     "add_contact",
        propose_draft_email:     "draft_email",
        propose_schedule_followup: "schedule_followup",
        propose_flag_deal:       "flag_deal",
        propose_add_to_nurture:  "add_to_nurture",
        propose_log_note:        "log_note",
        propose_create_quote:             "create_quote",
        propose_store_competitor_intel:   "store_competitor_intel",
        propose_create_campaign_sequence: "create_campaign_sequence",
      };
      return { type: typeMap[t.name] || t.name, ...t.input };
    });

  const actionsBeforeGuardrails = [...proposedActions, ...(parsed?.actions || [])];
  const guarded = applyQuoteGuardrails(actionsBeforeGuardrails, userQuery, relevantCatalog);
  const actions = guarded.actions;
  const suggestions = parsed?.suggestions || [];
  const message     = guarded.message || parsed?.message || finalText;

  return res.json({ message, actions, suggestions, liveZoho: zoho.ok, searchUsed });
}
