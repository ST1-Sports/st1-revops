import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import * as bgTasks from "../lib/bgTasks.js";

// ─── BRAND ────────────────────────────────────────────────────────────────────
const B = {
  pageBg:"#F2F2F0", white:"#FFFFFF", surface:"#F8F7F5",
  orange:"#F37321", orangeL:"#FF9942", orangeBg:"#FEF3EC",
  black:"#0A0A0A", gray1:"#424242", gray2:"#B2B9C1",
  border:"#E2E0DB", borderD:"#C8C4BC",
  text:"#1A1A18", textMid:"#424242", muted:"#7A7872",
  green:"#1E8F4E", greenBg:"#EAF7EE",
  yellow:"#C77800", yellowBg:"#FFF8E6",
  red:"#C0392B", redBg:"#FDECEA",
  blue:"#1A5FA8", blueBg:"#E8F0FA",
  purple:"#6B3FA0", purpleBg:"#F3EEFB",
  teal:"#0C7B6A", tealBg:"#E6F5F2",
};

const STORE = "st1_revops_v2";

const USERS = [
  {id:"matt",  name:"Matt Stone",   email:"matt@st1sports.com",  role:"owner", initials:"MS", color:B.orange},
  {id:"rep2",  name:"Alex Rivera",  email:"alex@st1sports.com",  role:"rep",   initials:"AR", color:B.blue},
  {id:"rep3",  name:"Jordan Wells", email:"jordan@st1sports.com",role:"rep",   initials:"JW", color:B.purple},
];

