import React, { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from "react";
import * as XLSX from "xlsx";
import * as bgTasks from "../lib/bgTasks.js";

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class ErrBound extends Component {
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(e){return{err:e};}
  render(){
    if(this.state.err) return(
      <div style={{padding:32,fontFamily:"monospace",background:"#fff8f8",border:"1px solid #f99",borderRadius:8,margin:24}}>
        <div style={{fontWeight:700,color:"#c00",marginBottom:8}}>Render error — please report this message:</div>
        <pre style={{fontSize:12,color:"#333",whiteSpace:"pre-wrap"}}>{this.state.err?.message}</pre>
        <pre style={{fontSize:10,color:"#999",marginTop:8,whiteSpace:"pre-wrap"}}>{this.state.err?.stack?.split("\n").slice(0,6).join("\n")}</pre>
        <button onClick={()=>this.setState({err:null})} style={{marginTop:12,padding:"6px 14px",background:"#f37321",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

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
  sequences: [],
  competeIntel: {},
  battlecards: {},
  prospectAreas: [],
  agentHistory: [],
  agentDraft: "",
  lastBriefDate: null,
  pendingBriefActions: [],
  contactsLastSync: null,
  alerts: [],
  orders: [],
  templates: [],
  activity: [],
  integrations: {zohoToken:"",zohoCrmToken:"",zohoOrgId:"",slackChannel:"C0AQ7CMB01X"},
  company: {name:"ST1 Sports",ownerName:"Matt Stone",email:"matt@st1sports.com",phone:"719-256-0275",address:"Ames, Iowa",website:"st1sports.com"},
  brandAssets: [],
  savedAds: [],
  socialPosts: [],
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

function useStore() {
  const saveTimer = useRef(null);
  const [s, setRaw] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) {
        const p = JSON.parse(saved);
        return {...SEED,...p,
          deals:        Array.isArray(p.deals)        ? p.deals        : [],
          invoices:     Array.isArray(p.invoices)     ? p.invoices     : [],
          rfps:         Array.isArray(p.rfps)         ? p.rfps         : [],
          reorders:     Array.isArray(p.reorders)     ? p.reorders     : [],
          contacts:     Array.isArray(p.contacts)     ? p.contacts     : [],
          sequences:    Array.isArray(p.sequences)    ? p.sequences    : [],
          prospectAreas:Array.isArray(p.prospectAreas)? p.prospectAreas: [],
          agentHistory: Array.isArray(p.agentHistory) ? p.agentHistory.slice(-40) : [],
          competeIntel: p.competeIntel && typeof p.competeIntel==="object" ? p.competeIntel : {},
          battlecards:  p.battlecards  && typeof p.battlecards ==="object" ? p.battlecards  : {},
          orders:       Array.isArray(p.orders)       ? p.orders       : [],
          templates:    Array.isArray(p.templates)    ? p.templates    : [],
          alerts:       Array.isArray(p.alerts)       ? p.alerts       : [],
          activity:     Array.isArray(p.activity)     ? p.activity     : [],
          integrations: {...SEED.integrations,...(p.integrations||{})},
          company:      {...SEED.company,...(p.company||{})},
          brandAssets:  Array.isArray(p.brandAssets)  ? p.brandAssets  : [],
          savedAds:     Array.isArray(p.savedAds)     ? p.savedAds     : [],
          socialPosts:  Array.isArray(p.socialPosts)  ? p.socialPosts  : [],
          invoiceLastSync: p.invoiceLastSync||null,
          contactsLastSync: p.contactsLastSync||null,
          lastBriefDate: p.lastBriefDate||null,
          pendingBriefActions: Array.isArray(p.pendingBriefActions)?p.pendingBriefActions:[],
        };
      }
    } catch {}
    return SEED;
  });

  const set = useCallback((fn) => {
    setRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : {...prev,...fn};
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
      }, 300);
      return next;
    });
  }, []);

  return [s, set];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const toBuffer = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsArrayBuffer(f);});

function inferSport(items=[]) {
  const t=(items||[]).map(i=>i.name||i.item_name||"").join(" ").toLowerCase();
  if(/track|hurdle|javelin|discus|shot.?put|pole.?vault|sprint|relay|starting.?block|cross.?country|timing|finish.?lynx/.test(t)) return "Track & Field";
  if(/baseball|softball|bat|glove|helmet/.test(t)) return "Baseball/Softball";
  if(/volleyball/.test(t)) return "Volleyball";
  if(/football/.test(t)) return "Football";
  if(/basketball/.test(t)) return "Basketball";
  if(/wrestling/.test(t)) return "Wrestling";
  return "General";
}

// Shared Zoho Books/CRM proxy helper
async function zohoCall(service, endpoint, method="GET", body=null) {
  const r = await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({service,endpoint,method,...(body?{body}:{})})});
  if(!r.ok) throw new Error(`Zoho proxy ${r.status}`);
  return r.json();
}

// Sport → best outreach window (months before season for procurement decisions)
const SPORT_WINDOWS = {
  "Track & Field":    "Nov–Jan",
  "Cross Country":    "Jun–Jul",
  "Baseball":         "Dec–Feb",
  "Softball":         "Dec–Feb",
  "Baseball/Softball":"Dec–Feb",
  "Volleyball":       "Jun–Jul",
  "Football":         "Apr–Jun",
  "Basketball":       "Sep–Oct",
  "Wrestling":        "Sep–Oct",
};

// Returns matching invoice if contact appears to be an existing customer
function findCustomerInvoice(c, invoices) {
  if(!invoices?.length) return null;
  const name=(c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()).toLowerCase();
  const school=(typeof c.school==="string"?c.school:c.school?.name||"").toLowerCase();
  return (invoices).find(inv=>{
    const ic=(inv.customer||"").toLowerCase();
    if(!ic) return false;
    if(school.length>4&&(ic.includes(school)||school.includes(ic))) return true;
    if(name.length>3&&ic===name) return true;
    return false;
  })||null;
}

function scoreTier(score) {
  const n=score||0;
  if(n>=100) return {label:"🔥 FIRE",color:"#C0392B",bg:"#FDECEA"};
  if(n>=60)  return {label:"HOT",    color:"#F37321",bg:"#FEF3EC"};
  if(n>=25)  return {label:"WARM",   color:"#1A5FA8",bg:"#E8F0FA"};
  return           {label:"COLD",   color:"#7A7872",bg:"#F8F7F5"};
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

async function aiCallConv(messages, sys, opts={}) {
  const r = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:opts.tokens||1400,system:sys,messages})});
  const d = await r.json();
  const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  if(opts.json){try{const m=text.match(/[\[{][\s\S]*[\]}]/s);return m?JSON.parse(m[0]):null;}catch{return null;}}
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
    case "ADD_REORDER":       return {...prev, reorders:[payload,...(prev.reorders||[])]};
    case "SET_REORDERS":      return {...prev, reorders:payload};
    case "UPDATE_REORDER":    return {...prev, reorders:(prev.reorders||[]).map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "SET_INVOICES":      return {...prev, invoices:payload.invoices, invoiceLastSync:payload.lastSync||Date.now()};
    case "SET_CONTACTS":      return {...prev, contacts:payload};
    case "ADD_CONTACTS":      return {...prev, contacts:[...payload,...(prev.contacts||[])]};
    case "UPDATE_CONTACT":      return {...prev, contacts:prev.contacts.map(c=>c.id===payload.id?{...c,...payload}:c)};
    case "SCORE_CONTACT": {
      const {contactId,type,note,campaignId} = payload;
      const pts=({enrolled:5,sent:15,opened:10,clicked:25,replied:50,meeting:75,deal:100})[type]||5;
      const BOT_WIN=30*60*1000; // 30-min dedup window for opens/clicks
      return {...prev,contacts:(prev.contacts||[]).map(c=>{
        if(c.id!==contactId)return c;
        // Bot/dedup filter: same event type+campaign within window = ignore
        if(["opened","clicked"].includes(type)){
          const dup=(c.activity||[]).find(a=>a.type===type&&a.campaignId===campaignId&&(Date.now()-a.ts)<BOT_WIN);
          if(dup) return c;
        }
        const act={id:mkId(),type,ts:Date.now(),note:note||"",campaignId:campaignId||""};
        return{...c,score:Math.min(200,(c.score||0)+pts),activity:[act,...(c.activity||[])].slice(0,50)};
      })};
    }
    case "ADD_ORDER":           return {...prev, orders:[payload,...(prev.orders||[])]};
    case "UPDATE_ORDER":        return {...prev, orders:(prev.orders||[]).map(o=>o.id===payload.id?{...o,...payload}:o)};
    case "DEL_ORDER":           return {...prev, orders:(prev.orders||[]).filter(o=>o.id!==payload)};
    case "ADD_TEMPLATE":        return {...prev, templates:[payload,...(prev.templates||[])]};
    case "UPDATE_TEMPLATE":     return {...prev, templates:(prev.templates||[]).map(t=>t.id===payload.id?{...t,...payload}:t)};
    case "DEL_TEMPLATE":        return {...prev, templates:(prev.templates||[]).filter(t=>t.id!==payload)};
    case "ADD_SEQUENCE":        return {...prev, sequences:[payload,...(prev.sequences||[])]};
    case "UPDATE_SEQUENCE":     return {...prev, sequences:(prev.sequences||[]).map(s=>s.id===payload.id?{...s,...payload}:s)};
    case "SET_COMPETE_INTEL":   return {...prev, competeIntel:{...(prev.competeIntel||{}),...payload}};
    case "SET_BATTLECARD":      return {...prev, battlecards:{...(prev.battlecards||{}),...payload}};
    case "SET_PROSPECT_AREAS":  return {...prev, prospectAreas:payload};
    case "SET_AGENT_HISTORY":   return {...prev, agentHistory:payload};
    case "SET_AGENT_DRAFT":     return {...prev, agentDraft:payload};
    case "SET_BRIEF":           return {...prev, pendingBriefActions:payload.actions, lastBriefDate:payload.date};
    case "DISMISS_BRIEF_ACTION":return {...prev, pendingBriefActions:(prev.pendingBriefActions||[]).filter((_,i)=>i!==payload)};
    case "SET_CONTACTS_LAST_SYNC": return {...prev, contactsLastSync:payload};
    case "ADD_ALERT":         return {...prev, alerts:[{id:mkId(),ts:Date.now(),sent:false,...payload},...prev.alerts.slice(0,49)]};
    case "DISMISS_ALERT":     return {...prev, alerts:prev.alerts.map(a=>a.id===payload?{...a,sent:true}:a)};
    case "LOG":               return {...prev, activity:[{id:mkId(),ts:Date.now(),userId:prev.currentUserId,...payload},...prev.activity.slice(0,199)]};
    case "SAVE_INTEGRATIONS":   return {...prev, integrations:{...prev.integrations,...payload}};
    case "SAVE_COMPANY":        return {...prev, company:{...prev.company,...payload}};
    case "ADD_BRAND_ASSET":     return {...prev, brandAssets:[...( prev.brandAssets||[]),payload]};
    case "DELETE_BRAND_ASSET":  return {...prev, brandAssets:(prev.brandAssets||[]).filter(a=>a.id!==payload)};
    case "ADD_SAVED_AD":        return {...prev, savedAds:[payload,...(prev.savedAds||[])]};
    case "DELETE_SAVED_AD":     return {...prev, savedAds:(prev.savedAds||[]).filter(a=>a.id!==payload)};
    case "ADD_SOCIAL_POST":     return {...prev, socialPosts:[...(prev.socialPosts||[]),payload]};
    case "UPDATE_SOCIAL_POST":  return {...prev, socialPosts:(prev.socialPosts||[]).map(p=>p.id===payload.id?{...p,...payload}:p)};
    case "DELETE_SOCIAL_POST":  return {...prev, socialPosts:(prev.socialPosts||[]).filter(p=>p.id!==payload)};
    case "RESET":               return {...SEED, currentUserId:prev.currentUserId, integrations:prev.integrations, company:prev.company, brandAssets:prev.brandAssets||[], savedAds:prev.savedAds||[]};
    default:                  return prev;
  }
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────
const mergeTags=(text,c)=>(text||"")
  .replace(/\{\{firstName\}\}/gi,c?.firstName||(c?.fullName||"").split(" ")[0]||"there")
  .replace(/\{\{orgName\}\}/gi,(typeof c?.school==="string"?c.school:c?.school?.name)||"your school")
  .replace(/\{\{lastName\}\}/gi,c?.lastName||"")
  .replace(/\{\{sport\}\}/gi,(typeof c?.sport==="string"?c.sport:c?.sport?.name)||"athletics");

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEAL_STAGES = ["Quoted","Follow-Up 1","Follow-Up 2","Negotiating","PO Received","Closed Won","Closed Lost","On Hold"];
const RFP_STAGES  = ["New", "In Process", "Bid", "No Bid"];
const DSC = {Quoted:B.blue,"Follow-Up 1":B.purple,"Follow-Up 2":B.orange,Negotiating:B.yellow,"PO Received":B.teal,"Closed Won":B.green,"Closed Lost":B.red,"On Hold":B.muted};
const DBG = {Quoted:B.blueBg,"Follow-Up 1":B.purpleBg,"Follow-Up 2":B.orangeBg,Negotiating:B.yellowBg,"PO Received":B.tealBg,"Closed Won":B.greenBg,"Closed Lost":B.redBg,"On Hold":B.surface};
const RSC = {
  "New":B.blue,"In Process":B.orange,"Bid":B.green,"No Bid":B.muted,
  // legacy stage names kept for backward compat
  Received:B.blue,Reviewing:B.purple,Pricing:B.orange,"Building Response":B.yellow,Submitted:B.teal,Won:B.green,Lost:B.red,
};
const ISC = {draft:{c:B.muted,bg:B.surface},sent:{c:B.blue,bg:B.blueBg},viewed:{c:B.purple,bg:B.purpleBg},partial:{c:B.yellow,bg:B.yellowBg},paid:{c:B.green,bg:B.greenBg},overdue:{c:B.red,bg:B.redBg}};
const ST1 = `ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa. Owner: Matt Stone (matt@st1sports.com, 719-256-0275). Brands: Blazer, Gill Athletics, Diamond, All-Star, Molten, Wilson, DeMarini, Louisville Slugger, FinishLynx, Pro-Nine. Markets: Iowa, Colorado, Minnesota, North Dakota. Sells to K-12 school districts, ADs, coaches.`;
const SPORTS_LIST = ["Track & Field","Baseball","Softball","Volleyball","Cross Country","Football","Basketball","Wrestling"];
const STATES_LIST = ["IA","CO","MN","ND","WI","NE","SD","KS","IL","MO"];
const US_REGIONS = {
  "Midwest":       {states:["IA","MN","WI","MO","IL","IN","MI","OH","ND","SD","NE","KS"],color:"#1A5FA8"},
  "Southeast":     {states:["FL","GA","TN","AL","MS","SC","NC","VA","KY","AR","LA"],color:"#1E8F4E"},
  "Southwest":     {states:["TX","OK","NM","AZ"],color:"#C77800"},
  "Mountain West": {states:["CO","UT","NV","ID","MT","WY"],color:"#F37321"},
  "West Coast":    {states:["CA","WA","OR"],color:"#6B3FA0"},
  "Northeast":     {states:["NY","PA","NJ","CT","MA","MD","DE","NH","VT","ME","RI"],color:"#C0392B"},
};
const PRODUCT_CATS = ["Track & Field Equipment","Baseball / Softball","Volleyball","Timing Systems","Custom Team Stores","Apparel","Competition Spikes","Cross Country","Other"];
const CLUB_ROLES = ["Club Director","Program Coordinator","League Administrator","Head Coach","Travel Team Director","Tournament Director","Activities Coordinator"];

function urgentCount(s) {
  return s.deals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0).length
    + s.invoices.filter(i=>i.status==="overdue").length
    + s.rfps.filter(r=>!["No Bid","Lost","Won"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=3).length;
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
  const crmSyncRef = useRef(null);
  const ctx = {s, dispatch, toast, cu, mod, setMod, crmSyncRef};
  useEffect(()=>{
    if(!s.currentUserId) return;
    const SIX_H=6*60*60*1000;
    const STAT_MAP={sent:"sent",viewed:"sent",overdue:"overdue",paid:"paid",partially_paid:"partial",draft:"draft",void:"void"};
    const zs=v=>typeof v==="string"?v:v?.name||v?.display_value||"";
    const syncInvoices=async()=>{
      if(s.invoiceLastSync&&Date.now()-s.invoiceLastSync<SIX_H) return;
      try {
        const res=await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"books",endpoint:"/invoices?per_page=200&sort_column=date&sort_order=D",method:"GET"})}).then(r=>r.json());
        const mapped=(res.invoices||[]).map(zi=>({id:"zoho_"+zi.invoice_id,zohoId:zi.invoice_id,number:zi.invoice_number||"",customer:zi.customer_name,customerId:zi.customer_id,status:STAT_MAP[zi.status]||zi.status,date:zi.date,dueDate:zi.due_date,total:zi.total||0,balance:zi.balance||0,items:(zi.line_items||[]).map(li=>({name:li.name||li.item_name||"",qty:li.quantity,rate:li.rate,total:li.item_total})),source:"zoho"}));
        if(mapped.length) dispatch("SET_INVOICES",{invoices:mapped,lastSync:Date.now()});
      } catch{}
    };
    const fetchAllPages=async(baseEndpoint)=>{
      let all=[],page=1;
      while(true){
        const sep=baseEndpoint.includes("?")?"&":"?";
        const res=await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`${baseEndpoint}${sep}per_page=200&page=${page}`,method:"GET"})}).then(r=>r.json());
        const batch=res.data||[];
        all=[...all,...batch];
        if(!res.info?.more_records||batch.length<200) break;
        page++;
      }
      return all;
    };
    const syncContacts=async(force=false)=>{
      if(!force&&s.contactsLastSync&&Date.now()-s.contactsLastSync<SIX_H) return;
      try {
        const [contactRows,leadRows]=await Promise.all([
          fetchAllPages("/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,Mailing_City,Mailing_State,Lead_Source"),
          fetchAllPages("/Leads?fields=First_Name,Last_Name,Email,Phone,Title,Company,City,State,Lead_Source,Lead_Status,Rating,No_of_Calls,No_of_Chats,Last_Activity_Time"),
        ]);
        const now=Date.now();
        const contacts=contactRows.map(c=>({id:"zoho_c_"+c.id,firstName:zs(c.First_Name),lastName:zs(c.Last_Name),fullName:`${zs(c.First_Name)} ${zs(c.Last_Name)}`.trim(),email:zs(c.Email),phone:zs(c.Phone),title:zs(c.Title),school:zs(c.Account_Name),city:zs(c.Mailing_City),state:zs(c.Mailing_State),orgType:"school",source:"zoho-crm",zohoSource:zs(c.Lead_Source),confidence:"high",outreachStatus:"new",importedAt:now}));
        const leads=leadRows.map(l=>({id:"zoho_l_"+l.id,firstName:zs(l.First_Name),lastName:zs(l.Last_Name),fullName:`${zs(l.First_Name)} ${zs(l.Last_Name)}`.trim(),email:zs(l.Email),phone:zs(l.Phone),title:zs(l.Title),school:zs(l.Company),city:zs(l.City),state:zs(l.State),orgType:"school",source:"zoho-crm",zohoSource:zs(l.Lead_Source),zohoStatus:zs(l.Lead_Status),rating:zs(l.Rating),confidence:"medium",outreachStatus:"new",importedAt:now}));
        const existing=new Set((s.contacts||[]).map(c=>c.id));
        const toAdd=[...contacts,...leads].filter(c=>!existing.has(c.id));
        if(toAdd.length) dispatch("ADD_CONTACTS",toAdd);
        dispatch("SET_CONTACTS_LAST_SYNC",now);
        if(force) toast(`Synced ${toAdd.length} new record(s) from Zoho CRM`,"success");
      } catch(e){
        console.error("CRM sync failed:",e);
        if(force) toast(`CRM sync failed: ${e.message}`,"error");
      }
    };
    crmSyncRef.current = syncContacts;
    syncInvoices(); syncContacts();
    const iv=setInterval(()=>{syncInvoices();syncContacts();},SIX_H);
    return()=>clearInterval(iv);
  },[s.currentUserId]);

  if (!s.currentUserId) return <Login dispatch={dispatch}/>;

  const NAV = [
    // ── SALES ──────────────────────────────────────────────────────────
    {id:"_s_sales"},
    {id:"briefing",    icon:"◈", label:"Briefing",       badge:urgentCount(s)},
    {id:"revenue",     icon:"↑", label:"Revenue"},
    {id:"deals",       icon:"◫", label:"Deals"},
    {id:"quotes",      icon:"▤", label:"Quotes",           href:"https://admin.st1sports.com"},
    {id:"orders",      icon:"⊡", label:"Orders",         badge:(s.orders||[]).filter(o=>o.stage!=="Invoiced").length||null},
    {id:"invoicing",   icon:"▲", label:"Invoices & AR",  badge:s.invoices.filter(i=>i.status==="overdue").length},
    {id:"rfp",         icon:"⊘", label:"RFP / Bids",     badge:s.rfps.filter(r=>!["No Bid","Lost","Won"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=7).length},
    // ── GROWTH ─────────────────────────────────────────────────────────
    {id:"_s_growth"},
    {id:"prospecting", icon:"⊕", label:"Prospecting"},
    {id:"outreach",    icon:"✉", label:"Outreach"},
    {id:"templates",   icon:"≈", label:"Email Templates"},
    {id:"marketing",   icon:"✦", label:"Campaigns & Ads"},
    // ── TOOLS ──────────────────────────────────────────────────────────
    {id:"_s_tools"},
    {id:"agent",       icon:"AI",label:"AI Agent"},
    {id:"reorder",     icon:"↺", label:"Reorder Engine", badge:s.reorders.filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date())).length},
    {id:"compete",     icon:"⊗", label:"Competitors"},
    {id:"alerts",      icon:"◎", label:"Alerts",         badge:s.alerts.filter(a=>!a.sent).length},
    // ── SYSTEM ─────────────────────────────────────────────────────────
    {id:"_s_system"},
    {id:"activity",    icon:"≡", label:"Activity"},
    {id:"settings",    icon:"⚙", label:"Settings"},
    {id:"integrations",icon:"⚡",label:"Integrations",   href:"/integrations"},
    // ── STANDALONE TOOLS ───────────────────────────────────────────────
    {id:"_div"},
    {id:"rfp-tool",    icon:"📋", label:"RFP Automation", href:"/rfp"},
    {id:"prices",      icon:"$",  label:"Price Manager",  href:"/prices"},
    {id:"expansion",   icon:"◉",  label:"Expansion",      href:"/expansion"},
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

          <nav style={{flex:1,overflowY:"auto",overflowX:"hidden",paddingTop:6}}>
            {NAV.map(n=>{
              // Section header
              if(n.id.startsWith("_s_")) {
                const label = n.id.replace("_s_","").toUpperCase();
                return !slim
                  ? <div key={n.id} style={{padding:"10px 13px 3px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:2,opacity:.7}}>{label}</div>
                  : <div key={n.id} style={{height:1,background:B.border,margin:"5px 8px"}}/>;
              }
              // Divider
              if(n.id==="_div") return <div key="_div" style={{height:1,background:B.border,margin:"6px 8px"}}/>;
              // External link (standalone tools)
              if(n.href) return (
                <a key={n.id} href={n.href} title={slim?n.label:undefined}
                  style={{display:"flex",textDecoration:"none",width:"100%",background:"transparent",borderLeft:`3px solid transparent`,color:B.muted,padding:slim?"9px 0":"7px 11px 7px 10px",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:400}}>
                  <span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
                  {!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n.label}</span>}
                  {!slim&&<span style={{marginLeft:"auto",fontSize:9,color:B.muted,flexShrink:0}}>↗</span>}
                </a>
              );
              // Normal nav item
              return (
                <button key={n.id} onClick={()=>setMod(n.id)} title={slim?n.label:undefined}
                  style={{width:"100%",background:mod===n.id?`${B.orange}14`:"transparent",border:"none",borderLeft:`3px solid ${mod===n.id?B.orange:"transparent"}`,color:mod===n.id?B.orange:B.muted,padding:slim?"9px 0":"7px 11px 7px 10px",display:"flex",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:mod===n.id?500:400,textAlign:"left",position:"relative"}}>
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
              {(()=>{
                let st={};
                try{st=JSON.parse(localStorage.getItem("st1_integrations_status_v1")||"{}");}catch{}
                return [
                  ["Books",    st.books    || !!s.integrations.zohoToken],
                  ["CRM",      st.crm      || !!s.integrations.zohoCrmToken],
                  ["Campaigns",st.campaigns],
                  ["Gmail",    st.gmail    || !!s.integrations.gmailToken],
                  ["Slack",    st.slack    !== false && !!s.integrations.slackChannel],
                ].map(([l,v])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div className={v?"":"blink"} style={{width:6,height:6,borderRadius:"50%",background:v?B.green:B.muted}}/>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{l}</span>
                  </div>
                ));
              })()}
              <div style={{width:1,height:14,background:B.border}}/>
              <button onClick={()=>setMod("alerts")} style={{background:"none",border:"none",color:s.alerts.filter(a=>!a.sent).length?B.orange:B.muted,fontSize:13,position:"relative",padding:2}}>
                ◎
                {s.alerts.filter(a=>!a.sent).length>0&&<span style={{position:"absolute",top:-3,right:-3,background:B.orange,color:B.white,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{s.alerts.filter(a=>!a.sent).length}</span>}
              </button>
            </div>
          </header>

          <main style={{flex:1,overflowY:"auto",background:B.pageBg}}>
            <ErrBound key={mod}>
            {mod==="briefing"    && <ModBriefing/>}
            {mod==="revenue"     && <ModRevenue/>}
            {mod==="deals"       && <ModDeals/>}
            {mod==="orders"      && <ModOrders/>}
            {mod==="rfp"         && <ModRFP/>}
            {mod==="invoicing"   && <ModInvoicing/>}
            {mod==="reorder"     && <ModReorder/>}
            {mod==="prospecting" && <ModProspecting/>}
            {mod==="marketing"   && <ModMarketing/>}
            {mod==="outreach"    && <ModBatchOutreach/>}
            {mod==="templates"   && <ModTemplates/>}
            {mod==="compete"     && <ModCompete/>}
            {mod==="agent"       && <ModAgent/>}
            {mod==="alerts"      && <ModAlerts/>}
            {mod==="activity"    && <ModActivity/>}
            {mod==="settings"    && <ModSettings/>}
            </ErrBound>
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
  const [loading,setLoading]=useState(false);
  const doLogin=async()=>{
    if(!sel||pin.length<4) return;
    setLoading(true);
    try {
      const r=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:sel.id,pin})});
      if(r.ok){dispatch("LOGIN",sel.id);}
      else{setPin("");setShake(true);setTimeout(()=>setShake(false),500);}
    } catch {
      setPin("");setShake(true);setTimeout(()=>setShake(false),500);
    } finally {
      setLoading(false);
    }
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
              placeholder="••••" maxLength={4}
              style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"10px 12px",fontSize:15,letterSpacing:6,textAlign:"center"}}/>
          </div>
        )}
        <button onClick={doLogin} disabled={!sel||pin.length<4||loading}
          style={{width:"100%",background:sel&&pin.length>=4?B.orange:B.border,color:sel&&pin.length>=4?B.white:B.muted,border:"none",borderRadius:6,padding:"11px",fontFamily:"'Russo One',sans-serif",fontSize:13,letterSpacing:.5}}>
          {loading?"CHECKING…":"SIGN IN →"}
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
const ORDER_STAGES = ["Order Received","Order Placed","Invoiced"];

