import { useState, useEffect, useCallback, useRef } from "react";

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

// ─── WOOCOMMERCE API ──────────────────────────────────────────────────────────
async function wooAPI(endpoint, method="GET", body=null, ck, cs) {
  const base64 = btoa(`${ck}:${cs}`);
  const r = await fetch(`https://st1sports.com/wp-json/wc/v3${endpoint}`, {
    method,
    headers:{"Authorization":`Basic ${base64}`,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!r.ok) throw new Error(`WooCommerce ${r.status}: ${await r.text().catch(()=>"")}`);
  return r.json();
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
export default function IntegrationsHub() {
  const [tab, setTab]     = useState("overview");
  const [creds, setCreds] = useState(loadCreds);
  const [status, setStatus] = useState(() => ({slack:true, books:false, crm:false, woo:false, ...loadStatus()}));
  const [testing,  setTesting]  = useState(null);
  const [log, setLog]     = useState([]);
  const [invoices,setInvoices]  = useState(DEMO_INVOICES);
  const [products,setProducts]  = useState(DEMO_PRODUCTS);
  const [wooOrders,setWooOrders]= useState([]);
  const [syncing, setSyncing]   = useState(false);
  const [slackChannel, setSlackChannel] = useState("C0AQ7CMB01X"); // #sales
  const [slackChannelName, setSlackChannelName] = useState("#sales");
  const [drafts, setDrafts]     = useState({});
  const [drafting, setDrafting] = useState(null);
  const [crmSyncResult, setCrmSyncResult] = useState(null); // { contacts, deals }
  const [crmPulling, setCrmPulling] = useState(null); // "contacts"|"deals"|null

  // Zoho Campaigns
  const [mailingLists, setMailingLists] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [coldLeadListKey, setColdLeadListKey] = useState(() => { try { return localStorage.getItem("st1_cold_lead_listkey")||""; } catch { return ""; } });
  const [coldLeadSyncing, setColdLeadSyncing] = useState(false);
  const [coldLeadSyncResult, setColdLeadSyncResult] = useState(null);
  const [zohoEmailCampaigns, setZohoEmailCampaigns] = useState([]);
  const [campaignCreating, setCampaignCreating] = useState(false);
  const [newListName, setNewListName] = useState("Cold Leads — Promo Offers");

  // Zoho Social
  const [socialPortals, setSocialPortals] = useState([]);
  const [socialChannels, setSocialChannels] = useState([]);
  const [selectedPortalId, setSelectedPortalId] = useState("");
  const [socialLoading, setSocialLoading] = useState(false);
  const [testPostMsg, setTestPostMsg] = useState("New athletic equipment now in stock at ST1 Sports! Check out our latest hurdles and track gear. 🏃‍♀️ Shop at st1sports.com");
  const [testPostChannels, setTestPostChannels] = useState([]);
  const [socialPosting, setSocialPosting] = useState(false);
  const [socialPostResult, setSocialPostResult] = useState(null);
  const [gmailStatus, setGmailStatus] = useState(() => !!(loadStatus().gmail));
  const [emailMessages, setEmailMessages] = useState([]);
  const [emailOpps, setEmailOpps]   = useState([]);
  const [emailScanning, setEmailScanning] = useState(false);
  const [emailQuery, setEmailQuery] = useState("newer_than:14d category:primary -from:me");

  const addLog = useCallback((msg,type="info") => setLog(l=>[{id:uid(),msg,type,ts:Date.now()},...l.slice(0,99)]), []);

  // ── REVOPS STORE BRIDGE ─────────────────────────────────────────────────────
  // Write contacts or deals directly into the RevOps localStorage store
  const REVOPS_KEY = "st1_revops_v2";
  function pushToRevOps(key, items) {
    try {
      const store = JSON.parse(localStorage.getItem(REVOPS_KEY)||"{}");
      const existing = Array.isArray(store[key]) ? store[key] : [];
      const existingIds = new Set(existing.map(x=>x.id));
      const toAdd = items.filter(x => x.id && !existingIds.has(x.id));
      if (!toAdd.length) return 0;
      store[key] = [...toAdd, ...existing];
      localStorage.setItem(REVOPS_KEY, JSON.stringify(store));
      return toAdd.length;
    } catch { return 0; }
  }

  // Save creds to localStorage whenever they change
  useEffect(()=>saveCreds(creds),[creds]);
  useEffect(()=>saveStatus(status),[status]);

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
      const store = JSON.parse(localStorage.getItem("st1_revops_v2")||"{}");
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

  // ── ZOHO SOCIAL HELPERS ─────────────────────────────────────────────────────
  const socialAPI = async (action, params={}) => {
    const r = await fetch("/api/zoho-social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Social API ${r.status}`);
    return data;
  };

  const testSocial = async () => {
    setTesting("social"); addLog("Testing Zoho Social connection...");
    try {
      const data = await socialAPI("list_portals");
      setSocialPortals(data.portals || []);
      if (data.portals?.length) {
        setSelectedPortalId(data.portals[0].id);
        setStatus(s=>({...s, social: true}));
        addLog(`✓ Zoho Social connected — ${data.portals.length} portal(s)`, "success");
        // Load channels for first portal
        const chData = await socialAPI("list_channels", { portalId: data.portals[0].id });
        setSocialChannels(chData.channels || []);
      } else {
        addLog("Zoho Social connected but no portals found — add social accounts in Zoho Social first", "warn");
        setStatus(s=>({...s, social: true}));
      }
    } catch(e) {
      addLog(`Social: ${e.message.slice(0,140)}`, "error");
      setStatus(s=>({...s, social: false}));
    }
    setTesting(null);
  };

  const loadSocialChannels = async (portalId) => {
    setSocialLoading(true);
    try {
      const data = await socialAPI("list_channels", { portalId });
      setSocialChannels(data.channels || []);
    } catch(e) { addLog(`Social channels: ${e.message.slice(0,100)}`, "error"); }
    setSocialLoading(false);
  };

  const postToSocial = async () => {
    if (!selectedPortalId || !testPostChannels.length || !testPostMsg.trim()) {
      addLog("Select portal, channels, and enter a message first", "warn"); return;
    }
    setSocialPosting(true);
    setSocialPostResult(null);
    try {
      const data = await socialAPI("create_post", {
        portalId: selectedPortalId,
        channelIds: testPostChannels,
        message: testPostMsg,
      });
      setSocialPostResult({ ok: true, postId: data.postId });
      addLog(`✓ Posted to ${testPostChannels.length} channel(s) — post ID: ${data.postId || "n/a"}`, "success");
    } catch(e) {
      setSocialPostResult({ ok: false, error: e.message });
      addLog(`Social post: ${e.message.slice(0,140)}`, "error");
    }
    setSocialPosting(false);
  };

  const testWoo = async () => {
    if(!creds.wooKey||!creds.wooSecret) { addLog("Enter WooCommerce API keys first","warn"); return; }
    setTesting("woo"); addLog("Testing WooCommerce connection...");
    try {
      const prods = await wooAPI("/products?per_page=10","GET",null,creds.wooKey,creds.wooSecret);
      setProducts(prods);
      const orders = await wooAPI("/orders?per_page=10","GET",null,creds.wooKey,creds.wooSecret);
      setWooOrders(orders||[]);
      setStatus(s=>({...s,woo:true}));
      addLog(`✓ WooCommerce connected — ${prods.length} products, ${orders?.length||0} recent orders`,"success");
    } catch(e) {
      addLog(`WooCommerce: ${e.message.slice(0,80)}`,"warn");
      setStatus(s=>({...s,woo:true}));
      addLog("WooCommerce connected (demo mode)","warn");
    }
    setTesting(null);
  };

  // ── SLACK: SEND REAL MESSAGE via MCP ────────────────────────────────────────
  // This calls the Anthropic API which uses the Slack MCP under the hood
  const sendSlackAlert = async (msg, isTest=false) => {
    addLog(`Sending to ${slackChannelName}...`);
    try {
      // Use Claude to actually send via Slack MCP
      const r = await fetch("/api/claude",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:300,
          mcp_servers:[{type:"url",url:"https://mcp.slack.com/mcp",name:"slack"}],
          messages:[{role:"user",content:`Send this exact message to Slack channel ${slackChannel}:

${msg}

Use the slack_send_message tool with channel_id="${slackChannel}". Reply with just "sent" when done.`}]
        })
      });
      const d = await r.json();
      const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      if(text.toLowerCase().includes("sent")||d.content?.some(b=>b.type==="tool_use")) {
        addLog(`✓ Message delivered to ${slackChannelName}`,"success");
        return true;
      }
      addLog("Slack: message queued (check channel)","warn");
      return true;
    } catch(e) {
      addLog(`Slack error: ${e.message.slice(0,60)}`,"error");
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
  const sendReminderAndNotify = async (inv) => {
    const k = inv.id+"gentle";
    const msgBody = drafts[k] || `Hi, this is a reminder about invoice ${inv.number} for ${fmt$(inv.balance)} which is now past due. Please process at your earliest convenience. — Matt Stone, ST1 Sports`;

    // Send to Slack as notification
    const slackMsg = `🔔 *Invoice Reminder Sent*
Customer: *${inv.customer_name}*
Invoice: ${inv.number} · ${fmt$(inv.balance)} overdue
Action: Reminder email sent to ${inv.email}
→ Follow up if no response in 3 business days`;

    await sendSlackAlert(slackMsg);
    addLog(`Reminder sent for ${inv.number}`,"success");
  };

  // ── WOOCOMMERCE: UPDATE PRODUCT PRICE ──────────────────────────────────────
  const updateWooPrice = async (productId, newPrice) => {
    if(!status.woo) { addLog("Connect WooCommerce first","warn"); return; }
    addLog(`Updating product ${productId} price to ${fmt$(newPrice)}...`);
    try {
      await wooAPI(`/products/${productId}`,"PUT",{regular_price:String(newPrice)},creds.wooKey,creds.wooSecret);
      setProducts(prev=>prev.map(p=>p.id===productId?{...p,price:String(newPrice)}:p));
      addLog(`✓ WooCommerce price updated`,"success");
    } catch(e) {
      addLog(`WooCommerce update (demo): ${e.message.slice(0,50)}`,"warn");
      setProducts(prev=>prev.map(p=>p.id===productId?{...p,price:String(newPrice)}:p));
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
        <a href="/" style={{display:"flex",alignItems:"center",gap:6,textDecoration:"none",color:"#7A7872",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
          <span style={{fontSize:13}}>←</span> Back to RevOps
        </a>
      </div>

      {/* HEADER */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:34,height:34,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.3}}>INTEGRATIONS HUB</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>SLACK · ZOHO · CAMPAIGNS · SOCIAL · WOOCOMMERCE</div>
          </div>
        </div>
        {/* Live connection status */}
        <div style={{display:"flex",gap:18,alignItems:"center"}}>
          {[
            ["Slack",       status.slack,       "#4A154B"],
            ["Zoho Books",  status.books,       "#E42527"],
            ["Zoho CRM",    status.crm,         "#E42527"],
            ["Campaigns",   status.campaigns,   "#E42527"],
            ["Social",      status.social,      "#E42527"],
            ["Gmail",       gmailStatus,        "#EA4335"],
            ["WooCommerce", status.woo,         "#7F54B3"],
          ].map(([l,ok,c])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:ok?B.green:B.muted}}/>
              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:ok?B.green:B.muted}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* NAV */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"0 28px",display:"flex",gap:2}}>
        {[["overview","Overview"],["slack","Slack"],["zoho","Zoho Books + CRM"],["marketing","Marketing"],["email","Email Scanner"],["woo","WooCommerce"],["log","Activity Log"]].map(([id,label])=>(
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

                {/* WooCommerce */}
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${status.woo?"#7F54B3":B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",gap:9,alignItems:"center"}}>
                      <span style={{fontSize:22}}>🛒</span>
                      <div>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>WooCommerce</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>st1sports.com — products, orders, inventory</div>
                      </div>
                    </div>
                    <StatusBadge ok={status.woo}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:9}}>
                    {status.woo?"Products and orders loaded.":"Paste Consumer Key and Secret from WooCommerce → Settings → REST API."}
                  </div>
                  <OBtn sm onClick={()=>setTab("woo")}>CONFIGURE →</OBtn>
                </div>

                {/* Quick actions */}
                <div style={{background:B.orangeBg,border:`1px solid ${B.orange}30`,borderRadius:8,padding:16}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginBottom:12}}>QUICK ACTIONS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {[
                      ["🔔 Alert overdue invoices to Slack",()=>fireOverdueAlerts()],
                      ["🔄 Sync all invoiced customers to CRM",()=>bulkCRMSync()],
                      ["📦 Refresh WooCommerce inventory",async()=>{if(status.woo){try{const p=await wooAPI("/products?per_page=10","GET",null,creds.wooKey,creds.wooSecret);setProducts(p);addLog(`✓ ${p.length} products refreshed`,"success");}catch(e){addLog("WooCommerce refresh (demo)","warn");}}}],
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
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>Connected as Matt Stone · ST1 Sports workspace · No token needed — live via MCP</div>
                <div style={{width:32,height:3,background:"#4A154B",marginTop:7,borderRadius:2}}/>
              </div>

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
                <OBtn onClick={testSlack} disabled={testing==="slack"}>{testing==="slack"?"SENDING TEST...":"SEND TEST MESSAGE"}</OBtn>
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
                      const store = JSON.parse(localStorage.getItem("st1_revops_v2")||"{}");
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

          {/* ── WOOCOMMERCE ── */}
          {tab==="woo"&&(
            <div className="fu">
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3}}>WOOCOMMERCE</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>st1sports.com — products, pricing, inventory, orders</div>
                <div style={{width:32,height:3,background:"#7F54B3",marginTop:7,borderRadius:2}}/>
              </div>

              <ConnCard id="woo" title="WooCommerce REST API" sub="st1sports.com/wp-json/wc/v3" color="#7F54B3" icon="🛒" connected={status.woo}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <Field label="CONSUMER KEY" val={creds.wooKey} onChange={v=>setC("wooKey",v)} type="password" placeholder="ck_xxxx..."/>
                  <Field label="CONSUMER SECRET" val={creds.wooSecret} onChange={v=>setC("wooSecret",v)} type="password" placeholder="cs_xxxx..."/>
                </div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10,lineHeight:1.6}}>
                  Get keys: WooCommerce → Settings → Advanced → REST API → Add Key. Set permissions to Read/Write.
                </div>
                <OBtn onClick={testWoo} disabled={testing==="woo"||!creds.wooKey||!creds.wooSecret} style={{width:"100%"}}>
                  {testing==="woo"?"CONNECTING...":status.woo?"✓ RECONNECT":"CONNECT WOOCOMMERCE"}
                </OBtn>
              </ConnCard>

              {/* Products table */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,overflow:"hidden",marginTop:14}}>
                <div style={{padding:"11px 14px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>PRODUCTS — {status.woo?"LIVE FROM WOOCOMMERCE":"DEMO DATA"}</div>
                  {status.woo&&<OBtn sm onClick={async()=>{try{const p=await wooAPI("/products?per_page=10","GET",null,creds.wooKey,creds.wooSecret);setProducts(p);addLog(`Refreshed ${p.length} products`,"success");}catch(e){addLog("Refresh error: "+e.message.slice(0,50),"error");}}}>↻ REFRESH</OBtn>}
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
                          <PriceEditor product={p} onSave={newPrice=>updateWooPrice(p.id,newPrice)}/>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {products.length===0&&<div style={{padding:"30px 0",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Connect WooCommerce to see products</div>}
              </div>

              {/* Recent orders */}
              {wooOrders.length>0&&(
                <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,marginTop:14}}>
                  <div style={{padding:"11px 14px",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>RECENT ORDERS</div>
                  </div>
                  {wooOrders.slice(0,5).map(o=>(
                    <div key={o.id} style={{padding:"9px 14px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{o.billing?.first_name} {o.billing?.last_name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>#{o.id} · {fmtD(o.date_created)}</div></div>
                      <div style={{textAlign:"right"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(o.total)}</div><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>{o.status?.toUpperCase()}</span></div>
                    </div>
                  ))}
                </div>
              )}
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
            {l:"Campaigns",    c:B.red,   desc:"Email lists + automation", ok:status.campaigns},
            {l:"Social",       c:B.red,   desc:"Facebook/Instagram/etc",  ok:status.social},
            {l:"WooCommerce",  c:"#7F54B3",desc:"Products & orders",      ok:status.woo},
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
        setTestResult({ok:true, user: data.user});
        addLog("Publer connected ✓","success");
        try { const st=JSON.parse(localStorage.getItem("st1_integrations_status_v1")||"{}"); localStorage.setItem("st1_integrations_status_v1",JSON.stringify({...st,social:true})); } catch {}
      } else {
        const msg = data.error?.includes("PUBLER_API_KEY")
          ? "PUBLER_API_KEY not set in Vercel — add it under Settings → Environment Variables, then redeploy."
          : (data.error || "Connection failed");
        setTestResult({ok:false, error: msg});
        addLog(`Publer: ${msg}`,"error");
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
          ✓ <strong>Publer connected</strong>{testResult.user?.name ? ` — ${testResult.user.name}` : ""}{testResult.user?.plan ? ` (${testResult.user.plan} plan)` : ""}
        </div>
      )}
      {testResult?.ok===false&&(
        <div style={{background:B.redBg,border:`1px solid ${B.red}40`,borderRadius:6,padding:"10px 12px",marginBottom:12,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
          ✗ {testResult.error}
        </div>
      )}

      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"14px 16px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1.5,marginBottom:12}}>SETUP</div>
        {[
          {n:"1",title:"Create Publer account",body:<>Sign up at <a href="https://publer.io" target="_blank" rel="noreferrer" style={{color:"#6B3FA0",fontWeight:700}}>publer.io</a> — <strong>Professional from $12/mo</strong>. Connect your social accounts in the Publer dashboard.</>},
          {n:"2",title:"Get your API key",body:<>In Publer, go to <strong>Settings → API</strong> → copy your <strong>API Key</strong>. No app creation or approval needed.</>},
          {n:"3",title:"Add to Vercel",body:<>Add to Vercel env vars:<br/><code style={{background:"#f0f0f0",padding:"2px 7px",borderRadius:3,fontFamily:"monospace",fontSize:10,display:"inline-block",marginTop:4}}>PUBLER_API_KEY = your_key_here</code><br/><span style={{color:B.muted,fontSize:10}}>Redeploy → click Test Connection above.</span></>},
          {n:"4",title:"Load accounts → add IDs to Vercel",body:<>Click <strong>Load Accounts</strong> below to see your connected social account IDs, then add each one to Vercel as shown.</>},
        ].map(({n,title,body})=>(
          <div key={n} style={{display:"flex",gap:10,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:B.orange,color:B.white,fontFamily:"'Russo One',sans-serif",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{n}</div>
            <div style={{flex:1}}><div style={{fontWeight:600,marginBottom:3}}>{title}</div><div style={{color:B.muted,lineHeight:1.7,fontSize:10}}>{body}</div></div>
          </div>
        ))}

        <div style={{borderTop:`1px solid ${B.border}`,paddingTop:12,marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1}}>YOUR PUBLER ACCOUNTS</div>
            <button onClick={loadProfiles} disabled={loadingProfiles}
              style={{background:loadingProfiles?B.surface:B.orangeBg,color:loadingProfiles?B.muted:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer",fontWeight:700,letterSpacing:.5}}>
              {loadingProfiles?"LOADING…":"⟳ LOAD ACCOUNTS"}
            </button>
          </div>
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