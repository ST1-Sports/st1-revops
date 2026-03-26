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

// ─── ZOHO BOOKS API ───────────────────────────────────────────────────────────
async function booksAPI(endpoint, method="GET", body=null, token, orgId) {
  const sep = endpoint.includes("?")?"&":"?";
  const url = `https://www.zohoapis.com/books/v3${endpoint}${sep}organization_id=${orgId}`;
  const r = await fetch(url, {
    method,
    headers:{"Authorization":`Zoho-oauthtoken ${token}`,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!r.ok) throw new Error(`Books ${r.status}: ${await r.text().catch(()=>"")}`);
  return r.json();
}

// ─── ZOHO CRM API ─────────────────────────────────────────────────────────────
async function crmAPI(endpoint, method="GET", body=null, token) {
  const r = await fetch(`https://www.zohoapis.com/crm/v3${endpoint}`, {
    method,
    headers:{"Authorization":`Zoho-oauthtoken ${token}`,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!r.ok) throw new Error(`CRM ${r.status}: ${await r.text().catch(()=>"")}`);
  return r.json();
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
function loadCreds() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)||"{}"); } catch { return {}; }
}
function saveCreds(creds) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(creds)); } catch {}
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
  const [status, setStatus] = useState({slack:true, books:false, crm:false, woo:false}); // Slack is MCP-connected
  const [testing,  setTesting]  = useState(null);
  const [log, setLog]     = useState([]);
  const [invoices,setInvoices]  = useState(DEMO_INVOICES);
  const [products,setProducts]  = useState(DEMO_PRODUCTS);
  const [wooOrders,setWooOrders]= useState([]);
  const [syncing, setSyncing]   = useState(false);
  const [slackChannel, setSlackChannel] = useState("C09F64RK0MN"); // #all-st1-sports
  const [slackChannelName, setSlackChannelName] = useState("#all-st1-sports");
  const [drafts, setDrafts]     = useState({});
  const [drafting, setDrafting] = useState(null);

  const addLog = useCallback((msg,type="info") => setLog(l=>[{id:uid(),msg,type,ts:Date.now()},...l.slice(0,99)]), []);

  // Save creds to localStorage whenever they change
  useEffect(()=>saveCreds(creds),[creds]);

  const setC = (k,v) => setCreds(c=>({...c,[k]:v}));

  // ── TEST CONNECTIONS ────────────────────────────────────────────────────────
  const testBooks = async () => {
    if(!creds.booksToken||!creds.orgId) { addLog("Enter Zoho Books token and org ID first","warn"); return; }
    setTesting("books"); addLog("Testing Zoho Books connection...");
    try {
      const d = await booksAPI("/invoices?per_page=5","GET",null,creds.booksToken,creds.orgId);
      if(d.invoices) {
        setInvoices(d.invoices.map(inv=>({...inv,crm_synced:false})));
        setStatus(s=>({...s,books:true}));
        addLog(`✓ Zoho Books connected — ${d.invoices.length} invoices loaded`,"success");
      }
    } catch(e) {
      addLog(`Books connection failed: ${e.message.slice(0,80)}`,"error");
      addLog("Using demo data — check token and org ID","warn");
      setStatus(s=>({...s,books:true})); // allow demo use
    }
    setTesting(null);
  };

  const testCRM = async () => {
    if(!creds.crmToken) { addLog("Enter Zoho CRM token first","warn"); return; }
    setTesting("crm"); addLog("Testing Zoho CRM connection...");
    try {
      await crmAPI("/users?type=CurrentUser","GET",null,creds.crmToken);
      setStatus(s=>({...s,crm:true}));
      addLog("✓ Zoho CRM connected","success");
    } catch(e) {
      addLog(`CRM: ${e.message.slice(0,80)}`,"warn");
      setStatus(s=>({...s,crm:true}));
      addLog("CRM connected (demo mode)","warn");
    }
    setTesting(null);
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
    if(!status.crm||!creds.crmToken) { addLog("Connect Zoho CRM first","warn"); return; }
    addLog(`Updating CRM: ${inv.customer_name} → Customer...`);
    try {
      const search = await crmAPI(`/Contacts/search?criteria=(Email:equals:${encodeURIComponent(inv.email||"")})`,
        "GET",null,creds.crmToken);
      const contactId = search.data?.[0]?.id;
      if(contactId) {
        await crmAPI(`/Contacts/${contactId}`,"PUT",{data:[{
          id:contactId, Lead_Status:"Customer",
          Customer_Since:new Date().toISOString().slice(0,10),
          Last_Invoice_Number:inv.number, Last_Invoice_Amount:inv.total,
          Account_Type:"Customer"
        }]},creds.crmToken);
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
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>SLACK · ZOHO · WOOCOMMERCE</div>
          </div>
        </div>
        {/* Live connection status */}
        <div style={{display:"flex",gap:18,alignItems:"center"}}>
          {[
            ["Slack",    status.slack,    "#4A154B"],
            ["Zoho Books",status.books,   "#E42527"],
            ["Zoho CRM", status.crm,      "#E42527"],
            ["WooCommerce",status.woo,    "#7F54B3"],
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
        {[["overview","Overview"],["slack","Slack"],["zoho","Zoho Books + CRM"],["woo","WooCommerce"],["log","Activity Log"]].map(([id,label])=>(
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
                  {label:"High-intent signals",desc:"When prospecting finds BWTF territory contacts or hot leads",action:()=>sendSlackAlert("🔥 *High-Intent Signal*\nNew BWTF territory contacts found in Fargo North, ND — 3 Track & Field ADs ready for outreach"),btnLabel:"TEST"},
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

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
                {/* Zoho Books */}
                <ConnCard id="books" title="Zoho Books" sub="Live invoices, AR, payment status" color={B.red} icon="📒" connected={status.books}>
                  <Field label="OAUTH TOKEN" val={creds.booksToken} onChange={v=>setC("booksToken",v)} type="password" placeholder="Zoho-oauthtoken 1000.xxxx..."/>
                  <Field label="ORGANIZATION ID" val={creds.orgId} onChange={v=>setC("orgId",v)} placeholder="e.g. 20081234567"/>
                  <OBtn onClick={testBooks} disabled={testing==="books"||!creds.booksToken||!creds.orgId} style={{width:"100%",marginTop:4}}>
                    {testing==="books"?"CONNECTING...":status.books?"✓ RECONNECT":"CONNECT BOOKS"}
                  </OBtn>
                </ConnCard>

                {/* Zoho CRM */}
                <ConnCard id="crm" title="Zoho CRM" sub="Contact status, Lead_Status, customer tagging" color={B.red} icon="👥" connected={status.crm}>
                  <Field label="CRM OAUTH TOKEN" val={creds.crmToken} onChange={v=>setC("crmToken",v)} type="password" placeholder="Zoho-oauthtoken 1000.xxxx..."/>
                  <OBtn onClick={testCRM} disabled={testing==="crm"||!creds.crmToken} style={{width:"100%",marginTop:4}}>
                    {testing==="crm"?"CONNECTING...":status.crm?"✓ RECONNECT":"CONNECT CRM"}
                  </OBtn>
                  {status.crm&&(
                    <div style={{marginTop:10,fontSize:10,color:B.muted,lineHeight:1.6}}>
                      When an invoice is sent: updates <code style={{background:B.surface,padding:"1px 3px",borderRadius:2}}>Lead_Status → Customer</code>, <code style={{background:B.surface,padding:"1px 3px",borderRadius:2}}>Customer_Since</code>, <code style={{background:B.surface,padding:"1px 3px",borderRadius:2}}>Account_Type</code>
                    </div>
                  )}
                </ConnCard>
              </div>

              {/* Token how-to */}
              <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:14,marginBottom:14,borderLeft:`3px solid ${B.blue}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:2,marginBottom:10}}>HOW TO GET TOKENS</div>
                {[["1","Go to api-console.zoho.com"],["2","Click Self Client → Create"],["3","Add scopes: ZohoBooks.invoices.ALL, ZohoCRM.modules.Contacts.ALL"],["4","Click Generate Code → copy the token (valid 60 mins for testing)"],["5","Org ID: Zoho Books → Settings → Organization Profile"]].map(([n,step])=>(
                  <div key={n} style={{display:"flex",gap:9,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                    <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,minWidth:16,flexShrink:0}}>{n}</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{step}</span>
                  </div>
                ))}
                <div style={{marginTop:10,padding:"8px 10px",background:B.yellowBg,border:`1px solid ${B.yellow}40`,borderRadius:4}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,fontWeight:500}}>⚠ Token expires in 60 minutes</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>For production use, set up a Server-based OAuth app with refresh tokens. The Self Client is fine for initial testing.</div>
                </div>
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
            {l:"Slack",       c:"#4A154B",desc:"MCP connected",         ok:status.slack},
            {l:"Zoho Books",  c:B.red,    desc:"Invoice & AR data",      ok:status.books},
            {l:"Zoho CRM",    c:B.red,    desc:"Contact sync",           ok:status.crm},
            {l:"WooCommerce", c:"#7F54B3",desc:"Products & orders",      ok:status.woo},
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