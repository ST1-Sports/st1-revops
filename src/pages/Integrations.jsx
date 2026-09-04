import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import ToolManager from "../components/ToolManager.jsx";
import { integrationsPath } from "../lib/pages.js";

const INTG_TABS = new Set(["overview","knowledge","slack","zoho","marketing","ads","email","shopify","tools","log"]);
import { pushItemsToAppState, pushAppStateToServer, readAppState } from "../lib/appStateSync.js";
import AiKnowledgeHub from "./AiKnowledgeHub.jsx";

// ─── BRAND ────────────────────────────────────────────────────────────────────
const B = {
  pageBg:"#F2F2F0", white:"#FFFFFF", surface:"#F8F7F5",
  orange:"#F37321", orangeBg:"#FEF3EC",
  black:"#0A0A0A", border:"#E2E0DB", borderD:"#C8C4BC",
  text:"#1A1A18", textMid:"#424242", muted:"#7A7872",
  green:"#1E8F4E", greenBg:"#EAF7EE",
  yellow:"#C77800", yellowBg:"#FFF8E6",
  red:"#C0392B", redBg:"#FDECEA",
  blue:"#1A5FA8", blueBg:"#E8F0FA",
  purple:"#6B3FA0", purpleBg:"#F3EEFB",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt$  = n  => "$"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD  = d  => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const uid   = () => Math.random().toString(36).slice(2,9);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ─── ZOHO PROXY (server-side via /api/zoho) ───────────────────────────────────
// All Zoho calls go through the Vercel function — never direct from browser.
// Credentials live in Vercel env vars, not localStorage.
async function zohoAPI(service, endpoint, method="GET", body=null) {
  const r = await fetch("/api/zoho", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, endpoint, method, body }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Zoho ${service} ${r.status}`);
  return data;
}

// ─── SHOPIFY API (server-side proxy via /api/shopify — credentials never touch the browser) ──
async function shopifyAPI(endpoint, method="GET", body=null) {
  const r = await fetch("/api/shopify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, method, body }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Shopify ${r.status}`);
  return data;
}

// ─── CLAUDE AI ────────────────────────────────────────────────────────────────
async function aiText(prompt) {
  const r = await fetch("/api/claude",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,messages:[{role:"user",content:prompt}]})
  });
  const d = await r.json();
  return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
const STORE_KEY = "st1_integrations_v1";
const STATUS_KEY = "st1_integrations_status_v1";
function loadCreds() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)||"{}"); } catch { return {}; }
}
function saveCreds(creds) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(creds)); } catch {}
}
function loadStatus() {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY)||"{}"); } catch { return {}; }
}
function saveStatus(status) {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(status)); } catch {}
}

// ─── SEED DATA for demo when not connected ────────────────────────────────────
const DEMO_INVOICES = [
  {id:"INV-00892",number:"INV-00892",customer_name:"Ankeny CSD",status:"overdue",total:4200,balance:4200,due_date:"2026-04-09",email:"sjohnson@ankenyschools.org",crm_synced:false},
  {id:"INV-00891",number:"INV-00891",customer_name:"Iowa City CSD",status:"sent",total:2100,balance:2100,due_date:"2026-04-22",email:"rkim@iccsd.k12.ia.us",crm_synced:true},
  {id:"INV-00890",number:"INV-00890",customer_name:"Denver Public Schools",status:"viewed",total:11800,balance:11800,due_date:"2026-04-19",email:"lpark@dpsk12.org",crm_synced:true},
  {id:"INV-00889",number:"INV-00889",customer_name:"Fargo South HS",status:"overdue",total:6700,balance:6700,due_date:"2026-03-29",email:"tbergstrom@fargo.k12.nd.us",crm_synced:false},
  {id:"INV-00888",number:"INV-00888",customer_name:"Moorhead HS",status:"paid",total:1900,balance:0,due_date:"2026-03-31",email:"molson@moorheadschools.org",crm_synced:true},
];

const DEMO_PRODUCTS = [
  {id:101,name:"Blazer Aluminum Hurdle 39\"",sku:"BL-39AL",price:"280.00",stock_quantity:12,stock_status:"instock",categories:[{name:"Track & Field"}]},
  {id:102,name:"Gill Shot Put 12lb HS",sku:"GA-SP12",price:"154.00",stock_quantity:8,stock_status:"instock",categories:[{name:"Track & Field"}]},
  {id:103,name:"Diamond DOL-1 Game Balls (dz)",sku:"DIA-DOL1",price:"72.00",stock_quantity:0,stock_status:"outofstock",categories:[{name:"Baseball"}]},
  {id:104,name:"Molten V5M5000 Volleyball",sku:"MOL-V5M5",price:"68.00",stock_quantity:24,stock_status:"instock",categories:[{name:"Volleyball"}]},
  {id:105,name:"DeMarini Voodoo One BBCOR",sku:"DEM-VOO1",price:"299.00",stock_quantity:6,stock_status:"instock",categories:[{name:"Baseball"}]},
];