function ModBriefing() {
  const {s,dispatch,cu,setMod,toast}=useApp();
  const [advice,setAdvice]=useState("");
  const [loadAdv,setLoadAdv]=useState(false);
  const [addingOrder,setAddingOrder]=useState(false);
  const [oForm,setOForm]=useState({name:"",contact:"",school:"",value:"",invoiceNumber:"",trackingNumber:"",estimatedShip:"",vendorNotes:"",dealId:"",source:"manual"});
  const [sending,setSending]=useState(false);
  const [quickPrompt,setQuickPrompt]=useState("");

  const isOwner=cu?.role==="owner";
  const myDeals=isOwner?s.deals:s.deals.filter(d=>d.assignee===cu?.id);
  const myInv  =isOwner?s.invoices:s.invoices.filter(i=>i.assignee===cu?.id);
  const myRfps =isOwner?s.rfps:s.rfps.filter(r=>r.assignee===cu?.id);
  const orders =s.orders||[];
  const cMap   =Object.fromEntries((s.contacts||[]).map(c=>[c.id,c]));

  const overdueDeals=myDeals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0);
  const dueDeals    =myDeals.filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)>=0&&dUntil(d.followUpDate)<=1);
  const overdueInv  =myInv.filter(i=>i.status==="overdue");
  const rfpsDue     =myRfps.filter(r=>!["No Bid","Lost","Won"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=7);
  const pos         =myDeals.filter(d=>d.stage==="PO Received");
  const pipeline    =myDeals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).reduce((a,d)=>a+d.value,0);
  const ar          =myInv.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);

  // Campaign stats
  const todayStr2=today();
  const seqs=s.sequences||[];
  const activeSeqs=seqs.filter(seq=>seq.status==="active");
  const emailsDueToday=activeSeqs.reduce((n,seq)=>n+(seq.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr2)<=todayStr2).length,0);

  // Send due emails across all campaigns (from dashboard)
  const dashSendAll=async()=>{
    const co=s.company||{};
    const sigParts=[co.ownerName||co.name,co.email,co.phone,co.website].filter(Boolean);
    const sigText=sigParts.length?"\n\n—\n"+sigParts.join("\n"):"";
    setSending(true);
    let sent=0,failed=0;
    for(const seq of activeSeqs){
      const due=(seq.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr2)<=todayStr2);
      for(const enroll of due){
        const c=cMap[enroll.contactId];
        if(!c?.email){failed++;continue;}
        const touch=seq.touches[enroll.step];
        if(!touch){failed++;continue;}
        const subject=mergeTags(touch.subject,c)||`Following up — ${seq.product}`;
        const plain=mergeTags(touch.body,c)+sigText;
        const eid=`${seq.id}~${enroll.contactId}~${enroll.step}`;
        const trackUrl=`${window.location.origin}/api/track/open?eid=${encodeURIComponent(eid)}`;
        const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const htmlLines=plain.split("\n").map(l=>l.trim()?`<p style="margin:0 0 10px 0">${esc(l)}</p>`:"<br>").join("");
        const htmlBody=`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;max-width:600px;margin:0 auto;padding:20px 24px">${htmlLines}<img src="${trackUrl}" width="1" height="1" style="display:none" alt=""></body></html>`;
        try{
          const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"send",to_email:c.email,to_name:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),subject,body:plain,htmlBody})});
          const d=await r.json();
          if(d.sent){
            const nextStep=enroll.step+1;
            const done=nextStep>=seq.touches.length;
            const nextTouch=seq.touches[nextStep];
            const nextDate=nextTouch?new Date(Date.now()+nextTouch.dayOffset*86400000).toISOString().slice(0,10):null;
            dispatch("UPDATE_SEQUENCE",{...seq,enrollments:seq.enrollments.map(e=>
              e.contactId===enroll.contactId?{...e,step:nextStep,status:done?"done":"active",nextDate:nextDate||e.nextDate,lastContacted:todayStr2}:e
            )});
            dispatch("SCORE_CONTACT",{contactId:enroll.contactId,type:"sent",campaignId:seq.id,note:"Touch sent"});
            sent++;
          } else failed++;
        }catch{failed++;}
      }
    }
    setSending(false);
    if(sent+failed===0){toast("No emails due today","info");return;}
    toast(`Sent ${sent} email${sent!==1?"s":""}${failed?`, ${failed} failed`:""}`,sent>0?"success":"error");
  };

  // Build recent outreach activity from enrollment data
  const recentActivity=(()=>{
    const items=[];
    seqs.forEach(seq=>{
      (seq.enrollments||[]).forEach(e=>{
        const c=cMap[e.contactId];
        const name=c?(c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||c.email):"Unknown";
        if(e.status==="replied") items.push({date:e.lastContacted||e.enrolledAt||"",type:"replied",name,seq:seq.name,color:B.green,icon:"↩"});
        if(e.openedAt) items.push({date:e.openedAt.slice?.(0,10)||"",type:"opened",name,seq:seq.name,color:B.teal,icon:"👁"});
        if(e.lastContacted&&e.step>0) items.push({date:e.lastContacted,type:"sent",name,seq:seq.name,color:B.purple,icon:"✉",step:e.step});
      });
    });
    return items.filter(i=>i.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,18);
  })();
  const inFlightOrders=orders.filter(o=>o.stage!=="Invoiced");
  const hotLeads=[...(s.contacts||[])].filter(c=>(c.score||0)>=60).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4);

  const todayStr=today();
  const briefReady=s.lastBriefDate===todayStr&&(s.pendingBriefActions||[]).length>0;

  const generateBrief=async(silent=false)=>{
    if(!silent) setLoadAdv(true);
    try {
      const topLeads=[...(s.contacts||[])].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,8);
      const openDeals=myDeals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
      const prompt=`You are the ST1 Sports AI sales agent. Generate today's morning brief as a JSON object.
${ST1}
Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
Rep: ${cu?.name||"Matt"} (${cu?.role||"owner"})

PIPELINE: ${openDeals.length} open deals, ${fmt$(openDeals.reduce((a,d)=>a+d.value,0))}, ${overdueDeals.length} overdue
TOP LEADS: ${topLeads.map(c=>`${c.fullName||c.firstName} (${c.score}pts, ${c.zohoStatus||c.outreachStatus}, ${typeof c.school==="string"?c.school:c.school?.name||""}, ${c.email||"no email"})`).join("; ")||"none"}
HOT DEALS: ${myDeals.filter(d=>d.priority==="hot"&&!["Closed Won","Closed Lost"].includes(d.stage)).map(d=>`${d.name} ${fmt$(d.value)}`).join(", ")||"none"}
OVERDUE: ${overdueDeals.map(d=>`${d.name} ${Math.abs(dUntil(d.followUpDate))}d`).join(", ")||"none"}
AR OVERDUE: ${overdueInv.length} invoices, ${fmt$(overdueInv.reduce((a,i)=>a+(i.balance||0),0))}

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{"message":"2 sentence summary of today's situation","actions":[{"label":"Short title","description":"One sentence explaining the action","type":"draft_email|flag_deal|schedule_followup|open_module","payload":{...},"impact":"$X or description"}]}
Give 4-6 specific, actionable recommendations. For draft_email include to_name, to_email (if known), subject, body. For flag_deal include deal_name and priority. For schedule_followup include deal_name and date. For open_module include module name.`;
      const r=await fetch("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}],localContext:{deals:s.deals,contacts:s.contacts||[],invoices:s.invoices,sequences:s.sequences||[]}})});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw=await r.json();
      let parsed;
      try { parsed=typeof raw.message==="object"?raw.message:JSON.parse(raw.message); } catch { parsed=raw; }
      const actions=Array.isArray(parsed?.actions)?parsed.actions:(Array.isArray(raw?.actions)?raw.actions:[]);
      const msg=parsed?.message||raw?.message||"";
      if(actions.length>0){
        dispatch("SET_BRIEF",{actions,date:todayStr});
        if(typeof msg==="string") setAdvice(msg);
      }
    } catch(e){ if(!silent) setAdvice("Unable to generate brief — check AI Agent settings."); }
    setLoadAdv(false);
  };

  // Auto-generate brief once per day on mount
  useEffect(()=>{
    if(s.lastBriefDate!==todayStr){
      generateBrief(true);
    }
  },[]);

  const addOrder=()=>{
    if(!oForm.name) return;
    const o={...oForm,id:mkId(),stage:"Order Received",createdAt:today(),value:Number(oForm.value||0)};
    dispatch("ADD_ORDER",o);
    setAddingOrder(false);setOForm({name:"",contact:"",school:"",value:"",invoiceNumber:"",trackingNumber:"",estimatedShip:"",vendorNotes:"",dealId:"",source:"manual"});
    // Also promote any linked PO deal
    if(oForm.dealId) dispatch("UPDATE_DEAL",{id:oForm.dealId,stage:"Closed Won"});
  };

  const advanceOrder=(o)=>{
    const idx=ORDER_STAGES.indexOf(o.stage);
    if(idx<ORDER_STAGES.length-1) dispatch("UPDATE_ORDER",{id:o.id,stage:ORDER_STAGES[idx+1]});
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

  const stageColor={"Order Received":B.blue,"Order Placed":B.purple,"Invoiced":B.green};

  return (
    <div style={{padding:"22px 26px"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:21,color:B.black,letterSpacing:.3}}>GOOD {new Date().getHours()<12?"MORNING":new Date().getHours()<17?"AFTERNOON":"EVENING"}, {cu?.name.split(" ")[0].toUpperCase()}</div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
        <div style={{width:34,height:3,background:B.orange,marginTop:7,borderRadius:2}}/>
      </div>

      {/* AI quick prompt */}
      <form onSubmit={e=>{e.preventDefault();const q=quickPrompt.trim();if(q){dispatch("SET_AGENT_DRAFT",q);setQuickPrompt("");setMod("agent");}}} style={{display:"flex",gap:8,marginBottom:16}}>
        <input value={quickPrompt} onChange={e=>setQuickPrompt(e.target.value)}
          placeholder="Ask AI anything — e.g. 'Draft a follow-up for overdue deals' or 'Write a cold email for track coaches'"
          style={{flex:1,background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"10px 14px",fontSize:12,fontFamily:"'Lexend',sans-serif",color:B.text,outline:"none"}}/>
        <button type="submit" disabled={!quickPrompt.trim()} style={{background:quickPrompt.trim()?B.orange:"#ccc",color:B.white,border:"none",borderRadius:6,padding:"10px 18px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5,cursor:quickPrompt.trim()?"pointer":"default",whiteSpace:"nowrap"}}>✦ ASK AI →</button>
      </form>

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:11,marginBottom:20}}>
        <KCard l="Open Pipeline"  v={fmt$(pipeline)} c={B.orange} onClick={()=>setMod("deals")}/>
        <KCard l="Accounts Receivable" v={fmt$(ar)} c={B.red} onClick={()=>setMod("invoicing")}/>
        <KCard l="Orders In Flight" v={inFlightOrders.length} c={B.blue}/>
        <KCard l="Hot Leads" v={hotLeads.length} c={B.green} onClick={()=>setMod("prospecting")}/>
        <KCard l="Emails Due Today" v={emailsDueToday} c={emailsDueToday>0?B.green:B.muted} sub={emailsDueToday>0?"click Send All ↓":undefined} onClick={emailsDueToday>0?dashSendAll:undefined}/>
        <KCard l="Actions Needed" v={overdueDeals.length+overdueInv.length+rfpsDue.length} c={overdueDeals.length>0?B.red:B.yellow}/>
      </div>

      {/* ORDER TRACKER */}
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>ORDER FULFILLMENT TRACKER</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>Track every order from receipt through invoicing · admin.st1sports.com</div>
          </div>
          <div style={{display:"flex",gap:7}}>
            {pos.length>0&&<OBtn sm color={B.teal} onClick={()=>{
              pos.forEach(d=>{
                const exists=orders.some(o=>o.dealId===d.id);
                if(!exists) dispatch("ADD_ORDER",{id:mkId(),name:d.name,contact:d.contact,school:d.school,value:d.value,stage:"Order Received",dealId:d.id,source:"po",createdAt:today(),invoiceNumber:"",trackingNumber:"",estimatedShip:"",vendorNotes:""});
              });
            }}>↓ IMPORT {pos.length} PO{pos.length!==1?"s":""}</OBtn>}
            <OBtn sm onClick={()=>setAddingOrder(true)}>+ NEW ORDER</OBtn>
          </div>
        </div>

        {/* New order form */}
        {addingOrder&&(
          <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12,marginBottom:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
              {[["Order / Customer Name","name"],["Contact","contact"],["School / Org","school"]].map(([l,k])=>(
                <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><input value={oForm[k]} onChange={e=>setOForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
              {[["Value ($)","value"],["Invoice #","invoiceNumber"],["Est. Ship Date","estimatedShip"],["Vendor Notes","vendorNotes"]].map(([l,k])=>(
                <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><input value={oForm[k]} onChange={e=>setOForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
              ))}
            </div>
            {pos.length>0&&(
              <div style={{marginBottom:8}}>
                <Lbl s={{marginBottom:3}}>Link to PO Deal</Lbl>
                <select value={oForm.dealId} onChange={e=>setOForm(f=>({...f,dealId:e.target.value,name:f.name||pos.find(d=>d.id===e.target.value)?.name||f.name}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12}}>
                  <option value="">— no link —</option>
                  {pos.map(d=><option key={d.id} value={d.id}>{d.name} ({fmt$(d.value)})</option>)}
                </select>
              </div>
            )}
            <div style={{display:"flex",gap:7}}>
              <OBtn sm onClick={addOrder} disabled={!oForm.name}>CREATE ORDER</OBtn>
              <GBtn onClick={()=>setAddingOrder(false)} style={{fontSize:10}}>CANCEL</GBtn>
            </div>
          </div>
        )}

        {/* Stage columns */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {ORDER_STAGES.map(stage=>{
            const stOrders=orders.filter(o=>o.stage===stage);
            const col=stageColor[stage]||B.muted;
            return(
              <div key={stage} style={{background:B.surface,borderRadius:6,padding:10,borderTop:`3px solid ${col}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:col,letterSpacing:1.5}}>{stage.toUpperCase()}</div>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:col}}>{stOrders.length}</span>
                </div>
                {stOrders.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",padding:"12px 0"}}>—</div>}
                {stOrders.map(o=>{
                  const isLast=stage==="Invoiced";
                  const nextStage=ORDER_STAGES[ORDER_STAGES.indexOf(stage)+1];
                  return(
                    <div key={o.id} style={{background:B.white,borderRadius:5,padding:"8px 10px",marginBottom:6,border:`1px solid ${B.border}`,borderLeft:`3px solid ${col}`}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:2}}>{o.name}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:4}}>{o.contact&&`${o.contact} · `}{fmt$(o.value)}</div>
                      {o.invoiceNumber&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,marginBottom:2}}>INV: {o.invoiceNumber}</div>}
                      {o.trackingNumber&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,marginBottom:4}}>TRK: {o.trackingNumber}</div>}
                      {!isLast&&(
                        <button onClick={()=>advanceOrder(o)} style={{background:col,color:B.white,border:"none",borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.2,cursor:"pointer",width:"100%",marginTop:4}}>→ {nextStage?.toUpperCase()}</button>
                      )}
                      {isLast&&!o.zohoInvoiceId&&(
                        <button onClick={()=>setMod("orders")} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",marginTop:4,width:"100%"}}>OPEN IN ORDERS →</button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {orders.length===0&&!addingOrder&&(
          <div style={{textAlign:"center",padding:"20px 0",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
            No orders yet · Create manually, or click "Import POs" when deals reach PO Received stage
          </div>
        )}
      </div>

      {/* ── CAMPAIGN ACTIVITY ──────────────────────────────────────────────── */}
      <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>OUTREACH & CAMPAIGN ACTIVITY</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>
              {seqs.length} campaign{seqs.length!==1?"s":""} · {seqs.reduce((n,s)=>n+(s.enrollments||[]).length,0)} enrolled · {seqs.reduce((n,s)=>n+(s.enrollments||[]).filter(e=>e.status==="active").length,0)} active
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {emailsDueToday>0&&(
              <button onClick={dashSendAll} disabled={sending} style={{background:B.green,color:B.white,border:"none",borderRadius:5,padding:"7px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
                {sending?"SENDING...":"▶ SEND ALL DUE ("+emailsDueToday+")"}
              </button>
            )}
            <button onClick={()=>setMod("marketing")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:5,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>MANAGE CAMPAIGNS →</button>
          </div>
        </div>

        {seqs.length===0?(
          <div style={{textAlign:"center",padding:"20px 0",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
            No campaigns yet — <button onClick={()=>setMod("marketing")} style={{background:"none",border:"none",color:B.orange,fontFamily:"'Lexend',sans-serif",fontSize:11,cursor:"pointer",padding:0}}>create one in Campaigns →</button>
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {/* Campaign table — single shared grid for aligned columns */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 42px 42px 42px 42px 42px 52px",gap:"0 8px",alignItems:"center"}}>
              {/* Header row */}
              {["CAMPAIGN","ENRL","SENT","OPEN","REPL","DONE","DUE"].map(h=>(
                <div key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,paddingBottom:6,borderBottom:`1px solid ${B.border}`,textAlign:h==="CAMPAIGN"?"left":"center"}}>{h}</div>
              ))}
              {/* Data rows — display:contents makes cells direct grid children */}
              {seqs.map(seq=>{
                const enrs=seq.enrollments||[];
                const sentN=enrs.reduce((n,e)=>n+(e.step||0),0);
                const openN=enrs.filter(e=>e.openedAt).length;
                const replN=enrs.filter(e=>e.status==="replied").length;
                const doneN=enrs.filter(e=>e.status==="done").length;
                const dueN=enrs.filter(e=>e.status==="active"&&(e.nextDate||todayStr2)<=todayStr2).length;
                const openPct=enrs.length>0?Math.round(openN/enrs.length*100):0;
                const replPct=enrs.length>0?Math.round(replN/enrs.length*100):0;
                return(
                  <React.Fragment key={seq.id}>
                    <div style={{paddingTop:7,paddingBottom:7,borderBottom:`1px solid ${B.border}`}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{seq.name}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{seq.product} · {seq.touches?.length||0} touches</div>
                      <div style={{display:"flex",gap:4,marginTop:3,alignItems:"center"}}>
                        <div style={{height:3,width:Math.round(openPct*0.7),background:B.teal,borderRadius:2,minWidth:2}}/>
                        <div style={{height:3,width:Math.round(replPct*0.7),background:B.green,borderRadius:2,minWidth:0}}/>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.3}}>{openPct}% open · {replPct}% reply</div>
                      </div>
                    </div>
                    {[enrs.length,sentN,openN,replN,doneN].map((v,i)=>(
                      <div key={i} style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:[B.blue,B.purple,B.teal,B.green,B.muted][i],textAlign:"center",paddingTop:7,paddingBottom:7,borderBottom:`1px solid ${B.border}`}}>{v}</div>
                    ))}
                    <div style={{textAlign:"center",paddingTop:7,paddingBottom:7,borderBottom:`1px solid ${B.border}`}}>
                      {dueN>0?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.white,background:B.green,padding:"2px 6px",borderRadius:3,whiteSpace:"nowrap"}}>▶ {dueN}</span>:<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>—</span>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Recent outreach activity feed */}
            <div>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:10}}>RECENT ACTIVITY</div>
              {recentActivity.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Activity appears after you send emails</div>}
              <div style={{maxHeight:260,overflowY:"auto"}}>
                {recentActivity.map((item,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:7,paddingBottom:7,borderBottom:`1px solid ${B.border}`}}>
                    <div style={{width:20,height:20,borderRadius:"50%",background:`${item.color}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:10,marginTop:1}}>{item.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:item.color}}>
                        {item.type==="sent"?`emailed (touch ${item.step})`:item.type==="opened"?"opened email":item.type==="replied"?"replied ←":""}
                        <span style={{color:B.muted}}> · {item.seq}</span>
                      </div>
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,flexShrink:0,whiteSpace:"nowrap"}}>
                      {item.date===todayStr2?"today":item.date===new Date(Date.now()-86400000).toISOString().slice(0,10)?"yesterday":item.date}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
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
          {overdueDeals.length===0&&dueDeals.length===0&&overdueInv.length===0&&rfpsDue.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.border,marginBottom:6}}>ALL CLEAR</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Nothing urgent. Check pipeline for proactive opportunities.</div></div>
          )}
        </div>

        <div>
          {/* Morning Brief — Approval Cards */}
          <div className="card" style={{padding:14,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <Lbl>✦ TODAY'S RECOMMENDATIONS</Lbl>
              <button onClick={()=>generateBrief(false)} disabled={loadAdv} style={{background:"none",border:"none",color:B.muted,fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",opacity:loadAdv?.5:1}}>↺ REFRESH</button>
            </div>
            {loadAdv&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.yellow,padding:"12px 0"}}><Spin/>Generating your brief...</div>}
            {!loadAdv&&advice&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:12,padding:"8px 10px",background:B.surface,borderRadius:5}}>{advice}</div>}
            {!loadAdv&&(s.pendingBriefActions||[]).length===0&&!advice&&(
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"16px 0"}}>Generating today's brief…</div>
            )}
            {(s.pendingBriefActions||[]).map((act,i)=>(
              <div key={i} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"10px 12px",marginBottom:8,borderLeft:`3px solid ${B.orange}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{act.label}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.5}}>{act.description}</div>
                    {act.impact&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:.5,marginTop:4}}>{act.impact}</div>}
                  </div>
                  <button onClick={()=>dispatch("DISMISS_BRIEF_ACTION",i)} style={{background:"none",border:"none",color:B.muted,fontSize:14,cursor:"pointer",marginLeft:8,lineHeight:1}}>×</button>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{
                    const p=act.payload||{};
                    if(act.type==="draft_email"){
                      dispatch("SET_AGENT_DRAFT",`Draft an outreach email to ${p.to_name||act.label}${p.to_email?` (${p.to_email})`:""}. ${p.subject?`Subject: ${p.subject}.`:""} ${p.body?`Context: ${p.body}`:""}`.trim());
                      setMod("agent");
                    } else if(act.type==="flag_deal"){
                      const deal=(s.deals||[]).find(d=>d.name?.toLowerCase()===p.deal_name?.toLowerCase());
                      if(deal) dispatch("UPDATE_DEAL",{...deal,priority:p.priority||"hot"});
                      dispatch("DISMISS_BRIEF_ACTION",i);
                    } else if(act.type==="schedule_followup"){
                      const deal=(s.deals||[]).find(d=>d.name?.toLowerCase()===p.deal_name?.toLowerCase());
                      if(deal) dispatch("UPDATE_DEAL",{...deal,followUpDate:p.date||todayStr});
                      dispatch("DISMISS_BRIEF_ACTION",i);
                    } else if(act.type==="open_module"){
                      setMod(p.module||"agent");
                      dispatch("DISMISS_BRIEF_ACTION",i);
                    } else {
                      dispatch("SET_AGENT_DRAFT",`${act.label}: ${act.description}`);
                      setMod("agent");
                    }
                  }} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.4,cursor:"pointer",flex:1}}>✓ APPROVE</button>
                  <button onClick={()=>dispatch("DISMISS_BRIEF_ACTION",i)} style={{background:B.surface,color:B.muted,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>SKIP</button>
                </div>
              </div>
            ))}
          </div>

          {/* Hot leads */}
          {hotLeads.length>0&&(
            <div className="card" style={{padding:14,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Lbl>🔥 HOT LEADS</Lbl>
                <button onClick={()=>setMod("prospecting")} style={{background:"none",border:"none",color:B.orange,fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>SEE ALL →</button>
              </div>
              {hotLeads.map(c=>{const t=scoreTier(c.score);return(
                <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${B.border}`}}>
                  <div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||c.firstName}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""}</div>
                  </div>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:t.color}}>{c.score}</span>
                </div>
              );})}
            </div>
          )}

          {/* Campaign pulse — richer */}
          {seqs.length>0&&(
            <div className="card" style={{padding:14,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Lbl>✦ CAMPAIGN PULSE</Lbl>
                <button onClick={()=>setMod("marketing")} style={{background:"none",border:"none",color:B.orange,fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>MANAGE →</button>
              </div>
              {/* Aggregate funnel */}
              {(()=>{
                const totEnr=seqs.reduce((n,s)=>n+(s.enrollments||[]).length,0);
                const totSent=seqs.reduce((n,s)=>n+(s.enrollments||[]).reduce((m,e)=>m+(e.step||0),0),0);
                const totOpen=seqs.reduce((n,s)=>n+(s.enrollments||[]).filter(e=>e.openedAt).length,0);
                const totRepl=seqs.reduce((n,s)=>n+(s.enrollments||[]).filter(e=>e.status==="replied").length,0);
                return totEnr>0?(
                  <div style={{display:"flex",gap:6,marginBottom:12,justifyContent:"space-between"}}>
                    {[["Enrolled",totEnr,B.blue],["Sent",totSent,B.purple],["Opened",totOpen,B.teal],["Replied",totRepl,B.green]].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:"center"}}>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:c}}>{v}</div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5}}>{l}</div>
                      </div>
                    ))}
                  </div>
                ):null;
              })()}
              {seqs.slice(0,5).map(seq=>{
                const enrs=seq.enrollments||[];
                const openN=enrs.filter(e=>e.openedAt).length;
                const replN=enrs.filter(e=>e.status==="replied").length;
                const activeN=enrs.filter(e=>e.status==="active").length;
                const openPct=enrs.length>0?Math.round(openN/enrs.length*100):0;
                const replPct=enrs.length>0?Math.round(replN/enrs.length*100):0;
                return(
                  <div key={seq.id} style={{marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${B.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{seq.name}</div>
                      <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:replN>0?B.green:B.muted}}>{replPct}%</span>
                    </div>
                    <div style={{position:"relative",height:5,background:B.border,borderRadius:3,marginBottom:5,overflow:"hidden"}}>
                      <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${openPct}%`,background:B.teal,borderRadius:3}}/>
                      <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${replPct}%`,background:B.green,borderRadius:3}}/>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,letterSpacing:.3}}>{activeN} active</span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.teal,letterSpacing:.3}}>{openPct}% open</span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,letterSpacing:.3}}>{replPct}% reply</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Win rate */}
          <div className="card" style={{padding:14}}>
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
                </div>
              ));
            })()}
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
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:9,alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,letterSpacing:.3}}>{sel_d.name}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{sel_d.contact} · {sel_d.school}</div>
                </div>
                <div style={{flexShrink:0,marginLeft:9,textAlign:"right"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>VALUE ($)</div>
                  <input type="number" defaultValue={sel_d.value||0} onBlur={e=>dispatch("UPDATE_DEAL",{id:sel_d.id,value:Number(e.target.value||0)})}
                    style={{width:100,background:B.surface,border:`1px solid ${B.orange}`,color:B.orange,borderRadius:4,padding:"4px 7px",fontSize:13,fontFamily:"'Russo One',sans-serif",textAlign:"right"}}/>
                </div>
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
//  REVENUE DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function ModRevenue() {
  const {s,setMod}=useApp();
  const deals=s.deals||[];
  const won=deals.filter(d=>d.stage==="Closed Won");
  const open=deals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
  const lost=deals.filter(d=>d.stage==="Closed Lost");

  const pipeline=open.reduce((a,d)=>a+(d.value||0),0);
  const wonTotal=won.reduce((a,d)=>a+(d.value||0),0);
  const arTotal=(s.invoices||[]).filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);

  // Won by month (last 12 months)
  const now=new Date();
  const months=Array.from({length:6},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);
    return{label:d.toLocaleString("en-US",{month:"short",year:"2-digit"}),key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`};
  });
  const wonByMonth=months.map(m=>{
    const mWon=won.filter(d=>(d.closedDate||d.createdAt||"").startsWith(m.key));
    return{...m,count:mWon.length,value:mWon.reduce((a,d)=>a+(d.value||0),0)};
  });
  const maxMonthVal=Math.max(...wonByMonth.map(m=>m.value),1);

  // Pipeline by stage
  const stageGroups={};
  open.forEach(d=>{stageGroups[d.stage]=(stageGroups[d.stage]||[]).concat(d);});
  const stageSummary=Object.entries(stageGroups).map(([stage,ds])=>({stage,count:ds.length,value:ds.reduce((a,d)=>a+(d.value||0),0)})).sort((a,b)=>b.value-a.value);

  // Top products
  const prodMap={};
  [...won,...open].forEach(d=>{if(d.product){prodMap[d.product]=(prodMap[d.product]||0)+(d.value||0);}});
  const topProducts=Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  // Conversion rate
  const totalClosed=won.length+lost.length;
  const convRate=totalClosed>0?Math.round((won.length/totalClosed)*100):0;
  const avgDeal=won.length>0?Math.round(wonTotal/won.length):0;

  return(
    <div style={{padding:"22px 26px",overflowY:"auto",height:"calc(100vh - 46px)"}}>
      <PH title="REVENUE" sub="Pipeline health, won deals, conversion rates, and product performance"/>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:11,marginBottom:20}}>
        <KCard l="Open Pipeline"   v={fmt$(pipeline)} c={B.orange}/>
        <KCard l="Total Won"       v={fmt$(wonTotal)}  c={B.green}/>
        <KCard l="AR Outstanding"  v={fmt$(arTotal)}   c={B.red}/>
        <KCard l="Win Rate"        v={`${convRate}%`}  c={B.blue}/>
        <KCard l="Avg Deal Size"   v={fmt$(avgDeal)}   c={B.purple}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        {/* Won by Month chart */}
        <div className="card" style={{padding:16}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.5,marginBottom:14}}>WON REVENUE — LAST 6 MONTHS</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,marginBottom:8}}>
            {wonByMonth.map(m=>(
              <div key={m.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted,textAlign:"center"}}>{m.value>0?fmt$(m.value).replace("$","$"):""}</div>
                <div style={{width:"100%",background:m.value>0?B.orange:B.border,borderRadius:"3px 3px 0 0",height:m.value>0?`${Math.max(6,Math.round((m.value/maxMonthVal)*80))}px`:"4px",transition:"height .3s"}}/>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted,textAlign:"center",whiteSpace:"nowrap"}}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"right"}}>
            {won.length} won deals · avg {fmt$(avgDeal)}
          </div>
        </div>

        {/* Pipeline by stage */}
        <div className="card" style={{padding:16}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.5,marginBottom:14}}>PIPELINE BY STAGE</div>
          {stageSummary.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:"20px 0"}}>No open deals</div>}
          {stageSummary.map(({stage,count,value})=>{
            const pct=pipeline>0?Math.round((value/pipeline)*100):0;
            const sc={Quoted:B.blue,"Follow-Up 1":B.purple,"Follow-Up 2":B.orange,Negotiating:B.yellow,"PO Received":B.teal};
            const col=sc[stage]||B.muted;
            return(
              <div key={stage} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{stage} <span style={{color:B.muted}}>({count})</span></span>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:col}}>{fmt$(value)}</span>
                </div>
                <div style={{background:B.border,borderRadius:4,height:6,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:col,borderRadius:4,transition:"width .4s"}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {/* Top products */}
        <div className="card" style={{padding:16}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.5,marginBottom:14}}>TOP PRODUCTS BY PIPELINE VALUE</div>
          {topProducts.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:"20px 0"}}>Tag deals with product categories to see data</div>}
          {topProducts.map(([prod,val],i)=>(
            <div key={prod} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
              <div style={{display:"flex",gap:9,alignItems:"center"}}>
                <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.muted,minWidth:16}}>{i+1}</span>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>{prod}</span>
              </div>
              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.green}}>{fmt$(val)}</span>
            </div>
          ))}
        </div>

        {/* Orders in flight + AR */}
        <div className="card" style={{padding:16}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.5,marginBottom:14}}>ORDERS & AR SNAPSHOT</div>
          {ORDER_STAGES.map(stage=>{
            const cnt=(s.orders||[]).filter(o=>o.stage===stage).length;
            const val=(s.orders||[]).filter(o=>o.stage===stage).reduce((a,o)=>a+(o.value||0),0);
            const col={"Order Received":B.blue,"Order Placed":B.purple,"Invoiced":B.green}[stage]||B.muted;
            return(
              <div key={stage} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${B.border}`,cursor:"pointer"}} onClick={()=>setMod("orders")}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:col}}/>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>{stage}</span>
                </div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{cnt} orders</span>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:col}}>{fmt$(val)}</span>
                </div>
              </div>
            );
          })}
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>Total AR Outstanding</span>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.red}}>{fmt$(arTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ORDER MANAGER
// ════════════════════════════════════════════════════════════════════════════
function ModOrders() {
  const {s,dispatch,toast}=useApp();
  const orders=s.orders||[];
  const [view,setView]=useState("kanban"); // "kanban"|"scan"
  const [scanning,setScanning]=useState(false);
  const [emailProposals,setEmailProposals]=useState([]);
  const [creating,setCreating]=useState(null); // proposal being converted
  const [oForm,setOForm]=useState({name:"",contact:"",email:"",school:"",value:"",notes:"",source:"manual",items:[]});
  const [addingManual,setAddingManual]=useState(false);
  const [invoicing,setInvoicing]=useState(null); // orderId being invoiced

  const stageCol={"Order Received":B.blue,"Order Placed":B.purple,"Invoiced":B.green};

  const advanceOrder=async(o)=>{
    const idx=ORDER_STAGES.indexOf(o.stage);
    if(idx>=ORDER_STAGES.length-1)return;
    const nextStage=ORDER_STAGES[idx+1];
    dispatch("UPDATE_ORDER",{id:o.id,stage:nextStage,updatedAt:today()});
    toast(`${o.name} → ${nextStage}`,"success");
    dispatch("LOG",{msg:`Order "${o.name}" advanced to ${nextStage}`});
    // When reaching Invoiced: push to Zoho Books
    if(nextStage==="Invoiced"){
      setInvoicing(o.id);
      try{
        const r=await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          service:"books",endpoint:"/invoices",method:"POST",
          body:{
            customer_name:o.school||o.contact||o.name,
            date:today(),
            due_date:new Date(Date.now()+30*86400000).toISOString().slice(0,10),
            line_items:o.items?.length>0
              ?o.items.map(item=>({name:item.name,description:item.description||"",quantity:item.qty||1,rate:item.rate||0}))
              :[{name:o.name,description:o.notes||"",quantity:1,rate:o.value||0}],
            notes:`Order #${o.id.slice(-6).toUpperCase()} — created via ST1 RevOps.`,
            terms:"Due within 30 days.",
          }
        })});
        const d=await r.json();
        if(d.invoice?.invoice_id||d.invoice_id){
          const invId=d.invoice?.invoice_id||d.invoice_id;
          const invNum=d.invoice?.invoice_number||d.invoice_number||invId;
          dispatch("UPDATE_ORDER",{id:o.id,zohoInvoiceId:invId,invoiceNumber:invNum});
          toast(`✓ Zoho Books invoice created: ${invNum}`,"success");
        }else{
          toast("Order invoiced · Zoho Books not fully connected","info");
        }
      }catch(e){toast(`Invoice sync failed: ${e.message.slice(0,60)}`,"error");}
      setInvoicing(null);
    }
  };

  const scanEmail=async()=>{
    setScanning(true);setEmailProposals([]);setView("scan");
    try{
      const listRes=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"list",query:"subject:(order purchase equipment quote interested buying need buy request proposal) newer_than:60d category:primary",maxResults:15})});
      const {messages=[]}=await listRes.json();
      if(!messages.length){toast("No order emails found in inbox","info");setScanning(false);return;}
      // Fetch full bodies (limit 10)
      const bodies=await Promise.all(messages.slice(0,10).map(m=>
        fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"get",messageId:m.id})}).then(r=>r.json()).catch(()=>null)
      ));
      const valid=bodies.filter(Boolean);
      const prompt=`You are reviewing emails for ST1 Sports (athletic equipment). Identify emails where a customer wants to BUY equipment or is placing/requesting an order.

Emails:
${valid.map(e=>`---\nID: ${e.id}\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${(e.body||e.snippet||"").slice(0,500)}`).join("\n")}

For each email that is a purchase request or order, return JSON array:
[{"email_id":"","customer_name":"","customer_email":"","school":"","items_mentioned":"","estimated_value":0,"urgency":"high|medium|low","summary":"1 sentence"}]

Only include actual purchase requests. Return [] if none found.`;
      const raw=await aiCall(prompt,{json:true,tokens:2000});
      const proposals=Array.isArray(raw)?raw:[];
      setEmailProposals(proposals);
      if(!proposals.length)toast("No purchase emails identified","info");
      else toast(`${proposals.length} potential order${proposals.length!==1?"s":""} found`,"success");
    }catch(e){toast(`Scan failed: ${e.message.slice(0,80)}`,"error");}
    setScanning(false);
  };

  const createFromEmail=(p)=>{
    const o={id:mkId(),name:p.school?`${p.school} — ${p.items_mentioned||"Equipment"}`:p.customer_name,
      contact:p.customer_name,email:p.customer_email||"",school:p.school||"",
      value:p.estimated_value||0,notes:p.summary||"",stage:"Order Received",
      source:"email",emailId:p.email_id,createdAt:today(),items:[]};
    dispatch("ADD_ORDER",o);
    dispatch("LOG",{msg:`Order created from email: ${o.name}`});
    setEmailProposals(ep=>ep.filter(x=>x.email_id!==p.email_id));
    toast(`Order created: ${o.name}`,"success");
  };

  const createManualOrder=()=>{
    if(!oForm.name){toast("Order name required","error");return;}
    const o={...oForm,id:mkId(),stage:"Order Received",createdAt:today(),updatedAt:today(),value:Number(oForm.value)||0};
    dispatch("ADD_ORDER",o);
    dispatch("LOG",{msg:`Manual order created: ${o.name}`});
    toast("Order created","success");
    setOForm({name:"",contact:"",email:"",school:"",value:"",notes:"",source:"manual",items:[]});
    setAddingManual(false);
  };

  const URGENCY_C={high:B.red,medium:B.orange,low:B.muted};

  return(
    <div style={{padding:"22px 26px",height:"calc(100vh - 46px)",overflowY:"auto"}}>
      <PH title="ORDER MANAGER" sub="Track orders from receipt through invoicing → auto-syncs to Zoho Books"
        action={<div style={{display:"flex",gap:7}}>
          <button onClick={scanEmail} disabled={scanning} style={{background:scanning?B.surface:B.blue,color:scanning?B.muted:B.white,border:`1px solid ${scanning?B.border:B.blue}`,borderRadius:5,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.4}}>
            {scanning?"🔍 SCANNING EMAIL...":"📧 SCAN EMAIL FOR ORDERS"}
          </button>
          <button onClick={()=>{setView("kanban");setAddingManual(true);}} style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.4}}>+ NEW ORDER</button>
          {view==="scan"&&<button onClick={()=>setView("kanban")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:5,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>← BACK</button>}
        </div>}/>

      {/* Manual create form */}
      {addingManual&&(
        <div className="card" style={{padding:16,marginBottom:14,borderTop:`3px solid ${B.orange}`}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>NEW ORDER</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["Order / Customer Name *","name"],["Contact Person","contact"],["School / Org","school"],["Email","email"],["Value ($)","value"],["Notes","notes"]].map(([l,k])=>(
              <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl>
                <input value={oForm[k]} onChange={e=>setOForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:7}}>
            <OBtn sm onClick={createManualOrder} disabled={!oForm.name}>CREATE ORDER</OBtn>
            <GBtn onClick={()=>setAddingManual(false)} style={{fontSize:10}}>CANCEL</GBtn>
          </div>
        </div>
      )}

      {/* Email scan results */}
      {view==="scan"&&(
        <div>
          {scanning&&<div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}><Spin/> Scanning Gmail for purchase emails...</div>}
          {!scanning&&emailProposals.length===0&&(
            <div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
              No purchase emails found.<br/>Try adjusting the scan — emails with order/purchase keywords in the last 60 days are checked.
              <br/><br/><button onClick={()=>setView("kanban")} style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"8px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>← BACK TO KANBAN</button>
            </div>
          )}
          {emailProposals.length>0&&(
            <div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:12}}>{emailProposals.length} purchase email{emailProposals.length!==1?"s":""} detected — click to create orders</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {emailProposals.map((p,i)=>(
                  <div key={i} className="card" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",borderLeft:`3px solid ${URGENCY_C[p.urgency]||B.muted}`}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500}}>{p.customer_name}</span>
                        {p.school&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>· {p.school}</span>}
                        <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:URGENCY_C[p.urgency]||B.muted,background:`${URGENCY_C[p.urgency]||B.muted}18`,padding:"1px 6px",borderRadius:8,letterSpacing:.4}}>{(p.urgency||"medium").toUpperCase()}</span>
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:2}}>{p.summary}</div>
                      {p.items_mentioned&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>Items: {p.items_mentioned}</div>}
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:16,flexShrink:0}}>
                      {p.estimated_value>0&&<span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(p.estimated_value)}</span>}
                      <OBtn sm onClick={()=>createFromEmail(p)}>+ CREATE ORDER</OBtn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kanban */}
      {view==="kanban"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {ORDER_STAGES.map(stage=>{
            const stOrders=orders.filter(o=>o.stage===stage);
            const col=stageCol[stage]||B.muted;
            const stVal=stOrders.reduce((a,o)=>a+(o.value||0),0);
            return(
              <div key={stage} style={{background:B.surface,borderRadius:8,padding:12,borderTop:`3px solid ${col}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:col,letterSpacing:1.5}}>{stage.toUpperCase()}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{fmt$(stVal)}</div>
                  </div>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:col}}>{stOrders.length}</span>
                </div>
                {stOrders.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",padding:"20px 0"}}>—</div>}
                {stOrders.map(o=>{
                  const isLast=stage==="Invoiced";
                  const nextStage=ORDER_STAGES[ORDER_STAGES.indexOf(stage)+1];
                  return(
                    <div key={o.id} style={{background:B.white,borderRadius:6,padding:"10px 12px",marginBottom:8,border:`1px solid ${B.border}`,borderLeft:`3px solid ${col}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,flex:1,lineHeight:1.4}}>{o.name}</div>
                        <button onClick={()=>dispatch("DEL_ORDER",o.id)} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:14,padding:0,marginLeft:6,lineHeight:1,opacity:.5}}>×</button>
                      </div>
                      {o.contact&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:2}}>{o.contact}{o.school?` · ${o.school}`:""}</div>}
                      {o.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,marginBottom:2}}>{o.email}</div>}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(o.value)}</span>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{o.createdAt}</span>
                      </div>
                      {o.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6,lineHeight:1.5,borderTop:`1px solid ${B.border}`,paddingTop:6}}>{o.notes.slice(0,80)}{o.notes.length>80?"…":""}</div>}
                      {o.invoiceNumber&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,marginBottom:4}}>✓ INVOICE: {o.invoiceNumber}</div>}
                      {o.source==="email"&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,marginBottom:4}}>📧 FROM EMAIL</div>}
                      {!isLast&&(
                        <button onClick={()=>advanceOrder(o)} disabled={invoicing===o.id} style={{background:col,color:B.white,border:"none",borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",width:"100%",letterSpacing:.3,opacity:invoicing===o.id?.6:1}}>
                          {invoicing===o.id?"SYNCING...":"→ "+nextStage?.toUpperCase()}
                        </button>
                      )}
                      {isLast&&!o.zohoInvoiceId&&(
                        <button onClick={async()=>{
                          setInvoicing(o.id);
                          try{
                            const r=await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                              service:"books",endpoint:"/invoices",method:"POST",
                              body:{customer_name:o.school||o.contact||o.name,date:today(),due_date:new Date(Date.now()+30*86400000).toISOString().slice(0,10),
                                line_items:o.items?.length>0?o.items.map(item=>({name:item.name,description:item.description||"",quantity:item.qty||1,rate:item.rate||0})):[{name:o.name,description:o.notes||"",quantity:1,rate:o.value||0}],
                                notes:`Order from ST1 RevOps.`,terms:"Due within 30 days."}
                            })});
                            const d=await r.json();
                            if(d.invoice?.invoice_id){dispatch("UPDATE_ORDER",{id:o.id,zohoInvoiceId:d.invoice.invoice_id,invoiceNumber:d.invoice.invoice_number});toast(`✓ Zoho invoice: ${d.invoice.invoice_number}`,"success");}
                            else toast("Zoho Books not connected — invoice not created","info");
                          }catch(e){toast(`Invoice error: ${e.message}`,"error");}
                          setInvoicing(null);
                        }} disabled={invoicing===o.id} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",width:"100%",marginTop:4}}>
                          {invoicing===o.id?"CREATING...":"✓ CREATE ZOHO INVOICE"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {view==="kanban"&&orders.length===0&&!addingManual&&(
        <div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
          No orders yet. Scan your email for purchase requests or create manually.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  QUOTE BUILDER
// ════════════════════════════════════════════════════════════════════════════
const ST1_PRODUCTS=[
  {name:"110m Hurdles (Set of 10)",rate:1450,description:"Aluminum competition hurdles, adjustable height"},
  {name:"400m Hurdles (Set of 10)",rate:1650,description:"Heavy-duty competition 400m hurdles"},
  {name:"Starting Blocks (Pair)",rate:380,description:"Competition starting blocks, aluminum"},
  {name:"Shot Put 12lb",rate:45,description:"Competition shot put, 12lb"},
  {name:"Shot Put 16lb",rate:52,description:"Competition shot put, 16lb"},
  {name:"Discus 1kg",rate:65,description:"Rubber competition discus"},
  {name:"Discus 1.75kg",rate:78,description:"Rubber competition discus, men's"},
  {name:"Hammer 7.26kg",rate:85,description:"Competition hammer"},
  {name:"Hammer 4kg",rate:72,description:"Women's competition hammer"},
  {name:"Javelin Men's 800g",rate:125,description:"Carbon fiber competition javelin"},
  {name:"Javelin Women's 600g",rate:115,description:"Carbon fiber competition javelin"},
  {name:"High Jump Standards",rate:895,description:"Aluminum high jump standards with crossbar"},
  {name:"Pole Vault Standards",rate:2200,description:"Competition pole vault standards"},
  {name:"Long Jump Rake + Drag Mat",rate:185,description:"Aluminum rake, 6ft drag mat"},
  {name:"Hurdle Storage Cart",rate:245,description:"Holds 10 hurdles, with wheels"},
  {name:"Relay Batons Set (4)",rate:35,description:"Aluminum relay batons"},
  {name:"Training Hurdles Set (6)",rate:285,description:"Adjustable practice hurdles"},
  {name:"Throwing Cage",rate:3200,description:"Competition throwing cage, portable"},
  {name:"Shot Put Toe Board",rate:95,description:"Aluminum competition toe board"},
  {name:"Measuring Tape 50m",rate:55,description:"Officials fiberglass measuring tape"},
  {name:"Equipment Shipping & Handling",rate:150,description:""},
];

function ModQuotes() {
  const {s,dispatch,toast}=useApp();
  const [tab,setTab]=useState("build");
  const [customer,setCustomer]=useState({name:"",email:"",school:"",phone:"",address:""});
  const [contactQ,setContactQ]=useState("");
  const [lineItems,setLineItems]=useState([{id:mkId(),name:"",description:"",qty:1,rate:0}]);
  const [discount,setDiscount]=useState(0);
  const [taxPct,setTaxPct]=useState(0);
  const [terms,setTerms]=useState("Payment due within 30 days of invoice receipt. All equipment ships within 5–7 business days from order confirmation. Volume discounts may apply for orders over $2,000. ST1 Sports standard warranty applies to all equipment.");
  const [notes,setNotes]=useState("");
  const [quoteDate,setQuoteDate]=useState(today());
  const [validDays,setValidDays]=useState(30);
  const [zohoItems,setZohoItems]=useState([]);
  const [itemsLoaded,setItemsLoaded]=useState(false);
  const [pastQuotes,setPastQuotes]=useState([]);
  const [quotesLoading,setQuotesLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [pickerQ,setPickerQ]=useState("");
  const [savedQuote,setSavedQuote]=useState(null);

  const allProducts=[...ST1_PRODUCTS,...zohoItems.filter(zi=>!ST1_PRODUCTS.find(p=>p.name===zi.name))];
  const filteredProducts=allProducts.filter(p=>!pickerQ||p.name.toLowerCase().includes(pickerQ.toLowerCase())||p.description?.toLowerCase().includes(pickerQ.toLowerCase()));

  useEffect(()=>{
    if(tab==="build"&&!itemsLoaded){
      setItemsLoaded(true);
      fetch("/api/zoho-quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list_items"})})
        .then(r=>r.json()).then(d=>{if(d.items?.length)setZohoItems(d.items);}).catch(()=>{});
    }
    if(tab==="list"&&!quotesLoading&&pastQuotes.length===0){
      setQuotesLoading(true);
      fetch("/api/zoho-quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list_quotes"})})
        .then(r=>r.json()).then(d=>setPastQuotes(d.quotes||[])).catch(()=>{}).finally(()=>setQuotesLoading(false));
    }
  },[tab]);

  const subtotal=lineItems.reduce((a,li)=>a+(li.qty||0)*(li.rate||0),0);
  const discountAmt=subtotal*(discount/100);
  const taxAmt=(subtotal-discountAmt)*(taxPct/100);
  const total=subtotal-discountAmt+taxAmt;

  const addLine=(product=null)=>{
    setLineItems(ls=>[...ls,product
      ?{id:mkId(),name:product.name,description:product.description||"",qty:1,rate:product.rate,item_id:product.item_id}
      :{id:mkId(),name:"",description:"",qty:1,rate:0}]);
    setShowPicker(false);setPickerQ("");
  };
  const removeLine=(id)=>setLineItems(ls=>ls.filter(l=>l.id!==id));
  const updLine=(id,field,val)=>setLineItems(ls=>ls.map(l=>l.id===id?{...l,[field]:val}:l));
  const fillContact=(c)=>{
    setCustomer({name:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),email:c.email||"",school:(typeof c.school==="string"?c.school:c.school?.name||""),phone:c.phone||"",address:""});
    setContactQ("");
  };
  const contactMatches=(s.contacts||[]).filter(c=>contactQ&&((c.fullName||c.firstName||"").toLowerCase().includes(contactQ.toLowerCase())||(typeof c.school==="string"?c.school:c.school?.name||"").toLowerCase().includes(contactQ.toLowerCase()))).slice(0,6);

  const saveQuote=async(sendEmail=false)=>{
    if(!customer.name&&!customer.school){toast("Customer name required","error");return;}
    if(!lineItems.some(li=>li.name&&(li.qty||0)>0&&(li.rate||0)>0)){toast("Add at least one line item with name, qty, and price","error");return;}
    if(sendEmail&&!customer.email){toast("Customer email required to send","error");return;}
    setSaving(true);
    const expiry=new Date(quoteDate);expiry.setDate(expiry.getDate()+validDays);
    const expiryStr=expiry.toISOString().split("T")[0];
    try{
      const r=await fetch("/api/zoho-quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action:"create_quote",
        customer_name:customer.school||customer.name,
        contact_person:customer.name,
        billing_address:{attention:customer.name,phone:customer.phone||"",address:customer.address||""},
        line_items:lineItems.filter(li=>li.name&&(li.qty||0)>0).map(li=>({...li,quantity:li.qty})),
        discount,tax_percentage:taxPct,date:quoteDate,expiry_date:expiryStr,
        notes:notes||"Thank you for considering ST1 Sports. We look forward to equipping your program.",
        terms,send_email:sendEmail,email:customer.email||"",
      })});
      const d=await r.json();
      if(d.quote_id){
        const qLabel=d.estimate_number||d.quote_id;
        toast(`${sendEmail&&d.emailed?"Quote saved & emailed":"Quote saved to Zoho Books"} — ${qLabel}`,"success");
        setSavedQuote({...d,customer:customer.school||customer.name,total,qLabel});
        dispatch("LOG",{msg:`Quote ${qLabel} created for ${customer.school||customer.name} — ${fmt$(total)}`});
      } else {
        toast(d.error?`Zoho error: ${d.error}`:"Saved (Zoho Books not fully connected)","info");
        setSavedQuote({quote_id:"local",customer:customer.school||customer.name,total,qLabel:"Local"});
      }
    }catch(e){toast(`Save failed: ${e.message}`,"error");}
    setSaving(false);
  };

  const resetBuilder=()=>{
    setCustomer({name:"",email:"",school:"",phone:"",address:""});
    setLineItems([{id:mkId(),name:"",description:"",qty:1,rate:0}]);
    setDiscount(0);setTaxPct(0);setNotes("");setSavedQuote(null);setShowPicker(false);
  };

  const STATUS_C={draft:B.muted,sent:B.blue,accepted:B.green,declined:B.red,expired:B.orange,invoiced:B.teal};

  return(
    <div style={{padding:"22px 26px",height:"calc(100vh - 46px)",overflowY:"auto"}}>
      <PH title="QUOTE BUILDER" sub="Build quotes from Zoho inventory, send to customers, track in Zoho Books"
        action={<div style={{display:"flex",gap:6}}>
          {[["build","BUILD QUOTE"],["list","PAST QUOTES"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{background:tab===t?B.orange:B.white,color:tab===t?B.white:B.muted,border:`1px solid ${tab===t?B.orange:B.border}`,borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
          ))}
        </div>}/>

      {tab==="build"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16,marginTop:4}}>

          {/* ── Left: builder ── */}
          <div>
            {/* Customer */}
            <div className="card" style={{padding:16,marginBottom:12}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2,marginBottom:12}}>CUSTOMER</div>
              <div style={{position:"relative",marginBottom:10}}>
                <input value={contactQ||customer.name} onChange={e=>{setContactQ(e.target.value);if(!e.target.value)setCustomer(c=>({...c,name:""}));}} placeholder="Search contacts or type customer name..." style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 11px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                {contactMatches.length>0&&(
                  <div style={{position:"absolute",top:"100%",left:0,right:0,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.12)",zIndex:20,maxHeight:180,overflowY:"auto"}}>
                    {contactMatches.map(c=>(
                      <div key={c.id} onClick={()=>fillContact(c)} style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:11}}>
                        <div style={{color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`}</div>
                        <div style={{color:B.muted,fontSize:10}}>{typeof c.title==="string"?c.title:c.title?.name||""} — {typeof c.school==="string"?c.school:c.school?.name||""} · {c.email||"no email"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["School / Org","school"],["Email","email"],["Phone","phone"],["Shipping Address","address"]].map(([l,k])=>(
                  <div key={k}>
                    <Lbl s={{marginBottom:3}}>{l}</Lbl>
                    <input value={customer[k]} onChange={e=>setCustomer(c=>({...c,[k]:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"6px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                ))}
              </div>
            </div>

            {/* Line items */}
            <div className="card" style={{padding:16,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2}}>LINE ITEMS {zohoItems.length>0&&<span style={{color:B.green,marginLeft:4}}>· {zohoItems.length} from Zoho</span>}</div>
                <OBtn sm onClick={()=>setShowPicker(p=>!p)}>+ ADD ITEM</OBtn>
              </div>

              {showPicker&&(
                <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:10,marginBottom:12}}>
                  <input autoFocus value={pickerQ} onChange={e=>setPickerQ(e.target.value)} placeholder="Search products..." style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,marginBottom:8,fontFamily:"'Lexend',sans-serif"}}/>
                  <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
                    {filteredProducts.map((p,i)=>(
                      <div key={i} onClick={()=>addLine(p)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",borderRadius:4,cursor:"pointer",background:B.white,border:`1px solid ${B.border}`}}>
                        <div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{p.name}{p.sku?<span style={{color:B.muted,fontWeight:400}}> — {p.sku}</span>:null}</div>
                          {p.description&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{p.description}</div>}
                          {p.stock!=null&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:p.stock>0?B.green:B.red,marginTop:2}}>STOCK: {p.stock}</div>}
                        </div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:11,color:B.green,flexShrink:0,marginLeft:10}}>{fmt$(p.rate)}</div>
                      </div>
                    ))}
                    <div onClick={()=>addLine()} style={{padding:"7px 10px",borderRadius:4,cursor:"pointer",background:B.white,border:`1px dashed ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center"}}>+ Custom line item</div>
                  </div>
                </div>
              )}

              {/* Table header */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 56px 100px 80px 24px",gap:6,marginBottom:5,paddingBottom:5,borderBottom:`1px solid ${B.border}`}}>
                {["ITEM / DESCRIPTION","QTY","UNIT PRICE","TOTAL",""].map(h=>(
                  <div key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.8}}>{h}</div>
                ))}
              </div>

              {lineItems.map(li=>(
                <div key={li.id} style={{display:"grid",gridTemplateColumns:"1fr 56px 100px 80px 24px",gap:6,marginBottom:8,alignItems:"start"}}>
                  <div>
                    <input value={li.name} onChange={e=>updLine(li.id,"name",e.target.value)} placeholder="Item name" style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",marginBottom:3}}/>
                    <input value={li.description} onChange={e=>updLine(li.id,"description",e.target.value)} placeholder="Description" style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 8px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                  <input type="number" min="1" value={li.qty} onChange={e=>updLine(li.id,"qty",parseFloat(e.target.value)||1)} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 6px",fontSize:11,fontFamily:"'Lexend',sans-serif",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                  <input type="number" min="0" step="0.01" value={li.rate} onChange={e=>updLine(li.id,"rate",parseFloat(e.target.value)||0)} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",width:"100%",boxSizing:"border-box"}}/>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",paddingTop:6}}>{fmt$((li.qty||0)*(li.rate||0))}</div>
                  <button onClick={()=>removeLine(li.id)} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1,paddingTop:4}}>×</button>
                </div>
              ))}
            </div>

            {/* Terms + Notes */}
            <div className="card" style={{padding:16}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <Lbl s={{marginBottom:5}}>TERMS</Lbl>
                  <textarea value={terms} onChange={e=>setTerms(e.target.value)} rows={4} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                </div>
                <div>
                  <Lbl s={{marginBottom:5}}>NOTES TO CUSTOMER</Lbl>
                  <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={4} placeholder="e.g. Volume discount applied, delivery timeline, etc." style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: summary + actions ── */}
          <div>
            <div className="card" style={{padding:16,marginBottom:12,position:"sticky",top:0}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2,marginBottom:14}}>SUMMARY</div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                <div>
                  <Lbl s={{marginBottom:3}}>QUOTE DATE</Lbl>
                  <input type="date" value={quoteDate} onChange={e=>setQuoteDate(e.target.value)} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11}}/>
                </div>
                <div>
                  <Lbl s={{marginBottom:3}}>VALID (DAYS)</Lbl>
                  <input type="number" min="1" value={validDays} onChange={e=>setValidDays(parseInt(e.target.value)||30)} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11}}/>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                <div>
                  <Lbl s={{marginBottom:3}}>DISCOUNT %</Lbl>
                  <input type="number" min="0" max="100" step="0.5" value={discount} onChange={e=>setDiscount(parseFloat(e.target.value)||0)} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11}}/>
                </div>
                <div>
                  <Lbl s={{marginBottom:3}}>TAX %</Lbl>
                  <input type="number" min="0" max="30" step="0.1" value={taxPct} onChange={e=>setTaxPct(parseFloat(e.target.value)||0)} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11}}/>
                </div>
              </div>

              <div style={{borderTop:`1px solid ${B.border}`,paddingTop:12,display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Subtotal</span>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{fmt$(subtotal)}</span>
                </div>
                {discount>0&&<div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>Discount ({discount}%)</span>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>−{fmt$(discountAmt)}</span>
                </div>}
                {taxPct>0&&<div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Tax ({taxPct}%)</span>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{fmt$(taxAmt)}</span>
                </div>}
                <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${B.border}`,paddingTop:8,marginTop:4}}>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>TOTAL</span>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.orange}}>{fmt$(total)}</span>
                </div>
              </div>

              {savedQuote?(
                <div style={{background:B.greenBg,border:`1px solid ${B.green}40`,borderRadius:6,padding:12,marginBottom:10,textAlign:"center"}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green,letterSpacing:1}}>✓ QUOTE SAVED</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginTop:4}}>{savedQuote.customer} · {fmt$(savedQuote.total)}</div>
                  {savedQuote.qLabel&&savedQuote.qLabel!=="Local"&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>{savedQuote.qLabel}</div>}
                  <div style={{display:"flex",gap:7,justifyContent:"center",marginTop:10}}>
                    <button onClick={resetBuilder} style={{background:"none",border:`1px solid ${B.green}50`,color:B.green,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>+ NEW QUOTE</button>
                    <button onClick={()=>setTab("list")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>VIEW ALL →</button>
                  </div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  <OBtn onClick={()=>saveQuote(false)} disabled={saving}>{saving?"SAVING...":"💾 SAVE TO ZOHO BOOKS"}</OBtn>
                  <button onClick={()=>saveQuote(true)} disabled={saving} style={{background:B.green,color:B.white,border:"none",borderRadius:5,padding:"9px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer",opacity:saving?.6:1}}>✉ SAVE & EMAIL TO CUSTOMER</button>
                  <button onClick={resetBuilder} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:5,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>CLEAR</button>
                </div>
              )}
              {!customer.email&&customer.name&&!savedQuote&&(
                <div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center"}}>Add customer email to enable email delivery</div>
              )}
            </div>

            <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:12}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:5}}>INVENTORY STATUS</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.7}}>
                {zohoItems.length>0
                  ?<span style={{color:B.green}}>✓ {zohoItems.length} items loaded from Zoho Books</span>
                  :"Showing ST1 standard products. Connect Zoho Books to load live inventory, SKUs, and current pricing."}
              </div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:6,lineHeight:1.5}}>{ST1_PRODUCTS.length} standard products available</div>
            </div>
          </div>
        </div>
      )}

      {tab==="list"&&(
        <div style={{marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Quotes synced from Zoho Books Estimates</div>
            <OBtn sm onClick={()=>{setPastQuotes([]);setQuotesLoading(false);}}>REFRESH</OBtn>
          </div>
          {quotesLoading&&<div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}><Spin/> Loading from Zoho Books...</div>}
          {!quotesLoading&&pastQuotes.length===0&&(
            <div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
              No quotes found in Zoho Books.<br/>
              <button onClick={()=>setTab("build")} style={{marginTop:12,background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"8px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>BUILD FIRST QUOTE →</button>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {pastQuotes.map((q,i)=>(
              <div key={i} className="card" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500}}>{q.customer_name}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{q.estimate_number} · {q.date}{q.expiry_date?` → expires ${q.expiry_date}`:""}</div>
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.orange}}>{fmt$(q.total||0)}</span>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:STATUS_C[q.status]||B.muted,background:`${STATUS_C[q.status]||B.muted}18`,padding:"2px 8px",borderRadius:10,letterSpacing:.5}}>{(q.status||"draft").toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
      <PH title="RFP / BID TRACKER" sub="Manage bids from receipt to award"
        action={<a href="/rfp" style={{background:B.orange,color:B.white,borderRadius:4,padding:"7px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,textDecoration:"none",display:"inline-block"}}>+ NEW RFP →</a>}/>
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
                  {r.dueDate&&!["No Bid","Lost","Won"].includes(r.stage)&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:d<=3?B.red:d<=7?B.yellow:B.muted,letterSpacing:.3}}>{d<0?`${Math.abs(d)}d OVER`:`${d}d LEFT`}</div>}
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
//  INVOICING — data live from Zoho Books
// ════════════════════════════════════════════════════════════════════════════
function ModInvoicing() {
  const {s,dispatch,toast}=useApp();
  const [flt,setFlt]=useState("all");
  const [sel,setSel]=useState(null);
  const [drafts,setDrafts]=useState({});
  const [drafting,setDrafting]=useState(null);
  const [syncing,setSyncing]=useState(false);

  const pool=s.invoices||[];
  const STAT_MAP={draft:"draft",sent:"sent",overdue:"overdue",paid:"paid",void:"void",partially_paid:"partial",viewed:"viewed"};

  const syncFromZoho=async()=>{
    setSyncing(true);
    try {
      // Pull all recent invoices — Zoho Books handles status (overdue, paid, etc.)
      const res=await zohoCall("books","/invoices?per_page=200&sort_column=date&sort_order=D");
      const raw=res.invoices||[];
      if(!raw.length&&res.message) throw new Error(res.message);
      const mapped=raw.map(zi=>({
        id:"zoho_"+zi.invoice_id,
        zohoId:zi.invoice_id,
        number:zi.invoice_number||zi.invoice_number_formatted||"",
        customer:zi.customer_name,
        customerId:zi.customer_id,
        status:STAT_MAP[zi.status]||zi.status,
        date:zi.date,
        dueDate:zi.due_date,
        total:zi.total||0,
        balance:zi.balance||0,
        items:(zi.line_items||[]).map(li=>({
          name:li.name||li.item_name||"",qty:li.quantity,rate:li.rate,total:li.item_total,
        })),
        source:"zoho",
      }));
      dispatch("SET_INVOICES",{invoices:mapped,lastSync:Date.now()});
      dispatch("LOG",{msg:`Zoho Books sync — ${mapped.length} invoices loaded`});
      toast(`${mapped.length} invoices synced from Zoho Books`,"success");
    } catch(e){
      toast(`Sync failed: ${e.message.slice(0,100)}`,"error");
    }
    setSyncing(false);
  };

  const list=pool.filter(i=>{
    if(flt==="all") return true;
    if(flt==="overdue") return i.status==="overdue";
    if(flt==="unpaid") return ["sent","viewed","partial"].includes(i.status);
    if(flt==="draft") return i.status==="draft";
    if(flt==="paid") return i.status==="paid";
    return true;
  }).sort((a,b)=>{
    const o={overdue:0,partial:1,viewed:2,sent:3,draft:4,paid:5,void:6};
    return (o[a.status]??5)-(o[b.status]??5);
  });

  const ar=pool.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);
  const overdueTot=pool.filter(i=>i.status==="overdue").reduce((a,i)=>a+(i.balance||0),0);
  const paidTot=pool.filter(i=>i.status==="paid").reduce((a,i)=>a+(i.total||0),0);

  const draftRem=async(inv,type)=>{
    const k=inv.id+type; setDrafting(k);
    const dOD=inv.dueDate?dAgo(inv.dueDate):0;
    const t=await aiCall(`Write a${type==="gentle"?" friendly":type==="firm"?" firm":" final"} invoice reminder from Matt Stone at ST1 Sports.
Invoice ${inv.number} for ${fmt$(inv.balance)} to ${inv.customer}${type!=="gentle"?`, ${dOD} days overdue`:""}.
Under 70 words. Sign: Matt Stone | ST1 Sports | matt@st1sports.com`);
    setDrafts(d=>({...d,[k]:t||""})); setDrafting(null);
  };

  const lastSync=s.invoiceLastSync
    ? new Date(s.invoiceLastSync).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})
    : null;

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="INVOICES & AR" sub="Live from Zoho Books — all balances and statuses are authoritative from Zoho"
        action={
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            {lastSync&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Synced {lastSync}</span>}
            <OBtn onClick={syncFromZoho} disabled={syncing} style={{minWidth:160}}>{syncing?"SYNCING...":"↓ SYNC ZOHO BOOKS"}</OBtn>
          </div>
        }
      />

      {pool.length===0?(
        <div style={{textAlign:"center",padding:"70px 0"}}>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.muted,marginBottom:8}}>No invoices synced yet</div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:20}}>Connect Zoho Books and click Sync to pull your invoices</div>
          <OBtn onClick={syncFromZoho} disabled={syncing}>{syncing?"SYNCING...":"↓ SYNC ZOHO BOOKS"}</OBtn>
        </div>
      ):(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:16}}>
            <KCard l="Accounts Receivable" v={fmt$(ar)} c={B.orange}/>
            <KCard l="Overdue" v={fmt$(overdueTot)} c={B.red}/>
            <KCard l="Paid (this pull)" v={fmt$(paidTot)} c={B.green}/>
          </div>
          <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
            {[["all","All"],["overdue","Overdue"],["unpaid","Unpaid"],["draft","Draft"],["paid","Paid"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFlt(v)} style={{background:flt===v?B.orange:B.white,color:flt===v?B.white:B.muted,border:`1px solid ${flt===v?B.orange:B.border}`,borderRadius:4,padding:"4px 9px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{l}</button>
            ))}
          </div>
          {list.map(inv=>{
            const st=ISC[inv.status]||{c:B.muted,bg:B.surface};
            const isOD=inv.status==="overdue";
            const dOD=isOD&&inv.dueDate?dAgo(inv.dueDate):0;
            const ex=sel===inv.id;
            return(
              <div key={inv.id} className="card fu" style={{marginBottom:8,borderLeft:`3px solid ${st.c}`,padding:0,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:11,padding:"9px 12px",cursor:"pointer",background:ex?B.surface:B.white}} onClick={()=>setSel(ex?null:inv.id)}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{inv.customer}</span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:st.c,background:st.bg,padding:"2px 6px",borderRadius:3,letterSpacing:.4}}>{(inv.status||"").toUpperCase()}{isOD&&dOD>0?` · ${dOD}d`:""}</span>
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.number} · Due {fmtD(inv.dueDate)}</div>
                  </div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange,flexShrink:0}}>{fmt$(inv.balance||inv.total)}</div>
                </div>
                {ex&&(
                  <div style={{borderTop:`1px solid ${B.border}`,padding:"11px 12px",background:B.surface}}>
                    {(inv.items||[]).length>0&&(
                      <div style={{background:B.white,borderRadius:5,border:`1px solid ${B.border}`,marginBottom:9,overflow:"hidden"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                          <tbody>{inv.items.map((it,i)=>(
                            <tr key={i} style={{borderBottom:`1px solid ${B.border}`,background:i%2?B.surface:B.white}}>
                              <td style={{padding:"5px 9px",fontWeight:500}}>{it.name}</td>
                              <td style={{padding:"5px 9px",textAlign:"right",color:B.muted}}>{it.qty}</td>
                              <td style={{padding:"5px 9px",textAlign:"right",color:B.muted}}>{fmt$(it.rate)}</td>
                              <td style={{padding:"5px 9px",textAlign:"right",fontWeight:500}}>{fmt$(it.total)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:drafts[inv.id+"gentle"]||drafts[inv.id+"firm"]||drafts[inv.id+"final"]?9:0}}>
                      {(isOD||["sent","viewed"].includes(inv.status))&&(
                        <OBtn sm onClick={()=>draftRem(inv,"gentle")} disabled={!!drafting}>{drafting===inv.id+"gentle"?"...":"✦ DRAFT REMINDER"}</OBtn>
                      )}
                      {isOD&&dOD>21&&(
                        <OBtn sm col={B.red} onClick={()=>draftRem(inv,dOD>35?"final":"firm")} disabled={!!drafting}>{dOD>35?"FINAL NOTICE":"2ND NOTICE"}</OBtn>
                      )}
                    </div>
                    {["gentle","firm","final"].map(type=>{
                      const k=inv.id+type; if(!drafts[k]) return null;
                      const lc={gentle:B.orange,firm:B.yellow,final:B.red};
                      return(
                        <div key={type} style={{background:B.white,borderRadius:4,padding:9,border:`1px solid ${B.border}`,marginBottom:6}}>
                          <Lbl c={lc[type]} s={{marginBottom:6}}>{type==="gentle"?"REMINDER":type==="firm"?"2ND NOTICE":"FINAL NOTICE"}</Lbl>
                          <textarea value={drafts[k]} onChange={e=>setDrafts(d=>({...d,[k]:e.target.value}))} rows={5} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
                          <GBtn onClick={()=>navigator.clipboard?.writeText(drafts[k])} style={{fontSize:10,padding:"3px 8px",marginTop:6}}>COPY</GBtn>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  REORDER — populated from Zoho Books paid invoices
// ════════════════════════════════════════════════════════════════════════════
function ModReorder() {
  const {s,dispatch,toast}=useApp();
  const [drafts,setDrafts]=useState({});
  const [drafting,setDrafting]=useState(null);
  const [pulling,setPulling]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({school:"",contact:"",state:"",sport:"Track & Field",lastOrderDate:"",lastItems:"",lastOrderValue:""});

  const active=(s.reorders||[]).filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date()));

  const draftReo=async(r)=>{
    setDrafting(r.id);
    const t=await aiCall(`Write a short seasonal reorder email from Matt Stone at ST1 Sports (matt@st1sports.com, 719-256-0275, st1sports.com).
School: ${r.school} | Contact: ${r.contact}${r.state?", "+r.state:""} | Sport: ${r.sport}
Last order: ${fmtD(r.lastOrderDate)} — ${(r.lastItems||[]).join(", ")||"previous order"} — ${fmt$(r.lastOrderValue)}
Under 80 words. Reference exact last order. Ask if they need to restock. Warm tone.`);
    setDrafts(d=>({...d,[r.id]:t||""})); setDrafting(null);
  };

  // Pull paid invoices from Zoho Books → build reorder queue
  // Window: last ordered 45–365 days ago, skip if already queued
  const pullFromZoho=async()=>{
    setPulling(true);
    try {
      const res=await zohoCall("books","/invoices?filter_by=Status.Paid&per_page=200&sort_column=date&sort_order=D");
      const invoices=res.invoices||[];
      if(!invoices.length&&res.message) throw new Error(res.message);

      // Keep only most recent paid invoice per customer
      const byCustomer={};
      for(const inv of invoices){
        const key=inv.customer_id||inv.customer_name;
        if(!byCustomer[key]||new Date(inv.date)>new Date(byCustomer[key].date))
          byCustomer[key]=inv;
      }

      const existingIds=new Set((s.reorders||[]).map(r=>r.zohoInvoiceId).filter(Boolean));
      const now=Date.now();
      let added=0;

      for(const inv of Object.values(byCustomer)){
        if(existingIds.has(inv.invoice_id)) continue;
        const daysSince=Math.floor((now-new Date(inv.date).getTime())/86400000);
        if(daysSince<45||daysSince>365) continue; // outside reorder window

        dispatch("ADD_REORDER",{
          id:"reorder_"+inv.invoice_id,
          zohoInvoiceId:inv.invoice_id,
          school:inv.customer_name,
          contact:(inv.contact_persons||[])[0]?.contact_person_name||inv.customer_name,
          state:"",
          sport:inferSport(inv.line_items||[]),
          lastOrderDate:inv.date,
          lastItems:(inv.line_items||[]).slice(0,3).map(li=>li.name||li.item_name||"").filter(Boolean),
          lastOrderValue:inv.total||0,
          status:"pending",
          source:"zoho",
        });
        added++;
      }

      dispatch("LOG",{msg:`Reorder sync from Zoho Books — ${added} new accounts queued`});
      toast(added>0?`${added} accounts added to reorder queue`:`No new accounts in reorder window (45–365 days since last order)`,"success");
    } catch(e){
      toast(`Zoho sync failed: ${e.message.slice(0,100)}`,"error");
    }
    setPulling(false);
  };

  const addManual=()=>{
    if(!form.school.trim()) return toast("School name required","error");
    dispatch("ADD_REORDER",{
      id:mkId(),
      school:form.school,
      contact:form.contact,
      state:form.state,
      sport:form.sport,
      lastOrderDate:form.lastOrderDate,
      lastItems:form.lastItems.split(",").map(x=>x.trim()).filter(Boolean),
      lastOrderValue:parseFloat(form.lastOrderValue)||0,
      status:"pending",
      source:"manual",
    });
    setForm({school:"",contact:"",state:"",sport:"Track & Field",lastOrderDate:"",lastItems:"",lastOrderValue:""});
    setShowAdd(false);
    toast("Added to reorder queue","success");
  };

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="REORDER ENGINE" sub={active.length>0?`${active.length} account${active.length!==1?"s":""} ready for seasonal outreach`:"All accounts up to date"}
        action={
          <div style={{display:"flex",gap:7}}>
            <GBtn onClick={()=>setShowAdd(v=>!v)} style={{fontSize:10,padding:"4px 10px"}}>{showAdd?"CANCEL":"+ ADD MANUALLY"}</GBtn>
            <OBtn onClick={pullFromZoho} disabled={pulling}>{pulling?"SYNCING...":"↓ SYNC ZOHO BOOKS"}</OBtn>
          </div>
        }
      />

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:18}}>
        <KCard l="In Queue" v={active.length} c={B.orange}/>
        <KCard l="Sent" v={(s.reorders||[]).filter(r=>r.status==="sent").length} c={B.green}/>
        <KCard l="Snoozed" v={(s.reorders||[]).filter(r=>r.snoozedUntil&&new Date(r.snoozedUntil)>new Date()).length} c={B.muted}/>
      </div>

      {/* Manual add form */}
      {showAdd&&(
        <div className="card" style={{padding:14,marginBottom:16}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:12}}>ADD MANUALLY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:9}}>
            {[["School / Org *","school"],["Contact Name","contact"],["State","state"]].map(([l,k])=>(
              <div key={k}>
                <Lbl s={{marginBottom:3}}>{l}</Lbl>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:9,marginBottom:12}}>
            <div>
              <Lbl s={{marginBottom:3}}>Sport</Lbl>
              <select value={form.sport} onChange={e=>setForm(f=>({...f,sport:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                {SPORTS_LIST.map(sp=><option key={sp}>{sp}</option>)}
              </select>
            </div>
            <div>
              <Lbl s={{marginBottom:3}}>Last Order Date</Lbl>
              <input type="date" value={form.lastOrderDate} onChange={e=>setForm(f=>({...f,lastOrderDate:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
            </div>
            <div>
              <Lbl s={{marginBottom:3}}>Items (comma-sep)</Lbl>
              <input value={form.lastItems} onChange={e=>setForm(f=>({...f,lastItems:e.target.value}))} placeholder="Blazer blocks, Gill discus..." style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
            </div>
            <div>
              <Lbl s={{marginBottom:3}}>Order Value</Lbl>
              <input type="number" value={form.lastOrderValue} onChange={e=>setForm(f=>({...f,lastOrderValue:e.target.value}))} placeholder="0" style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
            </div>
          </div>
          <OBtn onClick={addManual}>ADD TO QUEUE</OBtn>
        </div>
      )}

      {active.length===0&&!showAdd&&(
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.border,marginBottom:6}}>ALL CLEAR</div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Sync Zoho Books to populate from paid invoices (45–365 days old), or add accounts manually</div>
        </div>
      )}

      {active.map(r=>(
        <div key={r.id} className="card fu" style={{padding:"11px 13px",marginBottom:10,borderLeft:`3px solid ${B.orange}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
            <div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500,marginBottom:2}}>{r.school}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[r.contact,r.state,r.sport].filter(Boolean).join(" · ")}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>
                Last order: {fmtD(r.lastOrderDate)} · {(r.lastItems||[]).slice(0,2).join(", ")||"—"} · {fmt$(r.lastOrderValue)}
              </div>
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
  const {s,dispatch,toast,setMod,crmSyncRef}=useApp();
  const [crmSyncing, setCrmSyncing] = useState(false);
  const forceCrmSync = async () => {
    if (!crmSyncRef?.current) { toast("Sync not ready","error"); return; }
    setCrmSyncing(true);
    await crmSyncRef.current(true);
    setCrmSyncing(false);
  };
  const DEFAULT_AREA={id:mkId(),name:"Midwest Track & Field ADs",regions:["Midwest"],states:["IA","MN","WI","MO","IL","IN","ND"],sports:["Track & Field"],orgType:"schools",roles:["Athletic Director","Head Track Coach"],maxOrgs:15,active:true};
  const [view,setView]=useState("areas");
  const [areas,setAreas]=useState((s.prospectAreas||[]).length>0?s.prospectAreas:[DEFAULT_AREA]);
  const [editing,setEditing]=useState(null);

  // Sync areas to store whenever they change
  useEffect(()=>{ dispatch("SET_PROSPECT_AREAS",areas); },[JSON.stringify(areas)]);
  const [activeArea,setActiveArea]=useState(null);
  const abortRef=useRef(false);
  const importFileRef=useRef();
  const apolloFileRef=useRef();

  // Load persisted task state on mount
  const savedTask = bgTasks.getTask(SCRAPE_TASK_ID);
  const [phase,setPhase]     = useState(savedTask?.status==="running"?"scraping":savedTask?.status==="done"?"done":"idle");
  const [progress,setProgress] = useState(savedTask?.progress||0);
  const [schools,setSchools] = useState(savedTask?.orgs||[]);
  const [contacts,setContacts] = useState(savedTask?.contacts||[]);
  const [log,setLog]         = useState(savedTask?.log||[]);

  const [zohoPushing, setZohoPushing] = useState(false);
  const [zohoPushed,  setZohoPushed]  = useState(0);
  const [zohoPulling, setZohoPulling] = useState(false);
  const [zohoPullResult, setZohoPullResult] = useState(null);

  // Import-list state
  const [importPhase,setImportPhase] = useState("idle"); // idle|parsing|preview
  const [importRows,setImportRows]   = useState([]);
  const [importSel,setImportSel]     = useState(new Set());
  const [enrollingContact,setEnrollingContact] = useState(null);
  const [flaggingContact,setFlaggingContact] = useState(null);
  const [dbFilter,setDbFilter] = useState("all"); // "all"|"leads"|"customers"|"dead"|"scraped"
  const [bulkSel,setBulkSel] = useState(new Set()); // selected contact IDs
  const [bulkEnrolling,setBulkEnrolling] = useState(false);

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
    const regionLabel = (area.regions||[]).length ? area.regions.join(" & ")+" region" : "";
    const stateList   = area.states||[];
    const scopeDesc   = regionLabel
      ? `the ${regionLabel}${stateList.length ? ` (${stateList.join(", ")})` : ""}`
      : stateList.length ? `the states of ${stateList.join(", ")}` : "the United States";
    const maxOrgs  = area.maxOrgs||area.maxSchools||15;

    bgTasks.createTask(SCRAPE_TASK_ID, `Prospecting: ${area.name}`);
    bgTasks.updateTask(SCRAPE_TASK_ID, { type:"scrape", progress:5, orgs:[], contacts:[] });

    let orgs = [];
    let allContacts = [];

    try {
      if(!isClubs) {
        addLog("Searching for schools...");
        const res = await aiCall(
          `Search for real high schools and school districts with strong ${area.sports.join(" / ")} programs in ${scopeDesc}. Spread across different states in the region. Target competitive programs known for state/regional athletics, larger districts (500+ enrollment). Search "[state] high school [sport] state champions", "[state] NFHS member schools", and official district websites. Return JSON array (max ${isBoth?Math.ceil(maxOrgs/2):maxOrgs} — mix of states): [{"name":"","district":"","city":"","state":"","website":"","orgType":"school"}]`,
          {search:true,json:true,tokens:1600}
        );
        orgs = [...orgs,...(Array.isArray(res)?res:[]).map(o=>({...o,orgType:"school"}))];
        addLog(`Found ${orgs.length} schools`,"success");
      }

      if(isClubs||isBoth) {
        addLog("Searching for youth sports clubs...");
        const res = await aiCall(
          `Search for real youth sports clubs, travel teams, and leagues for ${area.sports.join(" / ")} in ${scopeDesc}. Include AAU programs, club travel teams, recreational leagues with equipment purchasing budgets. Spread across different states. Return JSON array (max ${isBoth?Math.ceil(maxOrgs/2):maxOrgs}): [{"name":"","city":"","state":"","website":"","orgType":"club"}]`,
          {search:true,json:true,tokens:1600}
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
          `Find real ${roles.join(", ")} contacts at ${sc.name} in ${sc.city}, ${sc.state}${sc.website?" — website: "+sc.website:""}. ${isClubOrg?"Search their club/league website staff page.":"Search their school athletics staff directory page and district website — look for /athletics/staff or /directory."} Search: "${sc.name} ${roles[0]} email contact". Email format is usually firstname.lastname@district.org or first@schoolname.edu. Return JSON array (ONLY verified real contacts — return empty array [] if you cannot confirm the person exists): [{"firstName":"","lastName":"","fullName":"","title":"","school":"${sc.name}","orgType":"${sc.orgType||"school"}","city":"${sc.city}","state":"${sc.state}","email":"","phone":"","source":"website|directory|search","confidence":"high|medium|low"}]`,
          {search:true,json:true,tokens:1600}
        );
        if(Array.isArray(found)&&found.length>0){
          const valid=found.filter(c=>c.fullName||c.firstName).map(c=>({...c,id:mkId(),source:"scraped"}));
          allContacts=[...allContacts,...valid];
          setContacts(prev=>[...prev,...valid]);
          bgTasks.appendContacts(SCRAPE_TASK_ID, valid);
          setSchools(ss=>ss.map(x=>x.id===sc.id?{...x,status:"done",count:valid.length}:x));
          addLog(`  ✓ ${valid.length} found`,"success");
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

  const pushToZohoLeads = async (contactList) => {
    if(!contactList.length){ toast("No contacts to push","warn"); return; }
    setZohoPushing(true); setZohoPushed(0);
    addLog(`Pushing ${contactList.length} contacts to Zoho CRM Leads...`);
    let pushed=0;
    for(let i=0;i<contactList.length;i+=10){
      const batch=contactList.slice(i,i+10);
      try {
        await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({service:"crm",endpoint:"/Leads",method:"POST",body:{data:
            batch.map(c=>({
              First_Name: c.firstName||(c.fullName||"").split(" ")[0]||"",
              Last_Name:  c.lastName ||(c.fullName||"").split(" ").slice(1).join(" ")||c.fullName||"Unknown",
              Email:      c.email||"",
              Phone:      c.phone||"",
              Title:      c.title||"",
              Company:    c.school||"",
              City:       c.city||"",
              State:      c.state||"",
              Lead_Source:"ST1 RevOps Prospecting",
              Lead_Status:"Not Contacted",
              Description:`Sport: ${c.sport||""}. Source: ${c.source||"prospecting"}. Confidence: ${c.confidence||"medium"}.`,
            }))
          }})
        });
        pushed+=batch.length;
        setZohoPushed(pushed);
      } catch(e) {
        addLog(`Zoho batch error: ${e.message.slice(0,60)}`,"warn");
      }
      await new Promise(r=>setTimeout(r,400));
    }
    addLog(`✓ ${pushed}/${contactList.length} contacts pushed to Zoho CRM Leads`,"success");
    toast(`${pushed} leads added to Zoho CRM`,"success");
    setZohoPushing(false);
  };

  // Fetch ALL records from a Zoho CRM module using COQL (bypasses 2000-record page limit)
  const zohoFetchAll = async (module, fields, onProgress) => {
    let all = []; let offset = 0;
    const fList = fields.join(",");
    while(true) {
      const res = await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({service:"crm",endpoint:"/coql",method:"POST",
          body:{select_query:`SELECT ${fList} FROM ${module} LIMIT 200 OFFSET ${offset}`}
        })}).then(r=>r.json());
      const batch = res.data||[];
      all = [...all,...batch];
      if(onProgress) onProgress(all.length);
      if(!res.info?.more_records || batch.length<200) break;
      offset += 200;
    }
    return all;
  };

  const pullFromZoho = async () => {
    setZohoPulling(true); setZohoPullResult(null);
    toast("Pulling from Zoho CRM — fetching all records...","info");
    try {
      // Fetch contacts and leads with full pagination
      setZohoPullResult({contacts:0,leads:0,added:0,updated:0,loading:true});
      const [contactRows, leadRows] = await Promise.all([
        zohoFetchAll("Contacts",
          ["First_Name","Last_Name","Email","Phone","Title","Account_Name","Mailing_City","Mailing_State","Lead_Source","Last_Activity_Time","Modified_Time"],
          n=>setZohoPullResult(r=>({...r,contacts:n}))),
        zohoFetchAll("Leads",
          ["First_Name","Last_Name","Email","Phone","Title","Company","City","State","Lead_Source","Lead_Status","Rating","No_of_Calls","No_of_Chats","Last_Activity_Time","Modified_Time","Created_Time","Description","Converted"],
          n=>setZohoPullResult(r=>({...r,leads:n}))),
      ]);
      const now = Date.now();
      const zs = v => typeof v==="string"?v:v?.name||v?.display_value||"";
      const scoreLeadFromZoho = (l) => {
        let score=0; const acts=[];
        const STATUS_PTS={"Contacted":{pts:15,type:"sent"},"Follow Up":{pts:25,type:"clicked"},"Qualified":{pts:45,type:"opened"},"Proposal Sent":{pts:35,type:"sent"},"Negotiation":{pts:60,type:"replied"},"Customer":{pts:100,type:"replied"}};
        const st=zs(l.Lead_Status); const sp=STATUS_PTS[st];
        if(sp?.pts){score+=sp.pts;acts.push({id:mkId(),type:sp.type,ts:now,note:`Zoho status: ${st}`,campaignId:"zoho"});}
        const calls=Number(l.No_of_Calls)||0;
        if(calls>0){score+=calls*15;acts.push({id:mkId(),type:"meeting",ts:now,note:`${calls} call${calls>1?"s":""} in Zoho`,campaignId:"zoho"});}
        const chats=Number(l.No_of_Chats)||0;
        if(chats>0){score+=chats*10;acts.push({id:mkId(),type:"clicked",ts:now,note:`${chats} chat${chats>1?"s":""} in Zoho`,campaignId:"zoho"});}
        if(l.Last_Activity_Time){
          const daysAgo=Math.round((now-new Date(l.Last_Activity_Time).getTime())/86400000);
          const recency=daysAgo<7?20:daysAgo<30?10:daysAgo<90?5:0;
          score+=recency;
          acts.push({id:mkId(),type:"sent",ts:new Date(l.Last_Activity_Time).getTime(),note:`Last activity ${daysAgo}d ago`,campaignId:"zoho"});
        }
        const src=zs(l.Lead_Source);
        if(["Web Site","Website","Chat","External Referral","Word of mouth","Internal Seminar","Public Relations"].includes(src))score+=10;
        const rating=zs(l.Rating);
        const priority=rating==="Hot"?"high":rating==="Warm"?"medium":"low";
        return {score:Math.min(200,score),activity:acts,priority};
      };
      toast(`Found ${contactRows.length} contacts + ${leadRows.length} leads — importing...`,"info");
      const contacts = contactRows.map(c=>({
        id:"zoho_c_"+c.id,
        firstName:zs(c.First_Name), lastName:zs(c.Last_Name),
        fullName:`${zs(c.First_Name)} ${zs(c.Last_Name)}`.trim(),
        email:zs(c.Email), phone:zs(c.Phone),
        title:zs(c.Title), school:zs(c.Account_Name),
        city:zs(c.Mailing_City), state:zs(c.Mailing_State),
        orgType:"school", source:"zoho-crm",
        zohoSource:zs(c.Lead_Source),
        confidence:"high", outreachStatus:"new", importedAt:now,
      }));
      const leads = leadRows.map(l=>{
        const {score,activity,priority}=scoreLeadFromZoho(l);
        return {
          id:"zoho_l_"+l.id,
          firstName:zs(l.First_Name), lastName:zs(l.Last_Name),
          fullName:`${zs(l.First_Name)} ${zs(l.Last_Name)}`.trim(),
          email:zs(l.Email), phone:zs(l.Phone),
          title:zs(l.Title), school:zs(l.Company),
          city:zs(l.City), state:zs(l.State),
          orgType:"school", source:"zoho-crm-lead",
          zohoStatus:zs(l.Lead_Status), zohoSource:zs(l.Lead_Source),
          zohoRating:zs(l.Rating), zohoId:l.id,
          confidence:"medium", priority,
          outreachStatus:l.Lead_Status==="Customer"?"replied":l.Lead_Status==="Contacted"?"contacted":"new",
          score, activity, importedAt:now,
        };
      });
      const all=[...contacts,...leads];
      const existing=new Set((s.contacts||[]).map(c=>c.id));
      const toAdd=all.filter(c=>!existing.has(c.id));
      // Update existing leads with fresh Zoho data
      const toUpdate=all.filter(c=>existing.has(c.id)&&c.source==="zoho-crm-lead");
      if(toAdd.length) dispatch("ADD_CONTACTS",toAdd);
      toUpdate.forEach(c=>dispatch("UPDATE_CONTACT",{id:c.id,zohoStatus:c.zohoStatus,zohoSource:c.zohoSource,zohoRating:c.zohoRating,outreachStatus:c.outreachStatus}));
      dispatch("SET_CONTACTS_LAST_SYNC",now);
      setZohoPullResult({contacts:contacts.length, leads:leads.length, added:toAdd.length, updated:toUpdate.length});
      toast(`${toAdd.length} new · ${toUpdate.length} updated from Zoho CRM`,"success");
    } catch(e) {
      toast(`Zoho pull failed: ${e.message.slice(0,80)}`,"error");
    }
    setZohoPulling(false);
  };

  const [rescoring,setRescoring]=useState(false);
  const rescoreFromZoho = async() => {
    setRescoring(true);
    toast("Rescoring leads from Zoho activity...","info");
    try {
      const leadRows=await zohoFetchAll("Leads",["First_Name","Last_Name","Lead_Status","Rating","No_of_Calls","No_of_Chats","Last_Activity_Time","Lead_Source"]);
      toast(`Rescoring ${leadRows.length} leads...`,"info");
      const now=Date.now();
      const zs=v=>typeof v==="string"?v:v?.name||v?.display_value||"";
      let updated=0;
      leadRows.forEach(l=>{
        const id="zoho_l_"+l.id;
        const existing=(s.contacts||[]).find(c=>c.id===id);
        if(!existing) return;
        let score=0; const acts=[];
        const STATUS_PTS={"Contacted":{pts:15,type:"sent"},"Follow Up":{pts:25,type:"clicked"},"Qualified":{pts:45,type:"opened"},"Proposal Sent":{pts:35,type:"sent"},"Negotiation":{pts:60,type:"replied"},"Customer":{pts:100,type:"replied"}};
        const st=zs(l.Lead_Status); const sp=STATUS_PTS[st];
        if(sp?.pts){score+=sp.pts;acts.push({id:mkId(),type:sp.type,ts:now,note:`Zoho status: ${st}`,campaignId:"zoho"});}
        const calls=Number(l.No_of_Calls)||0;
        if(calls>0){score+=calls*15;acts.push({id:mkId(),type:"meeting",ts:now,note:`${calls} call${calls>1?"s":""} in Zoho`,campaignId:"zoho"});}
        const chats=Number(l.No_of_Chats)||0;
        if(chats>0){score+=chats*10;acts.push({id:mkId(),type:"clicked",ts:now,note:`${chats} chat${chats>1?"s":""} in Zoho`,campaignId:"zoho"});}
        if(l.Last_Activity_Time){
          const daysAgo=Math.round((now-new Date(l.Last_Activity_Time).getTime())/86400000);
          const recency=daysAgo<7?20:daysAgo<30?10:daysAgo<90?5:0;
          score+=recency;
          acts.push({id:mkId(),type:"sent",ts:new Date(l.Last_Activity_Time).getTime(),note:`Last activity ${daysAgo}d ago`,campaignId:"zoho"});
        }
        const src=zs(l.Lead_Source);
        if(["Web Site","Website","Chat","External Referral","Word of mouth","Internal Seminar","Public Relations"].includes(src))score+=10;
        const rating=zs(l.Rating);
        const priority=rating==="Hot"?"high":rating==="Warm"?"medium":"low";
        const manualActs=(existing.activity||[]).filter(a=>a.campaignId!=="zoho");
        const manualScore=(existing.score||0)-((existing.activity||[]).filter(a=>a.campaignId==="zoho").length*10);
        dispatch("UPDATE_CONTACT",{id,score:Math.min(200,Math.max(0,manualScore)+score),activity:[...acts,...manualActs].slice(0,50),priority,zohoStatus:st,zohoRating:rating,outreachStatus:st==="Customer"?"replied":st==="Contacted"?"contacted":"new"});
        updated++;
      });
      toast(`Rescored ${updated} leads from Zoho activity`,"success");
    } catch(e){
      toast(`Rescore failed: ${e.message.slice(0,80)}`,"error");
    }
    setRescoring(false);
  };

  const exportCsv=()=>{
    const h=["firstName","lastName","fullName","title","orgName","orgType","city","state","email","phone","source","confidence"];
    const r=contacts.map(c=>[c.firstName||"",c.lastName||"",c.fullName||"",c.title||"",c.school||"",c.orgType||"school",c.city||"",c.state||"",c.email||"",c.phone||"",c.source||"",c.confidence||""].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","));
    const csv=[h.join(","),...r].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`ST1_Contacts_${today()}.csv`;a.click();
  };

  const handleListUpload=async(e)=>{
    const file=e.target.files[0];
    if(!file)return;
    e.target.value="";
    setImportPhase("parsing");setImportRows([]);
    try {
      const buf=await toBuffer(file);
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const csvText=XLSX.utils.sheet_to_csv(ws);
      const lines=csvText.split("\n").filter(l=>l.trim()).slice(0,201);
      if(lines.length<2){toast("File appears empty","error");setImportPhase("idle");return;}
      const result=await aiCall(
        `CRM export (Zoho or similar). Map and normalize contacts.\n\nCSV:\n${lines.join("\n")}\n\n`+
        `For each data row extract: firstName, lastName, fullName, email, phone, title (job role/position), school (org/company name), city, state (2-letter), `+
        `orgType (school|club|district|company), sport (Track & Field|Baseball/Softball|Volleyball|Football|Basketball|Cross Country|Wrestling|General — infer from title if possible), `+
        `priority (high=AD or Director or Administrator, medium=coach or coordinator, low=other), `+
        `tags (array: include "multi-sport" if multiple sports implied, "club-director" if club org director, etc.), `+
        `outreachWindow (best 2-month window to reach out for purchasing decisions based on their sport — e.g. "Nov–Jan" for T&F). `+
        `Return JSON array only: [{"firstName":"","lastName":"","fullName":"","email":"","phone":"","title":"","school":"","city":"","state":"","orgType":"school","sport":"","priority":"medium","tags":[],"outreachWindow":"","source":"list-import"}]. `+
        `Skip blank rows and header rows. Use empty string for unknown fields.`,
        {json:true,tokens:4000}
      );
      if(Array.isArray(result)&&result.length>0){
        const mapped=result.filter(c=>c.fullName||c.firstName||c.email).map(c=>({
          ...c,
          id:mkId(),
          confidence:"medium",
          outreachStatus:"new",
          importedAt:Date.now(),
        }));
        setImportRows(mapped);
        setImportSel(new Set(mapped.map(c=>c.id)));
        setImportPhase("preview");
        toast(`${mapped.length} contacts mapped — review below`,"success");
      } else {
        toast("Could not extract contacts from this file","error");
        setImportPhase("idle");
      }
    } catch(err) {
      toast(`Import error: ${err.message}`,"error");
      setImportPhase("idle");
    }
  };

  const handleApolloUpload=async(e)=>{
    const file=e.target.files[0];
    if(!file)return;
    e.target.value="";
    setImportPhase("parsing");setImportRows([]);
    try {
      const buf=await toBuffer(file);
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const csvText=XLSX.utils.sheet_to_csv(ws);
      const lines=csvText.split("\n").filter(l=>l.trim()).slice(0,201);
      if(lines.length<2){toast("File appears empty","error");setImportPhase("idle");return;}
      const result=await aiCall(
        `Apollo.io export CSV. Map Apollo columns to contact records.\n\nCSV:\n${lines.join("\n")}\n\n`+
        `Apollo column mapping: "First Name"→firstName, "Last Name"→lastName, "Title"→title, "Company"→school, `+
        `"Email"→email, "LinkedIn URL"→linkedIn, "City"→city, "State"→state, "# Employees"→(ignore for now). `+
        `For each row also infer: fullName (First+Last), `+
        `orgType (school|club|district|company — use "company" if not clearly educational), `+
        `sport (Track & Field|Baseball/Softball|Volleyball|Football|Basketball|Cross Country|Wrestling|General — infer from title/company), `+
        `priority (high=AD or Director or Administrator, medium=coach or coordinator, low=other), `+
        `tags (array of relevant tags), outreachWindow (best 2-month window for purchasing decisions based on sport). `+
        `Return JSON array only: [{"firstName":"","lastName":"","fullName":"","email":"","phone":"","title":"","school":"","city":"","state":"","orgType":"company","sport":"","priority":"medium","tags":[],"outreachWindow":"","linkedIn":"","source":"apollo"}]. `+
        `Skip blank rows and header rows. Use empty string for unknown fields.`,
        {json:true,tokens:4000}
      );
      if(Array.isArray(result)&&result.length>0){
        const mapped=result.filter(c=>c.fullName||c.firstName||c.email).map(c=>({
          ...c,
          id:mkId(),
          source:"apollo",
          confidence:"high",
          outreachStatus:"new",
          importedAt:Date.now(),
        }));
        setImportRows(mapped);
        setImportSel(new Set(mapped.map(c=>c.id)));
        setImportPhase("preview");
        toast(`${mapped.length} Apollo contacts mapped — review below`,"success");
      } else {
        toast("Could not extract contacts from Apollo file","error");
        setImportPhase("idle");
      }
    } catch(err) {
      toast(`Apollo import error: ${err.message}`,"error");
      setImportPhase("idle");
    }
  };

  const commitListImport=async(pushZoho=false)=>{
    const selected=importRows.filter(c=>importSel.has(c.id));
    const existingEmails=new Set((s.contacts||[]).map(c=>c.email?.toLowerCase()).filter(Boolean));
    const toAdd=selected.filter(c=>!c.email||!existingEmails.has(c.email.toLowerCase()));
    const dupes=selected.length-toAdd.length;
    dispatch("ADD_CONTACTS",toAdd);
    toast(`Imported ${toAdd.length} contacts${dupes>0?` · ${dupes} dupes skipped`:""}${pushZoho?" · pushing to Zoho…":""}  `,"success");
    setImportPhase("idle");setImportRows([]);setImportSel(new Set());
    if(pushZoho&&toAdd.length>0){
      await pushToZohoLeads(toAdd);
    }
  };

  const logC={success:B.green,warn:B.yellow,error:B.red,info:B.muted,muted:B.muted};
  const statDot={done:B.green,scraping:B.orange,empty:B.muted,pending:B.border};

  const PVIEWS=[["areas","FOCUS AREAS"],["results",`RESULTS (${contacts.length})`],["import",`CONTACT DB (${(s.contacts||[]).length})`]];

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="PROSPECTING ENGINE" sub="Scrape contacts, import lists, manage your contact database"
        action={<div style={{display:"flex",gap:6}}>{PVIEWS.map(([v,l])=><button key={v} onClick={()=>setView(v)} style={{background:view===v?B.orange:B.white,color:view===v?B.white:B.muted,border:`1px solid ${view===v?B.orange:B.border}`,borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{l}</button>)}</div>}/>

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
                    <div style={{marginBottom:10}}>
                      <Lbl s={{marginBottom:5}}>REGION (NATIONWIDE)</Lbl>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:5}}>
                        {Object.entries(US_REGIONS).map(([r,{states:rs,color}])=>{
                          const sel=(area.regions||[]).includes(r);
                          return(
                            <button key={r} onClick={()=>setAreas(as=>as.map(a=>{
                              if(a.id!==area.id)return a;
                              const cur=a.regions||[];
                              const newRegions=sel?cur.filter(x=>x!==r):[...cur,r];
                              const newStates=[...new Set(newRegions.flatMap(rn=>US_REGIONS[rn]?.states||[]))];
                              return{...a,regions:newRegions,states:newStates};
                            }))} style={{background:sel?`${color}18`:B.white,color:sel?color:B.muted,border:`1px solid ${sel?color:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",fontWeight:sel?500:400}}>
                              {r} <span style={{fontSize:9,opacity:.7}}>({rs.length})</span>
                            </button>
                          );
                        })}
                      </div>
                      {(area.regions||[]).length>0&&(
                        <div style={{fontSize:9,color:B.muted,lineHeight:1.6,padding:"3px 6px",background:B.surface,borderRadius:3}}>
                          States included: {(area.states||[]).join(", ")||"none"}
                        </div>
                      )}
                    </div>
                    <div style={{marginBottom:10}}>
                      <Lbl s={{marginBottom:5}}>SPORTS</Lbl>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {SPORTS_LIST.map(o=><button key={o} onClick={()=>setAreas(as=>as.map(a=>a.id===area.id?{...a,sports:tog(a.sports||[],o)}:a))} style={{background:(area.sports||[]).includes(o)?`${B.orange}15`:B.white,color:(area.sports||[]).includes(o)?B.orange:B.muted,border:`1px solid ${(area.sports||[]).includes(o)?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{o}</button>)}
                      </div>
                    </div>
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
                      {(area.regions||[]).map(r=>{const rs=typeof r==="string"?r:r?.name||String(r);const c=US_REGIONS[rs]?.color||B.orange;return<span key={rs} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:c,background:c+"18",padding:"2px 7px",borderRadius:3}}>{rs}</span>;})}
                      {!(area.regions||[]).length&&(area.states||[]).map(st=>{const s2=typeof st==="string"?st:st?.name||String(st);return<span key={s2} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,background:B.orangeBg,padding:"2px 6px",borderRadius:3}}>{s2}</span>;})}
                      {(area.sports||[]).map(sp=>{const s2=typeof sp==="string"?sp:sp?.name||String(sp);return<span key={s2} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{s2}</span>;})}
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>
                      {area.orgType==="clubs"?"Youth Clubs":area.orgType==="both"?"Schools + Clubs":"Schools"} · {(area.roles||[]).map(r=>typeof r==="string"?r:r?.name||String(r)).join(", ")||"default roles"} · max {area.maxOrgs||area.maxSchools||10} orgs
                    </div>
                    <OBtn onClick={()=>runScrape(area)} style={{width:"100%"}} sm>⊕ SCRAPE THIS AREA</OBtn>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view==="import"&&(
        <div>
          {/* Source row: Zoho pull + CSV upload + Apollo */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
            {/* Zoho pull card */}
            <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:14,borderLeft:`3px solid ${B.purple}`}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,letterSpacing:2,marginBottom:8}}>PULL FROM ZOHO CRM</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:10,lineHeight:1.5}}>
                Pulls Contacts and Leads from Zoho CRM. Leads are auto-scored from their Zoho activity: call count, chat count, lead status, last activity date, and lead source.
              </div>
              {zohoPullResult&&(
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:zohoPullResult.loading?B.orange:B.green,marginBottom:8}}>
                  {zohoPullResult.loading
                    ? `⟳ Fetching… ${zohoPullResult.contacts||0} contacts · ${zohoPullResult.leads||0} leads so far`
                    : `✓ ${zohoPullResult.contacts} contacts · ${zohoPullResult.leads} leads · ${zohoPullResult.added} new · ${zohoPullResult.updated||0} updated`
                  }
                </div>
              )}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <OBtn sm color={B.purple} onClick={pullFromZoho} disabled={zohoPulling||rescoring}>
                  {zohoPulling?"PULLING...":"↓ PULL ZOHO CONTACTS + LEADS"}
                </OBtn>
                <OBtn sm color={B.blue} onClick={rescoreFromZoho} disabled={rescoring||zohoPulling}>
                  {rescoring?"RESCORING...":"↺ RESCORE FROM ZOHO ACTIVITY"}
                </OBtn>
              </div>
            </div>
            {/* CSV upload card */}
            <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:14,borderLeft:`3px solid ${B.orange}`}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:8}}>UPLOAD A LIST</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:10,lineHeight:1.5}}>
                Upload a CSV or Excel export from Zoho, HubSpot, Salesforce, or any CRM. AI will normalize and categorize each contact automatically.
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleListUpload} style={{display:"none"}}/>
                <OBtn sm onClick={()=>importFileRef.current?.click()} disabled={importPhase==="parsing"}>
                  {importPhase==="parsing"?"⟳ ANALYZING...":"↑ UPLOAD CSV / EXCEL"}
                </OBtn>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{(s.contacts||[]).length} in database</span>
              </div>
            </div>
            {/* Apollo.io import card */}
            <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:14,borderLeft:`3px solid ${B.teal}`}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.teal,letterSpacing:2,marginBottom:8}}>APOLLO.IO IMPORT</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:10,lineHeight:1.5}}>
                Upload an Apollo.io CSV export. AI maps: First Name, Last Name, Title, Company, Email, LinkedIn URL, City, State into your contact database.
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input ref={apolloFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleApolloUpload} style={{display:"none"}}/>
                <OBtn sm color={B.teal} onClick={()=>apolloFileRef.current?.click()} disabled={importPhase==="parsing"}>
                  {importPhase==="parsing"?"⟳ ANALYZING...":"↑ UPLOAD APOLLO CSV"}
                </OBtn>
              </div>
            </div>
          </div>

          {/* Preview table */}
          {importPhase==="preview"&&importRows.length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{importRows.length} contacts ready · {importSel.size} selected</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button onClick={()=>setImportSel(importSel.size===importRows.length?new Set():new Set(importRows.map(c=>c.id)))} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",color:B.muted}}>{importSel.size===importRows.length?"DESELECT ALL":"SELECT ALL"}</button>
                  <OBtn sm onClick={()=>commitListImport(false)} disabled={importSel.size===0}>⊕ IMPORT {importSel.size}</OBtn>
                  <OBtn sm onClick={()=>commitListImport(true)} disabled={importSel.size===0||zohoPushing} style={{background:B.blue,borderColor:B.blue}}>⊕ IMPORT + PUSH TO ZOHO</OBtn>
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
                  <thead>
                    <tr style={{borderBottom:`2px solid ${B.border}`}}>
                      {["","Name","Title / Org","Email","Sport","Outreach Window","Priority","Tags"].map(h=>(
                        <th key={h} style={{padding:"7px 10px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((c,i)=>(
                      <tr key={c.id} style={{borderBottom:`1px solid ${B.border}`,background:importSel.has(c.id)?`${B.orange}06`:B.white}}>
                        <td style={{padding:"6px 10px"}}>
                          <input type="checkbox" checked={importSel.has(c.id)} onChange={()=>setImportSel(s=>{const n=new Set(s);n.has(c.id)?n.delete(c.id):n.add(c.id);return n;})}/>
                        </td>
                        <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                          <div style={{color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"—"}</div>
                          <div style={{color:B.muted,fontSize:10}}>{c.city&&c.state?`${c.city}, ${c.state}`:c.state||""}</div>
                        </td>
                        <td style={{padding:"6px 10px"}}>
                          <div style={{color:B.text}}>{(typeof c.title==="string"?c.title:c.title?.name||"")||"—"}</div>
                          <div style={{color:B.muted,fontSize:10}}>{typeof c.school==="string"?c.school:c.school?.name||""}</div>
                        </td>
                        <td style={{padding:"6px 10px",color:c.email?B.green:B.muted}}>{c.email||"—"}</td>
                        <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                          {c.sport&&c.sport!=="Unknown"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{typeof c.sport==="string"?c.sport:c.sport?.name||""}</span>}
                        </td>
                        <td style={{padding:"6px 10px",color:B.orange,fontWeight:500,fontSize:10,whiteSpace:"nowrap"}}>{c.outreachWindow||SPORT_WINDOWS[c.sport]||"—"}</td>
                        <td style={{padding:"6px 10px"}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:{high:B.green,medium:B.blue,low:B.muted}[c.priority]||B.muted,background:{high:B.greenBg,medium:B.blueBg,low:B.surface}[c.priority]||B.surface,padding:"2px 6px",borderRadius:3}}>{(c.priority||"med").toUpperCase()}</span>
                        </td>
                        <td style={{padding:"6px 10px"}}>
                          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                            {(c.tags||[]).map((t,ti)=>{const ts=typeof t==="string"?t:t?.name||String(t);return<span key={ti} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,background:B.orangeBg,padding:"1px 5px",borderRadius:2}}>{ts}</span>;})}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contact database */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>CONTACT DATABASE ({(s.contacts||[]).length})</div>
                {bulkSel.size>0&&(
                  <div style={{display:"flex",gap:5,alignItems:"center"}}>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5}}>{bulkSel.size} SELECTED</span>
                    <div style={{position:"relative"}}>
                      <button onClick={()=>setBulkEnrolling(v=>!v)} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"3px 9px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>+ BULK ENROLL ▾</button>
                      {bulkEnrolling&&(
                        <div style={{position:"absolute",left:0,top:"100%",zIndex:30,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.12)",minWidth:180,padding:6}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>ENROLL IN CAMPAIGN</div>
                          {(s.sequences||[]).map(seq=>(
                            <button key={seq.id} onClick={()=>{
                              const today=new Date().toISOString().slice(0,10);
                              let enrolled=0;
                              const updated={...seq,enrollments:[...(seq.enrollments||[])]};
                              bulkSel.forEach(cid=>{
                                if(!updated.enrollments.some(e=>e.contactId===cid)){
                                  updated.enrollments.push({contactId:cid,step:0,status:"active",enrolledAt:today,nextDate:today});
                                  dispatch("SCORE_CONTACT",{contactId:cid,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`});
                                  enrolled++;
                                }
                              });
                              dispatch("UPDATE_SEQUENCE",updated);
                              setBulkEnrolling(false);setBulkSel(new Set());
                              toast(`${enrolled} contacts enrolled in ${seq.name}`,"success");
                            }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,cursor:"pointer",borderRadius:3}}>{seq.name}</button>
                          ))}
                          {(s.sequences||[]).length===0&&<div style={{padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No campaigns yet</div>}
                          <button onClick={()=>setBulkEnrolling(false)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
                        </div>
                      )}
                    </div>
                    <button onClick={()=>setBulkSel(new Set())} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>✕ clear</button>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                <button onClick={forceCrmSync} disabled={crmSyncing}
                  style={{background:crmSyncing?B.surface:B.orangeBg,color:crmSyncing?B.muted:B.orange,border:`1px solid ${crmSyncing?B.border:B.orange}40`,borderRadius:3,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer",marginRight:6}}>
                  {crmSyncing?"SYNCING…":"⟳ SYNC ZOHO CRM"}
                </button>
                {[["all","ALL"],["leads","LEADS"],["customers","CUSTOMERS"],["scraped","◈ SCRAPED"],["dead","⊘ DEAD"]].map(([v,l])=>(
                  <button key={v} onClick={()=>{
                    setDbFilter(v);
                    if(v==="scraped"){
                      // Auto-select all scraped contacts so bulk enroll is one more click
                      const scrapedIds=new Set((s.contacts||[]).filter(c=>!c.deadStatus&&(c.source==="scraped"||["website","directory","search"].includes(c.source))).map(c=>c.id));
                      setBulkSel(scrapedIds);
                    } else {
                      setBulkSel(new Set());
                    }
                  }} style={{background:dbFilter===v?(v==="dead"?B.red:v==="scraped"?B.purple:B.blue):B.white,color:dbFilter===v?B.white:v==="dead"?B.red:v==="scraped"?B.purple:B.muted,border:`1px solid ${dbFilter===v?(v==="dead"?B.red:v==="scraped"?B.purple:B.blue):v==="dead"?`${B.red}40`:v==="scraped"?`${B.purple}40`:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
            </div>
            {(s.contacts||[]).length===0&&importPhase==="idle"&&(
              <div className="card" style={{padding:30,textAlign:"center"}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted,marginBottom:8}}>No contacts yet</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:16}}>Sync from Zoho CRM, upload a CSV/Excel export, or run a scrape from your Focus Areas</div>
                <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                  <button onClick={forceCrmSync} disabled={crmSyncing}
                    style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"8px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",letterSpacing:.5}}>
                    {crmSyncing?"SYNCING…":"⟳ SYNC FROM ZOHO CRM"}
                  </button>
                  <OBtn sm onClick={()=>importFileRef.current?.click()}>↑ UPLOAD CONTACT LIST</OBtn>
                </div>
              </div>
            )}
            {(s.contacts||[]).length>0&&(
              <div>
                {/* Summary stats */}
                {(()=>{
                  const ct=s.contacts||[];
                  const stats=[[ct.length,"Total"],[ct.filter(c=>c.email).length,"With Email"],[ct.filter(c=>c.priority==="high").length,"High Priority"],[[...new Set(ct.map(c=>c.sport).filter(Boolean))].length,"Sports"]];
                  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:14}}>
                    {stats.map(([v,l])=>(
                      <div key={l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 10px",textAlign:"center"}}>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.orange}}>{v}</div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginTop:2}}>{l}</div>
                      </div>
                    ))}
                  </div>;
                })()}
                {/* Hot leads leaderboard */}
                {(()=>{
                  const hot=[...(s.contacts||[])].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5);
                  if(!hot.length) return null;
                  return(
                    <div style={{marginBottom:14,background:B.orangeBg,border:`1px solid ${B.orange}30`,borderRadius:7,padding:12}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:8}}>🔥 HOT LEADS — TOP SCORED</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {hot.map((c,i)=>{const t=scoreTier(c.score);return(
                          <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:B.white,borderRadius:5,padding:"7px 10px",border:`1px solid ${B.border}`}}>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}>
                              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.muted,minWidth:16}}>#{i+1}</span>
                              <div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||c.firstName}</div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""}</div>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}>
                              {(c.activity||[]).slice(0,3).map((a,ai)=>(
                                <span key={ai} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{a.type==="replied"?"💬":a.type==="clicked"?"🖱":a.type==="opened"?"👁":a.type==="sent"?"📤":"📋"}</span>
                              ))}
                              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:t.color}}>{c.score||0}</span>
                              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:t.color,background:t.bg,padding:"2px 6px",borderRadius:3}}>{t.label}</span>
                            </div>
                          </div>
                        );})}
                      </div>
                    </div>
                  );
                })()}

                {/* Scraped leads action panel */}
                {dbFilter==="scraped"&&(()=>{
                  const allScraped=(s.contacts||[]).filter(c=>!c.deadStatus&&(c.source==="scraped"||["website","directory","search"].includes(c.source)));
                  const enrolled=new Set((s.sequences||[]).flatMap(seq=>(seq.enrollments||[]).map(e=>e.contactId)));
                  const unenrolled=allScraped.filter(c=>!enrolled.has(c.id));
                  if(allScraped.length===0) return null;
                  return(
                    <div style={{background:`${B.purple}10`,border:`1px solid ${B.purple}30`,borderRadius:7,padding:"12px 14px",marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:.5,marginBottom:3}}>◈ SCRAPED LEADS</div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
                            <strong>{allScraped.length}</strong> total · <strong style={{color:unenrolled.length?B.orange:B.green}}>{unenrolled.length}</strong> not yet in any campaign
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                          <button onClick={()=>{
                            const ids=new Set(unenrolled.map(c=>c.id));
                            setBulkSel(ids);
                          }} style={{background:B.white,color:B.purple,border:`1px solid ${B.purple}40`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>
                            ☐ SELECT UNENROLLED ({unenrolled.length})
                          </button>
                          <div style={{position:"relative"}}>
                            <button onClick={()=>setBulkEnrolling(v=>!v)} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>
                              ⊕ ENROLL ALL UNENROLLED ▾
                            </button>
                            {bulkEnrolling&&(
                              <div style={{position:"absolute",right:0,top:"100%",zIndex:30,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.14)",minWidth:200,padding:6}}>
                                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>ENROLL {unenrolled.length} UNENROLLED IN</div>
                                {(s.sequences||[]).map(seq=>(
                                  <button key={seq.id} onClick={()=>{
                                    const todayStr=new Date().toISOString().slice(0,10);
                                    let count=0;
                                    const updated={...seq,enrollments:[...(seq.enrollments||[])]};
                                    unenrolled.forEach(c=>{
                                      if(!updated.enrollments.some(e=>e.contactId===c.id)){
                                        updated.enrollments.push({contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr});
                                        dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`});
                                        count++;
                                      }
                                    });
                                    dispatch("UPDATE_SEQUENCE",updated);
                                    setBulkEnrolling(false);
                                    toast(`${count} scraped contacts enrolled in "${seq.name}"`,count>0?"success":"warn");
                                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"7px 10px",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,cursor:"pointer",borderRadius:3}}>
                                    <div style={{fontWeight:500}}>{seq.name}</div>
                                    <div style={{fontSize:9,color:B.muted,marginTop:1}}>{(seq.enrollments||[]).length} already enrolled</div>
                                  </button>
                                ))}
                                {(s.sequences||[]).length===0&&<div style={{padding:"8px 10px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No campaigns yet — create one in Email Sequences</div>}
                                <button onClick={()=>setBulkEnrolling(false)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontSize:10,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Contact list */}
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {[...(s.contacts||[])].sort((a,b)=>(b.score||0)-(a.score||0)).filter(c=>{
                    const isDead=!!c.deadStatus;
                    if(dbFilter==="dead") return isDead;
                    if(isDead) return false;
                    const isScraped=c.source==="scraped"||["website","directory","search"].includes(c.source);
                    if(dbFilter==="scraped") return isScraped;
                    const inv=findCustomerInvoice(c,s.invoices||[]);
                    if(dbFilter==="customers") return !!inv;
                    if(dbFilter==="leads") return !inv;
                    return true;
                  }).slice(0,100).map(c=>{
                    const tier=scoreTier(c.score);
                    const campaigns=s.sequences||[];
                    const custInvoice=findCustomerInvoice(c,s.invoices||[]);
                    return(
                    <div key={c.id} className="card fu" style={{padding:"9px 11px",borderLeft:`3px solid ${c.priority==="high"?B.orange:c.priority==="medium"?B.blue:B.border}`,background:bulkSel.has(c.id)?`${B.orange}06`:undefined}}>
                      <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                        <input type="checkbox" checked={bulkSel.has(c.id)} onChange={()=>setBulkSel(prev=>{const n=new Set(prev);n.has(c.id)?n.delete(c.id):n.add(c.id);return n;})} style={{marginTop:4,accentColor:B.orange,width:13,height:13,cursor:"pointer",flexShrink:0}}/>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flex:1}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"Unnamed"}</span>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:tier.color,background:tier.bg,padding:"2px 5px",borderRadius:3}}>{tier.label} {c.score||0}</span>
                            {c.sport&&(typeof c.sport==="string"?c.sport:c.sport?.name||"")!=="Unknown"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{typeof c.sport==="string"?c.sport:c.sport?.name||""}</span>}
                            {c.outreachStatus==="replied"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>REPLIED</span>}
                            {c.zohoStatus&&c.zohoStatus!=="new"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:`${B.purple}15`,padding:"2px 5px",borderRadius:3}}>{c.zohoStatus.toUpperCase()}</span>}
                            {c.zohoSource&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,background:B.surface,padding:"2px 5px",borderRadius:3}}>{c.zohoSource}</span>}
                            {custInvoice&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:"#1a7f37",background:"#d8f3dc",padding:"2px 5px",borderRadius:3}} title={`Invoice: ${custInvoice.number||custInvoice.id}`}>✓ CUSTOMER</span>}
                            {(c.source==="scraped"||["website","directory","search"].includes(c.source))&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:B.purpleBg,padding:"2px 5px",borderRadius:3}}>◈ SCRAPED</span>}
                            {c.source==="apollo"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.teal,background:B.tealBg,padding:"2px 5px",borderRadius:3}}>◎ APOLLO</span>}
                            {c.deadStatus&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.red,background:B.redBg,padding:"2px 5px",borderRadius:3}}>⊘ {c.deadStatus.replace(/_/g," ").toUpperCase()}</span>}
                            {c.emailBounced&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:B.yellowBg,padding:"2px 5px",borderRadius:3}}>✉✗ BOUNCED</span>}
                          </div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""} · {c.city&&c.state?`${c.city}, ${c.state}`:c.state||""}</div>
                          <div style={{display:"flex",gap:10,marginTop:2}}>
                            {c.email&&(c.emailBounced
                              ?<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,textDecoration:"line-through",opacity:.7}} title="Email bounced / bad address">✉✗ {c.email}</span>
                              :<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>✉ {c.email}</span>
                            )}
                            {c.phone&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue}}>☎ {c.phone}</span>}
                          </div>
                          {(c.activity||[]).length>0&&(
                            <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                              {(c.activity||[]).slice(0,4).map((a,i)=>(
                                <span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,background:B.surface,padding:"1px 6px",borderRadius:3}}>
                                  {a.type==="replied"?"💬 replied":a.type==="clicked"?"🖱 clicked":a.type==="opened"?"👁 opened":a.type==="sent"?"📤 sent":a.type==="enrolled"?"📋 enrolled":a.type}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                          {((typeof c.outreachWindow==="string"?c.outreachWindow:"")||SPORT_WINDOWS[typeof c.sport==="string"?c.sport:c.sport?.name||""])&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,fontWeight:500}}>{(typeof c.outreachWindow==="string"?c.outreachWindow:"")||SPORT_WINDOWS[typeof c.sport==="string"?c.sport:c.sport?.name||""]}</div>}
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:{high:B.green,medium:B.blue,low:B.muted}[c.priority]||B.muted,letterSpacing:.5,marginTop:2}}>{c.priority?.toUpperCase()||"MED"}</div>
                          <button onClick={()=>{
                            const school=typeof c.school==="string"?c.school:c.school?.name||"";
                            const title=typeof c.title==="string"?c.title:c.title?.name||"";
                            const sport=typeof c.sport==="string"?c.sport:c.sport?.name||"";
                            const draft=`Draft an outreach email for ${c.fullName||c.firstName}, ${title}${school?` at ${school}`:""}${c.state?`, ${c.state}`:""}${sport?`. Sport: ${sport}`:""}${c.outreachWindow?`. Best outreach window: ${c.outreachWindow}`:""}. Personalize it to build a relationship and introduce ST1 Sports.`;
                            dispatch("SET_AGENT_DRAFT",draft);
                            setMod("agent");
                          }} style={{marginTop:5,background:B.surface,color:B.blue,border:`1px solid ${B.border}`,borderRadius:3,padding:"3px 7px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",display:"block",width:"100%",textAlign:"center"}}>→ AGENT</button>
                          <div style={{marginTop:5,position:"relative"}}>
                            {flaggingContact===c.id?(
                              <div style={{position:"absolute",right:0,top:"100%",zIndex:20,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.12)",minWidth:160,padding:6}}>
                                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>FLAG AS</div>
                                {[["not_interested","Not Interested"],["wrong_contact","Wrong Contact"],["junk","Junk / Spam"]].map(([val,label])=>(
                                  <button key={val} onClick={()=>{
                                    dispatch("UPDATE_CONTACT",{id:c.id,deadStatus:val});
                                    setFlaggingContact(null);
                                    toast(`${c.fullName||c.firstName||c.lastName} flagged as ${label}`,"info");
                                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,cursor:"pointer",borderRadius:3}}>{label}</button>
                                ))}
                                {c.deadStatus&&(
                                  <button onClick={()=>{
                                    dispatch("UPDATE_CONTACT",{id:c.id,deadStatus:null});
                                    setFlaggingContact(null);
                                    toast(`${c.fullName||c.firstName||c.lastName} restored`,"success");
                                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,cursor:"pointer",borderRadius:3}}>↩ Restore</button>
                                )}
                                <div style={{borderTop:`1px solid ${B.border}`,margin:"4px 0"}}/>
                                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 3px"}}>EMAIL</div>
                                {!c.emailBounced?(
                                  <button onClick={()=>{
                                    dispatch("UPDATE_CONTACT",{id:c.id,emailBounced:true});
                                    setFlaggingContact(null);
                                    toast(`Email marked as bounced for ${c.fullName||c.firstName||c.lastName}`,"warn");
                                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,cursor:"pointer",borderRadius:3}}>✉✗ Bad Email / Bounced</button>
                                ):(
                                  <button onClick={()=>{
                                    dispatch("UPDATE_CONTACT",{id:c.id,emailBounced:false});
                                    setFlaggingContact(null);
                                    toast(`Email restored for ${c.fullName||c.firstName||c.lastName}`,"success");
                                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,cursor:"pointer",borderRadius:3}}>✉ Mark Email OK</button>
                                )}
                                <button onClick={()=>setFlaggingContact(null)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
                              </div>
                            ):(
                              <button onClick={()=>setFlaggingContact(c.id)} style={{background:"none",color:c.deadStatus?B.red:c.emailBounced?B.yellow:B.muted,border:`1px solid ${c.deadStatus?B.red+"40":c.emailBounced?B.yellow+"40":B.border}`,borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",width:"100%"}}>{c.deadStatus?"⊘ "+c.deadStatus.replace(/_/g," ").toUpperCase():c.emailBounced?"✉✗ BAD EMAIL":"⊘ FLAG DEAD"}</button>
                            )}
                          </div>
                          {campaigns.length>0&&(
                            <div style={{marginTop:6,position:"relative"}}>
                              {enrollingContact===c.id?(
                                <div style={{position:"absolute",right:0,top:"100%",zIndex:10,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.12)",minWidth:180,padding:6}}>
                                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>ENROLL IN CAMPAIGN</div>
                                  {campaigns.map(seq=>(
                                    <button key={seq.id} onClick={()=>{
                                      const today=new Date().toISOString().slice(0,10);
                                      const alreadyIn=(seq.enrollments||[]).some(e=>e.contactId===c.id);
                                      if(!alreadyIn){
                                        dispatch("UPDATE_SEQUENCE",{...seq,enrollments:[...seq.enrollments,{contactId:c.id,step:0,status:"active",enrolledAt:today,nextDate:today}]});
                                        dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`});
                                        toast(`${c.fullName||c.firstName} enrolled in ${seq.name}`,"success");
                                      } else {
                                        toast("Already enrolled in this campaign","warn");
                                      }
                                      setEnrollingContact(null);
                                    }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,cursor:"pointer",borderRadius:3}}>
                                      {seq.name}
                                    </button>
                                  ))}
                                  <button onClick={()=>setEnrollingContact(null)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
                                </div>
                              ):(
                                <button onClick={()=>setEnrollingContact(c.id)} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>+ ENROLL</button>
                              )}
                            </div>
                          )}
                        </div>
                        </div>
                      </div>
                    </div>
                  );})}
                  {(s.contacts||[]).length>100&&<div style={{textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>Showing 100 of {(s.contacts||[]).length} — export CSV to see all</div>}
                </div>
              </div>
            )}
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
                {contacts.length>0&&<OBtn sm color={B.purple} onClick={()=>pushToZohoLeads(contacts)} disabled={zohoPushing}>{zohoPushing?`PUSHING ${zohoPushed}/${contacts.length}...`:`↑ PUSH TO ZOHO (${contacts.length})`}</OBtn>}
              </div>
            </div>
            {contacts.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              {[[contacts.length,"Contacts",B.orange],[contacts.filter(c=>c.email).length,"With Email",B.green],[contacts.filter(c=>c.orgType==="club").length,"Clubs",B.blue]].map(([v,l,c])=>(
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
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""} · {c.city}, {c.state}</div>
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
//  EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════════════════════
const DEFAULT_TEMPLATES=[
  {id:"tpl_intro",name:"Cold Intro — Track & Field",tags:["cold","t&f"],subject:"ST1 Sports — Equipment for {{school}} T&F Program",body:`Hi {{name}},

I wanted to reach out about ST1 Sports — we specialize in competition-grade track & field equipment (hurdles, starting blocks, shot puts, throws equipment) sold directly to programs like yours.

We work with schools across the country and hear the same thing: overpriced, slow-shipping distributors. We ship fast, price fairly, and I personally handle every order.

Would it be worth a quick 10-minute call to see if we can help {{school}} this season?

Best,
Matt Stone
ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`},
  {id:"tpl_fu1",name:"Follow-Up 1 — After Quote",tags:["followup","quote"],subject:"Re: ST1 Sports Quote — {{school}}",body:`Hi {{name}},

Just following up on the quote I sent over. Did you get a chance to review it?

Happy to adjust quantities, add items, or answer any questions. We can also split the order across two POs if that's easier for your budget cycle.

Best,
Matt Stone
ST1 Sports | matt@st1sports.com | 719-256-0275`},
  {id:"tpl_fu2",name:"Follow-Up 2 — Final Check-in",tags:["followup"],subject:"Quick check-in — {{school}} equipment",body:`Hi {{name}},

I don't want to be a pest, so this will be my last follow-up for now. If the timing isn't right or you've gone a different direction, no worries at all — just let me know so I can close this out on my end.

If you're still interested, I can hold current pricing for one more week.

Best,
Matt Stone
ST1 Sports | 719-256-0275`},
  {id:"tpl_po",name:"PO Confirmation",tags:["order","confirmation"],subject:"ST1 Sports — Order Confirmation for {{school}}",body:`Hi {{name}},

Thank you for your order! Here's a summary:

{{items}}

Estimated ship date: {{ship_date}}
Tracking will be emailed once shipped.

Questions? Reply here or call me directly at 719-256-0275.

Matt Stone
ST1 Sports | matt@st1sports.com | st1sports.com`},
  {id:"tpl_winback",name:"Win-Back — Lapsed Customer",tags:["winback","cold"],subject:"It's been a while — new equipment for {{school}}?",body:`Hi {{name}},

It's Matt from ST1 Sports — it's been a while since we last worked together, and I wanted to check in.

We've added some new items this season, and I'd love to put together a quote for {{school}} if you're gearing up for a new season. No pressure — just want to make sure you know we're here when you need us.

Best,
Matt Stone
ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`},
];

function ModTemplates() {
  const {s,dispatch,toast}=useApp();
  const allTemplates=[...DEFAULT_TEMPLATES,...(s.templates||[])];
  const [sel,setSel]=useState(allTemplates[0]?.id||null);
  const [editing,setEditing]=useState(false);
  const [form,setForm]=useState({name:"",subject:"",body:"",tags:[]});
  const [tagInput,setTagInput]=useState("");

  const current=allTemplates.find(t=>t.id===sel);
  const isDefault=DEFAULT_TEMPLATES.some(t=>t.id===sel);

  const startNew=()=>{setForm({name:"",subject:"",body:"",tags:[]});setEditing(true);setSel(null);};
  const startEdit=()=>{if(!current||isDefault)return;setForm({name:current.name,subject:current.subject,body:current.body,tags:current.tags||[]});setEditing(true);};
  const cancelEdit=()=>{setEditing(false);if(allTemplates.length)setSel(allTemplates[0].id);};

  const saveTemplate=()=>{
    if(!form.name||!form.subject||!form.body){toast("Name, subject and body required","error");return;}
    if(sel&&!isDefault){
      dispatch("UPDATE_TEMPLATE",{id:sel,...form});toast("Template updated","success");
    } else {
      const t={id:mkId(),...form};dispatch("ADD_TEMPLATE",t);setSel(t.id);toast("Template saved","success");
    }
    setEditing(false);
  };

  const copyTemplate=(t)=>{
    navigator.clipboard.writeText(`Subject: ${t.subject}\n\n${t.body}`).catch(()=>{});
    toast("Template copied to clipboard","success");
  };

  return(
    <div style={{padding:"22px 26px",height:"calc(100vh - 46px)",overflowY:"hidden",display:"flex",flexDirection:"column"}}>
      <PH title="EMAIL TEMPLATES" sub="Reusable outreach templates — use in agent, batch outreach, or deals"
        action={<OBtn sm onClick={startNew}>+ NEW TEMPLATE</OBtn>}/>
      <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:14,flex:1,overflow:"hidden",marginTop:4}}>
        {/* List */}
        <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {allTemplates.map(t=>(
            <div key={t.id} onClick={()=>{setSel(t.id);setEditing(false);}} style={{padding:"9px 12px",borderRadius:6,cursor:"pointer",background:sel===t.id?B.orangeBg:B.white,border:`1px solid ${sel===t.id?B.orange:B.border}`,borderLeft:`3px solid ${sel===t.id?B.orange:B.border}`}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:sel===t.id?500:400,lineHeight:1.3}}>{t.name}</div>
              {t.tags?.length>0&&<div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:4}}>
                {t.tags.map(tag=><span key={tag} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:8,letterSpacing:.3}}>{tag}</span>)}
              </div>}
            </div>
          ))}
        </div>
        {/* Content */}
        <div style={{overflowY:"auto"}}>
          {editing?(
            <div className="card" style={{padding:16}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div><Lbl s={{marginBottom:4}}>TEMPLATE NAME</Lbl><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                <div><Lbl s={{marginBottom:4}}>TAGS (comma-separated)</Lbl>
                  <input value={tagInput||form.tags.join(", ")} onChange={e=>{setTagInput(e.target.value);setForm(f=>({...f,tags:e.target.value.split(",").map(t=>t.trim()).filter(Boolean)}));}} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                </div>
              </div>
              <div style={{marginBottom:10}}><Lbl s={{marginBottom:4}}>SUBJECT LINE</Lbl><input value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
              <div style={{marginBottom:12}}><Lbl s={{marginBottom:4}}>BODY <span style={{color:B.muted,fontWeight:400}}>— use {"{{name}}"}, {"{{school}}"}, {"{{items}}"} as placeholders</span></Lbl>
                <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={14} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.7}}/>
              </div>
              <div style={{display:"flex",gap:7}}>
                <OBtn onClick={saveTemplate}>SAVE TEMPLATE</OBtn>
                <GBtn onClick={cancelEdit}>CANCEL</GBtn>
              </div>
            </div>
          ):current?(
            <div>
              <div className="card" style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,marginBottom:4}}>{current.name}</div>
                    {current.tags?.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {current.tags.map(tag=><span key={tag} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:8,letterSpacing:.3}}>{tag}</span>)}
                    </div>}
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <button onClick={()=>copyTemplate(current)} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>📋 COPY</button>
                    {!isDefault&&<button onClick={startEdit} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>EDIT</button>}
                    {!isDefault&&<button onClick={()=>{dispatch("DEL_TEMPLATE",sel);setSel(allTemplates[0]?.id);}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}30`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>DEL</button>}
                  </div>
                </div>
                <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"8px 12px",marginBottom:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Subject: {current.subject}</div>
                <pre style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.7,margin:0,background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"12px 14px"}}>{current.body}</pre>
                {isDefault&&<div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Built-in template — create a custom copy to edit it.</div>}
              </div>
            </div>
          ):<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Select a template</div>}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  BATCH OUTREACH
// ════════════════════════════════════════════════════════════════════════════
function ModBatchOutreach() {
  const {s,dispatch,toast}=useApp();
  const contacts=s.contacts||[];
  const allTemplates=[...DEFAULT_TEMPLATES,...(s.templates||[])];

  const [sportFilter,setSportFilter]=useState("");
  const [stateFilter,setStateFilter]=useState("");
  const [scoreFilter,setScoreFilter]=useState(0);
  const [noEmailFilter,setNoEmailFilter]=useState(false);
  const [selContacts,setSelContacts]=useState(new Set());
  const [tplId,setTplId]=useState(allTemplates[0]?.id||"");
  const [drafts,setDrafts]=useState([]); // [{id, contact, subject, body, status}]
  const [writing,setWriting]=useState(false);
  const [sending,setSending]=useState(false);
  const [sentCount,setSentCount]=useState(0);

  const sports=[...new Set(contacts.map(c=>c.sport).filter(Boolean))].sort();
  const states=[...new Set(contacts.map(c=>c.state).filter(Boolean))].sort();

  const filtered=contacts.filter(c=>{
    if(!c.email)return false;
    if(noEmailFilter&&c.outreachStatus==="replied")return false;
    if(sportFilter&&c.sport!==sportFilter)return false;
    if(stateFilter&&c.state!==stateFilter)return false;
    if((c.score||0)<scoreFilter)return false;
    return true;
  });

  const togSel=(id)=>setSelContacts(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const selAll=()=>setSelContacts(new Set(filtered.map(c=>c.id)));
  const selNone=()=>setSelContacts(new Set());

  const selectedList=filtered.filter(c=>selContacts.has(c.id));

  const buildDrafts=async()=>{
    if(!selectedList.length){toast("Select contacts first","error");return;}
    const tpl=allTemplates.find(t=>t.id===tplId);
    if(!tpl){toast("Select a template","error");return;}
    setWriting(true);
    setDrafts([]);
    // For small batches, use template directly; for larger use AI personalization
    const useAI=selectedList.length<=20;
    if(useAI){
      const prompt=`You are writing personalized emails for ST1 Sports (athletic equipment) for ${selectedList.length} recipients.

Template:
Subject: ${tpl.subject}
Body: ${tpl.body}

Recipients:
${selectedList.map((c,i)=>`${i+1}. ${c.fullName||[c.firstName,c.lastName].filter(Boolean).join(" ")} | ${c.title||"coach"} | ${c.school||""} | ${c.state||""} | Sport: ${c.sport||"general"}`).join("\n")}

For each recipient personalize the subject and body by filling in {{name}}, {{school}}, and adding 1 specific sentence relevant to their sport/role.
Return JSON array: [{"index":1,"subject":"...","body":"..."}] with index matching the list above.`;
      const raw=await aiCall(prompt,{json:true,tokens:4000});
      if(Array.isArray(raw)){
        setDrafts(raw.map((r,i)=>{
          const c=selectedList[i];
          return{id:mkId(),contactId:c.id,contactName:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),toEmail:c.email,subject:r.subject||tpl.subject,body:r.body||tpl.body,status:"draft"};
        }));
      } else {
        // Fallback: template-fill for each
        setDrafts(selectedList.map(c=>{
          const name=c.fullName||c.firstName||"Coach";
          const school=c.school||"your school";
          return{id:mkId(),contactId:c.id,contactName:name,toEmail:c.email,subject:tpl.subject.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),body:tpl.body.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),status:"draft"};
        }));
      }
    } else {
      setDrafts(selectedList.map(c=>{
        const name=c.fullName||c.firstName||"Coach";
        const school=c.school||"your school";
        return{id:mkId(),contactId:c.id,contactName:name,toEmail:c.email,subject:tpl.subject.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),body:tpl.body.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),status:"draft"};
      }));
    }
    setWriting(false);toast(`${selectedList.length} drafts ready — review before sending`,"success");
  };

  const sendAll=async()=>{
    const toSend=drafts.filter(d=>d.status==="draft");
    if(!toSend.length){toast("No drafts to send","error");return;}
    setSending(true);setSentCount(0);
    let sent=0;
    for(const d of toSend){
      try{
        setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"sending"}:x));
        const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",to_email:d.toEmail,to_name:d.contactName,subject:d.subject,body:d.body})});
        const res=await r.json();
        if(res.sent){
          setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"sent"}:x));
          dispatch("UPDATE_CONTACT",{id:d.contactId,outreachStatus:"contacted",lastOutreach:today()});
          dispatch("LOG",{msg:`Batch email sent to ${d.contactName} <${d.toEmail}>`});
          sent++;setSentCount(sent);
        }else{
          setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"failed",error:res.error}:x));
        }
        await new Promise(r=>setTimeout(r,300)); // rate limit
      }catch(e){
        setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"failed",error:e.message}:x));
      }
    }
    setSending(false);toast(`${sent}/${toSend.length} emails sent`,"success");
  };

  const updDraft=(id,field,val)=>setDrafts(ds=>ds.map(d=>d.id===id?{...d,[field]:val}:d));

  return(
    <div style={{padding:"22px 26px",height:"calc(100vh - 46px)",overflowY:"auto"}}>
      <PH title="BATCH OUTREACH" sub="Filter contacts, AI-personalize emails, send to many at once via Gmail"/>

      {drafts.length===0?(
        <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
          {/* Filters + contact list */}
          <div>
            <div className="card" style={{padding:14,marginBottom:12}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2,marginBottom:10}}>FILTER CONTACTS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:10}}>
                <div><Lbl s={{marginBottom:3}}>SPORT</Lbl>
                  <select value={sportFilter} onChange={e=>setSportFilter(e.target.value)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                    <option value="">All sports</option>
                    {sports.map(sp=><option key={sp}>{sp}</option>)}
                  </select>
                </div>
                <div><Lbl s={{marginBottom:3}}>STATE</Lbl>
                  <select value={stateFilter} onChange={e=>setStateFilter(e.target.value)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                    <option value="">All states</option>
                    {states.map(st=><option key={st}>{st}</option>)}
                  </select>
                </div>
                <div><Lbl s={{marginBottom:3}}>MIN SCORE</Lbl>
                  <input type="number" min="0" max="200" value={scoreFilter} onChange={e=>setScoreFilter(Number(e.target.value)||0)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{filtered.length} contacts match · {selContacts.size} selected</div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={selAll} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>SELECT ALL</button>
                  <button onClick={selNone} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>CLEAR</button>
                </div>
              </div>
            </div>
            <div style={{maxHeight:360,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {filtered.slice(0,100).map(c=>(
                <div key={c.id} onClick={()=>togSel(c.id)} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 12px",borderRadius:6,cursor:"pointer",background:selContacts.has(c.id)?B.orangeBg:B.white,border:`1px solid ${selContacts.has(c.id)?B.orange:B.border}`}}>
                  <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${selContacts.has(c.id)?B.orange:B.border}`,background:selContacts.has(c.id)?B.orange:"none",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {selContacts.has(c.id)&&<span style={{color:B.white,fontSize:10,lineHeight:1}}>✓</span>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""} · {c.state}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.email}</div>
                    {(c.score||0)>0&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green}}>{c.score}pts</div>}
                  </div>
                </div>
              ))}
              {filtered.length===0&&<div style={{textAlign:"center",padding:"30px 0",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No contacts match. Adjust filters or import contacts first.</div>}
            </div>
          </div>

          {/* Template picker + action */}
          <div>
            <div className="card" style={{padding:14,marginBottom:12}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2,marginBottom:10}}>SELECT TEMPLATE</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {allTemplates.map(t=>(
                  <div key={t.id} onClick={()=>setTplId(t.id)} style={{padding:"8px 10px",borderRadius:5,cursor:"pointer",background:tplId===t.id?B.orangeBg:B.white,border:`1px solid ${tplId===t.id?B.orange:B.border}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:tplId===t.id?500:400}}>{t.name}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.subject}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:12}}>
                {selContacts.size} contacts selected · AI will personalize each email with their name and school.
              </div>
              <OBtn onClick={buildDrafts} disabled={writing||selContacts.size===0} style={{width:"100%",marginBottom:7}}>
                {writing?"✦ WRITING...":"✦ AI WRITE & PREVIEW DRAFTS"}
              </OBtn>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Review all emails before sending. Gmail must be connected.</div>
            </div>
          </div>
        </div>
      ):(
        /* Draft review table */
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
              {drafts.length} drafts · {drafts.filter(d=>d.status==="sent").length} sent · {drafts.filter(d=>d.status==="failed").length} failed
              {sending&&<span style={{color:B.orange,marginLeft:8}}>Sending {sentCount}/{drafts.filter(d=>d.status!=="sent").length}...</span>}
            </div>
            <div style={{display:"flex",gap:7}}>
              <button onClick={()=>setDrafts([])} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:5,padding:"6px 13px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>← START OVER</button>
              <button onClick={sendAll} disabled={sending||!drafts.some(d=>d.status==="draft")} style={{background:B.green,color:B.white,border:"none",borderRadius:5,padding:"7px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:sending?.6:1}}>
                {sending?"SENDING...":"✉ SEND ALL DRAFTS"}
              </button>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {drafts.map(d=>{
              const STATUS_C={draft:B.muted,sending:B.orange,sent:B.green,failed:B.red};
              return(
                <div key={d.id} className="card" style={{padding:14,borderLeft:`3px solid ${STATUS_C[d.status]||B.muted}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d.contactName} <span style={{color:B.muted,fontWeight:400}}>· {d.toEmail}</span></div>
                    </div>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:STATUS_C[d.status],background:`${STATUS_C[d.status]}18`,padding:"2px 7px",borderRadius:8,letterSpacing:.5,flexShrink:0}}>{d.status.toUpperCase()}</span>
                  </div>
                  {d.status==="draft"&&(
                    <div>
                      <input value={d.subject} onChange={e=>updDraft(d.id,"subject",e.target.value)} style={{width:"100%",boxSizing:"border-box",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",marginBottom:5}}/>
                      <textarea value={d.body} onChange={e=>updDraft(d.id,"body",e.target.value)} rows={5} style={{width:"100%",boxSizing:"border-box",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                    </div>
                  )}
                  {d.status==="sent"&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>✓ Sent successfully</div>}
                  {d.status==="failed"&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>✗ {d.error||"Send failed"}</div>}
                </div>
              );
            })}
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
  const {s,dispatch,toast}=useApp();
  const [section,setSection]=useState("email"); // "email" | "ads"
  const [tab,setTab]=useState("campaigns");
  const [product,setProduct]=useState("Track & Field Equipment");
  const [audience,setAudience]=useState("Athletic Director");
  const [channel,setChannel]=useState("cold email");
  const [tone,setTone]=useState("friendly");
  const [ctx,setCtx]=useState("");
  const [out,setOut]=useState("");
  const [running,setRunning]=useState(false);

  // Campaigns state
  const [selSeq,setSelSeq]=useState(null);
  const [building,setBuilding]=useState(false);
  const [newCamp,setNewCamp]=useState(null); // draft campaign form
  const [genRunning,setGenRunning]=useState(false);
  const [segRunning,setSegRunning]=useState(false);
  const [segResult,setSegResult]=useState(null); // {summary, segments:[{contactId,fit,reason}]}
  const [selectedContacts,setSelectedContacts]=useState(new Set());
  const [filterSport,setFilterSport]=useState("all");

  const gen=async()=>{
    setRunning(true);setOut("");
    let p="";
    if(tab==="copy") p=`Write ${channel} copy for ST1 Sports targeting ${audience}s. Product: ${product}. Tone: ${tone}. ${ctx} ${ST1}. Include subject line if email. Under 120 words. Use {{firstName}} {{orgName}}.`;
    else p=`90-day marketing strategy for ST1 Sports. Focus: ${product}. Audience: ${audience}s. ${ctx} ${ST1}. Include positioning, channels, monthly plan, KPIs.`;
    const t=await aiCall(p,{tokens:900});setOut(t||"");setRunning(false);
  };

  const startNewCampaign=()=>{
    setNewCamp({name:"",product,audience,channel,tone,ctx:"",touches:[],assignAll:false});
    setBuilding(true);
  };

  const generateTouches=async()=>{
    if(!newCamp)return;
    setGenRunning(true);
    const contacts=s.contacts||[];
    const seg=contacts.filter(c=>
      (newCamp.audience==="all"||!newCamp.audience||(c.title||"").toLowerCase().includes(newCamp.audience.toLowerCase().split(" ")[0].toLowerCase()))
    );
    const windowHint=SPORT_WINDOWS[newCamp.product?.split(" ")[0]]||"";
    const result=await aiCall(
      `Create a 3-touch outreach sequence for ST1 Sports. ${ST1}.\n`+
      `Product: ${newCamp.product}. Audience: ${newCamp.audience}. Channel: ${newCamp.channel}. Tone: ${newCamp.tone}.\n`+
      `${newCamp.ctx?`Context: ${newCamp.ctx}.\n`:""}`+
      `${windowHint?`Outreach timing: ${windowHint} (before purchasing season).\n`:""}`+
      `Return JSON: {"touches":[{"step":1,"dayOffset":0,"subject":"","body":""},{"step":2,"dayOffset":4,"subject":"","body":""},{"step":3,"dayOffset":10,"subject":"","body":""}]}\n`+
      `Each touch under 100 words. Use {{firstName}} {{orgName}} merge tags. Step 2 should reference no response to step 1. Step 3 is a final check-in.`,
      {json:true,tokens:1200}
    );
    const touches=(result?.touches||[]).map(t=>({...t,id:mkId()}));
    setNewCamp(c=>({...c,touches,segmentCount:seg.length}));
    setGenRunning(false);
  };

  // ── AI audience segmentation ──────────────────────────────────────────────────
  const analyzeAudience=async()=>{
    if(!newCamp)return;
    setSegRunning(true);setSegResult(null);
    const contacts=s.contacts||[];
    if(contacts.length===0){toast("No contacts in database yet — import or scrape contacts first","error");setSegRunning(false);return;}
    // Compact representation for AI
    const rows=contacts.map(c=>{
      const title=typeof c.title==="string"?c.title:c.title?.name||"";
      const school=typeof c.school==="string"?c.school:c.school?.name||"";
      const sport=typeof c.sport==="string"?c.sport:c.sport?.name||"";
      return `${c.id}|${c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}|${title}|${school}|${sport}|score:${c.score||0}|email:${c.email?"yes":"no"}|status:${c.outreachStatus||c.zohoStatus||"cold"}`;
    }).slice(0,120); // cap at 120 contacts to keep prompt manageable
    const result=await aiCall(
      `You are a sales intelligence engine for ST1 Sports, a school/team sports equipment company.\n`+
      `${ST1}\n\n`+
      `CAMPAIGN TO FILL:\n`+
      `Product: ${newCamp.product}\nChannel: ${newCamp.channel}\nTarget audience: ${newCamp.audience||"any"}\nContext: ${newCamp.ctx||"none"}\n\n`+
      `CONTACT DATABASE (format: id|name|title|school|sport|score|has_email|outreach_status):\n`+
      rows.join("\n")+"\n\n"+
      `TASK: Analyze each contact and return a JSON object with:\n`+
      `- "summary": 1-2 sentence overview of the segment you found\n`+
      `- "segments": array of {contactId, fit, reason} where fit is "high"|"medium"|"low"\n`+
      `HIGH = direct buyer/decision-maker for this product type with email\n`+
      `MEDIUM = influencer, related role, or adjacent buyer\n`+
      `LOW = unlikely fit but possible\n`+
      `Only include contacts with a realistic reason. Omit completely irrelevant contacts.\n`+
      `Return ONLY valid JSON, no markdown.`,
      {json:true,tokens:2000}
    );
    const segs=result?.segments||[];
    // Pre-select high + medium
    const presel=new Set(segs.filter(s=>s.fit==="high"||s.fit==="medium").map(s=>s.contactId));
    setSegResult({summary:result?.summary||"",segments:segs});
    setSelectedContacts(presel);
    setSegRunning(false);
    if(segs.length===0) toast("No strong matches found — try broadening the audience or adding more contacts","info");
  };

  const saveCampaign=()=>{
    if(!newCamp||!newCamp.touches.length)return;
    const contacts=s.contacts||[];
    // Use AI-selected contacts if segmentation ran, otherwise fall back to keyword match
    const seg=segResult
      ? contacts.filter(c=>selectedContacts.has(c.id))
      : contacts.filter(c=>(newCamp.audience==="all"||!newCamp.audience||(c.title||"").toLowerCase().includes(newCamp.audience.toLowerCase().split(" ")[0].toLowerCase())));
    const today=new Date().toISOString().slice(0,10);
    const seq={
      id:mkId(),
      name:newCamp.name||`${newCamp.product} — ${newCamp.audience}`,
      product:newCamp.product,
      audience:newCamp.audience,
      channel:newCamp.channel,
      tone:newCamp.tone,
      touches:newCamp.touches,
      enrollments:seg.map(c=>({contactId:c.id,step:0,status:"active",enrolledAt:today,nextDate:today})),
      status:"active",
      createdAt:today,
    };
    dispatch("ADD_SEQUENCE",seq);
    seg.forEach(c=>dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`}));
    setBuilding(false);setNewCamp(null);setSelSeq(seq.id);setSegResult(null);setSelectedContacts(new Set());
    toast(`Campaign created · ${seg.length} contacts enrolled`,"success");
  };

  const markContacted=(seqId,contactId)=>{
    const seq=(s.sequences||[]).find(s=>s.id===seqId);
    if(!seq)return;
    const enroll=seq.enrollments.find(e=>e.contactId===contactId);
    if(!enroll)return;
    const nextStep=enroll.step+1;
    const done=nextStep>=seq.touches.length;
    const nextTouch=seq.touches[nextStep];
    const nextDate=nextTouch?new Date(Date.now()+nextTouch.dayOffset*86400000).toISOString().slice(0,10):null;
    const updated={...seq,enrollments:seq.enrollments.map(e=>
      e.contactId===contactId?{...e,step:nextStep,status:done?"done":"active",nextDate:nextDate||e.nextDate,lastContacted:today()}:e
    )};
    dispatch("UPDATE_SEQUENCE",updated);
    dispatch("SCORE_CONTACT",{contactId,type:"sent",campaignId:seqId,note:"Touch sent"});
  };

  const markReplied=(seqId,contactId)=>{
    const seq=(s.sequences||[]).find(s=>s.id===seqId);
    if(!seq)return;
    dispatch("UPDATE_SEQUENCE",{...seq,enrollments:seq.enrollments.map(e=>
      e.contactId===contactId?{...e,status:"replied"}:e
    )});
    dispatch("UPDATE_CONTACT",{id:contactId,outreachStatus:"replied"});
    dispatch("SCORE_CONTACT",{contactId,type:"replied",campaignId:seqId,note:"Replied to campaign"});
  };

  const [editingTouchIdx,setEditingTouchIdx] = useState(null); // index in activeSeq.touches
  const [touchDraft,setTouchDraft] = useState({subject:"",body:""});
  const [previewModal,setPreviewModal] = useState(null); // {contact,touch}
  const [sending, setSending] = useState(false);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [checkingOpens, setCheckingOpens] = useState(false);

  // ── Actual Gmail send for one enrollment ─────────────────────────────────────
  const sendOneEmail = async (seq, enroll) => {
    const c = contactMap[enroll.contactId];
    if (!c?.email) return {ok:false,reason:"no email"};
    const touch = seq.touches[enroll.step];
    if (!touch) return {ok:false,reason:"no touch"};
    const co = s.company||{};
    const sigParts=[co.ownerName||co.name,co.email,co.phone,co.website].filter(Boolean);
    const sigText=sigParts.length?"\n\n—\n"+sigParts.join("\n"):"";
    const subject=mergeTags(touch.subject,c)||`Following up — ${seq.product}`;
    const plainBody=mergeTags(touch.body,c)+sigText;
    // Embed tracking pixel in HTML version of the email
    const eid=`${seq.id}~${enroll.contactId}~${enroll.step}`;
    const trackUrl=`${window.location.origin}/api/track/open?eid=${encodeURIComponent(eid)}`;
    const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const htmlLines=plainBody.split("\n").map(l=>l.trim()?`<p style="margin:0 0 10px 0">${esc(l)}</p>`:"<br>").join("");
    const htmlBody=`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;max-width:600px;margin:0 auto;padding:20px 24px">${htmlLines}<img src="${trackUrl}" width="1" height="1" style="display:none" alt=""></body></html>`;
    try {
      const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"send",to_email:c.email,to_name:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),subject,body:plainBody,htmlBody})});
      const d=await r.json();
      return d.sent?{ok:true}:{ok:false,reason:d.error||"send failed"};
    }catch(err){return {ok:false,reason:err.message};}
  };

  // ── Send all due emails for one campaign ─────────────────────────────────────
  const sendDueEmails = async (seqId) => {
    const seq=(s.sequences||[]).find(seq=>seq.id===seqId);
    if(!seq)return;
    const todayStr=today();
    const due=(seq.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr);
    if(!due.length){toast("No emails due today","info");return;}
    setSending(true);
    let sent=0,failed=0;
    for(const enroll of due){
      const res=await sendOneEmail(seq,enroll);
      if(res.ok){markContacted(seqId,enroll.contactId);sent++;}
      else failed++;
    }
    setSending(false);
    toast(`Sent ${sent}${failed?`, ${failed} failed`:""}`,sent>0?"success":"error");
  };

  // ── Send due emails across ALL active campaigns ───────────────────────────────
  const sendAllDue = async () => {
    const todayStr=today();
    const seqs=(s.sequences||[]).filter(seq=>seq.status==="active");
    let totalSent=0,totalFailed=0;
    setSending(true);
    for(const seq of seqs){
      const due=(seq.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr);
      for(const enroll of due){
        const res=await sendOneEmail(seq,enroll);
        if(res.ok){markContacted(seq.id,enroll.contactId);totalSent++;}
        else totalFailed++;
      }
    }
    setSending(false);
    if(totalSent+totalFailed===0){toast("No emails due today","info");return;}
    toast(`Sent ${totalSent} email${totalSent!==1?"s":""}${totalFailed?`, ${totalFailed} failed`:""}`,totalSent>0?"success":"error");
  };

  // ── Check Gmail for replies from enrolled contacts ────────────────────────────
  const checkReplies = async (seqId) => {
    const seq=(s.sequences||[]).find(seq=>seq.id===seqId);
    if(!seq)return;
    const activeEnrolls=(seq.enrollments||[]).filter(e=>e.status==="active");
    const activeEmails=activeEnrolls.map(e=>contactMap[e.contactId]?.email).filter(Boolean);
    if(!activeEmails.length){toast("No active enrollments with email","info");return;}
    setCheckingReplies(true);
    try{
      const query=activeEmails.slice(0,15).map(e=>`from:${e}`).join(" OR ");
      const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"list",query,maxResults:50})});
      const data=await r.json();
      const repliedEmailSet=new Set((data.messages||[]).map(m=>{
        const match=m.from?.match(/<([^>]+)>/)||m.from?.match(/([^\s]+@[^\s]+)/);
        return match?.[1]?.toLowerCase();
      }).filter(Boolean));
      let found=0;
      activeEnrolls.forEach(e=>{
        const c=contactMap[e.contactId];
        if(c?.email&&repliedEmailSet.has(c.email.toLowerCase())){markReplied(seqId,e.contactId);found++;}
      });
      toast(found>0?`Found ${found} repl${found!==1?"ies":"y"}!`:"No new replies detected",found>0?"success":"info");
    }catch(err){toast("Reply check failed: "+err.message,"error");}
    setCheckingReplies(false);
  };

  // ── Check Postgres for email opens (tracking pixel fires when email opened) ──
  const checkOpens = async (seqId) => {
    const seq=(s.sequences||[]).find(seq=>seq.id===seqId);
    if(!seq)return;
    setCheckingOpens(true);
    try{
      const r=await fetch(`/api/track/open?list=1&seqId=${encodeURIComponent(seqId)}`);
      const data=await r.json();
      // Group by contactId → latest openedAt
      const openMap={};
      (data.opens||[]).forEach(o=>{
        if(!openMap[o.contactId]||o.openedAt>openMap[o.contactId]) openMap[o.contactId]=o.openedAt;
      });
      let found=0;
      const updatedEnrollments=seq.enrollments.map(e=>{
        const openedAt=openMap[e.contactId];
        if(openedAt&&!e.openedAt){
          dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"opened",campaignId:seqId,note:"Opened email (tracked)"});
          found++;
          return {...e,openedAt};
        }
        return e;
      });
      if(found>0) dispatch("UPDATE_SEQUENCE",{...seq,enrollments:updatedEnrollments});
      toast(found>0?`${found} contact${found!==1?"s":""}  opened an email!`:"No new opens detected",found>0?"success":"info");
    }catch(err){toast("Open check failed: "+err.message,"error");}
    setCheckingOpens(false);
  };

  const openTouchEdit=(idx)=>{
    const t=activeSeq?.touches?.[idx];
    if(!t)return;
    setEditingTouchIdx(idx);
    setTouchDraft({subject:t.subject||"",body:t.body||""});
  };
  const saveTouchEdit=()=>{
    if(!activeSeq||editingTouchIdx===null)return;
    const updated={...activeSeq,touches:activeSeq.touches.map((t,i)=>i===editingTouchIdx?{...t,...touchDraft}:t)};
    dispatch("UPDATE_SEQUENCE",updated);
    setEditingTouchIdx(null);
    toast("Email updated","success");
  };
  const activeSeq=selSeq?(s.sequences||[]).find(s=>s.id===selSeq):null;
  const contactMap=Object.fromEntries((s.contacts||[]).map(c=>[c.id,c]));

  const allSports=[...new Set((s.contacts||[]).map(c=>c.sport).filter(Boolean))].sort();

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="CAMPAIGNS & AD ENGINE" sub="Email outreach sequences, AI copy, and ad creative"/>
      {/* Top-level section toggle */}
      <div style={{display:"flex",gap:0,marginBottom:18,background:B.white,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden",width:"fit-content"}}>
        {[["email","✉ EMAIL CAMPAIGNS"],["ads","⬛ AD ENGINE"]].map(([id,l])=>(
          <button key={id} onClick={()=>setSection(id)} style={{background:section===id?B.orange:"transparent",color:section===id?B.white:B.muted,border:"none",padding:"8px 20px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {section==="ads"&&<ModAds/>}

      {section==="email"&&<>
      <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>
        {[["campaigns","Campaigns"],["copy","Copy Generator"],["strategy","Strategy"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{l}</button>
        ))}
      </div>

      {/* ── CAMPAIGNS ──────────────────────────────────────────────── */}
      {tab==="campaigns"&&(
        <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16}}>
          {/* Left: sequence list */}
          <div>
            <OBtn sm onClick={startNewCampaign} style={{width:"100%",marginBottom:8}}>+ NEW CAMPAIGN</OBtn>
            {(()=>{
              const todayStr=today();
              const totalDue=(s.sequences||[]).filter(seq=>seq.status==="active").reduce((n,seq)=>n+(seq.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr).length,0);
              return totalDue>0?(
                <button onClick={sendAllDue} disabled={sending} style={{width:"100%",marginBottom:12,background:B.green,color:B.white,border:"none",borderRadius:5,padding:"8px 0",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
                  {sending?"SENDING...":"▶ SEND ALL DUE ("+totalDue+")"}
                </button>
              ):<div style={{marginBottom:12}}/>;
            })()}
            {(s.sequences||[]).length===0&&!building&&(
              <div className="card" style={{padding:20,textAlign:"center"}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:8}}>No campaigns yet</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Create a campaign to enroll contacts from your database and track outreach</div>
              </div>
            )}
            {(s.sequences||[]).map(seq=>{
              const active=seq.enrollments.filter(e=>e.status==="active").length;
              const replied=seq.enrollments.filter(e=>e.status==="replied").length;
              const done=seq.enrollments.filter(e=>e.status==="done").length;
              return (
                <div key={seq.id} onClick={()=>{setSelSeq(seq.id);setBuilding(false);}} className="card fu" style={{padding:"11px 13px",marginBottom:8,borderLeft:`3px solid ${selSeq===seq.id?B.orange:B.border}`,cursor:"pointer",background:selSeq===seq.id?`${B.orange}06`:B.white}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:3}}>{seq.name}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{seq.product} · {seq.channel}</div>
                  <div style={{display:"flex",gap:6}}>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{active} active</span>
                    {replied>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 6px",borderRadius:3}}>{replied} replied</span>}
                    {done>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,padding:"2px 6px",borderRadius:3}}>{done} done</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: new campaign builder OR campaign detail */}
          {building&&newCamp&&(
            <div className="card" style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>NEW CAMPAIGN</div>
                <GBtn onClick={()=>{setBuilding(false);setNewCamp(null);}}>CANCEL</GBtn>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <Lbl s={{marginBottom:4}}>Campaign Name</Lbl>
                  <input value={newCamp.name} onChange={e=>setNewCamp(c=>({...c,name:e.target.value}))} placeholder="e.g. T&F ADs — Spring 2026" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                </div>
                <div>
                  <Lbl s={{marginBottom:4}}>Channel</Lbl>
                  <select value={newCamp.channel} onChange={e=>setNewCamp(c=>({...c,channel:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                    {["cold email","LinkedIn","email newsletter","SMS","phone"].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <Lbl s={{marginBottom:4}}>Product Focus</Lbl>
                  <select value={newCamp.product} onChange={e=>setNewCamp(c=>({...c,product:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                    {PRODUCT_CATS.map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <Lbl s={{marginBottom:4}}>Audience (role keyword)</Lbl>
                  <input value={newCamp.audience} onChange={e=>setNewCamp(c=>({...c,audience:e.target.value}))} placeholder="Athletic Director, Coach, all..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <Lbl s={{marginBottom:4}}>Tone</Lbl>
                <div style={{display:"flex",gap:5}}>
                  {["friendly","professional","urgent","conversational"].map(t=>(
                    <button key={t} onClick={()=>setNewCamp(c=>({...c,tone:t}))} style={{background:newCamp.tone===t?`${B.orange}14`:B.white,color:newCamp.tone===t?B.orange:B.muted,border:`1px solid ${newCamp.tone===t?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{t}</button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <Lbl s={{marginBottom:4}}>Context / Angle</Lbl>
                <textarea value={newCamp.ctx} onChange={e=>setNewCamp(c=>({...c,ctx:e.target.value}))} rows={2} placeholder="Season timing, specific offer, competitive angle..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,resize:"vertical",fontFamily:"'Lexend',sans-serif"}}/>
              </div>
              {/* ── SMART SEGMENT ─────────────────────────────────────── */}
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <Lbl>AUDIENCE SEGMENT</Lbl>
                  <button onClick={analyzeAudience} disabled={segRunning} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer",opacity:segRunning?.7:1}}>
                    {segRunning?"✦ ANALYZING...":"✦ SMART SEGMENT"}
                  </button>
                </div>
                {segRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,padding:"8px 0"}}><Spin/>AI is matching contacts to this campaign…</div>}
                {!segRunning&&!segResult&&(
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"6px 10px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`}}>
                    {(s.contacts||[]).length===0
                      ? "No contacts yet — import from Apollo, scrape leads, or add manually"
                      : `${(s.contacts||[]).length} contacts in database · click Smart Segment to let AI find the best matches`
                    }
                  </div>
                )}
                {segResult&&(
                  <div>
                    {segResult.summary&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"8px 10px",background:`${B.purple}08`,border:`1px solid ${B.purple}20`,borderRadius:5,marginBottom:10,lineHeight:1.5}}>{segResult.summary}</div>}
                    {(()=>{
                      const byFit={high:[],medium:[],low:[]};
                      (segResult.segments||[]).forEach(sg=>{byFit[sg.fit]?.push(sg);});
                      const fitConfig=[["high","BEST MATCH",B.green],["medium","GOOD MATCH",B.orange],["low","POSSIBLE",B.muted]];
                      return fitConfig.map(([fit,label,color])=>{
                        if(!byFit[fit]?.length) return null;
                        return(
                          <div key={fit} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color,letterSpacing:1}}>{label} ({byFit[fit].length})</div>
                              <div style={{display:"flex",gap:6}}>
                                <button onClick={()=>setSelectedContacts(sc=>{const n=new Set(sc);byFit[fit].forEach(sg=>n.add(sg.contactId));return n;})} style={{background:"none",border:"none",color,fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>+ ALL</button>
                                <button onClick={()=>setSelectedContacts(sc=>{const n=new Set(sc);byFit[fit].forEach(sg=>n.delete(sg.contactId));return n;})} style={{background:"none",border:"none",color:B.muted,fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>− ALL</button>
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
                              {byFit[fit].map(sg=>{
                                const c=(s.contacts||[]).find(c=>c.id===sg.contactId);
                                if(!c)return null;
                                const checked=selectedContacts.has(sg.contactId);
                                const name=c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"Unknown";
                                const title=typeof c.title==="string"?c.title:c.title?.name||"";
                                const school=typeof c.school==="string"?c.school:c.school?.name||"";
                                return(
                                  <div key={sg.contactId} onClick={()=>setSelectedContacts(sc=>{const n=new Set(sc);checked?n.delete(sg.contactId):n.add(sg.contactId);return n;})}
                                    style={{display:"flex",alignItems:"flex-start",gap:8,padding:"6px 8px",borderRadius:5,background:checked?`${color}08`:B.surface,border:`1px solid ${checked?color:B.border}`,cursor:"pointer"}}>
                                    <input type="checkbox" checked={checked} onChange={()=>{}} style={{marginTop:2,flexShrink:0,accentColor:color}}/>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{name}{c.email&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,marginLeft:5}}>✉</span>}</div>
                                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{title}{school?` · ${school}`:""}</div>
                                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color,marginTop:1,fontStyle:"italic"}}>{sg.reason}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,padding:"6px 10px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`,textAlign:"center"}}>
                      {selectedContacts.size} contact{selectedContacts.size!==1?"s":""} selected for enrollment
                    </div>
                  </div>
                )}
              </div>
              <OBtn onClick={generateTouches} disabled={genRunning} style={{marginBottom:14,width:"100%"}}>
                {genRunning?"✦ GENERATING SEQUENCE...":"✦ GENERATE 3-TOUCH SEQUENCE"}
              </OBtn>
              {newCamp.touches.length>0&&(
                <div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:8}}>Review and edit each email before launching:</div>
                  {newCamp.touches.map((t,i)=>(
                    <div key={t.id||i} className="card" style={{padding:12,marginBottom:8,borderLeft:`3px solid ${B.orange}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1}}>TOUCH {t.step} — DAY {t.dayOffset}</div>
                      </div>
                      <div style={{marginBottom:6}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SUBJECT</div>
                        <input value={t.subject||""} onChange={e=>setNewCamp(c=>({...c,touches:c.touches.map((x,j)=>j===i?{...x,subject:e.target.value}:x)}))}
                          style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                      </div>
                      <div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>BODY</div>
                        <textarea value={t.body||""} onChange={e=>setNewCamp(c=>({...c,touches:c.touches.map((x,j)=>j===i?{...x,body:e.target.value}:x)}))}
                          rows={4} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>Merge tags: {'{{firstName}}'} {'{{orgName}}'} {'{{sport}}'}</div>
                    </div>
                  ))}
                  <OBtn onClick={saveCampaign} style={{width:"100%",marginTop:4}}>✓ LAUNCH CAMPAIGN</OBtn>
                </div>
              )}
            </div>
          )}

          {activeSeq&&!building&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,letterSpacing:.2,marginBottom:3}}>{activeSeq.name}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{activeSeq.product} · {activeSeq.channel} · {activeSeq.touches.length} touches</div>
                </div>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"3px 8px",borderRadius:3,letterSpacing:.5}}>{activeSeq.status?.toUpperCase()}</span>
              </div>
              {/* Stats bar */}
              {(()=>{
                const enrs=activeSeq.enrollments||[];
                const sentCount=enrs.reduce((n,e)=>n+(e.step||0),0);
                const repliedN=enrs.filter(e=>e.status==="replied").length;
                const doneN=enrs.filter(e=>e.status==="done").length;
                const activeN=enrs.filter(e=>e.status==="active").length;
                const openedN=enrs.filter(e=>e.openedAt).length;
                return(
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {[["ENROLLED",enrs.length,B.blue],["ACTIVE",activeN,B.orange],["SENT",sentCount,B.purple],["OPENED",openedN,B.teal],["REPLIED",repliedN,B.green],["DONE",doneN,B.muted]].map(([l,v,c])=>(
                      <div key={l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"6px 12px",textAlign:"center",minWidth:60}}>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:c,lineHeight:1}}>{v}</div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginTop:2}}>{l}</div>
                      </div>
                    ))}
                    {(()=>{
                      const todayStr=today();
                      const dueN=enrs.filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr).length;
                      return(
                        <>
                          <button onClick={()=>sendDueEmails(activeSeq.id)} disabled={sending||dueN===0}
                            style={{background:dueN>0?B.green:B.surface,color:dueN>0?B.white:B.muted,border:`1px solid ${dueN>0?B.green:B.border}`,borderRadius:5,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:dueN>0?"pointer":"default",alignSelf:"center",whiteSpace:"nowrap"}}>
                            {sending?"SENDING...":"▶ SEND DUE"+(dueN>0?" ("+dueN+")":"")}
                          </button>
                          <button onClick={()=>checkReplies(activeSeq.id)} disabled={checkingReplies||checkingOpens}
                            style={{background:B.surface,color:B.blue,border:`1px solid ${B.blue}30`,borderRadius:5,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer",alignSelf:"center",whiteSpace:"nowrap"}}>
                            {checkingReplies?"CHECKING...":"↻ REPLIES"}
                          </button>
                          <button onClick={()=>checkOpens(activeSeq.id)} disabled={checkingOpens||checkingReplies}
                            style={{background:B.surface,color:B.purple,border:`1px solid ${B.purple}30`,borderRadius:5,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer",alignSelf:"center",whiteSpace:"nowrap"}}>
                            {checkingOpens?"CHECKING...":"👁 OPENS"}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                );
              })()}
              {/* Sequence touchpoints — editable */}
              <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"flex-start"}}>
                {activeSeq.touches.map((t,i)=>(
                  <div key={t.id||i} className="card" style={{flex:1,padding:10,borderTop:`2px solid ${B.orange}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1}}>TOUCH {t.step} · DAY {t.dayOffset}</div>
                      <button onClick={()=>editingTouchIdx===i?setEditingTouchIdx(null):openTouchEdit(i)}
                        style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>
                        {editingTouchIdx===i?"✕ CANCEL":"✎ EDIT"}
                      </button>
                    </div>
                    {editingTouchIdx===i?(
                      <div>
                        <div style={{marginBottom:6}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SUBJECT</div>
                          <input value={touchDraft.subject} onChange={e=>setTouchDraft(d=>({...d,subject:e.target.value}))}
                            style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                        </div>
                        <div style={{marginBottom:8}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>BODY</div>
                          <textarea value={touchDraft.body} onChange={e=>setTouchDraft(d=>({...d,body:e.target.value}))}
                            rows={5} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                        </div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>Tags: {'{{firstName}}'} {'{{orgName}}'} {'{{sport}}'}</div>
                        <OBtn sm onClick={saveTouchEdit}>✓ SAVE EMAIL</OBtn>
                      </div>
                    ):(
                      <>
                        {t.subject&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:4}}>{t.subject}</div>}
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{t.body}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* Enrolled contacts */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>ENROLLED CONTACTS ({activeSeq.enrollments.length})</div>
                <div style={{display:"flex",gap:6}}>
                  {["all",...allSports].map(sp=>(
                    <button key={sp} onClick={()=>setFilterSport(sp)} style={{background:filterSport===sp?B.orange:B.white,color:filterSport===sp?B.white:B.muted,border:`1px solid ${filterSport===sp?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{sp==="all"?"All":sp}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {activeSeq.enrollments
                  .filter(e=>{
                    const c=contactMap[e.contactId];
                    return !c||(filterSport==="all"||c.sport===filterSport);
                  })
                  .sort((a,b)=>a.step-b.step)
                  .map(e=>{
                    const c=contactMap[e.contactId];
                    if(!c)return null;
                    const touch=activeSeq.touches[e.step];
                    const sc={active:B.blue,replied:B.green,done:B.muted,unsubscribed:B.red}[e.status]||B.muted;
                    return (
                      <div key={e.contactId} className="card fu" style={{padding:"9px 12px",borderLeft:`3px solid ${sc}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div>
                            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
                              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}</span>
                              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:sc,background:`${sc}20`,padding:"2px 6px",borderRadius:3}}>{e.status?.toUpperCase()}</span>
                              {c.sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c.sport}</span>}
                              {(()=>{const t=scoreTier(c.score);return<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:t.color,background:t.bg,padding:"2px 5px",borderRadius:3}}>{t.label} {c.score||0}</span>})()}
                            </div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""}</div>
                            {c.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green,marginTop:2}}>✉ {c.email}</div>}
                            {touch&&e.status==="active"&&(
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,marginTop:3}}>
                                Next: Touch {touch.step} · {e.nextDate||"today"}{touch.subject?` — "${touch.subject}"`:""}</div>
                            )}
                          </div>
                          {e.status==="active"&&(
                            <div style={{display:"flex",gap:4,flexShrink:0,flexDirection:"column",alignItems:"flex-end"}}>
                              {touch&&<button onClick={()=>setPreviewModal({contact:c,touch})} style={{background:`${B.orange}14`,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",whiteSpace:"nowrap"}}>✉ PREVIEW EMAIL</button>}
                              <div style={{display:"flex",gap:4}}>
                                <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"opened",campaignId:activeSeq.id,note:"Opened email"})} style={{background:B.blueBg,color:B.blue,border:`1px solid ${B.blue}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>OPENED +10</button>
                                <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"clicked",campaignId:activeSeq.id,note:"Clicked link"})} style={{background:B.purpleBg,color:B.purple,border:`1px solid ${B.purple}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>CLICKED +25</button>
                              </div>
                              <div style={{display:"flex",gap:4}}>
                                <GBtn onClick={()=>markContacted(activeSeq.id,e.contactId)} style={{fontSize:9,padding:"3px 8px"}}>✓ SENT +15</GBtn>
                                <button onClick={()=>markReplied(activeSeq.id,e.contactId)} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>REPLIED +50</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
          {!building&&!activeSeq&&(s.sequences||[]).length>0&&(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Select a campaign to view details</div>
          )}
        </div>
      )}

      {/* ── COPY GENERATOR ─────────────────────────────────────────── */}
      {tab==="copy"&&(
        <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {[["Product",PRODUCT_CATS,product,setProduct],
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
      )}

      {/* ── STRATEGY ───────────────────────────────────────────────── */}
      {tab==="strategy"&&(
        <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {[["Product",PRODUCT_CATS,product,setProduct],
              ["Audience",["Athletic Director","Head Track Coach","Head Baseball Coach","Procurement Manager","Coach"],audience,setAudience]].map(([l,opts,val,set])=>(
              <div key={l} className="card" style={{padding:12}}>
                <Lbl s={{marginBottom:7}}>{l}</Lbl>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {opts.map(o=><button key={o} onClick={()=>set(o)} style={{background:val===o?`${B.orange}14`:B.white,color:val===o?B.orange:B.muted,border:`1px solid ${val===o?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{o}</button>)}
                </div>
              </div>
            ))}
            <div className="card" style={{padding:12}}><Lbl s={{marginBottom:6}}>Context</Lbl><textarea value={ctx} onChange={e=>setCtx(e.target.value)} rows={3} placeholder="Target season, budget cycle, competitive notes..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,resize:"vertical"}}/></div>
            <OBtn onClick={()=>{setRunning(true);setOut("");aiCall(`90-day marketing strategy for ST1 Sports. Focus: ${product}. Audience: ${audience}s. ${ctx} ${ST1}. Include positioning, channels, monthly plan, KPIs.`,{tokens:900}).then(t=>{setOut(t||"");setRunning(false);});}} disabled={running} style={{width:"100%"}}>{running?"GENERATING...":"✦ BUILD STRATEGY"}</OBtn>
          </div>
          <div className="card" style={{padding:14,minHeight:360,display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:9}}><Lbl>Strategy Output</Lbl>{out&&<GBtn onClick={()=>navigator.clipboard?.writeText(out)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>}</div>
            {!out&&!running&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",marginTop:50}}>Configure and generate strategy</div>}
            {running&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.yellow,fontSize:12}}><Spin/>Generating strategy...</div>}
            {out&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap",flex:1,overflowY:"auto"}}>{out}</div>}
          </div>
        </div>
      )}
      </>}

      {/* ── EMAIL PREVIEW MODAL ─────────────────────────────────────────── */}
      {previewModal&&(
        <div onClick={()=>setPreviewModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:10,width:"100%",maxWidth:580,maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:`1px solid ${B.border}`}}>
              <div>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,letterSpacing:2}}>EMAIL PREVIEW</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>
                  To: {previewModal.contact.fullName||`${previewModal.contact.firstName||""} ${previewModal.contact.lastName||""}`.trim()} &lt;{previewModal.contact.email||"no email"}&gt;
                </div>
              </div>
              <button onClick={()=>setPreviewModal(null)} style={{background:"none",border:"none",color:B.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${B.border}`,background:B.surface}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:3}}>SUBJECT</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600}}>{mergeTags(previewModal.touch.subject,previewModal.contact)||<span style={{color:B.muted,fontStyle:"italic"}}>No subject</span>}</div>
            </div>
            <div style={{padding:"16px",overflowY:"auto",flex:1}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap"}}>
                {mergeTags(previewModal.touch.body,previewModal.contact)||<span style={{color:B.muted,fontStyle:"italic"}}>No body text</span>}
              </div>
            </div>
            <div style={{padding:"10px 16px",borderTop:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Touch {previewModal.touch.step} · Day {previewModal.touch.dayOffset} · merge tags applied</div>
              <button onClick={()=>setPreviewModal(null)} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"5px 14px",fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>CLOSE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  AD ENGINE
// ════════════════════════════════════════════════════════════════════════════
const AD_OBJECTIVES = ["AWARENESS","CONSIDERATION","CONVERSION","RETARGETING"];
const AD_PLATFORMS  = ["meta","instagram","tiktok","google","email"];
const AD_IMG_STYLES = ["product_only","lifestyle","team","action"];
const AD_SCENE_STYLES = ["action","studio","outdoor","classroom"];
const AD_STATUS_COLORS = {
  DRAFT:B.muted, ACTIVE:B.green, PAUSED:B.yellow, COMPLETE:B.blue, ARCHIVED:B.muted
};

function adFetch(path, opts={}) {
  return fetch(`/api/adengine${path}`, {
    headers: {"Content-Type":"application/json"},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r=>r.json());
}

// ── CLIENT-SIDE AD PREVIEW TEMPLATES ─────────────────────────────────────────
const AD_PV_SIZES = { square:{w:1080,h:1080}, landscape:{w:1200,h:628}, story:{w:1080,h:1920} };

function AdPreview({ tpl, sz, headline, sub, cta, badge, img, bg, tc, ac, logo, logoUrl, maxH=460 }) {
  const {w,h} = AD_PV_SIZES[sz]||AD_PV_SIZES.square;
  const scale = Math.min(maxH/h, 520/w, 1);
  const props = {headline,sub,cta,badge,img,bg,tc,ac,w,h,logo,logoUrl};
  const inner = tpl==="clean"?<_AdClean {...props}/>:tpl==="split"?<_AdSplit {...props}/>:tpl==="overlay"?<_AdOverlay {...props}/>:<_AdBold {...props}/>;
  return (
    <div style={{width:Math.round(w*scale),height:Math.round(h*scale),overflow:"hidden",borderRadius:6,flexShrink:0,position:"relative"}}>
      <div style={{width:w,height:h,transform:`scale(${scale})`,transformOrigin:"top left",position:"absolute",top:0,left:0}}>
        {inner}
      </div>
    </div>
  );
}
function _AdLogo({ac,logo,logoUrl}){if(!logo)return null;if(logoUrl)return <img src={logoUrl} style={{maxHeight:36,maxWidth:140,objectFit:"contain"}} alt="Logo"/>;return <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:5,height:26,background:ac,borderRadius:2}}/><div style={{fontSize:17,fontWeight:900,color:ac,letterSpacing:3,fontFamily:"system-ui"}}>ST1 SPORTS</div></div>;}
function _AdBold({headline,sub,cta,badge,img,bg,tc,ac,w,h,logo,logoUrl}){const p=Math.round(h*.055);return(<div style={{display:"flex",flexDirection:"column",background:bg,width:"100%",height:"100%",padding:p,fontFamily:"system-ui",boxSizing:"border-box"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:Math.round(h*.042)}}><_AdLogo ac={ac} logo={logo} logoUrl={logoUrl}/>{badge&&<div style={{background:ac,color:"#fff",padding:"7px 18px",borderRadius:4,fontSize:16,fontWeight:800,letterSpacing:1}}>{badge.toUpperCase()}</div>}</div><div style={{display:"flex",flex:1,alignItems:"center",gap:Math.round(w*.05)}}><div style={{display:"flex",flexDirection:"column",flex:img?1.1:1,gap:20}}><div style={{fontSize:Math.round(h*.076),fontWeight:900,color:tc,lineHeight:1.05,letterSpacing:-1}}>{headline}</div>{sub&&<div style={{fontSize:Math.round(h*.028),color:tc+"BB",lineHeight:1.5}}>{sub}</div>}{cta&&<div style={{display:"inline-block",background:ac,color:"#fff",padding:`${Math.round(h*.021)}px ${Math.round(h*.042)}px`,borderRadius:7,fontSize:Math.round(h*.028),fontWeight:800,marginTop:10}}>{cta}</div>}</div>{img&&<div style={{flex:.9,display:"flex",justifyContent:"center",alignItems:"center"}}><img src={img} style={{width:Math.round(w*.38),height:Math.round(h*.57),objectFit:"contain",borderRadius:16}}/></div>}</div></div>);}
function _AdClean({headline,sub,cta,badge,img,bg,tc,ac,w,h,logo,logoUrl}){const p=Math.round(h*.06);return(<div style={{display:"flex",flexDirection:"column",background:bg,width:"100%",height:"100%",padding:p,fontFamily:"system-ui",boxSizing:"border-box",alignItems:"center",justifyContent:"center"}}>{logo&&(logoUrl?<img src={logoUrl} style={{maxHeight:40,maxWidth:160,objectFit:"contain",marginBottom:Math.round(h*.035)}} alt="Logo"/>:<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:Math.round(h*.035)}}><div style={{width:5,height:24,background:ac,borderRadius:2}}/><div style={{fontSize:16,fontWeight:900,color:ac,letterSpacing:3}}>ST1 SPORTS</div></div>)}{img&&<img src={img} style={{width:Math.round(w*.52),height:Math.round(h*.44),objectFit:"contain",borderRadius:14,marginBottom:Math.round(h*.038)}}/>}{badge&&<div style={{background:ac,color:"#fff",padding:"6px 16px",borderRadius:4,fontSize:14,fontWeight:800,marginBottom:16}}>{badge.toUpperCase()}</div>}<div style={{fontSize:Math.round(h*.066),fontWeight:900,color:tc,lineHeight:1.08,letterSpacing:-.5,textAlign:"center",marginBottom:16}}>{headline}</div>{sub&&<div style={{fontSize:Math.round(h*.025),color:tc+"99",lineHeight:1.55,textAlign:"center",maxWidth:Math.round(w*.76),marginBottom:22}}>{sub}</div>}{cta&&<div style={{background:ac,color:"#fff",padding:`${Math.round(h*.021)}px ${Math.round(h*.052)}px`,borderRadius:7,fontSize:Math.round(h*.026),fontWeight:800}}>{cta}</div>}<div style={{fontSize:12,color:tc+"44",letterSpacing:3,marginTop:Math.round(h*.045)}}>ST1SPORTS.COM</div></div>);}
function _AdSplit({headline,sub,cta,badge,img,bg,tc,ac,w,h,logo,logoUrl}){const p=Math.round(h*.06);return(<div style={{display:"flex",background:bg,width:"100%",height:"100%",fontFamily:"system-ui"}}><div style={{display:"flex",flexDirection:"column",flex:1,padding:p,justifyContent:"center",gap:18}}>{logo&&(logoUrl?<img src={logoUrl} style={{maxHeight:34,maxWidth:130,objectFit:"contain",marginBottom:6}} alt="Logo"/>:<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><div style={{width:5,height:22,background:ac,borderRadius:2}}/><div style={{fontSize:15,fontWeight:900,color:ac,letterSpacing:3}}>ST1 SPORTS</div></div>)}{badge&&<div style={{display:"inline-block",background:ac,color:"#fff",padding:"6px 14px",borderRadius:4,fontSize:13,fontWeight:800}}>{badge.toUpperCase()}</div>}<div style={{fontSize:Math.round(h*.074),fontWeight:900,color:tc,lineHeight:1.06,letterSpacing:-1}}>{headline}</div>{sub&&<div style={{fontSize:Math.round(h*.026),color:tc+"AA",lineHeight:1.5}}>{sub}</div>}{cta&&<div style={{display:"inline-block",background:ac,color:"#fff",padding:`${Math.round(h*.021)}px ${Math.round(h*.04)}px`,borderRadius:7,fontSize:Math.round(h*.026),fontWeight:800,marginTop:8}}>{cta}</div>}<div style={{fontSize:12,color:tc+"44",letterSpacing:3,marginTop:"auto"}}>ST1SPORTS.COM</div></div><div style={{flex:1,display:"flex",justifyContent:"center",alignItems:"center",background:`${ac}0F`,borderLeft:`4px solid ${ac}`}}>{img?<img src={img} style={{width:Math.round(w*.41),height:Math.round(h*.66),objectFit:"contain",borderRadius:10}}/>:<div style={{fontSize:18,color:tc+"33",fontWeight:700,letterSpacing:2}}>PRODUCT IMAGE</div>}</div></div>);}
function _AdOverlay({headline,sub,cta,badge,img,bg,tc,ac,w,h,logo,logoUrl}){const px=Math.round(w*.05),py=Math.round(h*.045);return(<div style={{position:"relative",background:bg,width:"100%",height:"100%",fontFamily:"system-ui",overflow:"hidden"}}>{img&&<img src={img} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover"}}/>}<div style={{position:"absolute",bottom:0,left:0,right:0,height:"58%",background:"linear-gradient(to top,rgba(0,0,0,.93) 0%,rgba(0,0,0,0) 100%)"}}/>  {logo&&(logoUrl?<img src={logoUrl} style={{position:"absolute",top:py,left:px,maxHeight:32,maxWidth:120,objectFit:"contain"}} alt="Logo"/>:<div style={{position:"absolute",top:py,left:px,display:"flex",alignItems:"center",gap:8}}><div style={{width:5,height:22,background:ac,borderRadius:2}}/><div style={{fontSize:15,fontWeight:900,color:"#fff",letterSpacing:3}}>ST1 SPORTS</div></div>)}{badge&&<div style={{position:"absolute",top:py,right:px,background:ac,color:"#fff",padding:"7px 17px",borderRadius:4,fontSize:14,fontWeight:800}}>{badge.toUpperCase()}</div>}<div style={{position:"absolute",bottom:0,left:0,right:0,padding:`${Math.round(h*.05)}px ${px}px`,display:"flex",flexDirection:"column",gap:12}}><div style={{fontSize:Math.round(h*.072),fontWeight:900,color:"#fff",lineHeight:1.05,letterSpacing:-1}}>{headline}</div>{sub&&<div style={{fontSize:Math.round(h*.024),color:"#FFFFFFCC",lineHeight:1.45}}>{sub}</div>}<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>{cta?<div style={{display:"inline-block",background:ac,color:"#fff",padding:`${Math.round(h*.019)}px ${Math.round(h*.037)}px`,borderRadius:7,fontSize:Math.round(h*.025),fontWeight:800}}>{cta}</div>:<div/>}<div style={{fontSize:12,color:"#FFFFFF66",letterSpacing:3}}>ST1SPORTS.COM</div></div></div></div>);}

function ModAds() {
  const {s, dispatch, toast} = useApp();
  const [tab, setTab] = useState("campaigns");

  // Campaign list
  const [campaigns, setCampaigns] = useState([]);
  const [campTotal, setCampTotal] = useState(0);
  const [campLoading, setCampLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [selCamp, setSelCamp] = useState(null);       // full campaign object
  const [selCampId, setSelCampId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name:"", brief:"", audience:"", objective:"AWARENESS",
    platforms:["meta"], imageStyle:"product_only", sceneStyle:"action",
    variantsPerProduct:2, startDate:"", endDate:"",
  });
  const [creating, setCreating] = useState(false);

  // Generate copy
  const [copyProdName, setCopyProdName] = useState("");
  const [copyProdDesc, setCopyProdDesc] = useState("");
  const [copyProdPrice, setCopyProdPrice] = useState("");
  const [genCopyRunning, setGenCopyRunning] = useState(false);

  // Generate image
  const [imgProdName, setImgProdName] = useState("");
  const [imgStyle, setImgStyle] = useState("product_only");
  const [imgScene, setImgScene] = useState("action");
  const [genImgRunning, setGenImgRunning] = useState(false);
  const [lastImg, setLastImg] = useState(null); // {url, assetId}

  // Products
  const [products, setProducts] = useState([]);
  const [prodSearch, setProdSearch] = useState("");
  const [prodLoading, setProdLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Ad Creator
  const previewTimerRef = useRef(null);
  const [adTpl, setAdTpl] = useState("bold");
  const [adSz, setAdSz] = useState("square");
  const [adHeadline, setAdHeadline] = useState("TRAIN HARDER. WIN MORE.");
  const [adSub, setAdSub] = useState("");
  const [adCta, setAdCta] = useState("SHOP NOW");
  const [adBadge, setAdBadge] = useState("");
  const [adBg, setAdBg] = useState("#0A0A0A");
  const [adTc, setAdTc] = useState("#FFFFFF");
  const [adAc, setAdAc] = useState("#F37321");
  const [adLogo, setAdLogo] = useState(true);
  const [adImg, setAdImg] = useState("");
  const [adUrl, setAdUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("/api/adengine/render-ad?tpl=bold&sz=square&headline=TRAIN+HARDER.+WIN+MORE.&cta=SHOP+NOW&bg=%230A0A0A&tc=%23FFFFFF&ac=%23F37321");
  const [ideoPrompt, setIdeoPrompt] = useState("");
  const [ideoStyle, setIdeoStyle] = useState("REALISTIC");
  const [ideoRunning, setIdeoRunning] = useState(false);
  const [ideoResult, setIdeoResult] = useState(null);
  const [downloadRunning, setDownloadRunning] = useState(false);
  const [creatorCopyIdx, setCreatorCopyIdx] = useState(0);
  const [adLogoUrl, setAdLogoUrl] = useState(""); // uploaded brand logo for live preview
  const brandAssetRef = useRef();

  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      const p = new URLSearchParams();
      p.set("tpl", adTpl);
      p.set("sz", adSz);
      p.set("headline", adHeadline || "YOUR HEADLINE");
      if (adSub) p.set("sub", adSub);
      if (adCta) p.set("cta", adCta);
      if (adBadge) p.set("badge", adBadge);
      p.set("bg", adBg);
      p.set("tc", adTc);
      p.set("ac", adAc);
      p.set("logo", adLogo ? "true" : "false");
      if (adImg) p.set("img", adImg);
      setPreviewUrl(`/api/adengine/render-ad?${p.toString()}`);
    }, 600);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [adTpl, adSz, adHeadline, adSub, adCta, adBadge, adBg, adTc, adAc, adLogo, adImg]);

  const generateIdeogramImage = async () => {
    if (!ideoPrompt.trim()) { toast("Enter a product description first", "error"); return; }
    setIdeoRunning(true);
    setIdeoResult(null);
    try {
      const data = await adFetch("/generate-product-image", {
        method: "POST",
        body: { prompt: ideoPrompt, style: ideoStyle, sizeKey: adSz, campaignId: selCamp?.id },
      });
      if (data.imageUrl) {
        setIdeoResult({ imageUrl: data.imageUrl, assetId: data.asset?.id });
        toast("Image generated!", "success");
      } else { toast(data.error || "Image gen failed", "error"); }
    } catch { toast("Image gen failed", "error"); }
    setIdeoRunning(false);
  };

  const downloadAd = async () => {
    if (!previewUrl) return;
    setDownloadRunning(true);
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `st1-ad-${adTpl}-${adSz}-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast("Download failed", "error"); }
    setDownloadRunning(false);
  };

  // Post to Social
  const [showSocialPanel, setShowSocialPanel] = useState(false);
  const [socialCaption, setSocialCaption] = useState("");
  const [socialPlatforms, setSocialPlatforms] = useState(["twitter","linkedin","instagram","facebook"]);
  const [socialPostType, setSocialPostType] = useState("post"); // post | story | ad
  const [socialScheduleAt, setSocialScheduleAt] = useState("");
  const [socialPosting, setSocialPosting] = useState(false);
  const [socialResult, setSocialResult] = useState(null);
  const [copyGenRunning, setCopyGenRunning] = useState(false);
  const [generatedCopies, setGeneratedCopies] = useState(null); // {twitter,linkedin,instagram,facebook}

  const generatePlatformCopy = async () => {
    setCopyGenRunning(true);
    setGeneratedCopies(null);
    try {
      const context = [adHeadline&&`Headline: ${adHeadline}`, adSub&&`Subheadline: ${adSub}`, adCta&&`CTA: ${adCta}`, adBadge&&`Badge: ${adBadge}`].filter(Boolean).join("\n");
      const r = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-haiku-4-5-20251001", max_tokens:600,
          messages:[{role:"user",content:`Generate social media captions for this ad from ST1 Sports (athletic equipment company):\n\n${context}\n\nRespond ONLY with valid JSON:\n{"twitter":"<280 chars, punchy, 1-2 hashtags>","linkedin":"<professional, 2-3 sentences, no hashtags>","instagram":"<engaging, 3-4 sentences, 6-8 hashtags>","facebook":"<conversational, 2-3 sentences, 1-2 hashtags>"}`}]
        })
      });
      const d = await r.json();
      const text = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      const match = text.match(/\{[\s\S]*\}/);
      if (match) setGeneratedCopies(JSON.parse(match[0]));
    } catch { toast("Copy generation failed","error"); }
    setCopyGenRunning(false);
  };

  const openSocialPanel = () => {
    setShowSocialPanel(true);
    setSocialResult(null);
    const parts = [adHeadline, adSub, adCta ? `👉 ${adCta}` : "", "#ST1Sports #Athletics #TrackAndField"].filter(Boolean);
    setSocialCaption(parts.join("\n\n"));
  };

  const submitSocialPost = async () => {
    if (!socialPlatforms.length) { toast("Select at least one platform","error"); return; }
    if (!socialCaption.trim()) { toast("Caption is required","error"); return; }
    setSocialPosting(true);
    setSocialResult(null);
    try {
      const r = await fetch("/api/social-post", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          post: socialCaption,
          platforms: socialPlatforms,
          mediaUrls: adImg ? [adImg] : undefined,
          scheduleDate: socialScheduleAt || undefined,
          isStory: socialPostType === "story",
          link: adUrl || undefined,
        }),
      });
      const data = await r.json();
      // Ayrshare returns status:"success" or "scheduled" on success.
      // It can also return status:"success" WITH errors[] if individual platforms fail.
      const platformErrors = Array.isArray(data.errors) ? data.errors : [];
      const isSuccess = (data.status === "success" || data.status === "scheduled") && !data.error;
      if (isSuccess) {
        const failedNets = platformErrors.map(e=>e.network||e.platform).filter(Boolean);
        const okCount = socialPlatforms.length - failedNets.length;
        setSocialResult({ ok:true, platformErrors, failedNets });
        if (failedNets.length === 0) {
          toast(socialScheduleAt ? `Scheduled for ${new Date(socialScheduleAt).toLocaleString()}!` : `Posted to ${okCount} platform(s)!`, "success");
        } else {
          toast(`Posted to ${okCount} platform(s). Failed: ${failedNets.join(", ")}`, "warn");
        }
        dispatch("ADD_SOCIAL_POST", {
          id:mkId(), createdAt:today(),
          date: socialScheduleAt ? socialScheduleAt.slice(0,10) : today(),
          time: socialScheduleAt ? socialScheduleAt.slice(11,16) : new Date().toTimeString().slice(0,5),
          platforms: socialPlatforms,
          caption: socialCaption,
          imageUrl: adImg,
          link: adUrl,
          status: socialScheduleAt ? "scheduled" : "published",
          postType: socialPostType,
        });
      } else {
        const errMsg = data.error || data.message || (platformErrors[0]?.message) || "Post failed";
        setSocialResult({ ok:false, error: errMsg });
        toast(errMsg, "error");
      }
    } catch { toast("Post failed","error"); }
    setSocialPosting(false);
  };

  const loadCopyIntoCreator = (copy) => {
    if (!copy) return;
    if (copy.headline) setAdHeadline(copy.headline.toUpperCase());
    if (copy.subheadline) setAdSub(copy.subheadline);
    if (copy.cta) setAdCta(copy.cta.toUpperCase());
    if (copy.badge) setAdBadge(copy.badge.toUpperCase());
    setTab("creator");
    toast("Copy loaded into Ad Creator", "success");
  };

  const loadCampaigns = async () => {
    setCampLoading(true);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const data = await adFetch(`/campaigns${q}`);
      setCampaigns(data.items || []);
      setCampTotal(data.total || 0);
    } catch { toast("Failed to load campaigns","error"); }
    setCampLoading(false);
  };

  const loadCampaignDetail = async (id) => {
    setDetailLoading(true);
    setSelCampId(id);
    try {
      const data = await adFetch(`/campaigns/${id}`);
      setSelCamp(data.campaign);
    } catch { toast("Failed to load campaign","error"); }
    setDetailLoading(false);
  };

  const loadProducts = async (search="") => {
    setProdLoading(true);
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const data = await adFetch(`/products${q}`);
      setProducts(data.products || []);
    } catch { toast("Failed to load products","error"); }
    setProdLoading(false);
  };

  useEffect(()=>{ if(tab==="campaigns") loadCampaigns(); },[tab,statusFilter]);
  useEffect(()=>{ if(tab==="products") loadProducts(prodSearch); },[tab]);

  const createCampaign = async () => {
    if (!createForm.name.trim()) { toast("Name required","error"); return; }
    setCreating(true);
    try {
      const data = await adFetch("/campaigns", { method:"POST", body: createForm });
      if (data.campaign) {
        toast(`Campaign "${data.campaign.name}" created`,"success");
        setShowCreate(false);
        setCreateForm({name:"",brief:"",audience:"",objective:"AWARENESS",platforms:["meta"],imageStyle:"product_only",sceneStyle:"action",variantsPerProduct:2,startDate:"",endDate:""});
        loadCampaigns();
        loadCampaignDetail(data.campaign.id);
      } else {
        toast(data.error || "Create failed","error");
      }
    } catch { toast("Create failed","error"); }
    setCreating(false);
  };

  const updateStatus = async (id, status) => {
    await adFetch(`/campaigns/${id}`, { method:"PATCH", body:{status} });
    loadCampaignDetail(id);
    loadCampaigns();
    toast(`Status → ${status}`,"success");
  };

  const generateCopy = async () => {
    if (!selCamp) return;
    setGenCopyRunning(true);
    try {
      const data = await adFetch("/generate-copy", {
        method:"POST",
        body:{ campaignId:selCamp.id, productName:copyProdName||undefined, productDesc:copyProdDesc||undefined, productPrice:copyProdPrice||undefined },
      });
      if (data.copy) {
        toast("Copy generated","success");
        loadCampaignDetail(selCamp.id);
      } else {
        toast(data.error || "Copy gen failed","error");
      }
    } catch { toast("Copy gen failed","error"); }
    setGenCopyRunning(false);
  };

  const generateImage = async () => {
    if (!selCamp) return;
    setGenImgRunning(true);
    setLastImg(null);
    try {
      const data = await adFetch("/generate-product-image", {
        method:"POST",
        body:{ campaignId:selCamp.id, prompt:imgProdName||`${selCamp.name} product photo`, style:imgStyle, sizeKey:imgScene||"square" },
      });
      if (data.imageUrl) {
        setLastImg({ url: data.imageUrl, assetId: data.asset?.id });
        toast("Image generated","success");
        loadCampaignDetail(selCamp.id);
      } else {
        toast(data.error || "Image gen failed","error");
      }
    } catch { toast("Image gen failed","error"); }
    setGenImgRunning(false);
  };

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const data = await adFetch("/products", { method:"POST" });
      toast(data.error ? data.error : `Synced ${data.synced} products`, data.error ? "error" : "success");
      if (!data.error) loadProducts();
    } catch { toast("Sync failed","error"); }
    setSyncing(false);
  };

  const exportCSV = (id) => {
    window.open(`/api/adengine/export-copy-csv?campaignId=${id}`, "_blank");
  };

  // ── STATUS PILL ─────────────────────────────────────────────────────────────
  const StatusPill = ({status}) => (
    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:AD_STATUS_COLORS[status]||B.muted,background:`${AD_STATUS_COLORS[status]||B.muted}18`,padding:"2px 7px",borderRadius:3,letterSpacing:.5}}>
      {status}
    </span>
  );

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="AD ENGINE" sub="Product campaigns, AI image generation, Meta ad copy, and asset management" action={(()=>{
          try {
            const store = JSON.parse(localStorage.getItem("st1_revops_v2")||"{}");
            const contacts = Array.isArray(store.contacts)?store.contacts:[];
            const now = Date.now();
            const cold = contacts.filter(c=>{
              if(!c.email)return false;
              const lastAct = c.activity?.length?Math.max(...c.activity.map(a=>new Date(a.ts||a.date||0).getTime())):0;
              return (c.score||0)<25&&(!lastAct||(now-lastAct)>30*24*60*60*1000);
            });
            if(!cold.length)return null;
            return (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{background:B.blueBg,border:`1px solid ${B.blue}30`,borderRadius:5,padding:"4px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.5}}>
                  {cold.length} COLD LEADS
                </div>
                <a href="/integrations" style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,textDecoration:"none"}}>Sync to Campaigns →</a>
              </div>
            );
          } catch { return null; }
        })()}/>
      <div style={{display:"flex",gap:7,marginBottom:18}}>
        {[["campaigns","Campaigns"],["creator","Ad Creator"],["saved","Saved Ads"],["calendar","Social Calendar"],["products","Products"],["assets","Assets"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{l}</button>
        ))}
      </div>

      {/* ── CAMPAIGNS ──────────────────────────────────────────────────────────── */}
      {tab==="campaigns"&&(
        <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:16}}>

          {/* Left: list */}
          <div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              <OBtn sm onClick={()=>setShowCreate(true)} style={{flex:1}}>+ NEW CAMPAIGN</OBtn>
            </div>
            <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
              {["","DRAFT","ACTIVE","PAUSED","COMPLETE"].map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)} style={{background:statusFilter===s?`${B.orange}14`:B.white,color:statusFilter===s?B.orange:B.muted,border:`1px solid ${statusFilter===s?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{s||"All"}</button>
              ))}
            </div>
            {campLoading&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.muted,fontSize:11,padding:"10px 0"}}><Spin/>Loading…</div>}
            {!campLoading&&campaigns.length===0&&(
              <div className="card" style={{padding:20,textAlign:"center",fontSize:11,color:B.muted,fontFamily:"'Lexend',sans-serif"}}>
                No campaigns yet. Create one to get started.
              </div>
            )}
            {campaigns.map(c=>(
              <div key={c.id} onClick={()=>loadCampaignDetail(c.id)} className="card fu" style={{padding:"11px 13px",marginBottom:8,borderLeft:`3px solid ${selCampId===c.id?B.orange:B.border}`,cursor:"pointer",background:selCampId===c.id?`${B.orange}06`:B.white}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,flex:1,marginRight:8}}>{c.name}</div>
                  <StatusPill status={c.status}/>
                </div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:5}}>{c.objective} · {(c.platforms||[]).join(", ")}</div>
                <div style={{display:"flex",gap:6}}>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c._count?.copies||0} copies</span>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:B.purpleBg,padding:"2px 5px",borderRadius:3}}>{c._count?.assets||0} assets</span>
                </div>
              </div>
            ))}
          </div>

          {/* Right: detail / create form */}
          <div>
            {showCreate&&(
              <div className="card" style={{padding:16,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>NEW CAMPAIGN</div>
                  <GBtn onClick={()=>setShowCreate(false)}>CANCEL</GBtn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  <div style={{gridColumn:"1/-1"}}>
                    <Lbl s={{marginBottom:4}}>Campaign Name *</Lbl>
                    <input value={createForm.name} onChange={e=>setCreateForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Spring Track 2026 — Meta" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>Objective</Lbl>
                    <select value={createForm.objective} onChange={e=>setCreateForm(f=>({...f,objective:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                      {AD_OBJECTIVES.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>Audience</Lbl>
                    <input value={createForm.audience} onChange={e=>setCreateForm(f=>({...f,audience:e.target.value}))} placeholder="Athletic Directors, K-12 coaches…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>Image Style</Lbl>
                    <select value={createForm.imageStyle} onChange={e=>setCreateForm(f=>({...f,imageStyle:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                      {AD_IMG_STYLES.map(o=><option key={o} value={o}>{o.replace("_"," ")}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>Scene Style</Lbl>
                    <select value={createForm.sceneStyle} onChange={e=>setCreateForm(f=>({...f,sceneStyle:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                      {AD_SCENE_STYLES.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>Variants / Product</Lbl>
                    <select value={createForm.variantsPerProduct} onChange={e=>setCreateForm(f=>({...f,variantsPerProduct:parseInt(e.target.value)}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>
                      {[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{marginBottom:12}}>
                  <Lbl s={{marginBottom:4}}>Platforms</Lbl>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {AD_PLATFORMS.map(p=>{
                      const sel=(createForm.platforms||[]).includes(p);
                      return <button key={p} onClick={()=>setCreateForm(f=>({...f,platforms:sel?f.platforms.filter(x=>x!==p):[...f.platforms,p]}))} style={{background:sel?`${B.orange}14`:B.white,color:sel?B.orange:B.muted,border:`1px solid ${sel?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{p}</button>;
                    })}
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <Lbl s={{marginBottom:4}}>Brief / Context</Lbl>
                  <textarea value={createForm.brief} onChange={e=>setCreateForm(f=>({...f,brief:e.target.value}))} rows={2} placeholder="Campaign objective, key messaging, special offers…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,resize:"vertical",fontFamily:"'Lexend',sans-serif"}}/>
                </div>
                <OBtn onClick={createCampaign} disabled={creating} style={{width:"100%"}}>
                  {creating?"CREATING...":"✓ CREATE CAMPAIGN"}
                </OBtn>
              </div>
            )}

            {detailLoading&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.muted,fontSize:12,padding:20}}><Spin/>Loading campaign…</div>}

            {selCamp&&!detailLoading&&(
              <div>
                {/* Header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,marginBottom:3}}>{selCamp.name}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{selCamp.objective} · {(selCamp.platforms||[]).join(", ")} · {selCamp.imageStyle?.replace("_"," ")} · {selCamp.sceneStyle}</div>
                    {selCamp.audience&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>Audience: {selCamp.audience}</div>}
                    {selCamp.brief&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginTop:6,maxWidth:500}}>{selCamp.brief}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                    <StatusPill status={selCamp.status}/>
                    <select value={selCamp.status} onChange={e=>updateStatus(selCamp.id,e.target.value)} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"4px 7px",fontSize:10}}>
                      {["DRAFT","ACTIVE","PAUSED","COMPLETE","ARCHIVED"].map(s=><option key={s}>{s}</option>)}
                    </select>
                    <GBtn onClick={()=>exportCSV(selCamp.id)} style={{fontSize:9}}>⬇ CSV</GBtn>
                  </div>
                </div>

                {/* Generate copy */}
                <div className="card" style={{padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>GENERATE AD COPY</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                    <div>
                      <Lbl s={{marginBottom:3}}>Product Name</Lbl>
                      <input value={copyProdName} onChange={e=>setCopyProdName(e.target.value)} placeholder="e.g. Blazer Hurdle H-28" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                    </div>
                    <div>
                      <Lbl s={{marginBottom:3}}>Product Price</Lbl>
                      <input value={copyProdPrice} onChange={e=>setCopyProdPrice(e.target.value)} placeholder="$149.99" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                    </div>
                    <div>
                      <Lbl s={{marginBottom:3}}>Description</Lbl>
                      <input value={copyProdDesc} onChange={e=>setCopyProdDesc(e.target.value)} placeholder="Short product description" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                    </div>
                  </div>
                  <OBtn onClick={generateCopy} disabled={genCopyRunning}>
                    {genCopyRunning?"✦ GENERATING COPY...":"✦ GENERATE AD COPY"}
                  </OBtn>
                </div>

                {/* Generate image — Ideogram */}
                <div className="card" style={{padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>GENERATE PRODUCT IMAGE (Ideogram AI)</div>
                  <div style={{marginBottom:8}}>
                    <Lbl s={{marginBottom:3}}>Describe the product / scene</Lbl>
                    <textarea value={imgProdName} onChange={e=>setImgProdName(e.target.value)} rows={2} placeholder="e.g. Aluminum hurdle with bright orange uprights on a professional track, cinematic lighting" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div>
                      <Lbl s={{marginBottom:3}}>Style</Lbl>
                      <select value={imgStyle} onChange={e=>setImgStyle(e.target.value)} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                        {["REALISTIC","DESIGN","GENERAL","ANIME","AUTO"].map(s=><option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <Lbl s={{marginBottom:3}}>Size</Lbl>
                      <select value={imgScene} onChange={e=>setImgScene(e.target.value)} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                        <option value="square">Square 1:1</option>
                        <option value="landscape">Landscape 16:9</option>
                        <option value="story">Story 9:16</option>
                      </select>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <OBtn onClick={generateImage} disabled={genImgRunning}>
                      {genImgRunning?"✦ GENERATING...":"✦ GENERATE IMAGE"}
                    </OBtn>
                    {lastImg&&(
                      <button onClick={()=>{setAdImg(lastImg.url);setTab("creator");toast("Image loaded into Ad Creator","success");}} style={{background:B.orangeBg,color:B.orange,border:`1px solid ${B.orange}`,borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>USE IN AD CREATOR →</button>
                    )}
                  </div>
                  {lastImg&&(
                    <div style={{marginTop:10}}>
                      <img src={lastImg.url} alt="Generated" style={{maxWidth:"100%",maxHeight:240,borderRadius:6,objectFit:"contain",border:`1px solid ${B.border}`}}/>
                    </div>
                  )}
                </div>

                {/* Copy list */}
                {(selCamp.copies||[]).length>0&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:8}}>AD COPY ({selCamp.copies.length})</div>
                    {selCamp.copies.map((c,i)=>(
                      <div key={c.id} className="card" style={{padding:12,marginBottom:8,borderLeft:`3px solid ${B.orange}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.5}}>
                            {c.product?.name||`Copy #${i+1}`}
                          </span>
                          <div style={{display:"flex",gap:5,alignItems:"center"}}>
                            {c.badge&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:B.redBg,padding:"1px 5px",borderRadius:2}}>{c.badge}</span>}
                            <button onClick={()=>loadCopyIntoCreator(c)} style={{background:B.orangeBg,color:B.orange,border:`1px solid ${B.orange}`,borderRadius:3,padding:"2px 7px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>→ AD CREATOR</button>
                          </div>
                        </div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:4}}>{c.headline}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>{c.subheadline} {c.cta&&`· CTA: ${c.cta}`}</div>
                        {[c.primary_text_v1,c.primary_text_v2,c.primary_text_v3].filter(Boolean).map((t,vi)=>(
                          <div key={vi} style={{background:B.surface,borderRadius:4,padding:"8px 10px",marginBottom:5,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6,display:"flex",justifyContent:"space-between",gap:8}}>
                            <div><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,marginRight:6}}>V{vi+1}</span>{t}</div>
                            <GBtn onClick={()=>navigator.clipboard?.writeText(t)} style={{fontSize:8,padding:"2px 6px",flexShrink:0}}>COPY</GBtn>
                          </div>
                        ))}
                        {(c.headline_v1||c.headline_v2)&&(
                          <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                            {[c.headline_v1,c.headline_v2].filter(Boolean).map((h,hi)=>(
                              <div key={hi} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"3px 8px",borderRadius:3,display:"flex",gap:5,alignItems:"center"}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted}}>H{hi+1}</span>{h}
                                <GBtn onClick={()=>navigator.clipboard?.writeText(h)} style={{fontSize:7,padding:"1px 4px"}}>⎘</GBtn>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Asset gallery */}
                {(selCamp.assets||[]).length>0&&(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>ASSETS ({selCamp.assets.length})</div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
                      {selCamp.assets.map(a=>{
                        const url=a.metadata?.url||(a.metadata?.b64?`data:${a.mimeType};base64,${a.metadata.b64}`:null);
                        return (
                          <div key={a.id} className="card" style={{padding:8,display:"flex",flexDirection:"column",gap:6}}>
                            {url?(
                              <img src={url} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:4}}/>
                            ):(
                              <div style={{width:"100%",aspectRatio:"1",background:B.surface,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>No preview</div>
                            )}
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5}}>{a.width}×{a.height} · {a.platform}</div>
                            {url&&<a href={url} download={`asset-${a.id}.png`} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.blue,textDecoration:"none"}}>⬇ Download</a>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(selCamp.copies||[]).length===0&&(selCamp.assets||[]).length===0&&(
                  <div className="card" style={{padding:20,textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
                    No copy or assets yet — use the Generate buttons above to get started.
                  </div>
                )}
              </div>
            )}

            {!selCamp&&!detailLoading&&!showCreate&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
                Select a campaign or create a new one
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AD CREATOR ─────────────────────────────────────────────────────────── */}
      {tab==="creator"&&(
        <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:20,alignItems:"start"}}>

          {/* Left: controls */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>

            {/* Template picker */}
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>TEMPLATE</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[["bold","Bold — Dark + Headline"],["clean","Clean — Centered"],["split","Split — Copy | Image"],["overlay","Overlay — Full Bleed"]].map(([id,label])=>(
                  <button key={id} onClick={()=>setAdTpl(id)} style={{background:adTpl===id?B.orange:B.surface,color:adTpl===id?B.white:B.text,border:`1px solid ${adTpl===id?B.orange:B.border}`,borderRadius:5,padding:"8px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",fontWeight:adTpl===id?700:400,cursor:"pointer",textAlign:"left"}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,letterSpacing:.5,marginBottom:2}}>{id.toUpperCase()}</div>
                    <div style={{fontSize:9,opacity:.7}}>{label.split("—")[1].trim()}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Size picker */}
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>SIZE</div>
              <div style={{display:"flex",gap:6}}>
                {[["square","1:1","1080×1080"],["landscape","16:9","1200×628"],["story","9:16","1080×1920"]].map(([id,ratio,dims])=>(
                  <button key={id} onClick={()=>setAdSz(id)} style={{flex:1,background:adSz===id?B.orange:B.surface,color:adSz===id?B.white:B.text,border:`1px solid ${adSz===id?B.orange:B.border}`,borderRadius:5,padding:"8px 6px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,letterSpacing:.5,marginBottom:1}}>{ratio}</div>
                    <div style={{fontSize:8,opacity:.65}}>{dims}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Text fields */}
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>AD TEXT</div>
              {selCamp&&(selCamp.copies||[]).length>0&&(
                <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
                  <select value={creatorCopyIdx} onChange={e=>setCreatorCopyIdx(Number(e.target.value))} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:10}}>
                    {(selCamp.copies||[]).map((c,i)=><option key={c.id} value={i}>{c.product?.name||`Copy #${i+1}`} — {c.headline?.slice(0,30)}</option>)}
                  </select>
                  <button onClick={()=>loadCopyIntoCreator(selCamp.copies[creatorCopyIdx])} style={{background:B.orangeBg,color:B.orange,border:`1px solid ${B.orange}`,borderRadius:4,padding:"5px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>LOAD</button>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div>
                  <Lbl s={{marginBottom:3}}>Headline</Lbl>
                  <input value={adHeadline} onChange={e=>setAdHeadline(e.target.value)} placeholder="TRAIN HARDER. WIN MORE." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif",fontWeight:600}}/>
                </div>
                <div>
                  <Lbl s={{marginBottom:3}}>Subheadline</Lbl>
                  <input value={adSub} onChange={e=>setAdSub(e.target.value)} placeholder="Supporting copy (optional)" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <Lbl s={{marginBottom:3}}>CTA Button</Lbl>
                    <input value={adCta} onChange={e=>setAdCta(e.target.value)} placeholder="SHOP NOW" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:3}}>Badge</Lbl>
                    <input value={adBadge} onChange={e=>setAdBadge(e.target.value)} placeholder="NEW · SALE · FREE SHIP" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                </div>
                <div>
                  <Lbl s={{marginBottom:3}}>Link URL (appended to social posts)</Lbl>
                  <input value={adUrl} onChange={e=>setAdUrl(e.target.value)} placeholder="https://st1sports.com/products/..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"monospace"}}/>
                </div>
              </div>
            </div>

            {/* Colors + logo */}
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>COLORS</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[["Background","adBg",adBg,setAdBg],["Text Color","adTc",adTc,setAdTc],["Accent Color","adAc",adAc,setAdAc]].map(([label,,val,setter])=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,width:90,flexShrink:0}}>{label}</div>
                    <input type="color" value={val} onChange={e=>setter(e.target.value)} style={{width:32,height:28,border:`1px solid ${B.border}`,borderRadius:4,cursor:"pointer",padding:2,background:B.surface}}/>
                    <input value={val} onChange={e=>setter(e.target.value)} maxLength={7} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"monospace"}}/>
                    <div style={{width:22,height:22,borderRadius:4,background:val,border:`1px solid ${B.border}`,flexShrink:0}}/>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10}}>
                <input type="checkbox" id="adlogo" checked={adLogo} onChange={e=>setAdLogo(e.target.checked)} style={{width:14,height:14,cursor:"pointer"}}/>
                <label htmlFor="adlogo" style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,cursor:"pointer"}}>{adLogoUrl?"Show brand logo ✓":"Show brand logo (upload below)"}</label>
              </div>
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,width:"100%",marginBottom:2}}>PRESETS</div>
                {[["Dark",["#0A0A0A","#FFFFFF","#F37321"]],["Light",["#FFFFFF","#0A0A0A","#F37321"]],["Navy",["#0B1A3E","#FFFFFF","#F37321"]],["Forest",["#1A3A2A","#FFFFFF","#4CAF50"]]].map(([name,[bg,tc,ac]])=>(
                  <button key={name} onClick={()=>{setAdBg(bg);setAdTc(tc);setAdAc(ac);}} style={{background:bg,color:tc,border:`2px solid ${ac}`,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{name}</button>
                ))}
              </div>
            </div>

            {/* Brand Assets */}
            <div className="card" style={{padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>BRAND ASSETS</div>
                <button onClick={()=>brandAssetRef.current?.click()} style={{background:B.orangeBg,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.5}}>+ UPLOAD</button>
                <input ref={brandAssetRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={async e=>{
                  const files=[...e.target.files];
                  for(const f of files){
                    const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});
                    const isLogo=/logo/i.test(f.name);
                    dispatch("ADD_BRAND_ASSET",{id:mkId(),name:f.name,url:dataUrl,type:isLogo?"logo":"asset",createdAt:new Date().toISOString().slice(0,10)});
                  }
                  e.target.value="";
                  toast(`Uploaded ${files.length} asset${files.length>1?"s":""}!`,"success");
                }}/>
              </div>
              {(s.brandAssets||[]).length===0&&(
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",padding:"10px 0"}}>No assets yet — upload logos, product shots, or brand images</div>
              )}
              {(s.brandAssets||[]).length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                  {(s.brandAssets||[]).map(a=>{
                    const isLogoSel=adLogoUrl===a.url;
                    const isImgSel=adImg===a.url;
                    return(
                      <div key={a.id} style={{position:"relative",borderRadius:6,overflow:"hidden",border:`2px solid ${isLogoSel?B.orange:isImgSel?B.blue:B.border}`,background:B.surface}}>
                        <img src={a.url} alt={a.name} style={{width:"100%",height:56,objectFit:"contain",display:"block",background:"#111",padding:4}}/>
                        <div style={{padding:"3px 4px"}}>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name.replace(/\.[^.]+$/,"")}</div>
                          <div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>
                            <button onClick={()=>{setAdLogoUrl(isLogoSel?"":a.url);if(!isLogoSel)setAdLogo(true);}} style={{background:isLogoSel?B.orange:B.orangeBg,color:isLogoSel?B.white:B.orange,border:`1px solid ${B.orange}40`,borderRadius:3,padding:"2px 4px",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>LOGO</button>
                            <button onClick={()=>setAdImg(isImgSel?"":a.url)} style={{background:isImgSel?B.blue:B.blueBg,color:isImgSel?B.white:B.blue,border:`1px solid ${B.blue}40`,borderRadius:3,padding:"2px 4px",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>IMG</button>
                            <button onClick={()=>{if(adLogoUrl===a.url)setAdLogoUrl("");if(adImg===a.url)setAdImg("");dispatch("DELETE_BRAND_ASSET",a.id);}} style={{background:"none",border:"none",color:B.muted,fontSize:8,cursor:"pointer",padding:"2px 3px",marginLeft:"auto"}}>✕</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {(s.brandAssets||[]).length>0&&(
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:8}}>
                  Click <span style={{color:B.orange}}>LOGO</span> to use as brand logo · <span style={{color:B.blue}}>IMG</span> to use as background/product image
                </div>
              )}
            </div>

            {/* Image source */}
            <div className="card" style={{padding:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>PRODUCT IMAGE (Ideogram AI)</div>
              <textarea value={ideoPrompt} onChange={e=>setIdeoPrompt(e.target.value)} rows={3} placeholder="Describe what the image should show… e.g. 'Aluminum track hurdle on an Olympic running track, cinematic lighting, product photo'" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",marginBottom:8}}/>
              <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                <select value={ideoStyle} onChange={e=>setIdeoStyle(e.target.value)} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                  {["REALISTIC","DESIGN","GENERAL","ANIME","AUTO"].map(s=><option key={s}>{s}</option>)}
                </select>
                <OBtn onClick={generateIdeogramImage} disabled={ideoRunning} style={{flexShrink:0}}>
                  {ideoRunning?"GENERATING...":"✦ GENERATE"}
                </OBtn>
              </div>
              {ideoResult&&(
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <img src={ideoResult.imageUrl} alt="Generated" style={{width:80,height:80,objectFit:"cover",borderRadius:6,border:`1px solid ${B.border}`,flexShrink:0}}/>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    <button onClick={()=>setAdImg(ideoResult.imageUrl)} style={{background:adImg===ideoResult.imageUrl?B.orange:B.orangeBg,color:adImg===ideoResult.imageUrl?B.white:B.orange,border:`1px solid ${B.orange}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>
                      {adImg===ideoResult.imageUrl?"✓ IN USE":"USE IN AD"}
                    </button>
                    <button onClick={()=>setAdImg("")} style={{background:"none",border:"none",color:B.muted,fontSize:9,cursor:"pointer",fontFamily:"'Lexend',sans-serif",textAlign:"left"}}>Clear image</button>
                  </div>
                </div>
              )}
              <div style={{marginTop:10}}>
                <Lbl s={{marginBottom:3}}>Or paste any image URL</Lbl>
                <input value={adImg} onChange={e=>setAdImg(e.target.value)} placeholder="https://…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:10,fontFamily:"monospace"}}/>
              </div>
            </div>

          </div>

          {/* Right: live preview */}
          <div style={{position:"sticky",top:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>LIVE PREVIEW</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,textDecoration:"none"}}>Open full size ↗</a>
                <OBtn onClick={downloadAd} disabled={downloadRunning} style={{padding:"6px 14px"}}>
                  {downloadRunning?"DOWNLOADING...":"⬇ DOWNLOAD PNG"}
                </OBtn>
                <button onClick={()=>{
                  const name=adHeadline||"Untitled Ad";
                  dispatch("ADD_SAVED_AD",{id:mkId(),name,tpl:adTpl,sz:adSz,headline:adHeadline,sub:adSub,cta:adCta,badge:adBadge,bg:adBg,tc:adTc,ac:adAc,logo:adLogo,logoUrl:adLogoUrl,img:adImg,url:adUrl,createdAt:today()});
                  toast(`"${name}" saved!`,"success");
                }} style={{background:B.white,color:B.green,border:`1px solid ${B.green}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",letterSpacing:.4}}>
                  ✦ SAVE AD
                </button>
                <button onClick={openSocialPanel} style={{background:showSocialPanel?`${B.purple}14`:B.white,color:B.purple,border:`1px solid ${B.purple}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",letterSpacing:.4}}>
                  📣 POST TO SOCIAL
                </button>
              </div>
            </div>

            <div style={{background:"#111",borderRadius:10,padding:12,display:"flex",alignItems:"center",justifyContent:"center",minHeight:300}}>
              <AdPreview tpl={adTpl} sz={adSz} headline={adHeadline||"YOUR HEADLINE"} sub={adSub} cta={adCta} badge={adBadge} img={adImg} bg={adBg} tc={adTc} ac={adAc} logo={adLogo} logoUrl={adLogoUrl} maxH={adSz==="story"?560:adSz==="landscape"?320:440}/>
            </div>

            <div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center"}}>
              Preview updates automatically · {adTpl.toUpperCase()} template · {adSz === "square" ? "1080×1080" : adSz === "landscape" ? "1200×628" : "1080×1920"}
            </div>

            {/* Post to Social Panel */}
            {showSocialPanel&&(
              <div className="card" style={{padding:16,marginTop:12,borderTop:`3px solid ${B.purple}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black}}>POST TO SOCIAL</div>
                  <button onClick={()=>{setShowSocialPanel(false);setSocialResult(null);}} style={{background:"none",border:"none",color:B.muted,fontSize:16,cursor:"pointer"}}>✕</button>
                </div>

                {/* Platform picker */}
                <div style={{marginBottom:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:6}}>PLATFORMS</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {[
                      {id:"twitter",label:"𝕏",name:"Twitter/X",color:"#000"},
                      {id:"linkedin",label:"in",name:"LinkedIn",color:"#0A66C2"},
                      {id:"instagram",label:"IG",name:"Instagram",color:"#E1306C"},
                      {id:"facebook",label:"f",name:"Facebook",color:"#1877F2"},
                      {id:"tiktok",label:"TT",name:"TikTok",color:"#000"},
                    ].map(({id,label,name,color})=>{
                      const sel=socialPlatforms.includes(id);
                      return(
                        <button key={id} onClick={()=>setSocialPlatforms(p=>sel?p.filter(x=>x!==id):[...p,id])}
                          style={{background:sel?`${color}14`:B.surface,color:sel?color:B.muted,border:`1.5px solid ${sel?color:B.border}`,borderRadius:5,padding:"5px 12px",fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:sel?700:400}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10}}>{label}</span> {name}{sel&&<span style={{marginLeft:4}}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Post type */}
                <div style={{marginBottom:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:6}}>POST TYPE</div>
                  <div style={{display:"flex",gap:6}}>
                    {[["post","Post"],["story","Story"],["ad","Ad (Meta/Google)"]].map(([id,label])=>(
                      <button key={id} onClick={()=>setSocialPostType(id)}
                        style={{background:socialPostType===id?B.purple:B.surface,color:socialPostType===id?B.white:B.muted,border:`1px solid ${socialPostType===id?B.purple:B.border}`,borderRadius:5,padding:"5px 14px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:socialPostType===id?700:400}}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {socialPostType==="ad"&&(
                    <div style={{marginTop:8,background:"#f0f4ff",border:"1px solid #c5d0f0",borderRadius:6,padding:"10px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#354080",lineHeight:1.6}}>
                      <strong>Ad Manager links:</strong>&nbsp;
                      <a href="https://adsmanager.facebook.com" target="_blank" rel="noreferrer" style={{color:"#1877F2",fontWeight:700,marginRight:10}}>Meta Ads ↗</a>
                      <a href="https://ads.google.com" target="_blank" rel="noreferrer" style={{color:"#4285F4",fontWeight:700}}>Google Ads ↗</a>
                      <div style={{marginTop:4,fontSize:10,color:"#667"}}>Download your ad image below and upload it directly in Ads Manager. The caption and URL below are ready to copy.</div>
                    </div>
                  )}
                </div>

                {/* Caption + AI copy */}
                <div style={{marginBottom:12}}>
                  <CaptionEditor caption={socialCaption} onCaption={setSocialCaption} onGenerate={generatePlatformCopy} generating={copyGenRunning} generatedCopies={generatedCopies} toast={toast}/>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,marginTop:3}}>
                    {socialCaption.length} chars · {adImg?"📎 image attached":"no image"}{adUrl&&" · 🔗 link included"}
                  </div>
                </div>

                {/* Schedule + URL */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:4}}>SCHEDULE (leave blank = post now)</div>
                    <input type="datetime-local" value={socialScheduleAt} onChange={e=>setSocialScheduleAt(e.target.value)}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:4}}>LINK URL</div>
                    <input value={adUrl} onChange={e=>setAdUrl(e.target.value)} placeholder="https://st1sports.com/…"
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"monospace"}}/>
                  </div>
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <button onClick={submitSocialPost} disabled={socialPosting||!socialPlatforms.length||!socialCaption.trim()}
                    style={{background:socialPosting||!socialPlatforms.length||!socialCaption.trim()?B.muted:B.purple,color:B.white,border:"none",borderRadius:5,padding:"9px 20px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:.5}}>
                    {socialPosting?"POSTING…":socialScheduleAt?"🗓 SCHEDULE POST":"📣 POST NOW"}
                  </button>
                  {adImg&&<a href={adImg} download="st1-ad.png" style={{background:B.surface,color:B.text,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,textDecoration:"none",letterSpacing:.5}}>⬇ DOWNLOAD IMAGE</a>}
                  {socialResult?.ok&&socialResult.failedNets?.length===0&&<span style={{color:B.green,fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:600}}>{socialScheduleAt?"✓ Scheduled!":"✓ Posted!"}</span>}
                  {socialResult?.ok&&socialResult.failedNets?.length>0&&<span style={{color:B.yellow,fontFamily:"'Lexend',sans-serif",fontSize:10}}>⚠ Partial — failed: {socialResult.failedNets.join(", ")}</span>}
                  {socialResult?.error&&<span style={{color:B.red,fontFamily:"'Lexend',sans-serif",fontSize:10}}>✗ {socialResult.error.slice(0,100)}</span>}
                </div>

                {/* No API key warning */}
                {socialResult?.error?.includes("AYRSHARE_API_KEY")&&(
                  <div style={{marginTop:10,background:"#fff3cd",border:"1px solid #f0ad0060",borderRadius:6,padding:"10px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#7a4f00",lineHeight:1.6}}>
                    <strong>Ayrshare not connected.</strong> Get a free API key at{" "}
                    <a href="https://app.ayrshare.com" target="_blank" rel="noreferrer" style={{color:"#c47a00",fontWeight:700}}>app.ayrshare.com</a>,
                    then add <code style={{background:"#ffe8a0",padding:"1px 5px",borderRadius:3}}>AYRSHARE_API_KEY</code> to your Vercel environment variables and redeploy.
                  </div>
                )}
              </div>
            )}

            {/* Quick text presets */}
            <div className="card" style={{padding:12,marginTop:12}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:8}}>QUICK COPY PRESETS</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {[
                  ["Track & Field","BUILT FOR CHAMPIONS","Competition-grade equipment for serious athletes","SHOP NOW","NEW"],
                  ["School Sports","EQUIP YOUR TEAM","ST1 Sports — trusted by coaches nationwide","GET A QUOTE",""],
                  ["Hurdles","CLEAR EVERY BAR","Professional hurdles. Championship results.","SHOP HURDLES",""],
                  ["Sale","LIMITED TIME OFFER","Save big on top-rated athletic equipment","SAVE NOW","SALE"],
                ].map(([name,h,s,c,b])=>(
                  <button key={name} onClick={()=>{setAdHeadline(h);setAdSub(s);setAdCta(c);setAdBadge(b);}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",textAlign:"left",color:B.text}}>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5}}>{name}</span> — {h}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── PRODUCTS ───────────────────────────────────────────────────────────── */}
      {tab==="products"&&(
        <div>
          <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center"}}>
            <input value={prodSearch} onChange={e=>setProdSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loadProducts(prodSearch)} placeholder="Search products…" style={{flex:1,maxWidth:280,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
            <GBtn onClick={()=>loadProducts(prodSearch)} style={{padding:"7px 14px"}}>SEARCH</GBtn>
            <OBtn onClick={syncCatalog} disabled={syncing}>{syncing?"SYNCING...":"⟳ SYNC FROM WOOCOMMERCE"}</OBtn>
          </div>
          {prodLoading&&<div style={{display:"flex",gap:7,alignItems:"center",color:B.muted,fontSize:11}}><Spin/>Loading…</div>}
          {!prodLoading&&products.length===0&&(
            <div className="card" style={{padding:20,textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
              No products in catalog. Sync from WooCommerce or add WC_URL, WC_KEY, WC_SECRET to your Vercel env vars.
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
            {products.map(p=>(
              <div key={p.id} className="card fu" style={{padding:10}}>
                {p.main_image_url&&<img src={p.main_image_url} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:4,marginBottom:8}}/>}
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:3}}>{p.name}</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:p.sale_price?B.red:B.muted}}>
                  {p.sale_price?<><s style={{color:B.muted}}>${p.price}</s> ${p.sale_price}</>:p.price?`$${p.price}`:"—"}
                </div>
                <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:p.stock_status==="instock"?B.green:B.red,background:p.stock_status==="instock"?B.greenBg:B.redBg,padding:"1px 5px",borderRadius:2}}>{p.stock_status}</span>
                  {p.on_sale&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,padding:"1px 5px",borderRadius:2}}>SALE</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ASSETS ─────────────────────────────────────────────────────────────── */}
      {tab==="saved"&&(
        <SavedAdsPanel
          savedAds={s.savedAds||[]}
          onLoad={ad=>{setAdTpl(ad.tpl||"bold");setAdSz(ad.sz||"square");setAdHeadline(ad.headline||"");setAdSub(ad.sub||"");setAdCta(ad.cta||"");setAdBadge(ad.badge||"");setAdBg(ad.bg||"#0A0A0A");setAdTc(ad.tc||"#FFFFFF");setAdAc(ad.ac||"#F37321");setAdLogo(ad.logo!==false);setAdLogoUrl(ad.logoUrl||"");setAdImg(ad.img||"");setAdUrl(ad.url||"");setTab("creator");toast(`Loaded "${ad.name}"`, "success");}}
          onDelete={id=>dispatch("DELETE_SAVED_AD",id)}
        />
      )}

      {tab==="calendar"&&(
        <SocialCalendar
          posts={s.socialPosts||[]}
          onAdd={post=>dispatch("ADD_SOCIAL_POST",{id:mkId(),createdAt:today(),...post})}
          onUpdate={post=>dispatch("UPDATE_SOCIAL_POST",post)}
          onDelete={id=>dispatch("DELETE_SOCIAL_POST",id)}
          toast={toast}
        />
      )}

      {tab==="assets"&&(
        <AssetGallery toast={toast}/>
      )}
    </div>
  );
}

// ─── CAPTION EDITOR + AI COPY GENERATOR ───────────────────────────────────────
function CaptionEditor({caption, onCaption, onGenerate, generating, generatedCopies, toast}) {
  const NETS = [{id:"twitter",label:"𝕏",color:"#000"},{id:"linkedin",label:"in",color:"#0A66C2"},{id:"instagram",label:"IG",color:"#E1306C"},{id:"facebook",label:"f",color:"#1877F2"}];
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Lbl>CAPTION</Lbl>
        <button onClick={onGenerate} disabled={generating} style={{background:generating?B.surface:B.orange,color:generating?B.muted:B.white,border:"none",borderRadius:4,padding:"4px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:generating?"default":"pointer",letterSpacing:.5}}>
          {generating?"GENERATING…":"✦ AI COPY"}
        </button>
      </div>
      <textarea value={caption} onChange={e=>onCaption(e.target.value)} rows={3}
        style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",boxSizing:"border-box"}}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>{caption.length} chars</div>
        <button onClick={()=>{navigator.clipboard.writeText(caption);toast("Copied!","success");}} style={{background:"none",border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"3px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer"}}>⎘ COPY</button>
      </div>
      {generatedCopies&&(
        <div style={{marginTop:10,background:B.surface,borderRadius:6,padding:10,border:`1px solid ${B.border}`}}>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:8}}>AI GENERATED — click to use</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {NETS.map(({id,label,color})=>generatedCopies[id]&&(
              <div key={id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"7px 9px",background:B.white,borderRadius:5,border:`1px solid ${B.border}`,cursor:"pointer"}}
                onClick={()=>{onCaption(generatedCopies[id]);toast(`${label} copy loaded`,"success");}}>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color,minWidth:18,fontWeight:700}}>{label}</span>
                <div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.4}}>{generatedCopies[id].slice(0,180)}{generatedCopies[id].length>180?"…":""}</div>
                <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(generatedCopies[id]);toast("Copied!","success");}} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",flexShrink:0,padding:0}}>⎘</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SAVED ADS PANEL ──────────────────────────────────────────────────────────
function SavedAdsPanel({savedAds, onLoad, onDelete}) {
  if (!savedAds.length) return (
    <div className="card" style={{padding:24,textAlign:"center",color:B.muted,fontFamily:"'Lexend',sans-serif",fontSize:11}}>
      No saved ads yet — design an ad in the Ad Creator and click <strong>✦ SAVE AD</strong> to save it here.
    </div>
  );
  const SZ_LABELS = {square:"1080×1080",landscape:"1200×628",story:"1080×1920"};
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
      {savedAds.map(ad=>(
        <div key={ad.id} className="card" style={{padding:0,overflow:"hidden"}}>
          {/* Mini preview */}
          <div style={{height:120,background:ad.bg||"#0A0A0A",display:"flex",alignItems:"center",justifyContent:"center",padding:12,position:"relative"}}>
            <div style={{fontFamily:"system-ui",fontWeight:900,color:ad.tc||"#fff",fontSize:18,lineHeight:1.1,textAlign:"center",maxWidth:"90%",overflow:"hidden"}}>{(ad.headline||"").slice(0,40)}</div>
            {ad.badge&&<div style={{position:"absolute",top:8,right:8,background:ad.ac||"#F37321",color:"#fff",fontSize:9,fontWeight:800,padding:"3px 7px",borderRadius:3}}>{ad.badge}</div>}
          </div>
          <div style={{padding:"10px 12px"}}>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ad.name}</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:8}}>{(ad.tpl||"bold").toUpperCase()} · {SZ_LABELS[ad.sz]||ad.sz} · {ad.createdAt}</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>onLoad(ad)} style={{flex:1,background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 0",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",letterSpacing:.5}}>LOAD</button>
              <button onClick={()=>{if(window.confirm("Delete this saved ad?"))onDelete(ad.id);}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:4,padding:"6px 10px",fontSize:10,cursor:"pointer"}}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SOCIAL CALENDAR ──────────────────────────────────────────────────────────
function SocialCalendar({posts, onAdd, onUpdate, onDelete, toast}) {
  const today2 = new Date();
  const [viewYear, setViewYear] = useState(today2.getFullYear());
  const [viewMonth, setViewMonth] = useState(today2.getMonth());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({date:"",time:"09:00",platforms:[],caption:"",imageUrl:"",status:"draft"});

  const NET_COLORS = {twitter:"#000",linkedin:"#0A66C2",instagram:"#E1306C",facebook:"#1877F2"};
  const NET_LABELS = {twitter:"𝕏",linkedin:"in",instagram:"IG",facebook:"f"};

  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = today2.toISOString().slice(0,10);

  const openNew = (dateStr) => {
    setEditing(null);
    setForm({date:dateStr||"",time:"09:00",platforms:[],caption:"",imageUrl:"",status:"draft"});
    setShowForm(true);
  };
  const openEdit = (post) => {
    setEditing(post.id);
    setForm({date:post.date||"",time:post.time||"09:00",platforms:post.platforms||[],caption:post.caption||"",imageUrl:post.imageUrl||"",status:post.status||"draft"});
    setShowForm(true);
  };
  const save = () => {
    if (!form.date||!form.caption.trim()) { toast("Date and caption required","error"); return; }
    if (editing) onUpdate({id:editing,...form});
    else onAdd(form);
    setShowForm(false);
  };
  const toggleNet = (n) => setForm(f=>({...f,platforms:f.platforms.includes(n)?f.platforms.filter(x=>x!==n):[...f.platforms,n]}));

  const monthName = new Date(viewYear,viewMonth).toLocaleString("en-US",{month:"long",year:"numeric"});

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{let m=viewMonth-1,y=viewYear;if(m<0){m=11;y--;}setViewMonth(m);setViewYear(y);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:12}}>‹</button>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,minWidth:160,textAlign:"center"}}>{monthName.toUpperCase()}</div>
          <button onClick={()=>{let m=viewMonth+1,y=viewYear;if(m>11){m=0;y++;}setViewMonth(m);setViewYear(y);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:12}}>›</button>
        </div>
        <OBtn sm onClick={()=>openNew(todayStr)}>+ NEW POST</OBtn>
      </div>

      {/* Calendar grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:B.border,borderRadius:8,overflow:"hidden",marginBottom:16}}>
        {["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=>(
          <div key={d} style={{background:B.surface,padding:"6px 0",textAlign:"center",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>{d}</div>
        ))}
        {Array.from({length:firstDay}).map((_,i)=>(
          <div key={`e${i}`} style={{background:B.surface,minHeight:80}}/>
        ))}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const d = i+1;
          const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const dayPosts = posts.filter(p=>p.date===dateStr);
          const isToday = dateStr===todayStr;
          return (
            <div key={d} onClick={()=>openNew(dateStr)} style={{background:B.white,minHeight:80,padding:6,cursor:"pointer",position:"relative"}}
              onMouseEnter={e=>e.currentTarget.style.background=B.surface} onMouseLeave={e=>e.currentTarget.style.background=B.white}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:isToday?B.orange:B.text,fontWeight:isToday?700:400,marginBottom:4,display:"inline-block",
                ...(isToday?{background:B.orange,color:B.white,borderRadius:"50%",width:20,height:20,lineHeight:"20px",textAlign:"center",fontSize:10}:{})}}>{d}</div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {dayPosts.map(p=>(
                  <div key={p.id} onClick={e=>{e.stopPropagation();openEdit(p);}}
                    style={{background:p.status==="published"?B.greenBg:p.status==="scheduled"?B.blueBg:B.orangeBg,borderRadius:3,padding:"2px 5px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:p.status==="published"?B.green:p.status==="scheduled"?B.blue:B.orange,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {(p.platforms||[]).map(n=><span key={n} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:NET_COLORS[n],marginRight:2}}>{NET_LABELS[n]}</span>)}
                    {p.caption.slice(0,25)}{p.caption.length>25?"…":""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Post form modal */}
      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowForm(false)}>
          <div style={{background:B.white,borderRadius:10,padding:22,width:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>{editing?"EDIT POST":"NEW POST"}</div>
              <button onClick={()=>setShowForm(false)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:B.muted}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div><Lbl s={{marginBottom:3}}>DATE</Lbl><input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12}}/></div>
              <div><Lbl s={{marginBottom:3}}>TIME</Lbl><input type="time" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12}}/></div>
            </div>
            <div style={{marginBottom:12}}>
              <Lbl s={{marginBottom:6}}>PLATFORMS</Lbl>
              <div style={{display:"flex",gap:7}}>
                {Object.entries(NET_LABELS).map(([id,label])=>{
                  const sel=form.platforms.includes(id);
                  const c=NET_COLORS[id];
                  return <button key={id} onClick={()=>toggleNet(id)} style={{background:sel?`${c}14`:B.surface,color:sel?c:B.muted,border:`1px solid ${sel?c:B.border}`,borderRadius:5,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,cursor:"pointer"}}>{label}</button>;
                })}
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <Lbl s={{marginBottom:3}}>CAPTION</Lbl>
              <textarea value={form.caption} onChange={e=>setForm(f=>({...f,caption:e.target.value}))} rows={4} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:14}}>
              <Lbl s={{marginBottom:3}}>STATUS</Lbl>
              <div style={{display:"flex",gap:7}}>
                {[["draft","Draft",B.orange],["scheduled","Scheduled",B.blue],["published","Published",B.green]].map(([v,l,c])=>(
                  <button key={v} onClick={()=>setForm(f=>({...f,status:v}))} style={{flex:1,background:form.status===v?`${c}14`:B.surface,color:form.status===v?c:B.muted,border:`1px solid ${form.status===v?c:B.border}`,borderRadius:4,padding:"6px 0",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer"}}>{l.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <OBtn onClick={save} style={{flex:1}}>{editing?"SAVE CHANGES":"CREATE POST"}</OBtn>
              {editing&&<button onClick={()=>{if(window.confirm("Delete this post?"))onDelete(editing);setShowForm(false);}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:5,padding:"8px 14px",fontSize:11,cursor:"pointer"}}>Delete</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetGallery({toast}) {
  const [assets,setAssets]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    fetch("/api/adengine/assets?limit=100")
      .then(r=>r.json())
      .then(d=>setAssets(d.assets||[]))
      .catch(()=>toast("Failed to load assets","error"))
      .finally(()=>setLoading(false));
  },[]);

  const del=async(id)=>{
    if(!confirm("Delete this asset?"))return;
    await fetch(`/api/adengine/assets?id=${id}`,{method:"DELETE"});
    setAssets(a=>a.filter(x=>x.id!==id));
    toast("Asset deleted","success");
  };

  if(loading) return <div style={{display:"flex",gap:7,alignItems:"center",color:B.muted,fontSize:12,padding:20}}><Spin/>Loading assets…</div>;
  if(!assets.length) return <div className="card" style={{padding:20,textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No generated assets yet. Go to Campaigns and generate images.</div>;

  return (
    <div>
      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:12}}>{assets.length} assets</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {assets.map(a=>{
          const url=a.displayUrl;
          return (
            <div key={a.id} className="card" style={{padding:10}}>
              {url
                ? <img src={url} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:4,marginBottom:8}}/>
                : <div style={{width:"100%",aspectRatio:"1",background:B.surface,borderRadius:4,marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>Stored on S3</div>
              }
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,marginBottom:3}}>{a.product?.name||"—"}</div>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:6}}>{a.width}×{a.height} · {a.platform} · {a.variant}</div>
              <div style={{display:"flex",gap:5}}>
                {url&&<a href={url} download={`asset-${a.id}.png`} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.blue,textDecoration:"none"}}>⬇</a>}
                <button onClick={()=>del(a.id)} style={{background:"none",border:"none",color:B.red,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>✕ Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPETE
// ════════════════════════════════════════════════════════════════════════════
function ModCompete() {
  const {s,dispatch}=useApp();
  const COMPS=["BSN Sports","VS Athletics","MF Athletic","School Specialty","Varsity Group","Gopher Sport","Anderson's","Epic Sports"];
  const [sel,setSel]=useState(null);
  const intel=s.competeIntel||{};
  const bc=s.battlecards||{};
  const [running,setRunning]=useState(null);
  const [bcRunning,setBcRunning]=useState(null);

  const research=async(comp)=>{
    setSel(comp);if(intel[comp])return;
    setRunning(comp);
    const t=await aiCall(`Research ${comp} as a competitor to ST1 Sports. ${ST1}. Provide: what they focus on, strengths, weaknesses vs ST1, pricing approach, strongest states, and how ST1 can counter them. Be specific and tactical.`,{search:true});
    dispatch("SET_COMPETE_INTEL",{[comp]:t||""});setRunning(null);
  };
  const genBc=async(comp)=>{
    setBcRunning(comp);
    const r=await aiCall(`Sales battlecard for ST1 Sports vs ${comp}. ${ST1}. Return JSON: {"competitor":"","our_strengths":["3 items"],"their_strengths":["2 items"],"key_messages":["3 messages"],"objection_handlers":[{"objection":"","response":""}]}`,{json:true});
    dispatch("SET_BATTLECARD",{[comp]:r});setBcRunning(null);
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
  const {s,dispatch,toast,cu,setMod}=useApp();
  const history=s.agentHistory||[];
  const setHistory=(fn)=>dispatch("SET_AGENT_HISTORY", typeof fn==="function"?fn(history):fn);
  const [input,setInput]=useState("");
  const [running,setRunning]=useState(false);
  const [expandedEmail,setExpandedEmail]=useState(null);
  const [agentStatus,setAgentStatus]=useState(null); // "thinking"|"searching"|"zoho"|null
  const [lastMeta,setLastMeta]=useState(null); // {liveZoho,searchUsed}
  const [sendingEmail,setSendingEmail]=useState(null); // action key being sent
  const endRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[history]);
  useEffect(()=>{
    if(s.agentDraft){setInput(s.agentDraft);dispatch("SET_AGENT_DRAFT","");}
  },[s.agentDraft]);

  const buildContext=()=>{
    const openDeals=s.deals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
    const pipeline=openDeals.reduce((a,d)=>a+d.value,0);
    const ar=s.invoices.filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);
    const overdue=openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0);
    const hot=openDeals.filter(d=>d.priority==="hot");
    const activeRfps=s.rfps.filter(r=>!["No Bid","Lost","Won"].includes(r.stage));
    const reachableContacts=(s.contacts||[]).filter(c=>c.email).slice(0,30);
    const activeCampaigns=(s.sequences||[]).filter(seq=>seq.status==="active");
    const topContacts=[...(s.contacts||[])].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,6);
    const recentActivity=(s.activity||[]).slice(-5);
    const competitors=Object.keys(s.competeIntel||{});

    return `You are the ST1 Sports RevOps AI Agent — a senior sales & outreach strategist.
${ST1}
Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
User: ${cu?.name||"Matt"} (${cu?.role||"owner"})

=== PIPELINE ===
${openDeals.length} open deals · ${fmt$(pipeline)} total · ${overdue.length} overdue · ${hot.length} hot 🔥
${overdue.length>0?`OVERDUE: ${overdue.slice(0,5).map(d=>`${d.name} (${Math.abs(dUntil(d.followUpDate))}d)`).join(", ")}\n`:""}${openDeals.slice(0,12).map(d=>`· ${d.name} — ${d.stage} — ${fmt$(d.value)}${d.followUpDate?` — due ${d.followUpDate}`:""}${d.priority==="hot"?" 🔥":""}`).join("\n")}

=== TOP CONTACTS (by lead score) ===
${topContacts.length===0?"No scored contacts":`${topContacts.map(c=>`· ${c.fullName||c.firstName} (${c.score||0}pts) — ${c.title}, ${c.school}, ${c.state} — ${c.sport||"?"} — ${c.email||"no email"}`).join("\n")}`}
${reachableContacts.length} contacts with email | Sports: ${[...new Set((s.contacts||[]).map(c=>c.sport).filter(Boolean))].join(", ")||"none"}

=== ACTIVE CAMPAIGNS ===
${activeCampaigns.length===0?"None":`${activeCampaigns.map(seq=>`· "${seq.name}" (${seq.product}) — ${seq.enrollments?.filter(e=>e.status==="active").length||0} active, ${seq.enrollments?.filter(e=>e.status==="replied").length||0} replied`).join("\n")}`}

=== OPEN RFPS ===
${activeRfps.length===0?"None":`${activeRfps.map(r=>`· ${r.name} — ${r.stage}${r.dueDate?` — due ${r.dueDate}`:""}`).join("\n")}`}

=== AR ===
${fmt$(ar)} outstanding${s.invoices.filter(i=>i.status==="overdue").length>0?` — ${s.invoices.filter(i=>i.status==="overdue").length} overdue`:""}

${recentActivity.length>0?`=== RECENT ACTIVITY ===\n${recentActivity.map(a=>`· ${a.msg||""}`).join("\n")}\n`:""}${competitors.length>0?`=== KNOWN COMPETITORS ===\n${competitors.slice(0,5).join(", ")}\n`:""}
=== ACTIONS YOU CAN TAKE ===
Include an "actions" array when taking real action:
· draft_email: {type:"draft_email",to_name,to_email,subject,body}
· create_deal: {type:"create_deal",name,org,value,stage,product,contact_name?}
· flag_deal: {type:"flag_deal",deal_name,priority:"hot"|"warm"}
· schedule_followup: {type:"schedule_followup",deal_name,date:"YYYY-MM-DD",note?}
· log_note: {type:"log_note",deal_name,note}
· add_contact: {type:"add_contact",firstName,lastName,title,school,state,email?,phone?,sport?}
· create_campaign: {type:"create_campaign",name,product,audience,channel}

Also include "suggestions": 3 short follow-up questions the user might want to ask next.

ALWAYS respond: {"message":"text","actions":[],"suggestions":["...","...","..."]}
Be specific, tactical, use real names. Flag hot signals with 🔥.`;
  };

  const copyEmail=(action)=>{
    const text=`To: ${action.to_name} <${action.to_email||"(find email)"}>\nSubject: ${action.subject}\n\n${action.body}`;
    try{navigator.clipboard.writeText(text);}catch{}
    toast("Email copied to clipboard","success");
    dispatch("LOG",{msg:`Agent drafted email to ${action.to_name}`});
  };

  const executeAction=async(action,msgIdx,actionIdx)=>{
    if(action.type==="draft_email"){
      const key=`${msgIdx}_${actionIdx}`;
      setExpandedEmail(e=>e===key?null:key);
      return;
    }
    if(action.type==="create_deal"){
      const newDeal={id:mkId(),name:action.name||action.org,school:action.org,value:parseFloat(action.value)||0,stage:action.stage||"Quoted",product:action.product||"",priority:"warm",createdAt:today(),followUpDate:"",notes:action.note||""};
      dispatch("ADD_DEAL",newDeal);
      toast(`Deal created: ${newDeal.name}`,"success");
      // Sync to Zoho CRM
      try{
        await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          action:"create_deal",name:newDeal.name,amount:newDeal.value,stage:newDeal.stage,
          account_name:newDeal.school,closing_date:action.followUpDate||"",description:newDeal.notes
        })});
        toast("✓ Created in Zoho CRM","success");
      }catch{}
      return;
    }
    if(action.type==="flag_deal"){
      const deal=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
      if(deal){dispatch("UPDATE_DEAL",{id:deal.id,priority:action.priority||"hot"});toast(`${deal.name} flagged as ${action.priority||"hot"}`,"success");}
      return;
    }
    if(action.type==="schedule_followup"){
      const deal=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
      if(deal){
        dispatch("UPDATE_DEAL",{id:deal.id,followUpDate:action.date,...(action.note?{notes:(deal.notes?deal.notes+"\n":"")+action.note}:{})});
        toast(`Follow-up set for ${deal.name}: ${action.date}`,"success");
        // Sync note to Zoho
        try{await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"add_note",deal_name:deal.name,note:`Follow-up scheduled: ${action.date}. ${action.note||""}`})});}catch{}
      }
      return;
    }
    if(action.type==="log_note"){
      const deal=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
      if(deal){
        dispatch("UPDATE_DEAL",{id:deal.id,notes:(deal.notes?deal.notes+"\n":"")+action.note});
        toast(`Note logged on ${deal.name}`,"success");
        try{await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"add_note",deal_name:deal.name,note:action.note})});}catch{}
      }
      return;
    }
    if(action.type==="add_contact"){
      const c={id:mkId(),firstName:action.firstName||"",lastName:action.lastName||"",fullName:`${action.firstName||""} ${action.lastName||""}`.trim(),title:action.title||"",school:action.school||"",state:action.state||"",email:action.email||"",phone:action.phone||"",sport:action.sport||"",orgType:"school",priority:"medium",confidence:"medium",source:"agent",importedAt:Date.now()};
      dispatch("ADD_CONTACTS",[c]);
      toast(`Contact added: ${c.fullName}`,"success");
      // Sync to Zoho CRM
      try{
        await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          action:"create_contact",firstName:c.firstName,lastName:c.lastName,email:c.email,phone:c.phone,title:c.title,account_name:c.school
        })});
        toast("✓ Contact synced to Zoho","success");
      }catch{}
      return;
    }
    if(action.type==="add_to_nurture"){
      if(!action.email){toast("No email — can't add to nurture","error");return;}
      try{
        await fetch("/api/zoho-campaigns",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          action:"add_subscribers",listKey:"cold_leads",subscribers:[{email:action.email,firstName:action.firstName||"",lastName:action.lastName||"",company:action.company||""}]
        })});
        toast(`${action.email} added to nurture sequence`,"success");
      }catch(e){toast(`Nurture add failed: ${e.message}`,"error");}
      return;
    }
    if(action.type==="create_campaign"){
      setMod("marketing");toast("Switched to Marketing — create your campaign","info");
      return;
    }
  };

  const sendEmailNow=async(action,key)=>{
    if(!action.to_email){toast("No email address — can't send","error");return;}
    setSendingEmail(key);
    try{
      const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action:"send",to_email:action.to_email,to_name:action.to_name,subject:action.subject,body:action.body
      })});
      const d=await r.json();
      if(d.sent){
        toast(`Email sent to ${action.to_name||action.to_email}`,"success");
        dispatch("LOG",{msg:`Email sent to ${action.to_name||action.to_email}: "${action.subject}"`});

        // AUTO: score the contact for email sent
        const contact=(s.contacts||[]).find(c=>c.email===action.to_email);
        if(contact){
          dispatch("SCORE_CONTACT",{contactId:contact.id,type:"sent",campaignId:"agent_email",note:`Agent email: ${action.subject}`});
        }

        // AUTO: set a 3-day follow-up on any matching deal if none set
        const nameParts=(action.to_name||"").toLowerCase().split(" ");
        const matchDeal=(s.deals||[]).find(d=>{
          const dn=(d.name||"").toLowerCase();
          return nameParts.some(p=>p.length>2&&dn.includes(p))||
                 (contact?.school&&dn.includes((contact.school||"").toLowerCase().slice(0,6)));
        });
        if(matchDeal&&!matchDeal.followUpDate){
          const follow3=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
          dispatch("UPDATE_DEAL",{id:matchDeal.id,followUpDate:follow3});
          toast(`Follow-up auto-set for ${follow3}`,"info");
        }

        // AUTO: ask agent what's next — triggers auto-log + schedule_followup
        setTimeout(()=>send(`Email sent ✓ to ${action.to_name||action.to_email} — "${action.subject}". Auto-execute: log this touch and schedule follow-up.`),600);
      } else {
        toast(d.error||"Send failed","error");
      }
    }catch(e){toast(`Send error: ${e.message}`,"error");}
    setSendingEmail(null);
  };

  const send=async(overrideMsg)=>{
    const msg=(overrideMsg||input).trim();
    if(!msg||running)return;
    setInput("");setRunning(true);
    setAgentStatus("thinking");
    const userEntry={role:"user",content:msg,ts:Date.now()};
    const nextHistory=[...history,userEntry];
    setHistory(nextHistory);
    const localContext={
      deals:s.deals||[],contacts:s.contacts||[],rfps:s.rfps||[],
      invoices:s.invoices||[],sequences:s.sequences||[]
    };
    const apiMsgs=nextHistory.map(m=>({role:m.role==="user"?"user":"assistant",content:m.role==="user"?m.content:(m.raw||m.content||"")}));
    try {
      const r=await fetch("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:apiMsgs,localContext})});
      if(!r.ok){const e=await r.json();throw new Error(e.error||`HTTP ${r.status}`);}
      const raw=await r.json();
      const message=raw?.message||"Sorry, something went wrong.";
      const actions=Array.isArray(raw?.actions)?raw.actions:[];
      const suggestions=Array.isArray(raw?.suggestions)?raw.suggestions.slice(0,3):[];
      const meta={liveZoho:!!raw.liveZoho,searchUsed:!!raw.searchUsed};
      setLastMeta(meta);
      const assistantEntry={role:"assistant",content:message,actions,suggestions,raw:message,meta,ts:Date.now()};
      setHistory(h=>[...h,assistantEntry]);
      if(message.includes("🔥"))dispatch("ADD_ALERT",{msg:"Agent flagged high priority action",action:"Check AI Agent"});
      dispatch("LOG",{msg:`${cu?.name||"User"} — agent: ${msg.slice(0,60)}`});

      // AUTO-EXECUTE safe actions silently (no button click needed)
      actions.forEach(a=>{
        if(a.type==="schedule_followup"){
          const deal=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((a.deal_name||"").toLowerCase()));
          if(deal){
            dispatch("UPDATE_DEAL",{id:deal.id,followUpDate:a.date,...(a.note?{notes:(deal.notes?deal.notes+"\n":"")+`${a.date}: ${a.note}`}:{})});
            toast(`📅 Auto: follow-up set ${a.date} — ${deal.name}`,"info");
            try{fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"add_note",deal_name:deal.name,note:`Follow-up: ${a.date}. ${a.note||""}`})});}catch{}
          }
        }
        if(a.type==="log_note"){
          const deal=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((a.deal_name||"").toLowerCase()));
          if(deal){
            dispatch("UPDATE_DEAL",{id:deal.id,notes:(deal.notes?deal.notes+"\n":"")+`${today()}: ${a.note}`});
            toast(`📝 Auto: note logged — ${deal.name}`,"info");
            try{fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"add_note",deal_name:deal.name,note:a.note})});}catch{}
          }
        }
      });
    } catch(e){
      setHistory(h=>[...h,{role:"assistant",content:`Error: ${e.message}`,actions:[],suggestions:[],ts:Date.now()}]);
    }
    setAgentStatus(null);setRunning(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  };

  const clearHistory=()=>{dispatch("SET_AGENT_HISTORY",[]);toast("Conversation cleared","info");};

  // Sidebar data
  const openDeals=s.deals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
  const pipeline=openDeals.reduce((a,d)=>a+d.value,0);
  const overdueDeals=openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0).slice(0,4);
  const topContacts=[...(s.contacts||[])].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4);
  const openRfps=s.rfps.filter(r=>!["No Bid","Lost","Won"].includes(r.stage)).slice(0,3);

  const ACTION_COLORS={create_deal:{c:B.orange,bg:B.orangeBg},flag_deal:{c:B.red,bg:B.redBg},schedule_followup:{c:B.blue,bg:B.blueBg},log_note:{c:B.teal,bg:B.tealBg},add_contact:{c:B.purple,bg:B.purpleBg},create_campaign:{c:B.blue,bg:B.blueBg},add_to_nurture:{c:B.green,bg:B.greenBg}};
  const ACTION_LABELS={create_deal:"◫ CREATE DEAL",flag_deal:"🔥 FLAG DEAL",schedule_followup:"📅 SET FOLLOW-UP",log_note:"📝 LOG NOTE",add_contact:"+ ADD CONTACT",create_campaign:"✦ GO TO CAMPAIGNS",add_to_nurture:"✉ ADD TO NURTURE"};

  const STARTERS=[
    "Who should I call or email today?",
    "Draft outreach for my highest-priority contact",
    "Which deals are most at risk right now?",
    "How do I counter BSN Sports on pricing?",
    "Build a 3-touch sequence for Baseball coaches in Iowa",
    "Analyze my open RFPs — what should I prioritize?",
    "What product should I push hardest this season?",
    "Who hasn't heard from us in 30+ days?",
  ];

  return (
    <div style={{display:"flex",height:"calc(100vh - 46px)"}}>

      {/* ── Main chat ── */}
      <div style={{flex:1,padding:"22px 26px",display:"flex",flexDirection:"column",minWidth:0}}>
        <PH title="REVOPS AGENT" sub="Full-context AI with live Zoho CRM + web search — drafts outreach, flags deals, syncs to CRM"
          action={<div style={{display:"flex",gap:6,alignItems:"center"}}>
            {lastMeta?.liveZoho&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 7px",borderRadius:10,letterSpacing:.5}}>● LIVE ZOHO</span>}
            {lastMeta?.searchUsed&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 7px",borderRadius:10,letterSpacing:.5}}>🔍 WEB</span>}
            {history.length>0&&<GBtn onClick={clearHistory} style={{fontSize:9,padding:"3px 9px"}}>CLEAR</GBtn>}
          </div>}/>

        <div style={{flex:1,overflowY:"auto",background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:14,marginBottom:12,display:"flex",flexDirection:"column",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
          {history.length===0&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}>
              <div style={{textAlign:"center",marginBottom:18}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3,marginBottom:6}}>RevOps Agent</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Knows your deals, contacts, campaigns, and competitors. Drafts outreach, flags deals, schedules follow-ups.</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxWidth:520,margin:"0 auto",width:"100%"}}>
                {STARTERS.map(st=>(
                  <button key={st} onClick={()=>send(st)} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:6,padding:"9px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,textAlign:"left",cursor:"pointer",lineHeight:1.5}}>{st}</button>
                ))}
              </div>
            </div>
          )}

          {history.map((m,msgIdx)=>(
            <div key={msgIdx} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"88%",padding:"10px 14px",borderRadius:8,fontFamily:"'Lexend',sans-serif",fontSize:13,lineHeight:1.75,background:m.role==="user"?B.orange:B.surface,color:m.role==="user"?B.white:B.text,border:m.role==="assistant"?`1px solid ${B.border}`:"none",whiteSpace:"pre-wrap"}}>{m.content}</div>

              {/* Actions */}
              {m.actions?.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:6,maxWidth:"88%",width:"88%"}}>
                  {m.actions.map((a,ai)=>{
                    if(a.type==="draft_email"){
                      const key=`${msgIdx}_${ai}`;
                      const expanded=expandedEmail===key;
                      return(
                        <div key={ai} style={{background:B.white,border:`1px solid ${B.green}50`,borderRadius:6,overflow:"hidden"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.greenBg,borderBottom:expanded?`1px solid ${B.green}20`:"none"}}>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}>
                              <span style={{fontSize:14}}>✉</span>
                              <div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:600}}>{a.to_name}</div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{a.subject}</div>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:5,flexShrink:0}}>
                              {a.to_email&&(
                                <button onClick={()=>sendEmailNow(a,`${msgIdx}_${ai}`)} disabled={sendingEmail===`${msgIdx}_${ai}`} style={{background:B.green,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingEmail===`${msgIdx}_${ai}`?.6:1}}>
                                  {sendingEmail===`${msgIdx}_${ai}`?"SENDING...":"✉ SEND NOW"}
                                </button>
                              )}
                              <button onClick={()=>copyEmail(a)} style={{background:"none",border:`1px solid ${B.green}50`,color:B.green,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>📋 COPY</button>
                              <button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
                            </div>
                          </div>
                          {expanded&&(
                            <div style={{padding:"10px 12px"}}>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>To: {a.to_name}{a.to_email?` <${a.to_email}>`:" — (find email)"}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.65}}>{a.body}</div>
                            </div>
                          )}
                        </div>
                      );
                    }
                    const col=ACTION_COLORS[a.type]||{c:B.muted,bg:B.surface};
                    return(
                      <button key={ai} onClick={()=>executeAction(a,msgIdx,ai)} style={{background:col.bg,color:col.c,border:`1px solid ${col.c}40`,borderRadius:5,padding:"5px 11px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer",textAlign:"left"}}>
                        {ACTION_LABELS[a.type]||"▶ DO IT"}
                        {a.deal_name&&` — ${a.deal_name}`}{a.name&&` — ${a.name}`}{a.to_name&&` — ${a.to_name}`}
                        {a.date&&` (${a.date})`}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Follow-up suggestions */}
              {m.role==="assistant"&&m.suggestions?.length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:5,maxWidth:"88%"}}>
                  {m.suggestions.map((sg,si)=>(
                    <button key={si} onClick={()=>send(sg)} disabled={running} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:20,padding:"4px 11px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",lineHeight:1.4,opacity:running?.6:1}}>→ {sg}</button>
                  ))}
                </div>
              )}

              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3}}>{m.role==="user"?"You":"RevOps Agent"} · {new Date(m.ts).toLocaleTimeString()}</div>
            </div>
          ))}

          {running&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{padding:"10px 14px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:8,display:"flex",gap:8,alignItems:"center"}}>
                <Spin/>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
                  {agentStatus==="searching"?"🔍 Searching web...":agentStatus==="zoho"?"📡 Fetching live Zoho data...":"Thinking..."}
                </span>
              </div>
            </div>
          )}
          <div ref={endRef}/>
        </div>

        <div style={{display:"flex",gap:9}}>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Ask about your pipeline, contacts, deals — or say 'draft outreach for [name]'..." style={{flex:1,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:6,padding:"10px 13px",fontSize:13,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}/>
          <OBtn onClick={()=>send()} disabled={running||!input.trim()}>SEND →</OBtn>
        </div>
      </div>

      {/* ── Context sidebar ── */}
      <div style={{width:220,borderLeft:`1px solid ${B.border}`,background:B.surface,padding:"22px 14px",display:"flex",flexDirection:"column",gap:18,overflowY:"auto",flexShrink:0}}>
        {/* Pipeline */}
        <div>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>PIPELINE</div>
          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.orange,marginBottom:1}}>{fmt$(pipeline)}</div>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{openDeals.length} open deal{openDeals.length!==1?"s":""}</div>
        </div>

        {/* Overdue */}
        {overdueDeals.length>0&&(
          <div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,letterSpacing:1.5,marginBottom:8}}>OVERDUE ({overdueDeals.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {overdueDeals.map(d=>(
                <div key={d.id} style={{background:B.white,border:`1px solid ${B.border}`,borderLeft:`3px solid ${B.red}`,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,lineHeight:1.3,marginBottom:2}}>{d.name}</div>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red}}>{Math.abs(dUntil(d.followUpDate))}d OVERDUE</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hot contacts */}
        {topContacts.length>0&&(
          <div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>HOT CONTACTS</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {topContacts.map(c=>(
                <div key={c.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:1}}>{c.fullName||c.firstName}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,lineHeight:1.3}}>{(typeof c.title==="string"?c.title:c.title?.name||"").split(" ").slice(0,3).join(" ")}{c.state?` · ${c.state}`:""}</div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:B.orange,marginTop:2}}>{c.score||0} pts</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open RFPs */}
        {openRfps.length>0&&(
          <div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>OPEN RFPS</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {openRfps.map(r=>(
                <div key={r.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px"}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,lineHeight:1.3,marginBottom:2}}>{r.name}</div>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:RSC[r.stage]||B.muted}}>{r.stage}{r.dueDate?` · due ${r.dueDate}`:""}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!openDeals.length&&!topContacts.length&&!openRfps.length&&(
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6}}>Add deals and contacts to see live context here.</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ALERTS
// ════════════════════════════════════════════════════════════════════════════
function ModAlerts() {
  const {s,dispatch,toast}=useApp();
  const [channel,setChannel]=useState(s.integrations.slackChannel||"C0AQ7CMB01X");
  const [sending,setSending]=useState(false);
  const pending=s.alerts.filter(a=>!a.sent);

  const sendToSlack=async(msg)=>{
    const ch=channel||"C0AQ7CMB01X";
    try{
      const r=await fetch("/api/claude",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-6",max_tokens:200,
          mcp_servers:[{type:"url",url:"https://mcp.slack.com/mcp",name:"slack"}],
          messages:[{role:"user",content:`Send this exact message to Slack channel ${ch}:\n\n${msg}\n\nUse the slack_send_message tool with channel_id="${ch}". Reply with just "sent" when done.`}]
        })
      });
      const d=await r.json();
      const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").toLowerCase();
      return text.includes("sent")||d.content?.some(b=>b.type==="tool_use");
    }catch{return false;}
  };

  const send=async(id)=>{
    const alert=s.alerts.find(a=>a.id===id);
    if(!alert)return;
    setSending(true);
    const msg=`<@U09F64R5QBA> 🔥 *ST1 RevOps Alert*\n${alert.msg}${alert.action?`\n→ ${alert.action}`:""}`;
    const ok=await sendToSlack(msg);
    dispatch("DISMISS_ALERT",id);
    dispatch("LOG",{msg:`Alert ${ok?"sent to":"queued for"} Slack ${channel}`});
    toast(ok?`✓ Sent to ${channel}`:`Queued (check Slack config)`,"success");
    setSending(false);
  };

  const sendAll=async()=>{
    setSending(true);
    for(const a of pending){await send(a.id);}
    setSending(false);
  };
  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="ALERT QUEUE" sub="High-intent signals queued for Slack"/>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:16,flexWrap:"wrap"}}>
        <Lbl>Slack:</Lbl>
        <input value={channel} onChange={e=>setChannel(e.target.value)} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 10px",fontSize:12,width:180}}/>
        {pending.length>0&&<OBtn sm onClick={sendAll} disabled={sending}>{sending?"SENDING…":`SEND ALL (${pending.length})`}</OBtn>}
        {sending&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Sending to Slack…</span>}
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
            {!a.sent&&<OBtn sm onClick={()=>send(a.id)} disabled={sending} style={{marginLeft:11,flexShrink:0}}>{sending?"…":"SEND →"}</OBtn>}
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
  const [co,setCo]=useState({...SEED.company,...(s.company||{})});
  const save=()=>{dispatch("SAVE_INTEGRATIONS",ints);dispatch("SAVE_COMPANY",co);toast("Settings saved","success");};

  return (
    <div style={{padding:"22px 26px",maxWidth:680}}>
      <PH title="SETTINGS" sub="Company profile, integrations, and data management"/>

      {/* Company Profile */}
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
        <Lbl c={B.orange} s={{marginBottom:12}}>Company Profile</Lbl>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,lineHeight:1.5}}>
          This info is used in campaign emails, bid documents, and agent-drafted correspondence.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:11}}>
          {[["Company Name","name","text"],["Owner / Rep Name","ownerName","text"],["Email Address","email","email"],["Phone Number","phone","text"],["Address","address","text"],["Website","website","text"]].map(([l,k,t])=>(
            <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl>
              <input type={t} value={co[k]||""} onChange={e=>setCo(c=>({...c,[k]:e.target.value}))}
                placeholder={k==="email"?"you@company.com":k==="website"?"yoursite.com":""}
                style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
            </div>
          ))}
        </div>
        <OBtn onClick={save}>SAVE SETTINGS</OBtn>
      </div>

      {/* Zoho/integrations */}
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.purple}`}}>
        <Lbl c={B.purple} s={{marginBottom:12}}>Zoho / Slack Integration</Lbl>
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