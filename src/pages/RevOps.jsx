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

const USERS = []; // Reps are managed in Settings → Sales Reps (stored in s.reps)

const mkId   = () => Math.random().toString(36).slice(2,9);
// Use local date (not UTC) so "today" matches the user's calendar
const today  = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
// Local "now + N minutes" as HH:MM string
const nowPlusMin = n => { const d=new Date(Date.now()+n*60000); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
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
  reps: [],
  strategies: [],
  activity: [],
  integrations: {zohoToken:"",zohoCrmToken:"",zohoOrgId:"",slackChannel:"C0AQ7CMB01X"},
  company: {name:"ST1 Sports",ownerName:"Matt Stone",email:"matt@st1sports.com",phone:"719-256-0275",address:"Ames, Iowa",website:"st1sports.com"},
  brandAssets: [],
  savedAds: [],
  socialPosts: [],
  campaigns: [],
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// Merge two arrays of objects by id — union of both, server wins on same-id conflicts.
// This prevents either side from wiping data the other device has.
function mergeById(local=[], server=[]) {
  const map = {};
  for (const item of (local||[])) if (item?.id) map[item.id] = item;
  for (const item of (server||[])) if (item?.id) map[item.id] = item; // server wins conflicts
  const noId = (local||[]).filter(x => !x?.id);
  return [...Object.values(map), ...noId];
}

function mergeServerState(base, server) {
  if (!server || typeof server !== "object") return base;
  return {
    ...base,
    ...server,
    currentUserId: base.currentUserId, // always local
    // Always merge integrations/company so a partial server state never nulls them out
    integrations: {...(base.integrations||{}), ...(typeof server.integrations==="object"&&server.integrations?server.integrations:{})},
    company:      {...(base.company||{}),      ...(typeof server.company==="object"     &&server.company     ?server.company     :{})},
    agentHistory: Array.isArray(server.agentHistory) ? server.agentHistory.slice(-40) : (base.agentHistory||[]),
    // Union-merge critical arrays so neither local nor server data is lost on mount.
    // If a campaign/list/deal exists on one side only, it survives.
    // Every array that holds user-created records gets union-merged.
    // This guarantees that data created on any device is never silently dropped.
    campaigns:    mergeById(base.campaigns,    server.campaigns),
    contacts:     mergeById(base.contacts,     server.contacts),
    contactLists: mergeById(base.contactLists, server.contactLists),
    deals:        mergeById(base.deals,        server.deals),
    rfps:         mergeById(base.rfps,         server.rfps),
    invoices:     mergeById(base.invoices,     server.invoices),
    reorders:     mergeById(base.reorders,     server.reorders),
    strategies:   mergeById(base.strategies,   server.strategies),
    brandAssets:  mergeById(base.brandAssets,  server.brandAssets),
    socialPosts:  mergeById(base.socialPosts,  server.socialPosts),
    savedAds:     mergeById(base.savedAds,     server.savedAds),
    templates:    mergeById(base.templates,    server.templates),
    reps:         mergeById(base.reps,         server.reps),
    orders:       mergeById(base.orders,       server.orders),
    alerts:       mergeById(base.alerts,       server.alerts),
    activity:     mergeById(base.activity,     server.activity),
  };
}

function useStore() {
  const saveTimer = useRef(null);
  const serverTimer = useRef(null);
  const pollTimer = useRef(null);
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
          campaigns:    Array.isArray(p.campaigns)    ? p.campaigns    : [],
          reps:         Array.isArray(p.reps)         ? p.reps         : [],
          strategies:   Array.isArray(p.strategies)   ? p.strategies   : [],
          invoiceLastSync: p.invoiceLastSync||null,
          contactsLastSync: p.contactsLastSync||null,
          lastBriefDate: p.lastBriefDate||null,
          pendingBriefActions: Array.isArray(p.pendingBriefActions)?p.pendingBriefActions:[],
          appUsers:     Array.isArray(p.appUsers)     ? p.appUsers     : [],
          contactLists: Array.isArray(p.contactLists) ? p.contactLists : [],
        };
      }
    } catch {}
    return SEED;
  });
  const [lastSynced, setLastSynced] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Shared pull-and-merge logic used by mount + polling + manual sync
  const pullFromServer = useCallback(() => {
    setSyncing(true);
    return fetch("/api/state")
      .then(r => r.json())
      .then(d => {
        if (d.state && typeof d.state === "object") {
          setRaw(prev => {
            const merged = mergeServerState(prev, d.state);
            try { localStorage.setItem(STORE, JSON.stringify(merged)); } catch {}
            // Push merged result back so server always has the union of all devices
            const {currentUserId: _cid, ...toSync} = merged;
            fetch("/api/state", {method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({state: toSync})}).catch(()=>{});
            return merged;
          });
        } else {
          // Server empty — push local state up so other devices can see it
          setRaw(prev => {
            const {currentUserId: _cid, ...toSync} = prev;
            fetch("/api/state", {method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({state: toSync})}).catch(()=>{});
            return prev;
          });
        }
        setLastSynced(Date.now());
        setSyncing(false);
      })
      .catch(() => { setSyncing(false); });
  }, []);

  // Mount: initial sync
  useEffect(() => { pullFromServer(); }, []);

  // Poll every 30s — picks up changes from other devices/staff members
  useEffect(() => {
    pollTimer.current = setInterval(pullFromServer, 30000);
    return () => clearInterval(pollTimer.current);
  }, [pullFromServer]);

  const set = useCallback((fn) => {
    setRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : {...prev,...fn};
      // Save to localStorage immediately (debounced)
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
      }, 300);
      // Debounced server sync — catches any state changes not covered by dispatch's immediate sync
      // Strip contacts (synced from Zoho) and agentHistory (large, session-only) to keep payload small
      if (serverTimer.current) clearTimeout(serverTimer.current);
      serverTimer.current = setTimeout(() => {
        const {currentUserId: _cid, contacts: _c, agentHistory: _ah, ...toSync} = next;
        fetch("/api/state", {method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({state: toSync})}).catch(()=>{});
      }, 2500);
      return next;
    });
  }, []);

  return [s, set, lastSynced, syncing, pullFromServer];
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

async function pushActivityToZoho(contact, activityNote) {
  if (!contact?.zohoId) return;
  try {
    await fetch("/api/zoho", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        service: "crm",
        endpoint: `/Activities`,
        method: "POST",
        body: { data: [{ Subject: activityNote, Activity_Type: "Email", Due_Date: new Date().toISOString().slice(0,10), Who_Id: { id: contact.zohoId }, Status: "Completed" }] }
      })
    });
  } catch {}
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
const AI_MODEL = "claude-haiku-4-5-20251001";
async function aiCall(prompt, opts={}) {
  const body = {model: opts.model || AI_MODEL, max_tokens:opts.tokens||900,
    messages:[{role:"user",content:prompt}]};
  if (opts.sys) body.system = opts.sys;
  if (opts.search) body.tools = [{type:"web_search_20250305",name:"web_search"}];
  const r = await fetch("/api/claude",
    {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if (!r.ok) throw new Error(`AI API error ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const text = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  if (opts.json) {
    try { const m=text.match(/[\[{][\s\S]*[\]}]/s); return m?JSON.parse(m[0]):null; } catch { return null; }
  }
  return text;
}

async function aiCallConv(messages, sys, opts={}) {
  const r = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model: opts.model || AI_MODEL,max_tokens:opts.tokens||1400,system:sys,messages})});
  if (!r.ok) throw new Error(`AI API error ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  if(opts.json){try{const m=text.match(/[\[{][\s\S]*[\]}]/s);return m?JSON.parse(m[0]):null;}catch{return null;}}
  return text;
}

// ─── DISPATCH ─────────────────────────────────────────────────────────────────
function reducer(prev, action, payload) {
  switch (action) {
    case "LOGIN":             return {...prev, currentUserId:payload};
    case "LOGOUT":            return {...prev, currentUserId:null};
    case "ADD_DEAL":          return {...prev, deals:[payload,...(prev.deals||[])]};
    case "UPDATE_DEAL":       return {...prev, deals:(prev.deals||[]).map(d=>d.id===payload.id?{...d,...payload}:d)};
    case "ADD_INVOICE":       return {...prev, invoices:[payload,...(prev.invoices||[])]};
    case "UPDATE_INVOICE":    return {...prev, invoices:(prev.invoices||[]).map(i=>i.id===payload.id?{...i,...payload}:i)};
    case "ADD_RFP":           return {...prev, rfps:[payload,...(prev.rfps||[])]};
    case "UPDATE_RFP":        return {...prev, rfps:(prev.rfps||[]).map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "ADD_REORDER":       return {...prev, reorders:[payload,...(prev.reorders||[])]};
    case "SET_REORDERS":      return {...prev, reorders:payload};
    case "UPDATE_REORDER":    return {...prev, reorders:(prev.reorders||[]).map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "SET_INVOICES":      return {...prev, invoices:payload.invoices, invoiceLastSync:payload.lastSync||Date.now()};
    case "SET_CONTACTS":      return {...prev, contacts:payload};
    case "ADD_CONTACTS":      return {...prev, contacts:[...payload,...(prev.contacts||[])]};
    case "UPDATE_CONTACT":      return {...prev, contacts:(prev.contacts||[]).map(c=>c.id===payload.id?{...c,...payload}:c)};
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
    case "ADD_CONTACT_LIST":    return {...prev, contactLists:[payload,...(prev.contactLists||[])]};
    case "UPDATE_CONTACT_LIST": return {...prev, contactLists:(prev.contactLists||[]).map(l=>l.id===payload.id?{...l,...payload}:l)};
    case "DEL_CONTACT_LIST":    return {...prev, contactLists:(prev.contactLists||[]).filter(l=>l.id!==payload)};
    case "ADD_REP":             return {...prev, reps:[...(prev.reps||[]),payload]};
    case "UPDATE_REP":          return {...prev, reps:(prev.reps||[]).map(r=>r.id===payload.id?{...r,...payload}:r)};
    case "DEL_REP":             return {...prev, reps:(prev.reps||[]).filter(r=>r.id!==payload)};
    case "SET_APP_USER":        return {...prev, appUsers:[...(prev.appUsers||[]).filter(u=>u.repId!==payload.repId),payload]};
    case "DEL_APP_USER":        return {...prev, appUsers:(prev.appUsers||[]).filter(u=>u.repId!==payload)};
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
    case "ADD_ALERT":         return {...prev, alerts:[{id:mkId(),ts:Date.now(),sent:false,...payload},...(prev.alerts||[]).slice(0,49)]};
    case "DISMISS_ALERT":     return {...prev, alerts:(prev.alerts||[]).map(a=>a.id===payload?{...a,sent:true}:a)};
    case "LOG":               return {...prev, activity:[{id:mkId(),ts:Date.now(),userId:prev.currentUserId,...payload},...(prev.activity||[]).slice(0,199)]};
    case "SAVE_INTEGRATIONS":   return {...prev, integrations:{...prev.integrations,...payload}};
    case "SAVE_COMPANY":        return {...prev, company:{...prev.company,...payload}};
    case "ADD_BRAND_ASSET":     return {...prev, brandAssets:[...( prev.brandAssets||[]),payload]};
    case "DELETE_BRAND_ASSET":  return {...prev, brandAssets:(prev.brandAssets||[]).filter(a=>a.id!==payload)};
    case "ADD_SAVED_AD":        return {...prev, savedAds:[payload,...(prev.savedAds||[])]};
    case "DELETE_SAVED_AD":     return {...prev, savedAds:(prev.savedAds||[]).filter(a=>a.id!==payload)};
    case "ADD_SOCIAL_POST":     return {...prev, socialPosts:[...(prev.socialPosts||[]),payload]};
    case "UPDATE_SOCIAL_POST":  return {...prev, socialPosts:(prev.socialPosts||[]).map(p=>p.id===payload.id?{...p,...payload}:p)};
    case "DELETE_SOCIAL_POST":  return {...prev, socialPosts:(prev.socialPosts||[]).filter(p=>p.id!==payload)};
    case "ADD_CAMPAIGN":    return {...prev, campaigns:[payload,...(prev.campaigns||[])]};
    case "UPDATE_CAMPAIGN": return {...prev, campaigns:(prev.campaigns||[]).map(c=>c.id===payload.id?{...c,...payload}:c)};
    case "UPDATE_CAMPAIGN_TOUCH": {
      // Applies a single touch update without requiring the full campaign object — safe for debounced saves
      const {campId, touchIdx, touchDraft} = payload;
      return {...prev, campaigns:(prev.campaigns||[]).map(c=>{
        if(campId && c.id!==campId) return c;
        if(!campId) return c; // need campId
        const touches=(c.touches||[]).map((t,i)=>i===touchIdx?{...t,...touchDraft}:t);
        return {...c,touches};
      })};
    }
    case "DELETE_CAMPAIGN": return {...prev, campaigns:(prev.campaigns||[]).filter(c=>c.id!==payload)};
    case "ADD_STRATEGY":    return {...prev, strategies:[payload,...(prev.strategies||[])]};
    case "UPDATE_STRATEGY": return {...prev, strategies:(prev.strategies||[]).map(s=>s.id===payload.id?{...s,...payload}:s)};
    case "DEL_STRATEGY":    return {...prev, strategies:(prev.strategies||[]).filter(s=>s.id!==payload)};
    case "RESET":               return {...SEED, currentUserId:prev.currentUserId, integrations:prev.integrations, company:prev.company, brandAssets:prev.brandAssets||[], savedAds:prev.savedAds||[], appUsers:prev.appUsers||[], contactLists:prev.contactLists||[], campaigns:prev.campaigns||[], strategies:prev.strategies||[], reps:prev.reps||[]};
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
  return (s.deals||[]).filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0).length
    + (s.invoices||[]).filter(i=>i.status==="overdue").length
    + (s.rfps||[]).filter(r=>!["No Bid","Lost","Won"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=3).length;
}

// ════════════════════════════════════════════════════════════════════════════
//  ROOT
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [s, set, lastSynced, syncing, pullFromServer] = useStore();
  const [mod, setMod]   = useState("briefing");
  const [slim, setSlim] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const dispatch = useCallback((action, payload) => {
    set(prev => {
      const next = reducer(prev, action, payload);
      // Sync to server immediately for every action that mutates persistent data.
      // Only skip high-frequency events (SCORE_CONTACT fires once per email send)
      // and bulk-replace actions that come from Zoho/external syncs — the 2.5s
      // debounced fallback in set() handles those.
      const skipSync = new Set([
        "LOGIN",                           // session-only, not persisted
        "SCORE_CONTACT",                   // fires ~25x per batch send — debounce covers it
        "UPDATE_CAMPAIGN",                 // fires per-email during batch sends; debounce covers it
        "UPDATE_CAMPAIGN_TOUCH",           // fires on every keystroke in touch editor
        "SET_INVOICES","SET_CONTACTS","SET_REORDERS","SET_ACTIVITIES", // bulk external syncs
      ]);
      if (!skipSync.has(action)) {
        const {currentUserId: _cid, contacts: _c, agentHistory: _ah, ...toSync} = next;
        fetch("/api/state", {method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({state: toSync})}).catch(()=>{});
      }
      return next;
    });
  }, [set]);

  const toast = useCallback((msg, type="info") => {
    const id = mkId();
    setToasts(t=>[{id,msg,type},...t.slice(0,3)]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 4000);
  }, []);

  const cu = (() => {
    const rep = (s.reps||[]).find(r=>r.id===s.currentUserId);
    if (!rep) return null;
    const initials = (rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
    return { ...rep, initials, color: B.blue, role: rep.title || "rep" };
  })();
  const crmSyncRef = useRef(null);
  const ctx = {s, dispatch, toast, cu, mod, setMod, crmSyncRef, lastSynced, syncing, pullFromServer};
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
        await new Promise(r=>setTimeout(r,150)); // rate-limit buffer between pages
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
        const existingIds=new Set((s.contacts||[]).map(c=>c.id));
        const allZoho=[...contacts,...leads];
        const toAdd=allZoho.filter(c=>!existingIds.has(c.id));
        const toUpdate=allZoho.filter(c=>existingIds.has(c.id));
        if(toAdd.length) dispatch("ADD_CONTACTS",toAdd);
        toUpdate.forEach(c=>dispatch("UPDATE_CONTACT",{...c}));
        dispatch("SET_CONTACTS_LAST_SYNC",now);
        if(force) toast(`Zoho CRM: ${toAdd.length} added, ${toUpdate.length} updated (${allZoho.length} total)`, "success");
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

  useEffect(()=>{
    const handler=(e)=>{
      if(e.key==="/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)){
        e.preventDefault();setShowSearch(true);setSearchQuery("");
      }
      if(e.key==="Escape") setShowSearch(false);
    };
    window.addEventListener("keydown",handler);
    return()=>window.removeEventListener("keydown",handler);
  },[]);

  if (!s.currentUserId) return <Login dispatch={dispatch} reps={s.reps||[]} appUsers={s.appUsers||[]}/>;

  const NAV = [
    // ── SALES ──────────────────────────────────────────────────────────
    {id:"_s_sales"},
    {id:"briefing",    icon:"◈", label:"Briefing",       badge:urgentCount(s)},
    {id:"analytics",   icon:"▣", label:"Analytics"},
    {id:"revenue",     icon:"↑", label:"Revenue"},
    {id:"deals",       icon:"◫", label:"Deals"},
    {id:"quotes",      icon:"▤", label:"Quotes",           href:"https://admin.st1sports.com"},
    {id:"orders",      icon:"⊡", label:"Orders",         badge:(s.orders||[]).filter(o=>o.stage!=="Invoiced").length||null},
    {id:"invoicing",   icon:"▲", label:"Invoices & AR",  badge:(s.invoices||[]).filter(i=>i.status==="overdue").length},
    {id:"rfp",         icon:"⊘", label:"RFP / Bids",     badge:(s.rfps||[]).filter(r=>!["No Bid","Lost","Won"].includes(r.stage)&&r.dueDate&&dUntil(r.dueDate)<=7).length},
    // ── GROWTH ─────────────────────────────────────────────────────────
    {id:"_s_growth"},
    {id:"prospecting", icon:"⊕", label:"Prospecting"},
    {id:"emails",      icon:"✉", label:"Emails"},
    {id:"social",      icon:"📱", label:"Social"},
    {id:"marketing",   icon:"✦", label:"Campaigns"},
    {id:"calendar",    icon:"▦", label:"Content Calendar"},
    // ── TOOLS ──────────────────────────────────────────────────────────
    {id:"_s_tools"},
    {id:"agent",       icon:"AI",label:"AI Agent"},
    {id:"reorder",     icon:"↺", label:"Reorder Engine", badge:(s.reorders||[]).filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date())).length},
    {id:"compete",     icon:"⊗", label:"Competitors"},
    {id:"alerts",      icon:"◎", label:"Alerts",         badge:(s.alerts||[]).filter(a=>!a.sent).length},
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

          {s.currentUserId&&!slim&&<div style={{padding:"9px 11px",borderTop:`1px solid ${B.border}`,display:"flex",alignItems:"center",gap:7}}>
            {cu&&<div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
            </div>}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cu?.name||s.currentUserId}</div>
              {cu&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:6,color:B.muted,letterSpacing:1}}>{(cu.role||"").toUpperCase()}</div>}
            </div>
            <button onClick={()=>dispatch("LOGOUT")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>LOG OUT</button>
          </div>}
          {s.currentUserId&&slim&&<div style={{padding:"8px 0",borderTop:`1px solid ${B.border}`,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
            {cu&&<div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
            </div>}
            <button onClick={()=>dispatch("LOGOUT")} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:7,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>OUT</button>
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
                const intg = s.integrations||{};
                return [
                  ["Books",    st.books    || !!intg.zohoToken],
                  ["CRM",      st.crm      || !!intg.zohoCrmToken],
                  ["Campaigns",st.campaigns],
                  ["Gmail",    st.gmail    || !!intg.gmailToken],
                  ["Slack",    st.slack    !== false && !!intg.slackChannel],
                ].map(([l,v])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div className={v?"":"blink"} style={{width:6,height:6,borderRadius:"50%",background:v?B.green:B.muted}}/>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{l}</span>
                  </div>
                ));
              })()}
              <div style={{width:1,height:14,background:B.border}}/>
              {/* Live sync indicator */}
              {(()=>{
                const secAgo = lastSynced ? Math.round((Date.now()-lastSynced)/1000) : null;
                const fresh  = secAgo !== null && secAgo < 60;
                return(
                  <button onClick={()=>pullFromServer()} title="Sync now — pull latest from server"
                    style={{display:"flex",alignItems:"center",gap:5,background:"none",border:`1px solid ${fresh?B.green+"40":B.border}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:syncing?B.orange:fresh?B.green:B.muted,
                      animation:syncing?"pulse 1s infinite":undefined}}/>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:syncing?B.orange:fresh?B.green:B.muted}}>
                      {syncing?"SYNCING…":secAgo===null?"SYNC":secAgo<10?"LIVE":secAgo<60?`${secAgo}s ago`:secAgo<3600?`${Math.round(secAgo/60)}m ago`:"SYNC"}
                    </span>
                  </button>
                );
              })()}
              <div style={{width:1,height:14,background:B.border}}/>
              <button onClick={()=>{setShowSearch(true);setSearchQuery("");}} title="Search (press /)" style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:11,borderRadius:4,padding:"3px 9px",display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                <span style={{fontSize:12}}>⌕</span>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10}}>Search</span>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,border:`1px solid ${B.border}`,borderRadius:3,padding:"1px 4px"}}>/</span>
              </button>
              <div style={{width:1,height:14,background:B.border}}/>
              <button onClick={()=>setMod("alerts")} style={{background:"none",border:"none",color:(s.alerts||[]).filter(a=>!a.sent).length?B.orange:B.muted,fontSize:13,position:"relative",padding:2}}>
                ◎
                {(s.alerts||[]).filter(a=>!a.sent).length>0&&<span style={{position:"absolute",top:-3,right:-3,background:B.orange,color:B.white,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{(s.alerts||[]).filter(a=>!a.sent).length}</span>}
              </button>
            </div>
          </header>

          <main style={{flex:1,overflowY:"auto",background:B.pageBg}}>
            <ErrBound key={mod}>
            {mod==="analytics"   && <ModAnalytics/>}
            {mod==="briefing"    && <ModBriefing/>}
            {mod==="revenue"     && <ModRevenue/>}
            {mod==="deals"       && <ModDeals/>}
            {mod==="orders"      && <ModOrders/>}
            {mod==="rfp"         && <ModRFP/>}
            {mod==="invoicing"   && <ModInvoicing/>}
            {mod==="reorder"     && <ModReorder/>}
            {mod==="prospecting" && <ModProspecting/>}
            {mod==="marketing"   && <ModMarketing/>}
            {mod==="emails"      && <ModEmails/>}
            {mod==="social"      && <ModSocial/>}
            {mod==="calendar"    && <ModCalendar/>}
            {mod==="compete"     && <ModCompete/>}
            {mod==="agent"       && <ModAgent/>}
            {mod==="alerts"      && <ModAlerts/>}
            {mod==="activity"    && <ModActivity/>}
            {mod==="settings"    && <ModSettings/>}
            </ErrBound>
          </main>
        </div>

        {/* GLOBAL SEARCH MODAL */}
        {showSearch&&(
          <div onClick={()=>setShowSearch(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9998,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:80}}>
            <div onClick={e=>e.stopPropagation()} style={{background:B.white,borderRadius:10,boxShadow:"0 20px 60px rgba(0,0,0,.25)",width:"100%",maxWidth:560,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:`1px solid ${B.border}`}}>
                <span style={{fontSize:16,color:B.muted}}>⌕</span>
                <input autoFocus value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search contacts, deals, campaigns, orders..." style={{flex:1,border:"none",outline:"none",fontFamily:"'Lexend',sans-serif",fontSize:14,color:B.text,background:"transparent"}}/>
                <button onClick={()=>setShowSearch(false)} style={{background:"none",border:"none",color:B.muted,fontSize:16,cursor:"pointer",padding:"2px 6px"}}>✕</button>
              </div>
              {searchQuery.trim().length>=2&&(()=>{
                const q=searchQuery.trim().toLowerCase();
                const contacts=(s.contacts||[]).filter(c=>(c.fullName||"").toLowerCase().includes(q)||(c.email||"").toLowerCase().includes(q)||(typeof c.school==="string"?c.school:c.school?.name||"").toLowerCase().includes(q)).slice(0,4);
                const deals=(s.deals||[]).filter(d=>(d.name||"").toLowerCase().includes(q)||(d.contact||"").toLowerCase().includes(q)||(d.school||"").toLowerCase().includes(q)).slice(0,4);
                const campaigns=(s.campaigns||[]).filter(c=>(c.name||"").toLowerCase().includes(q)).slice(0,4);
                const orders=(s.orders||[]).filter(o=>(o.name||"").toLowerCase().includes(q)||(o.contact||"").toLowerCase().includes(q)||(o.school||"").toLowerCase().includes(q)).slice(0,4);
                const total=contacts.length+deals.length+campaigns.length+orders.length;
                if(!total) return <div style={{padding:"28px 16px",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted}}>No results for "{searchQuery}"</div>;
                const Grp=({title,items,go,getLabel,getSub})=>items.length>0?(
                  <div>
                    <div style={{padding:"8px 16px 4px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,background:B.surface,borderBottom:`1px solid ${B.border}`}}>{title}</div>
                    {items.map((it,i)=>(
                      <button key={i} onClick={()=>{go(it);setShowSearch(false);}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 16px",background:"none",border:"none",borderBottom:`1px solid ${B.border}`,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>
                        <div style={{fontSize:12,color:B.text,fontWeight:500}}>{getLabel(it)}</div>
                        {getSub&&<div style={{fontSize:10,color:B.muted,marginTop:1}}>{getSub(it)}</div>}
                      </button>
                    ))}
                  </div>
                ):null;
                return(
                  <div style={{maxHeight:400,overflowY:"auto"}}>
                    <Grp title="CONTACTS" items={contacts} go={()=>setMod("prospecting")} getLabel={c=>c.fullName||c.firstName||"Unnamed"} getSub={c=>`${typeof c.school==="string"?c.school:c.school?.name||""} · ${c.email||"no email"}`}/>
                    <Grp title="DEALS" items={deals} go={()=>setMod("deals")} getLabel={d=>d.name} getSub={d=>`${d.contact} · ${d.school} · ${d.stage}`}/>
                    <Grp title="CAMPAIGNS" items={campaigns} go={()=>setMod("marketing")} getLabel={c=>c.name} getSub={c=>`${(c.enrollments||[]).length} enrolled`}/>
                    <Grp title="ORDERS" items={orders} go={()=>setMod("orders")} getLabel={o=>o.name||o.contact} getSub={o=>`${o.school||""} · ${o.stage||""}`}/>
                  </div>
                );
              })()}
              {searchQuery.trim().length<2&&<div style={{padding:"20px 16px",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Type at least 2 characters to search · press <kbd style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:3,padding:"1px 5px",fontFamily:"monospace"}}>Esc</kbd> to close</div>}
            </div>
          </div>
        )}

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
function Login({dispatch, reps=[], appUsers=[]}) {
  const [sel,setSel]=useState(null);
  const [pin,setPin]=useState("");
  const [shake,setShake]=useState(false);
  const [loading,setLoading]=useState(false);

  // Build login user list from appUsers + reps cross-reference
  const loginUsers = appUsers.map(au=>{
    const rep = reps.find(r=>r.id===au.repId);
    if(!rep) return null;
    const initials = (rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
    return { id: rep.id, name: rep.name, email: rep.email, initials, color: B.blue, pin: au.pin };
  }).filter(Boolean);

  const doLogin=async()=>{
    if(!sel||pin.length<4) return;
    setLoading(true);
    // Authenticate locally against stored PIN
    const user = loginUsers.find(u=>u.id===sel.id);
    await new Promise(r=>setTimeout(r,200)); // brief delay for UX
    if(user && pin===user.pin){
      dispatch("LOGIN",sel.id);
    } else {
      setPin("");setShake(true);setTimeout(()=>setShake(false),500);
    }
    setLoading(false);
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
          {loginUsers.length===0?(
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px",background:B.surface,borderRadius:6,border:`1px solid ${B.border}`,textAlign:"center",lineHeight:1.6}}>
              No users set up yet.<br/>
              <span style={{fontSize:10}}>Go to Settings → Sales Reps and set a PIN for each rep to grant access.</span>
            </div>
          ):(
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {loginUsers.map(u=>(
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
          )}
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

function ModAnalytics() {
  const {s,setMod}=useApp();
  const [tab,setTab]=useState("overview");

  const deals=s.deals||[];
  const invoices=s.invoices||[];
  const campaigns=s.campaigns||[];
  const contacts=s.contacts||[];
  const reps=s.reps||[];

  const closedStages=["Closed Won","Closed Lost","PO Received"];
  const openDeals=deals.filter(d=>!closedStages.includes(d.stage));
  const totalRevenue=invoices.filter(i=>i.status==="paid").reduce((a,i)=>a+(i.total||i.amount||0),0);
  const openPipeline=openDeals.reduce((a,d)=>a+(d.value||0),0);
  const activeCampaigns=campaigns.filter(c=>c.status==="active").length;
  const hotLeads=contacts.filter(c=>(c.score||0)>=40).length;

  const fmt$K=(n)=>{if(n>=1000)return "$"+(n/1000).toFixed(1)+"K";return "$"+Math.round(n).toLocaleString();}

  const TABS=[["overview","Overview"],["campaigns","Campaigns"],["pipeline","Pipeline"],["hotleads","Hot Leads"],["emails","Emails"]];

  return (
    <div style={{padding:"22px 26px",overflowY:"auto",height:"calc(100vh - 46px)"}}>
      <PH title="ANALYTICS" sub="Revenue, pipeline, campaigns, and lead performance"/>
      <div style={{display:"flex",gap:5,marginBottom:18,borderBottom:`1px solid ${B.border}`}}>
        {TABS.map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===id?B.orange:"transparent"}`,color:tab===id?B.orange:B.muted,padding:"7px 14px 9px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,letterSpacing:1.5,fontWeight:700,cursor:"pointer"}}>{label}</button>
        ))}
      </div>

      {tab==="overview"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
            <KCard l="Total Revenue" v={"$"+totalRevenue.toLocaleString()} c={B.green} sub="from paid invoices"/>
            <KCard l="Open Pipeline" v={fmt$K(openPipeline)} c={B.orange} sub={`${openDeals.length} active deals`}/>
            <KCard l="Active Campaigns" v={activeCampaigns} c={B.purple}/>
            <KCard l="Hot Leads" v={hotLeads} c={B.red} sub="score >= 40"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div className="card" style={{padding:14}}>
              <Lbl s={{marginBottom:10}}>Recent Deals</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {[...deals].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5).map(d=>(
                  <div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                      <div style={{marginTop:3}}><Pill v={d.stage} sc={DSC} bc={DBG}/></div>
                    </div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange,flexShrink:0,marginLeft:9}}>{fmt$K(d.value||0)}</div>
                  </div>
                ))}
                {deals.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No deals yet</div>}
              </div>
            </div>
            <div className="card" style={{padding:14}}>
              <Lbl s={{marginBottom:10}}>Top Campaigns by Replies</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {[...campaigns].map(camp=>{
                  const enrs=camp.enrollments||[];
                  return{...camp,replied:enrs.filter(e=>e.status==="replied").length,opened:enrs.filter(e=>e.openedAt).length,enrolled:enrs.length};
                }).sort((a,b)=>b.replied-a.replied).slice(0,3).map(camp=>(
                  <div key={camp.id} style={{padding:"8px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:4}}>{camp.name}</div>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>ENROLLED <span style={{color:B.text}}>{camp.enrolled}</span></span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue}}>OPENED <span style={{color:B.text}}>{camp.opened}</span></span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green}}>REPLIED <span style={{color:B.text}}>{camp.replied}</span></span>
                    </div>
                  </div>
                ))}
                {campaigns.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No campaigns yet</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="campaigns"&&(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
            <thead>
              <tr style={{background:B.surface}}>
                {["NAME","CHANNELS","ENROLLED","SENT","OPENED","REPLIED","DONE","REP","DEALS"].map(h=>(
                  <th key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,padding:"8px 10px",textAlign:"left",borderBottom:`1px solid ${B.border}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map(camp=>{
                const enrs=camp.enrollments||[];
                const enrolled=enrs.length;
                const sent=enrs.filter(e=>e.step>0||e.status==="done").length;
                const opened=enrs.filter(e=>e.openedAt).length;
                const replied=enrs.filter(e=>e.status==="replied").length;
                const done=enrs.filter(e=>e.status==="done").length;
                const sentPct=enrolled>0?Math.round(sent/enrolled*100):0;
                const rep=USERS.find(u=>u.id===camp.repId);
                const campDeals=deals.filter(d=>d.campaignId===camp.id);
                const campDealVal=campDeals.reduce((a,d)=>a+(d.value||0),0);
                return(
                  <tr key={camp.id} style={{borderBottom:`1px solid ${B.border}`}}>
                    <td style={{padding:"9px 10px"}}>
                      <div style={{fontWeight:500,color:B.text}}>{camp.name}</div>
                      <div style={{fontSize:9,color:B.muted,marginTop:2}}>{camp.product||""}</div>
                      <div style={{marginTop:4,height:4,background:B.border,borderRadius:2,width:80}}>
                        <div style={{height:"100%",width:`${sentPct}%`,background:B.purple,borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:8,color:B.muted,marginTop:2}}>{sentPct}% sent</div>
                    </td>
                    <td style={{padding:"9px 10px"}}>
                      <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                        {(camp.channels||[]).map(ch=>(
                          <span key={ch} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:3}}>{ch}</span>
                        ))}
                        {!(camp.channels||[]).length&&<span style={{color:B.muted,fontSize:9}}>—</span>}
                      </div>
                    </td>
                    <td style={{padding:"9px 10px",color:B.text}}>{enrolled}</td>
                    <td style={{padding:"9px 10px",color:B.purple,fontWeight:500}}>{sent}</td>
                    <td style={{padding:"9px 10px",color:B.blue,fontWeight:500}}>{opened}</td>
                    <td style={{padding:"9px 10px",color:B.green,fontWeight:500}}>{replied}</td>
                    <td style={{padding:"9px 10px",color:B.muted}}>{done}</td>
                    <td style={{padding:"9px 10px",color:B.muted}}>{rep?(rep.name||"").split(" ")[0]:camp.repId||"—"}</td>
                    <td style={{padding:"9px 10px"}}>
                      {campDeals.length>0?(
                        <div>
                          <div style={{fontWeight:500,color:B.orange}}>{campDeals.length}</div>
                          <div style={{fontSize:9,color:B.muted}}>{fmt$K(campDealVal)}</div>
                        </div>
                      ):<span style={{color:B.muted}}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {campaigns.length===0&&(
                <tr><td colSpan={9} style={{padding:"32px 10px",textAlign:"center",color:B.muted}}>No campaigns yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab==="pipeline"&&(
        <div style={{display:"flex",flexDirection:"column",gap:18}}>
          <div className="card" style={{padding:16}}>
            <Lbl s={{marginBottom:12}}>Pipeline by Stage</Lbl>
            {(()=>{
              const stageMap={};
              deals.forEach(d=>{
                if(!stageMap[d.stage]) stageMap[d.stage]={count:0,value:0};
                stageMap[d.stage].count++;
                stageMap[d.stage].value+=(d.value||0);
              });
              const entries=Object.entries(stageMap).sort((a,b)=>b[1].value-a[1].value);
              const maxVal=Math.max(...entries.map(e=>e[1].value),1);
              if(entries.length===0) return <div style={{color:B.muted,fontSize:11}}>No deals yet</div>;
              return entries.map(([stage,{count,value}])=>(
                <div key={stage} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:8,height:8,borderRadius:2,background:DSC[stage]||B.muted,flexShrink:0}}/>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{stage}</span>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>{count} deal{count!==1?"s":""}</span>
                    </div>
                    <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:DSC[stage]||B.muted}}>{fmt$K(value)}</span>
                  </div>
                  <div style={{height:6,background:B.border,borderRadius:3}}>
                    <div style={{height:"100%",width:`${Math.round(value/maxVal*100)}%`,background:DSC[stage]||B.muted,borderRadius:3}}/>
                  </div>
                </div>
              ));
            })()}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div className="card" style={{padding:16}}>
              <Lbl s={{marginBottom:12}}>Pipeline by Product</Lbl>
              {(()=>{
                const prodMap={};
                deals.forEach(d=>{const p=d.product||"Other";if(!prodMap[p])prodMap[p]={count:0,value:0};prodMap[p].count++;prodMap[p].value+=(d.value||0);});
                const entries=Object.entries(prodMap).sort((a,b)=>b[1].value-a[1].value);
                if(entries.length===0) return <div style={{color:B.muted,fontSize:11}}>No deals yet</div>;
                return entries.map(([prod,{count,value}])=>(
                  <div key={prod} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{prod}</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,marginTop:1}}>{count} deal{count!==1?"s":""}</div>
                    </div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.orange}}>{fmt$K(value)}</div>
                  </div>
                ));
              })()}
            </div>
            <div className="card" style={{padding:16}}>
              <Lbl s={{marginBottom:12}}>Pipeline by Rep</Lbl>
              {(()=>{
                const repMap={};
                deals.forEach(d=>{const rid=d.repId||d.assignee||"unassigned";if(!repMap[rid])repMap[rid]={count:0,value:0};repMap[rid].count++;repMap[rid].value+=(d.value||0);});
                const entries=Object.entries(repMap).sort((a,b)=>b[1].value-a[1].value);
                if(entries.length===0) return <div style={{color:B.muted,fontSize:11}}>No deals yet</div>;
                return entries.map(([rid,{count,value}])=>{
                  const u=USERS.find(u=>u.id===rid)||reps.find(r=>r.id===rid);
                  const avg=count>0?Math.round(value/count):0;
                  return(
                    <div key={rid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${B.border}`}}>
                      <div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{u?.name||rid}</div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,marginTop:1}}>{count} deals · avg {fmt$K(avg)}</div>
                      </div>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.blue}}>{fmt$K(value)}</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
          <div className="card" style={{padding:16}}>
            <Lbl s={{marginBottom:10}}>Deals with Campaign Attribution</Lbl>
            {deals.filter(d=>d.campaignId).length===0?(
              <div style={{color:B.muted,fontSize:11}}>No deals with campaign attribution yet. Set SOURCE CAMPAIGN when creating a deal.</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {deals.filter(d=>d.campaignId).sort((a,b)=>(b.value||0)-(a.value||0)).map(d=>{
                  const camp=campaigns.find(c=>c.id===d.campaignId);
                  return(
                    <div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d.name}</span>
                          <Pill v={d.stage} sc={DSC} bc={DBG}/>
                        </div>
                        {camp&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:B.purpleBg,padding:"2px 6px",borderRadius:3}}>✦ {camp.name}</span>}
                      </div>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$K(d.value||0)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab==="hotleads"&&(
        <div>
          {(()=>{
            const tiers=[
              {label:"READY",min:60,color:B.green,bg:B.greenBg},
              {label:"WARM",min:30,color:B.orange,bg:B.orangeBg},
              {label:"ENGAGED",min:10,color:B.blue,bg:B.blueBg},
            ];
            const sorted=[...contacts].filter(c=>(c.score||0)>=10).sort((a,b)=>(b.score||0)-(a.score||0));
            if(sorted.length===0) return <div style={{color:B.muted,fontSize:12,padding:"40px 0",textAlign:"center"}}>No leads with engagement score &gt;= 10 yet</div>;
            return tiers.map(tier=>{
              const group=sorted.filter(c=>{const sc=c.score||0;if(tier.label==="READY")return sc>=60;if(tier.label==="WARM")return sc>=30&&sc<60;return sc>=10&&sc<30;});
              if(group.length===0) return null;
              return(
                <div key={tier.label} style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"6px 12px",background:tier.bg,borderRadius:5,borderLeft:`3px solid ${tier.color}`}}>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:tier.color,letterSpacing:2,fontWeight:700}}>{tier.label}</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:tier.color}}>{group.length} contacts</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {group.map(c=>{
                      const lastAct=(c.activity||[]).sort((a,b)=>b.ts-a.ts)[0];
                      const name=c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"Unnamed";
                      const school=typeof c.school==="string"?c.school:c.school?.name||"";
                      const title=typeof c.title==="string"?c.title:c.title?.name||"";
                      const sport=typeof c.sport==="string"?c.sport:c.sport?.name||"";
                      const sc=c.score||0;
                      const scoreColor=sc>=60?B.green:sc>=30?B.orange:B.blue;
                      return(
                        <div key={c.id} className="card" style={{padding:"10px 12px",borderLeft:`3px solid ${scoreColor}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{name}</span>
                                {sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{sport}</span>}
                              </div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{title}{title&&school?" · ":""}{school}{c.state?` · ${c.state}`:""}</div>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                                <div style={{flex:1,height:5,background:B.border,borderRadius:3,maxWidth:120}}>
                                  <div style={{height:"100%",width:`${Math.min(sc,100)}%`,background:scoreColor,borderRadius:3}}/>
                                </div>
                                <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:scoreColor}}>{sc} pts</span>
                              </div>
                              {lastAct&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginBottom:6}}>Last: {lastAct.note} · {new Date(lastAct.ts).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>}
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,flexShrink:0,marginLeft:10}}>
                              <OBtn sm col={B.blue} onClick={()=>setMod("emails")}>EMAIL →</OBtn>
                              <OBtn sm col={B.green} onClick={()=>setMod("deals")}>DEAL +</OBtn>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {tab==="emails"&&(
        <div>
          {(()=>{
            const allActivity=contacts.flatMap(c=>c.activity||[]);
            const totalSent=allActivity.filter(a=>a.type==="sent").length;
            const totalOpened=allActivity.filter(a=>a.type==="opened").length;
            const totalReplied=allActivity.filter(a=>a.type==="replied").length;
            const openRate=totalSent>0?Math.round(totalOpened/totalSent*100):0;
            const replyRate=totalSent>0?Math.round(totalReplied/totalSent*100):0;
            return(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:11,marginBottom:20}}>
                  <KCard l="Total Sent" v={totalSent} c={B.purple}/>
                  <KCard l="Total Opened" v={totalOpened} c={B.blue}/>
                  <KCard l="Total Replied" v={totalReplied} c={B.green}/>
                  <KCard l="Open Rate" v={`${openRate}%`} c={B.teal}/>
                  <KCard l="Reply Rate" v={`${replyRate}%`} c={B.orange}/>
                </div>
                <div className="card" style={{padding:14}}>
                  <Lbl s={{marginBottom:10}}>Campaigns with Email Channel — by Reply Rate</Lbl>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
                    <thead>
                      <tr style={{background:B.surface}}>
                        {["CAMPAIGN","ENROLLED","SENT","OPEN RATE","REPLY RATE"].map(h=>(
                          <th key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,padding:"7px 10px",textAlign:"left",borderBottom:`1px solid ${B.border}`}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...campaigns].filter(camp=>(camp.channels||[]).some(ch=>ch.includes("email"))||(camp.touches||[]).length>0).map(camp=>{
                        const enrs=camp.enrollments||[];
                        const enrolled=enrs.length;
                        const sent=enrs.filter(e=>e.step>0||e.status==="done").length;
                        const opened=enrs.filter(e=>e.openedAt).length;
                        const replied=enrs.filter(e=>e.status==="replied").length;
                        return{...camp,enrolled,sent,openR:sent>0?Math.round(opened/sent*100):0,replyR:sent>0?Math.round(replied/sent*100):0};
                      }).sort((a,b)=>b.replyR-a.replyR).map(camp=>(
                        <tr key={camp.id} style={{borderBottom:`1px solid ${B.border}`}}>
                          <td style={{padding:"8px 10px",fontWeight:500,color:B.text}}>{camp.name}</td>
                          <td style={{padding:"8px 10px",color:B.muted}}>{camp.enrolled}</td>
                          <td style={{padding:"8px 10px",color:B.purple,fontWeight:500}}>{camp.sent}</td>
                          <td style={{padding:"8px 10px",color:B.blue,fontWeight:500}}>{camp.openR}%</td>
                          <td style={{padding:"8px 10px",color:B.green,fontWeight:500}}>{camp.replyR}%</td>
                        </tr>
                      ))}
                      {campaigns.length===0&&<tr><td colSpan={5} style={{padding:"24px 10px",textAlign:"center",color:B.muted}}>No campaigns yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function ModBriefing() {
  const {s,dispatch,cu,setMod,toast}=useApp();
  const [advice,setAdvice]=useState("");
  const [loadAdv,setLoadAdv]=useState(false);
  const [addingOrder,setAddingOrder]=useState(false);
  const [oForm,setOForm]=useState({name:"",contact:"",school:"",value:"",invoiceNumber:"",trackingNumber:"",estimatedShip:"",vendorNotes:"",dealId:"",source:"manual"});
  const [sending,setSending]=useState(false);
  const [quickPrompt,setQuickPrompt]=useState("");

  const isOwner=cu?.role==="owner";
  const myDeals=isOwner?(s.deals||[]):(s.deals||[]).filter(d=>d.assignee===cu?.id);
  const myInv  =isOwner?(s.invoices||[]):(s.invoices||[]).filter(i=>i.assignee===cu?.id);
  const myRfps =isOwner?(s.rfps||[]):(s.rfps||[]).filter(r=>r.assignee===cu?.id);
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
            const done=nextStep>=(seq.touches||[]).length;
            const nextTouch=(seq.touches||[])[nextStep];
            const nextDate=nextTouch?new Date(Date.now()+nextTouch.dayOffset*86400000).toISOString().slice(0,10):null;
            dispatch("UPDATE_SEQUENCE",{...seq,enrollments:(seq.enrollments||[]).map(e=>
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
        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:21,color:B.black,letterSpacing:.3}}>GOOD {new Date().getHours()<12?"MORNING":new Date().getHours()<17?"AFTERNOON":"EVENING"}, {(cu?.name||"").split(" ")[0].toUpperCase()}</div>
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
              const wonDeals = (s.deals||[]).filter(d=>d.stage==="Closed Won");
              const totalClosed = (s.deals||[]).filter(d=>["Closed Won","Closed Lost"].includes(d.stage));
              if(totalClosed.length===0) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Win data appears as deals close</div>;
              const cats = PRODUCT_CATS.map(cat=>{
                const won  = wonDeals.filter(d=>d.product===cat);
                const lost = (s.deals||[]).filter(d=>d.stage==="Closed Lost"&&d.product===cat);
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
  const [dealNoteText,setDealNoteText]=useState("");
  const [syncing,setSyncing]=useState(false);
  const [pendingQuoteCount,setPendingQuoteCount]=useState(0);

  // Poll for pending inbound quote emails on mount
  useEffect(()=>{
    const secret=s.company?.inboundEmailSecret||"";
    const url="/api/inbound-email"+(secret?`?secret=${encodeURIComponent(secret)}`:"");
    fetch(url).then(r=>r.ok?r.json():null).then(d=>{if(d?.quotes) setPendingQuoteCount(d.quotes.length);}).catch(()=>{});
  },[]);

  const syncQuoteEmails=async()=>{
    setSyncing(true);
    try{
      const secret=s.company?.inboundEmailSecret||"";
      const url="/api/inbound-email"+(secret?`?secret=${encodeURIComponent(secret)}`:"");
      const res=await fetch(url);
      if(!res.ok){toast("Could not reach inbound email endpoint","error");setSyncing(false);return;}
      const {quotes=[]}=await res.json();
      if(!quotes.length){toast("No new quote emails to sync","info");setSyncing(false);setPendingQuoteCount(0);return;}
      // Match contacts by email, create deals
      const contactsByEmail={};
      (s.contacts||[]).forEach(c=>{if(c.email) contactsByEmail[c.email.toLowerCase()]=c;});
      const todayStr=today();
      let created=0;
      const ids=[];
      for(const q of quotes){
        const c=contactsByEmail[q.toEmail?.toLowerCase()];
        const school=c?(typeof c.school==="string"?c.school:c.school?.name||""):q.toEmail;
        const cname=c?(c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()):q.toEmail;
        const dealName=(q.subject||"").replace(/^(re:|fwd?:)\s*/gi,"").trim()||`${cname} — Quote`;
        const followUp=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
        const deal={id:mkId(),name:dealName,contact:cname,school,value:0,stage:"Quoted",product:"",priority:"medium",createdAt:todayStr,followUpDate:followUp,notes:`BCC'd from: ${q.fromEmail}\nReceived: ${q.receivedAt?.slice(0,10)||todayStr}\n\n${(q.bodyText||"").slice(0,300)}`};
        dispatch("ADD_DEAL",deal);
        // Push to Zoho CRM
        fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:"/Deals",method:"POST",body:{data:[{Deal_Name:deal.name,Amount:0,Stage:"Quoted",Closing_Date:followUp,Description:deal.notes}]}})})
          .then(r=>r.json()).then(dd=>{const _zid=dd?.data?.[0]?.details?.id;if(_zid) dispatch("UPDATE_DEAL",{id:deal.id,zohoId:_zid});}).catch(()=>{});
        ids.push(q.id);
        created++;
      }
      // Mark as processed
      if(ids.length){
        await fetch("/api/inbound-email"+(secret?`?secret=${encodeURIComponent(secret)}`:""),{method:"POST",headers:{"Content-Type":"application/json","x-inbound-secret":secret||"","x-action":"mark-processed"},body:JSON.stringify({ids})});
      }
      setPendingQuoteCount(0);
      toast(`${created} deal${created!==1?"s":""} created in RevOps + pushed to Zoho`,"success");
    }catch(err){toast("Sync error: "+err.message,"error");}
    setSyncing(false);
  };
  const [form,setForm]=useState({name:"",contact:"",school:"",state:"IA",stage:"Quoted",value:"",product:"Track & Field Equipment",assignee:cu?.id||"matt",quoteDate:today(),followUpDate:"",notes:"",campaignId:""});
  const isOwner=cu?.role==="owner";
  const pool=isOwner?(s.deals||[]):(s.deals||[]).filter(d=>d.assignee===cu?.id);
  const list=pool.filter(d=>{
    if(flt==="active") return !["Closed Won","Closed Lost","On Hold"].includes(d.stage);
    if(flt==="overdue") return d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received"].includes(d.stage);
    if(flt==="won") return d.stage==="Closed Won";
    if(flt==="all") return true;
    return d.stage===flt;
  }).sort((a,b)=>{
    // Closed Lost always sinks to the bottom; within groups sort by value desc
    const aLost=a.stage==="Closed Lost"?1:0;
    const bLost=b.stage==="Closed Lost"?1:0;
    if(aLost!==bLost) return aLost-bLost;
    return b.value-a.value;
  });
  const sel_d=sel?(s.deals||[]).find(d=>d.id===sel):null;

  const addDeal=()=>{
    if(!form.name) return;
    const d={...form,id:mkId(),value:Number(form.value||0),lastTouch:Date.now(),priority:"warm",touchHistory:[{id:mkId(),type:"quote",date:form.quoteDate||today(),note:"Quote sent",author:form.assignee}],competitor:null,zoho_synced:false};
    dispatch("ADD_DEAL",d);dispatch("LOG",{msg:`${cu?.name} added deal: ${d.name}`});
    toast("Deal added","success");setAdding(false);
    const _dealZohoData={Deal_Name:d.name||d.contact,Amount:d.value||0,Stage:d.stage||"Quoted",Closing_Date:d.followUpDate||new Date(Date.now()+30*86400000).toISOString().slice(0,10),Description:d.notes||""};
    fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:"/Deals",method:"POST",body:{data:[_dealZohoData]}})}).then(r=>r.json()).then(dd=>{const _zid=dd?.data?.[0]?.details?.id;if(_zid)dispatch("UPDATE_DEAL",{id:d.id,zohoId:_zid});}).catch(()=>{});
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
      <PH title="DEAL MANAGER" sub="Track every opportunity · log touches · manage follow-ups" action={
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={syncQuoteEmails} disabled={syncing} style={{position:"relative",background:pendingQuoteCount>0?B.orange:B.surface,color:pendingQuoteCount>0?B.white:B.muted,border:`1px solid ${pendingQuoteCount>0?B.orange:B.border}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer",opacity:syncing?.7:1}}>
            {syncing?"SYNCING...":"⬇ SYNC QUOTES"}{pendingQuoteCount>0&&<span style={{position:"absolute",top:-5,right:-5,background:B.red,color:B.white,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{pendingQuoteCount}</span>}
          </button>
          <OBtn onClick={()=>setAdding(true)}>+ NEW DEAL</OBtn>
        </div>
      }/>
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
            <div><Lbl s={{marginBottom:3}}>Source Campaign</Lbl><select value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}><option value="">— None —</option>{(s.campaigns||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div style={{display:"flex",gap:7,marginTop:10}}><OBtn onClick={addDeal}>SAVE</OBtn><GBtn onClick={()=>setAdding(false)}>CANCEL</GBtn></div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:sel_d?"1fr 370px":"1fr",gap:13}}>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {list.map(d=>{const ov=d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage);const dCamp=d.campaignId?(s.campaigns||[]).find(c=>c.id===d.campaignId):null;return(
            <div key={d.id} onClick={()=>setSel(sel===d.id?null:d.id)} className="card" style={{padding:"9px 12px",cursor:"pointer",borderLeft:`3px solid ${DSC[d.stage]||B.muted}`,background:sel===d.id?B.surface:B.white}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d.name}</span>
                    <Pill v={d.stage} sc={DSC} bc={DBG}/>
                    {dCamp&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:B.purpleBg,padding:"2px 5px",borderRadius:3}}>✦ {dCamp.name}</span>}
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
                  <button key={st} onClick={()=>{dispatch("UPDATE_DEAL",{id:sel_d.id,stage:st});dispatch("LOG",{msg:cu?.name+" moved "+sel_d.name+" → "+st});toast("Moved to "+st,"success");if(sel_d.zohoId)fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/Deals/${sel_d.zohoId}`,method:"PUT",body:{data:[{Stage:st}]}})}).catch(()=>{});}} style={{background:sel_d.stage===st?DSC[st]:B.surface,color:sel_d.stage===st?B.white:B.muted,border:"1px solid "+(sel_d.stage===st?DSC[st]:B.border),borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{st}</button>
                ))}
              </div>
              <div style={{marginBottom:9}}>
                <Lbl s={{marginBottom:4}}>Source Campaign</Lbl>
                <select value={sel_d.campaignId||""} onChange={e=>dispatch("UPDATE_DEAL",{id:sel_d.id,campaignId:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
                  <option value="">— None —</option>
                  {(s.campaigns||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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
            <div className="card" style={{padding:13}}>
              <Lbl s={{marginBottom:7}}>Notes ({(sel_d.notes_list||[]).length})</Lbl>
              <div style={{display:"flex",gap:6,marginBottom:8}}>
                <textarea value={dealNoteText} onChange={e=>setDealNoteText(e.target.value)} placeholder="Add a note..." rows={2} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
                <OBtn sm col={B.orange} onClick={()=>{if(!dealNoteText.trim())return;dispatch("UPDATE_DEAL",{id:sel_d.id,notes_list:[...(sel_d.notes_list||[]),{id:mkId(),text:dealNoteText.trim(),ts:Date.now(),author:cu?.name||"Matt"}]});setDealNoteText("");toast("Note added","success");}}>ADD</OBtn>
              </div>
              <div style={{maxHeight:150,overflowY:"auto"}}>
                {[...(sel_d.notes_list||[])].sort((a,b)=>b.ts-a.ts).map(n=>(
                  <div key={n.id} style={{display:"flex",gap:7,alignItems:"flex-start",padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.5}}>{n.text}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{new Date(n.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {n.author}</div>
                    </div>
                    <button onClick={()=>dispatch("UPDATE_DEAL",{id:sel_d.id,notes_list:(sel_d.notes_list||[]).filter(x=>x.id!==n.id)})} style={{background:"none",border:"none",color:B.muted,fontSize:11,cursor:"pointer",padding:"2px 4px",flexShrink:0}}>✕</button>
                  </div>
                ))}
                {(sel_d.notes_list||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:"6px 0"}}>No notes yet</div>}
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
  const rfps=isOwner?(s.rfps||[]):(s.rfps||[]).filter(r=>r.assignee===cu?.id);
  const sel_r=sel?(s.rfps||[]).find(r=>r.id===sel):null;
  const toggleChk=(rid,cid)=>{const r=(s.rfps||[]).find(r=>r.id===rid);if(r)dispatch("UPDATE_RFP",{id:rid,checklist:(r.checklist||[]).map(c=>c.id===cid?{...c,done:!c.done}:c)});}
  const addItem=(rid)=>{if(!newItem.trim())return;dispatch("UPDATE_RFP",{id:rid,checklist:[...((s.rfps||[]).find(r=>r.id===rid)?.checklist||[]),{id:mkId(),item:newItem,done:false}]});setNewItem("");}

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
  const [importPhase,setImportPhase]     = useState("idle"); // idle|parsing|preview
  const [importRows,setImportRows]       = useState([]);
  const [importSel,setImportSel]             = useState(new Set());
  const [importListName,setImportListName]   = useState("");
  const [importSport,setImportSport]         = useState("");
  const [importNotes,setImportNotes]         = useState("");
  const [importFile,setImportFile]           = useState(null); // File object
  const [importProgress,setImportProgress]   = useState(0);   // 0-100
  const [importStatus,setImportStatus]       = useState("");  // status text
  const [expandedListId,setExpandedListId]   = useState(null);
  const [renamingListId,setRenamingListId]   = useState(null);
  const [renameValue,setRenameValue]         = useState("");
  const [addingToListId,setAddingToListId]   = useState(null);
  const [listContactSearch,setListContactSearch] = useState("");
  const [enrollingContact,setEnrollingContact] = useState(null);
  const [flaggingContact,setFlaggingContact] = useState(null);
  const [dbFilter,setDbFilter] = useState("all"); // "all"|"leads"|"customers"|"dead"|"scraped"
  const [bulkSel,setBulkSel] = useState(new Set()); // selected contact IDs
  const [timelineContact,setTimelineContact] = useState(null); // contact id with timeline expanded
  const [bulkEnrolling,setBulkEnrolling] = useState(false);
  const [noteContactId,setNoteContactId] = useState(null); // contact id with notes panel open
  const [noteText,setNoteText] = useState("");

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

  // ── Incremental fetch: records modified since a timestamp ─────────────────────
  // Uses /search?criteria=(Modified_Time:greater_than:ISO) — no COQL scope needed.
  // Each incremental sync fetches only records modified since last sync, so it
  // stays well under 2,000 for normal daily use.
  const zohoFetchSince = async (module, fields, sinceMs, onProgress) => {
    const fList = [...new Set(["id","Modified_Time",...fields])].join(",");
    const dt = new Date(sinceMs).toISOString(); // e.g. 2024-01-15T00:00:00.000Z
    let all = []; let page = 1;
    while(true) {
      const criteria = encodeURIComponent(`(Modified_Time:greater_than:${dt})`);
      const endpoint = `/${module}/search?criteria=${criteria}&fields=${fList}&per_page=200&page=${page}`;
      const res = await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({service:"crm",endpoint,method:"GET"})
      }).then(r=>r.json());
      if(!Array.isArray(res.data)||!res.data.length) break;
      all = [...all,...res.data];
      if(onProgress) onProgress(all.length);
      if(!res.info?.more_records||res.data.length<200) break;
      page++;
      await new Promise(r=>setTimeout(r,150));
    }
    return all;
  };

  // ── Full fetch: date-range chunking (no COQL scope needed) ───────────────────
  // Splits the pull into monthly windows from 2019 to now. Each window fetches
  // up to 2,000 records (10 pages × 200), so as long as you added <2,000 records
  // in any single month this covers everything without any special OAuth scope.
  const zohoFetchAll = async (module, fields, onProgress) => {
    const fList = [...new Set(["id","Created_Time",...fields])].join(",");
    const now = new Date();
    const chunks = [];
    for(let y = 2019; y <= now.getFullYear(); y++) {
      for(let m = 0; m < 12; m++) {
        const start = new Date(Date.UTC(y,m,1));
        if(start > now) break;
        const end   = new Date(Date.UTC(y,m+1,1));
        chunks.push({start:start.toISOString(), end:end.toISOString()});
      }
    }
    let all = [];
    for(const chunk of chunks) {
      let page = 1;
      while(true) {
        const criteria = encodeURIComponent(`(Created_Time:between:${chunk.start}:${chunk.end})`);
        const endpoint = `/${module}/search?criteria=${criteria}&fields=${fList}&per_page=200&page=${page}`;
        const res = await fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({service:"crm",endpoint,method:"GET"})
        }).then(r=>r.json());
        if(!Array.isArray(res.data)||!res.data.length) break;
        all = [...all,...res.data];
        if(onProgress) onProgress(all.length);
        if(!res.info?.more_records||res.data.length<200) break;
        page++;
        await new Promise(r=>setTimeout(r,150));
      }
      await new Promise(r=>setTimeout(r,100));
    }
    return all;
  };

  // ── Shared record processing + dispatch ───────────────────────────────────────
  const processAndDispatchZohoRows = (contactRows, leadRows, dealRows, now) => {
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
      if(l.Last_Activity_Time){const daysAgo=Math.round((now-new Date(l.Last_Activity_Time).getTime())/86400000);score+=daysAgo<7?20:daysAgo<30?10:daysAgo<90?5:0;acts.push({id:mkId(),type:"sent",ts:new Date(l.Last_Activity_Time).getTime(),note:`Last activity ${daysAgo}d ago`,campaignId:"zoho"});}
      const src=zs(l.Lead_Source); if(["Web Site","Website","Chat","External Referral","Word of mouth","Internal Seminar","Public Relations"].includes(src))score+=10;
      const rating=zs(l.Rating); const priority=rating==="Hot"?"high":rating==="Warm"?"medium":"low";
      return {score:Math.min(200,score),activity:acts,priority};
    };
    const contacts = contactRows.map(c=>({id:"zoho_c_"+c.id,firstName:zs(c.First_Name),lastName:zs(c.Last_Name),fullName:`${zs(c.First_Name)} ${zs(c.Last_Name)}`.trim(),email:zs(c.Email),phone:zs(c.Phone),title:zs(c.Title),school:zs(c.Account_Name),city:zs(c.Mailing_City),state:zs(c.Mailing_State),orgType:"school",source:"zoho-crm",zohoSource:zs(c.Lead_Source),confidence:"high",outreachStatus:"new",importedAt:now}));
    const leads = leadRows.map(l=>{const {score,activity,priority}=scoreLeadFromZoho(l);return{id:"zoho_l_"+l.id,firstName:zs(l.First_Name),lastName:zs(l.Last_Name),fullName:`${zs(l.First_Name)} ${zs(l.Last_Name)}`.trim(),email:zs(l.Email),phone:zs(l.Phone),title:zs(l.Title),school:zs(l.Company),city:zs(l.City),state:zs(l.State),orgType:"school",source:"zoho-crm-lead",zohoStatus:zs(l.Lead_Status),zohoSource:zs(l.Lead_Source),zohoRating:zs(l.Rating),zohoId:l.id,confidence:"medium",priority,outreachStatus:l.Lead_Status==="Customer"?"replied":l.Lead_Status==="Contacted"?"contacted":"new",score,activity,importedAt:now};});
    const all=[...contacts,...leads];
    const existing=new Set((s.contacts||[]).map(c=>c.id));
    const toAdd=all.filter(c=>!existing.has(c.id));
    const toUpdate=all.filter(c=>existing.has(c.id)&&c.source==="zoho-crm-lead");
    if(toAdd.length) dispatch("ADD_CONTACTS",toAdd);
    toUpdate.forEach(c=>dispatch("UPDATE_CONTACT",{id:c.id,zohoStatus:c.zohoStatus,zohoSource:c.zohoSource,zohoRating:c.zohoRating,outreachStatus:c.outreachStatus}));
    dispatch("SET_CONTACTS_LAST_SYNC",now);
    // Deals
    const existingDeals=s.deals||[]; const existingDealZohoIds=new Set(existingDeals.map(d=>d.zohoId).filter(Boolean));
    const stageMap={"Qualification":"Quoted","Value Proposition":"Quoted","Id. Decision Makers":"Follow-Up 1","Perception Analysis":"Follow-Up 1","Proposal/Price Quote":"Quoted","Negotiation/Review":"Negotiating","Closed Won":"Closed Won","Closed Lost":"Closed Lost"};
    let dealsAdded=0,dealsUpdated=0;
    dealRows.forEach(zd=>{const zn=v=>typeof v==="string"?v:v?.name||v?.display_value||"";const zStage=zn(zd.Stage)||"Quoted";const localStage=DEAL_STAGES.includes(zStage)?zStage:(stageMap[zStage]||"Quoted");if(existingDealZohoIds.has(zd.id)){const local=existingDeals.find(d=>d.zohoId===zd.id);if(local&&local.stage!==localStage){dispatch("UPDATE_DEAL",{id:local.id,stage:localStage,zohoStage:zStage});dealsUpdated++;}}else{dispatch("ADD_DEAL",{id:"zoho_d_"+zd.id,zohoId:zd.id,name:zn(zd.Deal_Name)||"Untitled",contact:zn(zd.Contact_Name),school:zn(zd.Account_Name),value:Number(zd.Amount)||0,stage:localStage,zohoStage:zStage,notes:zd.Description||"",followUpDate:zd.Closing_Date||"",lastTouch:now,priority:"warm",touchHistory:[],source:"zoho-crm"});dealsAdded++;}});
    return {contacts:contacts.length,leads:leads.length,deals:dealRows.length,added:toAdd.length,updated:toUpdate.length,dealsAdded,dealsUpdated};
  };

  const CONTACT_FIELDS = ["First_Name","Last_Name","Email","Phone","Title","Account_Name","Mailing_City","Mailing_State","Lead_Source","Last_Activity_Time","Modified_Time"];
  const LEAD_FIELDS    = ["First_Name","Last_Name","Email","Phone","Title","Company","City","State","Lead_Source","Lead_Status","Rating","No_of_Calls","No_of_Chats","Last_Activity_Time","Modified_Time","Created_Time","Description","Converted"];
  const DEAL_FIELDS    = ["Deal_Name","Amount","Stage","Closing_Date","Account_Name","Contact_Name","Description","Modified_Time","Created_Time"];

  // ── INCREMENTAL SYNC — only records created/modified since last sync ────────────
  // Fast, reliable, always stays under 2,000. Use this for daily syncs.
  const pullFromZoho = async () => {
    const lastSync = s.contactsLastSync;
    if(!lastSync) { return pullFromZohoFull(); } // first-ever run → full pull
    setZohoPulling(true); setZohoPullResult(null);
    const sinceLabel = new Date(lastSync).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    toast(`Syncing new Zoho records since ${sinceLabel}...`,"info");
    setZohoPullResult({contacts:0,leads:0,deals:0,added:0,updated:0,loading:true});
    try {
      const [contactRows,leadRows,dealRows] = await Promise.all([
        zohoFetchSince("Contacts",CONTACT_FIELDS,lastSync,n=>setZohoPullResult(r=>({...r,contacts:n}))),
        zohoFetchSince("Leads",LEAD_FIELDS,lastSync,n=>setZohoPullResult(r=>({...r,leads:n}))),
        zohoFetchSince("Deals",DEAL_FIELDS,lastSync,n=>setZohoPullResult(r=>({...r,deals:n}))),
      ]);
      const result = processAndDispatchZohoRows(contactRows,leadRows,dealRows,Date.now());
      setZohoPullResult(result);
      toast(`Sync done: ${result.added} new · ${result.updated} updated · ${result.dealsAdded} new deals`,"success");
    } catch(e) {
      toast(`Zoho sync failed: ${e.message.slice(0,80)}`,"error");
    }
    setZohoPulling(false);
  };

  // ── FULL PULL — date-range chunks (2019→now), no special OAuth scope needed ──
  const [fullPulling,setFullPulling] = useState(false);
  const pullFromZohoFull = async () => {
    setFullPulling(true); setZohoPullResult(null);
    toast("Full pull from Zoho CRM (all records since 2019, monthly chunks)...","info");
    setZohoPullResult({contacts:0,leads:0,deals:0,added:0,updated:0,loading:true});
    try {
      // Run sequentially (not parallel) to avoid rate-limit hammering on full pull
      const contactRows = await zohoFetchAll("Contacts",CONTACT_FIELDS,n=>setZohoPullResult(r=>({...r,contacts:n})));
      const leadRows    = await zohoFetchAll("Leads",LEAD_FIELDS,n=>setZohoPullResult(r=>({...r,leads:n})));
      const dealRows    = await zohoFetchAll("Deals",DEAL_FIELDS,n=>setZohoPullResult(r=>({...r,deals:n})));
      const result = processAndDispatchZohoRows(contactRows,leadRows,dealRows,Date.now());
      setZohoPullResult(result);
      toast(`Full pull done: ${result.added} new · ${result.updated} updated · ${result.contacts+result.leads} total`,"success");
    } catch(e) {
      setZohoPullResult(null);
      toast(`Full pull failed: ${e.message.slice(0,80)}`,"error");
    }
    setFullPulling(false);
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

  // Step 1: user picks a file — just capture it, show the setup form
  const handleListUpload=async(e)=>{
    const file=e.target.files[0]; if(!file)return;
    e.target.value="";
    const autoName=file.name.replace(/\.[^.]+$/,"").replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    setImportFile(file);
    if(!importListName) setImportListName(autoName);
    setImportPhase("setup");
  };
  const handleApolloUpload=async(e)=>{
    const file=e.target.files[0]; if(!file)return;
    e.target.value="";
    const autoName=file.name.replace(/\.[^.]+$/,"").replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    setImportFile({...file, _isApollo:true, name:file.name, _fileObj:file});
    if(!importListName) setImportListName(autoName);
    setImportPhase("setup");
  };

  // Step 2: user clicks ANALYZE — read file + call AI with progress
  const analyzeImportFile=async()=>{
    if(!importFile) return;
    const isApollo=!!(importFile._isApollo);
    const fileObj=importFile._fileObj||importFile;
    setImportPhase("parsing"); setImportRows([]);
    try {
      setImportProgress(20); setImportStatus("Reading file…");
      const buf=await toBuffer(fileObj);
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      // Parse to row objects (header row becomes keys)
      const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
      if(rows.length===0){toast("File appears empty — check the file and try again","error");setImportPhase("setup");setImportProgress(0);return;}
      setImportProgress(50); setImportStatus(`Mapping ${rows.length} contacts…`);

      // Fuzzy header lookup — match ignoring spaces/underscores/case
      const norm=s=>String(s||"").toLowerCase().replace(/[\s_\-\.]/g,"");
      const get=(row,...keys)=>{
        const entry=Object.entries(row).find(([k])=>keys.some(kk=>norm(k)===norm(kk)));
        return entry?String(entry[1]||"").trim():"";
      };

      const inferSport=t=>{
        const tl=(t||"").toLowerCase();
        if(/track|cross.?country|xc|t&f|tf\b/.test(tl)) return "Track & Field";
        if(/baseball|softball/.test(tl)) return "Baseball/Softball";
        if(/volleyball/.test(tl)) return "Volleyball";
        if(/football/.test(tl)) return "Football";
        if(/basketball/.test(tl)) return "Basketball";
        if(/wrestling/.test(tl)) return "Wrestling";
        return importSport||"General";
      };
      const inferPriority=t=>{
        const tl=(t||"").toLowerCase();
        if(/athletic.?director|\bad\b|administrator|principal|superintendent|director/.test(tl)) return "high";
        if(/coach|coordinator|manager|head/.test(tl)) return "medium";
        return "medium";
      };
      const outreachByS={"Track & Field":"Nov–Jan","Baseball/Softball":"Sep–Nov","Volleyball":"Mar–May","Football":"Mar–May","Basketball":"Jun–Aug","Cross Country":"Mar–May","Wrestling":"Jul–Sep","General":"Oct–Dec"};

      const mapped=rows.map(row=>{
        const firstName=get(row,"First Name","FirstName","first","fname","first_name");
        const lastName=get(row,"Last Name","LastName","last","lname","last_name");
        const fullName=get(row,"Full Name","FullName","Name","full_name")||[firstName,lastName].filter(Boolean).join(" ");
        const email=get(row,"Email","Email Address","EmailAddress","E-mail","email_address");
        const phone=get(row,"Phone","Phone Number","PhoneNumber","Mobile","Cell","Telephone","phone_number");
        const title=get(row,"Title","Job Title","JobTitle","Position","Role","job_title");
        const school=get(row,"Company","School","Organization","Org","Institution","District","Club","Employer","Account Name");
        const city=get(row,"City","Town");
        const state=get(row,"State","St","Province");
        const linkedIn=get(row,"LinkedIn URL","LinkedIn","LinkedInURL","linkedin_url");
        if(!fullName&&!email) return null; // skip blank rows
        const sport=inferSport(title);
        return {
          id:mkId(), firstName, lastName,
          fullName:fullName||email||"Unknown",
          email, phone, title, school, city, state, linkedIn,
          orgType:"school", sport,
          priority:inferPriority(title),
          tags:[], outreachWindow:outreachByS[sport]||"Oct–Dec",
          source:isApollo?"apollo":"list-import",
          confidence:isApollo?"high":"medium",
          outreachStatus:"new", importedAt:Date.now(),
        };
      }).filter(Boolean);

      if(mapped.length===0){toast("No contacts found — make sure the file has data rows below the header.","error");setImportPhase("setup");setImportProgress(0);return;}
      setImportProgress(100); setImportStatus(`${mapped.length} contacts ready`);
      setImportRows(mapped);
      setImportSel(new Set(mapped.map(c=>c.id)));
      setTimeout(()=>{setImportPhase("preview");setImportProgress(0);setImportStatus("");},400);
    } catch(err) {
      toast(`Import error: ${err.message}`,"error");
      setImportPhase("setup"); setImportProgress(0); setImportStatus("");
    }
  };

  const commitListImport=async(pushZoho=false)=>{
    const selected=importRows.filter(c=>importSel.has(c.id));
    const existingEmails=new Set((s.contacts||[]).map(c=>c.email?.toLowerCase()).filter(Boolean));
    const toAdd=selected.filter(c=>!c.email||!existingEmails.has(c.email.toLowerCase()));
    const dupes=selected.length-toAdd.length;
    dispatch("ADD_CONTACTS",toAdd);
    // Save as a named contact list for easy campaign use
    const listName=(importListName||"Imported List").trim();
    const newList={id:mkId(),name:listName,contactIds:toAdd.map(c=>c.id),createdAt:Date.now(),source:"import"};
    dispatch("ADD_CONTACT_LIST",newList);
    toast(`Imported ${toAdd.length} contacts → saved as list "${listName}"${dupes>0?` · ${dupes} dupes skipped`:""}${pushZoho?" · pushing to Zoho…":""}  `,"success");
    setImportPhase("idle");setImportRows([]);setImportSel(new Set());setImportListName("");setImportSport("");setImportNotes("");setImportFile(null);
    setView("lists"); // jump straight to the lists view
    if(pushZoho&&toAdd.length>0){
      await pushToZohoLeads(toAdd);
    }
  };

  const logC={success:B.green,warn:B.yellow,error:B.red,info:B.muted,muted:B.muted};
  const statDot={done:B.green,scraping:B.orange,empty:B.muted,pending:B.border};

  const PVIEWS=[["areas","FOCUS AREAS"],["results",`RESULTS (${contacts.length})`],["import",`CONTACT DB (${(s.contacts||[]).length})`],["lists",`MY LISTS (${(s.contactLists||[]).length})`]];

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
          {/* Zoho pull card — compact strip */}
          <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"12px 14px",marginBottom:14,borderLeft:`3px solid ${B.purple}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,letterSpacing:2,flexShrink:0}}>ZOHO CRM SYNC</div>
              {s.contactsLastSync&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Last sync: {new Date(s.contactsLastSync).toLocaleString()}</div>}
              {zohoPullResult&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:zohoPullResult.loading?B.orange:B.green}}>
                {zohoPullResult.loading?`⟳ ${zohoPullResult.contacts||0} contacts · ${zohoPullResult.leads||0} leads…`:`✓ ${zohoPullResult.contacts} contacts · ${zohoPullResult.leads} leads · ${zohoPullResult.added} new`}
              </div>}
              <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
                <OBtn sm color={B.purple} onClick={pullFromZoho} disabled={zohoPulling||fullPulling||rescoring}>{zohoPulling?"SYNCING...":"↓ SYNC NEW"}</OBtn>
                <OBtn sm color={B.teal} onClick={pullFromZohoFull} disabled={zohoPulling||fullPulling||rescoring}>{fullPulling?"PULLING...":"↓ FULL PULL"}</OBtn>
                <OBtn sm color={B.blue} onClick={rescoreFromZoho} disabled={rescoring||zohoPulling||fullPulling}>{rescoring?"RESCORING...":"↺ RESCORE"}</OBtn>
              </div>
            </div>
          </div>

          {/* Upload a list — step-by-step */}
          <div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:16,marginBottom:16,borderLeft:`3px solid ${B.orange}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:importPhase==="idle"?0:14}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2}}>UPLOAD A LIST</div>
              {importPhase!=="idle"&&<button onClick={()=>{setImportPhase("idle");setImportFile(null);setImportRows([]);setImportSel(new Set());setImportProgress(0);setImportStatus("");}} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:11}}>✕ cancel</button>}
            </div>

            {/* Idle: just the buttons */}
            {importPhase==="idle"&&(
              <div style={{display:"flex",gap:10,alignItems:"center",paddingTop:10}}>
                <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleListUpload} style={{display:"none"}}/>
                <input ref={apolloFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleApolloUpload} style={{display:"none"}}/>
                <OBtn sm onClick={()=>importFileRef.current?.click()}>↑ UPLOAD CSV / EXCEL</OBtn>
                <OBtn sm color={B.teal} onClick={()=>apolloFileRef.current?.click()}>↑ APOLLO.IO CSV</OBtn>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{(s.contacts||[]).length} contacts in database</span>
              </div>
            )}

            {/* Setup: name, sport, notes, file attached */}
            {(importPhase==="setup"||importPhase==="parsing")&&(
              <div>
                {/* File attached banner */}
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:`${B.orange}10`,borderRadius:5,marginBottom:14,border:`1px solid ${B.orange}30`}}>
                  <span style={{fontSize:16}}>📎</span>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{importFile?.name||importFile?._fileObj?.name||"File attached"}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
                      {importFile?._isApollo?"Apollo.io export":"CSV / Excel list"}
                      {(importFile?.size||importFile?._fileObj?.size)?` · ${((importFile?.size||importFile?._fileObj?.size)/1024).toFixed(0)} KB`:""}
                    </div>
                  </div>
                  {importPhase==="setup"&&(
                    <div style={{display:"flex",gap:6}}>
                      <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleListUpload} style={{display:"none"}}/>
                      <input ref={apolloFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleApolloUpload} style={{display:"none"}}/>
                      <button onClick={()=>importFileRef.current?.click()} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"2px 7px",borderRadius:3,cursor:"pointer"}}>CHANGE FILE</button>
                    </div>
                  )}
                </div>

                {/* Form fields */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>LIST NAME <span style={{color:B.orange}}>*</span></div>
                    <input value={importListName} onChange={e=>setImportListName(e.target.value)}
                      placeholder="e.g. Track Coaches Spring 2025"
                      style={{width:"100%",background:B.surface,border:`1px solid ${importListName.trim()?B.green:B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
                      disabled={importPhase==="parsing"}/>
                  </div>
                  <div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>PRIMARY SPORT (optional)</div>
                    <select value={importSport} onChange={e=>setImportSport(e.target.value)}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:importSport?B.text:B.muted,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
                      disabled={importPhase==="parsing"}>
                      <option value="">— any / mixed sports —</option>
                      {SPORTS_LIST.map(sp=><option key={sp} value={sp}>{sp}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>NOTES / CONTEXT (optional — helps AI categorize better)</div>
                  <input value={importNotes} onChange={e=>setImportNotes(e.target.value)}
                    placeholder="e.g. Athletic directors from Ohio — pulled from state association website"
                    style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
                    disabled={importPhase==="parsing"}/>
                </div>

                {/* Progress bar during parsing */}
                {importPhase==="parsing"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange}}>{importStatus}</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted}}>{importProgress}%</div>
                    </div>
                    <div style={{height:6,background:B.border,borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${importProgress}%`,background:importProgress===100?B.green:B.orange,borderRadius:3,transition:"width .4s ease"}}/>
                    </div>
                  </div>
                )}

                {importPhase==="setup"&&(
                  <OBtn onClick={analyzeImportFile} disabled={!importListName.trim()}>
                    ✦ ANALYZE & IMPORT
                  </OBtn>
                )}
              </div>
            )}

            {/* Preview header + table */}
            {importPhase==="preview"&&importRows.length>0&&(
              <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:10}}>
                <div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600}}>{importListName||"Imported List"}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{importRows.length} contacts found · {importSel.size} selected to save</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <button onClick={()=>setImportSel(importSel.size===importRows.length?new Set():new Set(importRows.map(c=>c.id)))} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",color:B.muted}}>{importSel.size===importRows.length?"DESELECT ALL":"SELECT ALL"}</button>
                  <OBtn sm onClick={()=>commitListImport(false)} disabled={importSel.size===0}>⊕ SAVE LIST ({importSel.size})</OBtn>
                  <OBtn sm onClick={()=>commitListImport(true)} disabled={importSel.size===0||zohoPushing} style={{background:B.blue,borderColor:B.blue}}>⊕ SAVE + PUSH ZOHO</OBtn>
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

          </div>{/* end upload card */}

          {/* Contact database */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="checkbox" title="Select all visible contacts" checked={bulkSel.size>0&&(()=>{const vis=[...(s.contacts||[])].filter(c=>{const isDead=!!c.deadStatus;if(dbFilter==="dead")return isDead;if(isDead)return false;const isScraped=c.source==="scraped"||["website","directory","search"].includes(c.source);if(dbFilter==="scraped")return isScraped;const inv=findCustomerInvoice(c,s.invoices||[]);if(dbFilter==="customers")return !!inv;if(dbFilter==="leads")return !inv;return true;}).slice(0,100);return vis.length>0&&vis.every(c=>bulkSel.has(c.id));})()}
                  onChange={()=>{const vis=[...(s.contacts||[])].filter(c=>{const isDead=!!c.deadStatus;if(dbFilter==="dead")return isDead;if(isDead)return false;const isScraped=c.source==="scraped"||["website","directory","search"].includes(c.source);if(dbFilter==="scraped")return isScraped;const inv=findCustomerInvoice(c,s.invoices||[]);if(dbFilter==="customers")return !!inv;if(dbFilter==="leads")return !inv;return true;}).slice(0,100);const allSel=vis.every(c=>bulkSel.has(c.id));setBulkSel(allSel?new Set():new Set(vis.map(c=>c.id)));}}
                  style={{accentColor:B.orange,width:14,height:14,cursor:"pointer",flexShrink:0}}/>
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
                    <div key={c.id} className="card fu" style={{padding:"9px 11px",borderLeft:`3px solid ${c.optedOut?B.red:c.priority==="high"?B.orange:c.priority==="medium"?B.blue:B.border}`,background:bulkSel.has(c.id)?`${B.orange}06`:c.optedOut?`${B.red}05`:undefined,opacity:c.optedOut?.75:1}}>
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
                            {c.optedOut&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.red,background:B.redBg,padding:"2px 5px",borderRadius:3}}>⊘ OPTED OUT</span>}
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
                            <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
                              {(c.activity||[]).slice(0,4).map((a,i)=>(
                                <span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,background:B.surface,padding:"1px 6px",borderRadius:3}}>
                                  {a.type==="replied"?"💬 replied":a.type==="clicked"?"🖱 clicked":a.type==="opened"?"👁 opened":a.type==="sent"?"📤 sent":a.type==="enrolled"?"📋 enrolled":a.type}
                                </span>
                              ))}
                              <button onClick={e=>{e.stopPropagation();setTimelineContact(timelineContact===c.id?null:c.id);}} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:3,padding:"1px 6px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,cursor:"pointer",letterSpacing:.5}}>{timelineContact===c.id?"▲ HIDE":"▼ TIMELINE"}</button>
                            </div>
                          )}
                          {timelineContact===c.id&&(c.activity||[]).length>0&&(
                            <div style={{marginTop:8,background:B.surface,borderRadius:5,padding:"8px 10px"}}>
                              <Lbl s={{marginBottom:6}}>Activity Timeline</Lbl>
                              <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto"}}>
                                {[...(c.activity||[])].sort((a,b)=>b.ts-a.ts).map((a,i)=>{
                                  const icon={sent:"✉",opened:"👁",replied:"↩",enrolled:"★",meeting:"🤝",deal:"💰",clicked:"🖱"}[a.type]||"·";
                                  const typeColor={sent:B.purple,opened:B.blue,replied:B.green,enrolled:B.orange,meeting:B.teal,deal:B.green,clicked:B.yellow}[a.type]||B.muted;
                                  return(
                                    <div key={a.id||i} style={{display:"flex",gap:7,alignItems:"flex-start",padding:"3px 0",borderBottom:`1px solid ${B.border}22`}}>
                                      <span style={{fontSize:10,flexShrink:0,marginTop:1}}>{icon}</span>
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:typeColor,background:`${typeColor}15`,padding:"1px 4px",borderRadius:2}}>{a.type.toUpperCase()}</span>
                                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{new Date(a.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
                                        </div>
                                        {a.note&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,marginTop:2,lineHeight:1.4}}>{a.note}</div>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
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
                          <div style={{marginTop:6}}>
                            {c.optedOut?(
                              <button onClick={()=>{dispatch("UPDATE_CONTACT",{id:c.id,optedOut:false});toast(`${c.fullName||c.firstName} opted back in`,"success");if(c.zohoId){fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/Leads/${c.zohoId}`,method:"PUT",body:{data:[{id:c.zohoId,Email_Opt_Out:false}]}})}).catch(()=>{});}}} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",width:"100%"}}>OPT BACK IN</button>
                            ):(
                              <button onClick={()=>{dispatch("UPDATE_CONTACT",{id:c.id,optedOut:true});toast(`${c.fullName||c.firstName} opted out`,"info");if(c.zohoId){fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/Leads/${c.zohoId}`,method:"PUT",body:{data:[{id:c.zohoId,Email_Opt_Out:true}]}})}).catch(()=>{});}}} style={{background:"none",color:B.red,border:`1px solid ${B.red}40`,borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",width:"100%"}}>OPT OUT</button>
                            )}
                          </div>
                          <div style={{marginTop:6}}>
                            <button onClick={()=>setNoteContactId(noteContactId===c.id?null:c.id)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",width:"100%"}}>✎ NOTES {(c.notes||[]).length>0?`(${c.notes.length})`:""}</button>
                          </div>
                        </div>
                        </div>
                      </div>
                      {noteContactId===c.id&&(
                        <div style={{marginTop:8,padding:"10px 12px",background:B.surface,borderTop:`1px solid ${B.border}`,borderRadius:"0 0 6px 6px"}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:6}}>NOTES</div>
                          <div style={{display:"flex",gap:6,marginBottom:8}}>
                            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a note..." rows={2} style={{flex:1,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
                            <button onClick={()=>{if(!noteText.trim())return;dispatch("UPDATE_CONTACT",{id:c.id,notes:[...(c.notes||[]),{id:mkId(),text:noteText.trim(),ts:Date.now(),author:"Matt"}]});setNoteText("");toast("Note added","success");}} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",alignSelf:"flex-end",flexShrink:0}}>ADD NOTE</button>
                          </div>
                          {[...(c.notes||[])].sort((a,b)=>b.ts-a.ts).map(n=>(
                            <div key={n.id} style={{display:"flex",gap:7,alignItems:"flex-start",padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                              <div style={{flex:1}}>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.5}}>{n.text}</div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{new Date(n.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})} · {n.author}</div>
                              </div>
                              <button onClick={()=>dispatch("UPDATE_CONTACT",{id:c.id,notes:(c.notes||[]).filter(x=>x.id!==n.id)})} style={{background:"none",border:"none",color:B.muted,fontSize:11,cursor:"pointer",padding:"2px 4px",flexShrink:0}}>✕</button>
                            </div>
                          ))}
                          {(c.notes||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:"6px 0"}}>No notes yet</div>}
                        </div>
                      )}
                    </div>
                  );})}
                  {(s.contacts||[]).length>100&&<div style={{textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>Showing 100 of {(s.contacts||[]).length} — export CSV to see all</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view==="lists"&&(
        <div>
          {(s.contactLists||[]).length===0?(
            <div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
              No lists yet — upload a CSV in the CONTACT DB tab to create your first list
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {(s.contactLists||[]).map(list=>{
                const listContacts=(list.contactIds||[]).map(id=>(s.contacts||[]).find(c=>c.id===id)).filter(Boolean);
                const isOpen=expandedListId===list.id;
                const isRenaming=renamingListId===list.id;
                const isAdding=addingToListId===list.id;
                // contacts not yet in this list, filtered by search
                const listIds=new Set(list.contactIds||[]);
                const addableSq=(listContactSearch||"").toLowerCase();
                const addable=(s.contacts||[]).filter(c=>!listIds.has(c.id)&&(
                  !addableSq||[c.fullName,c.firstName,c.lastName,c.email,c.school,c.title,c.sport,c.state].some(v=>v&&v.toLowerCase().includes(addableSq))
                )).slice(0,50);
                return (
                  <div key={list.id} className="card" style={{padding:0,overflow:"hidden",borderLeft:`3px solid ${B.orange}`}}>
                    {/* Header */}
                    <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px"}}>
                      {isRenaming?(
                        <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter"){dispatch("UPDATE_CONTACT_LIST",{id:list.id,name:renameValue.trim()||list.name});setRenamingListId(null);}if(e.key==="Escape")setRenamingListId(null);}}
                          style={{flex:1,background:B.surface,border:`1px solid ${B.orange}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:13,fontFamily:"'Lexend',sans-serif",fontWeight:600}}/>
                      ):(
                        <div style={{flex:1,cursor:"pointer"}} onClick={()=>setExpandedListId(isOpen?null:list.id)}>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600}}>{list.name}</div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>
                            {listContacts.length} contacts · {list.createdAt?new Date(list.createdAt).toLocaleDateString():""}
                            {isOpen?" · click to collapse":""}
                          </div>
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                        {isRenaming?(
                          <>
                            <OBtn sm onClick={()=>{dispatch("UPDATE_CONTACT_LIST",{id:list.id,name:renameValue.trim()||list.name});setRenamingListId(null);}}>SAVE</OBtn>
                            <button onClick={()=>setRenamingListId(null)} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:13}}>✕</button>
                          </>
                        ):(
                          <>
                            <button onClick={()=>{setRenamingListId(list.id);setRenameValue(list.name);}} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>RENAME</button>
                            <button onClick={()=>{setAddingToListId(isAdding?null:list.id);setListContactSearch("");setExpandedListId(list.id);}} style={{background:isAdding?B.orange:"none",border:`1px solid ${isAdding?B.orange:B.border}`,color:isAdding?B.white:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>+ ADD CONTACTS</button>
                            <OBtn sm onClick={()=>setMod("campaigns")} style={{background:B.orange,borderColor:B.orange}}>USE IN CAMPAIGN →</OBtn>
                            <button onClick={()=>{if(window.confirm(`Delete list "${list.name}"?\nContacts stay in the database.`))dispatch("DEL_CONTACT_LIST",list.id);}} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:16,padding:"2px 4px"}} title="Delete list">×</button>
                            <span onClick={()=>setExpandedListId(isOpen?null:list.id)} style={{color:B.muted,fontSize:11,cursor:"pointer"}}>{isOpen?"▲":"▼"}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Add contacts panel */}
                    {isAdding&&(
                      <div style={{borderTop:`1px solid ${B.border}`,padding:"10px 14px",background:`${B.orange}08`}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1,marginBottom:6}}>ADD FROM CONTACT DATABASE</div>
                        <input value={listContactSearch} onChange={e=>setListContactSearch(e.target.value)}
                          placeholder="Search by name, email, school, sport, state…"
                          style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",marginBottom:8}}/>
                        {addable.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No matching contacts found outside this list.</div>}
                        <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                          {addable.map(c=>(
                            <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:B.white,borderRadius:4,border:`1px solid ${B.border}`}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"—"}</div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[c.title,c.school,c.email].filter(Boolean).join(" · ")}</div>
                              </div>
                              <button onClick={()=>dispatch("UPDATE_CONTACT_LIST",{id:list.id,contactIds:[...(list.contactIds||[]),c.id]})}
                                style={{background:B.orange,border:"none",color:B.white,fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 8px",borderRadius:4,cursor:"pointer",flexShrink:0}}>+ ADD</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Contact table */}
                    {isOpen&&(
                      <div style={{borderTop:`1px solid ${B.border}`}}>
                        {listContacts.length===0?(
                          <div style={{padding:"20px 14px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No contacts in this list yet. Use + ADD CONTACTS above.</div>
                        ):(
                          <div style={{overflowX:"auto",maxHeight:360,overflowY:"auto"}}>
                            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
                              <thead style={{position:"sticky",top:0,background:B.white,zIndex:1}}>
                                <tr style={{borderBottom:`1px solid ${B.border}`}}>
                                  {["Name","Title / Org","Email","Sport","State","Priority",""].map(h=>(
                                    <th key={h} style={{padding:"7px 12px",textAlign:"left",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {listContacts.map(c=>(
                                  <tr key={c.id} style={{borderBottom:`1px solid ${B.border}`}}>
                                    <td style={{padding:"6px 12px",whiteSpace:"nowrap"}}>
                                      <div style={{color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"—"}</div>
                                    </td>
                                    <td style={{padding:"6px 12px"}}>
                                      <div style={{color:B.text}}>{c.title||"—"}</div>
                                      <div style={{color:B.muted,fontSize:10}}>{c.school||""}</div>
                                    </td>
                                    <td style={{padding:"6px 12px",color:B.muted}}>{c.email||"—"}</td>
                                    <td style={{padding:"6px 12px",color:B.muted}}>{c.sport||"—"}</td>
                                    <td style={{padding:"6px 12px",color:B.muted}}>{c.state||"—"}</td>
                                    <td style={{padding:"6px 12px"}}>
                                      <span style={{background:c.priority==="high"?`${B.green}20`:c.priority==="medium"?`${B.orange}20`:`${B.border}`,color:c.priority==="high"?B.green:c.priority==="medium"?B.orange:B.muted,borderRadius:3,padding:"2px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif"}}>
                                        {(c.priority||"low").toUpperCase()}
                                      </span>
                                    </td>
                                    <td style={{padding:"6px 8px"}}>
                                      <button onClick={()=>dispatch("UPDATE_CONTACT_LIST",{id:list.id,contactIds:(list.contactIds||[]).filter(id=>id!==c.id)})}
                                        title="Remove from list" style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:13,padding:"0 4px"}}>×</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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

      {/* BULK ACTION BAR */}
      {bulkSel.size>0&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:B.black,color:B.white,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,zIndex:9000,boxShadow:"0 -4px 20px rgba(0,0,0,.25)",flexWrap:"wrap"}}>
          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.orange,letterSpacing:.5,flexShrink:0}}>{bulkSel.size} CONTACTS SELECTED</span>
          <div style={{position:"relative"}}>
            <button onClick={()=>setBulkEnrolling(v=>!v)} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"6px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>ADD TO CAMPAIGN →</button>
            {bulkEnrolling&&(
              <div style={{position:"absolute",bottom:"100%",left:0,marginBottom:6,zIndex:30,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 -4px 12px rgba(0,0,0,.14)",minWidth:200,padding:6}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>ENROLL IN CAMPAIGN</div>
                {(s.sequences||[]).map(seq=>(
                  <button key={seq.id} onClick={()=>{
                    const today=new Date().toISOString().slice(0,10);let enrolled=0;
                    const updated={...seq,enrollments:[...(seq.enrollments||[])]};
                    bulkSel.forEach(cid=>{if(!updated.enrollments.some(e=>e.contactId===cid)){updated.enrollments.push({contactId:cid,step:0,status:"active",enrolledAt:today,nextDate:today});dispatch("SCORE_CONTACT",{contactId:cid,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`});enrolled++;}});
                    dispatch("UPDATE_SEQUENCE",updated);setBulkEnrolling(false);setBulkSel(new Set());toast(`${enrolled} contacts enrolled in ${seq.name}`,"success");
                  }} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,cursor:"pointer",borderRadius:3}}>{seq.name}</button>
                ))}
                {(s.sequences||[]).length===0&&<div style={{padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No campaigns yet</div>}
                <button onClick={()=>setBulkEnrolling(false)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
              </div>
            )}
          </div>
          <button onClick={()=>{setMod("emails");}} style={{background:"#ffffff20",color:B.white,border:"1px solid #ffffff30",borderRadius:4,padding:"6px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>BATCH EMAIL →</button>
          <button onClick={()=>{
            bulkSel.forEach(cid=>{
              const c=(s.contacts||[]).find(x=>x.id===cid);
              if(c&&!c.optedOut){
                dispatch("UPDATE_CONTACT",{id:cid,optedOut:true});
                if(c.zohoId){fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/Leads/${c.zohoId}`,method:"PUT",body:{data:[{id:c.zohoId,Email_Opt_Out:true}]}})}).catch(()=>{});}
              }
            });
            toast(`${bulkSel.size} contacts opted out`,"info");setBulkSel(new Set());
          }} style={{background:"#ff000020",color:"#ff6b6b",border:"1px solid #ff000030",borderRadius:4,padding:"6px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>OPT OUT ALL</button>
          <button onClick={()=>setBulkSel(new Set())} style={{background:"none",color:"#ffffff70",border:"1px solid #ffffff30",borderRadius:4,padding:"6px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer",marginLeft:"auto"}}>✕ CLEAR</button>
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

// ════════════════════════════════════════════════════════════════════════════
//  EMAILS — unified sent history, templates, and batch outreach
// ════════════════════════════════════════════════════════════════════════════
function ModEmails() {
  const {s,dispatch,toast}=useApp();
  const [tab,setTab]=useState("sent");

  // ── SENT HISTORY ──────────────────────────────────────────────────────────
  const sentItems = (s.contacts||[])
    .flatMap(c=>(c.activity||[])
      .filter(a=>a.type==="sent"||a.type==="replied"||a.type==="opened"||a.type==="clicked")
      .map(a=>({...a,contactName:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),contactEmail:c.email,school:typeof c.school==="string"?c.school:c.school?.name||"",sport:c.sport||""}))
    )
    .sort((a,b)=>b.ts-a.ts);

  const typeColor={sent:B.blue,replied:B.green,opened:B.purple,clicked:B.orange};

  // ── TEMPLATES ─────────────────────────────────────────────────────────────
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
    if(sel&&!isDefault){dispatch("UPDATE_TEMPLATE",{id:sel,...form});toast("Template updated","success");}
    else{const t={id:mkId(),...form};dispatch("ADD_TEMPLATE",t);setSel(t.id);toast("Template saved","success");}
    setEditing(false);
  };

  // ── BATCH SEND ────────────────────────────────────────────────────────────
  const contacts=s.contacts||[];
  const [sportFilter,setSportFilter]=useState("");
  const [stateFilter,setStateFilter]=useState("");
  const [scoreFilter,setScoreFilter]=useState(0);
  const [selContacts,setSelContacts]=useState(new Set());
  const [tplId,setTplId]=useState(allTemplates[0]?.id||"");
  const [drafts,setDrafts]=useState([]);
  const [writing,setWriting]=useState(false);
  const [sending,setSending]=useState(false);
  const [sentCount,setSentCount]=useState(0);
  const sports=[...new Set(contacts.map(c=>c.sport).filter(Boolean))].sort();
  const states=[...new Set(contacts.map(c=>c.state).filter(Boolean))].sort();
  const filtered=contacts.filter(c=>{
    if(!c.email)return false;
    if(sportFilter&&c.sport!==sportFilter)return false;
    if(stateFilter&&c.state!==stateFilter)return false;
    if((c.score||0)<scoreFilter)return false;
    return true;
  });
  const eligibleContacts=contacts.filter(c=>!c.optedOut);
  const optedOutCount=contacts.length-eligibleContacts.length;
  const togSel=(id)=>setSelContacts(ss=>{const n=new Set(ss);n.has(id)?n.delete(id):n.add(id);return n;});
  const selAll=()=>setSelContacts(new Set(filtered.map(c=>c.id)));
  const selNone=()=>setSelContacts(new Set());
  const selectedList=filtered.filter(c=>selContacts.has(c.id)).filter(c=>!c.optedOut);
  const buildDrafts=async()=>{
    if(!selectedList.length){toast("Select contacts first","error");return;}
    const tpl=allTemplates.find(t=>t.id===tplId);
    if(!tpl){toast("Select a template","error");return;}
    setWriting(true);setDrafts([]);
    const useAI=selectedList.length<=20;
    if(useAI){
      const prompt=`You are writing personalized emails for ST1 Sports (athletic equipment) for ${selectedList.length} recipients.\n\nTemplate:\nSubject: ${tpl.subject}\nBody: ${tpl.body}\n\nRecipients:\n${selectedList.map((c,i)=>`${i+1}. ${c.fullName||[c.firstName,c.lastName].filter(Boolean).join(" ")} | ${c.title||"coach"} | ${c.school||""} | ${c.state||""} | Sport: ${c.sport||"general"}`).join("\n")}\n\nFor each recipient personalize the subject and body by filling in {{name}}, {{school}}, and adding 1 specific sentence relevant to their sport/role.\nReturn JSON array: [{"index":1,"subject":"...","body":"..."}] with index matching the list above.`;
      const raw=await aiCall(prompt,{json:true,tokens:4000});
      if(Array.isArray(raw)){setDrafts(raw.map((r,i)=>{const c=selectedList[i];return{id:mkId(),contactId:c.id,contactName:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),toEmail:c.email,subject:r.subject||tpl.subject,body:r.body||tpl.body,status:"draft"};}));}
      else{setDrafts(selectedList.map(c=>{const name=c.fullName||c.firstName||"Coach";const school=c.school||"your school";return{id:mkId(),contactId:c.id,contactName:name,toEmail:c.email,subject:tpl.subject.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),body:tpl.body.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),status:"draft"};}));}
    }else{setDrafts(selectedList.map(c=>{const name=c.fullName||c.firstName||"Coach";const school=c.school||"your school";return{id:mkId(),contactId:c.id,contactName:name,toEmail:c.email,subject:tpl.subject.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),body:tpl.body.replace(/\{\{name\}\}/g,name).replace(/\{\{school\}\}/g,school),status:"draft"};}));}
    setWriting(false);toast(`${selectedList.length} drafts ready — review before sending`,"success");
  };
  const sendAll=async()=>{
    const toSend=drafts.filter(d=>d.status==="draft");
    if(!toSend.length){toast("No drafts to send","error");return;}
    setSending(true);setSentCount(0);let sent=0;
    for(const d of toSend){
      try{
        setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"sending"}:x));
        const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",to_email:d.toEmail,to_name:d.contactName,subject:d.subject,body:d.body})});
        const res=await r.json();
        if(res.sent){
          setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"sent"}:x));
          dispatch("UPDATE_CONTACT",{id:d.contactId,outreachStatus:"contacted",lastOutreach:today()});
          dispatch("SCORE_CONTACT",{contactId:d.contactId,type:"sent",note:`Batch email sent`,campaignId:"batch"});
          const _bc=(s.contacts||[]).find(c=>c.id===d.contactId);if(_bc?.zohoId) pushActivityToZoho(_bc,`Batch email sent: ${d.subject}`);
          sent++;setSentCount(sent);
        }else{setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"failed",error:res.error}:x));}
        // 15-second gap between sends to avoid spam filters
        if(sent<toSend.length) await new Promise(r=>setTimeout(r,15000));
      }catch(e){setDrafts(ds=>ds.map(x=>x.id===d.id?{...x,status:"failed",error:e.message}:x));}
    }
    setSending(false);toast(`${sent}/${toSend.length} emails sent`,sent>0?"success":"error");
  };
  const updDraft=(id,field,val)=>setDrafts(ds=>ds.map(d=>d.id===id?{...d,[field]:val}:d));

  return(
    <div style={{padding:"22px 26px"}}>
      <PH title="EMAILS" sub="Sent history · reusable templates · batch outreach"/>
      <div style={{display:"flex",gap:5,marginBottom:18}}>
        {[["sent","✉ SENT"],["templates","≈ TEMPLATES"],["batch","⟶ BATCH SEND"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {/* ── SENT HISTORY ────────────────────────────────────────────────────── */}
      {tab==="sent"&&(
        <div>
          {sentItems.length===0?(
            <div className="card" style={{padding:40,textAlign:"center"}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,marginBottom:8}}>No emails sent yet</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:16}}>Emails sent through campaigns or batch outreach will appear here.</div>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <OBtn sm onClick={()=>setTab("batch")}>BATCH SEND →</OBtn>
              </div>
            </div>
          ):(
            <div>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:12}}>{sentItems.length} EVENTS</div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {sentItems.slice(0,150).map(a=>{
                  const c=typeColor[a.type]||B.muted;
                  return(
                    <div key={a.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 12px",background:B.white,border:`1px solid ${B.border}`,borderLeft:`3px solid ${c}`,borderRadius:5}}>
                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c,background:`${c}14`,padding:"2px 6px",borderRadius:3,flexShrink:0,marginTop:1}}>{a.type?.toUpperCase()}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{a.contactName}</div>
                        {a.contactEmail&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{a.contactEmail}{a.school?` · ${a.school}`:""}</div>}
                        {a.note&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2,fontStyle:"italic"}}>{a.note}</div>}
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{new Date(a.ts).toLocaleDateString()}</div>
                        {a.campaignId&&a.campaignId!=="batch"&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,marginTop:2}}>CAMPAIGN</div>}
                        {a.campaignId==="batch"&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,marginTop:2}}>BATCH</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TEMPLATES ────────────────────────────────────────────────────────── */}
      {tab==="templates"&&(
        <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:14,height:"calc(100vh - 200px)",overflow:"hidden"}}>
          <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
            <button onClick={startNew} style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"8px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",marginBottom:6}}>+ NEW TEMPLATE</button>
            {allTemplates.map(t=>(
              <div key={t.id} onClick={()=>{setSel(t.id);setEditing(false);}} style={{padding:"9px 12px",borderRadius:6,cursor:"pointer",background:sel===t.id?B.orangeBg:B.white,border:`1px solid ${sel===t.id?B.orange:B.border}`,borderLeft:`3px solid ${sel===t.id?B.orange:B.border}`}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:sel===t.id?500:400,lineHeight:1.3}}>{t.name}</div>
                {t.tags?.length>0&&<div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:4}}>{t.tags.map(tag=><span key={tag} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:8}}>{tag}</span>)}</div>}
              </div>
            ))}
          </div>
          <div style={{overflowY:"auto"}}>
            {editing?(
              <div className="card" style={{padding:16}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div><Lbl s={{marginBottom:4}}>TEMPLATE NAME</Lbl><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                  <div><Lbl s={{marginBottom:4}}>TAGS (comma-sep)</Lbl><input value={tagInput||form.tags.join(", ")} onChange={e=>{setTagInput(e.target.value);setForm(f=>({...f,tags:e.target.value.split(",").map(t=>t.trim()).filter(Boolean)}));}} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                </div>
                <div style={{marginBottom:10}}><Lbl s={{marginBottom:4}}>SUBJECT LINE</Lbl><input value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                <div style={{marginBottom:12}}><Lbl s={{marginBottom:4}}>BODY — use {"{{name}}"}, {"{{school}}"} as placeholders</Lbl>
                  <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={12} style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.7}}/></div>
                <div style={{display:"flex",gap:7}}><OBtn onClick={saveTemplate}>SAVE TEMPLATE</OBtn><GBtn onClick={cancelEdit}>CANCEL</GBtn></div>
              </div>
            ):current?(
              <div className="card" style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,marginBottom:4}}>{current.name}</div>
                    {current.tags?.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{current.tags.map(tag=><span key={tag} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:8}}>{tag}</span>)}</div>}
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <button onClick={()=>navigator.clipboard?.writeText(`Subject: ${current.subject}\n\n${current.body}`).catch(()=>{}).then(()=>toast("Copied","success"))} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>📋 COPY</button>
                    {!isDefault&&<button onClick={startEdit} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>EDIT</button>}
                    {!isDefault&&<button onClick={()=>{dispatch("DEL_TEMPLATE",sel);setSel(allTemplates[0]?.id);}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}30`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>DEL</button>}
                  </div>
                </div>
                <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"8px 12px",marginBottom:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Subject: {current.subject}</div>
                <pre style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.7,margin:0,background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"12px 14px"}}>{current.body}</pre>
                {isDefault&&<div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Built-in template — create a custom copy to edit it.</div>}
              </div>
            ):<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Select a template</div>}
          </div>
        </div>
      )}

      {/* ── BATCH SEND ───────────────────────────────────────────────────────── */}
      {tab==="batch"&&(
        drafts.length===0?(
          <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
            <div>
              <div className="card" style={{padding:14,marginBottom:12}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1.2,marginBottom:10}}>FILTER CONTACTS</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:10}}>
                  <div><Lbl s={{marginBottom:3}}>SPORT</Lbl><select value={sportFilter} onChange={e=>setSportFilter(e.target.value)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}><option value="">All sports</option>{sports.map(sp=><option key={sp}>{sp}</option>)}</select></div>
                  <div><Lbl s={{marginBottom:3}}>STATE</Lbl><select value={stateFilter} onChange={e=>setStateFilter(e.target.value)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}><option value="">All states</option>{states.map(st=><option key={st}>{st}</option>)}</select></div>
                  <div><Lbl s={{marginBottom:3}}>MIN SCORE</Lbl><input type="number" min="0" max="200" value={scoreFilter} onChange={e=>setScoreFilter(Number(e.target.value)||0)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/></div>
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
                    <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${selContacts.has(c.id)?B.orange:B.border}`,background:selContacts.has(c.id)?B.orange:"none",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{selContacts.has(c.id)&&<span style={{color:B.white,fontSize:10,lineHeight:1}}>✓</span>}</div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""} · {typeof c.school==="string"?c.school:c.school?.name||""}</div>
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
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:8}}>{selectedList.length} contacts{optedOutCount>0?<span style={{color:B.red}}> ({optedOutCount} opted out — excluded)</span>:""}</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6,marginBottom:12}}>{selContacts.size} selected · AI will personalize each email with their name and school.</div>
                <OBtn onClick={buildDrafts} disabled={writing||selectedList.length===0} style={{width:"100%",marginBottom:7}}>{writing?"✦ WRITING...":"✦ AI WRITE & PREVIEW DRAFTS"}</OBtn>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Review all emails before sending. Gmail must be connected.</div>
              </div>
            </div>
          </div>
        ):(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
                {drafts.length} drafts · {drafts.filter(d=>d.status==="sent").length} sent · {drafts.filter(d=>d.status==="failed").length} failed
                {sending&&<span style={{color:B.orange,marginLeft:8}}>Sending {sentCount}...</span>}
              </div>
              <div style={{display:"flex",gap:7}}>
                <button onClick={()=>setDrafts([])} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:5,padding:"6px 13px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>← START OVER</button>
                <button onClick={sendAll} disabled={sending||!drafts.some(d=>d.status==="draft")} style={{background:B.green,color:B.white,border:"none",borderRadius:5,padding:"7px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:sending?.6:1}}>{sending?"SENDING...":"✉ SEND ALL DRAFTS"}</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {drafts.map(d=>{
                const STATUS_C={draft:B.muted,sending:B.orange,sent:B.green,failed:B.red};
                return(
                  <div key={d.id} className="card" style={{padding:14,borderLeft:`3px solid ${STATUS_C[d.status]||B.muted}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{d.contactName} <span style={{color:B.muted,fontWeight:400}}>· {d.toEmail}</span></div>
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
        )
      )}
    </div>
  );
}

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
//  CAMPAIGNS (unified marketing hub)
// ════════════════════════════════════════════════════════════════════════════

const CAMP_COLORS = ["#F37321","#1A5FA8","#1E8F4E","#6B3FA0","#C0392B","#C77800"];
const CAMP_STATUS_COLORS = {draft:B.muted,active:B.green,paused:B.yellow,completed:B.blue};

const CAMP_TEMPLATES = [
  {id:"tf_spring", name:"Track & Field Spring Push", product:"Track & Field Equipment", goal:"10 new quotes from ADs before spring season", channels:["email","social"], metrics:["Opens","Replies","Quotes Sent"], tone:"friendly", ctx:"Spring season purchasing window — ADs finalizing equipment budgets", assetTypes:["email3","social3"]},
  {id:"baseball_preseason", name:"Baseball Pre-Season Outreach", product:"Baseball / Softball", goal:"5 new deals before March 1", channels:["email","phone"], metrics:["Opens","Replies","Meetings Booked"], tone:"professional", ctx:"Pre-season equipment orders — coaches finalizing rosters and budgets", assetTypes:["email3","callscript"]},
  {id:"back_to_school", name:"Back to School Awareness", product:"Track & Field Equipment", goal:"Broad awareness + 15 new contacts in pipeline", channels:["email","social","paid_ads"], metrics:["Opens","Clicks","Impressions"], tone:"friendly", ctx:"Back to school — new year budgets just released", assetTypes:["email3","social6","adcopy"]},
  {id:"reorder_nudge", name:"Reorder Nudge — Past Customers", product:"Other", goal:"Reactivate 5 past customers", channels:["email"], metrics:["Opens","Replies","Orders"], tone:"conversational", ctx:"Targeting schools that ordered last year — remind them to restock", assetTypes:["email3"]},
  {id:"blank", name:"Start Blank", product:"", goal:"", channels:[], metrics:[], tone:"friendly", ctx:"", assetTypes:[]},
];

function ModMarketing() {
  const {s,dispatch,toast}=useApp();
  const [tab,setTab]=useState("plans");

  // Plans (strategies) state
  const [selPlanId,setSelPlanId]=useState(null);
  const [showNewPlanForm,setShowNewPlanForm]=useState(false);
  const [planDraft,setPlanDraft]=useState(null);
  const [editingPlanId,setEditingPlanId]=useState(null);
  const [planSuggestRunning,setPlanSuggestRunning]=useState(false);
  const [planSuggestions,setPlanSuggestions]=useState(null);

  // Campaign list / wizard state
  const [selCampId,setSelCampId]=useState(null);
  const [showNewCampForm,setShowNewCampForm]=useState(false);
  const [showTemplateSelect,setShowTemplateSelect]=useState(false);
  const [campDraft,setCampDraft]=useState(null);
  // Campaign detail sub-tabs: strategy | assets | execute | report
  const [campSubTab,setCampSubTab]=useState("strategy");
  // Wizard steps: 1=define 2=icp 3=assets_checklist 4=build_assets 5=launch
  const [campStep,setCampStep]=useState(1);
  // Calendar
  const [calYear,setCalYear]=useState(()=>new Date().getFullYear());
  const [calMonth,setCalMonth]=useState(()=>new Date().getMonth());
  // Asset generation running states per type
  const [genRunning,setGenRunning]=useState(false);
  const [genSocialRunning,setGenSocialRunning]=useState(false);
  const [genAdRunning,setGenAdRunning]=useState(false);
  const [genCallRunning,setGenCallRunning]=useState(false);
  const [genMailRunning,setGenMailRunning]=useState(false);
  // Touch editing (assets tab)
  const [editingTouchIdx,setEditingTouchIdx]=useState(null);
  const [touchDraft,setTouchDraft]=useState({subject:"",body:""});
  const touchSaveTimer=useRef(null);
  const campDraftSaveTimer=useRef(null);
  const editingTouchIdxRef=useRef(editingTouchIdx);
  const selCampIdRef=useRef(null);
  const campaignsRef=useRef([]);
  useEffect(()=>{editingTouchIdxRef.current=editingTouchIdx;},[editingTouchIdx]);
  // Auto-save campDraft → store whenever it changes and has an id (covers all wizard touch/body edits)
  useEffect(()=>{
    if(!campDraft?.id) return;
    clearTimeout(campDraftSaveTimer.current);
    campDraftSaveTimer.current=setTimeout(()=>{ dispatch("UPDATE_CAMPAIGN",campDraft); },700);
    return ()=>clearTimeout(campDraftSaveTimer.current);
  },[campDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-save touchDraft → store whenever user types (no click required)
  useEffect(()=>{
    const idx=editingTouchIdxRef.current;
    const campId=selCampIdRef.current;
    if(idx===null||!campId||(!touchDraft.subject&&!touchDraft.body)) return;
    clearTimeout(touchSaveTimer.current);
    touchSaveTimer.current=setTimeout(()=>{
      if(editingTouchIdxRef.current===null) return;
      dispatch("UPDATE_CAMPAIGN_TOUCH",{campId,touchIdx:idx,touchDraft:{...touchDraft}});
    },700);
    return ()=>clearTimeout(touchSaveTimer.current);
  },[touchDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  // Execute tab
  const [filterSport,setFilterSport]=useState("all");
  const [executeFilter,setExecuteFilter]=useState("all"); // status filter for enrolled contacts
  const [campContactSearch,setCampContactSearch]=useState("");
  const [enrollSel,setEnrollSel]=useState(new Set());
  const [sending,setSending]=useState(false);
  const [checkingReplies,setCheckingReplies]=useState(false);
  const [checkingOpens,setCheckingOpens]=useState(false);
  const [previewModal,setPreviewModal]=useState(null);
  const [schedSendTime,setSchedSendTime]=useState("");
  const [schedSendTimer,setSchedSendTimer]=useState(null);
  // Manual batch queue: null = no pending batches, or {campId, queue:[...], batchNum, sentSoFar, failedSoFar, firstErr}
  const [pendingBatch,setPendingBatch]=useState(null);
  const [batchExpanded,setBatchExpanded]=useState({0:true}); // batch 0 open by default
  const [batchSentMap,setBatchSentMap]=useState({}); // key="${campId}-${ti}-${firstContactId}" → {sent,failed}
  const [intCollapsed,setIntCollapsed]=useState(false);
  // Audience segmentation (wizard step 5)
  const [segRunning,setSegRunning]=useState(false);
  const [segResult,setSegResult]=useState(null);
  const [selectedContacts,setSelectedContacts]=useState(new Set());
  const [enrollSearch,setEnrollSearch]=useState(""); // filter text for enroll-from-execute panel
  const [enrollListId,setEnrollListId]=useState(""); // contact list picker in execute tab
  // Social tab / add post
  const [showAddPost,setShowAddPost]=useState(false);
  const [postDraft,setPostDraft]=useState({date:"",platforms:[],caption:"",imageUrl:"",type:"post"});
  // Matching contacts (ICP filter)
  const [matchingContacts,setMatchingContacts]=useState(null);
  // Flighting (plan detail multi-select)
  const [flightChecked,setFlightChecked]=useState({});
  const [flightDates,setFlightDates]=useState({});

  const campaigns = s.campaigns || [];
  const strategies = s.strategies || [];
  const contactMap = Object.fromEntries((s.contacts||[]).map(c=>[c.id,c]));
  const selCamp = selCampId ? campaigns.find(c=>c.id===selCampId) : null;
  selCampIdRef.current = selCamp?.id || null;
  campaignsRef.current = campaigns;
  const selPlan = selPlanId ? strategies.find(p=>p.id===selPlanId) : null;
  const allSports = [...new Set((s.contacts||[]).map(c=>c.sport).filter(Boolean))].sort();

  const CHANNELS = [
    {id:"email",icon:"✉",label:"Cold Email"},
    {id:"social",icon:"📱",label:"Social Media"},
    {id:"paid_ads",icon:"⬛",label:"Paid Ads"},
    {id:"sms",icon:"💬",label:"SMS"},
    {id:"phone",icon:"📞",label:"Phone"},
    {id:"newsletter",icon:"📧",label:"Newsletter"},
  ];
  const METRICS = ["Opens","Clicks","Replies","Meetings Booked","Quotes Sent","Orders","Revenue","Impressions","Engagement Rate","Cost Per Lead"];

  const startNewCampaign = (fromPlan=null) => {
    setSelCampId(null);
    setSegResult(null);
    setSelectedContacts(new Set());
    setMatchingContacts(null);
    if(fromPlan){
      // Skip template selection when coming from a plan
      const planIcp = fromPlan?.icp || {sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:"",notes:""};
      setCampDraft({
        name:"",product:"Track & Field Equipment",audience:"Athletic Director",tone:"friendly",ctx:"",
        touches:[],socialDrafts:[],adCopy:"",callScript:"",directMail:"",
        startDate:today(),endDate:"",goal:"",channels:fromPlan?.channels||[],
        metrics:["Opens","Replies","Quotes Sent"],repId:"",
        planId:fromPlan?.id||"",
        icp:{...planIcp},
        assetTypes:[],
      });
      setCampStep(1);
      setShowNewCampForm(true);
      setShowTemplateSelect(false);
    } else {
      setShowTemplateSelect(true);
      setShowNewCampForm(false);
      setCampDraft(null);
    }
  };

  const applyTemplate = (tpl) => {
    setCampDraft({
      name:tpl.id==="blank"?"":tpl.name,
      product:tpl.product||"Track & Field Equipment",
      audience:"Athletic Director",
      tone:tpl.tone||"friendly",
      ctx:tpl.ctx||"",
      touches:[],socialDrafts:[],adCopy:"",callScript:"",directMail:"",
      startDate:today(),endDate:"",
      goal:tpl.goal||"",
      channels:tpl.channels||[],
      metrics:tpl.metrics||["Opens","Replies","Quotes Sent"],
      repId:"",planId:"",
      icp:{sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:"",notes:""},
      assetTypes:tpl.assetTypes||[],
    });
    setCampStep(1);
    setShowNewCampForm(true);
    setShowTemplateSelect(false);
  };

  const findMatchingContacts = (icp) => {
    const contacts = s.contacts||[];
    const sports = icp?.sports||[];
    const titles = icp?.titles||[];
    const states = icp?.states||[];
    const matched = contacts.filter(c=>{
      const cSport = (typeof c.sport==="string"?c.sport:c.sport?.name||"").toLowerCase();
      const cTitle = (typeof c.title==="string"?c.title:c.title?.name||"").toLowerCase();
      const cState = (typeof c.state==="string"?c.state:c.state||"").toUpperCase();
      const sportMatch = sports.length===0||sports.includes("all")||sports.includes("school")||sports.some(sp=>cSport===sp.toLowerCase()||cSport.includes(sp.toLowerCase()));
      const titleMatch = titles.length===0||titles.some(t=>cTitle.includes(t.toLowerCase()));
      const stateMatch = states.length===0||states.includes(cState);
      return sportMatch&&titleMatch&&stateMatch;
    });
    return matched;
  };

  // saveCampAsset — saves generated content to campDraft (wizard) or selCamp (detail)
  const saveCampAsset = (patch) => {
    if(campDraft) setCampDraft(c=>({...c,...patch}));
    else if(selCamp) dispatch("UPDATE_CAMPAIGN",{...selCamp,...patch});
  };

  const [emailGenDirection,setEmailGenDirection]=useState("");
  const generateTouches = async (directionOverride) => {
    const ctx = campDraft || selCamp; if(!ctx) return;
    setGenRunning(true);
    try {
      const windowHint = SPORT_WINDOWS[ctx.product?.split(" ")[0]]||"";
      const repLine = (() => { const rep = (s.reps||[]).find(u=>u.id===ctx.repId); return rep?`The emails are written BY and signed by ${rep.name} (${rep.email}), a rep at ST1 Sports. Use their name in the signature.`:""; })();
      const is5Touch = (ctx.assetTypes||[]).includes("email5");
      const touchCount = is5Touch ? 5 : 3;
      const dayOffsets = is5Touch ? [0,3,7,14,21] : [0,4,10];
      const touchJson = dayOffsets.map((d,i)=>`{"step":${i+1},"dayOffset":${d},"subject":"","body":""}`).join(",");
      const direction = directionOverride || emailGenDirection || ctx.ctx || "";
      const result = await aiCall(
        `Create a ${touchCount}-touch outreach email sequence for ST1 Sports. ${ST1}.\n`+
        `Product: ${ctx.product}. Audience: ${ctx.audience}. Tone: ${ctx.tone||"friendly"}.\n`+
        `${direction?`Direction / angle: ${direction}.\n`:""}`+
        `${repLine?`${repLine}\n`:""}`+
        `${windowHint?`Outreach timing: ${windowHint} (before purchasing season).\n`:""}`+
        `Return JSON: {"touches":[${touchJson}]}\n`+
        `Each email under 120 words. Use {{firstName}} {{orgName}} merge tags. `+
        (is5Touch
          ? `Touch 1: cold intro. Touch 2: follow-up referencing no reply. Touch 3: value add (stat, case study, or tip). Touch 4: urgency/offer. Touch 5: final breakup email.`
          : `Touch 2 references no reply to touch 1. Touch 3 is a brief final check-in.`),
        {json:true,tokens:is5Touch?2200:1400}
      );
      const touches = (result?.touches||[]).map(t=>({...t,id:mkId()}));
      if(!touches.length) { toast("AI returned an empty email sequence — try again","error"); }
      else { saveCampAsset({touches}); toast(`${touches.length} emails generated`,"success"); }
    } catch(e) {
      toast(`Email generation failed: ${e.message}`,"error");
    }
    setGenRunning(false);
  };

  const generateSocialDrafts = async () => {
    const ctx = campDraft || selCamp; if(!ctx) return;
    setGenSocialRunning(true);
    try {
      const result = await aiCall(
        `Create 3 social media post captions for ST1 Sports.\n${ST1}\n`+
        `Product: ${ctx.product}. Audience: ${ctx.audience}. Tone: ${ctx.tone||"friendly"}.\n`+
        `${ctx.ctx?`Context: ${ctx.ctx}.\n`:""}`+
        `Return JSON: {"posts":[{"caption":"","platforms":["instagram","facebook"],"type":"post"},{"caption":"","platforms":["linkedin"],"type":"post"},{"caption":"","platforms":["instagram"],"type":"story"}]}\n`+
        `Each caption under 150 chars. Include relevant hashtags. Vary the angle (awareness, social proof, urgency).`,
        {json:true,tokens:800}
      );
      const posts = (result?.posts||[]).map(p=>({...p,id:mkId(),date:"",imageUrl:"",imagePrompt:"",imageGenerating:false,scheduledDate:""}));
      if(!posts.length) { toast("AI returned no social posts — try again","error"); }
      else { saveCampAsset({socialDrafts:posts}); }
    } catch(e) {
      toast(`Social post generation failed: ${e.message}`,"error");
    }
    setGenSocialRunning(false);
  };

  const generateAdCopy = async () => {
    const ctx = campDraft || selCamp; if(!ctx) return;
    setGenAdRunning(true);
    try {
      const result = await aiCall(
        `Write paid ad copy for ST1 Sports.\n${ST1}\nProduct: ${ctx.product}. Audience: ${ctx.audience||"Athletic Directors and coaches"}. Tone: ${ctx.tone||"friendly"}.\n${ctx.ctx?`Context: ${ctx.ctx}.\n`:""}`+
        `Write 3 ad variations: headline (max 40 chars), primary text (max 125 chars), CTA. Format as plain text, each variation separated by "---".`,
        {tokens:600}
      );
      if(!result?.trim()) toast("AI returned no ad copy — try again","error");
      else saveCampAsset({adCopy:result});
    } catch(e) {
      toast(`Ad copy generation failed: ${e.message}`,"error");
    }
    setGenAdRunning(false);
  };

  const generateCallScript = async () => {
    const ctx = campDraft || selCamp; if(!ctx) return;
    setGenCallRunning(true);
    try {
      const result = await aiCall(
        `Write a cold call script for ST1 Sports.\n${ST1}\nProduct: ${ctx.product}. Audience: ${ctx.audience||"Athletic Directors"}. Tone: ${ctx.tone||"friendly"}.\n${ctx.ctx?`Context: ${ctx.ctx}.\n`:""}`+
        `Include: opening line, value prop (30 secs), 3 common objections with responses, closing CTA. Under 300 words.`,
        {tokens:800}
      );
      if(!result?.trim()) toast("AI returned no call script — try again","error");
      else saveCampAsset({callScript:result});
    } catch(e) {
      toast(`Call script generation failed: ${e.message}`,"error");
    }
    setGenCallRunning(false);
  };

  const generateDirectMail = async () => {
    const ctx = campDraft || selCamp; if(!ctx) return;
    setGenMailRunning(true);
    try {
      const result = await aiCall(
        `Write a direct mail letter for ST1 Sports.\n${ST1}\nProduct: ${ctx.product}. Audience: ${ctx.audience||"Athletic Directors"}. Tone: ${ctx.tone||"friendly"}.\n${ctx.ctx?`Context: ${ctx.ctx}.\n`:""}`+
        `Format as a professional letter. Include: compelling headline, 3 bullet benefits, social proof line, clear CTA, signature. Use {{firstName}} {{orgName}} merge tags. Under 250 words.`,
        {tokens:700}
      );
      if(!result?.trim()) toast("AI returned no letter — try again","error");
      else saveCampAsset({directMail:result});
    } catch(e) {
      toast(`Direct mail generation failed: ${e.message}`,"error");
    }
    setGenMailRunning(false);
  };

  const generateAllAssets = async () => {
    if(!campDraft) return;
    const types = campDraft.assetTypes||[];
    const emailTypes = types.filter(t=>t==="email3"||t==="email5");
    const socialTypes = types.filter(t=>t==="social3"||t==="social6");
    if(emailTypes.length>0) await generateTouches();
    if(socialTypes.length>0) await generateSocialDrafts();
    if(types.includes("adcopy")) await generateAdCopy();
    if(types.includes("callscript")) await generateCallScript();
    if(types.includes("directmail")) await generateDirectMail();
  };

  const suggestCampaignPlan = async () => {
    if(!planDraft) return;
    setPlanSuggestRunning(true); setPlanSuggestions(null);
    const result = await aiCall(
      `You are a marketing strategist for ST1 Sports, a school/team sports equipment company.\n${ST1}\n\n`+
      `MARKETING PLAN REQUEST:\n`+
      `Plan Name: ${planDraft.name}\nSport Focus: ${planDraft.sport||"General"}\nStates/Areas: ${(planDraft.states||[]).join(", ")||"All"}\n`+
      `Segment: ${planDraft.segment||"All Levels"}\nSeason Window: ${planDraft.seasonStart||""} to ${planDraft.seasonEnd||""}\n`+
      `Goals: ${planDraft.goals||"Drive awareness and quotes"}\n\n`+
      `Generate 4-6 campaign ideas that work together to achieve these goals.\n`+
      `Return JSON: {"campaigns":[{"name":"","goal":"","timing":"","channels":[],"assetTypes":[]}]}\n`+
      `channels options: email, social, paid_ads, phone, sms, newsletter\n`+
      `assetTypes options: email3, email5, social3, social6, adcopy, callscript, directmail\n`+
      `Make campaigns specific to the sport, region, and buying season. Return ONLY valid JSON.`,
      {json:true,tokens:1400}
    );
    setPlanSuggestions(result?.campaigns||[]);
    setPlanSuggestRunning(false);
    if(!result?.campaigns?.length) toast("No suggestions returned — try adding more detail to the plan","info");
  };

  // ── AI audience segmentation ──────────────────────────────────────────────────
  const analyzeAudience = async () => {
    if(!campDraft) return;
    setSegRunning(true); setSegResult(null);
    const contacts = s.contacts||[];
    if(contacts.length===0){toast("No contacts in database yet — import or scrape contacts first","error");setSegRunning(false);return;}
    const icp = campDraft.icp||{};
    const rows = contacts.map(c=>{
      const title=typeof c.title==="string"?c.title:c.title?.name||"";
      const school=typeof c.school==="string"?c.school:c.school?.name||"";
      const sport=typeof c.sport==="string"?c.sport:c.sport?.name||"";
      return `${c.id}|${c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}|${title}|${school}|${sport}|score:${c.score||0}|email:${c.email?"yes":"no"}|status:${c.outreachStatus||c.zohoStatus||"cold"}`;
    }).slice(0,120);
    const result = await aiCall(
      `You are a sales intelligence engine for ST1 Sports, a school/team sports equipment company.\n`+
      `${ST1}\n\n`+
      `CAMPAIGN TO FILL:\n`+
      `Product: ${campDraft.product}\nChannels: ${(campDraft.channels||[]).join(", ")||"email"}\nTarget audience: ${campDraft.audience||"any"}\nContext: ${campDraft.ctx||"none"}\n`+
      `ICP Sports: ${(icp.sports||[]).join(", ")||"any"}\nICP Titles: ${(icp.titles||[]).join(", ")||"any"}\n`+
      `ICP School Level: ${icp.schoolLevel||"Both"}\nICP States: ${(icp.states||[]).join(", ")||"any"}\n\n`+
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
    const segs = result?.segments||[];
    const presel = new Set(segs.filter(s=>s.fit==="high"||s.fit==="medium").map(s=>s.contactId));
    setSegResult({summary:result?.summary||"",segments:segs});
    setSelectedContacts(presel);
    setSegRunning(false);
    if(segs.length===0) toast("No strong matches found — try broadening the audience or adding more contacts","info");
  };

  const saveCampaign = () => {
    const types = campDraft?.assetTypes||[];
    const hasAnyContent = (campDraft?.touches||[]).length>0||(campDraft?.adCopy||"").trim()||(campDraft?.callScript||"").trim()||(campDraft?.directMail||"").trim()||(campDraft?.socialDrafts||[]).length>0;
    if(!campDraft) return;
    if(types.length>0&&!hasAnyContent){toast("Generate at least one asset before launching","error");return;}
    const contacts = s.contacts||[];
    const todayStr = today();
    const startDate = campDraft.startDate||todayStr;
    const batchSize = campDraft.batchSize||25;
    const audienceMode = campDraft.audienceMode||"ai";
    let seg;
    let enrollments;
    if(audienceMode==="list"&&campDraft.audienceListId){
      const list=(s.contactLists||[]).find(l=>l.id===campDraft.audienceListId);
      const listIds=list?.contactIds||[];
      seg=contacts.filter(c=>listIds.includes(c.id));
      // Stagger: contact at index i gets startDate + floor(i/batchSize) days
      enrollments=seg.map((c,i)=>{
        const dayOffset=Math.floor(i/batchSize);
        const startD=new Date(startDate);
        startD.setDate(startD.getDate()+dayOffset);
        const enrollDate=startD.toISOString().slice(0,10);
        return {contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:enrollDate};
      });
    } else {
      seg = segResult
        ? contacts.filter(c=>selectedContacts.has(c.id))
        : contacts.filter(c=>(campDraft.audience==="all"||!campDraft.audience||(c.title||"").toLowerCase().includes((campDraft.audience||"").toLowerCase().split(" ")[0].toLowerCase())));
      enrollments=seg.map(c=>({contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr}));
    }
    const isEditing = !!campDraft.id;
    const campId = campDraft.id || mkId();
    const existingCamp = isEditing ? campaigns.find(c=>c.id===campId) : null;
    const camp = {
      ...(existingCamp||{}),
      id: campId,
      name: campDraft.name||`${campDraft.product} — ${campDraft.audience}`,
      product: campDraft.product,
      audience: campDraft.audience,
      tone: campDraft.tone,
      goal: campDraft.goal||"",
      repId: campDraft.repId||"",
      startDate,
      endDate: campDraft.endDate||"",
      touches: campDraft.touches,
      enrollments,
      socialPosts: existingCamp?.socialPosts||[],
      socialDrafts: campDraft.socialDrafts||[],
      adCopy: campDraft.adCopy||"",
      callScript: campDraft.callScript||"",
      directMail: campDraft.directMail||"",
      adIds: existingCamp?.adIds||[],
      channels: campDraft.channels||[],
      metrics: campDraft.metrics||[],
      assetTypes: campDraft.assetTypes||[],
      icp: campDraft.icp||{sports:[],titles:[],schoolLevel:"Both",states:[],buyingSeasonNotes:"",notes:""},
      planId: campDraft.planId||"",
      ctx: campDraft.ctx||"",
      audienceMode,
      audienceListId: campDraft.audienceListId||"",
      batchSize,
      status: isEditing ? (existingCamp?.status||"running") : "running",
      createdAt: existingCamp?.createdAt||todayStr,
      color: existingCamp?.color||CAMP_COLORS[campaigns.length % CAMP_COLORS.length],
    };
    if(isEditing) dispatch("UPDATE_CAMPAIGN", camp);
    else dispatch("ADD_CAMPAIGN", camp);
    if(!isEditing) seg.forEach(c=>dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:campId,note:`Enrolled in ${camp.name}`}));
    setShowNewCampForm(false); setCampDraft(null); setCampStep(1); setSelCampId(campId); setCampSubTab("strategy");
    setSegResult(null); setSelectedContacts(new Set());
    toast(isEditing ? `Campaign updated` : `Campaign created · ${seg.length} contacts enrolled`,"success");
  };

  const saveDraft = () => {
    if(!campDraft) return;
    const isEditing = !!campDraft.id;
    const campId = campDraft.id || mkId();
    const existingCamp = isEditing ? campaigns.find(c=>c.id===campId) : null;
    const camp = {
      ...(existingCamp||{}),
      id: campId,
      name: campDraft.name||"Untitled Campaign",
      product: campDraft.product||"",
      audience: campDraft.audience||"",
      tone: campDraft.tone||"",
      goal: campDraft.goal||"",
      repId: campDraft.repId||"",
      startDate: campDraft.startDate||"",
      endDate: campDraft.endDate||"",
      touches: campDraft.touches||[],
      enrollments: existingCamp?.enrollments||[],
      socialPosts: existingCamp?.socialPosts||[],
      socialDrafts: campDraft.socialDrafts||[],
      adCopy: campDraft.adCopy||"",
      callScript: campDraft.callScript||"",
      directMail: campDraft.directMail||"",
      adIds: existingCamp?.adIds||[],
      channels: campDraft.channels||[],
      assetTypes: campDraft.assetTypes||[],
      icp: campDraft.icp||{sports:[],titles:[],schoolLevel:"Both",states:[],buyingSeasonNotes:"",notes:""},
      planId: campDraft.planId||"",
      ctx: campDraft.ctx||"",
      audienceMode: campDraft.audienceMode||"ai",
      audienceListId: campDraft.audienceListId||"",
      batchSize: campDraft.batchSize||25,
      metrics: campDraft.metrics||[],
      status: "draft",
      _draftStep: campStep, // remember which step they were on
      createdAt: existingCamp?.createdAt||today(),
      color: existingCamp?.color||CAMP_COLORS[campaigns.length % CAMP_COLORS.length],
    };
    if(isEditing) dispatch("UPDATE_CAMPAIGN", camp);
    else dispatch("ADD_CAMPAIGN", camp);
    // Update draft id so subsequent saves use UPDATE not ADD
    setCampDraft(d=>({...d, id: campId}));
    toast(`Draft saved — come back any time to continue`,"success");
  };

  const markContacted = (campId, contactId) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    const enroll = (camp.enrollments||[]).find(e=>e.contactId===contactId);
    if(!enroll) return;
    const nextStep = enroll.step+1;
    const done = nextStep>=(camp.touches||[]).length;
    const nextTouch = (camp.touches||[])[nextStep];
    const nextDate = nextTouch?new Date(Date.now()+nextTouch.dayOffset*86400000).toISOString().slice(0,10):null;
    dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(e=>
      e.contactId===contactId?{...e,step:nextStep,status:done?"done":"active",nextDate:nextDate||e.nextDate,lastContacted:today()}:e
    )});
    dispatch("SCORE_CONTACT",{contactId,type:"sent",campaignId:campId,note:"Touch sent"});
  };

  const markReplied = (campId, contactId) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(e=>
      e.contactId===contactId?{...e,status:"replied"}:e
    )});
    dispatch("UPDATE_CONTACT",{id:contactId,outreachStatus:"replied"});
    dispatch("SCORE_CONTACT",{contactId,type:"replied",campaignId:campId,note:"Replied to campaign"});
  };

  const sendOneEmail = async (camp, enroll) => {
    const c = contactMap[enroll.contactId];
    if(!c?.email) return {ok:false,reason:"no email"};
    const touch = (camp.touches||[])[enroll.step];
    if(!touch) return {ok:false,reason:"no touch"};
    const co = s.company||{};
    const rep = camp.repId ? (s.reps||[]).find(r=>r.id===camp.repId) : null;
    const sigParts=rep
      ? [rep.name,rep.title,rep.email,rep.phone,co.website].filter(Boolean)
      : [co.ownerName||co.name,co.email,co.phone,co.website].filter(Boolean);
    const sigText=sigParts.length?"\n\n—\n"+sigParts.join("\n"):"";
    const subject=mergeTags(touch.subject,c)||`Following up — ${camp.product||camp.name}`;
    const plainBody=mergeTags(touch.body,c)+sigText;
    const eid=`${camp.id}~${enroll.contactId}~${enroll.step}`;
    const trackUrl=`${window.location.origin}/api/track/open?eid=${encodeURIComponent(eid)}`;
    const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const htmlLines=plainBody.split("\n").map(l=>l.trim()?`<p style="margin:0 0 10px 0">${esc(l)}</p>`:"<br>").join("");
    const htmlBody=`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;max-width:600px;margin:0 auto;padding:20px 24px">${htmlLines}<img src="${trackUrl}" width="1" height="1" style="display:none" alt=""></body></html>`;
    try{
      const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"send",
          to_email:c.email,
          to_name:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),
          subject,
          body:plainBody,
          htmlBody,
          // Send from the rep's own Gmail if they have a key, otherwise shared account
          ...(rep?.gmailEnvKey ? {repEnvKey:rep.gmailEnvKey} : {}),
          // Reply-To = rep's email so replies land in their inbox (fallback if no own Gmail)
          ...(!rep?.gmailEnvKey && rep?.email ? {reply_to:rep.email, from_name:rep.name} : {}),
          // BCC quote tracker if this touch is marked as a pricing email
          ...(touch.isQuote && co.quoteTrackEmail ? {bcc:co.quoteTrackEmail} : {}),
        })});
      const d=await r.json();
      return d.sent?{ok:true}:{ok:false,reason:d.error||"send failed"};
    }catch(err){return {ok:false,reason:err.message};}
  };

  const BATCH_SIZE = 25;
  const BETWEEN_EMAILS = 3000;

  // Execute exactly one batch of BATCH_SIZE contacts, then stop.
  // If more remain, stores them in pendingBatch so the user can manually trigger next.
  const executeBatch = async ({campId, queue, batchNum, sentSoFar, failedSoFar, firstErr: prevErr}) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp){setPendingBatch(null);return;}
    const batch = queue.slice(0,BATCH_SIZE);
    const remaining = queue.slice(BATCH_SIZE);
    const totalBatches = Math.ceil((queue.length)/BATCH_SIZE) + (batchNum - 1); // approx
    setSending(true);
    let sent=0, failed=0, firstErr=prevErr||null;
    const todayStr=today();
    // snapshot enrollments so we can update them
    const updatedEnrollments=[...(camp.enrollments||[])];
    const dealsToCreate=[];
    toast(`Sending batch ${batchNum} — ${batch.length} contacts…`,"info");
    for(const enroll of batch){
      const res=await sendOneEmail(camp,enroll);
      if(res.ok){
        const idx=updatedEnrollments.findIndex(e=>e.contactId===enroll.contactId);
        if(idx>=0){
          const nextStep=enroll.step+1;
          const done=nextStep>=(camp.touches||[]).length;
          const nextTouch=(camp.touches||[])[nextStep];
          const nextDate=nextTouch?new Date(Date.now()+nextTouch.dayOffset*86400000).toISOString().slice(0,10):null;
          updatedEnrollments[idx]={...updatedEnrollments[idx],step:nextStep,status:done?"done":"active",nextDate:nextDate||enroll.nextDate,lastContacted:todayStr,lastSentAt:todayStr};
        }
        dispatch("SCORE_CONTACT",{contactId:enroll.contactId,type:"sent",campaignId:campId,note:`Touch ${enroll.step+1} sent`});
        const _zc=contactMap[enroll.contactId];if(_zc?.zohoId) pushActivityToZoho(_zc,`Campaign email sent: ${camp.name} - Touch ${enroll.step+1}`);
        // Auto-create deal if this touch is flagged as a pricing/quote email
        const _touch=(camp.touches||[])[enroll.step];
        if(_touch?.isQuote){
          const _c=contactMap[enroll.contactId];
          const _school=typeof _c?.school==="string"?_c.school:_c?.school?.name||"";
          const _name=_c?.fullName||`${_c?.firstName||""} ${_c?.lastName||""}`.trim();
          dealsToCreate.push({id:mkId(),name:`${_name} — ${camp.product||camp.name}`,school:_school,contact:_name,value:0,stage:"Quoted",product:camp.product||camp.name,priority:"medium",createdAt:todayStr,followUpDate:new Date(Date.now()+7*86400000).toISOString().slice(0,10),notes:`Auto-created: campaign "${camp.name}" touch ${enroll.step+1}`});
        }
        sent++;
        if(sent<batch.length) await new Promise(r=>setTimeout(r,BETWEEN_EMAILS));
      } else {
        failed++;
        const failEmail=contactMap[enroll.contactId]?.email||"unknown";
        if(!firstErr) firstErr=`${failEmail}: ${res.reason}`;
        console.warn("[campaign send] failed for",failEmail,"→",res.reason);
      }
    }
    dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:updatedEnrollments});
    dealsToCreate.forEach(deal=>{
      dispatch("ADD_DEAL",deal);
      fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:"/Deals",method:"POST",body:{data:[{Deal_Name:deal.name,Amount:0,Stage:"Quoted",Closing_Date:deal.followUpDate,Description:deal.notes||""}]}})})
        .then(r=>r.json()).then(dd=>{const _zid=dd?.data?.[0]?.details?.id;if(_zid) dispatch("UPDATE_DEAL",{id:deal.id,zohoId:_zid});}).catch(()=>{});
    });
    if(dealsToCreate.length>0) toast(`${dealsToCreate.length} deal${dealsToCreate.length!==1?"s":""} created in RevOps + pushed to Zoho`,"success");
    setSending(false);
    const totalSent=sentSoFar+sent, totalFailed=failedSoFar+failed;
    if(remaining.length>0){
      setPendingBatch({campId,queue:remaining,batchNum:batchNum+1,sentSoFar:totalSent,failedSoFar:totalFailed,firstErr});
      toast(`Batch ${batchNum} done — ${sent} sent${failed?`, ${failed} failed`:""}. ${remaining.length} contacts remaining. Click SEND NEXT BATCH when ready.`,"success");
    } else {
      setPendingBatch(null);
      toast(`All done! Total: ${totalSent} sent${totalFailed?`, ${totalFailed} failed — first error: ${firstErr}`:""}`,totalSent>0?"success":"error");
    }
  };

  const sendDueEmails = async (campId, sendAll=false) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    // If there's already a pending batch for this campaign, just resume it
    if(pendingBatch?.campId===campId){executeBatch(pendingBatch);return;}
    const todayStr=today();
    const queue=(camp.enrollments||[]).filter(e=>
      e.status==="active" && !contactMap[e.contactId]?.optedOut &&
      (sendAll || (e.nextDate||todayStr)<=todayStr)
    );
    if(!queue.length){toast(sendAll?"No active enrollments":"No emails due today — try SEND ALL","info");return;}
    executeBatch({campId,queue,batchNum:1,sentSoFar:0,failedSoFar:0,firstErr:null});
  };

  const checkReplies = async (campId) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    const activeEnrolls=(camp.enrollments||[]).filter(e=>e.status==="active");
    const activeEmails=activeEnrolls.map(e=>contactMap[e.contactId]?.email).filter(Boolean);
    if(!activeEmails.length){toast("No active enrollments with email","info");return;}
    setCheckingReplies(true);
    try{
      const query=activeEmails.slice(0,15).map(e=>`from:${e}`).join(" OR ");
      const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"list",query,maxResults:50})});
      const data=await r.json();
      const repliedSet=new Set((data.messages||[]).map(m=>{
        const match=m.from?.match(/<([^>]+)>/)||m.from?.match(/([^\s]+@[^\s]+)/);
        return match?.[1]?.toLowerCase();
      }).filter(Boolean));
      let found=0;
      activeEnrolls.forEach(e=>{
        const c=contactMap[e.contactId];
        if(c?.email&&repliedSet.has(c.email.toLowerCase())){markReplied(campId,e.contactId);found++;}
      });
      toast(found>0?`Found ${found} repl${found!==1?"ies":"y"}!`:"No new replies detected",found>0?"success":"info");
    }catch(err){toast("Reply check failed: "+err.message,"error");}
    setCheckingReplies(false);
  };

  const checkOpens = async (campId) => {
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    setCheckingOpens(true);
    try{
      const r=await fetch(`/api/track/open?list=1&seqId=${encodeURIComponent(campId)}`);
      const data=await r.json();
      const openMap={};
      (data.opens||[]).forEach(o=>{
        if(!openMap[o.contactId]||o.openedAt>openMap[o.contactId]) openMap[o.contactId]=o.openedAt;
      });
      let found=0;
      const updatedEnrollments=(camp.enrollments||[]).map(e=>{
        const openedAt=openMap[e.contactId];
        if(openedAt&&!e.openedAt){dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"opened",campaignId:campId,note:"Opened email (tracked)"});found++;return {...e,openedAt};}
        return e;
      });
      if(found>0) dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:updatedEnrollments});
      toast(found>0?`${found} contact${found!==1?"s":""} opened an email!`:"No new opens detected",found>0?"success":"info");
    }catch(err){toast("Open check failed: "+err.message,"error");}
    setCheckingOpens(false);
  };

  const openTouchEdit = (idx) => {
    const t = selCamp?.touches?.[idx];
    if(!t) return;
    setEditingTouchIdx(idx);
    setTouchDraft({subject:t.subject||"",body:t.body||""});
  };
  const saveTouchEdit = () => {
    if(!selCamp||editingTouchIdx===null) return;
    dispatch("UPDATE_CAMPAIGN",{...selCamp,touches:(selCamp.touches||[]).map((t,i)=>i===editingTouchIdx?{...t,...touchDraft}:t)});
    setEditingTouchIdx(null);
    toast("Email updated","success");
  };

  const addCampPost = (campId) => {
    if(!postDraft.caption.trim()) return;
    const camp = campaigns.find(c=>c.id===campId);
    if(!camp) return;
    const post = {id:mkId(),...postDraft,campId,createdAt:today()};
    dispatch("UPDATE_CAMPAIGN",{...camp,socialPosts:[...(camp.socialPosts||[]),post]});
    setPostDraft({date:"",platforms:[],caption:"",imageUrl:"",type:"post"});
    setShowAddPost(false);
    toast("Post added to campaign","success");
  };

  const postCampPostNow = async (campId, post) => {
    try{
      const r=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({post:post.caption,platforms:post.platforms,mediaUrls:post.imageUrl?[post.imageUrl]:[]})});
      const d=await r.json();
      if(d.status==="success"||d.postIds?.length){
        const camp=campaigns.find(c=>c.id===campId);
        if(camp) dispatch("UPDATE_CAMPAIGN",{...camp,socialPosts:(camp.socialPosts||[]).map(p=>p.id===post.id?{...p,posted:true,postedAt:today()}:p)});
        toast("Posted successfully","success");
      }else{toast(d.error||"Post failed","error");}
    }catch(e){toast(e?.message||"Post failed","error");}
  };

  const calDaysInMonth=(y,m)=>new Date(y,m+1,0).getDate();
  const calFirstDay=(y,m)=>new Date(y,m,1).getDay();
  const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAY_NAMES=["Su","Mo","Tu","We","Th","Fr","Sa"];
  const getCalDayEvents=(y,m,d)=>{
    const dateStr=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const events=[];
    campaigns.forEach(camp=>{
      (camp.touches||[]).forEach(touch=>{
        const base=camp.startDate||camp.createdAt||today();
        const d2=new Date(base); d2.setDate(d2.getDate()+(touch.dayOffset||0));
        if(d2.toISOString().slice(0,10)===dateStr) events.push({type:"email",campName:camp.name,label:touch.subject||`Touch ${touch.step}`,color:camp.color||B.orange});
      });
      (camp.socialPosts||[]).forEach(post=>{
        if((post.date||"")===dateStr) events.push({type:"social",campName:camp.name,label:post.caption?.slice(0,30)||"Post",color:camp.color||B.orange});
      });
    });
    return events;
  };

  const ASSET_TYPE_OPTIONS = [
    {id:"email3",label:"3-Touch Email Sequence"},
    {id:"email5",label:"5-Touch Email Sequence"},
    {id:"social3",label:"3 Social Posts"},
    {id:"social6",label:"6 Social Posts"},
    {id:"adcopy",label:"Ad Copy"},
    {id:"callscript",label:"Call Script"},
    {id:"directmail",label:"Direct Mail Letter"},
  ];
  const COMMON_TITLES = ["Athletic Director","Head Coach","Assistant Coach","Procurement Manager","Principal","Club Director","League Administrator"];
  const SEGMENT_OPTIONS = ["High School","College","All School Levels","Youth / Club Sports","Professional / Semi-Pro"];

  return (
    <div style={{padding:"22px 26px"}}>
      <PH title="CAMPAIGNS" sub="Strategy builder, campaign wizard, and execution hub"/>
      <div style={{display:"flex",gap:5,marginBottom:18,flexWrap:"wrap"}}>
        {[["plans","PLANS"],["campaigns","CAMPAIGNS"],["calendar","CALENDAR"],["adengine","AD ENGINE"],["reps","REP DASHBOARD"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {tab==="adengine"&&<ModAds/>}

      {/* ── REP DASHBOARD TAB ──────────────────────────────────────────────────── */}
      {tab==="reps"&&(
        <div>
          {(s.reps||[]).length===0?(
            <div className="card" style={{padding:40,textAlign:"center"}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,marginBottom:8}}>No reps yet</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:16}}>Add your sales team in Settings to track their campaigns and pipeline.</div>
              <OBtn sm onClick={()=>dispatch("SET_MOD","settings")}>GO TO SETTINGS →</OBtn>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
              {(s.reps||[]).map(rep=>{
                const repCamps=campaigns.filter(c=>c.repId===rep.id);
                const enrolledCount=repCamps.reduce((sum,c)=>{return sum+(c.enrollments||[]).filter(e=>e.status==="active").length;},0);
                const todayStr=today();
                const dueCount=repCamps.reduce((sum,c)=>{return sum+(c.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr).length;},0);
                const repDeals=(s.deals||[]).filter(d=>d.repId===rep.id||d.assignedTo===rep.id||(d.assignedTo&&d.assignedTo===rep.email));
                const pipeline=repDeals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)).reduce((s,d)=>s+(parseFloat(d.amount)||0),0);
                return(
                  <div key={rep.id} className="card" style={{padding:16,borderTop:`3px solid ${B.blue}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:B.blue,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.white}}>{(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
                      </div>
                      <div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600}}>{rep.name}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{rep.title||""}{rep.email?` · ${rep.email}`:""}</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                      {[[repCamps.length,"Campaigns",B.orange],[enrolledCount,"Enrolled",B.blue],[dueCount,"Due Today",dueCount>0?B.red:B.muted]].map(([v,l,c])=>(
                        <div key={l} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 10px",textAlign:"center"}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:c}}>{v}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    {repCamps.length>0&&(
                      <div style={{marginBottom:10}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:6}}>CAMPAIGNS</div>
                        <div style={{display:"flex",flexDirection:"column",gap:3}}>
                          {repCamps.slice(0,4).map(c=>(
                            <div key={c.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"3px 0",borderBottom:`1px solid ${B.border}22`}}>
                              {c.name}
                              <span style={{color:B.muted,marginLeft:4}}>· {(c.enrollments||[]).filter(e=>e.status==="active").length} active</span>
                            </div>
                          ))}
                          {repCamps.length>4&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>+{repCamps.length-4} more</div>}
                        </div>
                      </div>
                    )}
                    {repDeals.length>0&&(
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>
                        {repDeals.length} deal{repDeals.length!==1?"s":""}
                        {pipeline>0&&<span style={{color:B.green}}> · ${pipeline.toLocaleString()} pipeline</span>}
                      </div>
                    )}
                    <OBtn sm onClick={()=>setTab("campaigns")}>VIEW CAMPAIGNS →</OBtn>
                  </div>
                );
              })}
            </div>
          )}
          {/* Daily Email Summary */}
          {(()=>{
            // Build last 7 days
            const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().slice(0,10);});
            // All users (USERS + appUsers) who have campaigns
            const allUsers=(s.reps||[]);
            // Build a map: repId -> Set of campaignIds
            const repCampIds={};
            (s.campaigns||[]).forEach(camp=>{
              if(camp.repId){
                if(!repCampIds[camp.repId]) repCampIds[camp.repId]=new Set();
                repCampIds[camp.repId].add(camp.id);
              }
            });
            const repsWithCamps=allUsers.filter(u=>repCampIds[u.id]);
            if(!repsWithCamps.length) return null;
            // Build sent count: repId -> date -> count
            // Activities live on contacts
            const counts={};
            repsWithCamps.forEach(u=>{counts[u.id]={};});
            (s.contacts||[]).forEach(c=>{
              (c.activity||[]).forEach(a=>{
                if(a.type!=="sent") return;
                const camp=(s.campaigns||[]).find(x=>x.id===a.campaignId);
                if(!camp||!camp.repId) return;
                if(!counts[camp.repId]) return;
                const dateStr=new Date(a.ts).toISOString().slice(0,10);
                if(!counts[camp.repId][dateStr]) counts[camp.repId][dateStr]=0;
                counts[camp.repId][dateStr]++;
              });
            });
            return(
              <div style={{marginTop:24}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:12}}>DAILY EMAIL SUMMARY — LAST 7 DAYS</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
                    <thead>
                      <tr>
                        <th style={{textAlign:"left",padding:"6px 10px",background:B.surface,border:`1px solid ${B.border}`,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,minWidth:80}}>DATE</th>
                        {repsWithCamps.map(u=>(
                          <th key={u.id} style={{padding:"6px 10px",background:B.surface,border:`1px solid ${B.border}`,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:.5,textAlign:"center",minWidth:80}}>
                            <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:u.color||B.muted,flexShrink:0}}/>
                              <span style={{color:u.color||B.muted}}>{(u.name||"?").split(" ")[0].toUpperCase()}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map(dateStr=>{
                        const isToday=dateStr===today();
                        return(
                          <tr key={dateStr} style={{background:isToday?`${B.orange}06`:B.white}}>
                            <td style={{padding:"6px 10px",border:`1px solid ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:10,color:isToday?B.orange:B.text,fontWeight:isToday?600:400}}>
                              {new Date(dateStr+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}{isToday?" (today)":""}
                            </td>
                            {repsWithCamps.map(u=>{
                              const cnt=counts[u.id]?.[dateStr]||0;
                              return(
                                <td key={u.id} style={{padding:"6px 10px",border:`1px solid ${B.border}`,textAlign:"center",color:cnt>0?u.color||B.text:B.muted,fontWeight:cnt>0?600:400,fontSize:12}}>
                                  {cnt>0?cnt:"—"}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── PLANS TAB ──────────────────────────────────────────────────────── */}
      {tab==="plans"&&(
        <div>
          {!selPlanId&&!showNewPlanForm&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>{strategies.length} PLAN{strategies.length!==1?"S":""}</div>
                <OBtn sm onClick={()=>{setPlanDraft({name:"",icp:{sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:""},segment:"All School Levels",seasonStart:"",seasonEnd:"",goals:""});setShowNewPlanForm(true);setSelPlanId(null);setPlanSuggestions(null);setMatchingContacts(null);}}>+ NEW PLAN</OBtn>
              </div>
              {strategies.length===0?(
                <div className="card" style={{padding:40,textAlign:"center"}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,marginBottom:8}}>No plans yet — build a marketing plan to organize your campaigns</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:18}}>A marketing plan defines your sport focus, target area, segment, and goals — then AI suggests campaigns to achieve them.</div>
                  <OBtn onClick={()=>{setPlanDraft({name:"",icp:{sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:""},seasonStart:"",seasonEnd:"",goals:""});setShowNewPlanForm(true);setMatchingContacts(null);}}>+ CREATE FIRST PLAN</OBtn>
                </div>
              ):(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {strategies.map(plan=>{
                    const linkedCamps=campaigns.filter(c=>c.planId===plan.id).length;
                    return(
                      <div key={plan.id} onClick={()=>setSelPlanId(plan.id)} className="card fu"
                        style={{padding:0,overflow:"hidden",cursor:"pointer",borderTop:`3px solid ${B.orange}`}}>
                        <div style={{padding:"14px 16px"}}>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,marginBottom:5}}>{plan.name}</div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>
                            {plan.sport&&<span style={{marginRight:8}}>{plan.sport}</span>}
                            {(plan.states||[]).length>0&&<span>{(plan.states||[]).join(", ")}</span>}
                          </div>
                          {plan.segment&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3,display:"inline-block",marginBottom:6}}>{plan.segment}</div>}
                          {(plan.seasonStart||plan.seasonEnd)&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{plan.seasonStart||""}{plan.seasonEnd?` → ${plan.seasonEnd}`:""}</div>}
                          {plan.goals&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,marginBottom:8,lineHeight:1.4}}>{plan.goals.slice(0,80)}{plan.goals.length>80?"...":""}</div>}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {linkedCamps>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}14`,padding:"2px 6px",borderRadius:3}}>{linkedCamps} campaign{linkedCamps!==1?"s":""}</span>}
                          </div>
                        </div>
                        <div style={{borderTop:`1px solid ${B.border}`,padding:"8px 16px",background:B.surface,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete "${plan.name}"?`)){dispatch("DEL_STRATEGY",plan.id);}}} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif",padding:0}}>✕ DELETE</button>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5}}>OPEN →</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* New Plan Form */}
          {showNewPlanForm&&planDraft&&(
            <div style={{maxWidth:760}}>
              <div className="card" style={{padding:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>{editingPlanId?"EDIT MARKETING PLAN":"NEW MARKETING PLAN"}</div>
                  <GBtn onClick={()=>{setShowNewPlanForm(false);setPlanDraft(null);setPlanSuggestions(null);setMatchingContacts(null);setEditingPlanId(null);if(editingPlanId)setSelPlanId(editingPlanId);}}>CANCEL</GBtn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div style={{gridColumn:"1/-1"}}><Lbl s={{marginBottom:4}}>Plan Name</Lbl><input value={planDraft.name} onChange={e=>setPlanDraft(d=>({...d,name:e.target.value}))} placeholder="e.g. Spring Track & Field 2026" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                  <div><Lbl s={{marginBottom:4}}>Season Start</Lbl><input type="date" value={planDraft.seasonStart||""} onChange={e=>setPlanDraft(d=>({...d,seasonStart:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
                  <div><Lbl s={{marginBottom:4}}>Season End</Lbl><input type="date" value={planDraft.seasonEnd||""} onChange={e=>setPlanDraft(d=>({...d,seasonEnd:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
                </div>
                <div style={{marginBottom:16}}>
                  <Lbl s={{marginBottom:4}}>Goals</Lbl>
                  <textarea value={planDraft.goals||""} onChange={e=>setPlanDraft(d=>({...d,goals:e.target.value}))} rows={3} placeholder="e.g. Drive 20 quotes in Iowa T&F ADs before Jan buying window, build brand awareness..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.5}}/>
                </div>

                {/* ICP SECTION */}
                <div style={{borderTop:`2px solid ${B.border}`,paddingTop:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1,marginBottom:12}}>IDEAL CUSTOMER PROFILE</div>

                  {/* Sport Focus */}
                  <div style={{marginBottom:14}}>
                    <Lbl s={{marginBottom:6}}>SPORT FOCUS</Lbl>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {[["ALL SPORTS","all",B.orange],["ALL SCHOOL SPORTS","school",B.blue]].map(([label,val,col])=>{
                        const on=(planDraft.icp?.sports||[]).includes(val);
                        return(<button key={val} onClick={()=>setPlanDraft(d=>({...d,icp:{...d.icp,sports:on?[]:[val]}}))} style={{background:on?col:B.surface,color:on?B.white:B.muted,border:`2px solid ${on?col:B.border}`,borderRadius:4,padding:"5px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{label}</button>);
                      })}
                      {SPORTS_LIST.map(sp=>{
                        const isMeta=(planDraft.icp?.sports||[]).includes("all")||(planDraft.icp?.sports||[]).includes("school");
                        const on=!isMeta&&(planDraft.icp?.sports||[]).includes(sp);
                        return(<button key={sp} onClick={()=>setPlanDraft(d=>{const cur=(d.icp?.sports||[]).filter(x=>x!=="all"&&x!=="school");const next=cur.includes(sp)?cur.filter(x=>x!==sp):[...cur,sp];return{...d,icp:{...d.icp,sports:next}};})} style={{background:on?`${B.orange}14`:B.surface,color:on?B.orange:isMeta?`${B.muted}60`:B.muted,border:`1px solid ${on?B.orange:B.border}`,borderRadius:3,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",opacity:isMeta?.5:1}}>{sp}</button>);
                      })}
                    </div>
                  </div>

                  {/* Target Titles */}
                  <div style={{marginBottom:14}}>
                    <Lbl s={{marginBottom:6}}>TARGET TITLES</Lbl>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {COMMON_TITLES.map(t=>{const on=(planDraft.icp?.titles||[]).includes(t);return(<button key={t} onClick={()=>setPlanDraft(d=>({...d,icp:{...d.icp,titles:on?(d.icp?.titles||[]).filter(x=>x!==t):[...(d.icp?.titles||[]),t]}}))} style={{background:on?`${B.blue}14`:B.surface,color:on?B.blue:B.muted,border:`1px solid ${on?B.blue:B.border}`,borderRadius:3,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{t}</button>);})}
                    </div>
                  </div>

                  {/* Segment */}
                  <div style={{marginBottom:14}}>
                    <Lbl s={{marginBottom:6}}>SEGMENT / SCHOOL LEVEL</Lbl>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {SEGMENT_OPTIONS.map(sl=>(
                        <button key={sl} onClick={()=>setPlanDraft(d=>({...d,icp:{...d.icp,schoolLevel:sl},segment:sl}))} style={{background:(planDraft.icp?.schoolLevel||"All School Levels")===sl?`${B.orange}14`:B.surface,color:(planDraft.icp?.schoolLevel||"All School Levels")===sl?B.orange:B.muted,border:`1px solid ${(planDraft.icp?.schoolLevel||"All School Levels")===sl?B.orange:B.border}`,borderRadius:3,padding:"6px 16px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{sl}</button>
                      ))}
                    </div>
                  </div>

                  {/* Target Area — Region-first */}
                  <div style={{marginBottom:14}}>
                    <Lbl s={{marginBottom:6}}>TARGET AREA</Lbl>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                      {Object.entries(US_REGIONS).map(([r,{states:rs,color}])=>{
                        const sel=(planDraft.icp?.regions||[]).includes(r);
                        return(
                          <button key={r} onClick={()=>setPlanDraft(d=>{const cur=d.icp?.regions||[];const newRegions=sel?cur.filter(x=>x!==r):[...cur,r];const newStates=[...new Set(newRegions.flatMap(rn=>US_REGIONS[rn]?.states||[]))];return{...d,icp:{...d.icp,regions:newRegions,states:newStates}};})} style={{background:sel?`${color}18`:B.surface,color:sel?color:B.muted,border:`2px solid ${sel?color:B.border}`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif",fontWeight:sel?600:400,cursor:"pointer"}}>
                            {r} <span style={{fontSize:9,opacity:.7}}>({rs.length})</span>
                          </button>
                        );
                      })}
                    </div>
                    {(planDraft.icp?.regions||[]).length>0&&(
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"8px",background:B.surface,borderRadius:4,border:`1px solid ${B.border}`}}>
                        {[...new Set((planDraft.icp?.regions||[]).flatMap(r=>US_REGIONS[r]?.states||[]))].map(st=>{
                          const on=(planDraft.icp?.states||[]).includes(st);
                          const regionColor=Object.entries(US_REGIONS).find(([,v])=>v.states.includes(st))?.[1]?.color||B.orange;
                          return(<button key={st} onClick={()=>setPlanDraft(d=>{const cur=d.icp?.states||[];const next=cur.includes(st)?cur.filter(x=>x!==st):[...cur,st];return{...d,icp:{...d.icp,states:next}};})} style={{background:on?`${regionColor}20`:B.white,color:on?regionColor:B.muted,border:`1px solid ${on?regionColor:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{st}</button>);
                        })}
                      </div>
                    )}
                    {(planDraft.icp?.states||[]).length>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>{(planDraft.icp?.states||[]).length} state{(planDraft.icp?.states||[]).length!==1?"s":""} selected</div>}
                  </div>

                  {/* Buying Season Notes */}
                  <div style={{marginBottom:10}}>
                    <Lbl s={{marginBottom:4}}>Buying Season Notes</Lbl>
                    <textarea value={planDraft.icp?.buyingSeasonNotes||""} onChange={e=>setPlanDraft(d=>({...d,icp:{...d.icp,buyingSeasonNotes:e.target.value}}))} rows={2} placeholder="e.g. Track ADs buy Nov-Jan for spring season..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
                  </div>
                </div>

                {/* FIND MATCHING CONTACTS */}
                <div style={{marginBottom:16}}>
                  <button onClick={()=>setMatchingContacts(findMatchingContacts(planDraft.icp))} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"7px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
                    ⊕ FIND MATCHING CONTACTS
                  </button>
                  {matchingContacts!==null&&(
                    <div style={{marginTop:10,padding:"10px 14px",background:`${B.purple}08`,border:`1px solid ${B.purple}20`,borderRadius:6}}>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.purple,marginBottom:6}}>{matchingContacts.length} contacts match this ICP</div>
                      {matchingContacts.length>0&&(
                        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
                          {matchingContacts.slice(0,8).map(c=>{
                            const name=c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim();
                            const title=typeof c.title==="string"?c.title:c.title?.name||"";
                            const school=typeof c.school==="string"?c.school:c.school?.name||"";
                            return(
                              <div key={c.id} style={{display:"flex",gap:8,padding:"5px 8px",background:B.white,borderRadius:4,border:`1px solid ${B.border}`}}>
                                <div style={{flex:1}}>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{name}</div>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{title}{school?` · ${school}`:""}{c.state?` · ${c.state}`:""}</div>
                                </div>
                              </div>
                            );
                          })}
                          {matchingContacts.length>8&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"4px 0"}}>...and {matchingContacts.length-8} more</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{display:"flex",gap:8,marginBottom:planSuggestions?20:0}}>
                  <OBtn onClick={suggestCampaignPlan} disabled={planSuggestRunning||!planDraft.name}>
                    {planSuggestRunning?"✦ GENERATING...":"✦ SUGGEST CAMPAIGN PLAN"}
                  </OBtn>
                  <OBtn onClick={()=>{
                    if(!planDraft.name.trim()){toast("Add a plan name first","error");return;}
                    const planId=editingPlanId||mkId();
                    const plan={id:planId,name:planDraft.name,sport:(planDraft.icp?.sports||[])[0]||"",states:planDraft.icp?.states||[],regions:planDraft.icp?.regions||[],segment:planDraft.icp?.schoolLevel||"All School Levels",seasonStart:planDraft.seasonStart,seasonEnd:planDraft.seasonEnd,goals:planDraft.goals,icp:{...planDraft.icp},channels:planDraft.channels||[],createdAt:today()};
                    if(editingPlanId){dispatch("UPDATE_STRATEGY",plan);setEditingPlanId(null);}else{dispatch("ADD_STRATEGY",plan);}
                    setShowNewPlanForm(false);setSelPlanId(planId);setPlanSuggestions(null);setMatchingContacts(null);toast(editingPlanId?"Plan updated":"Plan saved","success");
                  }} col={B.green} disabled={!planDraft.name.trim()}>{editingPlanId?"UPDATE PLAN":"SAVE PLAN"}</OBtn>
                </div>
                {planSuggestRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,padding:"10px 0"}}><Spin/>AI building campaign ideas for this plan…</div>}
                {planSuggestions&&planSuggestions.length>0&&(
                  <div style={{marginTop:16}}>
                    <Lbl s={{marginBottom:10}}>AI-SUGGESTED CAMPAIGNS</Lbl>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {planSuggestions.map((sug,i)=>(
                        <div key={i} className="card" style={{padding:"12px 14px",borderLeft:`3px solid ${B.orange}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1}}>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:600,marginBottom:4}}>{sug.name}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5,marginBottom:5}}>{sug.goal}</div>
                              {sug.timing&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,marginBottom:4}}>TIMING: {sug.timing}</div>}
                              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                                {(sug.channels||[]).map(ch=><span key={ch} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:`${B.orange}14`,padding:"2px 6px",borderRadius:3}}>{ch}</span>)}
                              </div>
                            </div>
                            <button onClick={()=>{
                              const savedPlan={id:mkId(),name:planDraft.name,sport:(planDraft.icp?.sports||[])[0]||"",states:planDraft.icp?.states||[],regions:planDraft.icp?.regions||[],segment:planDraft.icp?.schoolLevel||"All School Levels",seasonStart:planDraft.seasonStart,seasonEnd:planDraft.seasonEnd,goals:planDraft.goals,icp:{...planDraft.icp},channels:planDraft.channels||[],createdAt:today()};
                              dispatch("ADD_STRATEGY",savedPlan);
                              startNewCampaign(savedPlan);
                              setCampDraft(cd=>({...cd,name:sug.name,goal:sug.goal,channels:sug.channels||[],assetTypes:sug.assetTypes||[],planId:savedPlan.id}));
                              setShowNewPlanForm(false);
                              setTab("campaigns");
                              setPlanSuggestions(null);
                              setMatchingContacts(null);
                              toast("Plan saved — complete the campaign wizard","success");
                            }} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",flexShrink:0,marginLeft:10,whiteSpace:"nowrap"}}>CREATE CAMPAIGN →</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Plan Detail */}
          {selPlanId&&selPlan&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <button onClick={()=>setSelPlanId(null)} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>← BACK</button>
                  <div>
                    <input value={selPlan.name||""} onChange={e=>dispatch("UPDATE_STRATEGY",{...selPlan,name:e.target.value})} style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,letterSpacing:.2,marginBottom:2,border:"none",borderBottom:`1px solid ${B.border}`,background:"transparent",outline:"none",width:"100%",maxWidth:420}}/>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{selPlan.sport&&`${selPlan.sport} · `}{(selPlan.states||[]).join(", ")||""}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <OBtn sm onClick={()=>{startNewCampaign(selPlan);setTab("campaigns");}}>+ CAMPAIGN FROM PLAN</OBtn>
                  <button onClick={()=>{if(window.confirm("Delete this plan?")){{dispatch("DEL_STRATEGY",selPlan.id);setSelPlanId(null);}}}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>DELETE</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                <div className="card" style={{padding:"14px 16px",borderLeft:`4px solid ${B.orange}`}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1,marginBottom:6}}>PLAN GOALS</div>
                  <textarea value={selPlan.goals||""} onChange={e=>dispatch("UPDATE_STRATEGY",{...selPlan,goals:e.target.value})} placeholder="Describe the goals of this plan…" rows={4} style={{width:"100%",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5,border:"none",borderBottom:`1px solid ${B.border}`,background:"transparent",outline:"none",resize:"vertical"}}/>
                </div>
                <div className="card" style={{padding:"14px 16px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SEASON START</div>
                      <input type="date" value={selPlan.seasonStart||""} onChange={e=>dispatch("UPDATE_STRATEGY",{...selPlan,seasonStart:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"4px 7px",fontSize:11}}/>
                    </div>
                    <div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SEASON END</div>
                      <input type="date" value={selPlan.seasonEnd||""} onChange={e=>dispatch("UPDATE_STRATEGY",{...selPlan,seasonEnd:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"4px 7px",fontSize:11}}/>
                    </div>
                  </div>
                  {(selPlan.states||[]).length>0&&<div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:5}}>TARGET STATES</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{(selPlan.states||[]).map(st=><span key={st} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{st}</span>)}</div>
                  </div>}
                  <div style={{marginTop:8}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SEGMENT</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{selPlan.segment||"—"}</div>
                  </div>
                </div>
              </div>
              {/* Linked campaigns */}
              {(()=>{
                const linked=campaigns.filter(c=>c.planId===selPlan.id);
                return(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <Lbl>LINKED CAMPAIGNS ({linked.length})</Lbl>
                      <OBtn sm onClick={()=>{startNewCampaign(selPlan);setTab("campaigns");}}>+ NEW CAMPAIGN</OBtn>
                    </div>
                    {linked.length===0?(
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`}}>No campaigns linked to this plan yet. Use "AI SUGGEST" or create a campaign and link it to this plan.</div>
                    ):(
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                        {linked.map(camp=>{
                          const enrs=camp.enrollments||[];
                          const active=enrs.filter(e=>e.status==="active").length;
                          const sc=CAMP_STATUS_COLORS[camp.status]||B.muted;
                          return(
                            <div key={camp.id} onClick={()=>{setSelCampId(camp.id);setCampSubTab("strategy");setTab("campaigns");}} className="card fu" style={{padding:"12px 14px",cursor:"pointer",borderTop:`3px solid ${camp.color||B.orange}`}}>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:600,marginBottom:4}}>{camp.name}</div>
                              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sc,background:`${sc}18`,padding:"2px 5px",borderRadius:3}}>{(camp.status||"draft").toUpperCase()}</span>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:`${B.orange}14`,padding:"2px 5px",borderRadius:3}}>{active} enrolled</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* AI suggest campaigns for this plan — Flighting multi-select */}
                    <div style={{marginTop:16}}>
                      <button onClick={async()=>{
                        setPlanSuggestRunning(true);setPlanSuggestions(null);setFlightChecked({});setFlightDates({});
                        const result=await aiCall(
                          `You are a marketing strategist for ST1 Sports, a school/team sports equipment company.\n${ST1}\n\n`+
                          `MARKETING PLAN:\nPlan Name: ${selPlan.name}\nSport Focus: ${selPlan.sport||"General"}\n`+
                          `States/Areas: ${(selPlan.states||[]).join(", ")||"All"}\nSegment: ${selPlan.segment||"All Levels"}\n`+
                          `Season Window: ${selPlan.seasonStart||""} to ${selPlan.seasonEnd||""}\nGoals: ${selPlan.goals||"Drive awareness and quotes"}\n\n`+
                          `Generate 4-6 campaign ideas. Return JSON: {"campaigns":[{"name":"","goal":"","timing":"","channels":[],"assetTypes":[]}]}\n`+
                          `channels options: email, social, paid_ads, phone, sms\nassetTypes: email3, email5, social3, social6, adcopy, callscript, directmail`,
                          {json:true,tokens:1400}
                        );
                        setPlanSuggestions(result?.campaigns||[]);
                        setPlanSuggestRunning(false);
                      }} disabled={planSuggestRunning} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"8px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",opacity:planSuggestRunning?.7:1}}>
                        {planSuggestRunning?"✦ GENERATING...":"✦ AI SUGGEST CAMPAIGNS FOR THIS PLAN"}
                      </button>
                      {planSuggestRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,padding:"10px 0"}}><Spin/>Generating campaign ideas…</div>}
                      {planSuggestions&&planSuggestions.length>0&&(
                        <div style={{marginTop:12}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>SELECT CAMPAIGNS TO INCLUDE IN FLIGHT — check each and set dates</div>
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            {planSuggestions.map((sug,i)=>{
                              const checked=!!flightChecked[i];
                              const fd=flightDates[i]||{startDate:"",endDate:""};
                              return(
                                <div key={i} className="card" style={{padding:"12px 14px",borderLeft:`3px solid ${checked?B.green:B.border}`}}>
                                  <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                                    <input type="checkbox" checked={checked} onChange={()=>setFlightChecked(f=>({...f,[i]:!f[i]}))} style={{marginTop:3,flexShrink:0,accentColor:B.green,width:16,height:16}}/>
                                    <div style={{flex:1}}>
                                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:600,marginBottom:4}}>{sug.name}</div>
                                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5,marginBottom:5}}>{sug.goal}</div>
                                      {sug.timing&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,marginBottom:4}}>TIMING: {sug.timing}</div>}
                                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:checked?8:0}}>{(sug.channels||[]).map(ch=><span key={ch} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:`${B.orange}14`,padding:"2px 6px",borderRadius:3}}>{ch}</span>)}</div>
                                      {checked&&(
                                        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>START</span>
                                            <input type="date" value={fd.startDate} onChange={e=>setFlightDates(f=>({...f,[i]:{...fd,startDate:e.target.value}}))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                                          </div>
                                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>END</span>
                                            <input type="date" value={fd.endDate} onChange={e=>setFlightDates(f=>({...f,[i]:{...fd,endDate:e.target.value}}))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    <button onClick={()=>{
                                      startNewCampaign(selPlan);
                                      setCampDraft(cd=>({...cd,name:sug.name,goal:sug.goal||"",channels:sug.channels||[],assetTypes:sug.assetTypes||[],planId:selPlan.id,status:"draft"}));
                                      setTab("campaigns");
                                      setPlanSuggestions(null);
                                      toast("Campaign pre-filled — complete the wizard to launch","success");
                                    }} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap",letterSpacing:.3}}>USE THIS CAMPAIGN →</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {Object.values(flightChecked).some(Boolean)&&(
                            <div style={{marginTop:12}}>
                              <button onClick={()=>{
                                const checked=planSuggestions.filter((_,i)=>flightChecked[i]);
                                const created=[];
                                checked.forEach((_,ii)=>{
                                  const idx=planSuggestions.indexOf(planSuggestions.filter((_,i)=>flightChecked[i])[ii]);
                                  const realIdx=planSuggestions.findIndex((s,i)=>flightChecked[i]&&planSuggestions.filter((_,j)=>flightChecked[j]).indexOf(s)===ii);
                                });
                                planSuggestions.forEach((sug,i)=>{
                                  if(!flightChecked[i]) return;
                                  const fd=flightDates[i]||{};
                                  const campId=mkId();
                                  const planIcp=selPlan?.icp||{sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:""};
                                  const camp={id:campId,name:sug.name,product:"Track & Field Equipment",audience:"Athletic Director",tone:"friendly",goal:sug.goal||"",repId:"",startDate:fd.startDate||today(),endDate:fd.endDate||"",touches:[],enrollments:[],socialPosts:[],socialDrafts:[],adCopy:"",callScript:"",directMail:"",adIds:[],channels:sug.channels||[],metrics:["Opens","Replies","Quotes Sent"],assetTypes:sug.assetTypes||[],icp:{...planIcp},planId:selPlan.id,ctx:"",status:"draft",createdAt:today(),color:CAMP_COLORS[campaigns.length%CAMP_COLORS.length]};
                                  dispatch("ADD_CAMPAIGN",camp);
                                  created.push(campId);
                                });
                                setFlightChecked({});setFlightDates({});setPlanSuggestions(null);
                                toast(`Flight launched: ${created.length} campaign${created.length!==1?"s":""} created`,"success");
                              }} style={{background:B.green,color:B.white,border:"none",borderRadius:4,padding:"9px 20px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                                🚀 LAUNCH FLIGHT ({Object.values(flightChecked).filter(Boolean).length} campaign{Object.values(flightChecked).filter(Boolean).length!==1?"s":""})
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── CAMPAIGNS TAB ──────────────────────────────────────────────────────── */}
      {tab==="campaigns"&&(
        <div>
          {!selCampId&&!showNewCampForm&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>{campaigns.length} CAMPAIGN{campaigns.length!==1?"S":""}</div>
                <OBtn sm onClick={()=>startNewCampaign()}>+ NEW CAMPAIGN</OBtn>
              </div>
              {campaigns.length===0?(
                <div className="card" style={{padding:40,textAlign:"center"}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,marginBottom:8}}>No campaigns yet</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:18}}>Create a campaign to coordinate emails, social posts, and ads in one place</div>
                  <OBtn onClick={()=>startNewCampaign()}>+ CREATE FIRST CAMPAIGN</OBtn>
                </div>
              ):(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {campaigns.map(camp=>{
                    const enrs=camp.enrollments||[];
                    const active=enrs.filter(e=>e.status==="active").length;
                    const replied=enrs.filter(e=>e.status==="replied").length;
                    const sc=CAMP_STATUS_COLORS[camp.status]||B.muted;
                    return(
                      <div key={camp.id} onClick={()=>{
                        if(camp.status==="draft"&&camp._draftStep){
                          setCampDraft({...camp});
                          setCampStep(camp._draftStep||1);
                          setShowNewCampForm(true);
                          setShowTemplateSelect(false);
                        } else {
                          setSelCampId(camp.id);setCampSubTab("strategy");
                        }
                      }} className="card fu"
                        style={{padding:0,overflow:"hidden",cursor:"pointer",borderTop:`3px solid ${camp.color||B.orange}`}}>
                        <div style={{padding:"14px 16px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,flex:1,paddingRight:8}}>{camp.name}</div>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sc,background:`${sc}18`,padding:"2px 7px",borderRadius:3,letterSpacing:.5,flexShrink:0}}>{(camp.status||"draft").toUpperCase()}</span>
                          </div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{camp.product}{camp.audience?` · ${camp.audience}`:""}
                            {camp.repId&&(()=>{const rep=(s.reps||[]).find(r=>r.id===camp.repId);return rep?<span style={{marginLeft:6,fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:3}}>REP: {(rep.name||"").split(" ")[0].toUpperCase()}</span>:null;})()}</div>
                          {(camp.startDate||camp.endDate)&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>{camp.startDate||""}{camp.endDate?` → ${camp.endDate}`:""}</div>}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>✉ {(camp.touches||[]).length} touches</span>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}14`,padding:"2px 6px",borderRadius:3}}>{active} enrolled</span>
                            {replied>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 6px",borderRadius:3}}>{replied} replied</span>}
                            {(camp.socialPosts||[]).length>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,background:B.purpleBg,padding:"2px 6px",borderRadius:3}}>📱 {(camp.socialPosts||[]).length} posts</span>}
                          </div>
                        </div>
                        <div style={{borderTop:`1px solid ${B.border}`,padding:"8px 16px",background:B.surface,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete "${camp.name}"?`))dispatch("DELETE_CAMPAIGN",camp.id);}} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif",padding:0}}>✕ DELETE</button>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:camp.status==="draft"&&camp._draftStep?B.blue:B.orange,letterSpacing:.5}}>{camp.status==="draft"&&camp._draftStep?"CONTINUE →":"OPEN →"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {showTemplateSelect&&!showNewCampForm&&(
            <div style={{maxWidth:900}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>CHOOSE A TEMPLATE</div>
                <GBtn onClick={()=>setShowTemplateSelect(false)}>CANCEL</GBtn>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
                {CAMP_TEMPLATES.map(tpl=>(
                  <div key={tpl.id} onClick={()=>applyTemplate(tpl)} className="card fu" style={{padding:16,cursor:"pointer",borderTop:`3px solid ${tpl.id==="blank"?B.muted:B.orange}`}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,marginBottom:6}}>{tpl.name}</div>
                    {tpl.id!=="blank"&&<>
                      {tpl.goal&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8,lineHeight:1.4}}>{tpl.goal}</div>}
                      {tpl.channels.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                        {tpl.channels.map(ch=><span key={ch} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{ch}</span>)}
                      </div>}
                    </>}
                    {tpl.id==="blank"&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Start from scratch with no pre-filled fields.</div>}
                    <div style={{marginTop:10,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5}}>USE THIS →</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showNewCampForm&&campDraft&&(
            <div style={{maxWidth:900}}>
              {/* Wizard stepper — 4 steps: DEFINE, ASSETS NEEDED, BUILD ASSETS, SCHEDULE & LAUNCH */}
              <div style={{display:"flex",alignItems:"center",marginBottom:22,gap:0}}>
                {[["1","DEFINE","Name & channels"],["2","ASSETS","Choose assets"],["3","BUILD","Create content"],["4","SCHEDULE","Set dates"],["5","LAUNCH","Activate"]].map(([n,label,sub],i)=>{
                  const done=campStep>Number(n);const active=campStep===Number(n);
                  return(<React.Fragment key={n}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,flex:1}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:done?B.green:active?B.orange:B.surface,border:`2px solid ${done?B.green:active?B.orange:B.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Russo One',sans-serif",fontSize:13,color:done||active?B.white:B.muted,cursor:done?"pointer":"default"}} onClick={()=>done&&setCampStep(Number(n))}>{done?"✓":n}</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:active?B.orange:B.muted,letterSpacing:.5,textAlign:"center"}}>{label}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,textAlign:"center"}}>{sub}</div>
                    </div>
                    {i<4&&<div style={{flex:2,height:2,background:campStep>Number(n)?B.green:B.border,marginBottom:22}}/>}
                  </React.Fragment>);
                })}
                <div style={{marginLeft:"auto",paddingLeft:16,display:"flex",gap:8,alignItems:"center"}}>
                  <GBtn onClick={saveDraft} style={{fontSize:9,padding:"5px 12px",background:B.blueBg,color:B.blue,border:`1px solid ${B.blue}30`}}>💾 SAVE DRAFT</GBtn>
                  <GBtn onClick={()=>{setShowNewCampForm(false);setCampDraft(null);setSegResult(null);setSelectedContacts(new Set());setCampStep(1);}}>CANCEL</GBtn>
                </div>
              </div>

              {/* STEP 1: DEFINE */}
              {campStep===1&&(
              <div className="card" style={{padding:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>1 — DEFINE</div>
                  <button onClick={()=>{setShowNewCampForm(false);setCampDraft(null);setShowTemplateSelect(true);}} style={{background:"none",border:"none",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,cursor:"pointer",padding:0}}>← BACK TO TEMPLATES</button>
                </div>
                {campDraft.planId&&(()=>{const plan=strategies.find(p=>p.id===campDraft.planId);return plan?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"5px 10px",borderRadius:4,marginBottom:10}}>Part of plan: <strong>{plan.name}</strong></div>:null;})()}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div><Lbl s={{marginBottom:4}}>Campaign Name</Lbl><input value={campDraft.name} onChange={e=>setCampDraft(c=>({...c,name:e.target.value}))} placeholder="e.g. T&F Spring Push 2026" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                  <div><Lbl s={{marginBottom:4}}>Campaign Goal</Lbl><input value={campDraft.goal} onChange={e=>setCampDraft(c=>({...c,goal:e.target.value}))} placeholder="e.g. 5 new quotes, 10 meetings booked" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                  <div><Lbl s={{marginBottom:4}}>Product Focus</Lbl><select value={campDraft.product} onChange={e=>setCampDraft(c=>({...c,product:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>{PRODUCT_CATS.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><Lbl s={{marginBottom:4}}>Target Audience</Lbl><input value={campDraft.audience} onChange={e=>setCampDraft(c=>({...c,audience:e.target.value}))} placeholder="Athletic Director, Coach, all..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                  <div><Lbl s={{marginBottom:4}}>Start Date</Lbl><input type="date" value={campDraft.startDate} onChange={e=>setCampDraft(c=>({...c,startDate:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
                  <div><Lbl s={{marginBottom:4}}>End Date</Lbl><input type="date" value={campDraft.endDate||""} onChange={e=>setCampDraft(c=>({...c,endDate:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
                </div>
                <div style={{marginBottom:16}}>
                  <Lbl s={{marginBottom:8}}>CHANNELS — select all that apply</Lbl>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {CHANNELS.map(ch=>{
                      const on=(campDraft.channels||[]).includes(ch.id);
                      return(<button key={ch.id} onClick={()=>setCampDraft(c=>({...c,channels:on?c.channels.filter(x=>x!==ch.id):[...(c.channels||[]),ch.id]}))}
                        style={{background:on?`${B.orange}12`:B.surface,color:on?B.orange:B.text,border:`2px solid ${on?B.orange:B.border}`,borderRadius:6,padding:"10px 12px",textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:16}}>{ch.icon}</span>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:on?600:400}}>{ch.label}</span>
                        {on&&<span style={{marginLeft:"auto",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange}}>✓</span>}
                      </button>);
                    })}
                  </div>
                  {(campDraft.channels||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:6}}>Select at least one channel to reach your audience</div>}
                </div>
                <div style={{marginBottom:14}}>
                  <Lbl s={{marginBottom:4}}>Tone</Lbl>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {["friendly","professional","urgent","conversational"].map(t=>(
                      <button key={t} onClick={()=>setCampDraft(c=>({...c,tone:t}))} style={{background:campDraft.tone===t?`${B.orange}14`:B.white,color:campDraft.tone===t?B.orange:B.muted,border:`1px solid ${campDraft.tone===t?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{t}</button>
                    ))}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  <div>
                    <Lbl s={{marginBottom:4}}>Context / Angle</Lbl>
                    <textarea value={campDraft.ctx||""} onChange={e=>setCampDraft(c=>({...c,ctx:e.target.value}))} rows={3} placeholder="Season timing, specific offer, competitive angle..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,resize:"vertical",fontFamily:"'Lexend',sans-serif"}}/>
                  </div>
                  <div>
                    <Lbl s={{marginBottom:4}}>ASSIGNED REP</Lbl>
                    {(s.reps||[]).length===0?(
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"8px 10px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,lineHeight:1.5}}>
                        No reps yet — <button onClick={()=>dispatch("SET_MOD","settings")} style={{background:"none",border:"none",color:B.orange,fontFamily:"'Lexend',sans-serif",fontSize:11,cursor:"pointer",padding:0}}>add them in Settings →</button>
                      </div>
                    ):(
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        <button onClick={()=>setCampDraft(c=>({...c,repId:""}))} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:5,border:`2px solid ${!campDraft.repId?B.orange:B.border}`,background:!campDraft.repId?B.orangeBg:B.surface,cursor:"pointer"}}>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:!campDraft.repId?B.orange:B.muted}}>Company (no specific rep)</span>
                          {!campDraft.repId&&<span style={{marginLeft:"auto",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange}}>✓</span>}
                        </button>
                        {(s.reps||[]).map(rep=>(
                          <button key={rep.id} onClick={()=>setCampDraft(c=>({...c,repId:rep.id}))} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:5,border:`2px solid ${campDraft.repId===rep.id?B.orange:B.border}`,background:campDraft.repId===rep.id?B.orangeBg:B.surface,cursor:"pointer"}}>
                            <div style={{width:24,height:24,borderRadius:"50%",background:B.blue,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span></div>
                            <div style={{flex:1,textAlign:"left"}}>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:campDraft.repId===rep.id?B.orange:B.text,fontWeight:500}}>{rep.name}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{rep.email}</div>
                            </div>
                            {campDraft.repId===rep.id&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange}}>✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* ICP carried from plan — show summary if available */}
                {campDraft.planId&&(()=>{
                  const plan=strategies.find(p=>p.id===campDraft.planId);
                  const icp=plan?.icp||campDraft.icp;
                  if(!icp||(!(icp.sports||[]).length&&!(icp.titles||[]).length&&!(icp.states||[]).length)) return null;
                  return(
                    <div style={{padding:"8px 12px",background:`${B.blue}08`,border:`1px solid ${B.blue}20`,borderRadius:5,marginBottom:14}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.5,marginBottom:5}}>ICP FROM PLAN</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {(icp.sports||[]).map(sp=><span key={sp} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,background:`${B.orange}14`,borderRadius:3,padding:"2px 7px"}}>{sp}</span>)}
                        {(icp.titles||[]).map(t=><span key={t} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.blue,background:B.blueBg,borderRadius:3,padding:"2px 7px"}}>{t}</span>)}
                        {(icp.states||[]).length>0&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,background:B.surface,borderRadius:3,padding:"2px 7px"}}>{(icp.states||[]).length} states</span>}
                      </div>
                    </div>
                  );
                })()}
                {/* Find matching contacts */}
                <div style={{marginBottom:14}}>
                  <button onClick={()=>setMatchingContacts(findMatchingContacts(campDraft.icp))} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
                    ⊕ FIND MATCHING CONTACTS
                  </button>
                  {matchingContacts!==null&&(
                    <div style={{marginTop:8,padding:"10px 12px",background:`${B.purple}08`,border:`1px solid ${B.purple}20`,borderRadius:5}}>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.purple,marginBottom:5}}>{matchingContacts.length} contacts match this ICP</div>
                      <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:160,overflowY:"auto"}}>
                        {matchingContacts.slice(0,8).map(c=>{
                          const name=c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim();
                          const title=typeof c.title==="string"?c.title:c.title?.name||"";
                          const school=typeof c.school==="string"?c.school:c.school?.name||"";
                          return(<div key={c.id} style={{display:"flex",gap:6,padding:"4px 6px",background:B.white,borderRadius:3,border:`1px solid ${B.border}`}}>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,fontWeight:500,flex:1}}>{name}</span>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{title}{school?` · ${school}`:""}{c.state?` · ${c.state}`:""}</span>
                          </div>);
                        })}
                        {matchingContacts.length>8&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>...and {matchingContacts.length-8} more</div>}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{display:"flex",justifyContent:"flex-end"}}>
                  <OBtn onClick={()=>setCampStep(2)} disabled={!campDraft.name||!(campDraft.channels||[]).length}>NEXT: ASSETS NEEDED →</OBtn>
                </div>
              </div>
              )}

              {/* STEP 2: ASSETS CHECKLIST */}
              {campStep===2&&(
              <div className="card" style={{padding:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2,marginBottom:4}}>2 — ASSETS NEEDED</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:16}}>Select the asset types you want to build for this campaign. You'll generate them in the next step.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
                  {ASSET_TYPE_OPTIONS.map(opt=>{
                    const on=(campDraft.assetTypes||[]).includes(opt.id);
                    return(<button key={opt.id} onClick={()=>setCampDraft(c=>({...c,assetTypes:on?c.assetTypes.filter(x=>x!==opt.id):[...(c.assetTypes||[]),opt.id]}))}
                      style={{background:on?`${B.orange}12`:B.surface,color:on?B.orange:B.text,border:`2px solid ${on?B.orange:B.border}`,borderRadius:6,padding:"12px 14px",textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:on?600:400,flex:1}}>{opt.label}</span>
                      {on&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.orange}}>✓</span>}
                    </button>);
                  })}
                </div>
                {(campDraft.assetTypes||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,marginBottom:12}}>Select at least one asset type to proceed.</div>}
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <GBtn onClick={()=>setCampStep(1)}>← BACK</GBtn>
                  <OBtn onClick={()=>setCampStep(3)} disabled={(campDraft.assetTypes||[]).length===0}>NEXT: BUILD ASSETS →</OBtn>
                </div>
              </div>
              )}

              {/* STEP 3: BUILD ASSETS */}
              {campStep===3&&(
              <div className="card" style={{padding:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2,marginBottom:16}}>3 — BUILD ASSETS</div>
                <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
                  <OBtn onClick={generateAllAssets} disabled={genRunning||genSocialRunning||genAdRunning||genCallRunning||genMailRunning}>
                    {(genRunning||genSocialRunning||genAdRunning||genCallRunning||genMailRunning)?"✦ GENERATING ALL...":"✦ GENERATE ALL"}
                  </OBtn>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Or generate each section individually below</div>
                </div>
                {/* Email sequence */}
                {(campDraft.assetTypes||[]).some(t=>t==="email3"||t==="email5")&&(
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1}}>✉ EMAIL SEQUENCE</div>
                      <OBtn sm onClick={()=>generateTouches(emailGenDirection||undefined)} disabled={genRunning}>{genRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
                    </div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>CONTENT DIRECTION (optional)</div>
                      <textarea value={emailGenDirection} onChange={e=>setEmailGenDirection(e.target.value)} placeholder="e.g. Focus on spring season urgency, mention early-bird discount, emphasize team bonding angle…" rows={2} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.5}}/>
                    </div>
                    {genRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,marginBottom:10}}><Spin/>Writing emails…</div>}
                    {(campDraft.touches||[]).length>0&&(campDraft.touches||[]).map((t,i)=>(
                      <div key={t.id||i} className="card" style={{padding:12,marginBottom:8,borderLeft:`3px solid ${B.orange}`}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1,marginBottom:6}}>TOUCH {t.step} — DAY {t.dayOffset}</div>
                        <div style={{marginBottom:6}}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SUBJECT</div>
                          <input value={t.subject||""} onChange={e=>setCampDraft(c=>({...c,touches:(c.touches||[]).map((x,j)=>j===i?{...x,subject:e.target.value}:x)}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                        <div><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>BODY</div>
                          <textarea value={t.body||""} onChange={e=>setCampDraft(c=>({...c,touches:(c.touches||[]).map((x,j)=>j===i?{...x,body:e.target.value}:x)}))} rows={4} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/></div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>Tags: {'{{firstName}}'} {'{{orgName}}'} {'{{sport}}'}</div>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8,paddingTop:8,borderTop:`1px solid ${B.border}`}}>
                          <input type="checkbox" id={`iq-${i}`} checked={!!t.isQuote} onChange={e=>setCampDraft(c=>({...c,touches:(c.touches||[]).map((x,j)=>j===i?{...x,isQuote:e.target.checked}:x)}))} style={{accentColor:B.orange,cursor:"pointer"}}/>
                          <label htmlFor={`iq-${i}`} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:t.isQuote?B.orange:B.muted,cursor:"pointer"}}>💰 Pricing / Quote email — auto-creates deal &amp; BCCs quote tracker on send</label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Social posts */}
                {(campDraft.assetTypes||[]).some(t=>t==="social3"||t==="social6")&&(
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1}}>📱 SOCIAL POSTS</div>
                      <OBtn sm onClick={generateSocialDrafts} disabled={genSocialRunning}>{genSocialRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
                    </div>
                    {genSocialRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,marginBottom:10}}><Spin/>Writing social posts…</div>}
                    {(campDraft.socialDrafts||[]).length>0&&campDraft.socialDrafts.map((p,i)=>(
                      <div key={p.id||i} className="card" style={{padding:12,marginBottom:8,borderLeft:`3px solid ${B.purple}`}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1,marginBottom:6}}>POST {i+1} — {(p.platforms||[]).join(", ").toUpperCase()}</div>
                        <textarea value={p.caption||""} onChange={e=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,caption:e.target.value}:x)}))} rows={3} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                        <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                          {["instagram","facebook","linkedin","twitter","tiktok"].map(pl=>{const sel=(p.platforms||[]).includes(pl);return<button key={pl} onClick={()=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,platforms:sel?x.platforms.filter(v=>v!==pl):[...(x.platforms||[]),pl]}:x)}))} style={{background:sel?`${B.purple}14`:B.surface,color:sel?B.purple:B.muted,border:`1px solid ${sel?B.purple:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{pl}</button>;})}
                        </div>
                        {/* Image generation */}
                        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.border}`}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:5}}>IMAGE GENERATION</div>
                          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
                            <input value={p.imagePrompt||`${campDraft.product||"sports equipment"} for ${(campDraft.icp?.sports||["sports"])[0]} — social post visual`} onChange={e=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imagePrompt:e.target.value}:x)}))} placeholder="Image prompt..." style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                            <button onClick={async()=>{
                              const prompt=p.imagePrompt||`${campDraft.product||"sports equipment"} for ${(campDraft.icp?.sports||["sports"])[0]} — social post visual`;
                              setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageGenerating:true}:x)}));
                              try{
                                const r=await fetch("/api/adengine/generate-product-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,style:"lifestyle",sizeKey:"square"})});
                                const d=await r.json();
                                setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageUrl:d.imageUrl||"",imageGenerating:false}:x)}));
                              }catch(err){setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageGenerating:false}:x)}));}
                            }} disabled={p.imageGenerating} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,opacity:p.imageGenerating?.7:1}}>
                              {p.imageGenerating?"GENERATING...":"🎨 GENERATE IMAGE"}
                            </button>
                          </div>
                          {p.imageGenerating&&<div style={{display:"flex",gap:6,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.purple}}><Spin/>Generating image…</div>}
                          {p.imageUrl&&<img src={p.imageUrl} alt="Generated social post visual" style={{maxWidth:200,borderRadius:5,marginTop:4,border:`1px solid ${B.border}`}}/>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Ad Copy */}
                {(campDraft.assetTypes||[]).includes("adcopy")&&(
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1}}>⬛ AD COPY</div>
                      <OBtn sm onClick={generateAdCopy} disabled={genAdRunning}>{genAdRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
                    </div>
                    {genAdRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,marginBottom:10}}><Spin/>Writing ad copy…</div>}
                    <textarea value={campDraft.adCopy||""} onChange={e=>setCampDraft(c=>({...c,adCopy:e.target.value}))} rows={5} placeholder="Ad headline, primary text, and CTA variations…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                  </div>
                )}
                {/* Call Script */}
                {(campDraft.assetTypes||[]).includes("callscript")&&(
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:1}}>📞 CALL SCRIPT</div>
                      <OBtn sm onClick={generateCallScript} disabled={genCallRunning}>{genCallRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
                    </div>
                    {genCallRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,marginBottom:10}}><Spin/>Writing call script…</div>}
                    <textarea value={campDraft.callScript||""} onChange={e=>setCampDraft(c=>({...c,callScript:e.target.value}))} rows={6} placeholder="Opening, value prop, objection handling, CTA…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                  </div>
                )}
                {/* Direct Mail */}
                {(campDraft.assetTypes||[]).includes("directmail")&&(
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,letterSpacing:1}}>✉ DIRECT MAIL LETTER</div>
                      <OBtn sm onClick={generateDirectMail} disabled={genMailRunning}>{genMailRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
                    </div>
                    {genMailRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.teal,marginBottom:10}}><Spin/>Writing letter…</div>}
                    <textarea value={campDraft.directMail||""} onChange={e=>setCampDraft(c=>({...c,directMail:e.target.value}))} rows={6} placeholder="Direct mail letter with headline, benefits, CTA…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                  </div>
                )}
                {(()=>{
                  const types=campDraft.assetTypes||[];
                  const hasContent=(campDraft.touches||[]).length>0||(campDraft.adCopy||"").trim()||(campDraft.callScript||"").trim()||(campDraft.directMail||"").trim()||(campDraft.socialDrafts||[]).length>0;
                  const canProceed=hasContent;
                  return(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <GBtn onClick={()=>setCampStep(2)}>← BACK</GBtn>
                      <div>
                        {!canProceed&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6,textAlign:"right"}}>Generate at least one asset to continue</div>}
                        <OBtn onClick={()=>setCampStep(4)} disabled={!canProceed}>NEXT: SCHEDULE →</OBtn>
                      </div>
                    </div>
                  );
                })()}
              </div>
              )}

              {/* STEP 4: SCHEDULE */}
              {campStep===4&&(
              <div className="card" style={{padding:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2,marginBottom:4}}>4 — SCHEDULE & DATES</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:16}}>Assign scheduled dates to each asset. Email touches auto-calculate from campaign start date but can be overridden.</div>
                {/* Email touches schedule */}
                {(campDraft.touches||[]).length>0&&(
                  <div style={{marginBottom:20}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1,marginBottom:10}}>✉ EMAIL TOUCHES</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {(campDraft.touches||[]).map((t,i)=>{
                        const base=campDraft.startDate||today();
                        const autoDate=(()=>{const d=new Date(base);d.setDate(d.getDate()+(t.dayOffset||0));return d.toISOString().slice(0,10);})();
                        const scheduled=t.scheduledDate||autoDate;
                        return(
                          <div key={t.id||i} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,borderLeft:`3px solid ${B.orange}`}}>
                            <div style={{flex:1}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1}}>TOUCH {t.step} — DAY {t.dayOffset||0}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginTop:2}}>{t.subject||`Email Touch ${t.step}`}</div>
                            </div>
                            <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>SEND DATE</span>
                              <input type="date" value={scheduled} onChange={e=>setCampDraft(c=>({...c,touches:c.touches.map((x,j)=>j===i?{...x,scheduledDate:e.target.value}:x)}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Social drafts schedule */}
                {(campDraft.socialDrafts||[]).length>0&&(
                  <div style={{marginBottom:20}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1,marginBottom:10}}>📱 SOCIAL POSTS</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {campDraft.socialDrafts.map((p,i)=>(
                        <div key={p.id||i} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,borderLeft:`3px solid ${B.purple}`}}>
                          <div style={{flex:1}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,letterSpacing:1}}>POST {i+1} — {(p.platforms||[]).join(", ").toUpperCase()}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{(p.caption||"").slice(0,60)}{p.caption?.length>60?"...":""}</div>
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>POST DATE</span>
                            <input type="date" value={p.scheduledDate||""} onChange={e=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,scheduledDate:e.target.value}:x)}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Other assets schedule */}
                {((campDraft.adCopy||"").trim()||(campDraft.callScript||"").trim()||(campDraft.directMail||"").trim())&&(
                  <div style={{marginBottom:20}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>OTHER ASSETS — PLANNED DATE</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {(campDraft.adCopy||"").trim()&&(
                        <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>
                          <div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>⬛ Ad Copy</div>
                          <input type="date" value={campDraft.adCopyDate||""} onChange={e=>setCampDraft(c=>({...c,adCopyDate:e.target.value}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                        </div>
                      )}
                      {(campDraft.callScript||"").trim()&&(
                        <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>
                          <div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>📞 Call Script</div>
                          <input type="date" value={campDraft.callScriptDate||""} onChange={e=>setCampDraft(c=>({...c,callScriptDate:e.target.value}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                        </div>
                      )}
                      {(campDraft.directMail||"").trim()&&(
                        <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>
                          <div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>✉ Direct Mail Letter</div>
                          <input type="date" value={campDraft.directMailDate||""} onChange={e=>setCampDraft(c=>({...c,directMailDate:e.target.value}))} style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"4px 7px",fontSize:11}}/>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <GBtn onClick={()=>setCampStep(3)}>← BACK</GBtn>
                  <OBtn onClick={()=>setCampStep(5)}>NEXT: LAUNCH →</OBtn>
                </div>
              </div>
              )}

              {/* STEP 5: LAUNCH */}
              {campStep===5&&(
              <div className="card" style={{padding:20}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2,marginBottom:16}}>5 — LAUNCH</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:16}}>AI-match your contacts to find the best fit for this campaign, then select who to enroll.</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{(s.contacts||[]).length} contacts in database</div>
                  <button onClick={analyzeAudience} disabled={segRunning} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer",opacity:segRunning?.7:1}}>
                    {segRunning?"✦ ANALYZING...":"✦ AI SMART SEGMENT"}
                  </button>
                </div>
                {segRunning&&<div style={{display:"flex",gap:7,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,padding:"10px 0"}}><Spin/>AI matching contacts to campaign…</div>}
                {!segRunning&&!segResult&&(
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`,marginBottom:16}}>
                    Run Smart Segment to have AI find the best contacts for this campaign, or skip to launch and we'll enroll by audience keyword.
                  </div>
                )}
                {segResult&&(
                  <div style={{marginBottom:16}}>
                    {segResult.summary&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"8px 10px",background:`${B.purple}08`,border:`1px solid ${B.purple}20`,borderRadius:5,marginBottom:10,lineHeight:1.5}}>{segResult.summary}</div>}
                    {(()=>{
                      const byFit={high:[],medium:[],low:[]};
                      (segResult.segments||[]).forEach(sg=>{byFit[sg.fit]?.push(sg);});
                      return [["high","BEST MATCH",B.green],["medium","GOOD MATCH",B.orange],["low","POSSIBLE",B.muted]].map(([fit,label,color])=>{
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
                            <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:220,overflowY:"auto"}}>
                              {byFit[fit].map(sg=>{
                                const c=(s.contacts||[]).find(c=>c.id===sg.contactId);
                                if(!c) return null;
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
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,padding:"6px 10px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`,textAlign:"center"}}>{selectedContacts.size} contact{selectedContacts.size!==1?"s":""} selected for enrollment</div>
                  </div>
                )}
                {/* Audience mode: AI MATCH vs FROM LIST */}
                <div style={{marginBottom:16}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>AUDIENCE SOURCE</div>
                  <div style={{display:"flex",gap:0,background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden",width:"fit-content",marginBottom:12}}>
                    {[["ai","AI MATCH"],["list","FROM LIST"]].map(([mode,label])=>(
                      <button key={mode} onClick={()=>setCampDraft(c=>({...c,audienceMode:mode}))} style={{background:(campDraft.audienceMode||"ai")===mode?B.orange:"transparent",color:(campDraft.audienceMode||"ai")===mode?B.white:B.muted,border:"none",padding:"7px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{label}</button>
                    ))}
                  </div>
                  {(campDraft.audienceMode||"ai")==="list"&&(
                    <div>
                      {(s.contactLists||[]).length===0?(
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>No contact lists found — create lists in the Contacts section first.</div>
                      ):(
                        <select value={campDraft.audienceListId||""} onChange={e=>setCampDraft(c=>({...c,audienceListId:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:campDraft.audienceListId?B.text:B.muted,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",marginBottom:8}}>
                          <option value="">— select a contact list —</option>
                          {(s.contactLists||[]).map(list=>(
                            <option key={list.id} value={list.id}>{list.name} ({(list.contactIds||[]).length} contacts)</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
                {/* Batch size */}
                <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,flexShrink:0}}>BATCH SIZE</div>
                  <input type="number" min={1} max={500} value={campDraft.batchSize||25} onChange={e=>setCampDraft(c=>({...c,batchSize:Math.max(1,parseInt(e.target.value)||25)}))} style={{width:80,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>contacts per day — stagger enrollment (first batch starts day 0, next on day 1, etc.)</span>
                </div>
                <div style={{padding:"10px 14px",background:`${B.green}08`,border:`1px solid ${B.green}20`,borderRadius:6,marginBottom:18}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6}}>
                    {(campDraft.audienceMode||"ai")==="list"&&campDraft.audienceListId
                      ? (()=>{const lst=(s.contactLists||[]).find(l=>l.id===campDraft.audienceListId);const cnt=(lst?.contactIds||[]).length;return <span>Launching will enroll <strong>{cnt} contacts</strong> from list <strong>{lst?.name||""}</strong>, staggered in batches of <strong>{campDraft.batchSize||25}</strong> per day.</span>;})()
                      : <span>Launching will enroll <strong>{selectedContacts.size||(s.contacts||[]).filter(c=>campDraft.audience==="all"||!campDraft.audience||(c.title||"").toLowerCase().includes((campDraft.audience||"").toLowerCase().split(" ")[0])).length} contacts</strong> and set the campaign to <strong>active</strong>.</span>
                    }
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <GBtn onClick={()=>setCampStep(4)}>← BACK</GBtn>
                  <OBtn onClick={saveCampaign} style={{fontSize:13,padding:"10px 28px"}}>🚀 LAUNCH CAMPAIGN</OBtn>
                </div>
              </div>
              )}
            </div>
          )}

          {selCamp&&!showNewCampForm&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <button onClick={()=>setSelCampId(null)} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>← BACK</button>
                  <div>
                    <input value={selCamp.name||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,name:e.target.value})} style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,letterSpacing:.2,marginBottom:2,border:"none",borderBottom:`1px solid ${B.border}`,background:"transparent",outline:"none",width:"100%",maxWidth:420}}/>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{selCamp.product}{selCamp.audience?` · ${selCamp.audience}`:""}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <select value={selCamp.status||"draft"} onChange={e=>dispatch("UPDATE_CAMPAIGN",{...selCamp,status:e.target.value})}
                    style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,color:B.text,fontFamily:"'Lexend',sans-serif"}}>
                    {["draft","active","paused","completed","running"].map(sv=><option key={sv} value={sv}>{sv.toUpperCase()}</option>)}
                  </select>
                  <button onClick={()=>{if(window.confirm("Delete this campaign?")) {dispatch("DELETE_CAMPAIGN",selCamp.id);setSelCampId(null);}}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>DELETE</button>
                </div>
              </div>
              {/* Sub-tabs */}
              <div style={{display:"flex",gap:0,marginBottom:16,background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden",width:"fit-content"}}>
                {[["strategy","📋 STRATEGY"],["assets","🛠 ASSETS"],["execute","▶ EXECUTE"],["report","📈 REPORT"]].map(([id,l])=>(
                  <button key={id} onClick={()=>setCampSubTab(id)} style={{background:campSubTab===id?B.orange:"transparent",color:campSubTab===id?B.white:B.muted,border:"none",padding:"8px 18px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>{l}</button>
                ))}
              </div>

              {/* STRATEGY TAB */}
              {campSubTab==="strategy"&&(
                <div>
                  {/* Launch banner for draft/no-enrollment campaigns */}
                  {(selCamp.status==="draft"||(selCamp.enrollments||[]).length===0)&&(selCamp.touches||[]).length>0&&(
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:`${B.orange}10`,border:`1px solid ${B.orange}30`,borderRadius:6,marginBottom:14}}>
                      <div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.5,marginBottom:2}}>READY TO LAUNCH</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>This campaign has {(selCamp.touches||[]).length} emails ready. Enroll contacts and activate it.</div>
                      </div>
                      <OBtn onClick={()=>{setCampDraft({...selCamp});setShowNewCampForm(true);setCampStep(5);setSelCampId(null);}}>🚀 ENROLL & LAUNCH</OBtn>
                    </div>
                  )}
                  {/* Plan link */}
                  {selCamp.planId&&(()=>{const plan=strategies.find(p=>p.id===selCamp.planId);return plan?(<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"5px 10px",borderRadius:4,marginBottom:12,cursor:"pointer"}} onClick={()=>{setSelPlanId(plan.id);setSelCampId(null);setTab("plans");}}>Part of plan: <strong>{plan.name}</strong> — view plan →</div>):null;})()}
                  {/* Strategy header — inline editable */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                    {/* Left: Goal + context — editable */}
                    <div className="card" style={{padding:"14px 16px",borderLeft:`4px solid ${selCamp.color||B.orange}`}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1,marginBottom:6}}>CAMPAIGN GOAL</div>
                      <textarea value={selCamp.goal||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,goal:e.target.value})} placeholder="Describe the goal of this campaign…" rows={3} style={{width:"100%",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,lineHeight:1.4,border:"none",borderBottom:`1px solid ${B.border}`,background:"transparent",outline:"none",resize:"vertical",marginBottom:10}}/>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>CONTEXT / ANGLE</div>
                      <textarea value={selCamp.ctx||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,ctx:e.target.value})} placeholder="Additional context or angle for AI…" rows={2} style={{width:"100%",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6,border:"none",borderBottom:`1px solid ${B.border}`,background:"transparent",outline:"none",resize:"vertical"}}/>
                    </div>
                    {/* Right: Details — editable */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>START DATE</div>
                          <input type="date" value={selCamp.startDate||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,startDate:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}/>
                        </div>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>END DATE</div>
                          <input type="date" value={selCamp.endDate||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,endDate:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}/>
                        </div>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>PRODUCT</div>
                          <input value={selCamp.product||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,product:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}/>
                        </div>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>AUDIENCE</div>
                          <input value={selCamp.audience||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,audience:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}/>
                        </div>
                      </div>
                      <div>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>REP / SENDER</div>
                        <select value={selCamp.repId||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,repId:e.target.value})} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}>
                          <option value="">— No rep assigned —</option>
                          {(s.reps||[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  {/* Channels — editable */}
                  <div className="card" style={{padding:"12px 16px",marginBottom:12}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>CHANNELS</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {CHANNELS.map(ch=>{
                        const on=(selCamp.channels||[]).includes(ch.id);
                        return(<button key={ch.id} onClick={()=>{const cur=selCamp.channels||[];const next=on?cur.filter(x=>x!==ch.id):[...cur,ch.id];dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,channels:next});}} style={{background:on?`${B.orange}14`:B.surface,color:on?B.orange:B.muted,border:`1px solid ${on?B.orange:B.border}`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{ch.icon} {ch.label}</button>);
                      })}
                    </div>
                  </div>
                  {/* ICP — editable */}
                  <div className="card" style={{padding:"12px 16px",marginBottom:12}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5,marginBottom:10}}>IDEAL CUSTOMER PROFILE</div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:5}}>SPORTS</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {SPORTS_LIST.slice(0,12).map(sp=>{const on=(selCamp.icp?.sports||[]).includes(sp);return(<button key={sp} onClick={()=>{const cur=(selCamp.icp?.sports||[]);const next=on?cur.filter(x=>x!==sp):[...cur,sp];dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,icp:{...(selCamp.icp||{}),sports:next}});}} style={{background:on?`${B.orange}14`:B.surface,color:on?B.orange:B.muted,border:`1px solid ${on?B.orange:B.border}`,borderRadius:3,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{sp}</button>);})}
                      </div>
                    </div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:5}}>TARGET TITLES</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {COMMON_TITLES.map(t=>{const on=(selCamp.icp?.titles||[]).includes(t);return(<button key={t} onClick={()=>{const cur=(selCamp.icp?.titles||[]);const next=on?cur.filter(x=>x!==t):[...cur,t];dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,icp:{...(selCamp.icp||{}),titles:next}});}} style={{background:on?`${B.blue}14`:B.surface,color:on?B.blue:B.muted,border:`1px solid ${on?B.blue:B.border}`,borderRadius:3,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{t}</button>);})}
                      </div>
                    </div>
                    <div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:5}}>SCHOOL LEVEL</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {SEGMENT_OPTIONS.map(sl=>{const on=(selCamp.icp?.schoolLevel||"All School Levels")===sl;return(<button key={sl} onClick={()=>dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,icp:{...(selCamp.icp||{}),schoolLevel:sl}})} style={{background:on?`${B.orange}14`:B.surface,color:on?B.orange:B.muted,border:`1px solid ${on?B.orange:B.border}`,borderRadius:3,padding:"4px 12px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{sl}</button>);})}
                      </div>
                    </div>
                  </div>
                  {/* Metrics — editable */}
                  <div className="card" style={{padding:"12px 16px",marginBottom:12}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>METRICS TO TRACK</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {METRICS.map(m=>{const on=(selCamp.metrics||[]).includes(m);return(<button key={m} onClick={()=>{const cur=selCamp.metrics||[];const next=on?cur.filter(x=>x!==m):[...cur,m];dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,metrics:next});}} style={{background:on?`${B.blue}10`:B.surface,color:on?B.blue:B.muted,border:`1px solid ${on?B.blue:B.border}`,borderRadius:4,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{on?"☑":"☐"} {m}</button>);})}
                    </div>
                    </div>
                  )}
                  {/* Quick stats */}
                  {(()=>{
                    const enrs=selCamp.enrollments||[];
                    const activeN=enrs.filter(e=>e.status==="active").length;
                    const sentN=enrs.reduce((n,e)=>n+(e.step||0),0);
                    const openedN=enrs.filter(e=>e.openedAt).length;
                    const repliedN=enrs.filter(e=>e.status==="replied").length;
                    const doneN=enrs.filter(e=>e.status==="done").length;
                    const todayStr=today();
                    const dueN=enrs.filter(e=>e.status==="active"&&(e.nextDate||todayStr)<=todayStr).length;
                    return(
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:8,marginBottom:14}}>
                        {[["ENROLLED",enrs.length,B.blue],["ACTIVE",activeN,B.orange],["DUE TODAY",dueN,dueN>0?B.red:B.muted],["SENT",sentN,B.purple],["OPENED",openedN,B.blue],["REPLIED",repliedN,B.green],["DONE",doneN,B.muted]].map(([l,v,c])=>(
                          <div key={l} style={{background:B.white,border:`1px solid ${c}30`,borderRadius:6,padding:"10px 12px",textAlign:"center"}}>
                            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:c,lineHeight:1}}>{v}</div>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginTop:3}}>{l}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {/* Actions */}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <OBtn sm onClick={()=>setCampSubTab("execute")} disabled={(selCamp.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||today())<=today()).length===0}>▶ EXECUTE{(selCamp.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||today())<=today()).length>0?` (${(selCamp.enrollments||[]).filter(e=>e.status==="active"&&(e.nextDate||today())<=today()).length} DUE)`:""}</OBtn>
                    <GBtn sm onClick={()=>setCampSubTab("assets")}>🛠 ASSETS</GBtn>
                    <GBtn sm onClick={()=>setCampSubTab("report")}>📈 REPORT</GBtn>
                  </div>
                </div>
              )}

              {/* EXECUTE TAB */}
              {campSubTab==="execute"&&(<>
              {(()=>{
                const enrs=selCamp.enrollments||[];
                const touches=selCamp.touches||[];
                const rep=selCamp.repId?(s.reps||[]).find(r=>r.id===selCamp.repId):null;

                // Advance a single enrollment to the next step (shared by both send functions)
                const advanceEnroll=(updEnr,enroll,todStr,camp)=>{
                  const idx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
                  if(idx<0) return;
                  const ns=enroll.step+1;
                  const done=ns>=(camp.touches||[]).length;
                  const nt=(camp.touches||[])[ns];
                  const nd=nt?new Date(Date.now()+nt.dayOffset*86400000).toISOString().slice(0,10):null;
                  updEnr[idx]={...updEnr[idx],step:ns,status:done?"done":"active",nextDate:nd||enroll.nextDate,lastContacted:todStr,lastSentAt:todStr};
                };

                // One-batch sender — sends exactly this list of enrollments for their current step
                // Skips contacts marked "interested" and marks them as done after the batch
                const sendOneBatch=async(batchEnrollments,batchKey)=>{
                  const camp=campaigns.find(c=>c.id===selCamp.id);
                  if(!camp||sending) return;
                  setSending(true);
                  try {
                  let sent=0,failed=0,skipped=0,firstErr=null;
                  const todStr=today();
                  const updEnr=[...(camp.enrollments||[])];
                  const activeCount=batchEnrollments.filter(e=>e.status!=="interested").length;
                  toast(`Sending ${activeCount} emails…`,"info");
                  for(const enroll of batchEnrollments){
                    // Skip interested contacts — they expressed interest, don't continue emailing
                    if(enroll.status==="interested"){ skipped++; continue; }
                    // Double-send guard: re-check current enrollment step from updEnr before sending.
                    // If this contact already advanced (from a prior send in this batch or a concurrent session),
                    // skip them to prevent duplicate emails.
                    const guardIdx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
                    if(guardIdx>=0 && updEnr[guardIdx].step!==enroll.step){ skipped++; continue; }
                    const res=await sendOneEmail(camp,enroll);
                    if(res.ok){
                      advanceEnroll(updEnr,enroll,todStr,camp);
                      dispatch("SCORE_CONTACT",{contactId:enroll.contactId,type:"sent",campaignId:selCamp.id,note:`Touch ${enroll.step+1} sent`});
                      const _zc=contactMap[enroll.contactId];if(_zc?.zohoId)pushActivityToZoho(_zc,`Campaign email sent: ${camp.name}`);
                      sent++;
                      if(sent<activeCount) await new Promise(r=>setTimeout(r,BETWEEN_EMAILS));
                    } else {
                      failed++;
                      const fe=contactMap[enroll.contactId]?.email||"unknown";
                      if(!firstErr) firstErr=`${fe}: ${res.reason}`;
                    }
                  }
                  // Mark interested contacts in this batch as done — segment is complete for them
                  for(const enroll of batchEnrollments){
                    if(enroll.status==="interested"){
                      const idx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
                      if(idx>=0) updEnr[idx]={...updEnr[idx],status:"done",interestedAt:updEnr[idx].interestedAt||todStr};
                    }
                  }
                  const finalCamp=campaignsRef.current.find(c=>c.id===camp.id)||camp;
                  dispatch("UPDATE_CAMPAIGN",{...finalCamp,enrollments:updEnr});
                  if(batchKey) setBatchSentMap(m=>({...m,[batchKey]:{sent,failed}}));
                  const skipNote=skipped?` · ${skipped} interested (moved to done)`:"";
                  toast(`${sent} sent${failed?`, ${failed} failed — ${firstErr}`:""}${skipNote}`,sent>0||skipped>0?"success":"error");
                  } catch(err) {
                    console.error("[sendOneBatch]",err);
                    toast(`Send failed: ${err.message}`,"error");
                  } finally {
                    setSending(false);
                  }
                };

                // Mark a batch as already sent (no emails — just advances enrollment state)
                // Also skips and marks interested contacts as done
                const markBatchSent=async(batchEnrollments,batchKey)=>{
                  const camp=campaigns.find(c=>c.id===selCamp.id);
                  if(!camp) return;
                  const todStr=today();
                  const updEnr=[...(camp.enrollments||[])];
                  let advanced=0,skipped=0;
                  for(const enroll of batchEnrollments){
                    if(enroll.status==="interested"){
                      // Mark as done — segment complete, they've expressed interest
                      const idx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
                      if(idx>=0) updEnr[idx]={...updEnr[idx],status:"done",interestedAt:updEnr[idx].interestedAt||todStr};
                      skipped++;
                    } else {
                      advanceEnroll(updEnr,enroll,todStr,camp);
                      advanced++;
                    }
                  }
                  const freshMarkCamp=campaignsRef.current.find(c=>c.id===camp.id)||camp;
                  const updCamp={...freshMarkCamp,enrollments:updEnr};
                  dispatch("UPDATE_CAMPAIGN",updCamp);
                  if(batchKey) setBatchSentMap(m=>({...m,[batchKey]:{sent:advanced,failed:0}}));
                  const skipNote=skipped?` · ${skipped} interested moved to done`:"";
                  toast(`${advanced} contacts advanced${skipNote}`,"success");
                };

                // Totals for stats row
                const allSent=enrs.filter(e=>e.lastSentAt||e.step>0).length;
                const replied=enrs.filter(e=>e.status==="replied").length;
                const interested=enrs.filter(e=>e.status==="interested").length;
                const done=enrs.filter(e=>e.status==="done").length;
                const totalPending=enrs.filter(e=>e.status==="active"&&!contactMap[e.contactId]?.optedOut).length;

                return(<>
                  {/* Rep + Gmail status */}
                  {rep&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:rep.gmailEnvKey?`${B.green}08`:`${B.yellow}10`,border:`1px solid ${rep.gmailEnvKey?B.green+"30":B.yellow+"60"}`,borderRadius:5,marginBottom:12}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:rep.gmailEnvKey?B.green:B.yellow,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span></div>
                      <div style={{flex:1}}>
                        {rep.gmailEnvKey
                          ?<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>Sending from <strong>{rep.name}</strong>'s Gmail account ({rep.gmailEnvKey})</span>
                          :<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>⚠️ <strong>{rep.name}</strong> has no personal Gmail configured — emails will send from your account with their signature. <a href="#settings" onClick={()=>setMod("settings")} style={{color:B.blue}}>Settings → Sales Reps → Edit → set Gmail Key</a>.</span>
                        }
                      </div>
                      <button onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,repId:""})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>CHANGE REP</button>
                    </div>
                  )}

                  {/* Stats — also serve as filter tabs */}
                  <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                    {[["all","ALL",enrs.length,B.blue],["active","PENDING",totalPending,B.orange],["sent","SENT",allSent,B.purple],["replied","REPLIED",replied,B.green],["interested","INTERESTED",interested,"#0f9"[0]?B.teal:B.teal],["done","DONE",done,B.muted]].map(([filter,l,v,c])=>{
                      const active=executeFilter===filter;
                      return(
                        <button key={filter} onClick={()=>setExecuteFilter(filter)}
                          style={{background:active?c:B.white,color:active?B.white:B.muted,border:`1px solid ${active?c:B.border}`,borderRadius:5,padding:"5px 12px",textAlign:"center",minWidth:60,cursor:"pointer",transition:"all .15s"}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:active?B.white:c,lineHeight:1}}>{v}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,letterSpacing:.5,marginTop:2,opacity:.85}}>{l}</div>
                        </button>
                      );
                    })}
                    <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
                      <button onClick={()=>checkReplies(selCamp.id)} disabled={checkingReplies||checkingOpens} style={{background:B.surface,color:B.blue,border:`1px solid ${B.blue}30`,borderRadius:5,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{checkingReplies?"CHECKING...":"↻ REPLIES"}</button>
                      <button onClick={()=>checkOpens(selCamp.id)} disabled={checkingOpens||checkingReplies} style={{background:B.surface,color:B.purple,border:`1px solid ${B.purple}30`,borderRadius:5,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{checkingOpens?"CHECKING...":"👁 OPENS"}</button>
                    </div>
                  </div>

                  {/* ── INTERESTED section ── */}
                  {interested>0&&(
                    <div style={{marginBottom:20,border:`2px solid ${B.teal}`,borderRadius:8,overflow:"hidden"}}>
                      <div onClick={()=>setIntCollapsed(x=>!x)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:`${B.teal}12`,cursor:"pointer",userSelect:"none"}}>
                        <span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.teal}}>🎯</span>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,letterSpacing:1}}>INTERESTED · {interested} contact{interested!==1?"s":""}</div>
                          {!intCollapsed&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>These contacts showed positive intent — convert them to deals now</div>}
                        </div>
                        <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,opacity:.7}}>{intCollapsed?"▼ SHOW":"▲ HIDE"}</span>
                      </div>
                      {!intCollapsed&&(
                      <div style={{display:"flex",flexDirection:"column",gap:0}}>
                        {enrs.filter(e=>e.status==="interested").map((e,idx)=>{
                          const c=contactMap[e.contactId];
                          if(!c) return null;
                          const name=c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim();
                          const school=typeof c.school==="string"?c.school:c.school?.name||"";
                          const title=typeof c.title==="string"?c.title:c.title?.name||"";
                          // Find ANY deal for this contact, including closed-lost
                          const anyDeal=(s.deals||[]).find(d=>d.contactId===c.id);
                          const activeDeal=anyDeal&&!["Closed Lost"].includes(anyDeal.stage)?anyDeal:null;
                          const closedLostDeal=anyDeal&&anyDeal.stage==="Closed Lost"?anyDeal:null;
                          return(
                            <div key={e.contactId} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderTop:idx>0?`1px solid ${B.teal}30`:"none",background:closedLostDeal?`${B.red}06`:B.white}}>
                              <div style={{width:32,height:32,borderRadius:"50%",background:closedLostDeal?`${B.red}20`:`${B.teal}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:closedLostDeal?B.red:B.teal}}>{name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:600}}>{name}</div>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{title}{school?` · ${school}`:""}</div>
                                {c.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.green}}>✉ {c.email}</div>}
                              </div>
                              {activeDeal?(
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"3px 8px",borderRadius:4,flexShrink:0}}>✓ DEAL · {activeDeal.stage}</span>
                              ):closedLostDeal?(
                                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                                  <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:`${B.red}15`,padding:"3px 8px",borderRadius:4}}>✗ CLOSED LOST</span>
                                  <button onClick={()=>{
                                    const dealId=mkId();
                                    dispatch("ADD_DEAL",{id:dealId,contactId:c.id,name:`${selCamp.product||"Equipment"} — ${school||name}`,company:school||name,stage:"Qualified Lead",value:"",notes:`Re-engaged via campaign: ${selCamp.name}. Previously closed lost.`,createdAt:today(),updatedAt:today()});
                                    toast(`New deal created for ${name}`,"success");
                                  }} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"5px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                                    ↺ RE-OPEN DEAL
                                  </button>
                                </div>
                              ):(
                                <button onClick={()=>{
                                  const dealId=mkId();
                                  dispatch("ADD_DEAL",{id:dealId,contactId:c.id,name:`${selCamp.product||"Equipment"} — ${school||name}`,company:school||name,stage:"Qualified Lead",value:"",notes:`From campaign: ${selCamp.name}. Marked interested on ${today()}.`,createdAt:today(),updatedAt:today()});
                                  toast(`Deal created for ${name}`,"success");
                                }} style={{background:B.teal,color:B.white,border:"none",borderRadius:5,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                                  + CREATE DEAL
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  )}

                  {/* Per-touch sections */}
                  {touches.map((touch,ti)=>{
                    // Only contacts at exactly this step are eligible to receive this touch
                    const pending=enrs.filter(e=>e.step===ti&&e.status==="active"&&!contactMap[e.contactId]?.optedOut);
                    // Contacts who already received this touch (step has moved past ti)
                    const receivedCount=enrs.filter(e=>e.step>ti||(e.step===ti&&["done","replied","interested","not_interested","unsubscribed"].includes(e.status))).length;
                    const touchBatches=[];
                    for(let i=0;i<pending.length;i+=BATCH_SIZE) touchBatches.push(pending.slice(i,i+BATCH_SIZE));
                    const allDone=pending.length===0;

                    return(
                      <div key={ti} style={{marginBottom:14,border:`1px solid ${allDone?B.green+"60":B.border}`,borderRadius:7,overflow:"hidden"}}>
                        {/* Touch header */}
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:allDone?`${B.green}08`:ti===0?`${B.orange}08`:B.surface}}>
                          <div style={{width:28,height:28,borderRadius:"50%",background:allDone?B.green:B.orange,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white}}>{allDone?"✓":ti+1}</span>
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:allDone?B.green:B.orange,letterSpacing:.5}}>EMAIL {ti+1} · DAY {touch.dayOffset}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginTop:1,fontWeight:500}}>{touch.subject||"(no subject)"}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>
                              {allDone
                                ?`✓ All ${receivedCount} contacts received this email`
                                :`${pending.length} pending · ${receivedCount} already sent · ${touchBatches.length} batch${touchBatches.length!==1?"es":""}`
                              }
                            </div>
                          </div>
                          {allDone&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"3px 8px",borderRadius:4,letterSpacing:.5}}>COMPLETE</span>}
                        </div>

                        {/* Batches for this touch */}
                        {!allDone&&(
                          <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:6,borderTop:`1px solid ${B.border}`}}>
                            {touchBatches.map((batch,bi)=>{
                              const isFirst=bi===0;
                              const expKey=`${ti}-${bi}`;
                              const isExp=batchExpanded[expKey]??(bi===0);
                              // Stable key based on first contact ID so it survives re-indexing
                              const batchKey=`${selCamp.id}-${ti}-${batch[0]?.contactId||bi}`;
                              const wasSent=!!batchSentMap[batchKey];
                              return(
                                <div key={batchKey} style={{border:`1px solid ${wasSent?B.green:isFirst?B.orange:B.border}`,borderRadius:5,overflow:"hidden"}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:wasSent?`${B.green}08`:isFirst?`${B.orange}06`:B.white}}>
                                    <div style={{flex:1,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:wasSent?B.green:isFirst?B.orange:B.muted,letterSpacing:.5}}>BATCH {bi+1}</span>
                                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{batch.length} contacts</span>
                                      {wasSent&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"2px 7px",borderRadius:3}}>✓ SENT {batchSentMap[batchKey].sent}{batchSentMap[batchKey].failed>0?` · ${batchSentMap[batchKey].failed} failed`:""}</span>}
                                      <button onClick={()=>setBatchExpanded(x=>({...x,[expKey]:!isExp}))} style={{background:"none",border:"none",fontSize:10,color:B.muted,cursor:"pointer",padding:0}}>{isExp?"▲ hide":"▼ show"}</button>
                                    </div>
                                    {!wasSent&&(
                                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                                        <button onClick={()=>sendOneBatch(batch,batchKey)} disabled={sending}
                                          style={{background:sending?B.muted:isFirst?B.orange:B.surface,color:sending?B.white:isFirst?B.white:B.text,border:`1px solid ${isFirst?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                                          {sending&&isFirst?"SENDING...":"▶ SEND ("+batch.length+")"}
                                        </button>
                                        <button onClick={()=>markBatchSent(batch,batchKey)} disabled={sending}
                                          title="Mark as already sent — advances contacts without sending emails"
                                          style={{background:B.surface,color:B.green,border:`1px solid ${B.green}50`,borderRadius:4,padding:"6px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                                          ✓ MARK SENT
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {isExp&&(
                                    <div style={{borderTop:`1px solid ${B.border}`,padding:"6px 12px",display:"flex",flexDirection:"column",gap:3}}>
                                      {batch.map(e=>{
                                        const c=contactMap[e.contactId];
                                        if(!c) return null;
                                        return(
                                          <div key={e.contactId} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",borderBottom:`1px solid ${B.border}`}}>
                                            <div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}</div>
                                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.email}</span>
                                            {c.school&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{typeof c.school==="string"?c.school:c.school?.name||""}</span>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {touches.length===0&&<div style={{padding:14,background:B.surface,borderRadius:6,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No email touches configured. Go to the Assets tab to generate emails for this campaign.</div>}
                </>);
              })()}
              {/* Sequence touchpoints — editable */}
              <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"flex-start"}}>
                {(selCamp.touches||[]).map((t,i)=>(
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
              {/* ── Enroll contacts panel ── */}
              {(()=>{
                const enrolledIds=new Set((selCamp.enrollments||[]).map(e=>e.contactId));
                const q=(enrollSearch||"").toLowerCase().trim();
                // Filter contacts by search (name/title/school/email/state) and not already enrolled
                const matchingContacts=(s.contacts||[]).filter(c=>{
                  if(enrolledIds.has(c.id)) return false;
                  if(!q) return true;
                  return [c.fullName,c.firstName,c.lastName,c.title,c.school,c.email,c.state,c.city].some(v=>(v||"").toLowerCase().includes(q));
                });
                // Also support enroll-from-list
                const enrollList=enrollListId?(s.contactLists||[]).find(l=>l.id===enrollListId):null;
                const listContacts=enrollList?(enrollList.contactIds||[]).map(id=>(s.contacts||[]).find(c=>c.id===id)).filter(Boolean).filter(c=>!enrolledIds.has(c.id)):[];
                const toEnroll=enrollListId?listContacts:matchingContacts;

                const doEnroll=()=>{
                  if(!toEnroll.length){toast("No contacts to enroll","warn");return;}
                  const todayStr=today();
                  const updated={...selCamp,enrollments:[...(selCamp.enrollments||[])]};
                  let count=0;
                  toEnroll.forEach(c=>{
                    if(!updated.enrollments.some(e=>e.contactId===c.id)){
                      updated.enrollments=[...updated.enrollments,{contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr}];
                      dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:selCamp.id,note:`Enrolled in ${selCamp.name}`});
                      count++;
                    }
                  });
                  dispatch("UPDATE_CAMPAIGN",updated);
                  toast(`${count} contacts enrolled in ${selCamp.name}`,"success");
                  setEnrollSearch(""); setEnrollListId("");
                };

                return(
                  <div className="card" style={{padding:"12px 14px",marginBottom:16,borderLeft:`3px solid ${B.purple}`}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,letterSpacing:1,marginBottom:10}}>+ ENROLL CONTACTS</div>
                    <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
                      <input value={enrollSearch} onChange={e=>{setEnrollSearch(e.target.value);setEnrollListId("");}}
                        placeholder="Search by name, title, school, state, email…"
                        style={{flex:1,minWidth:200,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
                      <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>or</span>
                      <select value={enrollListId} onChange={e=>{setEnrollListId(e.target.value);setEnrollSearch("");}}
                        style={{flex:1,minWidth:160,background:B.surface,border:`1px solid ${B.border}`,color:enrollListId?B.text:B.muted,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
                        <option value="">— pick a contact list —</option>
                        {(s.contactLists||[]).map(l=><option key={l.id} value={l.id}>{l.name} ({(l.contactIds||[]).length})</option>)}
                      </select>
                    </div>
                    {(q||enrollListId)&&(
                      <div style={{marginBottom:10}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{toEnroll.length} contact{toEnroll.length!==1?"s":""} match{toEnroll.length===1?"es":""} · not yet enrolled</div>
                        {toEnroll.slice(0,6).map(c=>(
                          <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                            <div style={{flex:1}}>
                              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}</span>
                              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginLeft:8}}>{c.title}{c.school?` · ${c.school}`:""}{c.state?` · ${c.state}`:""}</span>
                            </div>
                            {c.email&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.green}}>✉</span>}
                          </div>
                        ))}
                        {toEnroll.length>6&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"4px 0"}}>…and {toEnroll.length-6} more</div>}
                      </div>
                    )}
                    <OBtn sm onClick={doEnroll} disabled={!toEnroll.length&&(!!q||!!enrollListId)}>
                      {toEnroll.length>0?`ENROLL ${toEnroll.length} CONTACT${toEnroll.length!==1?"S":""}`:enrollListId||q?"NO NEW CONTACTS":"ENROLL ALL CONTACTS"}
                    </OBtn>
                    {!q&&!enrollListId&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginLeft:10}}>Search or pick a list above, or enroll everyone</span>}
                  </div>
                );
              })()}

              {/* Enrolled contacts */}
              {(()=>{
                // Map "sent" filter to contacts that have been sent at least one touch
                const statusFilterFn = e => {
                  if(executeFilter==="all") return true;
                  if(executeFilter==="sent") return (e.step>0||e.lastSentAt)&&e.status==="active";
                  if(executeFilter==="active") return e.status==="active"&&!(e.step>0||e.lastSentAt);
                  return e.status===executeFilter;
                };
                const visibleCount=(selCamp.enrollments||[]).filter(e=>{
                  const c=contactMap[e.contactId];
                  return statusFilterFn(e)&&(!c||(filterSport==="all"||c.sport===filterSport));
                }).length;
                return(
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>
                      {executeFilter==="all"?"ALL CONTACTS":executeFilter.toUpperCase()} ({visibleCount})
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {["all",...allSports].map(sp=>(
                        <button key={sp} onClick={()=>setFilterSport(sp)} style={{background:filterSport===sp?B.orange:B.white,color:filterSport===sp?B.white:B.muted,border:`1px solid ${filterSport===sp?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{sp==="all"?"All":sp}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {(selCamp.enrollments||[])
                  .filter(e=>{
                    const c=contactMap[e.contactId];
                    const statusMatch = executeFilter==="all"?true:executeFilter==="sent"?(e.step>0||e.lastSentAt)&&e.status==="active":executeFilter==="active"?e.status==="active"&&!(e.step>0||e.lastSentAt):e.status===executeFilter;
                    return statusMatch&&(!c||(filterSport==="all"||c.sport===filterSport));
                  })
                  .sort((a,b)=>{
                    // Done contacts always sink to the bottom; interested float above done but below active
                    const rank=s=>s==="done"?2:s==="interested"?1:0;
                    const rd=rank(a.status)-rank(b.status);
                    if(rd!==0) return rd;
                    return a.step-b.step;
                  })
                  .map(e=>{
                    const c=contactMap[e.contactId];
                    if(!c)return null;
                    const touch=(selCamp.touches||[])[e.step];
                    const sc={active:B.blue,replied:B.green,interested:B.orange,meeting:B.purple,done:B.muted,unsubscribed:B.red,not_interested:B.muted}[e.status]||B.muted;
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
                                <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"opened",campaignId:selCamp.id,note:"Opened email"})} style={{background:B.blueBg,color:B.blue,border:`1px solid ${B.blue}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>OPENED +10</button>
                                <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"clicked",campaignId:selCamp.id,note:"Clicked link"})} style={{background:B.purpleBg,color:B.purple,border:`1px solid ${B.purple}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>CLICKED +25</button>
                              </div>
                              <div style={{display:"flex",gap:4}}>
                                <GBtn onClick={()=>markContacted(selCamp.id,e.contactId)} style={{fontSize:9,padding:"3px 8px"}}>✓ SENT +15</GBtn>
                                <button onClick={()=>markReplied(selCamp.id,e.contactId)} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>REPLIED +50</button>
                              </div>
                              <div style={{display:"flex",gap:4}}>
                                <button onClick={()=>{
                                  const camp=campaigns.find(c=>c.id===selCamp.id);
                                  if(!camp) return;
                                  dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(en=>en.contactId===e.contactId?{...en,status:"interested"}:en)});
                                  dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"meeting",campaignId:selCamp.id,note:"Positive intent — removed from sequence"});
                                  dispatch("UPDATE_CONTACT",{id:e.contactId,outreachStatus:"interested"});
                                  toast(`${c.fullName||c.firstName} removed from sequence — marked as interested`,"success");
                                }} style={{background:`${B.orange}15`,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",whiteSpace:"nowrap"}}>🎯 POSITIVE INTENT</button>
                                <button onClick={()=>{
                                  const camp=campaigns.find(c=>c.id===selCamp.id);
                                  if(!camp) return;
                                  dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(en=>en.contactId===e.contactId?{...en,status:"not_interested"}:en)});
                                  toast(`${c.fullName||c.firstName||"Contact"} paused — won't receive more emails in this campaign`,"info");
                                }} style={{background:B.surface,color:B.muted,border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",whiteSpace:"nowrap"}}>⏸ NOT INTERESTED</button>
                                <button onClick={()=>{
                                  const camp=campaigns.find(c=>c.id===selCamp.id);
                                  if(!camp) return;
                                  dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(en=>en.contactId===e.contactId?{...en,status:"unsubscribed"}:en)});
                                  dispatch("UPDATE_CONTACT",{id:e.contactId,optedOut:true});
                                  toast(`${c.fullName||c.firstName} unsubscribed`,"info");
                                }} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}30`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>UNSUB</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
              </>)}
              {/* ASSETS TAB */}
              {campSubTab==="assets"&&(
                <div>
                  {/* AI Generation panel — always visible in detail assets tab */}
                  <div className="card" style={{padding:"14px 16px",marginBottom:18,borderLeft:`4px solid ${B.purple}`}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1,marginBottom:10}}>✦ AI CONTENT GENERATION</div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>EMAIL CONTENT DIRECTION (optional)</div>
                      <textarea value={emailGenDirection} onChange={e=>setEmailGenDirection(e.target.value)} placeholder="e.g. Focus on spring season urgency, mention early-bird discount, emphasize team bonding angle…" rows={2} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.5}}/>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                      <OBtn sm onClick={()=>generateTouches(emailGenDirection||undefined)} disabled={genRunning}>{genRunning?"GENERATING...":"✦ GENERATE / REGEN EMAILS"}</OBtn>
                      <button onClick={generateSocialDrafts} disabled={genSocialRunning} style={{background:genSocialRunning?B.muted:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genSocialRunning?.7:1}}>{genSocialRunning?"GENERATING...":"✦ SOCIAL POSTS"}</button>
                      <button onClick={generateAdCopy} disabled={genAdRunning} style={{background:genAdRunning?B.muted:B.orange,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genAdRunning?.7:1}}>{genAdRunning?"GENERATING...":"✦ AD COPY"}</button>
                      <button onClick={generateCallScript} disabled={genCallRunning} style={{background:genCallRunning?B.muted:B.blue,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genCallRunning?.7:1}}>{genCallRunning?"GENERATING...":"✦ CALL SCRIPT"}</button>
                      <button onClick={generateDirectMail} disabled={genMailRunning} style={{background:genMailRunning?B.muted:B.teal,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genMailRunning?.7:1}}>{genMailRunning?"GENERATING...":"✦ DIRECT MAIL"}</button>
                    </div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Uses the campaign goal, product, audience, and rep from the Strategy tab.</div>
                  </div>
                  {/* Email touches */}
                  {(selCamp.touches||[]).length>0&&(
                    <div style={{marginBottom:20}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1,marginBottom:10}}>✉ EMAIL SEQUENCE — {(selCamp.touches||[]).length} TOUCH{(selCamp.touches||[]).length!==1?"ES":""}</div>
                      <div style={{display:"flex",gap:8,alignItems:"flex-start",flexWrap:"wrap"}}>
                        {(selCamp.touches||[]).map((t,i)=>(
                          <div key={t.id||i} className="card" style={{flex:"1 1 220px",padding:10,borderTop:`2px solid ${B.orange}`}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1}}>TOUCH {t.step} · DAY {t.dayOffset}</div>
                              <button onClick={()=>editingTouchIdx===i?setEditingTouchIdx(null):openTouchEdit(i)}
                                style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>
                                {editingTouchIdx===i?"✕ CANCEL":"✎ EDIT"}
                              </button>
                            </div>
                            {editingTouchIdx===i?(
                              <div>
                                <div style={{marginBottom:6}}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>SUBJECT</div>
                                  <input value={touchDraft.subject} onChange={e=>setTouchDraft(d=>({...d,subject:e.target.value}))}
                                    style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                                <div style={{marginBottom:8}}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>BODY</div>
                                  <textarea value={touchDraft.body} onChange={e=>setTouchDraft(d=>({...d,body:e.target.value}))}
                                    rows={5} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/></div>
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
                    </div>
                  )}
                  {/* Social drafts (campaign-level) */}
                  {(selCamp.socialDrafts||[]).length>0&&(
                    <div style={{marginBottom:20}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1,marginBottom:10}}>📱 SOCIAL DRAFT POSTS</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {(selCamp.socialDrafts||[]).map((p,i)=>(
                          <div key={p.id||i} className="card" style={{padding:"10px 12px",borderLeft:`3px solid ${B.purple}`}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,marginBottom:5}}>POST {i+1} — {(p.platforms||[]).join(", ").toUpperCase()}</div>
                            <textarea value={p.caption||""} onChange={e=>{const updated=(selCamp.socialDrafts||[]).map((x,j)=>j===i?{...x,caption:e.target.value}:x);dispatch("UPDATE_CAMPAIGN",{...selCamp,socialDrafts:updated});}} rows={3} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Ad Copy */}
                  {selCamp.adCopy&&(
                    <div style={{marginBottom:20}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:1,marginBottom:6}}>⬛ AD COPY</div>
                      <textarea value={selCamp.adCopy||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{...selCamp,adCopy:e.target.value})} rows={5} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                    </div>
                  )}
                  {/* Call Script */}
                  {selCamp.callScript&&(
                    <div style={{marginBottom:20}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:1,marginBottom:6}}>📞 CALL SCRIPT</div>
                      <textarea value={selCamp.callScript||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{...selCamp,callScript:e.target.value})} rows={6} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                    </div>
                  )}
                  {/* Direct Mail */}
                  {selCamp.directMail&&(
                    <div style={{marginBottom:20}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,letterSpacing:1,marginBottom:6}}>✉ DIRECT MAIL LETTER</div>
                      <textarea value={selCamp.directMail||""} onChange={e=>dispatch("UPDATE_CAMPAIGN",{...selCamp,directMail:e.target.value})} rows={6} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
                    </div>
                  )}
                  {/* Social posts (scheduled) */}
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1}}>📱 SOCIAL POSTS — {(selCamp.socialPosts||[]).length}</div>
                      <OBtn sm onClick={()=>setShowAddPost(!showAddPost)}>+ ADD POST</OBtn>
                    </div>
                    {showAddPost&&(
                      <div className="card" style={{padding:14,marginBottom:14}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                          <div><Lbl s={{marginBottom:4}}>Date</Lbl><input type="date" value={postDraft.date} onChange={e=>setPostDraft(d=>({...d,date:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
                          <div><Lbl s={{marginBottom:4}}>Type</Lbl><select value={postDraft.type} onChange={e=>setPostDraft(d=>({...d,type:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>{["post","story","reel"].map(o=><option key={o}>{o}</option>)}</select></div>
                        </div>
                        <div style={{marginBottom:10}}><Lbl s={{marginBottom:4}}>Platforms</Lbl>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {["facebook","instagram","linkedin","twitter","tiktok"].map(p=>{const sel=(postDraft.platforms||[]).includes(p);return<button key={p} onClick={()=>setPostDraft(d=>({...d,platforms:sel?d.platforms.filter(x=>x!==p):[...d.platforms,p]}))} style={{background:sel?`${B.orange}14`:B.white,color:sel?B.orange:B.muted,border:`1px solid ${sel?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{p}</button>;})}
                          </div>
                        </div>
                        <div style={{marginBottom:10}}><Lbl s={{marginBottom:4}}>Caption</Lbl><textarea value={postDraft.caption} onChange={e=>setPostDraft(d=>({...d,caption:e.target.value}))} rows={3} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/></div>
                        <div style={{marginBottom:12}}><Lbl s={{marginBottom:4}}>Image URL (optional)</Lbl><input value={postDraft.imageUrl} onChange={e=>setPostDraft(d=>({...d,imageUrl:e.target.value}))} placeholder="https://..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/></div>
                        <div style={{display:"flex",gap:8}}><OBtn sm onClick={()=>addCampPost(selCamp.id)}>✓ ADD TO CAMPAIGN</OBtn><GBtn onClick={()=>setShowAddPost(false)}>CANCEL</GBtn></div>
                      </div>
                    )}
                    {(selCamp.socialPosts||[]).length===0&&!showAddPost&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>No social posts yet</div>}
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {(selCamp.socialPosts||[]).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(post=>(
                        <div key={post.id} className="card" style={{padding:"12px 14px",borderLeft:`3px solid ${post.posted?B.green:B.purple}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                                {post.date&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>{post.date}</span>}
                                {(post.platforms||[]).map(p=><span key={p} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{p}</span>)}
                                {post.posted&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3}}>✓ POSTED</span>}
                              </div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{post.caption}</div>
                              {post.imageUrl&&<img src={post.imageUrl} alt="" style={{maxWidth:200,borderRadius:4,marginTop:6}}/>}
                            </div>
                            {!post.posted&&(
                              <div style={{display:"flex",flexDirection:"column",gap:4,marginLeft:12,flexShrink:0}}>
                                {(!post.scheduledDate||post.scheduledDate<=today())&&<OBtn sm onClick={()=>postCampPostNow(selCamp.id,post)}>POST NOW</OBtn>}
                                {post.scheduledDate&&post.scheduledDate>today()&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,padding:"2px 4px",textAlign:"center"}}>SCHEDULED {post.scheduledDate}</div>}
                                <button onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,socialPosts:(selCamp.socialPosts||[]).filter(p=>p.id!==post.id)})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>REMOVE</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Linked Ads */}
                  <div style={{marginBottom:20}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>⬛ LINKED ADS</div>
                    {(()=>{
                      const linkedAds=(s.ads||[]).filter(a=>(selCamp.adIds||[]).includes(a.id));
                      const unlinkable=(s.ads||[]).filter(a=>!(selCamp.adIds||[]).includes(a.id));
                      return(<div>
                        {linkedAds.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:8}}>No ads linked — create in Ad Engine tab, then link here.</div>}
                        {linkedAds.map(ad=>(
                          <div key={ad.id} className="card" style={{padding:"10px 12px",marginBottom:8,borderLeft:`3px solid ${B.orange}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{ad.name||ad.headline||"Ad"}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{ad.objective}</div></div>
                            <button onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,adIds:(selCamp.adIds||[]).filter(id=>id!==ad.id)})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>UNLINK</button>
                          </div>
                        ))}
                        {unlinkable.length>0&&(<div style={{marginTop:8}}>
                          <Lbl s={{marginBottom:6}}>LINK AN AD</Lbl>
                          {unlinkable.slice(0,8).map(ad=>(
                            <div key={ad.id} className="card fu" style={{padding:"8px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,adIds:[...(selCamp.adIds||[]),ad.id]})}>
                              <div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{ad.name||ad.headline||"Ad"}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{ad.objective}</div></div>
                              <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange}}>+ LINK</span>
                            </div>
                          ))}
                        </div>)}
                      </div>);
                    })()}
                  </div>
                </div>
              )}

              {/* REPORT TAB */}
              {campSubTab==="report"&&(
                <div>
                  {/* KPI grid */}
                  {(()=>{
                    const enrs=selCamp.enrollments||[];
                    const activeN=enrs.filter(e=>e.status==="active").length;
                    const sentN=enrs.reduce((n,e)=>n+(e.step||0),0);
                    const openedN=enrs.filter(e=>e.openedAt).length;
                    const repliedN=enrs.filter(e=>e.status==="replied").length;
                    const doneN=enrs.filter(e=>e.status==="done").length;
                    const openRate=sentN>0?Math.round(openedN/Math.max(sentN,1)*100):0;
                    const replyRate=sentN>0?Math.round(repliedN/Math.max(sentN,1)*100):0;
                    return(
                      <div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:20}}>
                          {[
                            ["ENROLLED",enrs.length,B.blue,"Total contacts in campaign"],
                            ["ACTIVE",activeN,B.orange,"Still in sequence"],
                            ["EMAILS SENT",sentN,B.purple,"Total touches sent"],
                            ["OPENS",openedN,B.teal||B.blue,`${openRate}% open rate`],
                            ["REPLIES",repliedN,B.green,`${replyRate}% reply rate`],
                            ["COMPLETED",doneN,B.muted,"Finished all touches"],
                          ].map(([l,v,c,sub])=>(
                            <div key={l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"12px 14px"}}>
                              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:c,lineHeight:1,marginBottom:4}}>{v}</div>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:2}}>{l}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:c}}>{sub}</div>
                            </div>
                          ))}
                        </div>
                        {/* Progress bar */}
                        {enrs.length>0&&(
                          <div style={{marginBottom:20}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:6}}>ENROLLMENT STATUS</div>
                            <div style={{display:"flex",height:12,borderRadius:6,overflow:"hidden",gap:1}}>
                              {[["active",activeN,B.orange],["replied",repliedN,B.green],["done",doneN,B.muted]].map(([k,v,c])=>v>0&&(
                                <div key={k} title={`${k}: ${v}`} style={{flex:v,background:c,minWidth:4}}/>
                              ))}
                            </div>
                            <div style={{display:"flex",gap:12,marginTop:4}}>
                              {[["Active",activeN,B.orange],["Replied",repliedN,B.green],["Done",doneN,B.muted]].map(([l,v,c])=>(
                                <div key={l} style={{display:"flex",gap:4,alignItems:"center"}}>
                                  <div style={{width:8,height:8,borderRadius:2,background:c}}/>
                                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{l} ({v})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Tracked metrics checklist */}
                        {(selCamp.metrics||[]).length>0&&(
                          <div style={{marginBottom:20}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>TRACKING METRICS</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                              {(selCamp.metrics||[]).map(m=>{
                                const tracked=m==="Opens"?openedN:m==="Replies"?repliedN:m==="Emails Sent"?sentN:null;
                                return(
                                  <div key={m} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"8px 12px",minWidth:110}}>
                                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,marginBottom:2}}>☑ {m}</div>
                                    {tracked!==null&&<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.orange}}>{tracked}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Recent activity */}
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>RECENT ACTIVITY</div>
                  {(()=>{
                    const allActs=(s.contacts||[])
                      .flatMap(c=>(c.activity||[]).filter(a=>a.campaignId===selCamp.id).map(a=>({...a,contactName:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()})))
                      .sort((a,b)=>b.ts-a.ts)
                      .slice(0,15);
                    if(!allActs.length) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px 0"}}>No activity yet — launch the campaign and start sending.</div>;
                    const typeColor={sent:B.purple,opened:B.blue,clicked:B.orange,replied:B.green,enrolled:B.muted,meeting:B.teal||B.blue,deal:B.green};
                    return(
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        {allActs.map(a=>(
                          <div key={a.id} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 10px",background:B.surface,borderRadius:5}}>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:typeColor[a.type]||B.muted,background:`${typeColor[a.type]||B.muted}14`,padding:"2px 6px",borderRadius:3,flexShrink:0}}>{a.type?.toUpperCase()}</span>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,flex:1}}>{a.contactName}</span>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,flexShrink:0}}>{new Date(a.ts).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {/* Enrolled contacts with search + touch progress */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:8,gap:10,flexWrap:"wrap"}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,whiteSpace:"nowrap"}}>ENROLLED CONTACTS ({(selCamp.enrollments||[]).length})</div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",flex:1,justifyContent:"flex-end"}}>
                      <input
                        value={campContactSearch}
                        onChange={e=>{setCampContactSearch(e.target.value);setFilterSport("all");}}
                        placeholder="Search name, email, school…"
                        style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",color:B.text,minWidth:180,outline:"none"}}
                      />
                      {campContactSearch&&<button onClick={()=>setCampContactSearch("")} style={{background:"none",border:"none",fontSize:11,color:B.muted,cursor:"pointer",padding:"0 2px"}}>✕</button>}
                      {!campContactSearch&&["all",...allSports].map(sp=>(
                        <button key={sp} onClick={()=>setFilterSport(sp)} style={{background:filterSport===sp?B.orange:B.white,color:filterSport===sp?B.white:B.muted,border:`1px solid ${filterSport===sp?B.orange:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{sp==="all"?"All":sp}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {(()=>{
                      const q=(campContactSearch||"").toLowerCase().trim();
                      return(selCamp.enrollments||[])
                        .filter(e=>{
                          const c=contactMap[e.contactId];
                          if(!c) return true;
                          if(q){
                            const name=(c.fullName||`${c.firstName||""} ${c.lastName||""}`).toLowerCase();
                            const school=(typeof c.school==="string"?c.school:c.school?.name||"").toLowerCase();
                            const email=(c.email||"").toLowerCase();
                            return name.includes(q)||school.includes(q)||email.includes(q);
                          }
                          return filterSport==="all"||c.sport===filterSport;
                        })
                        .sort((a,b)=>a.step-b.step)
                        .map(e=>{
                          const c=contactMap[e.contactId];
                          if(!c)return null;
                          const touch=(selCamp.touches||[])[e.step];
                          const sc={active:B.blue,replied:B.green,interested:B.orange,done:B.muted,unsubscribed:B.red,not_interested:B.muted}[e.status]||B.muted;
                          const totalTouches=(selCamp.touches||[]).length;
                          return(
                            <div key={e.contactId} className="card fu" style={{padding:"9px 12px",borderLeft:`3px solid ${sc}`}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
                                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}</span>
                                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:sc,background:`${sc}20`,padding:"2px 6px",borderRadius:3}}>{e.status?.toUpperCase()}</span>
                                    {c.sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c.sport}</span>}
                                    {(()=>{const t=scoreTier(c.score);return<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:t.color,background:t.bg,padding:"2px 5px",borderRadius:3}}>{t.label} {c.score||0}</span>})()}
                                  </div>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof c.title==="string"?c.title:c.title?.name||""}{(typeof c.school==="string"?c.school:c.school?.name||"")?" · ":""}{typeof c.school==="string"?c.school:c.school?.name||""}</div>
                                  {c.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green,marginTop:2}}>✉ {c.email}</div>}
                                  {/* Touch progress dots */}
                                  {totalTouches>0&&(
                                    <div style={{display:"flex",gap:4,alignItems:"center",marginTop:5,flexWrap:"wrap"}}>
                                      {(selCamp.touches||[]).map((t,i)=>{
                                        const sent=i<e.step;
                                        const next=i===e.step&&e.status==="active";
                                        const color=sent?B.green:next?B.orange:B.border;
                                        return(
                                          <div key={i} title={`Touch ${i+1}${t.subject?`: ${t.subject}`:""}`}
                                            style={{display:"flex",alignItems:"center",gap:3}}>
                                            <div style={{width:18,height:18,borderRadius:"50%",background:sent?B.green:next?`${B.orange}20`:"transparent",border:`2px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:sent?B.white:next?B.orange:B.muted,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,flexShrink:0}}>
                                              {sent?"✓":i+1}
                                            </div>
                                            {i<totalTouches-1&&<div style={{width:12,height:1,background:sent?B.green:B.border}}/>}
                                          </div>
                                        );
                                      })}
                                      {e.status==="active"&&touch&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,marginLeft:4}}>{e.nextDate||"today"}</span>}
                                      {e.lastContacted&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginLeft:4}}>last sent {e.lastContacted}</span>}
                                    </div>
                                  )}
                                </div>
                                {e.status==="active"&&(
                                  <div style={{display:"flex",gap:4,flexShrink:0,flexDirection:"column",alignItems:"flex-end",marginLeft:10}}>
                                    {touch&&<button onClick={()=>setPreviewModal({contact:c,touch})} style={{background:`${B.orange}14`,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",whiteSpace:"nowrap"}}>✉ PREVIEW</button>}
                                    <div style={{display:"flex",gap:4}}>
                                      <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"opened",campaignId:selCamp.id,note:"Opened email"})} style={{background:B.blueBg,color:B.blue,border:`1px solid ${B.blue}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>OPENED</button>
                                      <button onClick={()=>dispatch("SCORE_CONTACT",{contactId:e.contactId,type:"clicked",campaignId:selCamp.id,note:"Clicked link"})} style={{background:B.purpleBg,color:B.purple,border:`1px solid ${B.purple}30`,borderRadius:4,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>CLICKED</button>
                                    </div>
                                    <div style={{display:"flex",gap:4}}>
                                      <GBtn onClick={()=>markContacted(selCamp.id,e.contactId)} style={{fontSize:9,padding:"3px 8px"}}>✓ SENT</GBtn>
                                      <button onClick={()=>markReplied(selCamp.id,e.contactId)} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>REPLIED</button>
                                    </div>
                                    <div style={{display:"flex",gap:4}}>
                                      <button onClick={()=>{const camp=campaigns.find(cc=>cc.id===selCamp.id);if(!camp)return;dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(en=>en.contactId===e.contactId?{...en,status:"not_interested"}:en)});toast(`${c.fullName||c.firstName||"Contact"} paused from this campaign`,"info");}} style={{background:B.surface,color:B.muted,border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",whiteSpace:"nowrap"}}>⏸ NOT INTERESTED</button>
                                      <button onClick={()=>{const camp=campaigns.find(cc=>cc.id===selCamp.id);if(!camp)return;dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:(camp.enrollments||[]).map(en=>en.contactId===e.contactId?{...en,status:"unsubscribed"}:en)});dispatch("UPDATE_CONTACT",{id:e.contactId,optedOut:true});toast(`${c.fullName||c.firstName} unsubscribed`,"info");}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}30`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>UNSUB</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        });
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CALENDAR ──────────────────────────────────────────────────────── */}
      {tab==="calendar"&&(
        <div>
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16}}>
            <button onClick={()=>{let m=calMonth-1,y=calYear;if(m<0){m=11;y--;}setCalMonth(m);setCalYear(y);}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",fontSize:12,cursor:"pointer",color:B.text}}>←</button>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,minWidth:120,textAlign:"center"}}>{MONTH_NAMES[calMonth]} {calYear}</div>
            <button onClick={()=>{let m=calMonth+1,y=calYear;if(m>11){m=0;y++;}setCalMonth(m);setCalYear(y);}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",fontSize:12,cursor:"pointer",color:B.text}}>→</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:B.border,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden"}}>
            {DAY_NAMES.map(d=>(<div key={d} style={{background:B.surface,padding:"6px 0",textAlign:"center",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>{d}</div>))}
            {Array.from({length:calFirstDay(calYear,calMonth)},(_,i)=>(<div key={`e${i}`} style={{background:B.white,minHeight:80}}/>))}
            {Array.from({length:calDaysInMonth(calYear,calMonth)},(_,i)=>{
              const d=i+1;
              const events=getCalDayEvents(calYear,calMonth,d);
              const isToday=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`===today();
              return(<div key={d} style={{background:B.white,minHeight:80,padding:"4px 6px"}}>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:isToday?B.orange:B.text,fontWeight:isToday?700:400,marginBottom:3}}>{d}</div>
                {events.slice(0,3).map((ev,ei)=>(<div key={ei} style={{background:`${ev.color}18`,border:`1px solid ${ev.color}40`,borderRadius:3,padding:"2px 4px",marginBottom:2,overflow:"hidden"}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:ev.color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.type==="email"?"✉":"📱"} {ev.label}</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:7,color:B.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.campName}</div>
                </div>))}
                {events.length>3&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted}}>+{events.length-3} more</div>}
              </div>);
            })}
          </div>
          <div style={{display:"flex",gap:16,marginTop:14,flexWrap:"wrap"}}>
            {campaigns.map(camp=>(<div key={camp.id} style={{display:"flex",gap:6,alignItems:"center"}}><div style={{width:10,height:10,borderRadius:2,background:camp.color||B.orange}}/><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{camp.name}</div></div>))}
          </div>
          {/* Rep color key */}
          {(()=>{
            const repUsers=(s.reps||[]);
            const activeReps=repUsers.filter(u=>campaigns.some(c=>c.repId===u.id));
            if(!activeReps.length) return null;
            return(
              <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap",alignItems:"center",padding:"8px 12px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>REPS:</span>
                {activeReps.map(u=>(
                  <div key={u.id} style={{display:"flex",gap:5,alignItems:"center"}}>
                    <div style={{width:12,height:12,borderRadius:"50%",background:u.color||B.muted,flexShrink:0}}/>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.name}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

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

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
//  UNIFIED CONTENT CALENDAR
// ════════════════════════════════════════════════════════════════════════════
function ModCalendar() {
  const {s,setMod}=useApp();
  const now=new Date();
  const [calYear,setCalYear]=useState(now.getFullYear());
  const [calMonth,setCalMonth]=useState(now.getMonth());
  const [view,setView]=useState("month"); // "month"|"week"
  const [selDay,setSelDay]=useState(null); // "YYYY-MM-DD"
  const [filterEmail,setFilterEmail]=useState(true);
  const [filterSocial,setFilterSocial]=useState(true);
  const [filterAd,setFilterAd]=useState(true);
  const [filterCall,setFilterCall]=useState(true);

  const MONTH_NAMES=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_NAMES=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Build all events
  const allEvents=[];
  (s.campaigns||[]).forEach(camp=>{
    // Email touches
    if(camp.startDate && (camp.touches||[]).length>0){
      (camp.touches||[]).forEach(touch=>{
        const d=new Date(camp.startDate);
        d.setDate(d.getDate()+(touch.dayOffset||0));
        const dateStr=d.toISOString().slice(0,10);
        allEvents.push({date:dateStr,type:"email",label:touch.subject||"Email",color:"#f97316",campName:camp.name,subLabel:`Day ${touch.dayOffset||0}`,campId:camp.id});
      });
    }
    // Social drafts
    (camp.socialDrafts||[]).forEach(p=>{
      const dateStr=(p.scheduledDate||p.date||"").slice(0,10);
      if(dateStr) allEvents.push({date:dateStr,type:"social",label:(p.caption||p.subject||"Social Post").slice(0,40),color:"#9333ea",campName:camp.name,subLabel:"Draft",campId:camp.id});
    });
    // Campaign social posts
    (camp.socialPosts||[]).forEach(p=>{
      const dateStr=(p.date||"").slice(0,10);
      if(dateStr) allEvents.push({date:dateStr,type:"social",label:(p.caption||"Social Post").slice(0,40),color:"#9333ea",campName:camp.name,subLabel:(p.platforms||[]).join(", ")||"Social",campId:camp.id});
    });
  });
  // Standalone social posts
  (s.socialPosts||[]).forEach(p=>{
    const dateStr=(p.date||"").slice(0,10);
    if(dateStr) allEvents.push({date:dateStr,type:"social",label:(p.caption||"Social Post").slice(0,40),color:"#9333ea",campName:"Standalone",subLabel:(p.platforms||[]).join(", ")||"Social",campId:null});
  });

  const filtered=allEvents.filter(ev=>{
    if(ev.type==="email"&&!filterEmail) return false;
    if(ev.type==="social"&&!filterSocial) return false;
    if(ev.type==="ad"&&!filterAd) return false;
    if(ev.type==="call"&&!filterCall) return false;
    return true;
  });

  const getEventsForDay=(dateStr)=>filtered.filter(ev=>ev.date===dateStr);

  // Month stats
  const monthStr=`${calYear}-${String(calMonth+1).padStart(2,"0")}`;
  const monthEmails=filtered.filter(ev=>ev.type==="email"&&ev.date.startsWith(monthStr)).length;
  const monthSocial=filtered.filter(ev=>ev.type==="social"&&ev.date.startsWith(monthStr)).length;
  const monthAds=filtered.filter(ev=>ev.type==="ad"&&ev.date.startsWith(monthStr)).length;

  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDay=new Date(calYear,calMonth,1).getDay();

  const navPrev=()=>{let m=calMonth-1,y=calYear;if(m<0){m=11;y--;}setCalMonth(m);setCalYear(y);setSelDay(null);};
  const navNext=()=>{let m=calMonth+1,y=calYear;if(m>11){m=0;y++;}setCalMonth(m);setCalYear(y);setSelDay(null);};

  // Week view helpers
  const getWeekStart=()=>{
    const ref=selDay?new Date(selDay+"T00:00:00"):new Date(calYear,calMonth,1);
    const d=new Date(ref);d.setDate(d.getDate()-d.getDay());return d;
  };
  const HOURS=Array.from({length:15},(_,i)=>i+6); // 6am-8pm

  return(
    <div style={{padding:"22px 26px"}}>
      <PH title="CONTENT CALENDAR" sub="All scheduled emails, social posts, and campaign content in one view"
        action={<div style={{display:"flex",gap:8}}><button onClick={()=>setMod("social")} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>+ ADD POST</button><button onClick={()=>setMod("marketing")} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>+ ADD EMAIL TOUCH</button></div>}/>

      {/* Summary bar */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"9px 16px",marginBottom:14,display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>THIS MONTH:</span>
        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.orange}}><strong>{monthEmails}</strong> emails</span>
        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:"#9333ea"}}><strong>{monthSocial}</strong> social posts</span>
        {monthAds>0&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.blue}}><strong>{monthAds}</strong> ads</span>}
      </div>

      {/* Controls */}
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <button onClick={navPrev} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:14,color:B.text}}>‹</button>
        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,minWidth:160,textAlign:"center",letterSpacing:.3}}>{MONTH_NAMES[calMonth]} {calYear}</div>
        <button onClick={navNext} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:14,color:B.text}}>›</button>
        <div style={{display:"flex",gap:4,marginLeft:10}}>
          {[["month","MONTH"],["week","WEEK"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?B.orange:B.white,color:view===v?B.white:B.muted,border:`1px solid ${view===v?B.orange:B.border}`,borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:10,flexWrap:"wrap"}}>
          {[["email","Email","#f97316",filterEmail,setFilterEmail],["social","Social","#9333ea",filterSocial,setFilterSocial],["ad","Ads",B.blue,filterAd,setFilterAd],["call","Calls",B.teal,filterCall,setFilterCall]].map(([type,label,col,active,setter])=>(
            <button key={type} onClick={()=>setter(v=>!v)} style={{background:active?`${col}15`:B.white,color:active?col:B.muted,border:`1px solid ${active?col+"40":B.border}`,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:14}}>
        <div style={{flex:1,minWidth:0}}>
          {/* ── MONTH VIEW ── */}
          {view==="month"&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,marginBottom:2}}>
                {DAY_NAMES.map(d=><div key={d} style={{textAlign:"center",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,padding:"5px 0",letterSpacing:.5}}>{d.toUpperCase()}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
                {Array(firstDay).fill(null).map((_,i)=><div key={`e${i}`} style={{background:B.surface,minHeight:100,borderRadius:4}}/>)}
                {Array(daysInMonth).fill(null).map((_,i)=>{
                  const d=i+1;
                  const dateStr=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                  const dayEvents=getEventsForDay(dateStr);
                  const isToday=now.getFullYear()===calYear&&now.getMonth()===calMonth&&now.getDate()===d;
                  const isSel=selDay===dateStr;
                  return(
                    <div key={d} onClick={()=>setSelDay(isSel?null:dateStr)} style={{background:isSel?`${B.orange}08`:B.white,border:`1px solid ${isSel?B.orange:isToday?B.orange+"60":B.border}`,borderRadius:4,padding:"5px 6px",minHeight:100,cursor:"pointer",transition:"border-color .12s"}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:isToday?B.orange:B.text,fontWeight:isToday?700:400,marginBottom:3}}>{d}</div>
                      {dayEvents.slice(0,3).map((ev,ei)=>(
                        <div key={ei} style={{background:`${ev.color}15`,borderLeft:`2px solid ${ev.color}`,padding:"2px 5px",borderRadius:2,marginBottom:2}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:ev.color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.type.toUpperCase()}</div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.label}</div>
                        </div>
                      ))}
                      {dayEvents.length>3&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,marginTop:2}}>+{dayEvents.length-3} more</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── WEEK VIEW ── */}
          {view==="week"&&(()=>{
            const weekStart=getWeekStart();
            const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});
            return(
              <div style={{overflowX:"auto"}}>
                <div style={{display:"grid",gridTemplateColumns:`60px repeat(7,1fr)`,gap:2,minWidth:600}}>
                  <div/>
                  {weekDays.map((d,i)=>{
                    const isToday=d.toDateString()===now.toDateString();
                    return<div key={i} style={{textAlign:"center",padding:"6px 4px",background:isToday?`${B.orange}10`:B.surface,borderRadius:"4px 4px 0 0",border:`1px solid ${isToday?B.orange+"50":B.border}`,borderBottom:"none"}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5}}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()]}</div>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:isToday?B.orange:B.text}}>{d.getDate()}</div>
                    </div>;
                  })}
                  {HOURS.map(h=>(
                    <React.Fragment key={h}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,textAlign:"right",paddingRight:6,paddingTop:8}}>{h===12?"12pm":h>12?`${h-12}pm`:`${h}am`}</div>
                      {weekDays.map((d,di)=>{
                        const dateStr=d.toISOString().slice(0,10);
                        const hourEvents=getEventsForDay(dateStr).filter((_,ei)=>ei%HOURS.length===h-6);
                        return<div key={di} style={{border:`1px solid ${B.border}`,borderRadius:2,minHeight:40,padding:2,background:d.toDateString()===now.toDateString()?`${B.orange}04`:B.white}}>
                          {hourEvents.map((ev,ei)=>(
                            <div key={ei} style={{background:`${ev.color}18`,borderLeft:`2px solid ${ev.color}`,padding:"2px 5px",borderRadius:2,marginBottom:2}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:ev.color}}>{ev.type.toUpperCase()}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.label}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:7,color:B.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ev.campName}</div>
                            </div>
                          ))}
                        </div>;
                      })}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                  <button onClick={()=>{const d=new Date(weekStart);d.setDate(d.getDate()-7);setSelDay(d.toISOString().slice(0,10));}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 16px",cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text}}>‹ Prev Week</button>
                  <button onClick={()=>{const d=new Date(weekStart);d.setDate(d.getDate()+7);setSelDay(d.toISOString().slice(0,10));}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 16px",cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text}}>Next Week ›</button>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Day detail panel */}
        {selDay&&view==="month"&&(()=>{
          const dayEvents=getEventsForDay(selDay);
          const byType={email:[],social:[],ad:[],call:[]};
          dayEvents.forEach(ev=>{(byType[ev.type]||(byType.call)).push(ev);});
          return(
            <div style={{width:280,flexShrink:0}}>
              <div className="card" style={{padding:13,position:"sticky",top:0}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,marginBottom:10}}>{new Date(selDay+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
                {dayEvents.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"20px 0"}}>No content scheduled</div>}
                {[["email","Email","#f97316"],["social","Social","#9333ea"],["ad","Ads",B.blue],["call","Calls",B.teal]].map(([type,label,col])=>{
                  const evts=byType[type]||[];if(!evts.length)return null;
                  return(
                    <div key={type} style={{marginBottom:12}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:col,letterSpacing:1,marginBottom:5}}>{label.toUpperCase()} ({evts.length})</div>
                      {evts.map((ev,i)=>(
                        <div key={i} style={{background:`${col}10`,borderLeft:`2px solid ${col}`,padding:"6px 8px",borderRadius:3,marginBottom:4}}>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,lineHeight:1.3}}>{ev.label}</div>
                          {ev.subLabel&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{ev.subLabel}</div>}
                          {ev.campName&&ev.campId&&<button onClick={()=>setMod("marketing")} style={{background:"none",border:"none",color:col,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",padding:"2px 0",display:"block",marginTop:3,letterSpacing:.3}}>↗ {ev.campName} →</button>}
                          {ev.campName&&!ev.campId&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>{ev.campName}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:14,marginTop:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>TYPES:</span>
        {[["Email","#f97316"],["Social","#9333ea"],["Ads",B.blue],["Calls",B.teal]].map(([l,col])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:10,height:10,borderRadius:2,background:col,flexShrink:0}}/>
            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{l}</span>
          </div>
        ))}
      </div>
      {/* Rep color key */}
      {(()=>{
        const campaigns=s.campaigns||[];
        const repUsers=(s.reps||[]);
        const activeReps=repUsers.filter(u=>campaigns.some(c=>c.repId===u.id));
        if(!activeReps.length) return null;
        return(
          <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>REPS:</span>
            {activeReps.map(u=>(
              <div key={u.id} style={{display:"flex",gap:5,alignItems:"center"}}>
                <div style={{width:12,height:12,borderRadius:"50%",background:u.color||B.muted,flexShrink:0}}/>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.name}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

//  SOCIAL MEDIA
// ════════════════════════════════════════════════════════════════════════════
const PLATFORM_COLORS = {instagram:"#E4405F",facebook:"#1877F2",linkedin:"#0A66C2",twitter:"#1DA1F2",tiktok:"#010101"};
const SOCIAL_PLATFORMS = ["instagram","facebook","linkedin","twitter","tiktok"];
const PLATFORM_LIMITS  = {twitter:280,instagram:2200,facebook:63206,linkedin:3000,tiktok:2200};

// ── Social Image Editor ─────────────────────────────────────────────────────
// Full-featured image generator + layer compositor for social posts.
// Generates background via Ideogram, then lets user drag text/logo layers
// and export a flattened 1080×1080 JPEG.
function SocialImageEditor({value, onChange, brandAssets, toast, onSaveAsset}) {
  const CW=560,CH=560;
  const [bgImg,setBgImg]=useState(value||"");
  const [layers,setLayers]=useState([]);
  const [selId,setSelId]=useState(null);
  const [drag,setDrag]=useState(null);
  const [imgPrompt,setImgPrompt]=useState("");
  const [imgStyle,setImgStyle]=useState("REALISTIC");
  const [genRunning,setGenRunning]=useState(false);
  const [showModal,setShowModal]=useState(false);

  const addText=()=>{
    const id=mkId();
    setLayers(ls=>[...ls,{id,type:"text",x:Math.round(CW/2-80),y:CH-80,w:160,h:44,content:"ST1 Sports",fontSize:22,color:"#FFFFFF",bgColor:"rgba(0,0,0,0.55)",bgPad:6,fontWeight:"bold"}]);
    setSelId(id);
  };
  const addLogo=(url,name)=>{
    const id=mkId();
    setLayers(ls=>[...ls,{id,type:"logo",x:20,y:20,w:100,h:100,content:url,opacity:1,name:name||"logo"}]);
    setSelId(id);
  };
  const updLayer=(id,upd)=>setLayers(ls=>ls.map(l=>l.id===id?{...l,...upd}:l));
  const delLayer=(id)=>{setLayers(ls=>ls.filter(l=>l.id!==id));if(selId===id)setSelId(null);};

  useEffect(()=>{
    if(!drag)return;
    const onMove=e=>{
      const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
      if(drag.mode==="move"){updLayer(drag.id,{x:Math.max(0,Math.min(CW-drag.lw,drag.lx+dx)),y:Math.max(0,Math.min(CH-drag.lh,drag.ly+dy))});}
      else{updLayer(drag.id,{w:Math.max(40,drag.lw+dx),h:Math.max(20,drag.lh+dy)});}
    };
    const onUp=()=>setDrag(null);
    window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[drag]);

  const startDrag=(e,id,mode)=>{
    e.preventDefault();e.stopPropagation();
    const l=layers.find(x=>x.id===id);
    setSelId(id);
    setDrag({id,mode,sx:e.clientX,sy:e.clientY,lx:l.x,ly:l.y,lw:l.w,lh:l.h});
  };

  const generateBg=async()=>{
    if(!imgPrompt.trim()){toast("Enter a prompt","error");return;}
    setGenRunning(true);
    try{
      const r=await fetch("/api/adengine/generate-product-image",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:imgPrompt,style:imgStyle,sizeKey:"square"})});
      const d=await r.json();
      if(d.imageUrl){
        setBgImg(d.imageUrl);onChange(d.imageUrl);
        // Auto-save to brand assets so the image persists after navigation
        if(onSaveAsset) onSaveAsset(d.imageUrl, imgPrompt);
        toast("Image generated and saved to Brand Assets","success");
      }
      else toast(d.error||"Failed","error");
    }catch{toast("Failed","error");}
    setGenRunning(false);
  };

  const exportComposite=()=>{
    if(!bgImg){toast("No background image","error");return;}
    const scale=1080/CW;
    const canvas=document.createElement("canvas");
    canvas.width=1080;canvas.height=1080;
    const ctx=canvas.getContext("2d");
    const drawTexts=()=>{
      layers.filter(l=>l.type==="text").forEach(layer=>{
        ctx.save();
        if(layer.bgColor&&layer.bgColor!=="transparent"){
          ctx.fillStyle=layer.bgColor;
          const p=(layer.bgPad||0)*scale;
          ctx.fillRect(layer.x*scale-p,layer.y*scale-p,layer.w*scale+p*2,layer.h*scale+p*2);
        }
        const fs=layer.fontSize*scale;
        ctx.font=`${layer.fontWeight||"bold"} ${fs}px Arial,sans-serif`;
        ctx.fillStyle=layer.color;
        ctx.textAlign="center";ctx.textBaseline="middle";
        layer.content.split("\n").forEach((line,i,arr)=>{
          ctx.fillText(line,(layer.x+layer.w/2)*scale,(layer.y+layer.h/2)*scale+(i-(arr.length-1)/2)*fs*1.25);
        });
        ctx.restore();
      });
      try{
        const url=canvas.toDataURL("image/jpeg",0.92);
        onChange(url);setBgImg(url);setLayers([]);setSelId(null);
        toast("✓ Layers applied!","success");
      }catch{toast("Export failed — download the background then re-upload it first","error");}
    };
    const logos=layers.filter(l=>l.type==="logo");
    let rem=logos.length;
    const bg=new Image();bg.crossOrigin="anonymous";
    bg.onload=()=>{
      ctx.drawImage(bg,0,0,1080,1080);
      if(!rem){drawTexts();return;}
      logos.forEach(layer=>{
        const img=new Image();img.crossOrigin="anonymous";
        img.onload=()=>{
          ctx.save();ctx.globalAlpha=layer.opacity;
          ctx.drawImage(img,layer.x*scale,layer.y*scale,layer.w*scale,layer.h*scale);
          ctx.restore();rem--;if(!rem)drawTexts();
        };
        img.onerror=()=>{rem--;if(!rem)drawTexts();};
        img.src=layer.content;
      });
    };
    bg.onerror=()=>toast("Background failed to load","error");
    bg.src=bgImg;
  };

  const selLayer=layers.find(l=>l.id===selId);

  return(
    <div>
      <div style={{marginBottom:10}}>
        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:6}}>BACKGROUND IMAGE</div>
        <textarea value={imgPrompt} onChange={e=>setImgPrompt(e.target.value)} rows={2}
          placeholder="Describe the background image (or upload / paste URL below)"
          style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",marginBottom:6}}/>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <select value={imgStyle} onChange={e=>setImgStyle(e.target.value)} style={{flex:1,minWidth:100,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:11}}>
            {["REALISTIC","GENERAL","DESIGN","RENDER_3D","STYLIZED","ANIME","AUTO"].map(s=><option key={s}>{s}</option>)}
          </select>
          <OBtn onClick={generateBg} disabled={genRunning} style={{flexShrink:0}}>{genRunning?"GENERATING...":"✦ GENERATE"}</OBtn>
          <label style={{display:"flex",alignItems:"center",gap:5,background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 9px",cursor:"pointer",flexShrink:0}}>
            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>↑ UPLOAD</span>
            <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=ev=>{setBgImg(ev.target.result);onChange(ev.target.result);};rd.readAsDataURL(f);}} style={{display:"none"}}/>
          </label>
          <input placeholder="paste URL…" onBlur={e=>{const v=e.target.value.trim();if(v.startsWith("http")){setBgImg(v);onChange(v);e.target.value="";}}}
            style={{width:110,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 7px",fontSize:10}}/>
        </div>
      </div>
      {bgImg&&(
        <div>
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            <button onClick={addText} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>+ TEXT</button>
            {(brandAssets||[]).filter(a=>a.url).length>0&&(
              <>
                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,flexShrink:0}}>LOGOS →</span>
                {(brandAssets||[]).filter(a=>a.url).map(a=>(
                  <button key={a.id} onClick={()=>addLogo(a.url,a.name)} title={`Add ${a.name}`}
                    style={{padding:2,border:`1px solid ${B.border}`,borderRadius:4,background:B.surface,cursor:"pointer",flexShrink:0}}>
                    {(a.url.startsWith("data:image")||/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.url))?
                      <img src={a.url} style={{width:28,height:28,objectFit:"contain",display:"block"}} alt={a.name}/>:
                      <div style={{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>📄</div>}
                  </button>
                ))}
              </>
            )}
            <div style={{marginLeft:"auto",display:"flex",gap:5}}>
              <button onClick={()=>setShowModal(true)} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>⛶ EXPAND</button>
              {layers.length>0&&<OBtn onClick={exportComposite} style={{flexShrink:0}}>✓ APPLY LAYERS</OBtn>}
            </div>
          </div>
          <div style={{position:"relative",width:"100%",paddingBottom:"100%",borderRadius:6,overflow:"hidden",border:`1px solid ${B.border}`,cursor:"default",userSelect:"none"}}
            onClick={()=>setSelId(null)}>
            <div style={{position:"absolute",inset:0}}>
              <img src={bgImg} alt="bg" style={{width:"100%",height:"100%",objectFit:"cover",display:"block",pointerEvents:"none"}}/>
              {layers.map(layer=>{
                const isSelected=selId===layer.id;
                const pct=(v,dim)=>`${(v/dim*100).toFixed(2)}%`;
                return(
                  <div key={layer.id}
                    style={{position:"absolute",left:pct(layer.x,CW),top:pct(layer.y,CH),width:pct(layer.w,CW),height:pct(layer.h,CH),
                      cursor:"move",border:`2px solid ${isSelected?B.orange:"transparent"}`,boxSizing:"border-box",borderRadius:3}}
                    onMouseDown={e=>startDrag(e,layer.id,"move")}
                    onClick={e=>{e.stopPropagation();setSelId(layer.id);}}>
                    {layer.type==="text"?(
                      <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
                        background:layer.bgColor||"transparent",padding:`${layer.bgPad||0}px`,boxSizing:"border-box",
                        fontFamily:"Arial,sans-serif",fontWeight:layer.fontWeight||"bold",color:layer.color,
                        textAlign:"center",whiteSpace:"pre-wrap",lineHeight:1.2,overflow:"hidden",pointerEvents:"none",
                        fontSize:`clamp(8px,${(layer.fontSize/CW*100).toFixed(2)}vw,72px)`}}>
                        {layer.content}
                      </div>
                    ):(
                      <img src={layer.content} alt={layer.name} style={{width:"100%",height:"100%",objectFit:"contain",display:"block",opacity:layer.opacity,pointerEvents:"none"}}/>
                    )}
                    {isSelected&&(
                      <>
                        <div onMouseDown={e=>startDrag(e,layer.id,"resize")}
                          style={{position:"absolute",bottom:-6,right:-6,width:14,height:14,background:B.orange,borderRadius:2,cursor:"se-resize",zIndex:10}}/>
                        <button onClick={e=>{e.stopPropagation();delLayer(layer.id);}}
                          style={{position:"absolute",top:-8,right:-8,width:18,height:18,background:B.red,color:"#fff",border:"none",borderRadius:"50%",cursor:"pointer",fontSize:11,lineHeight:"18px",textAlign:"center",padding:0,zIndex:10}}>✕</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {layers.length>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:4}}>Drag to move · corner handle to resize · hit APPLY LAYERS to export</div>}
          {selLayer&&(
            <div style={{marginTop:8,background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>{selLayer.type==="text"?"TEXT LAYER":"LOGO LAYER"}</div>
              {selLayer.type==="text"&&(
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  <input value={selLayer.content} onChange={e=>updLayer(selId,{content:e.target.value})}
                    style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
                    placeholder="Text content"/>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>
                      SIZE
                      <input type="range" min={8} max={80} value={selLayer.fontSize} onChange={e=>updLayer(selId,{fontSize:+e.target.value})} style={{width:80,marginLeft:4}}/>
                      <span style={{minWidth:26}}>{selLayer.fontSize}px</span>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>
                      TEXT
                      <input type="color" value={selLayer.color.startsWith("rgba")?"#ffffff":selLayer.color} onChange={e=>updLayer(selId,{color:e.target.value})} style={{width:26,height:22,padding:0,border:"none",cursor:"pointer",background:"none"}}/>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>
                      BG
                      <input type="color" value={"#000000"} onChange={e=>{const h=e.target.value,r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),bv=parseInt(h.slice(5,7),16);updLayer(selId,{bgColor:`rgba(${r},${g},${bv},0.6)`});}} style={{width:26,height:22,padding:0,border:"none",cursor:"pointer",background:"none"}}/>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:4,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer"}}>
                      <input type="checkbox" checked={selLayer.bgColor==="transparent"} onChange={e=>updLayer(selId,{bgColor:e.target.checked?"transparent":"rgba(0,0,0,0.55)"})}/>
                      No background
                    </label>
                  </div>
                </div>
              )}
              {selLayer.type==="logo"&&(
                <label style={{display:"flex",alignItems:"center",gap:6,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>
                  OPACITY
                  <input type="range" min={10} max={100} value={Math.round(selLayer.opacity*100)} onChange={e=>updLayer(selId,{opacity:e.target.value/100})} style={{width:100,marginLeft:4}}/>
                  <span>{Math.round(selLayer.opacity*100)}%</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}
      {showModal&&bgImg&&(
        <div onClick={()=>setShowModal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
          <img src={bgImg} alt="full" style={{maxWidth:"90vw",maxHeight:"90vh",borderRadius:8,objectFit:"contain"}}/>
          <button onClick={e=>{e.stopPropagation();setShowModal(false);}} style={{position:"absolute",top:16,right:20,background:"none",border:"none",color:"#fff",fontSize:28,cursor:"pointer"}}>✕</button>
        </div>
      )}
    </div>
  );
}

function ModSocial() {
  const {s,dispatch,toast}=useApp();
  const [tab,setTab]=useState("calendar");
  const [calYear,setCalYear]=useState(()=>new Date().getFullYear());
  const [calMonth,setCalMonth]=useState(()=>new Date().getMonth());
  // New post form
  const [caption,setCaption]=useState("");
  const [platforms,setPlatforms]=useState([]);
  const [postType,setPostType]=useState("post");
  const [imageUrl,setImageUrl]=useState("");
  const [scheduleAt,setScheduleAt]=useState("");
  const [scheduleTime,setScheduleTime]=useState("09:00");
  const [linkUrl,setLinkUrl]=useState("");
  const [linkedCampId,setLinkedCampId]=useState("");
  const [posting,setPosting]=useState(false);
  const [genRunning,setGenRunning]=useState(false);
  const [editingPostId,setEditingPostId]=useState(null);
  const [editDraft,setEditDraft]=useState({});
  const [verboseDebugId,setVerboseDebugId]=useState(null);
  const [verboseResult,setVerboseResult]=useState(null);
  const [postLength,setPostLength]=useState("medium"); // "short" | "medium" | "long"
  // Filters
  const [filterStatus,setFilterStatus]=useState("all");
  const [filterPlatform,setFilterPlatform]=useState("all");
  const [editingPost,setEditingPost]=useState(null); // post being edited in modal
  const [syncingStats,setSyncingStats]=useState(false);

  const campaigns=s.campaigns||[];

  // Combine standalone + campaign social posts (scheduled drafts + published)
  const standalonePosts=(s.socialPosts||[]).map(p=>({...p,_source:"standalone"}));
  const campaignDraftPosts=campaigns.flatMap(c=>
    (c.socialDrafts||[])
      .filter(p=>(p.scheduledDate||p.date))
      .map(p=>({...p,date:p.scheduledDate||p.date,status:"scheduled",_source:"campaign_draft",_campaignId:c.id,_campaignName:c.name}))
  );
  const campaignPosts=campaigns.flatMap(c=>
    (c.socialPosts||[]).map(p=>({...p,_source:"campaign",_campaignId:c.id,_campaignName:c.name}))
  );
  const allPosts=[...standalonePosts,...campaignPosts,...campaignDraftPosts]
    .sort((a,b)=>(b.createdAt||b.date||"").localeCompare(a.createdAt||a.date||""));

  const getPostsForDay=(y,m,d)=>{
    const dateStr=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return allPosts.filter(p=>(p.date||"").slice(0,10)===dateStr);
  };

  const generateCaption=async()=>{
    setGenRunning(true);
    const hardLimit=platforms.length?Math.min(...platforms.map(p=>PLATFORM_LIMITS[p]||3000)):3000;
    const lengthTargets={short:{words:30,chars:200},medium:{words:80,chars:500},long:{words:180,chars:1200}};
    const target=lengthTargets[postLength];
    const effectiveChars=Math.min(target.chars,hardLimit);
    const platformNote=hardLimit<500?` IMPORTANT: ${platforms.find(p=>PLATFORM_LIMITS[p]===hardLimit)} has a ${hardLimit}-character limit — stay well under it.`:"";
    const lengthGuide=`around ${target.words} words / ${effectiveChars} characters max${platformNote}`;
    const direction=caption.trim();
    const strict=`\n\nRETURN ONLY THE FINISHED POST TEXT. No explanations, no bullet points, no character counts. Just the post.`;
    const prompt=direction
      ?`Rewrite and improve this social media post for ST1 Sports (athletic equipment company). ${ST1}\nKeep the same core message.\nPlatforms: ${platforms.join(", ")||"general social"}.\nLength: ${lengthGuide}.${strict}\n\nDraft to improve:\n${direction}`
      :`Write a social media post for ST1 Sports (athletic equipment company). ${ST1}\nPlatforms: ${platforms.join(", ")||"general social"}.\nTone: professional but engaging.\nLength: ${lengthGuide}.${strict}`;
    const r=await aiCall(prompt,{tokens:postLength==="long"?500:postLength==="medium"?300:150});
    if(r) setCaption(r);
    setGenRunning(false);
  };

  // Poll Publer job status until done, then update post state with result
  const checkPublerJob=async(postId,jobId,isScheduled)=>{
    for(let i=0;i<8;i++){
      await new Promise(r=>setTimeout(r,i===0?3000:4000));
      try{
        const r=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"job-status",jobId})});
        const d=await r.json();
        if(d.done){
          if(d.failures?.length){
            const msg=d.failures.join(" | ");
            dispatch("UPDATE_SOCIAL_POST",{id:postId,status:"local_only",publerError:msg});
            toast(`Publer failed: ${msg}`,"error");
          }else{
            dispatch("UPDATE_SOCIAL_POST",{id:postId,status:"scheduled",publerError:null});
            toast(isScheduled?"Scheduled in Publer — check your calendar!":"Queued in Publer — posts in ~2 min, check your calendar!","success");
          }
          return;
        }
      }catch{}
    }
    // Timed out — assume success if we got a job_id (Publer queued it)
    dispatch("UPDATE_SOCIAL_POST",{id:postId,status:isScheduled?"scheduled":"published",publerError:null});
    toast("Sent to Publer (confirm in your Publer calendar)","success");
  };

  const submitPost=async()=>{
    if(!platforms.length){toast("Select at least one platform","error");return;}
    if(!caption.trim()){toast("Caption is required","error");return;}
    if(scheduleAt){
      const tzOff=new Date().getTimezoneOffset();
      const tzSign=tzOff<=0?"+":"-";
      const tzH=String(Math.floor(Math.abs(tzOff)/60)).padStart(2,"0");
      const tzM=String(Math.abs(tzOff)%60).padStart(2,"0");
      const chosen=new Date(`${scheduleAt}T${scheduleTime}:00${tzSign}${tzH}:${tzM}`);
      if(chosen<=new Date()){
        const n=new Date(Date.now()+5*60*1000);
        toast(`${scheduleTime} is in the past — pick a time after ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}  (your local time)`,"error");
        return;
      }
    }
    setPosting(true);
    const tzOff=new Date().getTimezoneOffset(); // e.g. 300 for CDT (UTC-5)
    const tzSign=tzOff<=0?"+":"-";
    const tzH=String(Math.floor(Math.abs(tzOff)/60)).padStart(2,"0");
    const tzM=String(Math.abs(tzOff)%60).padStart(2,"0");
    const scheduleDateTime=scheduleAt?`${scheduleAt}T${scheduleTime}:00${tzSign}${tzH}:${tzM}`:null;
    const post={id:mkId(),createdAt:today(),date:scheduleAt||today(),time:scheduleTime,platforms,caption,imageUrl:imageUrl||"",link:linkUrl||"",status:"local_only",postType,campaignId:linkedCampId||""};
    dispatch("ADD_SOCIAL_POST",post);
    if(linkedCampId){
      const camp=campaigns.find(c=>c.id===linkedCampId);
      if(camp) dispatch("UPDATE_CAMPAIGN",{...camp,socialPosts:[...(camp.socialPosts||[]),post]});
    }
    try{
      const r=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({post:caption,platforms,mediaUrls:imageUrl?[imageUrl]:undefined,scheduleDate:scheduleDateTime||undefined,isStory:postType==="story",link:linkUrl||undefined})});
      const data=await r.json();
      const isSuccess=(data.status==="success"||data.status==="scheduled")&&!data.error;
      if(isSuccess){
        const jobId=data.postIds?.[0];
        dispatch("UPDATE_SOCIAL_POST",{id:post.id,status:"local_only",publerPostIds:data.postIds||[],publerError:null});
        if(linkedCampId){const camp=campaigns.find(c=>c.id===linkedCampId);if(camp)dispatch("UPDATE_CAMPAIGN",{...camp,socialPosts:[...(camp.socialPosts||[]).filter(p=>p.id!==post.id),{...post,status:"local_only"}]});}
        if(data._missing) toast(`⚠ ${data._missing}`,"warn");
        toast("Sent to Publer — checking result…","info");
        // Poll job status in background to confirm success or surface failure
        if(jobId) checkPublerJob(post.id,jobId,!!scheduleAt);
        else{dispatch("UPDATE_SOCIAL_POST",{id:post.id,status:scheduleAt?"scheduled":"published"});toast(scheduleAt?"Scheduled!":"Published!","success");}
      }else{
        const errMsg=data.error||"Publer rejected the post";
        dispatch("UPDATE_SOCIAL_POST",{id:post.id,status:"local_only",publerError:errMsg});
        toast(`Saved locally — Publer failed: ${errMsg.slice(0,120)}`,"warn");
      }
    }catch(err){
      dispatch("UPDATE_SOCIAL_POST",{id:post.id,status:"local_only",publerError:err.message});
      toast(`Saved locally — Publer unreachable: ${err.message.slice(0,60)}`,"warn");
    }
    setCaption("");setPlatforms([]);setImageUrl("");setScheduleAt("");setLinkUrl("");setLinkedCampId("");
    setTab("posts");
    setPosting(false);
  };

  const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAY_NAMES=["Su","Mo","Tu","We","Th","Fr","Sa"];
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDay=new Date(calYear,calMonth,1).getDay();

  const filtered=allPosts.filter(p=>{
    if(filterStatus!=="all"&&p.status!==filterStatus) return false;
    if(filterPlatform!=="all"&&!(p.platforms||[]).includes(filterPlatform)) return false;
    return true;
  });

  const scheduledCount=allPosts.filter(p=>p.status==="scheduled").length;

  return(
    <div style={{padding:"22px 26px"}}>
      <PH title="SOCIAL MEDIA" sub="Schedule, publish, and track posts across all platforms"/>
      <div style={{display:"flex",gap:5,marginBottom:18,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:5}}>
          {[["calendar","📅 CALENDAR"],["posts","📋 ALL POSTS"],["new","✦ NEW POST"]].map(([id,l])=>(
            <button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {scheduledCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,background:B.blueBg,padding:"3px 9px",borderRadius:3}}>{scheduledCount} SCHEDULED</span>}
          <OBtn sm onClick={()=>setTab("new")}>+ NEW POST</OBtn>
        </div>
      </div>

      {/* ── CALENDAR ──────────────────────────────────────────────────────── */}
      {tab==="calendar"&&(
        <div>
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}>
            <button onClick={()=>{let m=calMonth-1,y=calYear;if(m<0){m=11;y--;}setCalMonth(m);setCalYear(y);}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text}}>‹</button>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,flex:1,textAlign:"center",letterSpacing:.3}}>{MONTH_NAMES[calMonth]} {calYear}</div>
            <button onClick={()=>{let m=calMonth+1,y=calYear;if(m>11){m=0;y++;}setCalMonth(m);setCalYear(y);}} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text}}>›</button>
            <OBtn sm onClick={()=>setTab("new")}>+ POST</OBtn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,marginBottom:2}}>
            {DAY_NAMES.map(d=><div key={d} style={{textAlign:"center",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,padding:"5px 0",letterSpacing:.5}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {Array(firstDay).fill(null).map((_,i)=><div key={`e${i}`} style={{background:B.surface,minHeight:90,borderRadius:4}}/>)}
            {Array(daysInMonth).fill(null).map((_,i)=>{
              const d=i+1;
              const posts=getPostsForDay(calYear,calMonth,d);
              const isToday=new Date().getFullYear()===calYear&&new Date().getMonth()===calMonth&&new Date().getDate()===d;
              return(
                <div key={d} style={{background:B.bg,border:`1px solid ${isToday?B.orange:B.border}`,borderRadius:4,padding:"5px 6px",minHeight:90,cursor:posts.length?"pointer":"default"}} onClick={()=>{if(posts.length)setTab("posts");}}>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:isToday?B.orange:B.text,fontWeight:isToday?700:400,marginBottom:3}}>{d}</div>
                  {posts.slice(0,3).map((p,pi)=>{
                    const col=PLATFORM_COLORS[(p.platforms||[])[0]]||B.purple;
                    const isDraft=p._source==="campaign_draft";
                    return(
                      <div key={pi} style={{background:`${col}18`,borderLeft:`2px solid ${col}`,padding:"1px 5px",borderRadius:2,marginBottom:2,opacity:isDraft?.7:1}}>
                        <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:col,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{isDraft?"(draft) ":""}{(p.platforms||[]).join(", ")}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(p.caption||"").slice(0,28)}</div>
                      </div>
                    );
                  })}
                  {posts.length>3&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,marginTop:2}}>+{posts.length-3}</div>}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:12,marginTop:14,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>PLATFORMS:</div>
            {Object.entries(PLATFORM_COLORS).map(([pl,col])=>(
              <div key={pl} style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:10,height:10,borderRadius:2,background:col,flexShrink:0}}/>
                <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{pl}</span>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:12}}>
              <div style={{width:10,height:10,borderRadius:2,background:B.purple,opacity:.5,flexShrink:0}}/>
              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>campaign draft</span>
            </div>
          </div>
        </div>
      )}

      {/* ── ALL POSTS ─────────────────────────────────────────────────────── */}
      {tab==="posts"&&(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>{allPosts.length} TOTAL</div>
            <div style={{display:"flex",gap:4,marginLeft:"auto"}}>
              {["all","scheduled","published","draft"].map(st=>(
                <button key={st} onClick={()=>setFilterStatus(st)} style={{background:filterStatus===st?B.orange:B.white,color:filterStatus===st?B.white:B.muted,border:`1px solid ${filterStatus===st?B.orange:B.border}`,borderRadius:3,padding:"4px 9px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{st.toUpperCase()}</button>
              ))}
            </div>
            <select value={filterPlatform} onChange={e=>setFilterPlatform(e.target.value)} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:3,padding:"5px 8px",fontSize:11,color:B.text}}>
              <option value="all">All platforms</option>
              {SOCIAL_PLATFORMS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {filtered.length===0?(
            <div className="card" style={{padding:40,textAlign:"center"}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,marginBottom:8}}>No posts yet</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:16}}>Create standalone posts here or schedule posts inside a campaign</div>
              <OBtn onClick={()=>setTab("new")}>+ CREATE FIRST POST</OBtn>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filtered.map(p=>{
                const isLocalOnly=p.status==="local_only";
                const sc={scheduled:B.blue,published:B.green,draft:B.muted,local_only:B.red}[p.status]||B.muted;
                const retryPost=async()=>{
                  if(!(p.caption||"").trim()){toast("No caption to send","error");return;}
                  try{
                    // Build a future schedule time (5 min from now) so Publer can schedule correctly
                    const tzOff=new Date().getTimezoneOffset();
                    const tzSign=tzOff<=0?"+":"-";
                    const tzH=String(Math.floor(Math.abs(tzOff)/60)).padStart(2,"0");
                    const tzM=String(Math.abs(tzOff)%60).padStart(2,"0");
                    const retryTime=new Date(Date.now()+5*60*1000);
                    const pad=n=>String(n).padStart(2,"0");
                    const retryIso=`${retryTime.getFullYear()}-${pad(retryTime.getMonth()+1)}-${pad(retryTime.getDate())}T${pad(retryTime.getHours())}:${pad(retryTime.getMinutes())}:00${tzSign}${tzH}:${tzM}`;
                    const r=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({post:p.caption,platforms:p.platforms,mediaUrls:p.imageUrl?[p.imageUrl]:undefined,link:p.link||undefined,scheduleDate:retryIso})});
                    const data=await r.json();
                    const ok=(data.status==="success"||data.status==="scheduled")&&!data.error;
                    if(ok){
                      const jobId=data.postIds?.[0];
                      const isFakeId=jobId?.startsWith("publer-submitted-");
                      dispatch("UPDATE_SOCIAL_POST",{id:p.id,status:"scheduled",publerError:null,publerPostIds:data.postIds||[]});
                      if(isFakeId||!jobId){
                        toast("Sent to Publer — check your calendar to confirm","success");
                      }else{
                        toast("Sent to Publer — checking result…","info");
                        checkPublerJob(p.id,jobId,false);
                      }
                    }else{
                      const detail=data.detail?JSON.stringify(data.detail).slice(0,200):"";
                      const msg=(data.error||"Publer rejected post")+(detail?` — ${detail}`:"");
                      dispatch("UPDATE_SOCIAL_POST",{id:p.id,status:"local_only",publerError:msg});
                      toast(msg,"error");
                    }
                  }catch(e){toast("Publer unreachable: "+e.message,"error");}
                };
                const runVerboseDebug=async()=>{
                  setVerboseDebugId(p.id);setVerboseResult(null);
                  try{
                    const tzOff=new Date().getTimezoneOffset();
                    const tzSign=tzOff<=0?"+":"-";
                    const tzH=String(Math.floor(Math.abs(tzOff)/60)).padStart(2,"0");
                    const tzM=String(Math.abs(tzOff)%60).padStart(2,"0");
                    const retryTime=new Date(Date.now()+5*60*1000);
                    const pad=n=>String(n).padStart(2,"0");
                    const retryIso=`${retryTime.getFullYear()}-${pad(retryTime.getMonth()+1)}-${pad(retryTime.getDate())}T${pad(retryTime.getHours())}:${pad(retryTime.getMinutes())}:00${tzSign}${tzH}:${tzM}`;
                    const r=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({action:"send-verbose",post:p.caption,platforms:p.platforms,mediaUrls:p.imageUrl?[p.imageUrl]:undefined,link:p.link||undefined,scheduleDate:retryIso})});
                    const data=await r.json();
                    setVerboseResult(data);
                  }catch(e){setVerboseResult({error:e.message});}
                };
                const isEditing=editingPostId===p.id;
                const saveEdit=async()=>{
                  if(!editDraft.caption?.trim()){toast("Caption required","error");return;}
                  if(editDraft.scheduleAt){
                    const tzOff=new Date().getTimezoneOffset();
                    const tzSign=tzOff<=0?"+":"-";
                    const tzH=String(Math.floor(Math.abs(tzOff)/60)).padStart(2,"0");
                    const tzM=String(Math.abs(tzOff)%60).padStart(2,"0");
                    const chosen=new Date(`${editDraft.scheduleAt}T${editDraft.scheduleTime||"09:00"}:00${tzSign}${tzH}:${tzM}`);
                    if(chosen<=new Date()){
                      const n=new Date(Date.now()+5*60*1000);
                      toast(`${editDraft.scheduleTime||"09:00"} is in the past — pick a time after ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")} (your local time)`,"error");
                      return;
                    }
                  }
                  dispatch("UPDATE_SOCIAL_POST",{id:p.id,caption:editDraft.caption,platforms:editDraft.platforms||p.platforms,date:editDraft.scheduleAt||p.date,time:editDraft.scheduleTime||p.time,status:"local_only",publerError:"Edited — click Retry to re-send to Publer"});
                  setEditingPostId(null);
                  toast("Post updated — click Retry to re-send to Publer","info");
                };
                return(
                  <div key={p.id} className="card" style={{padding:"12px 16px",borderLeft:isLocalOnly?`3px solid ${B.red}`:"none"}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                      {p.imageUrl&&<img src={p.imageUrl} style={{width:60,height:60,objectFit:"cover",borderRadius:6,flexShrink:0}} alt=""/>}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
                          {(p.platforms||[]).map(pl=>(
                            <span key={pl} style={{background:PLATFORM_COLORS[pl]||B.purple,color:"#fff",borderRadius:3,padding:"2px 7px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700}}>{pl.toUpperCase()}</span>
                          ))}
                          <span style={{background:`${sc}14`,color:sc,border:`1px solid ${sc}30`,borderRadius:3,padding:"1px 7px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5}}>{isLocalOnly?"⚠ PUBLER FAILED":(p.status||"draft").toUpperCase()}</span>
                          {p.date&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{p.date}{p.time?` @ ${p.time}`:""}</span>}
                          {p._campaignName&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:`${B.orange}14`,padding:"1px 6px",borderRadius:3}}>📣 {p._campaignName}</span>}
                          {p._source==="campaign_draft"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,background:B.surface,padding:"1px 6px",borderRadius:3}}>DRAFT</span>}
                          {isLocalOnly&&<button onClick={retryPost} style={{background:B.orange,color:B.white,border:"none",borderRadius:3,padding:"2px 9px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>↻ RETRY TO PUBLER</button>}
                          {!isLocalOnly&&p.status!=="draft"&&<button onClick={retryPost} style={{background:"none",color:B.muted,border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 9px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>↻ RESEND</button>}
                          {p.status!=="draft"&&<button onClick={runVerboseDebug} style={{background:"none",color:B.blue,border:`1px solid ${B.blue}`,borderRadius:3,padding:"2px 9px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>🔍 DEBUG</button>}
                        </div>
                        {isLocalOnly&&p.publerError&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.red,marginBottom:4}}>Error: {p.publerError}</div>}
                        {verboseDebugId===p.id&&verboseResult&&(
                          <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"8px 10px",marginBottom:6,fontSize:10,fontFamily:"'Lexend',sans-serif"}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.5,marginBottom:4}}>DEBUG SEND RESULT</div>
                            <div style={{marginBottom:6}}><b>Verdict:</b> <span style={{color:(verboseResult.verdict||"").startsWith("SUCCESS")?B.green:B.red,fontWeight:700}}>{verboseResult.verdict||"?"}</span></div>
                            <div style={{marginBottom:4}}><b>Workspace:</b> {verboseResult.workspaceId} | <b>Account:</b> {verboseResult.accountId}</div>
                            {(verboseResult.attempts||[]).map((a,i)=>(
                              <div key={i} style={{marginBottom:3,padding:"3px 6px",background:a.ok||a.status===200||a.status===201?`${B.green}10`:`${B.red}08`,borderRadius:3,border:`1px solid ${a.ok||a.status===200||a.status===201?B.green:B.red}20`,fontSize:9}}>
                                <b style={{color:a.ok||a.status===200||a.status===201?B.green:B.red}}>{a.label}</b> → HTTP {a.status} | {JSON.stringify(a.response).slice(0,120)}
                              </div>
                            ))}
                            {verboseResult.top5PostsAfter&&<div style={{marginTop:4,fontSize:9}}><b>Top 5 after:</b> {verboseResult.top5PostsAfter.map(sp=><span key={sp.id} style={{marginRight:6}}>[{sp.id}] "{sp.text||"(empty)"}"</span>)}</div>}
                            {verboseResult.error&&<div style={{color:B.red}}><b>Error:</b> {verboseResult.error}</div>}
                            <button onClick={()=>{setVerboseDebugId(null);setVerboseResult(null);}} style={{marginTop:4,background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:8,cursor:"pointer",color:B.muted}}>✕ CLOSE</button>
                          </div>
                        )}
                        {!isEditing&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.5}}>{p.caption}</div>}
                      </div>
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        <button onClick={()=>{if(isEditing){setEditingPostId(null);}else{setEditingPostId(p.id);setEditDraft({caption:p.caption||"",platforms:p.platforms||[],scheduleAt:p.date||"",scheduleTime:p.time||"09:00"});}}} style={{background:isEditing?"none":B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>{isEditing?"✕":"EDIT"}</button>
                        {p._source==="standalone"&&(
                          <button onClick={()=>{if(window.confirm("Delete this post?"))dispatch("DELETE_SOCIAL_POST",p.id);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>✕</button>
                        )}
                      </div>
                    </div>
                    {isEditing&&(
                      <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${B.border}`}}>
                        <textarea value={editDraft.caption} onChange={e=>setEditDraft(d=>({...d,caption:e.target.value}))} rows={4} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6,marginBottom:8}}/>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          <div>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>DATE</div>
                            <input type="date" value={editDraft.scheduleAt} min={today()} onChange={e=>setEditDraft(d=>({...d,scheduleAt:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
                          </div>
                          <div>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>TIME</div>
                            <input type="time" value={editDraft.scheduleTime} onChange={e=>setEditDraft(d=>({...d,scheduleTime:e.target.value}))} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
                          </div>
                        </div>
                        <button onClick={saveEdit} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"7px 18px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",fontWeight:700}}>SAVE CHANGES</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── NEW POST ──────────────────────────────────────────────────────── */}
      {tab==="new"&&(
        <div style={{maxWidth:640}}>
          <div className="card" style={{padding:22}}>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2,marginBottom:18}}>NEW POST</div>
            {/* Platforms */}
            <div style={{marginBottom:16}}>
              <Lbl s={{marginBottom:8}}>PLATFORMS</Lbl>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {SOCIAL_PLATFORMS.map(pl=>{
                  const on=platforms.includes(pl);
                  const col=PLATFORM_COLORS[pl];
                  return(<button key={pl} onClick={()=>setPlatforms(p=>on?p.filter(x=>x!==pl):[...p,pl])} style={{background:on?col:B.surface,color:on?"#fff":B.muted,border:`2px solid ${on?col:B.border}`,borderRadius:5,padding:"8px 16px",fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:on?600:400}}>{pl.charAt(0).toUpperCase()+pl.slice(1)}</button>);
                })}
              </div>
            </div>
            {/* Post type */}
            <div style={{marginBottom:16}}>
              <Lbl s={{marginBottom:7}}>POST TYPE</Lbl>
              <div style={{display:"flex",gap:6}}>
                {["post","story","reel"].map(t=>(
                  <button key={t} onClick={()=>setPostType(t)} style={{background:postType===t?`${B.orange}14`:B.surface,color:postType===t?B.orange:B.muted,border:`1px solid ${postType===t?B.orange:B.border}`,borderRadius:3,padding:"5px 14px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{t.toUpperCase()}</button>
                ))}
              </div>
            </div>
            {/* Caption */}
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <Lbl>CAPTION</Lbl>
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  {["short","medium","long"].map(l=>(
                    <button key={l} onClick={()=>setPostLength(l)} style={{background:postLength===l?`${B.purple}18`:B.surface,color:postLength===l?B.purple:B.muted,border:`1px solid ${postLength===l?B.purple:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{l.toUpperCase()}</button>
                  ))}
                  <button onClick={generateCaption} disabled={genRunning} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genRunning?.7:1}}>
                    {genRunning?"✦ WRITING...":"✦ AI WRITE"}
                  </button>
                </div>
              </div>
              <textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={5} placeholder="Write your caption… or let AI draft it" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3,textAlign:"right"}}>{caption.length} chars</div>
            </div>
            {/* Image */}
            <div style={{marginBottom:14}}>
              <Lbl s={{marginBottom:8}}>IMAGE (optional)</Lbl>
              <SocialImageEditor value={imageUrl} onChange={setImageUrl} brandAssets={s.brandAssets||[]} toast={toast}
                onSaveAsset={(url,prompt)=>dispatch("ADD_BRAND_ASSET",{id:mkId(),url,name:prompt||"AI Social Image",type:"social",createdAt:today()})}/>
            </div>
            {/* Link */}
            <div style={{marginBottom:14}}>
              <Lbl s={{marginBottom:5}}>LINK URL (optional)</Lbl>
              <input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://st1sports.com/..." style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
            </div>
            {/* Campaign link */}
            {campaigns.length>0&&(
              <div style={{marginBottom:14}}>
                <Lbl s={{marginBottom:5}}>LINK TO CAMPAIGN (optional)</Lbl>
                <select value={linkedCampId} onChange={e=>setLinkedCampId(e.target.value)} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}>
                  <option value="">Standalone post</option>
                  {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {/* Schedule */}
            <div style={{marginBottom:20,padding:"12px 14px",background:B.surface,borderRadius:6,border:`1px solid ${B.border}`}}>
              <Lbl s={{marginBottom:8}}>SCHEDULE</Lbl>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>DATE (blank = post now)</div>
                  <input type="date" value={scheduleAt} min={today()} onChange={e=>{
                    const d=e.target.value; setScheduleAt(d);
                    // If today selected, advance time to now+15min so it's always valid
                    if(d===today()){const n=new Date(Date.now()+15*60*1000);setScheduleTime(`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`);}
                  }} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12}}/>
                </div>
                <div>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>TIME{scheduleAt===today()&&<span style={{color:B.orange}}> — must be after {nowPlusMin(5)}</span>}</div>
                  <input type="time" value={scheduleTime}
                    min={scheduleAt===today()?nowPlusMin(5):undefined}
                    onChange={e=>setScheduleTime(e.target.value)}
                    style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:12}}/>
                </div>
              </div>
            </div>
            {!platforms.length&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,marginBottom:10}}>Select at least one platform</div>}
            <OBtn onClick={submitPost} disabled={posting||!caption.trim()||!platforms.length} style={{width:"100%",justifyContent:"center"}}>
              {posting?"POSTING…":(scheduleAt?`🗓 SCHEDULE FOR ${scheduleAt}`:"📣 POST NOW")}
            </OBtn>
          </div>
        </div>
      )}
    </div>
  );
}

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
      // Social posting API returns status:"success" or "scheduled" on success.
      // It can also return status:"success" WITH errors[] if individual platforms fail.
      const platformErrors = Array.isArray(data.errors) ? data.errors : [];
      const isSuccess = (data.status === "success" || data.status === "scheduled") && !data.error;
      if (isSuccess) {
        const failedNets = platformErrors.map(e=>e.network||e.platform).filter(Boolean);
        const okCount = socialPlatforms.length - failedNets.length;
        setSocialResult({ ok:true, platformErrors, failedNets, warning: data._warning });
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
                    <button onClick={()=>{
                      setAdImg(ideoResult.imageUrl);
                      const parts=[adHeadline,adSub,adCta?`👉 ${adCta}`:"","#ST1Sports #Athletics #TrackAndField"].filter(Boolean);
                      setSocialCaption(parts.join("\n\n"));
                      setShowSocialPanel(true);
                      setSocialResult(null);
                    }} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>
                      📣 POST THIS
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

                {/* Image URL warning */}
                {socialResult?.warning&&(
                  <div style={{marginTop:10,background:"#fff3cd",border:"1px solid #f0ad0060",borderRadius:6,padding:"10px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#7a4f00",lineHeight:1.6}}>
                    ⚠ <strong>Image not attached:</strong> {socialResult.warning}
                  </div>
                )}

                {/* Social API error warning */}
                {socialResult?.error&&(
                  <div style={{marginTop:10,background:"#fff3cd",border:"1px solid #f0ad0060",borderRadius:6,padding:"10px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#7a4f00",lineHeight:1.6}}>
                    <strong>Post failed:</strong> {socialResult.error}
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
    const openDeals=(s.deals||[]).filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
    const pipeline=openDeals.reduce((a,d)=>a+d.value,0);
    const ar=(s.invoices||[]).filter(i=>!["paid","void","draft"].includes(i.status)).reduce((a,i)=>a+(i.balance||0),0);
    const overdue=openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0);
    const hot=openDeals.filter(d=>d.priority==="hot");
    const activeRfps=(s.rfps||[]).filter(r=>!["No Bid","Lost","Won"].includes(r.stage));
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
${fmt$(ar)} outstanding${(s.invoices||[]).filter(i=>i.status==="overdue").length>0?` — ${(s.invoices||[]).filter(i=>i.status==="overdue").length} overdue`:""}

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
  const openDeals=(s.deals||[]).filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
  const pipeline=openDeals.reduce((a,d)=>a+d.value,0);
  const overdueDeals=openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0).slice(0,4);
  const topContacts=[...(s.contacts||[])].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4);
  const openRfps=(s.rfps||[]).filter(r=>!["No Bid","Lost","Won"].includes(r.stage)).slice(0,3);

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
  const [channel,setChannel]=useState((s.integrations||{}).slackChannel||"C0AQ7CMB01X");
  const [sending,setSending]=useState(false);
  const pending=(s.alerts||[]).filter(a=>!a.sent);

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
    const alert=(s.alerts||[]).find(a=>a.id===id);
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
      {(s.alerts||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>No alerts yet — signals from deals, invoices, and prospecting appear here</div>}
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {(s.alerts||[]).map(a=>(
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
function BrandAssetAddForm({dispatch,toast,s}) {
  const [form,setForm]=useState({name:"",url:"",type:"logo"});
  const handleAdd=()=>{
    if(!form.name||!form.url){toast("Name and URL required","error");return;}
    dispatch("ADD_BRAND_ASSET",{id:mkId(),...form,createdAt:new Date().toISOString().slice(0,10)});
    setForm({name:"",url:"",type:"logo"});
    toast("Asset added!","success");
  };
  const lastAdUrl=(s.savedAds||[]).filter(a=>a.imageUrl).slice(-1)[0]?.imageUrl;
  return(
    <div style={{borderTop:`1px solid ${B.border}`,paddingTop:12}}>
      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:9}}>ADD ASSET</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,marginBottom:8}}>
        <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Asset name" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
        <input value={form.url} onChange={e=>setForm(f=>({...f,url:e.target.value}))} placeholder="https://… or data URL" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
        <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>
          {["logo","product-photo","banner","template"].map(t=><option key={t}>{t}</option>)}
        </select>
      </div>
      <div style={{display:"flex",gap:7}}>
        <OBtn sm onClick={handleAdd}>+ ADD ASSET</OBtn>
        {lastAdUrl&&<button onClick={()=>setForm(f=>({...f,url:lastAdUrl,name:f.name||"Ad Engine Image",type:"banner"}))} style={{background:B.purpleBg,color:B.purple,border:`1px solid ${B.purple}40`,borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>USE FROM AD ENGINE</button>}
      </div>
    </div>
  );
}

function ModSettings() {
  const {s,dispatch,toast,setMod}=useApp();
  const [ints,setInts]=useState({...(s.integrations||{})});
  const [co,setCo]=useState({...SEED.company,...(s.company||{})});
  const [repForm,setRepForm]=useState(null); // null = hidden, {} = new, {id,...} = edit
  const [pinForm,setPinForm]=useState(null); // repId being set, or null
  const [pinVal,setPinVal]=useState("");
  const [gmailStatus,setGmailStatus]=useState(null); // null=checking, true=ok, false=error

  const testRepEmail=async(rep)=>{
    const fromLabel = rep.gmailEnvKey ? `${rep.gmailEnvKey}'s Gmail` : "shared Gmail";
    toast(`Sending test to ${rep.email} via ${fromLabel}…`,"info");
    try {
      const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action:"send", to_email:rep.email, to_name:rep.name,
        subject:`ST1 RevOps — email test for ${rep.name}`,
        body:`Hi ${(rep.name||"there").split(" ")[0]},\n\nThis is a test email confirming your address is connected to ST1 RevOps. If you received this, outbound email is working correctly for your account.\n\n— ST1 RevOps`,
        ...(rep.gmailEnvKey ? {repEnvKey:rep.gmailEnvKey} : {}),
      })}).then(r=>r.json());
      if(d.sent) toast(`Test sent to ${rep.email} via ${fromLabel} ✓`,"success");
      else toast("Send failed: "+(d.error||JSON.stringify(d)),"error");
    } catch(e){ toast("Error: "+e.message,"error"); }
  };

  const savePin=()=>{
    if(pinVal.length!==4||!/^\d{4}$/.test(pinVal)){toast("PIN must be exactly 4 digits","error");return;}
    dispatch("SET_APP_USER",{repId:pinForm,pin:pinVal});
    toast("PIN saved — rep can now log in","success");
    setPinForm(null);setPinVal("");
  };

  const revokeAccess=(rep)=>{
    if(!window.confirm(`Remove login access for ${rep.name}?`)) return;
    dispatch("DEL_APP_USER",rep.id);
    toast(`Access revoked for ${rep.name}`,"success");
  };
  const save=()=>{dispatch("SAVE_INTEGRATIONS",ints);dispatch("SAVE_COMPANY",co);toast("Settings saved","success");};
  const saveRep=()=>{
    if(!repForm?.name||!repForm?.email){toast("Name and email required","error");return;}
    if(repForm.id){dispatch("UPDATE_REP",repForm);toast("Rep updated","success");}
    else{dispatch("ADD_REP",{...repForm,id:mkId()});toast("Rep added","success");}
    setRepForm(null);
  };
  useEffect(()=>{
    fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"profile"})})
      .then(r=>r.json()).then(d=>setGmailStatus(!d.error&&(d.email||d.emailAddress||d.profile)))
      .catch(()=>setGmailStatus(false));
  },[]);

  return (
    <div style={{padding:"22px 26px",maxWidth:760}}>
      <PH title="SETTINGS" sub="Company profile, integrations, and data management"/>

      {/* Company Profile */}
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
        <Lbl c={B.orange} s={{marginBottom:12}}>Company Profile</Lbl>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,lineHeight:1.5}}>
          This info is used in campaign emails, bid documents, and agent-drafted correspondence.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:11}}>
          {[["Company Name","name","text"],["Owner / Rep Name","ownerName","text"],["Email Address","email","email"],["Phone Number","phone","text"],["Address","address","text"],["Website","website","text"],["Quote BCC Email","quoteTrackEmail","email"]].map(([l,k,t])=>(
            <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl>
              <input type={t} value={co[k]||""} onChange={e=>setCo(c=>({...c,[k]:e.target.value}))}
                placeholder={k==="email"?"you@company.com":k==="website"?"yoursite.com":""}
                style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
            </div>
          ))}
        </div>
        <OBtn onClick={save}>SAVE SETTINGS</OBtn>
      </div>

      {/* BCC-to-Deal Email Tracking */}
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.blue}`}}>
        <Lbl c={B.blue} s={{marginBottom:6}}>BCC-to-Deal Tracking</Lbl>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,lineHeight:1.6}}>
          Like HubSpot's BCC key — when you send a pricing email from any email client, BCC your tracking address and a deal will be auto-created in RevOps when you click <strong style={{color:B.text}}>Sync Quotes</strong> in the Deals tab.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:11}}>
          <div>
            <Lbl s={{marginBottom:3}}>Inbound Email Webhook Secret</Lbl>
            <input value={co.inboundEmailSecret||""} onChange={e=>setCo(c=>({...c,inboundEmailSecret:e.target.value}))}
              placeholder="Generate a random string here"
              style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",fontFamily:"monospace"}}/>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:4}}>Add this to your email provider's webhook URL as <code style={{color:B.orange}}>?secret=...</code></div>
          </div>
          <div>
            <Lbl s={{marginBottom:3}}>Your Webhook URL</Lbl>
            <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 9px",fontSize:11,fontFamily:"monospace",color:B.orange,wordBreak:"break-all",lineHeight:1.5}}>
              {window.location.origin}/api/inbound-email{co.inboundEmailSecret?`?secret=${co.inboundEmailSecret}`:""}
            </div>
          </div>
        </div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.7,marginBottom:11}}>
          <strong style={{color:B.text}}>Setup (SendGrid Inbound Parse):</strong>{" "}
          1. Set MX record for a subdomain (e.g. <code>mail.st1sports.com</code>) → <code>mx.sendgrid.net</code> priority 10{"  "}
          2. In SendGrid → Settings → Inbound Parse → add your subdomain + this webhook URL{"  "}
          3. BCC <code>quotes@mail.st1sports.com</code> on any pricing email{"  "}
          4. Click <strong>Sync Quotes</strong> in the Deals tab to pull them in
        </div>
        <OBtn onClick={save}>SAVE SETTINGS</OBtn>
      </div>

      {/* Email & Social connection status */}
      {(()=>{
        const [gmailInfo,setGmailInfo]=useState(null); // {email} or {error}
        const [gmailChecking,setGmailChecking]=useState(false);
        const [publerInfo,setPublerInfo]=useState(null);
        const [publerChecking,setPublerChecking]=useState(false);
        const [publerPosts,setPublerPosts]=useState(null);
        const [publerPostsLoading,setPublerPostsLoading]=useState(false);
        const [publerDebug,setPublerDebug]=useState(null);
        const [publerDebugging,setPublerDebugging]=useState(false);
        const [publerAccounts,setPublerAccounts]=useState(null);
        const [publerSendDebug,setPublerSendDebug]=useState(null);
        const [publerSendDebugging,setPublerSendDebugging]=useState(false);

        const checkGmail=async()=>{
          setGmailChecking(true);setGmailInfo(null);
          try{
            const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"profile"})}).then(r=>r.json());
            setGmailInfo(d.error?{error:d.error}:{email:d.email});
          }catch(e){setGmailInfo({error:e.message});}
          setGmailChecking(false);
        };
        const checkPubler=async()=>{
          setPublerChecking(true);setPublerInfo(null);
          try{
            const d=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"test"})}).then(r=>r.json());
            setPublerInfo(d.ok?{name:d.user?.name}:{error:d.error||"Connection failed"});
          }catch(e){setPublerInfo({error:e.message});}
          setPublerChecking(false);
        };
        const loadPublerPosts=async()=>{
          setPublerPostsLoading(true);setPublerPosts(null);
          try{
            const d=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list-posts"})}).then(r=>r.json());
            setPublerPosts(d);
          }catch(e){setPublerPosts({error:e.message});}
          setPublerPostsLoading(false);
        };
        const debugPublerPost=async()=>{
          setPublerDebugging(true);setPublerDebug(null);
          try{
            const d=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"debug-post",platform:"instagram"})}).then(r=>r.json());
            setPublerDebug(d);
          }catch(e){setPublerDebug({error:e.message});}
          setPublerDebugging(false);
        };
        const loadPublerAccounts=async()=>{
          try{
            const d=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"profiles"})}).then(r=>r.json());
            setPublerAccounts(d);
          }catch(e){setPublerAccounts({error:e.message});}
        };
        const testSendToPubler=async()=>{
          setPublerSendDebugging(true);setPublerSendDebug(null);
          const n=new Date(Date.now()+5*60*1000);
          const pad=v=>String(v).padStart(2,"0");
          const tzOff=new Date().getTimezoneOffset();
          const tzSign=tzOff<=0?"+":"-";
          const tzH=pad(Math.floor(Math.abs(tzOff)/60));
          const tzM=pad(Math.abs(tzOff)%60);
          const scheduleDate=`${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}:00${tzSign}${tzH}:${tzM}`;
          // Get first connected platform from accounts, fallback to instagram
          const platforms=(publerAccounts?.profiles||[]).map(a=>a.service).filter(Boolean);
          const testPlatforms=platforms.length?[platforms[0]]:["instagram"];
          try{
            const d=await fetch("/api/social-post",{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"send-verbose",post:"ST1 RevOps test post — please delete",platforms:testPlatforms,scheduleDate})}).then(r=>r.json());
            setPublerSendDebug(d);
          }catch(e){setPublerSendDebug({error:e.message});}
          setPublerSendDebugging(false);
        };

        useEffect(()=>{checkGmail();checkPubler();},[]);

        const failedPosts=(s.socialPosts||[]).filter(p=>p.status==="local_only");

        return(
          <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.green}`}}>
            <Lbl c={B.green} s={{marginBottom:12}}>Email & Social Status</Lbl>

            {/* Gmail */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5}}>GMAIL (outbound email)</div>
                <div style={{display:"flex",gap:5}}>
                  <button onClick={checkGmail} disabled={gmailChecking} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>{gmailChecking?"Checking…":"↻ Test"}</button>
                  <button onClick={async()=>{
                    const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",to_email:s.company?.email||"test@example.com",to_name:"ST1 Test",subject:"ST1 RevOps — Gmail test",body:"If you receive this, Gmail sending is working correctly."})}).then(r=>r.json());
                    if(d.sent) toast("Test email sent — check your inbox","success");
                    else toast("Send failed: "+(d.error||JSON.stringify(d)),"error");
                  }} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>✉ Send Test</button>
                </div>
              </div>
              {gmailInfo&&(
                gmailInfo.error
                  ?<div style={{background:`${B.red}08`,border:`1px solid ${B.red}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
                    ✕ Not connected — {gmailInfo.error}
                    <div style={{marginTop:4,fontSize:10,color:B.muted}}>Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Vercel env vars. Visit <strong>/api/gmail-setup</strong> to generate tokens.</div>
                  </div>
                  :<div style={{background:`${B.green}08`,border:`1px solid ${B.green}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>
                    ✓ Connected as <strong>{gmailInfo.email}</strong>
                    <div style={{marginTop:4,fontSize:10,color:B.muted}}>All campaign emails send FROM this account. Rep name &amp; email appear in the signature — replies go back to this inbox.</div>
                  </div>
              )}
              {!gmailInfo&&!gmailChecking&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Click Test to check connection.</div>}
            </div>

            {/* Publer */}
            <div style={{marginBottom:failedPosts.length>0?14:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5}}>PUBLER (social media posting)</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={loadPublerAccounts} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>👤 Accounts</button>
                  <button onClick={loadPublerPosts} disabled={publerPostsLoading} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>{publerPostsLoading?"Loading…":"🔍 Queue"}</button>
                  <button onClick={checkPubler} disabled={publerChecking} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>{publerChecking?"Checking…":"↻ Test"}</button>
                  <button onClick={testSendToPubler} disabled={publerSendDebugging} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{publerSendDebugging?"Sending…":"✉ Test Send"}</button>
                </div>
              </div>
              {publerInfo&&(
                publerInfo.error
                  ?<div style={{background:`${B.red}08`,border:`1px solid ${B.red}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
                    ✕ Not connected — {publerInfo.error}
                    <div style={{marginTop:4,fontSize:10,color:B.muted}}>Set PUBLER_API_KEY and PUBLER_WORKSPACE_ID in Vercel env vars. Get them from app.publer.com → Settings → API.</div>
                  </div>
                  :<div style={{background:`${B.green}08`,border:`1px solid ${B.green}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>
                    ✓ Connected — {publerInfo.name}
                  </div>
              )}
              {!publerInfo&&!publerChecking&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Click Test to check connection.</div>}
              {publerAccounts&&(
                <div style={{marginTop:8,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"10px 12px"}}>
                  {publerAccounts.error
                    ?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>Error: {publerAccounts.error}</div>
                    :<>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:6}}>CONNECTED ACCOUNTS — copy IDs to Vercel env vars</div>
                      {(publerAccounts.profiles||[]).map((a,i)=>(
                        <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"3px 0",borderBottom:`1px solid ${B.border}`,display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,minWidth:60}}>{a.service?.toUpperCase()||"?"}</span>
                          <span style={{flex:1}}>{a.name}</span>
                          <span style={{fontFamily:"monospace",fontSize:9,color:B.orange,background:`${B.orange}10`,padding:"1px 6px",borderRadius:3,userSelect:"all"}}>{a.id}</span>
                          <span style={{fontSize:9,color:a.connected?B.green:B.red}}>{a.connected?"✓":"⚠ reconnect"}</span>
                        </div>
                      ))}
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:6}}>In Vercel → Settings → Environment Variables, add: PUBLER_ACCOUNT_INSTAGRAM, PUBLER_ACCOUNT_FACEBOOK, etc. with the IDs shown above.</div>
                    </>
                  }
                </div>
              )}
              {false&&publerDebug&&null}
              {publerSendDebug&&(
                <div style={{marginTop:8,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"10px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,letterSpacing:.5}}>✉ TEST SEND RESULT</span>
                    <button onClick={()=>setPublerSendDebug(null)} style={{background:"none",border:"none",cursor:"pointer",color:B.muted,fontSize:10}}>✕</button>
                  </div>
                  {publerSendDebug.error&&<div style={{color:B.red,marginBottom:4}}><b>Error:</b> {publerSendDebug.error}</div>}
                  <div style={{marginBottom:6}}><b>Verdict:</b> <span style={{color:(publerSendDebug.verdict||"").startsWith("SUCCESS")?B.green:B.red,fontWeight:700}}>{publerSendDebug.verdict||"?"}</span></div>
                  <div style={{marginBottom:3}}><b>Workspace:</b> {publerSendDebug.workspaceId}</div>
                  <div style={{marginBottom:3}}><b>Env account ID:</b> {publerSendDebug.envAccountId||"not set"}</div>
                  <div style={{marginBottom:3}}><b>Live /accounts ID:</b> {publerSendDebug.liveAccountId||"none"}</div>
                  <div style={{marginBottom:3}}><b>Live /profiles ID:</b> {publerSendDebug.profileId||"none"}</div>
                  <div style={{marginBottom:3}}><b>All live accounts:</b> <code style={{fontSize:8}}>{JSON.stringify(publerSendDebug.accountLookup)}</code></div>
                  {(publerSendDebug.attempts||[]).map((a,i)=>(
                    <div key={i} style={{marginBottom:3,padding:"3px 6px",background:a.ok||a.status===200||a.status===201?`${B.green}10`:`${B.red}08`,borderRadius:3,border:`1px solid ${a.ok||a.status===200||a.status===201?B.green:B.red}20`}}>
                      <b style={{color:a.ok||a.status===200||a.status===201?B.green:B.red}}>{a.label}</b> → HTTP {a.status} | {JSON.stringify(a.response).slice(0,120)}
                    </div>
                  ))}
                  {publerSendDebug.jobId&&<div style={{marginBottom:4}}><b>Job ID:</b> <code style={{fontSize:9}}>{publerSendDebug.jobId}</code></div>}
                  {publerSendDebug.jobStatus&&<div style={{marginBottom:4,padding:"4px 6px",background:`${B.blue}08`,border:`1px solid ${B.blue}20`,borderRadius:3}}><b>Job status:</b> <code style={{fontSize:8,wordBreak:"break-all"}}>{JSON.stringify(publerSendDebug.jobStatus)}</code></div>}
                  {publerSendDebug.postCounts&&(
                    <div style={{marginTop:4}}>
                      <b>Publer posts after:</b>
                      {Object.entries(publerSendDebug.postCounts).map(([state,posts])=>(
                        <div key={state} style={{marginLeft:8,marginTop:2}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted}}>{state.toUpperCase()} ({Array.isArray(posts)?posts.length:"err"}):</span>
                          {Array.isArray(posts)&&posts.map(sp=><div key={sp.id} style={{marginLeft:8,fontSize:9}}>[{sp.id}] "{sp.text||"(empty)"}"</div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {publerPosts&&(
                <div style={{marginTop:8,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"10px 12px"}}>
                  {publerPosts.error
                    ?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>Error: {publerPosts.error}</div>
                    :<>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:.5,marginBottom:6}}>
                        PUBLER QUEUE — {publerPosts.scheduled?.count||publerPosts.count||0} SCHEDULED
                        {(publerPosts.failed?.count||0)>0&&<span style={{color:B.red,marginLeft:8}}>{publerPosts.failed.count} FAILED</span>}
                        {(publerPosts.draft?.count||0)>0&&<span style={{color:B.orange,marginLeft:8}}>{publerPosts.draft.count} DRAFT</span>}
                        <span style={{marginLeft:8,opacity:.6}}>(workspace: {publerPosts.workspaceId})</span>
                      </div>
                      {(publerPosts.count===0&&(publerPosts.failed?.count||0)===0)
                        ?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No posts found. Check PUBLER_WORKSPACE_ID in Vercel matches what you see in Publer's dashboard URL.</div>
                        :<>
                          {(publerPosts.posts||[]).map((p,i)=>{
                            const accts=(p.accounts||[]);
                            const noAcct=accts.length===0;
                            return(
                              <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>
                                <span style={{color:B.muted,marginRight:8}}>{p.scheduled_at?.slice(0,16)?.replace("T"," ")}</span>
                                {noAcct
                                  ?<span style={{color:B.red,marginRight:6,fontWeight:600}}>⚠ NO ACCOUNT</span>
                                  :<span style={{color:"#4ade80",marginRight:6}}>{accts.map(a=>a.name||a.id).join(", ")}</span>
                                }
                                <span style={{color:B.muted}}>({(p.networks||[]).join("/")})</span>
                                {" — "}{p.text}
                              </div>
                            );
                          })}
                          {(publerPosts.failed?.posts||[]).length>0&&(
                            <div style={{marginTop:8}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,letterSpacing:.5,marginBottom:4}}>FAILED POSTS</div>
                              {publerPosts.failed.posts.map((p,i)=>(
                                <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>
                                  <span style={{color:B.muted,marginRight:8}}>{p.scheduled_at?.slice(0,16)?.replace("T"," ")}</span>
                                  <span style={{color:B.red,marginRight:6}}>{p.error||"failed"}</span>
                                  {" — "}{p.text}
                                </div>
                              ))}
                            </div>
                          )}
                          {publerPosts._rawSample&&(
                            <div style={{marginTop:8,padding:"6px 8px",background:B.bg,borderRadius:3,fontFamily:"monospace",fontSize:9,color:B.muted,wordBreak:"break-all",whiteSpace:"pre-wrap"}}>
                              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:.5,marginBottom:4}}>RAW PUBLER POST SAMPLE (first result):</div>
                              {JSON.stringify(publerPosts._rawSample,null,2).slice(0,800)}
                            </div>
                          )}
                        </>
                      }
                    </>
                  }
                </div>
              )}
            </div>

            {/* Failed posts */}
            {failedPosts.length>0&&(
              <div style={{background:`${B.red}06`,border:`1px solid ${B.red}20`,borderRadius:5,padding:"10px 12px"}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,letterSpacing:.5,marginBottom:6}}>{failedPosts.length} POST{failedPosts.length!==1?"S":""} FAILED TO REACH PUBLER</div>
                {failedPosts.map(p=>(
                  <div key={p.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                    <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.caption?.slice(0,60)}…</span>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,flexShrink:0}}>{p.date}</span>
                  </div>
                ))}
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:6}}>Go to Social → All Posts to retry each one.</div>
              </div>
            )}
          </div>
        );
      })()}
      {/* Sales Reps */}
      <div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.blue}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <Lbl c={B.blue}>Sales Reps</Lbl>
          <button onClick={()=>setRepForm({name:"",email:"",title:"",phone:""})} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>+ ADD REP</button>
        </div>
        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,lineHeight:1.5}}>
          Reps can be assigned to campaigns. Their name and contact info will appear in outbound emails as the sender, and replies/leads will count toward their pipeline.
        </div>
        {repForm&&(
          <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:14,marginBottom:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:10}}>
              {[["Name","name","text"],["Email","email","email"],["Title","title","text"],["Phone","phone","text"]].map(([l,k,t])=>(
                <div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl>
                  <input type={t} value={repForm[k]||""} onChange={e=>setRepForm(f=>({...f,[k]:e.target.value}))}
                    style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
                </div>
              ))}
              <div style={{gridColumn:"1/-1"}}>
                <Lbl s={{marginBottom:3}}>Gmail Key <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,color:B.muted}}>(optional — e.g. JOSH)</span></Lbl>
                <div style={{display:"flex",gap:7,alignItems:"center"}}>
                  <input type="text" value={repForm.gmailEnvKey||""} onChange={e=>setRepForm(f=>({...f,gmailEnvKey:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"")}))}
                    placeholder="e.g. JOSH" maxLength={20}
                    style={{width:120,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",letterSpacing:1}}/>
                  {repForm.gmailEnvKey&&<a href={`/api/gmail-setup?repKey=${repForm.gmailEnvKey}`} target="_blank" rel="noreferrer"
                    style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,textDecoration:"underline"}}>Set up Gmail for {repForm.gmailEnvKey} →</a>}
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>→ set <code>GMAIL_REFRESH_TOKEN_{repForm.gmailEnvKey||"KEY"}</code> in Vercel</span>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:7}}>
              <OBtn sm onClick={saveRep}>SAVE</OBtn>
              <GBtn sm onClick={()=>setRepForm(null)}>CANCEL</GBtn>
            </div>
          </div>
        )}
        {(s.reps||[]).length===0&&!repForm&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"8px 0"}}>No reps added yet — add your sales team to assign campaigns.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {(s.reps||[]).map(rep=>{
            const hasAccess = (s.appUsers||[]).some(u=>u.repId===rep.id);
            const hasOwnGmail = !!rep.gmailEnvKey;
            return(
            <div key={rep.id} style={{border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:B.white}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:B.blue,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white}}>{(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
                </div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{rep.name}</span>
                    {hasAccess&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:`${B.green}15`,padding:"1px 5px",borderRadius:3,letterSpacing:.5}}>HAS ACCESS</span>}
                    {hasOwnGmail
                      ? <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:3,letterSpacing:.5}}>✉ OWN GMAIL ({rep.gmailEnvKey})</span>
                      : <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,background:B.surface,padding:"1px 5px",borderRadius:3,letterSpacing:.5}}>✉ SHARED GMAIL</span>
                    }
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{rep.email}{rep.title?` · ${rep.title}`:""}{rep.phone?` · ${rep.phone}`:""}</div>
                </div>
                <div style={{display:"flex",gap:5}}>
                  <button onClick={()=>testRepEmail(rep)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.blue,cursor:"pointer"}} title={hasOwnGmail?`Send test from ${rep.gmailEnvKey}'s Gmail`:"Send test from shared Gmail"}>✉ TEST</button>
                  <button onClick={()=>{if(pinForm===rep.id){setPinForm(null);setPinVal("");}else{setPinForm(rep.id);setPinVal("");}}} style={{background:hasAccess?`${B.green}15`:"none",border:`1px solid ${hasAccess?B.green:B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:hasAccess?B.green:B.muted,cursor:"pointer"}} title={hasAccess?"Change or revoke PIN":"Set login PIN for this rep"}>{hasAccess?"🔑 CHANGE PIN":"🔑 SET PIN"}</button>
                  <button onClick={()=>setRepForm({...rep})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>EDIT</button>
                  <button onClick={()=>{if(window.confirm(`Remove ${rep.name}?`))dispatch("DEL_REP",rep.id);}} style={{background:B.redBg,border:`1px solid ${B.red}30`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.red,cursor:"pointer"}}>DEL</button>
                </div>
              </div>
              {pinForm===rep.id&&(
                <div style={{background:B.surface,borderTop:`1px solid ${B.border}`,padding:"10px 12px",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,whiteSpace:"nowrap"}}>SET 4-DIGIT PIN</div>
                  <input type="password" value={pinVal} onChange={e=>setPinVal(e.target.value.replace(/\D/g,"").slice(0,4))} onKeyDown={e=>e.key==="Enter"&&savePin()} placeholder="••••" maxLength={4}
                    style={{width:80,background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:14,letterSpacing:6,textAlign:"center",fontFamily:"'Lexend',sans-serif"}}/>
                  <button onClick={savePin} disabled={pinVal.length!==4} style={{background:pinVal.length===4?B.orange:B.border,color:pinVal.length===4?B.white:B.muted,border:"none",borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:pinVal.length===4?"pointer":"not-allowed"}}>SAVE</button>
                  {hasAccess&&<button onClick={()=>revokeAccess(rep)} style={{background:B.redBg,border:`1px solid ${B.red}30`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.red,cursor:"pointer"}}>REVOKE ACCESS</button>}
                  <button onClick={()=>{setPinForm(null);setPinVal("");}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>CANCEL</button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* BRAND ASSETS */}
      <div id="brand-assets-section" className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <Lbl c={B.orange}>BRAND ASSETS</Lbl>
        </div>
        {/* Asset Grid */}
        {(s.brandAssets||[]).length>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:14}}>
            {(s.brandAssets||[]).map(a=>{
              const isImg=a.url&&(a.url.startsWith("data:image")||/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.url)||a.type==="logo"||a.type==="product-photo"||a.type==="banner");
              return(
                <div key={a.id} style={{border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden",background:B.surface}}>
                  {isImg?(
                    <img src={a.url} alt={a.name} style={{width:"100%",height:70,objectFit:"contain",display:"block",background:"#f5f5f5",padding:4}}/>
                  ):(
                    <div style={{width:"100%",height:70,display:"flex",alignItems:"center",justifyContent:"center",background:"#f5f5f5",fontSize:24}}>📄</div>
                  )}
                  <div style={{padding:"6px 8px"}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>{a.name}</div>
                    {a.type&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:3}}>{a.type}</span>}
                    <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                      <button onClick={()=>navigator.clipboard?.writeText(a.url).then(()=>toast("URL copied!","success")).catch(()=>toast("Copy failed","error"))} style={{background:B.blueBg,color:B.blue,border:"none",borderRadius:3,padding:"3px 6px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>COPY URL</button>
                      <button onClick={()=>{dispatch("SET_MOD","social");}} style={{background:B.purpleBg,color:B.purple,border:"none",borderRadius:3,padding:"3px 6px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>USE IN POST →</button>
                      <button onClick={()=>{if(window.confirm(`Delete "${a.name}"?`))dispatch("DELETE_BRAND_ASSET",a.id);}} style={{background:"none",border:"none",color:B.red,fontSize:10,cursor:"pointer",padding:"2px 3px",marginLeft:"auto"}}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(s.brandAssets||[]).length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"8px 0 12px",textAlign:"center"}}>No brand assets yet — add logos, product photos, and banners below</div>}
        {/* ADD ASSET form */}
        <BrandAssetAddForm dispatch={dispatch} toast={toast} s={s}/>
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