// ════════════════════════════════════════════════════════════════════════════
export default function IntegrationsHub({ initialTab = "overview" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTabState] = useState(() => {
    const fromPath = window.location.pathname.startsWith("/ai-knowledge") ? "knowledge" : initialTab;
    const t = new URLSearchParams(window.location.search).get("tab") || fromPath;
    return INTG_TABS.has(t) ? t : fromPath;
  });
  const setTab = (id) => {
    setTabState(id);
    if (location.pathname === "/integrations" || location.pathname === "/ai-knowledge") {
      const dest = location.pathname === "/ai-knowledge"
        ? (id && id !== "knowledge" ? `/ai-knowledge?tab=${encodeURIComponent(id)}` : "/ai-knowledge")
        : integrationsPath(id);
      const current = `${location.pathname}${location.search}`;
      if (current !== dest) navigate(dest);
    }
  };
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("tab");
    if (INTG_TABS.has(t) && t !== tab) setTabState(t);
  }, [location.search, location.pathname]);
  const [creds, setCreds] = useState(loadCreds);
  const [status, setStatus] = useState(() => {
    const saved = loadStatus();
    return {
      slack: true,
      books: false,
      crm:   false,
      shopify: false,
      ...saved,
    };
  });
  const [testing,  setTesting]  = useState(null);
  const [log, setLog]     = useState([]);
  const [invoices,setInvoices]  = useState(DEMO_INVOICES);
  const [products,setProducts]  = useState(DEMO_PRODUCTS);
  const [shopifyOrders,setShopifyOrders]= useState([]);
  const [syncing, setSyncing]   = useState(false);
  const [slackChannel, setSlackChannel] = useState("C0AQ7CMB01X"); // #sales
  const [slackChannelName, setSlackChannelName] = useState("#sales");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [slackWebhookSaved, setSlackWebhookSaved] = useState(false);
  const [slackDiag, setSlackDiag] = useState(null);
  const [drafts, setDrafts]     = useState({});
  const [drafting, setDrafting] = useState(null);
  const [crmSyncResult, setCrmSyncResult] = useState(null); // { contacts, deals }
  const [crmPulling, setCrmPulling] = useState(null); // "contacts"|"deals"|null

  // Full CRM backup export (all fields, all records) — a safety net before
  // using Zoho's own mass-delete tools to wipe the CRM clean.
  const [exportingModule, setExportingModule] = useState(null); // module name currently exporting, or null
  const [exportProgress, setExportProgress] = useState({}); // {ModuleName: {page, records}}
  const [exportResults, setExportResults] = useState({}); // {ModuleName: [records]}

  // Full Zoho Books backup export — same purpose as the CRM one above, but
  // Books is not being wiped; this is purely a "just in case" safety net.
  const [booksExportingModule, setBooksExportingModule] = useState(null);
  const [booksExportProgress, setBooksExportProgress] = useState({}); // {key: {page, records}}
  const [booksExportResults, setBooksExportResults] = useState({}); // {key: [records]}

  // "Who's been invoiced" report — read-only rollup used to decide who gets
  // re-created as an Account in the freshly-wiped Zoho CRM. Never writes
  // anything to Zoho; it's purely a review list.
  const [invoicedReportLoading, setInvoicedReportLoading] = useState(false);
  const [invoicedReportStatus, setInvoicedReportStatus] = useState("");
  const [invoicedReport, setInvoicedReport] = useState(null);

  // Zoho Campaigns
  const [mailingLists, setMailingLists] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [coldLeadListKey, setColdLeadListKey] = useState(() => { try { return localStorage.getItem("st1_cold_lead_listkey")||""; } catch { return ""; } });
  const [coldLeadSyncing, setColdLeadSyncing] = useState(false);
  const [coldLeadSyncResult, setColdLeadSyncResult] = useState(null);
  const [zohoEmailCampaigns, setZohoEmailCampaigns] = useState([]);
  const [campaignCreating, setCampaignCreating] = useState(false);
  const [newListName, setNewListName] = useState("Cold Leads — Promo Offers");

  // Ad platforms + Instantly
  const [adsStatus, setAdsStatus]   = useState(() => { try { const s=JSON.parse(localStorage.getItem("st1_ads_status_v1")||"{}"); return (Date.now()-(s.ts||0))<3600000?s:{}; } catch { return {}; } });
  const [adsLoading, setAdsLoading] = useState(false);
  const [instStatus, setInstStatus] = useState(null);
  const [instCampaigns, setInstCampaigns] = useState([]);
  const [lsEmbedUrl, setLsEmbedUrl]   = useState(() => { try { return localStorage.getItem("st1_ls_embed")||""; } catch { return ""; } });
  const [adLinks, setAdLinks]         = useState(() => { try { return JSON.parse(localStorage.getItem("st1_ad_links")||"{}"); } catch { return {}; } });
  const [adMetrics, setAdMetrics]     = useState(() => { try { return JSON.parse(localStorage.getItem("st1_ad_metrics")||"{}"); } catch { return {}; } });

  const [gmailStatus, setGmailStatus] = useState(() => !!(loadStatus().gmail));
  const [emailMessages, setEmailMessages] = useState([]);
  const [emailOpps, setEmailOpps]   = useState([]);
  const [emailScanning, setEmailScanning] = useState(false);
  const [emailQuery, setEmailQuery] = useState("newer_than:14d category:primary -from:me");

  const addLog = useCallback((msg,type="info") => setLog(l=>[{id:uid(),msg,type,ts:Date.now()},...l.slice(0,99)]), []);

  // ── REVOPS STORE BRIDGE ─────────────────────────────────────────────────────
  // Write contacts or deals into the shared RevOps localStorage store, then
  // push to /api/state ourselves — Integrations is a standalone route, so
  // without this, pulled CRM data only reached the database if the same
  // browser later happened to load the main RevOps dashboard.
  function pushToRevOps(key, items) {
    const added = pushItemsToAppState(key, items);
    if (added) pushAppStateToServer();
    return added;
  }

  // Save creds to localStorage whenever they change
  useEffect(()=>saveCreds(creds),[creds]);
  useEffect(()=>saveStatus(status),[status]);

  // Auto-verify Gmail silently on mount
  useEffect(()=>{
    if(gmailStatus) return; // already connected
    fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list",maxResults:1})})
      .then(r=>r.json()).then(d=>{
        if(!d.error){ setGmailStatus(true); saveStatus({...loadStatus(),gmail:true}); setStatus(s=>({...s,gmail:true})); }
      }).catch(()=>{});
  // eslint-disable-next-line
  },[]);

  const setC = (k,v) => setCreds(c=>({...c,[k]:v}));

  // ── TEST CONNECTIONS ────────────────────────────────────────────────────────
  const testBooks = async () => {
    setTesting("books"); addLog("Testing Zoho Books connection...");
    try {
      const d = await zohoAPI("books", "/invoices?per_page=25&sort_column=created_time&sort_order=D");
      if(d.invoices) {
        setInvoices(d.invoices.map(inv=>({...inv,crm_synced:false})));
        setStatus(s=>({...s,books:true}));
        addLog(`✓ Zoho Books connected — ${d.invoices.length} invoices loaded`,"success");
      } else {
        throw new Error(d.message || "No invoices in response");
      }
    } catch(e) {
      if(e.message?.includes("not configured") || e.message?.includes("env var")) {
        addLog(`Books: ${e.message}`,"error");
        addLog("Add ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID to Vercel env vars, then run /api/zoho-setup","warn");
      } else {
        addLog(`Books: ${e.message.slice(0,120)}`,"error");
      }
    }
    setTesting(null);
  };

  const testCRM = async () => {
    setTesting("crm"); addLog("Testing Zoho CRM connection...");
    try {
      await zohoAPI("crm", "/users?type=CurrentUser");
      setStatus(s=>({...s,crm:true}));
      addLog("✓ Zoho CRM connected","success");
    } catch(e) {
      if(e.message?.includes("not configured") || e.message?.includes("env var")) {
        addLog(`CRM: ${e.message}`,"error");
      } else {
        addLog(`CRM: ${e.message.slice(0,120)}`,"error");
      }
    }
    setTesting(null);
  };

  // ── ZOHO CAMPAIGNS HELPERS ──────────────────────────────────────────────────
  const campaignsAPI = async (action, params={}) => {
    const r = await fetch("/api/zoho-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Campaigns API ${r.status}`);
    return data;
  };

  const testCampaigns = async () => {
    setTesting("campaigns"); addLog("Testing Zoho Campaigns connection...");
    try {
      const data = await campaignsAPI("list_lists");
      setMailingLists(data.lists || []);
      setStatus(s=>({...s, campaigns: true}));
      addLog(`✓ Zoho Campaigns connected — ${data.total} mailing lists`, "success");
    } catch(e) {
      addLog(`Campaigns: ${e.message.slice(0,140)}`, "error");
      setStatus(s=>({...s, campaigns: false}));
    }
    setTesting(null);
  };

  const loadMailingLists = async () => {
    setCampaignsLoading(true);
    try {
      const data = await campaignsAPI("list_lists");
      setMailingLists(data.lists || []);
    } catch(e) { addLog(`Lists: ${e.message.slice(0,100)}`, "error"); }
    setCampaignsLoading(false);
  };

  const loadEmailCampaigns = async () => {
    try {
      const data = await campaignsAPI("list_campaigns", { range: 20 });
      setZohoEmailCampaigns(data.campaigns || []);
    } catch(e) { addLog(`Email campaigns: ${e.message.slice(0,100)}`, "error"); }
  };

  const createColdLeadList = async () => {
    if (!newListName.trim()) return;
    setCampaignCreating(true);
    try {
      const data = await campaignsAPI("create_list", { listname: newListName.trim(), description: "Cold leads receiving ST1 Sports promotional offers and nurture emails" });
      if (data.ok) {
        addLog(`✓ Created list "${newListName}"`, "success");
        await loadMailingLists();
        if (data.listkey) {
          setColdLeadListKey(data.listkey);
          try { localStorage.setItem("st1_cold_lead_listkey", data.listkey); } catch {}
        }
      }
    } catch(e) { addLog(`Create list: ${e.message.slice(0,100)}`, "error"); }
    setCampaignCreating(false);
  };

  const syncColdLeadsNow = async () => {
    if (!coldLeadListKey) { addLog("Select or create a Cold Leads list first", "warn"); return; }
    setColdLeadSyncing(true);
    setColdLeadSyncResult(null);
    try {
      // Read contacts from RevOps localStorage, filter cold ones
      const store = readAppState();
      const contacts = Array.isArray(store.contacts) ? store.contacts : [];
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const coldContacts = contacts.filter(c => {
        if (!c.email) return false;
        const isColdScore = (c.score || 0) < 25;
        const lastActivity = c.activity?.length
          ? Math.max(...c.activity.map(a => new Date(a.ts || a.date || 0).getTime()))
          : 0;
        const isInactive = !lastActivity || (now - lastActivity) > THIRTY_DAYS;
        return isColdScore && isInactive;
      });

      if (!coldContacts.length) {
        setColdLeadSyncResult({ added: 0, total: 0, msg: "No cold leads found to sync" });
        addLog("No cold leads to sync (all contacts have score ≥ 25 or recent activity)", "info");
        setColdLeadSyncing(false);
        return;
      }

      const data = await campaignsAPI("add_subscribers", {
        listkey: coldLeadListKey,
        contacts: coldContacts.map(c => ({
          email:     c.email,
          firstName: c.firstName || c.first_name || "",
          lastName:  c.lastName  || c.last_name  || "",
          company:   c.orgName   || c.school     || c.company || "",
          phone:     c.phone     || "",
        })),
      });

      const result = { added: data.added || coldContacts.length, total: coldContacts.length, msg: `${data.added} of ${coldContacts.length} synced` };
      setColdLeadSyncResult(result);
      addLog(`✓ ${result.msg} cold leads → Zoho Campaigns`, "success");
    } catch(e) {
      addLog(`Cold lead sync: ${e.message.slice(0,140)}`, "error");
      setColdLeadSyncResult({ error: e.message });
    }
    setColdLeadSyncing(false);
  };

  const testShopify = async () => {
    setTesting("shopify"); addLog("Testing Shopify connection...");
    try {
      const shop = await shopifyAPI("/shop.json");
      const prodData = await shopifyAPI("/products.json?limit=10");
      const prods = prodData.products || [];
      setProducts(prods.map(p => ({
        id: p.id, variantId: p.variants?.[0]?.id, sku: p.variants?.[0]?.sku || "", name: p.title,
        categories: p.product_type ? [{name: p.product_type}] : [],
        price: p.variants?.[0]?.price || "0.00",
        stock_quantity: p.variants?.reduce((s,v)=>s+(v.inventory_quantity||0),0),
        stock_status: p.variants?.some(v=>(v.inventory_quantity||0)>0) ? "instock" : "outofstock",
      })));
      const orderData = await shopifyAPI("/orders.json?limit=10&status=any");
      setShopifyOrders(orderData.orders || []);
      setStatus(s=>({...s,shopify:true}));
      addLog(`✓ Shopify connected — ${shop.shop?.name || "store"} — ${prods.length} products, ${orderData.orders?.length||0} recent orders`,"success");
    } catch(e) {
      addLog(`Shopify: ${e.message.slice(0,80)}`,"error");
      setStatus(s=>({...s,shopify:false}));
    }
    setTesting(null);
  };

  // status.shopify persists across reloads (via localStorage), but `products`
  // always starts back at DEMO_PRODUCTS on every mount — without this, the
  // panel would show "PRODUCTS — LIVE FROM SHOPIFY" over demo rows (fake
  // SKUs, no variantId) until the user manually clicked Reconnect/Refresh.
  useEffect(() => {
    if (!status.shopify) return;
    (async () => {
      try {
        const prodData = await shopifyAPI("/products.json?limit=10");
        const prods = prodData.products || [];
        setProducts(prods.map(p => ({
          id: p.id, variantId: p.variants?.[0]?.id, sku: p.variants?.[0]?.sku || "", name: p.title,
          categories: p.product_type ? [{name: p.product_type}] : [],
          price: p.variants?.[0]?.price || "0.00",
          stock_quantity: p.variants?.reduce((s,v)=>s+(v.inventory_quantity||0),0),
          stock_status: p.variants?.some(v=>(v.inventory_quantity||0)>0) ? "instock" : "outofstock",
        })));
        const orderData = await shopifyAPI("/orders.json?limit=10&status=any");
        setShopifyOrders(orderData.orders || []);
      } catch {
        // Connection may have lapsed (revoked token, etc.) since last visit —
        // reflect that honestly rather than leaving a stale "LIVE" label up.
        setStatus(s=>({...s,shopify:false}));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SLACK: SEND REAL MESSAGE via bot token ──────────────────────────────────
  const sendSlackAlert = async (msg, isTest=false) => {
    addLog(`Sending to ${slackChannelName}...`);
    try {
      const r = await fetch("/api/slack-message", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ channel: slackChannel, text: msg })
      });
      const d = await r.json();
      if (d.ok) {
        addLog(`✓ Message delivered to ${slackChannelName}${d.via === "webhook" ? " via incoming webhook" : ""}`, "success");
        return true;
      }
      addLog(`Slack error: ${d.error || "unknown"}`, "error");
      if (String(d.error || "").includes("missing_scope") || d.raw?.needed) {
        addLog("The Slack app only has incoming-webhook, not chat:write. Add chat:write under OAuth & Permissions and reinstall, or paste the Incoming Webhook URL below.", "warn");
      }
      return false;
    } catch(e) {
      addLog(`Slack error: ${e.message.slice(0,60)}`, "error");
      return false;
    }
  };

  // ── TAG CRM CONTACT AS CUSTOMER ─────────────────────────────────────────────
  const tagCRMCustomer = async (inv) => {
    if(!status.crm) { addLog("Connect Zoho CRM first","warn"); return; }
    addLog(`Updating CRM: ${inv.customer_name} → Customer...`);
    try {
      const search = await zohoAPI("crm",
        `/Contacts/search?criteria=(Email:equals:${encodeURIComponent(inv.email||"")})`)
      const contactId = search.data?.[0]?.id;
      if(contactId) {
        await zohoAPI("crm", `/Contacts/${contactId}`, "PUT", {data:[{
          id:contactId, Lead_Status:"Customer",
          Customer_Since:new Date().toISOString().slice(0,10),
          Last_Invoice_Number:inv.number, Last_Invoice_Amount:inv.total,
          Account_Type:"Customer"
        }]});
        addLog(`✓ ${inv.customer_name} → Customer in Zoho CRM`,"success");
      } else {
        addLog(`CRM: no contact found for ${inv.customer_name}`,"warn");
      }
    } catch(e) {
      addLog(`CRM update (demo): ${e.message.slice(0,50)}`,"warn");
    }
    setInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,crm_synced:true}:i));
  };

  // ── BULK CRM SYNC ───────────────────────────────────────────────────────────
  const bulkCRMSync = async () => {
    const toSync = invoices.filter(i=>["sent","viewed","partial","paid"].includes(i.status)&&!i.crm_synced);
    if(!toSync.length) { addLog("All invoiced customers already synced","info"); return; }
    setSyncing(true);
    addLog(`Syncing ${toSync.length} customers to CRM...`);
    for(const inv of toSync) { await tagCRMCustomer(inv); await sleep(400); }
    addLog(`✓ CRM sync complete — ${toSync.length} contacts updated`,"success");
    setSyncing(false);
  };

  // ── PULL ZOHO CRM CONTACTS → REVOPS ────────────────────────────────────────
  const pullCRMContacts = async () => {
    if(!status.crm) { addLog("Connect Zoho CRM first","warn"); return; }
    setCrmPulling("contacts");
    addLog("Pulling contacts and leads from Zoho CRM...");
    try {
      const [contactsRes, leadsRes] = await Promise.all([
        zohoAPI("crm", "/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,Mailing_City,Mailing_State,Lead_Source&per_page=200"),
        zohoAPI("crm", "/Leads?fields=First_Name,Last_Name,Email,Phone,Title,Company,City,State,Lead_Source,Lead_Status&per_page=200"),
      ]);
      const today = new Date().toISOString().slice(0,10);
      const contacts = (contactsRes.data||[]).map(c=>({
        id: "zoho_c_"+c.id,
        firstName: c.First_Name||"", lastName: c.Last_Name||"",
        fullName: `${c.First_Name||""} ${c.Last_Name||""}`.trim(),
        email: c.Email||"", phone: c.Phone||"",
        title: c.Title||"", school: c.Account_Name||"",
        city: c.Mailing_City||"", state: c.Mailing_State||"",
        orgType:"school", source:"zoho-crm",
        confidence:"high", outreachStatus:"new", importedAt:Date.now(),
      }));
      const leads = (leadsRes.data||[]).map(l=>({
        id: "zoho_l_"+l.id,
        firstName: l.First_Name||"", lastName: l.Last_Name||"",
        fullName: `${l.First_Name||""} ${l.Last_Name||""}`.trim(),
        email: l.Email||"", phone: l.Phone||"",
        title: l.Title||"", school: l.Company||"",
        city: l.City||"", state: l.State||"",
        orgType:"school", source:"zoho-crm-lead",
        confidence:"medium", outreachStatus: l.Lead_Status==="Customer"?"replied":"new",
        importedAt: Date.now(),
      }));
      const all = [...contacts, ...leads];
      const added = pushToRevOps("contacts", all);
      setCrmSyncResult(prev=>({...(prev||{}), contacts:all.length, contactsAdded:added}));
      addLog(`✓ Pulled ${contacts.length} contacts + ${leads.length} leads — ${added} new added to RevOps`,"success");

      // pushToRevOps above already syncs this to /api/state (shared across
      // devices), but SalesContact is still the durable record prospecting
      // features (scoring, enrichment, account-matching) actually query —
      // persist there too via the same import pipeline the cold-prospect-
      // pool CSV upload uses.
      try {
        const importRes = await fetch("/api/contacts/import", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ contacts: all.map(c => ({
            email: c.email, firstName: c.firstName, lastName: c.lastName,
            title: c.title, school: c.school, phone: c.phone,
            city: c.city, state: c.state, source: c.source,
          })) }),
        });
        const importData = await importRes.json();
        if (importRes.ok) {
          addLog(`✓ ${importData.added} contact(s) saved to database (${importData.updated} already existed)`,"success");
        } else {
          addLog(`Contacts DB import: ${importData.error||"failed"}`,"warn");
        }
      } catch(e) {
        addLog(`Contacts DB import failed: ${e.message?.slice(0,100)}`,"warn");
      }
    } catch(e) {
      addLog(`CRM pull failed: ${e.message.slice(0,100)}`,"error");
    }
    setCrmPulling(null);
  };

  // ── PULL ZOHO CRM DEALS → REVOPS ──────────────────────────────────────────
  const pullCRMDeals = async () => {
    if(!status.crm) { addLog("Connect Zoho CRM first","warn"); return; }
    setCrmPulling("deals");
    addLog("Pulling deals from Zoho CRM...");
    try {
      const res = await zohoAPI("crm", "/Deals?fields=Deal_Name,Account_Name,Amount,Stage,Closing_Date,Contact_Name,Description&per_page=100");
      const today = new Date().toISOString().slice(0,10);
      const deals = (res.data||[]).map(d=>({
        id: "zoho_d_"+d.id,
        zohoId: d.id,
        name: d.Deal_Name||d.Account_Name||"Untitled Deal",
        school: d.Account_Name||"",
        contact: d.Contact_Name?.name||"",
        value: parseFloat(d.Amount)||0,
        stage: mapZohoStage(d.Stage),
        followUpDate: d.Closing_Date||"",
        product: d.Description?.slice(0,60)||"",
        priority: "warm",
        createdAt: today,
        source:"zoho-crm",
      }));
      const added = pushToRevOps("deals", deals);
      setCrmSyncResult(prev=>({...(prev||{}), deals:deals.length, dealsAdded:added}));
      addLog(`✓ Pulled ${deals.length} deals — ${added} new added to RevOps`,"success");
    } catch(e) {
      addLog(`CRM deals pull failed: ${e.message.slice(0,100)}`,"error");
    }
    setCrmPulling(null);
  };

  function mapZohoStage(s) {
    const m = {"Qualification":"Quoted","Value Proposition":"Quoted","Needs Analysis":"Follow-Up 1","Proposal/Price Quote":"Follow-Up 2","Id. Decision Makers":"Negotiating","Perception Analysis":"Negotiating","Negotiation/Review":"Negotiating","Closed Won":"Closed Won","Closed Lost":"Closed Lost"};
    return m[s]||"Quoted";
  }

  // ── FULL CRM BACKUP EXPORT ─────────────────────────────────────────────────
  // Zoho's v3 API requires an explicit `fields` list for every module read —
  // there's no "all fields" wildcard — so this reads the module's real field
  // list from Zoho's own metadata first, then paginates through every record
  // requesting all of them. Orgs with >40 custom fields on one module get
  // batched into multiple field requests per page and merged by record id,
  // since a single overlong `fields` query string can get rejected.
  const EXPORT_MODULES = ["Leads", "Contacts", "Deals", "Accounts"];
  const FIELD_CHUNK_SIZE = 40;
  const chunk = (arr, size) => { const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; };

  // Reading /settings/fields needs its own OAuth scope (ZohoCRM.settings.fields.READ)
  // that older refresh tokens issued before this export tool existed won't have —
  // api/zoho-setup.js now requests it, but that only takes effect after a fresh
  // re-authorization. Until then, fall back to Zoho's documented standard field
  // set per module so the export still works today; custom fields just won't be
  // captured until the token is re-authorized.
  const CRM_FALLBACK_FIELDS = {
    Leads: ["Salutation","First_Name","Last_Name","Full_Name","Email","Phone","Mobile","Fax","Title","Company","Lead_Source","Lead_Status","Industry","Annual_Revenue","No_of_Employees","Rating","Secondary_Email","Twitter","Skype_ID","Street","City","State","Zip_Code","Country","Description","Website","Designation","Owner","Created_Time","Modified_Time","Converted"],
    Contacts: ["Salutation","First_Name","Last_Name","Full_Name","Email","Phone","Mobile","Fax","Title","Department","Account_Name","Lead_Source","Mailing_Street","Mailing_City","Mailing_State","Mailing_Zip","Mailing_Country","Other_Street","Other_City","Other_State","Other_Zip","Other_Country","Description","Secondary_Email","Twitter","Skype_ID","Reporting_To","Email_Opt_Out","Owner","Created_Time","Modified_Time"],
    Deals: ["Deal_Name","Account_Name","Amount","Stage","Probability","Closing_Date","Type","Next_Step","Lead_Source","Contact_Name","Description","Campaign_Source","Expected_Revenue","Overall_Sales_Duration","Sales_Cycle_Duration","Owner","Created_Time","Modified_Time"],
    Accounts: ["Account_Name","Account_Number","Account_Type","Industry","Annual_Revenue","Phone","Fax","Website","Ownership","Employees","Rating","SIC_Code","Billing_Street","Billing_City","Billing_State","Billing_Code","Billing_Country","Shipping_Street","Shipping_City","Shipping_State","Shipping_Code","Shipping_Country","Description","Parent_Account","Owner","Created_Time","Modified_Time"],
  };

  const zohoModuleFields = async (module) => {
    try {
      const d = await zohoAPI("crm", `/settings/fields?module=${module}`);
      if (d.status === "error" || d.code) throw new Error(d.message || `Could not read ${module} field list`);
      const fields = (d.fields||[]).map(f=>f.api_name).filter(Boolean);
      if (!fields.length) throw new Error(`Zoho returned no fields for "${module}" — check the module name`);
      return fields;
    } catch(e) {
      const fallback = CRM_FALLBACK_FIELDS[module];
      if (!fallback) throw e;
      addLog(`${module}: field metadata unavailable (${e.message.slice(0,90)}) — using Zoho's standard fields only. Custom fields need the OAuth token re-authorized (see setup guide above) to be captured.`, "warn");
      return fallback;
    }
  };

  const exportZohoModule = async (module) => {
    if (!status.crm) { addLog("Connect Zoho CRM first", "warn"); return null; }
    setExportingModule(module);
    setExportProgress(p=>({...p,[module]:{page:0,records:0}}));
    addLog(`${module}: reading field list...`);
    try {
      const fieldChunks = chunk(await zohoModuleFields(module), FIELD_CHUNK_SIZE);
      const recordsById = new Map();
      let page = 1, more = true;
      while (more) {
        const first = await zohoAPI("crm", `/${module}?fields=${fieldChunks[0].join(",")}&page=${page}&per_page=200`);
        if (first._http_status === 204) break; // no records at all on this page — done
        if (first.status === "error" || first.code) throw new Error(first.message || `Zoho error on ${module} page ${page}`);
        for (const rec of (Array.isArray(first.data)?first.data:[])) recordsById.set(rec.id, {...(recordsById.get(rec.id)||{}), ...rec});

        for (let i=1;i<fieldChunks.length;i++) {
          await sleep(200);
          const d = await zohoAPI("crm", `/${module}?fields=${fieldChunks[i].join(",")}&page=${page}&per_page=200`);
          if (d._http_status === 204) continue;
          if (d.status === "error" || d.code) throw new Error(d.message || `Zoho error on ${module} page ${page} (fields batch ${i+1})`);
          for (const rec of (Array.isArray(d.data)?d.data:[])) recordsById.set(rec.id, {...(recordsById.get(rec.id)||{}), ...rec});
        }

        setExportProgress(p=>({...p,[module]:{page,records:recordsById.size}}));
        addLog(`${module}: page ${page} — ${recordsById.size} records so far`);
        more = first.info?.more_records ?? false;
        page++;
        if (page > 500) { addLog(`${module}: hit safety cap of 500 pages (~100k records) — stopping`, "warn"); break; }
        if (more) await sleep(300);
      }
      const records = Array.from(recordsById.values());
      setExportResults(p=>({...p,[module]:records}));
      addLog(`✓ ${module}: exported ${records.length} record(s)`, "success");
      return records;
    } catch(e) {
      addLog(`${module} export failed: ${e.message.slice(0,150)}`, "error");
      return null;
    } finally {
      setExportingModule(null);
    }
  };

  const exportAllZohoModules = async () => {
    for (const module of EXPORT_MODULES) {
      // eslint-disable-next-line no-await-in-loop
      await exportZohoModule(module);
    }
    addLog("✓ Full backup export complete for all modules", "success");
  };

  const flattenZohoValue = (v) => {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(flattenZohoValue).join("; ");
    if (typeof v === "object") return v.name || v.id || JSON.stringify(v);
    return String(v);
  };

  const downloadExportJson = (module) => {
    const records = exportResults[module];
    if (!records) return;
    const blob = new Blob([JSON.stringify(records, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zoho_${module.toLowerCase()}_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  const downloadExportCsv = (module) => {
    const records = exportResults[module];
    if (!records || !records.length) return;
    const keys = Array.from(records.reduce((s,r)=>{Object.keys(r).forEach(k=>s.add(k)); return s;}, new Set()));
    const rows = records.map(r=>keys.map(k=>`"${flattenZohoValue(r[k]).replace(/"/g,'""')}"`).join(","));
    const csv = [keys.join(","), ...rows].join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zoho_${module.toLowerCase()}_backup_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── FULL ZOHO BOOKS BACKUP EXPORT ─────────────────────────────────────────
  // Books' v3 API returns full objects by default on GET-by-id (no `fields`
  // param like CRM needs), but its LIST endpoints for line-item documents
  // (invoices/estimates/bills) return summary rows without line items — so
  // those three modules get a detail GET per record; the flatter entities
  // (contacts/items/customerpayments) are complete straight from the list.
  // Bills sits outside the OAuth scopes requested in api/zoho-setup.js today
  // (invoices/contacts/customerpayments/estimates/items only) — it's included
  // here anyway since other code in this app already calls it successfully,
  // but if the token truly lacks that scope it'll fail cleanly with Zoho's
  // own error message, independent of the other 5 modules.
  const BOOKS_MODULES = [
    { key:"invoices",         label:"Invoices",         listField:"invoices",         idField:"invoice_id",  detailField:"invoice",  needsDetail:true },
    { key:"estimates",        label:"Estimates",        listField:"estimates",        idField:"estimate_id", detailField:"estimate", needsDetail:true },
    { key:"bills",            label:"Bills",            listField:"bills",            idField:"bill_id",     detailField:"bill",     needsDetail:true },
    { key:"contacts",         label:"Customers/Vendors",listField:"contacts",         idField:"contact_id",  needsDetail:false },
    { key:"items",            label:"Items",            listField:"items",            idField:"item_id",     needsDetail:false },
    { key:"customerpayments", label:"Customer Payments",listField:"customerpayments", idField:"payment_id",  needsDetail:false },
  ];

  const exportBooksModule = async (mod) => {
    // Local list accumulator in an async exporter — not React render state.
    /* eslint-disable react-hooks/immutability */
    if (!status.books) { addLog("Connect Zoho Books first", "warn"); return null; }
    setBooksExportingModule(mod.key);
    setBooksExportProgress(p=>({...p,[mod.key]:{page:0,records:0}}));
    addLog(`${mod.label}: starting export...`);
    try {
      let all = [], page = 1;
      while (page <= 200) { // safety cap ~40k records
        const d = await zohoAPI("books", `/${mod.key}?per_page=200&page=${page}`);
        const batch = d[mod.listField];
        if (!Array.isArray(batch)) throw new Error(d.message || d.error || `Zoho Books returned no ${mod.label} data (page ${page})`);
        all = all.concat(batch);
        setBooksExportProgress(p=>({...p,[mod.key]:{page,records:all.length}}));
        addLog(`${mod.label}: page ${page} — ${all.length} records so far`);
        const hasMore = d.page_context?.has_more_page && batch.length===200;
        if (!hasMore) break;
        page++;
        await sleep(300);
      }

      if (mod.needsDetail && all.length) {
        addLog(`${mod.label}: fetching full line-item detail for ${all.length} record(s) — this can take a while...`);
        const detailed = [];
        let detailFailures = 0;
        for (let i=0;i<all.length;i++) {
          const rec = all[i];
          const id = rec[mod.idField];
          try {
            const dd = await zohoAPI("books", `/${mod.key}/${id}`);
            detailed.push(dd[mod.detailField] || rec);
          } catch {
            detailed.push(rec); // fall back to the summary row if one record's detail fetch fails
            detailFailures++;
          }
          if (i%10===9 || i===all.length-1) {
            setBooksExportProgress(p=>({...p,[mod.key]:{page:"detail",records:i+1}}));
            addLog(`${mod.label}: detail ${i+1}/${all.length}`);
          }
          await sleep(150);
        }
        all = detailed;
        if (detailFailures) addLog(`${mod.label}: ${detailFailures} record(s) kept summary-only — detail fetch failed`, "warn");
      }

      setBooksExportResults(p=>({...p,[mod.key]:all}));
      addLog(`✓ ${mod.label}: exported ${all.length} record(s)`, "success");
      return all;
    } catch(e) {
      addLog(`${mod.label} export failed: ${e.message.slice(0,150)}`, "error");
      return null;
    } finally {
      setBooksExportingModule(null);
    }
    /* eslint-enable react-hooks/immutability */
  };

  const exportAllBooksModules = async () => {
    for (const mod of BOOKS_MODULES) {
      // eslint-disable-next-line no-await-in-loop
      await exportBooksModule(mod);
    }
    addLog("✓ Full Books backup export complete for all modules", "success");
  };

  const downloadBooksJson = (key) => {
    const records = booksExportResults[key];
    if (!records) return;
    const blob = new Blob([JSON.stringify(records, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zoho_books_${key}_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  const downloadBooksCsv = (key) => {
    const records = booksExportResults[key];
    if (!records || !records.length) return;
    const keys = Array.from(records.reduce((s,r)=>{Object.keys(r).forEach(k=>s.add(k)); return s;}, new Set()));
    const rows = records.map(r=>keys.map(k=>`"${flattenZohoValue(r[k]).replace(/"/g,'""')}"`).join(","));
    const csv = [keys.join(","), ...rows].join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zoho_books_${key}_backup_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── "WHO'S BEEN INVOICED" REPORT ──────────────────────────────────────────
  // Read-only rollup of every distinct customer with at least one invoice in
  // Zoho Books, used to decide who gets re-created as an Account in the
  // freshly-wiped Zoho CRM. Only reads the invoice LIST (summary fields are
  // enough for a $/count rollup — no need for the full line-item detail pass
  // the Books backup export does), then looks up contact detail (email,
  // phone, billing address) once per distinct customer.
  const buildInvoicedReport = async () => {
    if (!status.books) { addLog("Connect Zoho Books first", "warn"); return; }
    setInvoicedReportLoading(true);
    setInvoicedReportStatus("Pulling invoices...");
    addLog("Building invoiced-customers report...");
    try {
      let allInvoices = [], page = 1;
      while (page <= 200) { // safety cap ~40k invoices
        const d = await zohoAPI("books", `/invoices?per_page=200&page=${page}`);
        const batch = d.invoices;
        if (!Array.isArray(batch)) throw new Error(d.message || d.error || `Zoho Books returned no invoice data (page ${page})`);
        allInvoices = allInvoices.concat(batch);
        setInvoicedReportStatus(`Invoices: page ${page} — ${allInvoices.length} so far`);
        addLog(`Invoices: page ${page} — ${allInvoices.length} so far`);
        const hasMore = d.page_context?.has_more_page && batch.length===200;
        if (!hasMore) break;
        page++;
        await sleep(300);
      }

      const byCustomer = new Map();
      for (const inv of allInvoices) {
        const cid = inv.customer_id;
        if (!cid) continue;
        const cur = byCustomer.get(cid) || {
          customerId: cid, customerName: inv.customer_name||"", invoiceCount:0,
          totalInvoiced:0, totalBalance:0, firstInvoiceDate:null, lastInvoiceDate:null,
          email:"", phone:"", city:"", state:"", zip:"", contactStatus:"",
        };
        cur.invoiceCount++;
        cur.totalInvoiced += Number(inv.total)||0;
        cur.totalBalance += Number(inv.balance)||0;
        if (inv.date && (!cur.firstInvoiceDate || inv.date<cur.firstInvoiceDate)) cur.firstInvoiceDate = inv.date;
        if (inv.date && (!cur.lastInvoiceDate || inv.date>cur.lastInvoiceDate)) cur.lastInvoiceDate = inv.date;
        byCustomer.set(cid, cur);
      }
      const customers = Array.from(byCustomer.values());
      addLog(`Found ${customers.length} distinct invoiced customer(s) across ${allInvoices.length} invoice(s) — fetching contact details...`);

      for (let i=0;i<customers.length;i++) {
        const c = customers[i];
        setInvoicedReportStatus(`Contact detail ${i+1}/${customers.length}...`);
        try {
          const dd = await zohoAPI("books", `/contacts/${c.customerId}`);
          const contact = dd.contact;
          if (contact) {
            c.email = contact.email || contact.contact_persons?.[0]?.email || "";
            c.phone = contact.phone || contact.mobile || contact.contact_persons?.[0]?.phone || "";
            c.city = contact.billing_address?.city || "";
            c.state = contact.billing_address?.state || "";
            c.zip = contact.billing_address?.zip || "";
            c.contactStatus = contact.status || "";
          }
        } catch { /* keep the invoice-derived fields if contact detail fails */ }
        if (i%10===9 || i===customers.length-1) addLog(`Contact detail ${i+1}/${customers.length}`);
        await sleep(150);
      }

      customers.sort((a,b)=>b.totalInvoiced-a.totalInvoiced);
      setInvoicedReport(customers);
      addLog(`✓ Invoiced-customers report ready — ${customers.length} customer(s)`, "success");
    } catch(e) {
      addLog(`Invoiced report failed: ${e.message.slice(0,150)}`, "error");
    }
    setInvoicedReportLoading(false);
    setInvoicedReportStatus("");
  };

  const downloadInvoicedReportCsv = () => {
    if (!invoicedReport || !invoicedReport.length) return;
    const headers = ["customerName","email","phone","city","state","zip","invoiceCount","totalInvoiced","totalBalance","firstInvoiceDate","lastInvoiceDate","contactStatus","customerId"];
    const esc = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
    const rows = invoicedReport.map(c=>headers.map(h=>esc(c[h])).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zoho_invoiced_customers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── PUSH REVOPS DEAL → ZOHO CRM ───────────────────────────────────────────
  const pushDealToCRM = async (deal) => {
    if(!status.crm) { addLog("Connect Zoho CRM first","warn"); return; }
    addLog(`Pushing "${deal.name}" to Zoho CRM...`);
    try {
      await zohoAPI("crm", "/Deals", "POST", { data:[{
        Deal_Name: deal.name, Account_Name: deal.school||"",
        Amount: deal.value||0, Stage: "Qualification",
        Closing_Date: deal.followUpDate||new Date(Date.now()+30*86400000).toISOString().slice(0,10),
        Description: deal.product||"",
      }]});
      addLog(`✓ Deal pushed to Zoho CRM`,"success");
    } catch(e) {
      addLog(`CRM push: ${e.message.slice(0,80)}`,"error");
    }
  };

  // ── EMAIL SCAN ─────────────────────────────────────────────────────────────
  const testGmail = async () => {
    setTesting("gmail"); addLog("Testing Gmail connection...");
    try {
      const r = await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list",maxResults:1})});
      const d = await r.json();
      if(d.error) throw new Error(d.error);
      setGmailStatus(true);
      saveStatus({...loadStatus(), gmail:true});
      setStatus(s=>({...s,gmail:true}));
      addLog("✓ Gmail connected","success");
    } catch(e) {
      addLog(`Gmail: ${e.message.slice(0,100)}`,"error");
    }
    setTesting(null);
  };

  const loadAdsStatus = async () => {
    setAdsLoading(true);
    try {
      const r = await fetch("/api/ads/status");
      const d = await r.json();
      setAdsStatus(d);
      try { localStorage.setItem("st1_ads_status_v1", JSON.stringify({...d,ts:Date.now()})); } catch {}
      const connected = Object.values(d).filter(v=>v?.status==="connected").length;
      addLog(`Ad platforms: ${connected} connected`, connected>0?"success":"info");
    } catch(e) {
      addLog(`Ads status: ${e.message.slice(0,80)}`,"error");
    }
    setAdsLoading(false);
  };

  const testInstantly = async () => {
    setTesting("instantly");
    try {
      const r = await fetch("/api/instantly",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list_campaigns"})});
      const d = await r.json();
      if(d.error) throw new Error(d.error);
      setInstStatus({ok:true, count:d.campaigns?.length||0});
      setInstCampaigns(d.campaigns||[]);
      addLog(`✓ Instantly connected — ${d.campaigns?.length||0} campaigns`,"success");
    } catch(e) {
      setInstStatus({ok:false, error:e.message});
      addLog(`Instantly: ${e.message.slice(0,100)}`,"error");
    }
    setTesting(null);
  };

  const scanEmailInbox = async () => {
    setEmailScanning(true); setEmailOpps([]); setEmailMessages([]);
    addLog("Fetching recent emails from Gmail...");
    try {
      const r = await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list",maxResults:40,query:emailQuery})});
      const d = await r.json();
      if(d.error) throw new Error(d.error);
      const msgs = d.messages||[];
      setEmailMessages(msgs);
      addLog(`Fetched ${msgs.length} emails — analyzing for orders...`);
      if(!msgs.length) { setEmailScanning(false); return; }

      // Send to Claude for order detection
      const claudeR = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:1500,
        system:"You detect B2B sales opportunities for ST1 Sports, an athletic equipment company in Iowa. Identify emails that are quote requests, purchase orders, RFQ/RFP inquiries, or customer order emails. Ignore marketing, spam, notifications.",
        messages:[{role:"user",content:
          `Analyze these emails for order/sales opportunities. For each that might be an opportunity, extract structured data.\n\nEmails:\n${msgs.map(m=>`ID:${m.id}\nFrom: ${m.from}\nSubject: ${m.subject}\nPreview: ${m.snippet}`).join("\n\n")}\n\n`+
          `Return JSON array (only emails with isOpportunity:true): [{"emailId":"","isOpportunity":true,"confidence":"high|medium|low","customerName":"","org":"","product":"what they want","estimatedValue":null,"dealName":"suggested deal name","summary":"one-line summary","from":"","subject":""}]`
        }]
      })});
      const cd = await claudeR.json();
      const text=(cd.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      const m=text.match(/\[[\s\S]*\]/);
      const opps = m ? JSON.parse(m[0]) : [];
      setEmailOpps(opps.filter(o=>o.isOpportunity));
      addLog(`✓ Found ${opps.filter(o=>o.isOpportunity).length} potential opportunities in ${msgs.length} emails`,"success");
    } catch(e) {
      addLog(`Email scan: ${e.message.slice(0,100)}`,"error");
    }
    setEmailScanning(false);
  };

  const createDealFromEmail = (opp) => {
    const deal = {
      id: "email_"+uid(),
      name: opp.dealName||opp.org||opp.customerName||"Email Lead",
      school: opp.org||"",
      contact: opp.customerName||"",
      value: parseFloat(opp.estimatedValue)||0,
      stage: "Quoted",
      product: opp.product||"",
      priority: opp.confidence==="high"?"hot":"warm",
      createdAt: new Date().toISOString().slice(0,10),
      followUpDate: "",
      source: "email-scan",
    };
    const added = pushToRevOps("deals", [deal]);
    addLog(`✓ Deal created: "${deal.name}"${added?" — added to RevOps":" (already exists)"}`, "success");
    setEmailOpps(prev=>prev.map(o=>o.emailId===opp.emailId?{...o,created:true}:o));
  };

  // ── DRAFT INVOICE REMINDER ──────────────────────────────────────────────────
  const draftReminder = async (inv, type="gentle") => {
    const k=inv.id+type; setDrafting(k);
    const daysOD = Math.floor((Date.now()-new Date(inv.due_date))/86400000);
    const text = await aiText(`Write a ${type==="gentle"?"friendly":type==="firm"?"firm":"final notice"} invoice reminder from Matt Stone at ST1 Sports.
Invoice ${inv.number} for ${fmt$(inv.balance)} to ${inv.customer_name}${type!=="gentle"?`, ${daysOD} days past due`:""}.
Under 70 words. Sign: Matt Stone | ST1 Sports | matt@st1sports.com | 719-256-0275`);
    setDrafts(d=>({...d,[k]:text})); setDrafting(null);
  };

  // ── SEND REMINDER + SLACK NOTIFY ───────────────────────────────────────────
  // Previously this only posted a Slack message CLAIMING the reminder email
  // was sent — no email was ever actually dispatched. Now it actually sends
  // via Gmail first, and only reports success / notifies Slack if that send
  // genuinely succeeded.
  const sendReminderAndNotify = async (inv) => {
    if (!inv.email) { addLog(`No email on file for ${inv.customer_name} — can't send reminder`,"warn"); return; }
    const k = inv.id+"gentle";
    const msgBody = drafts[k] || `Hi, this is a reminder about invoice ${inv.number} for ${fmt$(inv.balance)} which is now past due. Please process at your earliest convenience. — Matt Stone, ST1 Sports`;

    try {
      const r = await fetch("/api/gmail", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          action:    "send",
          to_email:  inv.email,
          to_name:   inv.customer_name,
          subject:   `Invoice ${inv.number} — Payment Reminder`,
          body:      msgBody,
          from_name: "Matt Stone",
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `Gmail send failed (${r.status})`);

      const slackMsg = `🔔 *Invoice Reminder Sent*
Customer: *${inv.customer_name}*
Invoice: ${inv.number} · ${fmt$(inv.balance)} overdue
Action: Reminder email sent to ${inv.email}
→ Follow up if no response in 3 business days`;
      await sendSlackAlert(slackMsg);
      addLog(`✓ Reminder emailed to ${inv.email} for ${inv.number}`,"success");
    } catch(e) {
      addLog(`Reminder email failed: ${e.message.slice(0,120)}`,"error");
    }
  };

  // ── SHOPIFY: UPDATE PRODUCT PRICE ──────────────────────────────────────────
  const updateShopifyPrice = async (productId, variantId, newPrice) => {
    if(!status.shopify) { addLog("Connect Shopify first","warn"); return; }
    if(!variantId) { addLog("No variant ID for this product — can't update price","error"); return; }
    addLog(`Updating product ${productId} price to ${fmt$(newPrice)}...`);
    try {
      await shopifyAPI(`/variants/${variantId}.json`,"PUT",{variant:{id:variantId,price:String(newPrice)}});
      setProducts(prev=>prev.map(p=>p.id===productId?{...p,price:String(newPrice)}:p));
      addLog(`✓ Shopify price updated`,"success");
    } catch(e) {
      addLog(`Shopify price update failed: ${e.message.slice(0,80)}`,"error");
    }
  };

  // ── FIRE OVERDUE ALERT TO SLACK ─────────────────────────────────────────────
  const fireOverdueAlerts = async () => {
    const overdue = invoices.filter(i=>i.status==="overdue");
    if(!overdue.length) { addLog("No overdue invoices right now","info"); return; }
    const total = overdue.reduce((s,i)=>s+(i.balance||0),0);
    const msg = `⚠️ *ST1 Sports — Overdue Invoice Alert*
${overdue.length} invoice${overdue.length!==1?"s":""} past due · *${fmt$(total)} outstanding*

${overdue.map(i=>`• ${i.customer_name} — ${i.number} · ${fmt$(i.balance)}`).join("\n")}

Action: Review and send reminders in RevOps dashboard`;
    await sendSlackAlert(msg);
  };

  // ── TEST SLACK ──────────────────────────────────────────────────────────────
  const testSlack = async () => {
    setTesting("slack"); addLog("Sending test message to Slack...");
    const ok = await sendSlackAlert(`✅ *ST1 RevOps — Slack Integration Test*
Connected successfully! Alerts, overdue invoice notifications, and high-intent signals will post here automatically.
Channel: ${slackChannelName}`);
    if(ok) setStatus(s=>({...s,slack:true}));
    setTesting(null);
  };

  const loadSlackDiag = useCallback(async () => {
    try {
      const r = await fetch("/api/slack-message");
      const d = await r.json();
      if (d?.ok || d?.tokenConfigured != null) {
        setSlackDiag(d);
        setSlackWebhookSaved(!!d.webhookConfigured);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (tab === "slack") loadSlackDiag();
  }, [tab, loadSlackDiag]);

  const saveSlackWebhookUrl = async () => {
    setTesting("slack-webhook");
    try {
      const r = await fetch("/api/slack-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-webhook", url: slackWebhook.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      setSlackWebhook("");
      setSlackWebhookSaved(true);
      addLog(d.replayed
        ? `Webhook saved. Posted ${d.replayed} missed Brad reply alert${d.replayed !== 1 ? "s" : ""} to Slack.`
        : "Incoming webhook saved. Send a test message to confirm Slack.", "success");
      await loadSlackDiag();
    } catch (e) {
      addLog(`Webhook: ${e.message}`, "error");
    }
    setTesting(null);
  };

  // ─── UI ─────────────────────────────────────────────────────────────────────
  const logColor={success:B.green,warn:B.yellow,error:B.red,info:B.muted};

  function StatusBadge({ok,label}) {
    return (
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:ok?B.green:B.muted,flexShrink:0}}/>
        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:ok?B.green:B.muted,fontWeight:ok?500:400}}>{ok?"Connected":"Not configured"}</span>
      </div>
    );
  }

  function ConnCard({id,title,sub,color,icon,connected,children}) {
    return (
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:18,borderTop:`3px solid ${connected?B.green:color}`,boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div style={{width:36,height:36,background:connected?B.greenBg:`${color}14`,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{icon}</div>
            <div>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>{title}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:1}}>{sub}</div>
            </div>
          </div>
          <StatusBadge ok={connected}/>
        </div>
        {children}
      </div>
    );
  }

  function Field({label,val,onChange,type="text",placeholder=""}) {
    return (
      <div style={{marginBottom:9}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:3}}>{label}</div>
        <input type={type} value={val||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}/>
      </div>
    );
  }

  function OBtn({children,onClick,disabled,color,sm,style={}}) {
    const c=color||B.orange;
    return <button onClick={onClick} disabled={disabled} style={{background:disabled?B.border:c,color:disabled?B.muted:B.white,border:"none",borderRadius:5,padding:sm?"5px 11px":"8px 16px",fontSize:sm?10:11,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:disabled?"not-allowed":"pointer",...style}}>{children}</button>;
  }

  function GBtn({children,onClick,style={}}) {
    return <button onClick={onClick} style={{background:B.white,color:B.textMid,border:`1px solid ${B.borderD}`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif",...style}}>{children}</button>;
  }

  const ISC = {overdue:{c:B.red,bg:B.redBg},sent:{c:B.blue,bg:B.blueBg},viewed:{c:B.purple,bg:B.purpleBg},partial:{c:B.yellow,bg:B.yellowBg},paid:{c:B.green,bg:B.greenBg},draft:{c:B.muted,bg:B.surface}};

  return (
    <div style={{minHeight:"100vh",background:B.pageBg,fontFamily:"'Lexend',sans-serif",color:B.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px}
        button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s} button:hover{opacity:.82} button:active{transform:scale(.97)}
        input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
        @keyframes fu{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .fu{animation:fu .2s ease} .blink{animation:blink 2s infinite}
      `}</style>
      {/* ← Back to RevOps */}
      <div style={{background:"#fff",borderBottom:"1px solid #E2E0DB",padding:"6px 20px",display:"flex",alignItems:"center",gap:8}}>
        <Link to="/" style={{display:"flex",alignItems:"center",gap:6,textDecoration:"none",color:"#7A7872",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
          <span style={{fontSize:13}}>←</span> Back to RevOps
        </Link>
      </div>

      {/* HEADER */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:34,height:34,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.3}}>INTEGRATIONS + AI KNOWLEDGE HUB</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>CONNECTORS · UPLOADS · TOOLS · AGENT DATA</div>
          </div>
        </div>
        {/* Live connection status */}
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
          {[
            ["Slack",       status.slack,                                  "#4A154B"],
            ["Zoho Books",  status.books,                                  "#E42527"],
            ["Zoho CRM",    status.crm,                                    "#E42527"],
            ["Campaigns",   status.campaigns,                              "#E42527"],
            ["Gmail",       gmailStatus,                                   "#EA4335"],
            ["Instantly",   instStatus?.ok,                                "#FF4A00"],
            ["Meta Ads",    adsStatus.meta?.status==="connected",          "#1877F2"],
            ["Google Ads",  adsStatus.google?.status==="connected",        "#4285F4"],
            ["LinkedIn",    adsStatus.linkedin?.status==="connected",      "#0A66C2"],
            ["Shopify",     status.shopify,                                "#95BF47"],
          ].map(([l,ok,c])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:ok?B.green:B.muted}}/>
              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:ok?B.green:B.muted}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* NAV */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"0 28px",display:"flex",gap:2}}>
        {[["overview","Overview"],["knowledge","AI Knowledge"],["slack","Slack"],["zoho","Zoho Books + CRM"],["marketing","Marketing"],["ads","Ad Platforms"],["email","Email Scanner"],["shopify","Shopify"],["tools","AI Tools"],["log","Activity Log"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===id?B.orange:"transparent"}`,color:tab===id?B.orange:B.muted,padding:"10px 14px",fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:tab===id?500:400}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:0,minHeight:"calc(100vh - 112px)"}}>
        {/* MAIN */}
        <div style={{padding:"24px 28px",overflowY:"auto"}}>

          {/* ── OVERVIEW ── */}
          {tab==="overview"&&(
            <div className="fu">
              <div style={{marginBottom:22}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.black,letterSpacing:.3}}>CONNECTION STATUS</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:3}}>Configure each integration once — your data flows automatically</div>
                <div style={{width:34,height:3,background:B.orange,marginTop:8,borderRadius:2}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:20}}>
                {/* Slack */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${status.slack?"#4A154B":B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>💬</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>Slack</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Live via MCP — no token needed</div>
                      </div>
                    </div>
                    <StatusBadge ok={status.slack}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,lineHeight:1.6,marginBottom:9}}>
                    Connected as <strong>Matt Stone</strong> at ST1 Sports. Channel: <strong>{slackChannelName}</strong>. Alerts fire automatically.
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <OBtn sm onClick={testSlack} disabled={testing==="slack"}>{testing==="slack"?"SENDING...":"TEST →"}</OBtn>
                    <OBtn sm color="#4A154B" onClick={fireOverdueAlerts}>FIRE OVERDUE ALERTS</OBtn>
                  </div>
                </div>

                {/* Zoho */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${status.books&&status.crm?B.green:B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>📊</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>Zoho Books + CRM</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Invoices, AR, customer tagging</div>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <StatusBadge ok={status.books} label="Books"/>
                      <StatusBadge ok={status.crm}   label="CRM"/>
                    </div>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:9}}>
                    {status.books&&status.crm?"Live data flowing.":"Paste OAuth tokens in the Zoho tab to connect. Get tokens from api-console.zoho.com → Self Client."}
                  </div>
                  <OBtn sm onClick={()=>setTab("zoho")}>CONFIGURE →</OBtn>
                </div>

                {/* Shopify */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${status.shopify?"#95BF47":B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>🛍️</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>Shopify</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>products, orders, inventory</div>
                      </div>
                    </div>
                    <StatusBadge ok={status.shopify}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:9}}>
                    {status.shopify?"Products and orders loaded.":"Add SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN to Vercel env vars, then test connection."}
                  </div>
                  <OBtn sm onClick={()=>setTab("shopify")}>CONFIGURE →</OBtn>
                </div>

                {/* AI Knowledge */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${B.orange}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>◈</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>AI Knowledge</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Notion, Drive, uploads, ST1 tool schemas</div>
                      </div>
                    </div>
                    <StatusBadge ok label="Ready"/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:9,lineHeight:1.5}}>
                    Add docs, see what is connected, test ST1 tools, and prepare knowledge for Claude/OpenAI/MCP agents.
                  </div>
                  <OBtn sm onClick={()=>setTab("knowledge")}>OPEN HUB →</OBtn>
                </div>

                {/* Ad platforms */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${Object.values(adsStatus).some(v=>v?.status==="connected")?"#1877F2":B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>📣</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>Ad Platforms</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Meta · Google · LinkedIn · TikTok · Microsoft</div>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"flex-end"}}>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:Object.values(adsStatus).filter(v=>v?.status==="connected").length>0?B.green:B.muted}}>
                        {Object.values(adsStatus).filter(v=>v?.status==="connected").length} / 6 connected
                      </span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:9}}>
                    {[
                      {k:"meta",l:"Meta",c:"#1877F2"},
                      {k:"google",l:"Google",c:"#4285F4"},
                      {k:"linkedin",l:"LinkedIn",c:"#0A66C2"},
                      {k:"tiktok",l:"TikTok",c:"#010101"},
                      {k:"microsoft",l:"Bing",c:"#00A4EF"},
                      {k:"ga4",l:"GA4",c:"#E37400"},
                    ].map(({k,l,c})=>(
                      <span key={k} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,padding:"2px 7px",borderRadius:10,letterSpacing:.5,
                        color:adsStatus[k]?.status==="connected"?B.white:B.muted,
                        background:adsStatus[k]?.status==="connected"?c:B.surface,
                        border:`1px solid ${adsStatus[k]?.status==="connected"?c:B.border}`}}>{l}</span>
                    ))}
                  </div>
                  <OBtn sm onClick={()=>setTab("ads")}>CONFIGURE →</OBtn>
                </div>

                {/* Instantly */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${instStatus?.ok?"#FF4A00":B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>⚡</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>Instantly.ai</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Cold email sequences & nurture</div>
                      </div>
                    </div>
                    <StatusBadge ok={instStatus?.ok}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:9}}>
                    {instStatus?.ok?`${instStatus.count} campaign${instStatus.count!==1?"s":""} active. Cold leads route here automatically.`:"Set INSTANTLY_API_KEY in Vercel to connect email sequences."}
                  </div>
                  <OBtn sm color="#FF4A00" onClick={()=>setTab("marketing")}>CONFIGURE →</OBtn>
                </div>

                {/* Quick actions */}
                <div style={{background:B.orangeBg,border:`1px solid ${B.orange}30`,borderRadius:8,padding:16}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginBottom:12}}>QUICK ACTIONS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {[
                      ["🔔 Alert overdue invoices to Slack",()=>fireOverdueAlerts()],
                      ["🔄 Sync all invoiced customers to CRM",()=>bulkCRMSync()],
                      ["📦 Refresh Shopify inventory",async()=>{
                        if(!status.shopify){addLog("Connect Shopify first","warn");return;}
                        try{
                          const d=await shopifyAPI("/products.json?limit=10");
                          const prods=d.products||[];
                          setProducts(prods.map(p=>({
                            id:p.id,variantId:p.variants?.[0]?.id,sku:p.variants?.[0]?.sku||"",name:p.title,
                            categories:p.product_type?[{name:p.product_type}]:[],
                            price:p.variants?.[0]?.price||"0.00",
                            stock_quantity:p.variants?.reduce((s,v)=>s+(v.inventory_quantity||0),0),
                            stock_status:p.variants?.some(v=>(v.inventory_quantity||0)>0)?"instock":"outofstock",
                          })));
                          addLog(`✓ ${prods.length} products refreshed`,"success");
                        }catch(e){addLog(`Shopify refresh failed: ${e.message.slice(0,80)}`,"error");}
                      }],
                    ].map(([l,fn])=>(
                      <button key={l} onClick={fn} style={{background:B.white,border:`1px solid ${B.orange}30`,color:B.textMid,borderRadius:5,padding:"8px 11px",fontFamily:"'Lexend',sans-serif",fontSize:11,textAlign:"left",cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Invoice + CRM sync summary */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>AR SNAPSHOT — LIVE FROM ZOHO BOOKS</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
                  {[
                    ["Total AR",fmt$(invoices.filter(i=>!["paid","draft"].includes(i.status)).reduce((s,i)=>s+(i.balance||0),0)),B.orange],
                    ["Overdue",fmt$(invoices.filter(i=>i.status==="overdue").reduce((s,i)=>s+(i.balance||0),0)),B.red],
                    ["Collected",fmt$(invoices.filter(i=>i.status==="paid").reduce((s,i)=>s+i.total,0)),B.green],
                    ["CRM Sync Needed",invoices.filter(i=>["sent","viewed","partial","paid"].includes(i.status)&&!i.crm_synced).length,B.purple],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:B.surface,borderRadius:5,padding:"10px 12px",borderTop:`2px solid ${c}`,textAlign:"center"}}>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:c}}>{v}</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1.5,marginTop:3}}>{l.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                {invoices.filter(i=>["sent","viewed","partial","paid"].includes(i.status)&&!i.crm_synced).length>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:B.purpleBg,borderRadius:5,border:`1px solid ${B.purple}30`}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid}}>
                      {invoices.filter(i=>["sent","viewed","partial","paid"].includes(i.status)&&!i.crm_synced).length} customers invoiced but still showing as "Prospect" in CRM
                    </span>
                    <OBtn sm color={B.purple} onClick={bulkCRMSync} disabled={syncing}>{syncing?"SYNCING...":"SYNC ALL TO CRM"}</OBtn>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SLACK ── */}
          {tab==="slack"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>SLACK</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>ST1 Sports workspace · Connected via SLACK_BOT_TOKEN</div>
                <div style={{width:32,height:3,background:"#4A154B",marginTop:7,borderRadius:2}}/>
              </div>

              {slackDiag?.hint && (
                <div style={{background:B.redBg,border:`1px solid ${B.red}30`,borderRadius:8,padding:"12px 14px",marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,letterSpacing:1.5,marginBottom:4}}>BRAD REPLY SLACK</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{slackDiag.hint}</div>
                  {slackDiag.lastReplyFrom && (
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:6}}>
                      Last reply from {slackDiag.lastReplyFrom}: Slack {slackDiag.lastReplySlack || "not recorded"}
                    </div>
                  )}
                </div>
              )}

              {/* Channel config */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderTop:`3px solid #4A154B`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>CHANNEL CONFIGURATION</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>CHANNEL ID</div>
                    <input value={slackChannel} onChange={e=>setSlackChannel(e.target.value)}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>CHANNEL NAME (display)</div>
                    <input value={slackChannelName} onChange={e=>setSlackChannelName(e.target.value)}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}/>
                  </div>
                </div>
                <div style={{background:B.greenBg,border:`1px solid ${B.green}30`,borderRadius:5,padding:"9px 11px",marginBottom:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:1.5,marginBottom:3}}>DISCOVERED CHANNEL</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>#all-st1-sports (C09F64RK0MN) — your active workspace channel</div>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>INCOMING WEBHOOK URL</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:6,lineHeight:1.45}}>
                    The current Slack app token cannot use chat.postMessage. Paste the Incoming Webhook from api.slack.com → your app → Incoming Webhooks (channel #sales). Saving it immediately sends every Brad reply that Slack missed.
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <input type="password" value={slackWebhook} onChange={e=>setSlackWebhook(e.target.value)}
                      placeholder={slackWebhookSaved ? "Webhook saved — paste a new one to replace" : "https://hooks.slack.com/services/…"}
                      style={{flex:1,minWidth:220,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}/>
                    <OBtn sm onClick={saveSlackWebhookUrl} disabled={testing==="slack-webhook" || !slackWebhook.trim()}>{testing==="slack-webhook"?"SAVING...":"SAVE + SEND MISSED ALERTS"}</OBtn>
                  </div>
                  {slackWebhookSaved && <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginTop:6}}>Incoming webhook is saved on the server.</div>}
                  {slackDiag?.failedBradSlack > 0 && (
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,marginTop:6}}>{slackDiag.failedBradSlack} Brad reply alert{slackDiag.failedBradSlack !== 1 ? "s" : ""} never made it to Slack.</div>
                  )}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {slackDiag?.oauthConfigured && (
                    <OBtn color="#4A154B" onClick={()=>{ window.location.href = "/api/slack/oauth"; }}>RECONNECT SLACK (CHAT:WRITE)</OBtn>
                  )}
                  <OBtn onClick={testSlack} disabled={testing==="slack"}>{testing==="slack"?"SENDING TEST...":"SEND TEST MESSAGE"}</OBtn>
                  {slackDiag?.failedBradSlack > 0 && slackWebhookSaved && (
                    <OBtn sm color="#4A154B" onClick={async()=>{
                      setTesting("slack-replay");
                      try {
                        const r = await fetch("/api/slack-message", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action: "replay-failed" }) });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error || "Replay failed");
                        addLog(`Posted ${d.replayed || 0} missed Brad alerts to Slack`, "success");
                        await loadSlackDiag();
                      } catch(e) { addLog(e.message, "error"); }
                      setTesting(null);
                    }}>{testing==="slack-replay"?"SENDING…":"RESEND MISSED ALERTS"}</OBtn>
                  )}
                </div>
              </div>

              {/* Alert types */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>ALERT TYPES — WHAT FIRES TO SLACK</div>
                {[
                  {label:"Overdue invoice alerts",desc:"Daily digest of all past-due invoices with totals",action:fireOverdueAlerts,btnLabel:"FIRE NOW"},
                  {label:"High-intent signals",desc:"When prospecting finds high-priority contacts or hot leads",action:()=>sendSlackAlert("🔥 *High-Intent Signal*\nNew high-priority contacts found in Fargo North, ND — 3 Track & Field ADs ready for outreach"),btnLabel:"TEST"},
                  {label:"RFP deadline warnings",desc:"48-hour warning before any active RFP submission deadline",action:()=>sendSlackAlert("⏰ *RFP Deadline Alert*\nIowa IGHSAU bid (B26-IGHSAU-001) due in 48 hours — submission checklist 40% complete"),btnLabel:"TEST"},
                  {label:"PO received",desc:"When a deal moves to PO Received stage",action:()=>sendSlackAlert("💰 *PO Received*\nIowa City CSD — INV-00891 · $2,100\nFulfill with Molten Volleyballs — ship by end of week"),btnLabel:"TEST"},
                ].map((a,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{a.label}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{a.desc}</div>
                    </div>
                    <OBtn sm color="#4A154B" onClick={a.action}>{a.btnLabel}</OBtn>
                  </div>
                ))}
              </div>

              {/* Invoice reminders */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>OVERDUE — DRAFT & SEND REMINDERS</div>
                {invoices.filter(i=>i.status==="overdue").map(inv=>(
                  <div key={inv.id} style={{padding:"10px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:drafts[inv.id+"gentle"]?8:0}}>
                      <div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{inv.customer_name}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.number} · {fmt$(inv.balance)} overdue</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <OBtn sm onClick={()=>draftReminder(inv,"gentle")} disabled={drafting===inv.id+"gentle"}>{drafting===inv.id+"gentle"?"...":"DRAFT REMINDER"}</OBtn>
                        {drafts[inv.id+"gentle"]&&<OBtn sm color="#4A154B" onClick={()=>sendReminderAndNotify(inv)}>SEND + NOTIFY SLACK</OBtn>}
                      </div>
                    </div>
                    {drafts[inv.id+"gentle"]&&(
                      <div style={{background:B.surface,borderRadius:4,padding:9,border:`1px solid ${B.border}`}}>
                        <textarea value={drafts[inv.id+"gentle"]} onChange={e=>setDrafts(d=>({...d,[inv.id+"gentle"]:e.target.value}))} rows={5}
                          style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
                        <GBtn onClick={()=>navigator.clipboard?.writeText(drafts[inv.id+"gentle"])} style={{fontSize:10,padding:"3px 8px",marginTop:5}}>COPY</GBtn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ZOHO ── */}
          {tab==="zoho"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>ZOHO BOOKS + CRM</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>Invoicing, AR tracking, and automatic customer tagging</div>
                <div style={{width:32,height:3,background:B.red,marginTop:7,borderRadius:2}}/>
              </div>

              {/* Connection status cards */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
                <ConnCard id="books" title="Zoho Books" sub="Live invoices, AR, payment status" color={B.red} icon="📒" connected={status.books}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:8}}>
                    Credentials stored in Vercel env vars — not in the browser.
                  </div>
                  <OBtn onClick={testBooks} disabled={testing==="books"} style={{width:"100%"}}>
                    {testing==="books"?"CONNECTING...":status.books?"✓ RECONNECT":"TEST CONNECTION"}
                  </OBtn>
                </ConnCard>

                <ConnCard id="crm" title="Zoho CRM" sub="Contact sync, Lead_Status, customer tagging" color={B.red} icon="👥" connected={status.crm}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:8}}>
                    Same OAuth app and refresh token as Zoho Books — one setup for both.
                  </div>
                  <OBtn onClick={testCRM} disabled={testing==="crm"} style={{width:"100%"}}>
                    {testing==="crm"?"CONNECTING...":status.crm?"✓ RECONNECT":"TEST CONNECTION"}
                  </OBtn>
                </ConnCard>
              </div>

              {/* Setup guide */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${B.blue}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:2,marginBottom:12}}>ONE-TIME SETUP</div>
                {[
                  ["1","Go to api-console.zoho.com → click Server-based Applications → Create"],
                  ["2","Set Redirect URI to: https://YOUR-VERCEL-DOMAIN/api/zoho-setup"],
                  ["3","Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to Vercel env vars"],
                  ["4","Visit /api/zoho-setup on your deployed app — click the Authorize button"],
                  ["5","Copy the ZOHO_REFRESH_TOKEN shown on screen into Vercel env vars"],
                  ["6","Add ZOHO_ORG_ID — find it in Zoho Books → Settings → Organization Profile"],
                  ["7","Redeploy in Vercel (or trigger a new deployment) for env vars to take effect"],
                ].map(([n,step])=>(
                  <div key={n} style={{display:"flex",gap:9,padding:"6px 0",borderBottom:`1px solid ${B.border}`}}>
                    <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,minWidth:18,flexShrink:0}}>{n}</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{step}</span>
                  </div>
                ))}
                <div style={{marginTop:12,padding:"10px 12px",background:B.greenBg,border:`1px solid ${B.green}40`,borderRadius:4}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:500}}>Refresh tokens don't expire</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>
                    Unlike the 60-min Self Client tokens, a Server-based OAuth app gives you a refresh token that works indefinitely. You only do this setup once.
                  </div>
                </div>
              </div>

              {/* Env vars reference */}
              <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12,marginBottom:14,fontFamily:"monospace",fontSize:11}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>VERCEL ENVIRONMENT VARIABLES</div>
                {[
                  ["ZOHO_CLIENT_ID",     "From api-console.zoho.com → your app"],
                  ["ZOHO_CLIENT_SECRET", "From api-console.zoho.com → your app"],
                  ["ZOHO_REFRESH_TOKEN", "From /api/zoho-setup after authorization"],
                  ["ZOHO_ORG_ID",        "Zoho Books → Settings → Organization Profile"],
                ].map(([k,hint])=>(
                  <div key={k} style={{display:"flex",gap:12,padding:"4px 0",borderBottom:`1px solid ${B.border}`,alignItems:"baseline"}}>
                    <span style={{color:B.orange,minWidth:200,flexShrink:0}}>{k}</span>
                    <span style={{color:B.muted,fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{hint}</span>
                  </div>
                ))}
              </div>

              {/* CRM Sync — pull contacts + deals */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${B.purple}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:2,marginBottom:12}}>SYNC FROM ZOHO CRM → REVOPS</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14,lineHeight:1.6}}>
                  Pull your Zoho CRM contacts, leads, and deals directly into the RevOps prospecting database and deal pipeline. New records only — existing ones won't be overwritten.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <div style={{background:B.surface,borderRadius:6,padding:12,border:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:4}}>Contacts + Leads</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10,lineHeight:1.5}}>Pulls all CRM Contacts and Leads into your RevOps contact database with email, phone, title, and organization.</div>
                    {crmSyncResult?.contacts!=null&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginBottom:8}}>✓ {crmSyncResult.contacts} pulled, {crmSyncResult.contactsAdded} new added</div>}
                    <OBtn sm onClick={pullCRMContacts} disabled={crmPulling==="contacts"||!status.crm} color={B.purple}>
                      {crmPulling==="contacts"?"PULLING...":"↓ PULL CONTACTS"}
                    </OBtn>
                  </div>
                  <div style={{background:B.surface,borderRadius:6,padding:12,border:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:4}}>Deals / Opportunities</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10,lineHeight:1.5}}>Pulls open Zoho CRM Deals into RevOps deal pipeline, mapped to the closest matching stage.</div>
                    {crmSyncResult?.deals!=null&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginBottom:8}}>✓ {crmSyncResult.deals} pulled, {crmSyncResult.dealsAdded} new added</div>}
                    <OBtn sm onClick={pullCRMDeals} disabled={crmPulling==="deals"||!status.crm} color={B.purple}>
                      {crmPulling==="deals"?"PULLING...":"↓ PULL DEALS"}
                    </OBtn>
                  </div>
                </div>
                {!status.crm&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,background:B.yellowBg,padding:"8px 12px",borderRadius:4}}>⚠ Connect Zoho CRM first using the test connection button above</div>}
                {(crmSyncResult?.contactsAdded||0)+(crmSyncResult?.dealsAdded||0)>0&&(
                  <div style={{marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
                    Go to RevOps → Prospecting → Contact DB to see imported contacts, or RevOps → Deals to see imported deals.
                  </div>
                )}
              </div>

              {/* Full CRM backup export — safety net before a Zoho-side wipe */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${B.red}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,letterSpacing:2,marginBottom:12}}>FULL BACKUP EXPORT — BEFORE WIPING ZOHO CRM</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14,lineHeight:1.6}}>
                  Pulls every field of every Lead, Contact, Deal, and Account out of Zoho CRM and lets you download a full JSON + CSV backup. This only reads and downloads — it doesn't delete or change anything in Zoho. Download and verify these files before using Zoho CRM's own Setup → Data Administration mass-delete/import tools to actually wipe the data.
                </div>
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <OBtn sm onClick={exportAllZohoModules} disabled={!!exportingModule||!status.crm}>
                    {exportingModule?`EXPORTING ${exportingModule.toUpperCase()}...`:"⬇ EXPORT ALL 4 MODULES"}
                  </OBtn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {EXPORT_MODULES.map(module=>{
                    const prog = exportProgress[module];
                    const records = exportResults[module];
                    const isRunning = exportingModule===module;
                    return (
                      <div key={module} style={{background:B.surface,borderRadius:6,padding:12,border:`1px solid ${B.border}`}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:6}}>{module}</div>
                        {isRunning&&prog&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,marginBottom:8}}>Page {prog.page} — {prog.records} records so far…</div>}
                        {!isRunning&&records&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginBottom:8}}>✓ {records.length} records exported</div>}
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <OBtn sm onClick={()=>exportZohoModule(module)} disabled={!!exportingModule||!status.crm} color={B.purple}>
                            {isRunning?"...":records?"↻ RE-EXPORT":"↓ EXPORT"}
                          </OBtn>
                          {records&&records.length>0&&<>
                            <OBtn sm onClick={()=>downloadExportJson(module)}>JSON</OBtn>
                            <OBtn sm onClick={()=>downloadExportCsv(module)}>CSV</OBtn>
                          </>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!status.crm&&<div style={{marginTop:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,background:B.yellowBg,padding:"8px 12px",borderRadius:4}}>⚠ Connect Zoho CRM first using the test connection button above</div>}
              </div>

              {/* Full Books backup export — just-in-case safety net, not tied to any planned wipe */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${B.red}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,letterSpacing:2,marginBottom:12}}>FULL BOOKS BACKUP EXPORT</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14,lineHeight:1.6}}>
                  Pulls every Invoice, Estimate, Bill, Customer/Vendor, Item, and Customer Payment out of Zoho Books — including full line-item detail on invoices/estimates/bills — and lets you download JSON + CSV backups. Read-only, doesn't change anything in Books. This is what you'd use to rebuild records here if anything in Books ever got deleted or corrupted.
                </div>
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <OBtn sm onClick={exportAllBooksModules} disabled={!!booksExportingModule||!status.books}>
                    {booksExportingModule?`EXPORTING ${BOOKS_MODULES.find(m=>m.key===booksExportingModule)?.label.toUpperCase()}...`:"⬇ EXPORT ALL 6 MODULES"}
                  </OBtn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {BOOKS_MODULES.map(mod=>{
                    const prog = booksExportProgress[mod.key];
                    const records = booksExportResults[mod.key];
                    const isRunning = booksExportingModule===mod.key;
                    return (
                      <div key={mod.key} style={{background:B.surface,borderRadius:6,padding:12,border:`1px solid ${B.border}`}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:6}}>{mod.label}</div>
                        {isRunning&&prog&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,marginBottom:8}}>{prog.page==="detail"?`Detail ${prog.records}/${records?.length||"?"}…`:`Page ${prog.page} — ${prog.records} records so far…`}</div>}
                        {!isRunning&&records&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginBottom:8}}>✓ {records.length} records exported</div>}
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <OBtn sm onClick={()=>exportBooksModule(mod)} disabled={!!booksExportingModule||!status.books} color={B.purple}>
                            {isRunning?"...":records?"↻ RE-EXPORT":"↓ EXPORT"}
                          </OBtn>
                          {records&&records.length>0&&<>
                            <OBtn sm onClick={()=>downloadBooksJson(mod.key)}>JSON</OBtn>
                            <OBtn sm onClick={()=>downloadBooksCsv(mod.key)}>CSV</OBtn>
                          </>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!status.books&&<div style={{marginTop:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,background:B.yellowBg,padding:"8px 12px",borderRadius:4}}>⚠ Connect Zoho Books first using the test connection button above</div>}
              </div>

              {/* "Who's been invoiced" — Account seed report for the fresh CRM */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${B.green}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green,letterSpacing:2,marginBottom:12}}>WHO'S BEEN INVOICED — ACCOUNT SEED REPORT</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14,lineHeight:1.6}}>
                  Rolls up every distinct customer with at least one invoice in Zoho Books — total invoiced, balance due, invoice count, first/last invoice date, and contact info. Read-only, doesn't touch Zoho CRM. Review this list (or the CSV) and decide who should be re-created as an Account once the fresh CRM is ready.
                </div>
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
                  <OBtn sm onClick={buildInvoicedReport} disabled={invoicedReportLoading||!status.books}>
                    {invoicedReportLoading?"BUILDING...":invoicedReport?"↻ REBUILD REPORT":"⚙ BUILD REPORT"}
                  </OBtn>
                  {invoicedReport&&invoicedReport.length>0&&<OBtn sm onClick={downloadInvoicedReportCsv}>↓ DOWNLOAD CSV</OBtn>}
                  {invoicedReportLoading&&invoicedReportStatus&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange}}>{invoicedReportStatus}</span>}
                </div>
                {!status.books&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,background:B.yellowBg,padding:"8px 12px",borderRadius:4,marginBottom:12}}>⚠ Connect Zoho Books first using the test connection button above</div>}
                {invoicedReport&&(
                  <div style={{overflowX:"auto"}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginBottom:8}}>✓ {invoicedReport.length} distinct invoiced customer(s){invoicedReport.length>100?" — showing top 100 by total invoiced, download the CSV for the full list":""}</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{background:B.surface}}>
                        {["Customer","Email","City/State","Invoices","Total Invoiced","Balance Due","Last Invoice"].map(h=>(
                          <th key={h} style={{padding:"6px 9px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,borderBottom:`2px solid ${B.border}`,fontWeight:400}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {invoicedReport.slice(0,100).map(c=>(
                          <tr key={c.customerId} style={{borderBottom:`1px solid ${B.border}`}}>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.text}}>{c.customerName}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{c.email||"—"}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{[c.city,c.state].filter(Boolean).join(", ")||"—"}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.text}}>{c.invoiceCount}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.text}}>{fmt$(c.totalInvoiced)}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:c.totalBalance>0?B.red:B.muted}}>{fmt$(c.totalBalance)}</td>
                            <td style={{padding:"6px 9px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{fmtD(c.lastInvoiceDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Live invoices table */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"11px 14px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>INVOICES — {status.books?"LIVE FROM ZOHO BOOKS":"DEMO DATA"}</div>
                  <div style={{display:"flex",gap:7}}>
                    <OBtn sm onClick={bulkCRMSync} disabled={syncing} color={B.purple}>{syncing?"SYNCING...":"SYNC ALL CRM"}</OBtn>
                    {status.books&&<OBtn sm onClick={testBooks} disabled={testing==="books"}>{testing==="books"?"...":"↻ REFRESH"}</OBtn>}
                  </div>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:B.surface}}>
                    {["Customer","Invoice","Status","Total","Balance","Due","CRM","Action"].map(h=>(
                      <th key={h} style={{padding:"7px 10px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,borderBottom:`2px solid ${B.border}`,fontWeight:400}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {invoices.map(inv=>{const st=ISC[inv.status]||{c:B.muted,bg:B.surface};return(
                      <tr key={inv.id} style={{borderBottom:`1px solid ${B.border}`,background:inv.status==="overdue"?B.redBg:B.white}}>
                        <td style={{padding:"7px 10px",fontWeight:500,color:B.text}}>{inv.customer_name}</td>
                        <td style={{padding:"7px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:.3}}>{inv.number}</td>
                        <td style={{padding:"7px 10px"}}><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:st.c,background:st.bg,padding:"2px 6px",borderRadius:3,letterSpacing:.5}}>{inv.status?.toUpperCase()}</span></td>
                        <td style={{padding:"7px 10px",fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.orange}}>{fmt$(inv.total)}</td>
                        <td style={{padding:"7px 10px",fontWeight:500,color:inv.balance>0?B.red:B.green}}>{fmt$(inv.balance)}</td>
                        <td style={{padding:"7px 10px",color:B.muted,fontSize:10}}>{fmtD(inv.due_date)}</td>
                        <td style={{padding:"7px 10px"}}>
                          {inv.crm_synced
                            ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>✓ CUSTOMER</span>
                            :<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.yellow,background:B.yellowBg,padding:"2px 5px",borderRadius:3}}>PROSPECT</span>}
                        </td>
                        <td style={{padding:"7px 10px"}}>
                          {!inv.crm_synced&&["sent","viewed","partial","paid"].includes(inv.status)&&(
                            <button onClick={()=>tagCRMCustomer(inv)} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.3}}>TAG</button>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── MARKETING ── */}
          {tab==="marketing"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>MARKETING AUTOMATION</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>Zoho Campaigns for email · Zoho Social for publishing · Cold lead nurture automation</div>
                <div style={{width:32,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
              </div>

              {/* ── COLD LEAD AUTOMATION ──────────────────────────────────── */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`4px solid ${B.blue}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>COLD LEAD NURTURE</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>
                      Contacts with score &lt; 25 AND inactive &gt; 30 days are automatically identified and synced to Zoho Campaigns for promotional email nurturing.
                    </div>
                  </div>
                  {(()=>{
                    try {
                      const store = readAppState();
                      const contacts = Array.isArray(store.contacts) ? store.contacts : [];
                      const now = Date.now();
                      const cold = contacts.filter(c => {
                        if (!c.email) return false;
                        const isColdScore = (c.score||0) < 25;
                        const lastAct = c.activity?.length ? Math.max(...c.activity.map(a=>new Date(a.ts||a.date||0).getTime())) : 0;
                        return isColdScore && (!lastAct || now-lastAct > 30*24*60*60*1000);
                      });
                      return cold.length > 0 ? (
                        <div style={{background:B.blueBg,border:`1px solid ${B.blue}30`,borderRadius:6,padding:"8px 14px",textAlign:"center",flexShrink:0}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:B.blue}}>{cold.length}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1}}>COLD LEADS</div>
                        </div>
                      ) : null;
                    } catch { return null; }
                  })()}
                </div>

                {/* List selector */}
                <div style={{background:B.surface,borderRadius:6,padding:12,marginBottom:12,border:`1px solid ${B.border}`}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>TARGET MAILING LIST</div>
                  {mailingLists.length > 0 ? (
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <select
                        value={coldLeadListKey}
                        onChange={e=>{setColdLeadListKey(e.target.value);try{localStorage.setItem("st1_cold_lead_listkey",e.target.value);}catch{}}}
                        style={{flex:1,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:11}}
                      >
                        <option value="">— Select a list —</option>
                        {mailingLists.map(l=>(
                          <option key={l.listkey} value={l.listkey}>{l.listname} ({l.subscribers} subscribers)</option>
                        ))}
                      </select>
                      <button onClick={loadMailingLists} disabled={campaignsLoading} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"7px 10px",fontSize:10,cursor:"pointer"}}>↻</button>
                    </div>
                  ) : (
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <input
                        value={newListName}
                        onChange={e=>setNewListName(e.target.value)}
                        style={{flex:1,minWidth:200,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}
                      />
                      <button onClick={createColdLeadList} disabled={campaignCreating||!status.campaigns} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>
                        {campaignCreating?"CREATING...":"+ CREATE LIST"}
                      </button>
                      {status.campaigns && (
                        <button onClick={loadMailingLists} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"7px 10px",fontSize:10,cursor:"pointer"}}>LOAD EXISTING</button>
                      )}
                    </div>
                  )}
                  {!status.campaigns && (
                    <div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.yellow,background:B.yellowBg,padding:"6px 10px",borderRadius:4}}>
                      ⚠ Connect Zoho Campaigns below first
                    </div>
                  )}
                </div>

                {/* What counts as cold */}
                <div style={{background:`${B.blue}08`,border:`1px solid ${B.blue}20`,borderRadius:5,padding:"10px 12px",marginBottom:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1.5,marginBottom:6}}>COLD LEAD CRITERIA</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {[
                      ["Score < 25","No recent engagement — cold by our scoring algorithm"],
                      ["No activity > 30 days","Last email/call/meeting was over 30 days ago"],
                      ["Has email address","Required for email nurturing"],
                    ].map(([label,desc])=>(
                      <div key={label} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                        <span style={{color:B.blue,fontSize:12,flexShrink:0}}>✓</span>
                        <div>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{label}</span>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginLeft:6}}>{desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sync button + result */}
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <button
                    onClick={syncColdLeadsNow}
                    disabled={coldLeadSyncing || !status.campaigns || !coldLeadListKey}
                    style={{background:B.blue,color:B.white,border:"none",borderRadius:5,padding:"9px 18px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}
                  >
                    {coldLeadSyncing?"⟳ SYNCING...":"⟳ SYNC COLD LEADS NOW"}
                  </button>
                  {coldLeadSyncResult && !coldLeadSyncResult.error && (
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>
                      ✓ {coldLeadSyncResult.msg}
                    </div>
                  )}
                  {coldLeadSyncResult?.error && (
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
                      ✗ {coldLeadSyncResult.error.slice(0,100)}
                    </div>
                  )}
                </div>

                {/* Nurture strategy tip */}
                <div style={{marginTop:14,background:B.orangeBg,border:`1px solid ${B.orange}30`,borderRadius:5,padding:"10px 12px"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1.5,marginBottom:5}}>NURTURE STRATEGY — RECOMMENDED</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.7}}>
                    Once cold leads are in Zoho Campaigns, set up an <strong>Autoresponder</strong> series in Zoho Campaigns → Automation → Autoresponder:
                  </div>
                  <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
                    {[
                      "Day 1 — Welcome + top products catalog",
                      "Day 5 — Sport-specific spotlight (hurdles, starting blocks, etc.)",
                      "Day 14 — Limited-time promo code or bundle offer",
                      "Day 30 — Re-engagement: 'Still interested? Here's what's new'",
                      "Day 60 — Final: 'Save 10% — we'd love to earn your business'",
                    ].map((s,i)=>(
                      <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,display:"flex",gap:6}}>
                        <span style={{color:B.orange,flexShrink:0}}>→</span>{s}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── ZOHO CAMPAIGNS ──────────────────────────────────────────── */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`4px solid #E42527`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>ZOHO CAMPAIGNS</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>Email marketing, mailing lists, subscriber management</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {status.campaigns
                      ? <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"3px 8px",borderRadius:3}}>✓ CONNECTED</span>
                      : <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,padding:"3px 8px",borderRadius:3}}>NOT CONNECTED</span>}
                    <button onClick={testCampaigns} disabled={testing==="campaigns"} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                      {testing==="campaigns"?"TESTING...":"TEST CONNECTION"}
                    </button>
                  </div>
                </div>

                {/* Scope reminder */}
                {!status.campaigns && (
                  <div style={{background:B.yellowBg,border:`1px solid ${B.yellow}40`,borderRadius:5,padding:"10px 12px",marginBottom:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
                    <strong>Setup:</strong> Re-run <a href="/api/zoho-setup" style={{color:B.blue}}>/api/zoho-setup</a> to authorize the new <code>ZohoCampaigns.campaign.ALL</code> and <code>ZohoCampaigns.contact.ALL</code> scopes. Your existing token doesn't include them yet.
                  </div>
                )}

                {/* Mailing lists */}
                {status.campaigns && (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2}}>MAILING LISTS ({mailingLists.length})</div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={loadMailingLists} disabled={campaignsLoading} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:3,padding:"4px 9px",fontSize:9,cursor:"pointer"}}>
                          {campaignsLoading?"...":"↻ REFRESH"}
                        </button>
                        <button onClick={loadEmailCampaigns} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:3,padding:"4px 9px",fontSize:9,cursor:"pointer"}}>LOAD CAMPAIGNS</button>
                      </div>
                    </div>
                    {mailingLists.length === 0 ? (
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px 0"}}>No mailing lists yet. Create one above or click Refresh.</div>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8,marginBottom:12}}>
                        {mailingLists.map(l=>(
                          <div key={l.listkey} style={{background:B.surface,border:`1px solid ${coldLeadListKey===l.listkey?B.orange:B.border}`,borderRadius:6,padding:"10px 12px"}}>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{l.listname}</div>
                            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.orange}}>{l.subscribers.toLocaleString()}</div>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:6}}>SUBSCRIBERS</div>
                            <button onClick={()=>{setColdLeadListKey(l.listkey);try{localStorage.setItem("st1_cold_lead_listkey",l.listkey);}catch{};}} style={{background:coldLeadListKey===l.listkey?B.orange:B.surface,color:coldLeadListKey===l.listkey?B.white:B.muted,border:`1px solid ${coldLeadListKey===l.listkey?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>
                              {coldLeadListKey===l.listkey?"✓ COLD LEAD LIST":"USE FOR COLD LEADS"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Email campaigns */}
                    {zohoEmailCampaigns.length > 0 && (
                      <div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8,marginTop:12}}>RECENT EMAIL CAMPAIGNS</div>
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead>
                              <tr style={{background:B.surface}}>
                                {["Campaign","Status","Sent","Opens","Clicks"].map(h=>(
                                  <th key={h} style={{padding:"6px 10px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,borderBottom:`2px solid ${B.border}`,fontWeight:400}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {zohoEmailCampaigns.map(c=>(
                                <tr key={c.campaignkey} style={{borderBottom:`1px solid ${B.border}`}}>
                                  <td style={{padding:"7px 10px",fontFamily:"'Lexend',sans-serif",color:B.text,fontWeight:500}}>{c.campaignname}</td>
                                  <td style={{padding:"7px 10px"}}><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c.status==="Sent"?B.green:B.yellow,background:c.status==="Sent"?B.greenBg:B.yellowBg,padding:"2px 6px",borderRadius:3}}>{c.status}</span></td>
                                  <td style={{padding:"7px 10px",fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.text}}>{c.sent.toLocaleString()}</td>
                                  <td style={{padding:"7px 10px",color:B.blue}}>{c.opens.toLocaleString()}</td>
                                  <td style={{padding:"7px 10px",color:B.green}}>{c.clicks.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── INSTANTLY.AI ────────────────────────────────────────────── */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:"4px solid #FF4A00"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>INSTANTLY.AI</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>Cold email sequences · automated follow-ups · inbox rotation</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {instStatus?.ok
                      ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"3px 8px",borderRadius:3}}>✓ CONNECTED</span>
                      :<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,padding:"3px 8px",borderRadius:3}}>NOT TESTED</span>}
                    <button onClick={testInstantly} disabled={testing==="instantly"}
                      style={{background:"#FF4A00",color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                      {testing==="instantly"?"TESTING...":"TEST CONNECTION"}
                    </button>
                  </div>
                </div>

                <div style={{background:B.surface,borderRadius:6,padding:12,marginBottom:12,border:`1px solid ${B.border}`}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>VERCEL ENVIRONMENT VARIABLES</div>
                  {[
                    ["INSTANTLY_API_KEY","Your API key — Instantly → Settings → API Keys"],
                    ["INSTANTLY_DEFAULT_CAMPAIGN_ID","ID of default nurture campaign to add leads to (optional)"],
                  ].map(([k,hint])=>(
                    <div key={k} style={{display:"flex",gap:12,padding:"4px 0",borderBottom:`1px solid ${B.border}`,alignItems:"baseline"}}>
                      <span style={{fontFamily:"monospace",fontSize:10,color:"#FF4A00",minWidth:250,flexShrink:0}}>{k}</span>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{hint}</span>
                    </div>
                  ))}
                </div>

                {instStatus?.ok&&instCampaigns.length>0&&(
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>ACTIVE CAMPAIGNS ({instCampaigns.length})</div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {instCampaigns.slice(0,6).map((c,i)=>(
                        <div key={c.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:B.surface,borderRadius:5,padding:"7px 11px",border:`1px solid ${B.border}`}}>
                          <div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.name||c.campaign_name||`Campaign ${i+1}`}</div>
                            <div style={{fontFamily:"monospace",fontSize:9,color:B.muted,marginTop:1}}>{c.id}</div>
                          </div>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c.status==="active"?B.green:B.muted,background:c.status==="active"?B.greenBg:B.surface,padding:"2px 7px",borderRadius:3,border:`1px solid ${B.border}`}}>{(c.status||"—").toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
                      Use campaign IDs above as <code style={{background:"#f0f0f0",padding:"1px 4px",borderRadius:2}}>INSTANTLY_DEFAULT_CAMPAIGN_ID</code> or pass them directly from RevOps outreach flows.
                    </div>
                  </div>
                )}

                {instStatus?.ok===false&&(
                  <div style={{background:B.redBg,border:`1px solid ${B.red}40`,borderRadius:5,padding:"9px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
                    ✗ {instStatus.error}
                  </div>
                )}

                <div style={{marginTop:12,background:B.orangeBg,border:`1px solid ${B.orange}30`,borderRadius:5,padding:"10px 12px"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1.5,marginBottom:5}}>HOW IT'S USED IN REVOPS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6}}>
                    <div>→ <strong>Batch Outreach</strong>: ⚡ ADD TO INSTANTLY button adds selected contacts to the default campaign</div>
                    <div>→ <strong>AI Agent</strong>: When agent suggests "add to nurture", it calls Instantly to enroll the lead</div>
                    <div>→ <strong>CRM module</strong>: Add lead to Instantly directly from contact record via agent action</div>
                  </div>
                </div>
              </div>

              {/* ── SOCIAL PUBLISHING (Ayrshare) ────────────────────────────── */}
              <AyrsharePanel addLog={addLog}/>

            </div>
          )}

          {/* ── EMAIL SCANNER ── */}
          {tab==="email"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>EMAIL SCANNER</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>AI scans your inbox for orders, quotes, and RFQs — creates deals automatically</div>
                <div style={{width:32,height:3,background:"#EA4335",marginTop:7,borderRadius:2}}/>
              </div>

              {/* Gmail setup card */}
              <ConnCard id="gmail" title="Gmail" sub="Read-only inbox access via OAuth" color="#EA4335" icon="📬" connected={gmailStatus}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:10}}>
                  {gmailStatus
                    ? "Gmail is connected. ST1 RevOps can read your inbox to find order and quote emails."
                    : "Connect Gmail to let ST1 RevOps scan for customer orders, quote requests, and RFQs."}
                </div>
                {!gmailStatus&&(
                  <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:12,marginBottom:10,fontSize:11}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>ONE-TIME SETUP</div>
                    {[
                      ["1","Go to console.cloud.google.com → create or select a project"],
                      ["2","Enable Gmail API: APIs & Services → Library → search Gmail → Enable"],
                      ["3","Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application"],
                      ["4","Add Authorized Redirect URI: https://YOUR-VERCEL-DOMAIN/api/gmail-setup"],
                      ["5","Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to Vercel env vars"],
                      ["6","Visit /api/gmail-setup on your deployed app and click Connect Gmail"],
                      ["7","Copy GMAIL_REFRESH_TOKEN into Vercel env vars, then redeploy"],
                    ].map(([n,step])=>(
                      <div key={n} style={{display:"flex",gap:9,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                        <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,minWidth:16,flexShrink:0}}>{n}</span>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.5}}>{step}</span>
                      </div>
                    ))}
                    <div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
                      For OAuth consent screen: set to "Internal" (Google Workspace) or "External" and add your email as a test user.
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <OBtn onClick={testGmail} disabled={testing==="gmail"} color="#EA4335">
                    {testing==="gmail"?"TESTING...":gmailStatus?"✓ RECONNECT":"TEST CONNECTION"}
                  </OBtn>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
                    Env vars needed: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
                  </div>
                </div>
              </ConnCard>

              {/* Scanner controls */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginTop:14,borderLeft:`3px solid #EA4335`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:"#EA4335",letterSpacing:2,marginBottom:12}}>SCAN INBOX FOR OPPORTUNITIES</div>
                <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"flex-end"}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>GMAIL SEARCH QUERY</div>
                    <input value={emailQuery} onChange={e=>setEmailQuery(e.target.value)}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,fontFamily:"monospace"}}/>
                  </div>
                  <OBtn onClick={scanEmailInbox} disabled={emailScanning||!gmailStatus} color="#EA4335" style={{flexShrink:0}}>
                    {emailScanning?"SCANNING...":"SCAN INBOX"}
                  </OBtn>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {["newer_than:14d category:primary -from:me","subject:(quote OR RFQ OR order OR PO) newer_than:30d","from:(@k12 OR @school OR @district) newer_than:14d"].map(q=>(
                    <button key={q} onClick={()=>setEmailQuery(q)}
                      style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 8px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>
                      {q.slice(0,30)}...
                    </button>
                  ))}
                </div>
                {!gmailStatus&&(
                  <div style={{marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,background:B.yellowBg,padding:"8px 12px",borderRadius:4}}>
                    ⚠ Connect Gmail first using the setup card above
                  </div>
                )}
              </div>

              {/* Results */}
              {emailScanning&&(
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:24,marginTop:14,textAlign:"center"}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.muted,marginBottom:6}}>SCANNING INBOX...</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
                    {emailMessages.length>0?`Fetched ${emailMessages.length} emails — analyzing with AI...`:"Fetching emails from Gmail..."}
                  </div>
                </div>
              )}

              {!emailScanning&&emailOpps.length>0&&(
                <div style={{marginTop:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>
                      {emailOpps.length} OPPORTUNIT{emailOpps.length===1?"Y":"IES"} FOUND
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
                      from {emailMessages.length} emails scanned
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {emailOpps.map((opp,i)=>{
                      const confColor=opp.confidence==="high"?B.green:opp.confidence==="medium"?B.yellow:B.muted;
                      const confBg=opp.confidence==="high"?B.greenBg:opp.confidence==="medium"?B.yellowBg:B.surface;
                      return(
                        <div key={opp.emailId||i} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:14,borderLeft:`3px solid ${confColor}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:confColor,background:confBg,padding:"2px 7px",borderRadius:10,letterSpacing:.5}}>
                                  {opp.confidence?.toUpperCase()||"MEDIUM"} CONFIDENCE
                                </span>
                                {opp.estimatedValue&&(
                                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.orange}}>{fmt$(opp.estimatedValue)}</span>
                                )}
                              </div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500,marginBottom:2}}>{opp.dealName||opp.org||"Untitled Lead"}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:4}}>{opp.from}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,fontStyle:"italic"}}>{opp.summary}</div>
                              {opp.product&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>Product/service: {opp.product}</div>}
                            </div>
                            <div style={{flexShrink:0,marginLeft:12}}>
                              {opp.created
                                ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"4px 8px",borderRadius:4,display:"block",textAlign:"center"}}>✓ DEAL CREATED</span>
                                :<OBtn sm onClick={()=>createDealFromEmail(opp)} color="#EA4335">CREATE DEAL</OBtn>
                              }
                            </div>
                          </div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,background:B.surface,borderRadius:4,padding:"5px 8px"}}>
                            Subject: {opp.subject}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center"}}>
                    Created deals appear in RevOps → Deal Manager
                  </div>
                </div>
              )}

              {!emailScanning&&emailMessages.length>0&&emailOpps.length===0&&(
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:24,marginTop:14,textAlign:"center"}}>
                  <div style={{fontSize:28,marginBottom:8}}>✓</div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.muted,marginBottom:4}}>NO OPPORTUNITIES DETECTED</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Scanned {emailMessages.length} emails — no order or quote requests found matching the criteria.</div>
                </div>
              )}

              {!emailScanning&&emailMessages.length===0&&!gmailStatus&&(
                <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:8,padding:32,marginTop:14,textAlign:"center"}}>
                  <div style={{fontSize:36,marginBottom:12}}>📬</div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.muted,marginBottom:6}}>CONNECT GMAIL TO GET STARTED</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,maxWidth:360,margin:"0 auto"}}>
                    Once connected, ST1 RevOps will scan your inbox with AI and automatically identify quote requests, purchase orders, and sales opportunities — turning them into deals in one click.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SHOPIFY ── */}
          {tab==="shopify"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>SHOPIFY</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>products, pricing, inventory, orders</div>
                <div style={{width:32,height:3,background:"#95BF47",marginTop:7,borderRadius:2}}/>
              </div>

              <ConnCard id="shopify" title="Shopify Admin API" sub="server-side proxy — credentials never touch the browser" color="#95BF47" icon="🛍️" connected={status.shopify}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10,lineHeight:1.6}}>
                  Add to Vercel env vars: <code style={{background:"#f0f0f0",padding:"2px 6px",borderRadius:3,fontFamily:"monospace"}}>SHOPIFY_STORE_URL</code> (e.g. your-store.myshopify.com)
                  and <code style={{background:"#f0f0f0",padding:"2px 6px",borderRadius:3,fontFamily:"monospace"}}>SHOPIFY_ACCESS_TOKEN</code> (from
                  Shopify admin → Settings → Apps and sales channels → Develop apps → create an app → Admin API access token, with read/write access to Products and Orders).
                </div>
                <OBtn onClick={testShopify} disabled={testing==="shopify"} style={{width:"100%"}}>
                  {testing==="shopify"?"CONNECTING...":status.shopify?"✓ RECONNECT":"TEST CONNECTION"}
                </OBtn>
              </ConnCard>

              {/* Products table */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,overflow:"hidden",marginTop:14}}>
                <div style={{padding:"11px 14px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>PRODUCTS — {status.shopify?"LIVE FROM SHOPIFY":"DEMO DATA"}</div>
                  {status.shopify&&<OBtn sm onClick={async()=>{
                    try{
                      const d=await shopifyAPI("/products.json?limit=10");
                      const prods=d.products||[];
                      setProducts(prods.map(p=>({
                        id:p.id,variantId:p.variants?.[0]?.id,sku:p.variants?.[0]?.sku||"",name:p.title,
                        categories:p.product_type?[{name:p.product_type}]:[],
                        price:p.variants?.[0]?.price||"0.00",
                        stock_quantity:p.variants?.reduce((s,v)=>s+(v.inventory_quantity||0),0),
                        stock_status:p.variants?.some(v=>(v.inventory_quantity||0)>0)?"instock":"outofstock",
                      })));
                      addLog(`Refreshed ${prods.length} products`,"success");
                    }catch(e){addLog("Refresh error: "+e.message.slice(0,50),"error");}
                  }}>↻ REFRESH</OBtn>}
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:B.surface}}>
                    {["SKU","Product","Category","Price","Stock","Status","Update Price"].map(h=>(
                      <th key={h} style={{padding:"7px 10px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,borderBottom:`2px solid ${B.border}`,fontWeight:400}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {products.map(p=>(
                      <tr key={p.id} style={{borderBottom:`1px solid ${B.border}`,background:p.stock_status==="outofstock"?B.yellowBg:B.white}}>
                        <td style={{padding:"7px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:.3}}>{p.sku}</td>
                        <td style={{padding:"7px 10px",fontWeight:500,color:B.text,maxWidth:180}}>{p.name}</td>
                        <td style={{padding:"7px 10px",color:B.muted,fontSize:10}}>{p.categories?.[0]?.name||"—"}</td>
                        <td style={{padding:"7px 10px",fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.orange}}>{fmt$(p.price)}</td>
                        <td style={{padding:"7px 10px",color:B.muted}}>{p.stock_quantity??"—"}</td>
                        <td style={{padding:"7px 10px"}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:p.stock_status==="instock"?B.green:B.yellow,background:p.stock_status==="instock"?B.greenBg:B.yellowBg,padding:"2px 6px",borderRadius:3,letterSpacing:.5}}>
                            {p.stock_status==="instock"?"IN STOCK":"OUT OF STOCK"}
                          </span>
                        </td>
                        <td style={{padding:"7px 10px"}}>
                          <PriceEditor product={p} onSave={newPrice=>updateShopifyPrice(p.id,p.variantId,newPrice)}/>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {products.length===0&&<div style={{padding:"30px 0",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Connect Shopify to see products</div>}
              </div>

              {/* Recent orders */}
              {shopifyOrders.length>0&&(
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,marginTop:14}}>
                  <div style={{padding:"11px 14px",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>RECENT ORDERS</div>
                  </div>
                  {shopifyOrders.slice(0,5).map(o=>(
                    <div key={o.id} style={{padding:"9px 14px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{o.customer?.first_name||o.billing_address?.first_name} {o.customer?.last_name||o.billing_address?.last_name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>#{o.order_number||o.id} · {fmtD(o.created_at)}</div></div>
                      <div style={{textAlign:"right"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(o.total_price)}</div><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>{(o.financial_status||"").toUpperCase()}{o.fulfillment_status?` · ${o.fulfillment_status.toUpperCase()}`:""}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ADS ── */}
          {tab==="ads"&&<AdsTab
            adsStatus={adsStatus} adsLoading={adsLoading} loadAdsStatus={loadAdsStatus}
            lsEmbedUrl={lsEmbedUrl} setLsEmbedUrl={v=>{setLsEmbedUrl(v);try{localStorage.setItem("st1_ls_embed",v);}catch{}}}
            adLinks={adLinks} setAdLinks={v=>{setAdLinks(v);try{localStorage.setItem("st1_ad_links",JSON.stringify(v));}catch{}}}
            adMetrics={adMetrics} setAdMetrics={v=>{setAdMetrics(v);try{localStorage.setItem("st1_ad_metrics",JSON.stringify(v));}catch{}}}
            B={B} OBtn={OBtn}
          />}

          {/* ── AI TOOLS ── */}
          {tab==="tools"&&(
            <div className="fu">
              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>AI TOOL MANAGER</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:3}}>Enable or disable built-in AI plugins and register custom tools</div>
                <div style={{width:32,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
              </div>
              <ToolManager/>
            </div>
          )}

          {/* ── AI KNOWLEDGE ── */}
          {tab==="knowledge"&&(
            <div className="fu">
              <AiKnowledgeHub embedded />
            </div>
          )}

          {/* ── LOG ── */}
          {tab==="log"&&(
            <div className="fu">
              <div style={{marginBottom:16}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>ACTIVITY LOG</div>
                <div style={{width:32,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
              </div>
              {log.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>Activity will appear here as integrations are used</div>}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {log.map(l=>(
                  <div key={l.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 12px",borderLeft:`3px solid ${logColor[l.type]||B.muted}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>{l.msg}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{new Date(l.ts).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{background:B.white,borderLeft:`1px solid ${B.border}`,padding:"16px",overflowY:"auto"}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:10}}>LIVE STATUS</div>
          {[
            {l:"Slack",        c:"#4A154B",desc:"MCP connected",          ok:status.slack},
            {l:"Zoho Books",   c:B.red,   desc:"Invoice & AR data",       ok:status.books},
            {l:"Zoho CRM",     c:B.red,   desc:"Contact sync",            ok:status.crm},
            {l:"Campaigns",    c:B.red,   desc:"Email lists",             ok:status.campaigns},
            {l:"Instantly",    c:"#FF4A00",desc:"Nurture sequences",       ok:instStatus?.ok},
            {l:"Meta Ads",     c:"#1877F2",desc:"Facebook/Instagram ads", ok:adsStatus.meta?.status==="connected"},
            {l:"Google Ads",   c:"#4285F4",desc:"Search & Display ads",   ok:adsStatus.google?.status==="connected"},
            {l:"LinkedIn Ads", c:"#0A66C2",desc:"B2B ad targeting",       ok:adsStatus.linkedin?.status==="connected"},
            {l:"TikTok Ads",   c:"#010101",desc:"Video ad campaigns",     ok:adsStatus.tiktok?.status==="connected"},
            {l:"GA4",          c:"#E37400",desc:"Analytics & attribution", ok:adsStatus.ga4?.status==="connected"},
            {l:"Shopify",      c:"#95BF47",desc:"Products & orders",      ok:status.shopify},
          ].map(k=>(
            <div key={k.l} style={{padding:"8px 0",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{k.l}</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{k.desc}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:k.ok?B.green:B.muted}}/>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:k.ok?B.green:B.muted,letterSpacing:.5}}>{k.ok?"LIVE":"OFF"}</span>
              </div>
            </div>
          ))}

          <div style={{marginTop:16,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:10}}>AR SNAPSHOT</div>
          {[
            {l:"Total AR",    v:fmt$(invoices.filter(i=>!["paid","draft"].includes(i.status)).reduce((s,i)=>s+(i.balance||0),0)), c:B.orange},
            {l:"Overdue",     v:fmt$(invoices.filter(i=>i.status==="overdue").reduce((s,i)=>s+(i.balance||0),0)), c:B.red},
            {l:"CRM Pending", v:invoices.filter(i=>["sent","viewed","partial","paid"].includes(i.status)&&!i.crm_synced).length, c:B.purple},
          ].map(k=>(
            <div key={k.l} style={{padding:"6px 0",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between"}}>
              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{k.l}</span>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:k.c}}>{k.v}</span>
            </div>
          ))}

          <div style={{marginTop:16,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>ACTIVITY LOG</div>
          {log.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Activity appears here...</div>}
          {log.slice(0,12).map(l=>(
            <div key={l.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:logColor[l.type]||B.muted,lineHeight:1.9,borderBottom:`1px solid ${B.border}11`,padding:"1px 0"}}>
              <span style={{color:B.gray2,marginRight:4}}>{new Date(l.ts).toLocaleTimeString()}</span>{l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AD PLATFORMS TAB ────────────────────────────────────────────────────────
function AdsTab({adsStatus,adsLoading,loadAdsStatus,lsEmbedUrl,setLsEmbedUrl,adLinks,setAdLinks,adMetrics,setAdMetrics,B,OBtn}) {
  const PLATFORMS = [
    {key:"meta",     label:"Meta Ads",       icon:"📘", color:"#1877F2", defaultUrl:"https://adsmanager.facebook.com/adsmanager/reporting/view", desc:"Facebook & Instagram"},
    {key:"google",   label:"Google Ads",     icon:"🔍", color:"#4285F4", defaultUrl:"https://ads.google.com/aw/overview", desc:"Search, Display, Shopping"},
    {key:"linkedin", label:"LinkedIn Ads",   icon:"💼", color:"#0A66C2", defaultUrl:"https://www.linkedin.com/campaignmanager/", desc:"B2B audience targeting"},
    {key:"tiktok",   label:"TikTok Ads",     icon:"🎵", color:"#010101", defaultUrl:"https://ads.tiktok.com/i18n/dashboard", desc:"Short-form video ads"},
    {key:"microsoft",label:"Microsoft Ads",  icon:"🔷", color:"#00A4EF", defaultUrl:"https://ui.ads.microsoft.com/campaign/vnext/overview", desc:"Bing Search"},
    {key:"ga4",      label:"Google Analytics",icon:"📊",color:"#E37400", defaultUrl:"https://analytics.google.com/", desc:"Website analytics & attribution"},
  ];
  const METRIC_FIELDS = [
    {k:"spend",  label:"Spend",   prefix:"$", suffix:""},
    {k:"roas",   label:"ROAS",    prefix:"",  suffix:"x"},
    {k:"leads",  label:"Leads",   prefix:"",  suffix:""},
    {k:"clicks", label:"Clicks",  prefix:"",  suffix:""},
  ];
  const [editMetrics, setEditMetrics] = useState(null);
  const [apiOpen, setApiOpen]         = useState(false);

  const API_VARS = [
    {key:"meta",      color:"#1877F2", vars:["META_ACCESS_TOKEN","META_AD_ACCOUNT_ID"], note:"Requires Meta developer app + System User. See developers.facebook.com."},
    {key:"google",    color:"#4285F4", vars:["GOOGLE_ADS_CLIENT_ID","GOOGLE_ADS_CLIENT_SECRET","GOOGLE_ADS_REFRESH_TOKEN","GOOGLE_ADS_DEVELOPER_TOKEN","GOOGLE_ADS_CUSTOMER_ID"], note:"Apply for developer token at ads.google.com → Tools → API Center."},
    {key:"linkedin",  color:"#0A66C2", vars:["LINKEDIN_ACCESS_TOKEN","LINKEDIN_AD_ACCOUNT_ID"], note:"Create LinkedIn Marketing Developer Platform app at developer.linkedin.com."},
    {key:"tiktok",    color:"#010101", vars:["TIKTOK_ACCESS_TOKEN","TIKTOK_ADVERTISER_ID"], note:"Create TikTok for Business app at ads.tiktok.com → Tools → Developer Portal."},
    {key:"microsoft", color:"#00A4EF", vars:["MICROSOFT_ADS_CLIENT_ID","MICROSOFT_ADS_CLIENT_SECRET","MICROSOFT_ADS_REFRESH_TOKEN","MICROSOFT_ADS_DEVELOPER_TOKEN","MICROSOFT_ADS_CUSTOMER_ID","MICROSOFT_ADS_ACCOUNT_ID"], note:"Register app at apps.dev.microsoft.com; request developer token at ads.microsoft.com."},
    {key:"ga4",       color:"#E37400", vars:["GA4_PROPERTY_ID","GOOGLE_ANALYTICS_REFRESH_TOKEN"], note:"Enable Analytics Data API in console.cloud.google.com. Reuses Google Ads OAuth creds if already set."},
  ];

  return (
    <div className="fu">
      <div style={{marginBottom:20}}>
        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>AD PLATFORMS</div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>Quick access to your ad dashboards · report embed · manual KPI tracking</div>
        <div style={{width:32,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
      </div>

      {/* ── SECTION 1: PLATFORM QUICK LINKS ── */}
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>QUICK LINKS — OPEN YOUR AD DASHBOARDS</div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14,lineHeight:1.6}}>
          Paste in your account-specific URLs (or use the defaults). Opens the platform's native reporting in a new tab — no API setup needed.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
          {PLATFORMS.map(p=>{
            const apiOk = adsStatus[p.key]?.status==="connected";
            const url = adLinks[p.key]||p.defaultUrl;
            return (
              <div key={p.key} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:16}}>{p.icon}</span>
                    <div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{p.label}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{p.desc}</div>
                    </div>
                  </div>
                  {apiOk&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:8,flexShrink:0}}>API ✓</span>}
                </div>
                <input
                  value={adLinks[p.key]||""}
                  onChange={e=>setAdLinks({...adLinks,[p.key]:e.target.value})}
                  placeholder={p.defaultUrl}
                  style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:10,fontFamily:"monospace",marginBottom:8}}
                />
                <a href={url} target="_blank" rel="noreferrer"
                  style={{display:"block",background:p.color,color:"#fff",textDecoration:"none",textAlign:"center",borderRadius:4,padding:"6px 0",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>
                  OPEN {p.label.toUpperCase()} →
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION 2: LOOKER STUDIO EMBED ── */}
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:"4px solid #4285F4"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>LOOKER STUDIO REPORT EMBED</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>Free · No developer account needed · Connects Meta, Google, LinkedIn and more via built-in connectors</div>
          </div>
          <a href="https://lookerstudio.google.com" target="_blank" rel="noreferrer"
            style={{background:B.surface,color:B.blue,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,textDecoration:"none",flexShrink:0}}>
            OPEN LOOKER STUDIO ↗
          </a>
        </div>

        <div style={{background:B.blueBg,border:`1px solid ${B.blue}30`,borderRadius:5,padding:"10px 12px",marginBottom:12}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1.5,marginBottom:5}}>WHY LOOKER STUDIO</div>
          <div style={{display:"flex",flexDirection:"column",gap:3,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6}}>
            <div>→ <strong>No developer app needed</strong> — connects with your normal Google/Meta/LinkedIn login</div>
            <div>→ Free Google product — create reports that pull live data from every ad platform</div>
            <div>→ Paste the share URL below and the report embeds directly here</div>
          </div>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>LOOKER STUDIO REPORT EMBED URL</div>
          <div style={{display:"flex",gap:8}}>
            <input
              value={lsEmbedUrl}
              onChange={e=>setLsEmbedUrl(e.target.value)}
              placeholder="https://lookerstudio.google.com/embed/reporting/XXXXXXXX/page/XXXXXXXX"
              style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:11,fontFamily:"monospace"}}
            />
            {lsEmbedUrl&&<button onClick={()=>setLsEmbedUrl("")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"0 10px",fontSize:11,cursor:"pointer"}}>✕</button>}
          </div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>
            In Looker Studio: File → Share → Embed report → copy the <code style={{background:"#f0f0f0",padding:"1px 4px",borderRadius:2}}>src</code> URL from the iframe code
          </div>
        </div>

        {lsEmbedUrl ? (
          <div style={{borderRadius:6,overflow:"hidden",border:`1px solid ${B.border}`,background:B.surface}}>
            <iframe src={lsEmbedUrl} width="100%" height="600" frameBorder="0" allowFullScreen
              style={{display:"block"}}
              sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/>
          </div>
        ) : (
          <div style={{background:B.surface,borderRadius:6,padding:"30px 0",textAlign:"center",border:`1px solid ${B.border}`}}>
            <div style={{fontSize:28,marginBottom:8}}>📊</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Paste your Looker Studio embed URL above to show the report here</div>
          </div>
        )}
      </div>

      {/* ── SECTION 3: MANUAL KPI TRACKING ── */}
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:4}}>MANUAL KPI TRACKING</div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:14}}>
          Copy numbers from each platform and paste them here for a quick weekly snapshot.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {PLATFORMS.filter(p=>p.key!=="ga4").map(p=>{
            const m = adMetrics[p.key]||{};
            const isEditing = editMetrics===p.key;
            return (
              <div key={p.key} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isEditing?10:0}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span>{p.icon}</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{p.label}</span>
                  </div>
                  {!isEditing&&(
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      {METRIC_FIELDS.filter(f=>m[f.k]).map(f=>(
                        <div key={f.k} style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:p.color}}>{f.prefix}{m[f.k]}{f.suffix}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>{f.label.toUpperCase()}</div>
                        </div>
                      ))}
                      <button onClick={()=>setEditMetrics(p.key)}
                        style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 9px",fontSize:10,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700}}>
                        {Object.keys(m).length?"EDIT":"+ ADD"}
                      </button>
                    </div>
                  )}
                </div>
                {isEditing&&(
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
                      {METRIC_FIELDS.map(f=>(
                        <div key={f.k}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1.5,marginBottom:3}}>{f.label.toUpperCase()}</div>
                          <input
                            value={m[f.k]||""}
                            onChange={e=>setAdMetrics({...adMetrics,[p.key]:{...m,[f.k]:e.target.value}})}
                            placeholder={f.prefix+"0"+f.suffix}
                            style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:7}}>
                      <OBtn sm onClick={()=>setEditMetrics(null)}>SAVE</OBtn>
                      <button onClick={()=>{const n={...adMetrics};delete n[p.key];setAdMetrics(n);setEditMetrics(null);}}
                        style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 9px",fontSize:9,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>
                        clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION 4: API INTEGRATION (ADVANCED) ── */}
      <details style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8}}>
        <summary style={{padding:16,cursor:"pointer",listStyle:"none",display:"flex",justifyContent:"space-between",alignItems:"center"}}
          onClick={()=>setApiOpen(o=>!o)}>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>API INTEGRATION (ADVANCED)</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>For automated data pulls, budget control, and Slack alerts — requires developer app setup per platform</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <OBtn sm onClick={e=>{e.stopPropagation();loadAdsStatus();}} disabled={adsLoading}>{adsLoading?"...":"↻ TEST ALL"}</OBtn>
            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>{apiOpen?"▲ COLLAPSE":"▸ EXPAND"}</span>
          </div>
        </summary>
        <div style={{padding:"0 16px 16px"}}>
          <div style={{background:B.yellowBg,border:`1px solid ${B.yellow}40`,borderRadius:5,padding:"9px 12px",marginBottom:14,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
            <strong>Note:</strong> Meta requires creating a Facebook developer app (free at developers.facebook.com) and getting a System User token — typically takes 15–30 min. Other platforms have similar requirements. For read-only results, the Looker Studio embed above is easier.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {API_VARS.map(p=>{
              const s=adsStatus[p.key];
              const ok=s?.status==="connected";
              const err=s?.status==="error";
              return (
                <div key={p.key} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12,borderLeft:`3px solid ${ok?B.green:err?"#f97316":p.color}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>
                      {PLATFORMS.find(pl=>pl.key===p.key)?.icon} {PLATFORMS.find(pl=>pl.key===p.key)?.label}
                    </span>
                    {ok&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 7px",borderRadius:8}}>✓ CONNECTED{s.name?` · ${s.name}`:""}</span>}
                    {err&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:"#f97316",background:"#fff7ed",padding:"2px 7px",borderRadius:8}}>⚠ {s.message?.slice(0,60)}</span>}
                    {!ok&&!err&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,padding:"2px 7px",borderRadius:8,border:`1px solid ${B.border}`}}>NOT SET</span>}
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                    {p.vars.map(v=>(
                      <code key={v} style={{fontFamily:"monospace",fontSize:9,color:p.color,background:`${p.color}10`,padding:"2px 6px",borderRadius:3,border:`1px solid ${p.color}30`}}>{v}</code>
                    ))}
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5}}>{p.note}</div>
                </div>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}

// ─── DIRECT SOCIAL PUBLISHING ─────────────────────────────────────────────────
function AyrsharePanel({addLog}) {
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  const safePost = async (body) => {
    const r = await fetch("/api/social-post", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    let data;
    try { data = await r.json(); } catch {
      const txt = await r.text().catch(()=>"");
      if (!r.ok || txt.toLowerCase().includes("publer_api_key") || txt.toLowerCase().includes("server error")) {
        throw new Error("PUBLER_API_KEY not set in Vercel — add it under Settings → Environment Variables, then redeploy.");
      }
      throw new Error(txt || `Server error ${r.status}`);
    }
    return data;
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const data = await safePost({action:"test"});
      if (data.ok) {
        setTestResult({ok:true, user: data.user, workspaces: data.workspaces||[], firstWorkspaceId: data.firstWorkspaceId});
        addLog("Publer connected ✓","success");
        try { const st=JSON.parse(localStorage.getItem("st1_integrations_status_v1")||"{}"); localStorage.setItem("st1_integrations_status_v1",JSON.stringify({...st,social:true})); } catch {}
      } else {
        setTestResult({ok:false, error: data.error || "Connection failed"});
        addLog(`Publer: ${data.error}`,"error");
      }
    } catch(e) { setTestResult({ok:false, error:e.message}); }
    setTesting(false);
  };

  const loadProfiles = async () => {
    setLoadingProfiles(true); setProfiles([]);
    try {
      const data = await safePost({action:"profiles"});
      if (data.ok) { setProfiles(data.profiles||[]); addLog(`Loaded ${data.profiles?.length||0} Publer accounts`,"success"); }
      else { addLog(`Failed: ${data.error}`,"error"); }
    } catch(e) { addLog(e.message,"error"); }
    setLoadingProfiles(false);
  };

  // ── Compose / publish ───────────────────────────────────────────────────
  const [composeText, setComposeText] = useState("");
  const [composePlatforms, setComposePlatforms] = useState([]);
  const [composeSchedule, setComposeSchedule] = useState(""); // empty = post ASAP (backend defaults to ~2 min out)
  const [composing, setComposing] = useState(false);
  const [composeResult, setComposeResult] = useState(null);

  const togglePlatform = (p) => setComposePlatforms(prev => prev.includes(p) ? prev.filter(x=>x!==p) : [...prev,p]);

  const publishPost = async () => {
    if (!composeText.trim()) { addLog("Enter post text first","warn"); return; }
    if (!composePlatforms.length) { addLog("Select at least one platform","warn"); return; }
    setComposing(true); setComposeResult(null);
    try {
      const data = await safePost({
        post: composeText.trim(),
        platforms: composePlatforms,
        ...(composeSchedule ? { scheduleDate: new Date(composeSchedule).toISOString() } : {}),
      });
      if (data.postIds?.length || data.status === "scheduled") {
        setComposeResult({ok:true, ...data});
        addLog(`✓ Post ${composeSchedule?"scheduled":"queued"} — ${composePlatforms.join(", ")}`,"success");
        setComposeText(""); setComposePlatforms([]); setComposeSchedule("");
      } else {
        setComposeResult({ok:false, error: data.error || data._missing || "Post failed"});
        addLog(`Publish failed: ${data.error||data._missing}`,"error");
      }
    } catch(e) {
      setComposeResult({ok:false, error:e.message});
      addLog(`Publish failed: ${e.message}`,"error");
    }
    setComposing(false);
  };

  const [debugResult, setDebugResult] = useState(null);
  const [debugging, setDebugging] = useState(false);
  const debugPost = async () => {
    setDebugging(true); setDebugResult(null);
    try {
      const r = await fetch("/api/social-post", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"debug-post"})});
      const d = await r.json();
      setDebugResult(d);
      addLog(`Debug post: HTTP ${d.httpStatus} — ${d.rawResponse?.slice(0,120)}`,"info");
    } catch(e) { addLog(e.message,"error"); }
    setDebugging(false);
  };

  const NET_COLORS = {twitter:"#000",facebook:"#1877F2",instagram:"#E1306C",linkedin:"#0A66C2",tiktok:"#000"};
  const NET_ICONS  = {twitter:"𝕏",facebook:"f",instagram:"📷",linkedin:"in",tiktok:"T"};

  return (
    <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:"4px solid #6B3FA0"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>SOCIAL PUBLISHING · PUBLER</div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>Schedule and post to Instagram, Facebook, LinkedIn, Twitter/X, TikTok · from $12/mo · No app creation needed</div>
        </div>
        <button onClick={testConnection} disabled={testing}
          style={{background:testing?B.surface:"#6B3FA0",color:testing?B.muted:B.white,border:"none",borderRadius:4,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer",fontWeight:700,letterSpacing:.5,whiteSpace:"nowrap"}}>
          {testing?"TESTING…":"TEST CONNECTION"}
        </button>
      </div>

      {testResult?.ok&&(
        <div style={{background:B.greenBg,border:`1px solid ${B.green}40`,borderRadius:6,padding:"10px 12px",marginBottom:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,lineHeight:1.6}}>
          ✓ <strong>Publer connected</strong>{testResult.user?.name ? ` — ${testResult.user.name}` : ""}
          {testResult.workspaces?.length>0&&(
            <div style={{marginTop:8,borderTop:"1px solid #b7e4ca",paddingTop:8}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:1,marginBottom:6}}>WORKSPACE IDs — add to Vercel as PUBLER_WORKSPACE_ID</div>
              {testResult.workspaces.map(w=>(
                <div key={w.id} style={{display:"flex",justifyContent:"space-between",background:"#d4f0e0",borderRadius:4,padding:"4px 8px",marginBottom:4,fontFamily:"monospace",fontSize:10}}>
                  <span style={{color:"#1a6b40"}}>{w.name||"Workspace"}</span>
                  <span style={{userSelect:"all",color:"#1a6b40",fontWeight:700}}>{w.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {testResult?.ok===false&&(
        <div style={{background:B.redBg,border:`1px solid ${B.red}40`,borderRadius:6,padding:"10px 12px",marginBottom:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
          ✗ {testResult.error}
        </div>
      )}

      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"14px 16px",marginBottom:12}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:"#6B3FA0",letterSpacing:1.5,marginBottom:10}}>COMPOSE POST</div>
        <textarea
          value={composeText} onChange={e=>setComposeText(e.target.value)}
          placeholder="What do you want to post?" rows={3}
          style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 10px",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,resize:"vertical",marginBottom:10,boxSizing:"border-box"}}
        />
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          {(profiles.length ? [...new Set(profiles.map(p=>p.service).filter(Boolean))] : Object.keys(NET_COLORS)).map(p=>(
            <label key={p} style={{display:"flex",alignItems:"center",gap:5,background:composePlatforms.includes(p)?`${NET_COLORS[p]||"#888"}18`:B.surface,border:`1px solid ${composePlatforms.includes(p)?(NET_COLORS[p]||"#888"):B.border}`,borderRadius:5,padding:"5px 10px",cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text}}>
              <input type="checkbox" checked={composePlatforms.includes(p)} onChange={()=>togglePlatform(p)} style={{margin:0}}/>
              {NET_ICONS[p]||"?"} {p.toUpperCase()}
            </label>
          ))}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,display:"block",marginBottom:3}}>SCHEDULE (optional — blank posts ASAP)</label>
            <input type="datetime-local" value={composeSchedule} onChange={e=>setComposeSchedule(e.target.value)}
              style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"6px 9px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}/>
          </div>
          <button onClick={publishPost} disabled={composing}
            style={{background:composing?B.surface:"#6B3FA0",color:composing?B.muted:B.white,border:"none",borderRadius:5,padding:"8px 18px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,cursor:"pointer",fontWeight:700,letterSpacing:.5,alignSelf:"flex-end"}}>
            {composing?"PUBLISHING…":composeSchedule?"SCHEDULE POST":"PUBLISH NOW"}
          </button>
        </div>
        {composeResult?.ok&&(
          <div style={{background:B.greenBg,border:`1px solid ${B.green}40`,borderRadius:5,padding:"8px 11px",marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>
            ✓ {composeResult.scheduled?`Scheduled for ${new Date(composeResult.scheduledAt).toLocaleString()}`:"Queued"}
            {composeResult._warning&&<div style={{marginTop:3,color:B.yellow}}>{composeResult._warning}</div>}
          </div>
        )}
        {composeResult?.ok===false&&(
          <div style={{background:B.redBg,border:`1px solid ${B.red}40`,borderRadius:5,padding:"8px 11px",marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
            ✗ {composeResult.error}
          </div>
        )}
      </div>

      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"14px 16px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1.5,marginBottom:12}}>SETUP</div>
        {[
          {n:"1",title:"Create Publer account (Business plan required)",body:<>Sign up at <a href="https://publer.com" target="_blank" rel="noreferrer" style={{color:"#6B3FA0",fontWeight:700}}>publer.com</a> — <strong>API requires Business plan</strong>. Connect your social accounts in the Publer dashboard.</>},
          {n:"2",title:"Get your API key",body:<>In Publer, go to <strong>Settings → API</strong> → copy your <strong>API Key</strong>.</>},
          {n:"3",title:"Add API key to Vercel + redeploy",body:<>Add to Vercel env vars:<br/><code style={{background:"#f0f0f0",padding:"2px 7px",borderRadius:3,fontFamily:"monospace",fontSize:10,display:"inline-block",marginTop:4}}>PUBLER_API_KEY = your_key_here</code><br/><span style={{color:B.muted,fontSize:10}}>Redeploy → click <strong>Test Connection</strong> — your workspace ID will appear above.</span></>},
          {n:"4",title:"Add workspace ID to Vercel + redeploy",body:<>Copy the workspace ID shown after Test Connection and add it:<br/><code style={{background:"#f0f0f0",padding:"2px 7px",borderRadius:3,fontFamily:"monospace",fontSize:10,display:"inline-block",marginTop:4}}>PUBLER_WORKSPACE_ID = your_workspace_id</code><br/><span style={{color:B.muted,fontSize:10}}>Redeploy → then click Load Accounts below.</span></>},
          {n:"5",title:"Load accounts → add IDs to Vercel",body:<>Click <strong>Load Accounts</strong> below to see your connected social account IDs, then add each one to Vercel as shown.</>},
        ].map(({n,title,body})=>(
          <div key={n} style={{display:"flex",gap:10,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:B.orange,color:B.white,fontFamily:"'Russo One',sans-serif",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{n}</div>
            <div style={{flex:1}}><div style={{fontWeight:600,marginBottom:3}}>{title}</div><div style={{color:B.muted,lineHeight:1.7,fontSize:10}}>{body}</div></div>
          </div>
        ))}

        <div style={{borderTop:`1px solid ${B.border}`,paddingTop:12,marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8,flexWrap:"wrap"}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1}}>YOUR PUBLER ACCOUNTS</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={loadProfiles} disabled={loadingProfiles}
                style={{background:loadingProfiles?B.surface:B.orangeBg,color:loadingProfiles?B.muted:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer",fontWeight:700,letterSpacing:.5}}>
                {loadingProfiles?"LOADING…":"⟳ LOAD ACCOUNTS"}
              </button>
              <button onClick={debugPost} disabled={debugging}
                style={{background:debugging?B.surface:"#1a1a1a",color:debugging?B.muted:"#00ff88",border:"1px solid #00ff8840",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer",fontWeight:700,letterSpacing:.5}}>
                {debugging?"TESTING…":"🔬 DEBUG POST"}
              </button>
            </div>
          </div>
          {debugResult&&(
            <div style={{background:"#0a0a0a",border:"1px solid #00ff8840",borderRadius:5,padding:"10px 12px",marginBottom:10,fontFamily:"monospace",fontSize:10,color:"#00ff88",overflowX:"auto"}}>
              <div style={{color:"#888",marginBottom:4}}>HTTP {debugResult.httpStatus} · account: {debugResult.accountUsed} · workspace: {debugResult.workspaceId}</div>
              <div style={{color:"#aaa",marginBottom:2,fontSize:9}}>CREATE:</div>
              <div style={{color:"#fff",wordBreak:"break-all",whiteSpace:"pre-wrap",marginBottom:6}}>{debugResult.createResponse||debugResult.rawResponse||"(empty)"}</div>
              {debugResult.existingScheduled&&<><div style={{color:"#aaa",marginBottom:2,fontSize:9}}>EXISTING SCHEDULED:</div><div style={{color:"#fff",wordBreak:"break-all",whiteSpace:"pre-wrap"}}>{debugResult.existingScheduled}</div></>}
            </div>
          )}
          {profiles.length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {profiles.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 11px"}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:p.connected?"#1E8F4E":"#ccc",flexShrink:0}}/>
                  <div style={{width:26,height:26,borderRadius:4,background:`${NET_COLORS[p.service]||"#888"}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>
                    {NET_ICONS[p.service]||"?"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500}}>{p.name}</div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:NET_COLORS[p.service]||B.muted,letterSpacing:.5}}>{(p.service||"").toUpperCase()}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontSize:9,color:B.muted,userSelect:"all",marginBottom:2}}>{p.id}</div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted}}>
                      → <code style={{background:"#f0f0f0",padding:"1px 4px",borderRadius:2}}>PUBLER_ACCOUNT_{(p.service||"").toUpperCase()}</code>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{background:B.purpleBg,borderRadius:5,padding:"9px 12px",fontSize:10,color:B.purple,marginTop:4,lineHeight:1.6}}>
                Copy each ID and add to Vercel as the env var shown (e.g. <code style={{background:"#e8dcf5",padding:"1px 4px",borderRadius:2}}>PUBLER_ACCOUNT_INSTAGRAM = 123456</code>). Redeploy and posts will route to the right accounts.
              </div>
            </div>
          )}
          {profiles.length===0&&!loadingProfiles&&(
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",padding:"10px 0"}}>Add your API key to Vercel, redeploy, then click Load Accounts</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── INLINE PRICE EDITOR ──────────────────────────────────────────────────────
function PriceEditor({product,onSave}) {
  const [editing,setEditing]=useState(false);
  const [val,setVal]=useState(product.price);
  if(editing) return (
    <div style={{display:"flex",gap:4}}>
      <input type="number" value={val} onChange={e=>setVal(e.target.value)} autoFocus
        style={{width:70,background:"#fff",border:"2px solid #F37321",borderRadius:3,padding:"3px 5px",fontSize:11,textAlign:"right"}}
        onKeyDown={e=>{if(e.key==="Enter"){onSave(val);setEditing(false);}if(e.key==="Escape")setEditing(false);}}/>
      <button onClick={()=>{onSave(val);setEditing(false);}} style={{background:"#1E8F4E",color:"#fff",border:"none",borderRadius:3,padding:"3px 6px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700}}>✓</button>
    </div>
  );
  return <span onClick={()=>{setVal(product.price);setEditing(true);}} style={{cursor:"pointer",color:"#1A5FA8",borderBottom:"1px dashed #1A5FA8cc",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>${product.price}</span>;
}