const mkId   = () => Math.random().toString(36).slice(2,9);
const today  = () => new Date().toISOString().slice(0,10);
const dAgo   = (d) => Math.floor((Date.now()-new Date(d))/86400000);
const dUntil = (d) => Math.ceil((new Date(d)-Date.now())/86400000);
const fmt$   = (n) => "$"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD   = (d) => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED = {
  currentUserId: null,
  deals: [],
  invoices: [],
  rfps: [],
  reorders: [],
  contacts: [],
  alerts: [],
  activity: [],
  integrations: {zohoToken:"",zohoCrmToken:"",zohoOrgId:"",slackChannel:"#sales-alerts"},
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

function useStore() {
  const [s, setRaw] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) {
        const p = JSON.parse(saved);
        return {...SEED,...p,
          deals:    Array.isArray(p.deals)    ? p.deals    : [],
          invoices: Array.isArray(p.invoices) ? p.invoices : [],
          rfps:     Array.isArray(p.rfps)     ? p.rfps     : [],
          reorders: Array.isArray(p.reorders) ? p.reorders : [],
          contacts: Array.isArray(p.contacts) ? p.contacts : [],
          alerts:   Array.isArray(p.alerts)   ? p.alerts   : [],
          activity: Array.isArray(p.activity) ? p.activity : [],
          integrations: {...SEED.integrations,...(p.integrations||{})},
        };
      }
    } catch {}
    return SEED;
  });

  const set = useCallback((fn) => {
    setRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : {...prev,...fn};
      try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return [s, set];
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function aiCall(prompt, opts={}) {
  const body = {model:"claude-sonnet-4-20250514", max_tokens:opts.tokens||900,
    messages:[{role:"user",content:prompt}]};
  if (opts.sys) body.system = opts.sys;
  if (opts.search) body.tools = [{type:"web_search_20250305",name:"web_search"}];
  const r = await fetch("/api/claude",
    {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d = await r.json();
  const text = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  if (opts.json) {
    try { const m=text.match(/[\[{][\s\S]*[\]}]/s); return m?JSON.parse(m[0]):null; } catch { return null; }
  }
  return text;
}

// ─── DISPATCH ─────────────────────────────────────────────────────────────────
function reducer(prev, action, payload) {
  switch (action) {
    case "LOGIN":             return {...prev, currentUserId:payload};
    case "LOGOUT":            return {...prev, currentUserId:null};
    case "ADD_DEAL":          return {...prev, deals:[payload,...prev.deals]};
    case "UPDATE_DEAL":       return {...prev, deals:prev.deals.map(d=>d.id===payload.id?{...d,...payload}:d)};
    case "ADD_INVOICE":       return {...prev, invoices:[payload,...prev.invoices]};
    case "UPDATE_INVOICE":    return {...prev, invoices:prev.invoices.map(i=>i.id===payload.id?{...i,...payload}:i)};
    case "ADD_RFP":           return {...prev, rfps:[payload,...prev.rfps]};
    case "UPDATE_RFP":        return {...prev, rfps:prev.rfps.map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "UPDATE_REORDER":    return {...prev, reorders:prev.reorders.map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "SET_CONTACTS":      return {...prev, contacts:payload};
    case "ADD_CONTACTS":      return {...prev, contacts:[...payload,...(prev.contacts||[])]};
    case "ADD_ALERT":         return {...prev, alerts:[{id:mkId(),ts:Date.now(),sent:false,...payload},...prev.alerts.slice(0,49)]};
    case "DISMISS_ALERT":     return {...prev, alerts:prev.alerts.map(a=>a.id===payload?{...a,sent:true}:a)};
    case "LOG":               return {...prev, activity:[{id:mkId(),ts:Date.now(),userId:prev.currentUserId,...payload},...prev.activity.slice(0,199)]};
    case "SAVE_INTEGRATIONS": return {...prev, integrations:{...prev.integrations,...payload}};
    case "RESET":             return {...SEED, currentUserId:prev.currentUserId, integrations:prev.integrations};
    default:                  return prev;
  }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEAL_STAGES = ["Quoted","Follow-Up 1","Follow-Up 2","Negotiating","PO Received","Closed Won","Closed Lost","On Hold"];
const RFP_STAGES  = ["Received","Reviewing","Pricing","Building Response","Submitted","Won","Lost","No Bid"];
const DSC = {Quoted:B.blue,"Follow-Up 1":B.purple,"Follow-Up 2":B.orange,Negotiating:B.yellow,"PO Received":B.teal,"Closed Won":B.green,"Closed Lost":B.red,"On Hold":B.muted};
const DBG = {Quoted:B.blueBg,"Follow-Up 1":B.purpleBg,"Follow-Up 2":B.orangeBg,Negotiating:B.yellowBg,"PO Received":B.tealBg,"Closed Won":B.greenBg,"Closed Lost":B.redBg,"On Hold":B.surface};
const RSC = {Received:B.blue,Reviewing:B.purple,Pricing:B.orange,"Building Response":B.yellow,Submitted:B.teal,Won:B.green,Lost:B.red,"No Bid":B.muted};
const ISC = {draft:{c:B.muted,bg:B.surface},sent:{c:B.blue,bg:B.blueBg},viewed:{c:B.purple,bg:B.purpleBg},partial:{c:B.yellow,bg:B.yellowBg},paid:{c:B.green,bg:B.greenBg},overdue:{c:B.red,bg:B.redBg}};
const ST1 = `ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa. Owner: Matt Stone (matt@st1sports.com, 719-256-0275). Brands: Blazer, Gill Athletics, Diamond, All-Star, Molten, Wilson, DeMarini, Louisville Slugger, FinishLynx, Pro-Nine. Markets: Iowa, Colorado, Minnesota (BWTF), North Dakota (BWTF). Acquired Bruce Whiting Track & Field. Sells to K-12 school districts, ADs, coaches.`;
const SPORTS_LIST = ["Track & Field","Baseball","Softball","Volleyball","Cross Country","Football","Basketball","Wrestling"];
const STATES_LIST = ["IA","CO","MN","ND","WI","NE","SD","KS","IL","MO"];
const PRODUCT_CATS = ["Track & Field Equipment","Baseball / Softball","Volleyball","Timing Systems","Custom Team Stores","Apparel","Competition Spikes","Cross Country","Other"];
const CLUB_ROLES = ["Club Director","Program Coordinator","League Administrator","Head Coach","Travel Team Director","Tournament Director","Activities Coordinator"];

function urgentCount(s) {
  return s.deals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0).length
    + s.invoices.filter(i=>i.status==="overdue").length
    + s.rfps.filter(r=>!["Won","Lost","No Bid"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=3).length;
}

// ════════════════════════════════════════════════════════════════════════════
//  ROOT
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [s, set] = useStore();
  const [mod, setMod]   = useState("briefing");
  const [slim, setSlim] = useState(false);
  const [toasts, setToasts] = useState([]);

  const dispatch = useCallback((action, payload) => {
    set(prev => reducer(prev, action, payload));
  }, [set]);

  const toast = useCallback((msg, type="info") => {
    const id = mkId();
    setToasts(t=>[{id,msg,type},...t.slice(0,3)]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 4000);
  }, []);

  const cu = USERS.find(u=>u.id===s.currentUserId);
  const ctx = {s, dispatch, toast, cu, mod, setMod};

  if (!s.currentUserId) return <Login dispatch={dispatch}/>;

  const NAV = [
    {id:"briefing",   icon:"◈", label:"Daily Briefing",  badge:urgentCount(s)},
    {id:"deals",      icon:"◫", label:"Deal Manager"},
    {id:"rfp",        icon:"⊘", label:"RFP / Bids",      badge:s.rfps.filter(r=>!["Won","Lost","No Bid"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=7).length},
    {id:"invoicing",  icon:"▲", label:"Invoices & AR",   badge:s.invoices.filter(i=>i.status==="overdue").length},
    {id:"reorder",    icon:"↺", label:"Reorder Engine",  badge:s.reorders.filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date())).length},
    {id:"prospecting",icon:"⊕", label:"Prospecting"},
    {id:"marketing",  icon:"✦", label:"Marketing"},
    {id:"compete",    icon:"⊗", label:"Competitors"},
    {id:"agent",      icon:"AI",label:"AI Agent"},
    {id:"alerts",     icon:"◎", label:"Alerts",          badge:s.alerts.filter(a=>!a.sent).length},
    {id:"activity",   icon:"≡", label:"Activity"},
    {id:"settings",   icon:"⚙", label:"Settings"},
    // External standalone tools — open in same tab
    {id:"_div"},
    {id:"rfp-tool",   icon:"📋", label:"RFP Automation",  href:"/rfp"},
    {id:"prices",     icon:"$",  label:"Price Manager",    href:"/prices"},
    {id:"expansion",  icon:"◉",  label:"Expansion Planner",href:"/expansion"},
    {id:"integrations",icon:"⚡",label:"Integrations",     href:"/integrations"},
  ];

  return (
    <AppCtx.Provider value={ctx}>
      <div style={{display:"flex",height:"100vh",background:B.pageBg,overflow:"hidden",fontFamily:"'Lexend',sans-serif",color:B.text}}>
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
          .card{background:${B.white};border:1px solid ${B.border};border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        `}</style>

        {/* SIDEBAR */}
        <aside style={{width:slim?52:208,background:B.white,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0,transition:"width .18s",overflow:"hidden",boxShadow:"1px 0 4px rgba(0,0,0,.04)"}}>
          <div style={{padding:"14px 10px 12px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:slim?"center":"space-between",minHeight:60}}>
            {!slim&&<div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:30,height:30,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white,letterSpacing:-1}}>ST1</span>
              </div>
              <div>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.black,letterSpacing:.3}}>ST1 SPORTS</div>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:6,color:B.orange,letterSpacing:2}}>REVOPS</div>
              </div>
            </div>}
            {slim&&<div style={{width:30,height:30,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white,letterSpacing:-1}}>ST1</span>
            </div>}
            <button onClick={()=>setSlim(c=>!c)} style={{background:"none",border:"none",color:B.muted,fontSize:13,padding:2,flexShrink:0,marginLeft:slim?0:2}}>{slim?"→":"←"}</button>
          </div>

          <nav style={{flex:1,overflowY:"auto",overflowX:"hidden",paddingTop:4}}>
            {NAV.map(n=>{
              // Divider
              if(n.id==="_div") return <div key="_div" style={{height:1,background:B.border,margin:"6px 8px"}}/>;
              // External link (standalone tools)
              if(n.href) return (
                <a key={n.id} href={n.href} title={slim?n.label:undefined}
                  style={{display:"flex",textDecoration:"none",width:"100%",background:"transparent",borderLeft:`3px solid transparent`,color:B.muted,padding:slim?"9px 0":"8px 11px 8px 10px",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:400}}>
                  <span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
                  {!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n.label}</span>}
                  {!slim&&<span style={{marginLeft:"auto",fontSize:9,color:B.muted,flexShrink:0}}>↗</span>}
                </a>
              );
              // Normal nav item
              return (
                <button key={n.id} onClick={()=>setMod(n.id)} title={slim?n.label:undefined}
                  style={{width:"100%",background:mod===n.id?`${B.orange}14`:"transparent",border:"none",borderLeft:`3px solid ${mod===n.id?B.orange:"transparent"}`,color:mod===n.id?B.orange:B.muted,padding:slim?"9px 0":"8px 11px 8px 10px",display:"flex",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:mod===n.id?500:400,textAlign:"left",position:"relative"}}>
                  <span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
                  {!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n.label}</span>}
                  {!slim&&n.badge>0&&<span style={{marginLeft:"auto",background:n.id==="invoicing"?B.red:B.orange,color:B.white,borderRadius:10,padding:"1px 5px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,flexShrink:0}}>{n.badge}</span>}
                  {slim&&n.badge>0&&<span style={{position:"absolute",top:5,right:5,background:B.orange,color:B.white,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{n.badge}</span>}
                </button>
              );
            })}
          </nav>

          {cu&&!slim&&<div style={{padding:"9px 11px",borderTop:`1px solid ${B.border}`,display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cu.name}</div>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:6,color:B.muted,letterSpacing:1}}>{cu.role.toUpperCase()}</div>
            </div>
            <button onClick={()=>dispatch("LOGOUT")} style={{background:"none",border:"none",color:B.muted,fontSize:11,lineHeight:1}}>⏻</button>
          </div>}
          {cu&&slim&&<div style={{padding:"8px 0",borderTop:`1px solid ${B.border}`,display:"flex",justifyContent:"center"}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={()=>dispatch("LOGOUT")}>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
            </div>
          </div>}
        </aside>

        {/* MAIN */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <header style={{background:B.white,borderBottom:`1px solid ${B.border}`,height:46,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 22px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>{NAV.find(n=>n.id===mod)?.label?.toUpperCase()}</div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              {[["Books",s.integrations.zohoToken],[" CRM",s.integrations.zohoCrmToken],["Slack",s.integrations.slackChannel]].map(([l,v])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                  <div className={v?"":"blink"} style={{width:6,height:6,borderRadius:"50%",background:v?B.green:B.muted}}/>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{l}</span>
                </div>
              ))}
              <div style={{width:1,height:14,background:B.border}}/>
              <button onClick={()=>setMod("alerts")} style={{background:"none",border:"none",color:s.alerts.filter(a=>!a.sent).length?B.orange:B.muted,fontSize:13,position:"relative",padding:2}}>
                ◎
                {s.alerts.filter(a=>!a.sent).length>0&&<span style={{position:"absolute",top:-3,right:-3,background:B.orange,color:B.white,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{s.alerts.filter(a=>!a.sent).length}</span>}
              </button>
            </div>
          </header>

          <main style={{flex:1,overflowY:"auto",background:B.pageBg}}>
            {mod==="briefing"    && <ModBriefing/>}
            {mod==="deals"       && <ModDeals/>}
            {mod==="rfp"         && <ModRFP/>}
            {mod==="invoicing"   && <ModInvoicing/>}
            {mod==="reorder"     && <ModReorder/>}
            {mod==="prospecting" && <ModProspecting/>}
            {mod==="marketing"   && <ModMarketing/>}
            {mod==="compete"     && <ModCompete/>}
            {mod==="agent"       && <ModAgent/>}
            {mod==="alerts"      && <ModAlerts/>}
            {mod==="activity"    && <ModActivity/>}
            {mod==="settings"    && <ModSettings/>}
          </main>
        </div>

        {/* TOASTS */}
        <div style={{position:"fixed",top:14,right:14,display:"flex",flexDirection:"column",gap:7,zIndex:9999,pointerEvents:"none"}}>
          {toasts.map(t=>(
            <div key={t.id} className="fu" style={{background:B.white,border:`1px solid ${B.border}`,borderLeft:`3px solid ${t.type==="success"?B.green:t.type==="error"?B.red:B.orange}`,borderRadius:6,padding:"9px 13px",boxShadow:"0 4px 14px rgba(0,0,0,.1)",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,maxWidth:300}}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({dispatch}) {
  const [sel,setSel]=useState(null);
  const [pin,setPin]=useState("");
  const [shake,setShake]=useState(false);
  const PINS={matt:"1234",rep2:"2345",rep3:"3456"};
  const doLogin=()=>{
    if(!sel) return;
    if(PINS[sel.id]===pin){dispatch("LOGIN",sel.id);}
    else{setPin("");setShake(true);setTimeout(()=>setShake(false),500);}
  };
  return (
    <div style={{minHeight:"100vh",background:B.pageBg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lexend',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s}button:hover{opacity:.82}input{font-family:'Lexend',sans-serif;outline:none}@keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes shk{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}.fu{animation:fu .3s}.shk{animation:shk .3s}`}</style>
      <div className="fu" style={{width:360,background:B.white,border:`1px solid ${B.border}`,borderRadius:12,padding:30,boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        <div style={{textAlign:"center",marginBottom:26}}>
          <div style={{width:50,height:50,background:B.orange,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:19,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:19,color:B.black,letterSpacing:.3}}>ST1 RevOps</div>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:3,marginTop:3}}>SIGN IN</div>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:7}}>SELECT USER</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {USERS.map(u=>(
              <button key={u.id} onClick={()=>{setSel(u);setPin("");}}
                style={{background:sel?.id===u.id?`${u.color}10`:B.surface,border:`1px solid ${sel?.id===u.id?u.color:B.border}`,borderRadius:6,padding:"9px 13px",display:"flex",alignItems:"center",gap:9,textAlign:"left"}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:u.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:B.white}}>{u.initials}</span>
                </div>
                <div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{u.name}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.email}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {sel&&(
          <div className={shake?"shk fu":"fu"} style={{marginBottom:14}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:5}}>PIN</div>
            <input type="password" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}
              placeholder={`Demo: ${sel.id==="matt"?"1234":sel.id==="rep2"?"2345":"3456"}`} maxLength={4}
              style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"10px 12px",fontSize:15,letterSpacing:6,textAlign:"center"}}/>
          </div>
        )}
        <button onClick={doLogin} disabled={!sel||pin.length<4}
          style={{width:"100%",background:sel&&pin.length>=4?B.orange:B.border,color:sel&&pin.length>=4?B.white:B.muted,border:"none",borderRadius:6,padding:"11px",fontFamily:"'Russo One',sans-serif",fontSize:13,letterSpacing:.5}}>
          SIGN IN →
        </button>
      </div>
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function PH({title,sub,action}){return <div style={{marginBottom:18,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}><div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3,lineHeight:1.1}}>{title}</div>{sub&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:3}}>{sub}</div>}<div style={{width:30,height:3,background:B.orange,marginTop:7,borderRadius:2}}/></div>{action}</div>;}
function Lbl({c,s={},children}){return <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c||B.muted,letterSpacing:2.5,textTransform:"uppercase",...s}}>{children}</div>;}
function OBtn({children,onClick,disabled,sm,col,style={}}){const c=col||B.orange;return <button onClick={onClick} disabled={disabled} style={{background:disabled?B.border:c,color:disabled?B.muted:B.white,border:"none",borderRadius:5,padding:sm?"5px 11px":"8px 16px",fontSize:sm?10:11,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:disabled?"not-allowed":"pointer",...style}}>{children}</button>;}
function GBtn({children,onClick,style={}}){return <button onClick={onClick} style={{background:B.white,color:B.textMid,border:`1px solid ${B.borderD}`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif",...style}}>{children}</button>;}
function Pill({v,sc,bc}){const c=(sc||{})[v]||B.muted;const bg=(bc||{})[v]||B.surface;return <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c,background:bg,padding:"2px 6px",borderRadius:3,letterSpacing:.5,whiteSpace:"nowrap"}}>{v?.toUpperCase()}</span>;}
function UCh({uid}){const u=USERS.find(x=>x.id===uid);if(!u)return null;return <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:16,height:16,borderRadius:"50%",background:u.color,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:6,color:B.white}}>{u.initials}</span></div><span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.name.split(" ")[0]}</span></div>;}
function Spin(){return <div style={{width:18,height:18,border:`2px solid ${B.border}`,borderTop:`2px solid ${B.orange}`,borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0}}/>;}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KCard({l,v,c,sub,onClick}){return <div onClick={onClick} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"12px 14px",borderTop:`2px solid ${c}`,textAlign:"center",cursor:onClick?"pointer":"default",boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:21,color:c,letterSpacing:.3}}>{v}</div><Lbl s={{marginTop:3}}>{l}</Lbl>{sub&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{sub}</div>}</div>;}

// ════════════════════════════════════════════════════════════════════════════
//  BRIEFING
// ════════════════════════════════════════════════════════════════════════════
function ModBriefing() {
  const {s,dispatch,cu,setMod}=useApp();
  const [advice,setAdvice]=useState("");
  const [loadAdv,setLoadAdv]=useState(false);

  const isOwner=cu?.role==="owner";
  const myDeals=isOwner?s.deals:s.deals.filter(d=>d.assignee===cu?.id);
  const myInv  =isOwner?s.invoices:s.invoices.filter(i=>i.assignee===cu?.id);
  const myRfps =isOwner?s.rfps:s.rfps.filter(r=>r.assignee===cu?.id);

  const overdueDeals=myDeals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0);
  const dueDeals    =myDeals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)>=0&&dUntil(d.followUpDate)<=1);
  const overdueInv  =myInv.filter(i=>i.status==="overdue");
  const rfpsDue     =myRfps.filter(r=>!["Won","Lost","No Bid"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=7);
  const pos         =myDeals.filter(d=>d.stage==="PO Received");
  const pipeline    =myDeals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).reduce((a,d)=>a+d.value,0);
  const ar          =myInv.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);

  const getAdvice=async()=>{
    setLoadAdv(true);
    const t=await aiCall(`Daily sales coaching for Matt Stone at ST1 Sports.
${ST1}
Situation right now: ${overdueDeals.length} overdue follow-ups (${fmt$(overdueDeals.reduce((a,d)=>a+d.value,0))}), ${overdueInv.length} overdue invoices (${fmt$(overdueInv.reduce((a,i)=>a+(i.balance||0),0))}), ${rfpsDue.length} RFPs due this week, ${pos.length} POs to fulfill. Pipeline: ${fmt$(pipeline)}. AR: ${fmt$(ar)}.
Top deals: ${myDeals.filter(d=>d.priority==="hot"&&!["Closed Won","Closed Lost"].includes(d.stage)).slice(0,3).map(d=>d.name).join(", ")}.
Give 3-4 specific actions ranked by revenue impact. Under 120 words. Be direct.`);
    setAdvice(t||"");setLoadAdv(false);
  };

  const Sec=({label,col,n,children})=>n===0?null:<div style={{marginBottom:16}}><div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}><div style={{width:7,height:7,borderRadius:2,background:col,flexShrink:0}}/><Lbl c={col}>{label} ({n})</Lbl></div>{children}</div>;
  const Row=({d,col,sub,val,go,label})=>(
    <div className="card" style={{padding:"9px 12px",marginBottom:6,borderLeft:`3px solid ${col}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{sub}</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,marginLeft:10}}>
          <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:col}}>{val}</span>
          {go&&<OBtn sm onClick={go}>{label||"OPEN →"}</OBtn>}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{padding:"22px 26px"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:21,color:B.black,letterSpacing:.3}}>GOOD {new Date().getHours()<12?"MORNING":new Date().getHours()<17?"AFTERNOON":"EVENING"}, {cu?.name.split(" ")[0].toUpperCase()}</div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
        <div style={{width:34,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:11,marginBottom:20}}>
        <KCard l="Open Pipeline"  v={fmt$(pipeline)} c={B.orange} onClick={()=>setMod("deals")}/>
        <KCard l="Accounts Receivable" v={fmt$(ar)} c={B.red} onClick={()=>setMod("invoicing")}/>
        <KCard l="Actions Needed" v={overdueDeals.length+overdueInv.length+rfpsDue.length} c={overdueDeals.length>0?B.red:B.yellow}/>
        <KCard l="Hot Deals" v={myDeals.filter(d=>d.priority==="hot"&&!["Closed Won","Closed Lost"].includes(d.stage)).length} c={B.green} onClick={()=>setMod("deals")}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16}}>
        <div>
          <Sec label="OVERDUE FOLLOW-UPS" col={B.red} n={overdueDeals.length}>
            {overdueDeals.map(d=><Row key={d.id} d={d.name} sub={`${d.contact} · ${Math.abs(dUntil(d.followUpDate))}d overdue`} val={fmt$(d.value)} col={B.red} go={()=>setMod("deals")}/>)}
          </Sec>
          <Sec label="DUE TODAY / TOMORROW" col={B.orange} n={dueDeals.length}>
            {dueDeals.map(d=><Row key={d.id} d={d.name} sub={`${d.contact} · ${d.stage}`} val={fmt$(d.value)} col={B.orange}/>)}
          </Sec>
          <Sec label="OVERDUE INVOICES" col={B.red} n={overdueInv.length}>
            {overdueInv.map(i=><Row key={i.id} d={i.customer} sub={`${i.number} · ${dAgo(i.dueDate)}d overdue`} val={fmt$(i.balance)} col={B.red} go={()=>setMod("invoicing")} label="REMIND →"/>)}
          </Sec>
          <Sec label="RFPs DUE THIS WEEK" col={B.yellow} n={rfpsDue.length}>
            {rfpsDue.map(r=>{const d=dUntil(r.dueDate);const dn=r.checklist?.filter(c=>c.done).length||0;const tn=r.checklist?.length||1;return(
              <div key={r.id} className="card" style={{padding:"9px 12px",marginBottom:6,borderLeft:`3px solid ${d<=3?B.red:B.yellow}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{r.title}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{r.bidId} · {dn}/{tn} checklist</div></div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:d<=3?B.red:B.yellow}}>{d}d</div><OBtn sm onClick={()=>setMod("rfp")}>OPEN →</OBtn></div>
                </div>
              </div>
            );})}
          </Sec>
          {pos.length>0&&<Sec label="POs TO FULFILL" col={B.teal} n={pos.length}>
            {pos.map(d=><Row key={d.id} d={d.name} sub={d.notes?.slice(0,50)} val={fmt$(d.value)} col={B.teal} go={()=>dispatch("UPDATE_DEAL",{id:d.id,stage:"Closed Won"})} label="FULFILL ✓"/>)}
          </Sec>}
          {overdueDeals.length===0&&dueDeals.length===0&&overdueInv.length===0&&rfpsDue.length===0&&pos.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.border,marginBottom:6}}>ALL CLEAR</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Nothing urgent. Check pipeline for proactive opportunities.</div></div>
          )}
        </div>

        <div>
          <div className="card" style={{padding:14,marginBottom:12}}>
            <Lbl s={{marginBottom:9}}>AI Coach — Today's Priorities</Lbl>
            {!advice&&!loadAdv&&<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:9,lineHeight:1.6}}>Get a prioritized action plan based on your pipeline, invoices, and deadlines.</div><OBtn onClick={getAdvice} style={{width:"100%"}}>✦ GET TODAY'S PLAN</OBtn></div>}
            {loadAdv&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.yellow}}><Spin/>Analyzing...</div>}
            {advice&&<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap",marginBottom:8}}>{advice}</div><GBtn onClick={getAdvice} style={{width:"100%",fontSize:10}}>↺ REFRESH</GBtn></div>}
          </div>
          <div className="card" style={{padding:14,marginBottom:12}}>
            <Lbl s={{marginBottom:10}}>Win Rate by Product</Lbl>
            {(()=>{
              const wonDeals = s.deals.filter(d=>d.stage==="Closed Won");
              const totalClosed = s.deals.filter(d=>["Closed Won","Closed Lost"].includes(d.stage));
              if(totalClosed.length===0) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Win data appears as deals close</div>;
              const cats = PRODUCT_CATS.map(cat=>{
                const won  = wonDeals.filter(d=>d.product===cat);
                const lost = s.deals.filter(d=>d.stage==="Closed Lost"&&d.product===cat);
                const rate = (won.length+lost.length)>0 ? Math.round(won.length/(won.length+lost.length)*100) : null;
                const rev  = won.reduce((a,d)=>a+d.value,0);
                return {cat,won:won.length,lost:lost.length,rate,rev};
              }).filter(c=>c.won+c.lost>0).sort((a,b)=>b.rev-a.rev);
              if(cats.length===0) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Win data appears as deals close</div>;
              const maxRev = Math.max(...cats.map(c=>c.rev),1);
              return cats.map(({cat,won,lost,rate,rev})=>(
                <div key={cat} style={{marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,fontWeight:500}}>{cat}</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{won}W / {lost}L {rate!==null?`· ${rate}%`:""}</span>
                  </div>
                  <div style={{height:5,background:B.border,borderRadius:3}}>
                    <div style={{height:"100%",width:`${Math.round(rev/maxRev*100)}%`,background:rate>=60?B.green:rate>=40?B.orange:B.red,borderRadius:3,transition:"width .4s"}}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{fmt$(rev)} won</div>
                </div>
              ));
            })()}
          </div>
          <div className="card" style={{padding:14}}>
            <Lbl s={{marginBottom:9}}>Recent Activity</Lbl>
            {s.activity.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Activity appears as you use the platform</div>}
            {s.activity.slice(0,8).map(a=>{const u=USERS.find(x=>x.id===a.userId);return(
              <div key={a.id} style={{display:"flex",gap:7,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                {u&&<div style={{width:18,height:18,borderRadius:"50%",background:u.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:7,color:B.white}}>{u.initials}</span></div>}
                <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.4}}>{a.msg}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{dAgo(new Date(a.ts).toISOString().slice(0,10))===0?"Today":dAgo(new Date(a.ts).toISOString().slice(0,10))+"d ago"}</div></div>
              </div>
            );})}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  DEALS
// ════════════════════════════════════════════════════════════════════════════
function ModDeals() {
  const {s,dispatch,toast,cu}=useApp();
  const [flt,setFlt]=useState("active");
  const [sel,setSel]=useState(null);
  const [adding,setAdding]=useState(false);
  const [note,setNote]=useState("");
  const [drafting,setDrafting]=useState(false);
  const [draft,setDraft]=useState("");
  const [form,setForm]=useState({name:"",contact:"",school:"",state:"IA",stage:"Quoted",value:"",product:"Track & Field Equipment",assignee:cu?.id||"matt",quoteDate:today(),followUpDate:"",notes:""});
  const isOwner=cu?.role==="owner";
  const pool=isOwner?s.deals:s.deals.filter(d=>d.assignee===cu?.id);
  const list=pool.filter(d=>{
    if(flt==="active") return !["Closed Won","Closed Lost","On Hold"].includes(d.stage);
    if(flt==="overdue") return d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received"].includes(d.stage);
    if(flt==="won") return d.stage==="Closed Won";
    if(flt==="all") return true;
    return d.stage===flt;
  }).sort((a,b)=>b.value-a.value);
  const sel_d=sel?s.deals.find(d=>d.id===sel):null;

  const addDeal=()=>{
    if(!form.name) return;
    const d={...form,id:mkId(),value:Number(form.value||0),lastTouch:Date.now(),priority:"warm",touchHistory:[{id:mkId(),type:"quote",date:form.quoteDate||today(),note:"Quote sent",author:form.assignee}],competitor:null,zoho_synced:false};
    dispatch("ADD_DEAL",d);dispatch("LOG",{msg:`${cu?.name} added deal: ${d.name}`});
    toast("Deal added","success");setAdding(false);
  };
  const logTouch=()=>{
    if(!note.trim()||!sel_d) return;
    dispatch("UPDATE_DEAL",{id:sel_d.id,touchHistory:[...(sel_d.touchHistory||[]),{id:mkId(),type:"note",date:today(),note,author:cu?.id}],followUpDate:new Date(Date.now()+86400000*7).toISOString().slice(0,10)});
    dispatch("LOG",{msg:`${cu?.name} logged touch on ${sel_d.name}: ${note}`});
    setNote("");toast("Touch logged","success");
  };
  const draftEmail=async()=>{
    if(!sel_d) return;setDrafting(true);setDraft("");
    const t=await aiCall(`Write a follow-up email from Matt Stone at ST1 Sports (matt@st1sports.com, 719-256-0275, st1sports.com).
Deal: ${sel_d.name} | Contact: ${sel_d.contact} at ${sel_d.school}, ${sel_d.state}
Stage: ${sel_d.stage} | Value: ${fmt$(sel_d.value)} | Notes: ${sel_d.notes}
Recent touches: ${(sel_d.touchHistory||[]).slice(-2).map(t=>t.note).join("; ")}
${(sel_d.state==="MN"||sel_d.state==="ND")?"BWTF territory — use Bruce Whiting acquisition as hook.":""}
Under 80 words. Include subject line. Warm tone.`);
    setDraft(t||"");setDrafting(false);
  };
  const pipe=pool.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).reduce((a,d)=>a+d.value,0);
  const won=pool.filter(d=>d.stage==="Closed Won").reduce((a,d)=>a+d.value,0);

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="DEAL MANAGER" sub="Track every opportunity · log touches · manage follow-ups" action={<OBtn onClick={()=>setAdding(true)}>+ NEW DEAL</OBtn>}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:16}}>
        <KCard l="Open Pipeline" v={fmt$(pipe)} c={B.orange}/>
        <KCard l="Closed Won"    v={fmt$(won)}  c={B.green}/>
        <KCard l="Active Deals"  v={pool.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).length} c={B.blue}/>
      </div>
      <div style={{display:"flex",gap:5,marginBottom:13,flexWrap:"wrap"}}>
        {[["active","Active"],["overdue","Overdue ⚠"],["all","All"],...DEAL_STAGES.map(s=>[s,s])].map(([v,l])=>(
          <button key={v} onClick={()=>setFlt(v)} style={{background:flt===v?B.orange:B.white,color:flt===v?B.white:B.muted,border:`1px solid ${flt===v?B.orange:B.border}`,borderRadius:4,padding:"4px 9px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{l}</button>
        ))}
      </div>
      {adding&&(
        <div className="card fu" style={{padding:14,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
          <Lbl c={B.orange} s={{marginBottom:10}}>New Deal</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9}}>
            {[["Deal Name","name"],["Contact","contact"],["School","school"],["Value ($)","value"],["Quote Date","quoteDate"],["Follow-Up Date","followUpDate"],["Notes","notes"]].map(([l,k])=>(
              <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><input type={k.includes("Date")?"date":"text"} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
            ))}
            {[["Stage",DEAL_STAGES,"stage"],["Product",PRODUCT_CATS,"product"],["State",STATES_LIST,"state"],["Assignee",USERS.map(u=>u.id),"assignee"]].map(([l,opts,k])=>(
              <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>
            ))}
          </div>
          <div style={{display:"flex",gap:7,marginTop:10}}><OBtn onClick={addDeal}>SAVE</OBtn><GBtn onClick={()=>setAdding(false)}>CANCEL</GBtn></div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:sel_d?"1fr 370px":"1fr",gap:13}}>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {list.map(d=>{const ov=d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage);return(
            <div key={d.id} onClick={()=>setSel(sel===d.id?null:d.id)} className="card" style={{padding:"9px 12px",cursor:"pointer",borderLeft:`3px solid ${DSC[d.stage]||B.muted}`,background:sel===d.id?B.surface:B.white}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d.name}</span>
                    <Pill v={d.stage} sc={DSC} bc={DBG}/>
                    {(d.state==="MN"||d.state==="ND")&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,padding:"2px 5px",borderRadius:3}}>BWTF</span>}
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{d.contact} · {d.school} · {d.state}</div>
                  <div style={{display:"flex",gap:7,marginTop:3,alignItems:"center"}}>
                    <UCh uid={d.assignee}/>
                    {d.followUpDate&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:ov?B.red:dUntil(d.followUpDate)<=2?B.yellow:B.muted,letterSpacing:.3}}>{ov?`${Math.abs(dUntil(d.followUpDate))}d OVERDUE`:dUntil(d.followUpDate)===0?"TODAY":fmtD(d.followUpDate)}</span>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:9}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.orange}}>{fmt$(d.value)}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{d.touchHistory?.length||0} touches</div>
                </div>
              </div>
            </div>
          );})}
          {list.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"40px 0"}}>No deals in this filter</div>}
        </div>

        {sel_d&&(
          <div style={{display:"flex",flexDirection:"column",gap:11,position:"sticky",top:0,maxHeight:"calc(100vh - 155px)",overflowY:"auto"}}>
            <div className="card" style={{padding:13,borderTop:`3px solid ${DSC[sel_d.stage]||B.orange}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:9}}>
                <div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,letterSpacing:.3}}>{sel_d.name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{sel_d.contact} · {sel_d.school}</div></div>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.orange}}>{fmt$(sel_d.value)}</div>
              </div>
              <Lbl s={{marginBottom:5}}>Move Stage</Lbl>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
                {DEAL_STAGES.map(st=>(
                  <button key={st} onClick={()=>{dispatch("UPDATE_DEAL",{id:sel_d.id,stage:st});dispatch("LOG",{msg:cu?.name+" moved "+sel_d.name+" → "+st});toast("Moved to "+st,"success");}} style={{background:sel_d.stage===st?DSC[st]:B.surface,color:sel_d.stage===st?B.white:B.muted,border:"1px solid "+(sel_d.stage===st?DSC[st]:B.border),borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{st}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:6,marginBottom:9}}>
                <input type="date" value={sel_d.followUpDate||""} onChange={e=>dispatch("UPDATE_DEAL",{id:sel_d.id,followUpDate:e.target.value})} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
                <GBtn onClick={()=>dispatch("UPDATE_DEAL",{id:sel_d.id,followUpDate:new Date(Date.now()+86400000*7).toISOString().slice(0,10)})} style={{fontSize:10,padding:"5px 8px"}}>+7d</GBtn>
              </div>
              <OBtn onClick={draftEmail} disabled={drafting} style={{width:"100%"}}>{drafting?"WRITING...":"✦ DRAFT FOLLOW-UP"}</OBtn>
              {draft&&<div style={{marginTop:9,background:B.surface,borderRadius:4,padding:9}}>
                <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={7} style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
                <GBtn onClick={()=>navigator.clipboard?.writeText(draft)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>
              </div>}
            </div>
            <div className="card" style={{padding:13}}>
              <Lbl s={{marginBottom:7}}>Touch History ({sel_d.touchHistory?.length||0})</Lbl>
              <div style={{display:"flex",gap:6,marginBottom:7}}>
                <input value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&logTouch()} placeholder="Log a call, email, note..." style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11}}/>
                <OBtn sm col={B.green} onClick={logTouch}>LOG</OBtn>
              </div>
              <div style={{maxHeight:160,overflowY:"auto"}}>
                {[...(sel_d.touchHistory||[])].reverse().map(t=>(
                  <div key={t.id} style={{display:"flex",gap:7,padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:{email:B.blue,call:B.green,note:B.yellow,po:B.teal,quote:B.orange}[t.type]||B.muted,marginTop:3,flexShrink:0}}/>
                    <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.4}}>{t.note}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{fmtD(t.date)} · {USERS.find(u=>u.id===t.author)?.name||t.author}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  RFP
// ════════════════════════════════════════════════════════════════════════════
function ModRFP() {
  const {s,dispatch,cu,toast}=useApp();
  const [sel,setSel]=useState(null);
  const [newItem,setNewItem]=useState("");
  const isOwner=cu?.role==="owner";
  const rfps=isOwner?s.rfps:s.rfps.filter(r=>r.assignee===cu?.id);
  const sel_r=sel?s.rfps.find(r=>r.id===sel):null;
  const toggleChk=(rid,cid)=>dispatch("UPDATE_RFP",{id:rid,checklist:s.rfps.find(r=>r.id===rid).checklist.map(c=>c.id===cid?{...c,done:!c.done}:c)});
  const addItem=(rid)=>{if(!newItem.trim())return;dispatch("UPDATE_RFP",{id:rid,checklist:[...(s.rfps.find(r=>r.id===rid)?.checklist||[]),{id:mkId(),item:newItem,done:false}]});setNewItem("");}

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="RFP / BID TRACKER" sub="Manage bids from receipt to award"/>
      <div style={{display:"grid",gridTemplateColumns:sel_r?"1fr 350px":"1fr",gap:13}}>
        <div>
          {rfps.map(r=>{const d=dUntil(r.dueDate);const dn=r.checklist?.filter(c=>c.done).length||0;const tn=r.checklist?.length||1;return(
            <div key={r.id} onClick={()=>setSel(sel===r.id?null:r.id)} className="card fu" style={{padding:"10px 13px",marginBottom:8,cursor:"pointer",borderLeft:`3px solid ${RSC[r.stage]||B.muted}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{r.title}</span>
                    <Pill v={r.stage} sc={RSC} bc={{}}/>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{r.bidId} · {r.issuer} · {r.state}</span><UCh uid={r.assignee}/></div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:9}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(r.value)}</div>
                  {r.dueDate&&!["Won","Lost","No Bid"].includes(r.stage)&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:d<=3?B.red:d<=7?B.yellow:B.muted,letterSpacing:.3}}>{d<0?`${Math.abs(d)}d OVER`:`${d}d LEFT`}</div>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <div style={{flex:1,height:3,background:B.border,borderRadius:2}}><div style={{width:`${dn/tn*100}%`,height:"100%",background:dn===tn?B.green:RSC[r.stage]||B.orange,borderRadius:2}}/></div>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,flexShrink:0}}>{dn}/{tn}</span>
              </div>
            </div>
          );})}
          {rfps.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"40px 0"}}>No RFPs yet</div>}
        </div>
        {sel_r&&(
          <div className="card" style={{padding:13,position:"sticky",top:0,maxHeight:"calc(100vh - 155px)",overflowY:"auto"}}>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,marginBottom:3}}>{sel_r.title}</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:11}}>{sel_r.bidId} · Due {fmtD(sel_r.dueDate)}</div>
            <Lbl s={{marginBottom:5}}>Stage</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:11}}>
              {RFP_STAGES.map(st=><button key={st} onClick={()=>{dispatch("UPDATE_RFP",{id:sel_r.id,stage:st});toast("RFP → "+st);}} style={{background:sel_r.stage===st?RSC[st]:B.surface,color:sel_r.stage===st?B.white:B.muted,border:"1px solid "+(sel_r.stage===st?RSC[st]:B.border),borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{st}</button>)}
            </div>
            <Lbl s={{marginBottom:7}}>Checklist</Lbl>
            {sel_r.checklist?.map(c=>(
              <label key={c.id} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>
                <input type="checkbox" checked={c.done} onChange={()=>toggleChk(sel_r.id,c.id)} style={{accentColor:B.orange,width:13,height:13}}/>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:c.done?B.muted:B.text,textDecoration:c.done?"line-through":"none"}}>{c.item}</span>
              </label>
            ))}
            <div style={{display:"flex",gap:6,marginTop:9}}>
              <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem(sel_r.id)} placeholder="Add checklist item..." style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11}}/>
              <OBtn sm onClick={()=>addItem(sel_r.id)}>+</OBtn>
            </div>
            {sel_r.notes&&<div style={{marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,fontStyle:"italic",lineHeight:1.6,borderTop:`1px solid ${B.border}`,paddingTop:9}}>{sel_r.notes}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  INVOICING
// ════════════════════════════════════════════════════════════════════════════
function ModInvoicing() {
  const {s,dispatch,toast,cu}=useApp();
  const [flt,setFlt]=useState("all");
  const [sel,setSel]=useState(null);
  const [drafts,setDrafts]=useState({});
  const [drafting,setDrafting]=useState(null);
  const isOwner=cu?.role==="owner";
  const pool=isOwner?s.invoices:s.invoices.filter(i=>i.assignee===cu?.id);
  const list=pool.filter(i=>flt==="all"||(flt==="overdue"&&i.status==="overdue")||(flt==="unpaid"&&["sent","viewed","partial"].includes(i.status))||(flt==="draft"&&i.status==="draft")||(flt==="paid"&&i.status==="paid")).sort((a,b)=>{const o={overdue:0,partial:1,viewed:2,sent:3,unpaid:4,draft:5,paid:6};return(o[a.status]??5)-(o[b.status]??5);});
  const ar=pool.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);
  const paid=pool.filter(i=>i.status==="paid").reduce((a,i)=>a+i.total,0);

  const draftRem=async(inv,type)=>{
    const k=inv.id+type;setDrafting(k);
    const dOD=dAgo(inv.dueDate);
    const t=await aiCall(`Write a${type==="gentle"?" friendly":type==="firm"?" firm":" final"} invoice reminder from Matt Stone at ST1 Sports.
Invoice ${inv.number} for ${fmt$(inv.balance)} to ${inv.customer}${type!=="gentle"?`, ${dOD} days overdue`:""}.
Under 70 words. Sign: Matt Stone | ST1 Sports | matt@st1sports.com`);
    setDrafts(d=>({...d,[k]:t||""}));setDrafting(null);
  };
  const markSent=inv=>{dispatch("UPDATE_INVOICE",{id:inv.id,status:"sent",crmSynced:true});dispatch("LOG",{msg:`Invoice ${inv.number} sent to ${inv.customer} — CRM tagged Customer`});toast(inv.customer+" tagged Customer in CRM","success");};

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="INVOICES & AR" sub="Track payments · send reminders · sync customers to CRM"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:16}}>
        <KCard l="Accounts Receivable" v={fmt$(ar)} c={B.orange}/>
        <KCard l="Overdue" v={fmt$(pool.filter(i=>i.status==="overdue").reduce((a,i)=>a+(i.balance||0),0))} c={B.red}/>
        <KCard l="Collected" v={fmt$(paid)} c={B.green}/>
      </div>
      <div style={{display:"flex",gap:5,marginBottom:12}}>
        {[["all","All"],["overdue","Overdue"],["unpaid","Unpaid"],["draft","Draft"],["paid","Paid"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFlt(v)} style={{background:flt===v?B.orange:B.white,color:flt===v?B.white:B.muted,border:`1px solid ${flt===v?B.orange:B.border}`,borderRadius:4,padding:"4px 9px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{l}</button>
        ))}
      </div>
      {list.map(inv=>{const st=ISC[inv.status]||{c:B.muted,bg:B.surface};const isOD=inv.status==="overdue";const dOD=isOD?dAgo(inv.dueDate):0;const ex=sel===inv.id;return(
        <div key={inv.id} className="card fu" style={{marginBottom:8,borderLeft:`3px solid ${st.c}`,padding:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:11,padding:"9px 12px",cursor:"pointer",background:ex?B.surface:B.white}} onClick={()=>setSel(ex?null:inv.id)}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2,flexWrap:"wrap"}}>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{inv.customer}</span>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:st.c,background:st.bg,padding:"2px 6px",borderRadius:3,letterSpacing:.4}}>{inv.status?.toUpperCase()}{isOD?` · ${dOD}d`:""}</span>
                {inv.crmSynced&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>CRM ✓</span>}
                {!inv.crmSynced&&["sent","viewed","partial","paid"].includes(inv.status)&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.yellow,background:B.yellowBg,padding:"2px 5px",borderRadius:3}}>CRM SYNC</span>}
              </div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.number} · Due {fmtD(inv.dueDate)}</div>
            </div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange,flexShrink:0}}>{fmt$(inv.balance||inv.total)}</div>
          </div>
          {ex&&(
            <div style={{borderTop:`1px solid ${B.border}`,padding:"11px 12px",background:B.surface}}>
              <div style={{background:B.white,borderRadius:5,border:`1px solid ${B.border}`,marginBottom:9,overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <tbody>{(inv.items||[]).map((it,i)=>(
                    <tr key={i} style={{borderBottom:`1px solid ${B.border}`,background:i%2?B.surface:B.white}}>
                      <td style={{padding:"5px 9px",fontWeight:500}}>{it.name}</td>
                      <td style={{padding:"5px 9px",textAlign:"right",color:B.muted}}>{it.qty}</td>
                      <td style={{padding:"5px 9px",textAlign:"right",color:B.muted}}>{fmt$(it.rate)}</td>
                      <td style={{padding:"5px 9px",textAlign:"right",fontWeight:500}}>{fmt$(it.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:9}}>
                {inv.status==="draft"&&<OBtn sm onClick={()=>markSent(inv)}>✉ SEND + TAG CRM</OBtn>}
                {(isOD||["sent","viewed"].includes(inv.status))&&<OBtn sm onClick={()=>draftRem(inv,"gentle")} disabled={drafting===inv.id+"gentle"}>{drafting===inv.id+"gentle"?"...":"✦ DRAFT REMINDER"}</OBtn>}
                {isOD&&dOD>21&&<OBtn sm col={B.red} onClick={()=>draftRem(inv,dOD>35?"final":"firm")} disabled={!!drafting}>{dOD>35?"FINAL NOTICE":"2ND NOTICE"}</OBtn>}
                {!inv.crmSynced&&["sent","viewed","partial","paid"].includes(inv.status)&&<OBtn sm col={B.purple} onClick={()=>{dispatch("UPDATE_INVOICE",{id:inv.id,crmSynced:true});dispatch("LOG",{msg:inv.customer+" tagged Customer in CRM"});toast("CRM updated","success");}}>TAG CRM</OBtn>}
              </div>
              {["gentle","firm","final"].map(type=>{const k=inv.id+type;if(!drafts[k])return null;const lc={gentle:B.orange,firm:B.yellow,final:B.red};return(
                <div key={type} style={{background:B.white,borderRadius:4,padding:9,border:`1px solid ${B.border}`,marginBottom:6}}>
                  <Lbl c={lc[type]} s={{marginBottom:6}}>{type==="gentle"?"REMINDER":type==="firm"?"2ND NOTICE":"FINAL NOTICE"}</Lbl>
                  <textarea value={drafts[k]} onChange={e=>setDrafts(d=>({...d,[k]:e.target.value}))} rows={5} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
                  <GBtn onClick={()=>navigator.clipboard?.writeText(drafts[k])} style={{fontSize:10,padding:"3px 8px",marginTop:6}}>COPY</GBtn>
                </div>
              );})}
            </div>
          )}
        </div>
      );})}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  REORDER
// ════════════════════════════════════════════════════════════════════════════
function ModReorder() {
  const {s,dispatch,toast}=useApp();
  const [drafts,setDrafts]=useState({});
  const [drafting,setDrafting]=useState(null);
  const active=s.reorders.filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date()));
  const draftReo=async(r)=>{
    setDrafting(r.id);
    const t=await aiCall(`Write a short seasonal reorder email from Matt Stone at ST1 Sports (matt@st1sports.com, 719-256-0275, st1sports.com).
School: ${r.school} | Contact: ${r.contact}, ${r.state} | Sport: ${r.sport}
Last order: ${fmtD(r.lastOrderDate)} — ${r.lastItems?.join(", ")} — ${fmt$(r.lastOrderValue)}
${r.state==="MN"||r.state==="ND"?"Use BWTF/Bruce Whiting connection.":""}
Under 80 words. Reference exact last order. Ask if they need to restock. Warm tone.`);
    setDrafts(d=>({...d,[r.id]:t||""}));setDrafting(null);
  };
  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="REORDER ENGINE" sub={active.length>0?`${active.length} account${active.length!==1?"s":""} ready for seasonal outreach`:"All accounts up to date"}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:18}}>
        <KCard l="In Queue" v={active.length} c={B.orange}/>
        <KCard l="Sent" v={s.reorders.filter(r=>r.status==="sent").length} c={B.green}/>
        <KCard l="Snoozed" v={s.reorders.filter(r=>r.snoozedUntil&&new Date(r.snoozedUntil)>new Date()).length} c={B.muted}/>
      </div>
      {active.length===0&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.border,marginBottom:6}}>ALL CLEAR</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No reorder outreach needed right now</div></div>}
      {active.map(r=>(
        <div key={r.id} className="card fu" style={{padding:"11px 13px",marginBottom:10,borderLeft:`3px solid ${B.orange}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
            <div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500,marginBottom:2}}>{r.school}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{r.contact} · {r.state} · {r.sport}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>Last order: {fmtD(r.lastOrderDate)} · {r.lastItems?.slice(0,2).join(", ")} · {fmt$(r.lastOrderValue)}</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:11}}>
              <OBtn sm onClick={()=>draftReo(r)} disabled={drafting===r.id}>{drafting===r.id?"...":"✦ DRAFT"}</OBtn>
              <GBtn onClick={()=>{dispatch("UPDATE_REORDER",{id:r.id,snoozedUntil:new Date(Date.now()+86400000*30).toISOString().slice(0,10)});toast("Snoozed 30 days");}} style={{fontSize:10,padding:"4px 8px"}}>Snooze 30d</GBtn>
            </div>
          </div>
          {drafts[r.id]&&(
            <div style={{background:B.surface,borderRadius:4,padding:9,border:`1px solid ${B.border}`}}>
              <textarea value={drafts[r.id]} onChange={e=>setDrafts(d=>({...d,[r.id]:e.target.value}))} rows={6} style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
              <div style={{display:"flex",gap:6,marginTop:6}}>
                <GBtn onClick={()=>navigator.clipboard?.writeText(drafts[r.id])} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>
                <OBtn sm col={B.green} onClick={()=>{dispatch("UPDATE_REORDER",{id:r.id,status:"sent"});dispatch("LOG",{msg:`Reorder email sent to ${r.school} for ${r.sport}`});toast("Marked sent","success");}}>MARK SENT ✓</OBtn>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  PROSPECTING
// ════════════════════════════════════════════════════════════════════════════
const SCRAPE_TASK_ID = "prospecting_scrape";

function ModProspecting() {
  const {s,dispatch,toast}=useApp();
  const [view,setView]=useState("areas");
  const [areas,setAreas]=useState([{id:mkId(),name:"Iowa Track & Field ADs",states:["IA"],sports:["Track & Field"],orgType:"schools",roles:["Athletic Director","Head Track Coach"],maxOrgs:10,active:true}]);
  const [editing,setEditing]=useState(null);
  const [activeArea,setActiveArea]=useState(null);
  const abortRef=useRef(false);

  // Load persisted task state on mount
  const savedTask = bgTasks.getTask(SCRAPE_TASK_ID);
  const [phase,setPhase]     = useState(savedTask?.status==="running"?"scraping":savedTask?.status==="done"?"done":"idle");
  const [progress,setProgress] = useState(savedTask?.progress||0);
  const [schools,setSchools] = useState(savedTask?.orgs||[]);
  const [contacts,setContacts] = useState(savedTask?.contacts||[]);
  const [log,setLog]         = useState(savedTask?.log||[]);

  const addLog=(msg,type="info")=>{
    const entry={id:mkId(),msg,type,ts:Date.now()};
    setLog(l=>[entry,...l.slice(0,99)]);
    bgTasks.appendLog(SCRAPE_TASK_ID,msg,type);
  };
  const tog=(arr,v)=>arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];

  const runScrape=async(area)=>{
    setActiveArea(area);setView("results");setSchools([]);setContacts([]);setLog([]);setProgress(5);
    abortRef.current=false;setPhase("finding");
    const isClubs  = area.orgType==="clubs";
    const isBoth   = area.orgType==="both";
    const scopeDesc= `the state${area.states.length>1?"s":""} of ${area.states.join(" and ")}`;
    const bwtf     = area.states.some(s=>s==="MN"||s==="ND");
    const maxOrgs  = area.maxOrgs||area.maxSchools||10;

    bgTasks.createTask(SCRAPE_TASK_ID, `Prospecting: ${area.name}`);
    bgTasks.updateTask(SCRAPE_TASK_ID, { type:"scrape", progress:5, orgs:[], contacts:[] });

    let orgs = [];
    let allContacts = [];

    try {
      if(!isClubs) {
        addLog("Searching for schools...");
        const res = await aiCall(
          `Find public high schools and school districts in ${scopeDesc} with ${area.sports.join(", ")} programs. Use web search. Return JSON array (max ${isBoth?Math.ceil(maxOrgs/2):maxOrgs}): [{"name":"","district":"","city":"","state":"","website":"","orgType":"school","bwtf":${bwtf}}]`,
          {search:true,json:true,tokens:1400}
        );
        orgs = [...orgs,...(Array.isArray(res)?res:[]).map(o=>({...o,orgType:"school"}))];
        addLog(`Found ${orgs.length} schools`,"success");
      }

      if(isClubs||isBoth) {
        addLog("Searching for youth sports clubs...");
        const res = await aiCall(
          `Find youth sports clubs, travel teams, recreational leagues, and club programs in ${scopeDesc} for ${area.sports.join(", ")}. Include club teams, AAU, travel leagues, and recreational programs. Use web search. Return JSON array (max ${isBoth?Math.ceil(maxOrgs/2):maxOrgs}): [{"name":"","city":"","state":"","website":"","orgType":"club","bwtf":${bwtf}}]`,
          {search:true,json:true,tokens:1400}
        );
        orgs = [...orgs,...(Array.isArray(res)?res:[]).map(o=>({...o,orgType:"club"}))];
        addLog(`Found ${(Array.isArray(res)?res:[]).length} clubs`,"success");
      }

      const sl = orgs.slice(0,maxOrgs).map(o=>({...o,id:mkId(),status:"pending"}));
      setSchools(sl);setProgress(25);
      bgTasks.updateTask(SCRAPE_TASK_ID, { progress:25, orgs:sl });
      setPhase("scraping");

      for(let i=0;i<sl.length;i++){
        if(abortRef.current){addLog("Stopped");break;}
        const sc=sl[i];
        const isClubOrg = sc.orgType==="club";
        setSchools(ss=>ss.map(x=>x.id===sc.id?{...x,status:"scraping"}:x));
        addLog(`[${i+1}/${sl.length}] ${sc.name}, ${sc.city} (${isClubOrg?"club":"school"})`);
        const roles = area.roles?.length
          ? area.roles
          : isClubOrg ? CLUB_ROLES : ["Athletic Director","Head Coach","Procurement Manager"];
        const found=await aiCall(
          `Find ${roles.join(", ")} contacts at ${sc.name} in ${sc.city}, ${sc.state}. ${sc.website?"Website: "+sc.website:""} ${isClubOrg?"This is a youth sports club or league.":"Search their athletics staff directory."} Return JSON array (empty if none found): [{"firstName":"","lastName":"","fullName":"","title":"","school":"${sc.name}","orgType":"${sc.orgType||"school"}","city":"${sc.city}","state":"${sc.state}","email":"","phone":"","source":"","confidence":"high|medium|low","bwtf":${sc.bwtf||false}}]`,
          {search:true,json:true,tokens:1400}
        );
        if(Array.isArray(found)&&found.length>0){
          const valid=found.filter(c=>c.fullName||c.firstName).map(c=>({...c,id:mkId()}));
          allContacts=[...allContacts,...valid];
          setContacts(prev=>[...prev,...valid]);
          bgTasks.appendContacts(SCRAPE_TASK_ID, valid);
          setSchools(ss=>ss.map(x=>x.id===sc.id?{...x,status:"done",count:valid.length}:x));
          addLog(`  ✓ ${valid.length} found`,"success");
          if(valid.some(c=>c.bwtf))dispatch("ADD_ALERT",{msg:`BWTF contacts at ${sc.name}`,action:`${valid.length} contacts — use BWTF hook`});
        } else {
          setSchools(ss=>ss.map(x=>x.id===sc.id?{...x,status:"empty",count:0}:x));
          addLog(`  · none found`,"muted");
        }
        const prog=25+Math.round((i+1)/sl.length*70);
        setProgress(prog);
        bgTasks.updateTask(SCRAPE_TASK_ID, { progress:prog });
        await new Promise(r=>setTimeout(r,700));
      }
      setProgress(100);setPhase("done");
      addLog(`Complete — ${allContacts.length} contacts from ${sl.length} orgs`,"success");
      bgTasks.completeTask(SCRAPE_TASK_ID, { summary:`${allContacts.length} contacts from ${sl.length} orgs`, data:{ contacts:allContacts } });
      dispatch("ADD_CONTACTS",allContacts);
      toast(`${allContacts.length} contacts added to your database`,"success");
    } catch(err) {
      addLog(`Error: ${err.message}`,"error");
      bgTasks.failTask(SCRAPE_TASK_ID, err.message);
      setPhase("idle");
    }
  };

  const exportCsv=()=>{
    const h=["firstName","lastName","fullName","title","orgName","orgType","city","state","email","phone","source","confidence","bwtf"];
    const r=contacts.map(c=>[c.firstName||"",c.lastName||"",c.fullName||"",c.title||"",c.school||"",c.orgType||"school",c.city||"",c.state||"",c.email||"",c.phone||"",c.source||"",c.confidence||"",c.bwtf?"BWTF":""].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","));
    const csv=[h.join(","),...r].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`ST1_Contacts_${today()}.csv`;a.click();
  };

  const logC={success:B.green,warn:B.yellow,error:B.red,info:B.muted,muted:B.muted};
  const statDot={done:B.green,scraping:B.orange,empty:B.muted,pending:B.border};

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="PROSPECTING ENGINE" sub="Scrape real school contacts by sport, location, and role"
        action={<div style={{display:"flex",gap:6}}>{["areas","results"].map(v=><button key={v} onClick={()=>setView(v)} style={{background:view===v?B.orange:B.white,color:view===v?B.white:B.muted,border:`1px solid ${view===v?B.orange:B.border}`,borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{v==="areas"?"FOCUS AREAS":`RESULTS (${contacts.length})`}</button>)}</div>}/>

      {view==="areas"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Define target audiences — scrape each independently</div>
            <OBtn sm onClick={()=>setAreas(a=>[...a,{id:mkId(),name:"New Focus Area",states:[],sports:[],roles:[],maxSchools:10,active:true}])}>+ NEW AREA</OBtn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
            {areas.map(area=>(
              <div key={area.id} className="card" style={{padding:14,borderTop:`3px solid ${B.orange}`}}>
                {editing===area.id?(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <input value={area.name} onChange={e=>setAreas(as=>as.map(a=>a.id===area.id?{...a,name:e.target.value}:a))} style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,background:"none",border:"none",flex:1}}/>
                      <OBtn sm onClick={()=>setEditing(null)}>DONE</OBtn>
                    </div>
                    <div style={{marginBottom:10}}>
                      <Lbl s={{marginBottom:5}}>Target Type</Lbl>
                      <div style={{display:"flex",gap:4}}>
                        {[["schools","🏫 Schools"],["clubs","⚽ Youth Clubs"],["both","Both"]].map(([v,l])=>(
                          <button key={v} onClick={()=>setAreas(as=>as.map(a=>a.id===area.id?{...a,orgType:v}:a))}
                            style={{background:area.orgType===v?B.orange:B.white,color:area.orgType===v?B.white:B.muted,border:`1px solid ${area.orgType===v?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{l}</button>
                        ))}
                      </div>
                    </div>
                    {[["States",STATES_LIST,"states"],["Sports",SPORTS_LIST,"sports"]].map(([l,opts,k])=>(
                      <div key={k} style={{marginBottom:10}}>
                        <Lbl s={{marginBottom:5}}>{l}</Lbl>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {opts.map(o=><button key={o} onClick={()=>setAreas(as=>as.map(a=>a.id===area.id?{...a,[k]:tog(a[k]||[],o)}:a))} style={{background:(area[k]||[]).includes(o)?`${B.orange}15`:B.white,color:(area[k]||[]).includes(o)?B.orange:B.muted,border:`1px solid ${(area[k]||[]).includes(o)?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{o}</button>)}
                        </div>
                      </div>
                    ))}
                    <div style={{marginBottom:10}}>
                      <Lbl s={{marginBottom:5}}>Roles</Lbl>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {(area.orgType==="clubs"?CLUB_ROLES:area.orgType==="both"?[...["Athletic Director","Head Track Coach","Head Baseball Coach","Procurement Manager"],...CLUB_ROLES]:["Athletic Director","Head Track Coach","Head Baseball Coach","Head Softball Coach","Procurement Manager"]).map(o=>(
                          <button key={o} onClick={()=>setAreas(as=>as.map(a=>a.id===area.id?{...a,roles:tog(a.roles||[],o)}:a))} style={{background:(area.roles||[]).includes(o)?`${B.orange}15`:B.white,color:(area.roles||[]).includes(o)?B.orange:B.muted,border:`1px solid ${(area.roles||[]).includes(o)?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{o}</button>
                        ))}
                      </div>
                    </div>
                    <div><Lbl s={{marginBottom:4}}>Max Orgs</Lbl><select value={area.maxOrgs||area.maxSchools||10} onChange={e=>setAreas(as=>as.map(a=>a.id===area.id?{...a,maxOrgs:Number(e.target.value)}:a))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11}}>{[5,10,20,30].map(n=><option key={n}>{n}</option>)}</select></div>
                  </div>
                ):(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>{area.name}</div>
                      <GBtn onClick={()=>setEditing(area.id)} style={{fontSize:9,padding:"3px 8px"}}>EDIT</GBtn>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:7}}>
                      {(area.states||[]).map(st=><span key={st} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,background:B.orangeBg,padding:"2px 6px",borderRadius:3}}>{st}</span>)}
                      {(area.sports||[]).map(sp=><span key={sp} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{sp}</span>)}
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>
                      {area.orgType==="clubs"?"Youth Clubs":area.orgType==="both"?"Schools + Clubs":"Schools"} · {(area.roles||[]).join(", ")||"default roles"} · max {area.maxOrgs||area.maxSchools||10} orgs
                    </div>
                    <OBtn onClick={()=>runScrape(area)} style={{width:"100%"}} sm>⊕ SCRAPE THIS AREA</OBtn>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view==="results"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            {phase!=="idle"&&<div style={{height:4,background:B.border,borderRadius:2,marginBottom:12}}><div style={{height:"100%",width:`${progress}%`,background:B.orange,borderRadius:2,transition:"width .4s"}}/></div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:phase==="done"?B.green:B.orange,letterSpacing:1.5}}>{phase==="finding"?"FINDING SCHOOLS...":phase==="scraping"?"SCRAPING CONTACTS...":phase==="done"?"COMPLETE":"READY"}</div>
              <div style={{display:"flex",gap:7}}>
                {(phase==="finding"||phase==="scraping")&&<GBtn onClick={()=>abortRef.current=true} style={{fontSize:10,padding:"4px 8px",color:B.red}}>⏹ STOP</GBtn>}
                {contacts.length>0&&<OBtn sm onClick={exportCsv}>↓ EXPORT CSV</OBtn>}
              </div>
            </div>
            {contacts.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {[[contacts.length,"Contacts",B.orange],[contacts.filter(c=>c.email).length,"With Email",B.green],[contacts.filter(c=>c.orgType==="club").length,"Clubs",B.blue],[contacts.filter(c=>c.bwtf).length,"BWTF",B.orange]].map(([v,l,c])=>(
                <div key={l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 10px",borderTop:`2px solid ${c}`,textAlign:"center"}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:19,color:c}}>{v}</div>
                  <Lbl s={{marginTop:2}}>{l}</Lbl>
                </div>
              ))}
            </div>}
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {contacts.map(c=>(
                <div key={c.id} className="card fu" style={{padding:"9px 11px",borderLeft:`3px solid ${c.email?B.green:B.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:2}}>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||c.firstName+" "+(c.lastName||"")}</span>
                        {c.orgType==="club"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>CLUB</span>}
                        {c.bwtf&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,padding:"2px 5px",borderRadius:3}}>BWTF</span>}
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.title} · {c.school} · {c.city}, {c.state}</div>
                      {c.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,marginTop:2}}>✉ {c.email}</div>}
                      {c.phone&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue}}>☎ {c.phone}</div>}
                    </div>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:{high:B.green,medium:B.yellow,low:B.muted}[c.confidence]||B.muted,letterSpacing:.5,flexShrink:0,marginLeft:8}}>{c.confidence?.toUpperCase()}</span>
                  </div>
                </div>
              ))}
              {contacts.length===0&&phase==="idle"&&<div style={{textAlign:"center",padding:"30px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Run a scrape from your focus areas to see contacts here</div>}
              {contacts.length===0&&phase!=="idle"&&phase!=="done"&&<div style={{textAlign:"center",padding:"30px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Searching...</div>}
            </div>
          </div>
          <div className="card" style={{padding:13,alignSelf:"start",position:"sticky",top:0}}>
            <Lbl s={{marginBottom:8}}>Activity Log</Lbl>
            <div style={{maxHeight:500,overflowY:"auto"}}>
              {log.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Log appears here during scrape...</div>}
              {log.map(l=>(
                <div key={l.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:logC[l.type]||B.muted,lineHeight:1.9,borderBottom:`1px solid ${B.border}22`}}>
                  <span style={{color:B.gray2,marginRight:4}}>{new Date(l.ts).toLocaleTimeString()}</span>{l.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MARKETING
// ════════════════════════════════════════════════════════════════════════════
function ModMarketing() {
  const [mode,setMode]=useState("copy");
  const [product,setProduct]=useState("Track & Field Equipment");
  const [audience,setAudience]=useState("Athletic Director");
  const [channel,setChannel]=useState("cold email");
  const [tone,setTone]=useState("friendly");
  const [ctx,setCtx]=useState("");
  const [out,setOut]=useState("");
  const [running,setRunning]=useState(false);

  const gen=async()=>{
    setRunning(true);setOut("");
    let p="";
    if(mode==="copy") p=`Write ${channel} copy for ST1 Sports targeting ${audience}s. Product: ${product}. Tone: ${tone}. ${ctx} ${ST1}. Include subject line if email. Under 120 words. Use {{firstName}} {{orgName}}.`;
    else if(mode==="sequence") p=`3-touch ${channel} sequence for ST1 Sports targeting ${audience}s, product ${product}. Tone: ${tone}. ${ctx} ${ST1}. Label Touch N — Day X. Under 80 words each.`;
    else p=`90-day marketing strategy for ST1 Sports. Focus: ${product}. Audience: ${audience}s. ${ctx} ${ST1}. Include positioning, channels, monthly plan, KPIs.`;
    const t=await aiCall(p,{tokens:900});setOut(t||"");setRunning(false);
  };

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="MARKETING STUDIO" sub="AI copy, drip sequences, and go-to-market strategy"/>
      <div style={{display:"flex",gap:7,marginBottom:18}}>
        {[["copy","Ad Copy"],["sequence","Sequence"],["strategy","Strategy"]].map(([id,l])=>(
          <button key={id} onClick={()=>setMode(id)} style={{background:mode===id?B.orange:B.white,color:mode===id?B.white:B.muted,border:`1px solid ${mode===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{l}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16}}>
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {[["Product",["Track & Field Equipment","Baseball / Softball","Volleyball","Timing Systems","Custom Team Stores","Competition Spikes"],product,setProduct],
            ["Audience",["Athletic Director","Head Track Coach","Head Baseball Coach","Procurement Manager","Coach"],audience,setAudience],
            ["Channel",["cold email","LinkedIn","email newsletter","SMS","Instagram"],channel,setChannel],
            ["Tone",["friendly","professional","urgent","conversational"],tone,setTone]].map(([l,opts,val,set])=>(
            <div key={l} className="card" style={{padding:12}}>
              <Lbl s={{marginBottom:7}}>{l}</Lbl>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {opts.map(o=><button key={o} onClick={()=>set(o)} style={{background:val===o?`${B.orange}14`:B.white,color:val===o?B.orange:B.muted,border:`1px solid ${val===o?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{o}</button>)}
              </div>
            </div>
          ))}
          <div className="card" style={{padding:12}}><Lbl s={{marginBottom:6}}>Context</Lbl><textarea value={ctx} onChange={e=>setCtx(e.target.value)} rows={2} placeholder="Any specific angle or context..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,resize:"vertical"}}/></div>
          <OBtn onClick={gen} disabled={running} style={{width:"100%"}}>{running?"GENERATING...":"✦ GENERATE"}</OBtn>
        </div>
        <div className="card" style={{padding:14,minHeight:360,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:9}}><Lbl>Output</Lbl>{out&&<GBtn onClick={()=>navigator.clipboard?.writeText(out)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>}</div>
          {!out&&!running&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",marginTop:50}}>Configure and generate</div>}
          {running&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.yellow,fontSize:12}}><Spin/>Writing...</div>}
          {out&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap",flex:1,overflowY:"auto"}}>{out}</div>}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPETE
// ════════════════════════════════════════════════════════════════════════════
function ModCompete() {
  const COMPS=["BSN Sports","VS Athletics","MF Athletic","School Specialty","Varsity Group","Gopher Sport","Anderson's","Epic Sports"];
  const [sel,setSel]=useState(null);
  const [intel,setIntel]=useState({});
  const [bc,setBc]=useState({});
  const [running,setRunning]=useState(null);
  const [bcRunning,setBcRunning]=useState(null);

  const research=async(comp)=>{
    setSel(comp);if(intel[comp])return;
    setRunning(comp);
    const t=await aiCall(`Research ${comp} as a competitor to ST1 Sports. ${ST1}. Provide: what they focus on, strengths, weaknesses vs ST1, pricing approach, strongest states, and how ST1 can counter them. Be specific and tactical.`,{search:true});
    setIntel(i=>({...i,[comp]:t||""}));setRunning(null);
  };
  const genBc=async(comp)=>{
    setBcRunning(comp);
    const r=await aiCall(`Sales battlecard for ST1 Sports vs ${comp}. ${ST1}. Return JSON: {"competitor":"","our_strengths":["3 items"],"their_strengths":["2 items"],"key_messages":["3 messages"],"objection_handlers":[{"objection":"","response":""}]}`,{json:true});
    setBc(b=>({...b,[comp]:r}));setBcRunning(null);
  };

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="COMPETITOR INTEL" sub="Research competitors · generate battlecards · counter strategies"/>
      <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:16}}>
        <div>
          <Lbl s={{marginBottom:9}}>Competitors</Lbl>
          {COMPS.map(c=>(
            <button key={c} onClick={()=>research(c)} style={{display:"block",width:"100%",background:sel===c?`${B.orange}10`:B.white,color:sel===c?B.orange:B.textMid,border:`1px solid ${sel===c?B.orange:B.border}`,borderRadius:5,padding:"8px 11px",fontSize:11,textAlign:"left",fontFamily:"'Lexend',sans-serif",marginBottom:5}}>
              {c} {intel[c]?"✓":""}
            </button>
          ))}
        </div>
        <div>
          {!sel&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>Select a competitor to research</div>}
          {sel&&running===sel&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.yellow,fontSize:12,padding:"20px 0"}}><Spin/>Researching {sel} with live web search...</div>}
          {sel&&intel[sel]&&(
            <div className="card fu" style={{padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:11}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,letterSpacing:.3}}>{sel}</div>
                <OBtn sm onClick={()=>genBc(sel)} disabled={bcRunning===sel}>{bcRunning===sel?"...":"GEN BATTLECARD"}</OBtn>
              </div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap",marginBottom:bc[sel]?14:0}}>{intel[sel]}</div>
              {bc[sel]&&(
                <div style={{borderTop:`1px solid ${B.border}`,paddingTop:13}}>
                  <Lbl c={B.orange} s={{marginBottom:11}}>BATTLECARD vs {bc[sel].competitor?.toUpperCase()}</Lbl>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:11}}>
                    {[["Our Strengths ✓","our_strengths",B.green,B.greenBg],["Their Strengths","their_strengths",B.red,B.redBg]].map(([l,k,c,bg])=>(
                      <div key={k} style={{background:bg,borderRadius:5,padding:10}}><Lbl c={c} s={{marginBottom:6}}>{l}</Lbl>{(bc[sel][k]||[]).map((x,i)=><div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,lineHeight:1.7}}>· {x}</div>)}</div>
                    ))}
                  </div>
                  <div style={{background:B.surface,borderRadius:5,padding:10,marginBottom:10}}><Lbl s={{marginBottom:6}}>Key Messages</Lbl>{(bc[sel].key_messages||[]).map((m,i)=><div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7,marginBottom:4}}>"{m}"</div>)}</div>
                  {(bc[sel].objection_handlers||[]).map((oh,i)=>(
                    <div key={i} style={{marginBottom:7,padding:"9px 10px",background:B.white,border:`1px solid ${B.border}`,borderRadius:5}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:4}}>OBJECTION</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:5}}>"{oh.objection}"</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:1,marginBottom:3}}>RESPONSE</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.6}}>{oh.response}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  AI AGENT
// ════════════════════════════════════════════════════════════════════════════
function ModAgent() {
  const {s,dispatch,cu}=useApp();
  const [history,setHistory]=useState([]);
  const [input,setInput]=useState("");
  const [running,setRunning]=useState(false);
  const endRef=useRef(null);

  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[history]);

  const send=async()=>{
    if(!input.trim()||running) return;
    const msg=input.trim();setInput("");
    setHistory(h=>[...h,{role:"user",content:msg,ts:Date.now()}]);
    setRunning(true);
    const pipeline=s.deals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).reduce((a,d)=>a+d.value,0);
    const ar=s.invoices.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);
    const overdue=s.deals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage));
    const sys=`You are the senior RevOps AI agent for ST1 Sports. Expert in B2B athletic equipment sales, K-12 procurement, bid strategy, and team management.
${ST1}
Current state: ${s.deals.length} deals, ${fmt$(pipeline)} pipeline, ${fmt$(ar)} AR, ${overdue.length} overdue follow-ups, ${s.rfps.filter(r=>!["Won","Lost","No Bid"].includes(r.stage)).length} active RFPs.
Hot deals: ${s.deals.filter(d=>d.priority==="hot"&&!["Closed Won","Closed Lost"].includes(d.stage)).map(d=>d.name).join(", ")}.
User: ${cu?.name} (${cu?.role}).
Be specific, tactical, and concise. Flag high-intent signals with 🔥. Give real dollar amounts and timelines.`;
    const text=await aiCall(msg,{sys,search:true,tokens:1200}).catch(e=>"Error: "+e.message);
    setHistory(h=>[...h,{role:"assistant",content:text,ts:Date.now()}]);
    if(text.includes("🔥")) dispatch("ADD_ALERT",{msg:"Agent flagged high intent",action:"Review agent recommendation"});
    dispatch("LOG",{msg:`${cu?.name} used AI Agent: ${msg.slice(0,60)}`});
    setRunning(false);
  };

  const STARTERS=["Who should I call today?","Draft a BWTF outreach email for a MN coach","How do I counter BSN on price?","What RFPs should we prioritize this week?","Analyze our biggest deal at risk","Write a proposal intro for the IGHSAU bid"];

  return (
    <div style={{padding:"22px 26px",display:"flex",flexDirection:"column",height:"calc(100vh - 46px)"}}>
      <PH title="AI AGENT" sub="Your RevOps strategy partner — pipeline, outreach, bids, pricing"/>
      <div style={{flex:1,overflowY:"auto",background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:14,marginBottom:12,minHeight:200,display:"flex",flexDirection:"column",gap:9,boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
        {history.length===0&&(
          <div style={{textAlign:"center",marginTop:20}}>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:16}}>Ask anything about ST1 Sports strategy, pipeline, outreach, or bids</div>
            <div style={{display:"flex",flexDirection:"column",gap:5,maxWidth:420,margin:"0 auto"}}>
              {STARTERS.map(st=><button key={st} onClick={()=>setInput(st)} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,textAlign:"left"}}>{st}</button>)}
            </div>
          </div>
        )}
        {history.map((m,i)=>(
          <div key={i} className="fu" style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"82%",padding:"9px 13px",borderRadius:7,fontFamily:"'Lexend',sans-serif",fontSize:13,lineHeight:1.75,background:m.role==="user"?B.orange:B.surface,color:m.role==="user"?B.white:B.text,border:m.role==="assistant"?`1px solid ${B.border}`:"none",whiteSpace:"pre-wrap"}}>{m.content}</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>{m.role==="user"?"You":"RevOps AI"} · {new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
        {running&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.muted,fontSize:12}}><Spin/>Thinking...</div>}
        <div ref={endRef}/>
      </div>
      <div style={{display:"flex",gap:9}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Ask the RevOps agent..." style={{flex:1,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:6,padding:"10px 13px",fontSize:13,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}/>
        <OBtn onClick={send} disabled={running||!input.trim()}>SEND →</OBtn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ALERTS
// ════════════════════════════════════════════════════════════════════════════
function ModAlerts() {
  const {s,dispatch,toast}=useApp();
  const [channel,setChannel]=useState(s.integrations.slackChannel||"#sales-alerts");
  const pending=s.alerts.filter(a=>!a.sent);
  const send=id=>{dispatch("DISMISS_ALERT",id);dispatch("LOG",{msg:`Alert sent to Slack ${channel}`});toast("Alert sent to "+channel,"success");};
  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="ALERT QUEUE" sub="High-intent signals queued for Slack"/>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:16}}>
        <Lbl>Slack:</Lbl>
        <input value={channel} onChange={e=>setChannel(e.target.value)} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 10px",fontSize:12,width:180}}/>
        {pending.length>0&&<OBtn sm onClick={()=>pending.forEach(a=>send(a.id))}>SEND ALL ({pending.length})</OBtn>}
      </div>
      {s.alerts.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>No alerts yet — signals from deals, invoices, and prospecting appear here</div>}
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {s.alerts.map(a=>(
          <div key={a.id} className="card" style={{padding:"10px 13px",borderLeft:`3px solid ${a.sent?B.border:B.orange}`,opacity:a.sent?.5:1,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1}}>
              <Lbl c={a.sent?B.muted:B.orange} s={{marginBottom:3}}>{a.sent?"✓ SENT":"🔥 PENDING"}</Lbl>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,marginBottom:2}}>{a.msg}</div>
              {a.action&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange}}>→ {a.action}</div>}
            </div>
            {!a.sent&&<OBtn sm onClick={()=>send(a.id)} style={{marginLeft:11,flexShrink:0}}>SEND →</OBtn>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIVITY
// ════════════════════════════════════════════════════════════════════════════
function ModActivity() {
  const {s}=useApp();
  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="ACTIVITY FEED" sub="Every action across deals, invoices, and outreach"/>
      {s.activity.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>Activity appears as you use the platform</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {s.activity.map(a=>{const u=USERS.find(x=>x.id===a.userId);return(
          <div key={a.id} className="card" style={{padding:"9px 12px",display:"flex",gap:9,alignItems:"flex-start"}}>
            {u&&<div style={{width:26,height:26,borderRadius:"50%",background:u.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{u.initials}</span></div>}
            <div style={{flex:1}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.4}}>{a.msg}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>{u?.name} · {new Date(a.ts).toLocaleString()}</div></div>
          </div>
        );})}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════════════════════
function ModSettings() {
  const {s,dispatch,toast}=useApp();
  const [ints,setInts]=useState({...s.integrations});
  const save=()=>{dispatch("SAVE_INTEGRATIONS",ints);toast("Settings saved","success");};

  return (
    <div style={{padding:"22px 26px",maxWidth:680}}>
      <PH title="SETTINGS" sub="Integrations, credentials, and data management"/>
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
        <Lbl c={B.orange} s={{marginBottom:12}}>Zoho Integration</Lbl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:11}}>
          {[["Zoho Books Token","zohoToken","password"],["Zoho Books Org ID","zohoOrgId","text"],["Zoho CRM Token","zohoCrmToken","password"],["Slack Channel","slackChannel","text"]].map(([l,k,t])=>(
            <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><input type={t} value={ints[k]||""} onChange={e=>setInts(i=>({...i,[k]:e.target.value}))} placeholder={k.includes("Token")?"Paste OAuth token...":""} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
          ))}
        </div>
        <OBtn onClick={save}>SAVE SETTINGS</OBtn>
      </div>
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.blue}`}}>
        <Lbl c={B.blue} s={{marginBottom:11}}>How to Get Zoho OAuth Tokens</Lbl>
        {[["1","Go to api-console.zoho.com"],["2","Click Self Client → Create"],["3","Scopes: ZohoBooks.invoices.ALL, ZohoCRM.modules.Contacts.ALL"],["4","Click Generate Code → copy the token"],["5","For Org ID: Zoho Books → Settings → Organization Profile"]].map(([n,step])=>(
          <div key={n} style={{display:"flex",gap:9,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,minWidth:16,flexShrink:0}}>{n}</span><span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{step}</span></div>
        ))}
      </div>
      <div className="card" style={{padding:16,borderTop:`3px solid ${B.green}`}}>
        <Lbl c={B.green} s={{marginBottom:11}}>Data Management</Lbl>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.7,marginBottom:11}}>All data persists in your browser's localStorage across sessions. Export a backup before clearing.</div>
        <div style={{display:"flex",gap:7}}>
          <GBtn onClick={()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(s)],{type:"application/json"}));a.download=`st1_backup_${today()}.json`;a.click();toast("Backup exported","success");}}>↓ EXPORT BACKUP</GBtn>
          <button onClick={()=>{if(window.confirm("Reset all data to demo state? Cannot be undone.")){dispatch("RESET");toast("Reset to demo","success");}}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>RESET TO DEMO</button>
        </div>
        <div style={{marginTop:13,paddingTop:11,borderTop:`1px solid ${B.border}`}}>
          <Lbl s={{marginBottom:9}}>Team</Lbl>
          {USERS.map(u=>(
            <div key={u.id} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:u.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:B.white}}>{u.initials}</span></div>
              <div style={{flex:1}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{u.name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.email}</div></div>
              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:u.role==="owner"?B.orange:B.blue,background:u.role==="owner"?B.orangeBg:B.blueBg,padding:"2px 7px",borderRadius:3,letterSpacing:.5}}>{u.role.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}