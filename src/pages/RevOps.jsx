import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext, Component, lazy, Suspense } from "react";
import * as bgTasks from "../lib/bgTasks.js";
import { mergeById, APP_STATE_KEY } from "../lib/appStateSync.js";
const CmdCenter      = lazy(() => import('./CommandCenter.jsx'))
const ExpansionPage  = lazy(() => import('./Expansion.jsx'))
const RedditPage     = lazy(() => import('./Reddit.jsx'))
const IntegrationsPage = lazy(() => import('./Integrations.jsx'))
const TeamStoresPage = lazy(() => import('./TeamStores.jsx'))
const FlagshipStorePage = lazy(() => import('./FlagshipStore.jsx'))
function usePrefetchPanels() {
useEffect(() => {
import('./CommandCenter.jsx');
}, []);
}
function PanelLoader() {
return (
<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:48,flexDirection:"column",gap:12}}>
<div style={{width:28,height:28,background:"#F37321",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:"#fff",letterSpacing:-1}}>ST1</span>
</div>
<div style={{width:32,height:3,background:"#F37321",borderRadius:2,animation:"grow 1s ease-in-out infinite alternate"}}/>
</div>
)
}
class ErrBound extends Component {
constructor(p){super(p);this.state={err:null};}
static getDerivedStateFromError(e){return{err:e};}
componentDidCatch(err){
if(err?.message?.includes("Failed to fetch dynamically imported module")){
window.location.reload();
}
}
render(){
if(this.state.err){
const isChunkErr = this.state.err?.message?.includes("Failed to fetch dynamically imported module");
if(isChunkErr) return(
<div style={{padding:32,fontFamily:"'Lexend',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:14,marginTop:40}}>
<div style={{fontSize:13,color:"#424242",fontWeight:500}}>New version deployed — reloading…</div>
<div style={{width:32,height:3,background:"#F37321",borderRadius:2,animation:"grow 1s ease-in-out infinite alternate"}}/>
</div>
);
return(
<div style={{padding:32,fontFamily:"monospace",background:"#fff8f8",border:"1px solid #f99",borderRadius:8,margin:24}}>
<div style={{fontWeight:700,color:"#c00",marginBottom:8}}>Render error — please report this message:</div>
<pre style={{fontSize:12,color:"#333",whiteSpace:"pre-wrap"}}>{this.state.err?.message}</pre>
<pre style={{fontSize:10,color:"#999",marginTop:8,whiteSpace:"pre-wrap"}}>{this.state.err?.stack?.split("\n").slice(0,6).join("\n")}</pre>
<button onClick={()=>this.setState({err:null})} style={{marginTop:12,padding:"6px 14px",background:"#f37321",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>Retry</button>
</div>
);
}
return this.props.children;
}
}
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
const STORE = APP_STATE_KEY;
const mkId   = () => Math.random().toString(36).slice(2,9);
// Zoho lookup fields (Account_Name, Contact_Name, Title, etc.) come back as
// {name, id} objects. Older sync code stored those raw; this coerces any
// leftover object values in persisted state back to plain strings so a
// stale record can't crash rendering downstream.
const zstr = v => typeof v==="string" ? v : (v?.name || v?.display_value || "");
const sanitizeLookupFields = (arr, fields) => Array.isArray(arr) ? arr.map(o => {
  let changed = false;
  const patch = {};
  for (const f of fields) { if (o && typeof o[f] === "object" && o[f] !== null) { patch[f] = zstr(o[f]); changed = true; } }
  return changed ? {...o, ...patch} : o;
}) : arr;
const today  = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmtCountdown=(ms)=>{if(ms<=0)return"now";const s=Math.floor(ms/1000);const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;};
const fmtSchedDt=(dt)=>dt?fmtMT(new Date(dt).getTime()):"";;
const dtLocalStr=(dt)=>{const d=new Date(dt);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;};
const addBusinessDays=(startMs,days)=>{const dt=new Date(startMs);let added=0;while(added<days){dt.setDate(dt.getDate()+1);const wd=dt.getDay();if(wd!==0&&wd!==6)added++;}return dt.getTime();};
const getMTComp=(ms)=>{const p={};new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(ms)).forEach(x=>{if(x.type!=='literal')p[x.type]=x.value;});return{h:parseInt(p.hour)%24,wd:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),y:parseInt(p.year),mo:parseInt(p.month)-1,d:parseInt(p.day),min:parseInt(p.minute)};};
const nextMTBizStart=(ms)=>{for(let i=0;i<=7;i++){const probe=ms+i*86400000;const{y,mo,d}=getMTComp(probe);for(const off of[6,7]){const c=Date.UTC(y,mo,d,9+off,0,0);const ck=getMTComp(c);if(ck.h!==9||c<=ms)continue;if(ck.wd>=1&&ck.wd<=5)return c;}}return ms+86400000;};
const fmtMT=(ms)=>{if(!ms)return'';const{h,min,wd,mo,d,y}=getMTComp(ms);const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return`${days[wd]} ${months[mo]} ${d}, ${h%12||12}:${String(min).padStart(2,'0')}${h>=12?'pm':'am'} MT`;};
const parseMTLocalStr=(localStr)=>{const[dp,tp]=localStr.split('T');const[yr,mo,da]=dp.split('-').map(Number);const[hr,mi]=(tp||'09:00').split(':').map(Number);for(const off of[6,7]){const c=Date.UTC(yr,mo-1,da,hr+off,mi,0);if(getMTComp(c).h===hr)return c;}return Date.UTC(yr,mo-1,da,hr+6,mi,0);};
const nowPlusMin = n => { const d=new Date(Date.now()+n*60000); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const dAgo   = (d) => Math.floor((Date.now()-new Date(d))/86400000);
const dUntil = (d) => Math.ceil((new Date(d)-Date.now())/86400000);
const fmt$   = (n) => "$"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt$K  = (n) => { if(n>=1000) return "$"+(n/1000).toFixed(1)+"K"; return "$"+Math.round(n||0).toLocaleString(); };
const fmtD   = (d) => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const fmtPct = (v) => v==null?"—":(Number(v)*100).toFixed(1)+"%";
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
edgarDraft: "",
lastBriefDate: null,
pendingBriefActions: [],
contactsLastSync: null,
alerts: [],
orders: [],
templates: [],
reps: [],
activity: [],
integrations: {zohoToken:"",zohoCrmToken:"",zohoOrgId:"",slackChannel:"C0AQ7CMB01X"},
company: {name:"ST1 Sports",ownerName:"Matt Stone",email:"matt@st1sports.com",phone:"719-256-0275",address:"Ames, Iowa",website:"st1sports.com"},
brandAssets: [],
savedAds: [],
socialPosts: [],
campaigns: [],
priceLists: [],
contactLists: [],
appUsers: [],
invoiceLastSync: null,
crmNav: null,
prospectingNav: null,
};
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);
function mergeServerState(base, server) {
if (!server || typeof server !== "object") return base;
return {
...base,
...server,
currentUserId: base.currentUserId,
integrations: {...(base.integrations||{}), ...(typeof server.integrations==="object"&&server.integrations?server.integrations:{})},
company:      {...(base.company||{}),      ...(typeof server.company==="object"     &&server.company     ?server.company     :{})},
agentHistory: Array.isArray(server.agentHistory) ? server.agentHistory.slice(-40) : (base.agentHistory||[]),
campaigns:    mergeById(base.campaigns,    server.campaigns),
contacts:     mergeById(base.contacts,     server.contacts),
contactLists: mergeById(base.contactLists, server.contactLists),
deals:        mergeById(base.deals,        server.deals),
rfps:         mergeById(base.rfps,         server.rfps),
invoices:     mergeById(base.invoices,     server.invoices),
reorders:     mergeById(base.reorders,     server.reorders),
brandAssets:  mergeById(base.brandAssets,  server.brandAssets),
socialPosts:  mergeById(base.socialPosts,  server.socialPosts),
savedAds:     mergeById(base.savedAds,     server.savedAds),
templates:    mergeById(base.templates,    server.templates),
reps:         mergeById(base.reps,         server.reps),
orders:       mergeById(base.orders,       server.orders),
alerts:       mergeById(base.alerts,       server.alerts),
activity:     mergeById(base.activity,     server.activity),
priceLists:   mergeById(base.priceLists,   server.priceLists),
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
deals:        sanitizeLookupFields(Array.isArray(p.deals) ? p.deals : [], ["school","contact"]),
invoices:     Array.isArray(p.invoices)     ? p.invoices     : [],
rfps:         Array.isArray(p.rfps)         ? p.rfps         : [],
reorders:     sanitizeLookupFields(Array.isArray(p.reorders) ? p.reorders : [], ["school","contact"]),
contacts:     sanitizeLookupFields(Array.isArray(p.contacts) ? p.contacts : [], ["school","title"]),
sequences:    Array.isArray(p.sequences)    ? p.sequences    : [],
prospectAreas:Array.isArray(p.prospectAreas)? p.prospectAreas: [],
agentHistory: Array.isArray(p.agentHistory) ? p.agentHistory.slice(-40) : [],
competeIntel: p.competeIntel && typeof p.competeIntel==="object" ? p.competeIntel : {},
battlecards:  p.battlecards  && typeof p.battlecards ==="object" ? p.battlecards  : {},
orders:       sanitizeLookupFields(Array.isArray(p.orders) ? p.orders : [], ["school","contact"]),
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
invoiceLastSync: p.invoiceLastSync||null,
contactsLastSync: p.contactsLastSync||null,
lastBriefDate: p.lastBriefDate||null,
pendingBriefActions: Array.isArray(p.pendingBriefActions)?p.pendingBriefActions:[],
appUsers:     Array.isArray(p.appUsers)     ? p.appUsers     : [],
contactLists: Array.isArray(p.contactLists) ? p.contactLists : [],
priceLists:   Array.isArray(p.priceLists)   ? p.priceLists   : [],
};
}
} catch {}
return SEED;
});
const [lastSynced, setLastSynced] = useState(null);
const [syncing, setSyncing] = useState(false);
const pullFromServer = useCallback(() => {
setSyncing(true);
return fetch("/api/state")
.then(r => r.json())
.then(d => {
if (d.state && typeof d.state === "object") {
const {contacts: _sc, agentHistory: _sah, ...serverClean} = d.state;
setRaw(prev => {
const merged = mergeServerState(prev, serverClean);
setTimeout(() => {
try { localStorage.setItem(STORE, JSON.stringify(merged)); } catch {}
}, 0);
const {currentUserId: _cid, contacts: _c, agentHistory: _ah, ...toSync} = merged;
fetch("/api/state", {method:"POST", headers:{"Content-Type":"application/json"},
body: JSON.stringify({state: toSync})}).catch(()=>{});
return merged;
});
} else {
setRaw(prev => {
const {currentUserId: _cid, contacts: _c, agentHistory: _ah, ...toSync} = prev;
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
useEffect(() => { pullFromServer(); }, []);
useEffect(() => {
pollTimer.current = setInterval(pullFromServer, 120000);
return () => clearInterval(pollTimer.current);
}, [pullFromServer]);
const set = useCallback((fn) => {
setRaw(prev => {
const next = typeof fn === "function" ? fn(prev) : {...prev,...fn};
if (saveTimer.current) clearTimeout(saveTimer.current);
saveTimer.current = setTimeout(() => {
const doSave = () => { try { localStorage.setItem(STORE, JSON.stringify(next)); } catch {} };
if (typeof requestIdleCallback !== "undefined") requestIdleCallback(doSave, {timeout:2000});
else doSave();
}, 300);
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
const crmCreate=(module,data)=>fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/${module}`,method:"POST",body:{data:[data]}})}).catch(()=>{});
const crmUpdate=(module,zohoId,fields)=>zohoId?fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/${module}/${zohoId}`,method:"PUT",body:{data:[{id:zohoId,...fields}]}})}).catch(()=>{}):null;
const crmAddNote=(module,zohoId,content)=>zohoId?fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:"/Notes",method:"POST",body:{data:[{Note_Title:"RevOps Note",Note_Content:content,Parent_Id:{id:zohoId},se_module:module}]}})}).catch(()=>{}):null;
const pushDealToZoho=(fields)=>fetch("/api/crm/deal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fields)}).then(r=>r.json()).catch(()=>({}));
// Fires exactly once, on the transition into Closed Won — auto-drafts (not sends) an
// invoice with the ledger agent so it's waiting for review in Finance the moment a deal closes.
const autoInvoiceOnClosedWon=(deal,prevStage,newStage,toast)=>{
if(newStage!=="Closed Won"||prevStage==="Closed Won")return;
fetch("/api/agents/ledger/invoice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
action:"draft",dryRun:false,
crmDealId:deal.zohoId||undefined,
crmDealName:deal.name,
crmAccountName:deal.school,
dealAmount:deal.value,
})}).then(r=>r.json()).then(d=>{
if(d?.zohoInvoiceId||d?.invoiceNumber) toast?.(`Invoice ${d.invoiceNumber||d.zohoInvoiceId} drafted for ${deal.name} — review in Finance`,"info");
}).catch(()=>{});
};
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
// Canonical sports list — used by the CRM contact-profile dropdown and by
// account coverage/gap detection. Deliberately not the shorter SPORTS_LIST
// used by the segment builder — coverage gaps should consider anything a
// school could plausibly run, not just the sports Prospecting actively
// targets. ACCOUNT_SPORTS drops the two catch-all entries, which aren't
// real "sports" a coverage gap could ever be filled for.
const COMMON_SPORTS=["Football","Basketball","Baseball","Softball","Soccer","Volleyball","Track & Field","Cross Country","Wrestling","Swimming & Diving","Tennis","Golf","Hockey","Lacrosse","Gymnastics","Cheerleading","Dance","Bowling","Badminton","Water Polo","Rowing / Crew","Multiple Sports","All Sports / General"];
const ACCOUNT_SPORTS=COMMON_SPORTS.filter(sp=>!["Multiple Sports","All Sports / General"].includes(sp));
const SPORT_TITLE_PATTERNS=[
[/track|cross.?country|\bxc\b|t&f/i,"Track & Field"],
[/football/i,"Football"],[/basketball/i,"Basketball"],[/baseball/i,"Baseball"],
[/softball/i,"Softball"],[/soccer/i,"Soccer"],[/volleyball/i,"Volleyball"],
[/wrestling/i,"Wrestling"],[/swim|diving/i,"Swimming & Diving"],[/tennis/i,"Tennis"],
[/golf/i,"Golf"],[/hockey/i,"Hockey"],[/lacrosse/i,"Lacrosse"],[/gymnastics/i,"Gymnastics"],
[/cheer/i,"Cheerleading"],[/dance/i,"Dance"],[/bowling/i,"Bowling"],[/badminton/i,"Badminton"],
[/water polo/i,"Water Polo"],[/rowing|crew/i,"Rowing / Crew"],
];
function inferSportFromTitle(title) {
const t=title||"";
for(const [re,sport] of SPORT_TITLE_PATTERNS){ if(re.test(t)) return sport; }
return null;
}
// Given all contacts at one account, work out who the AD is (if known) and
// which sports have a coach on file vs. which are gaps — this is the data
// that should get filled in once positive intent shows up at that school.
function computeAccountCoverage(schoolContacts) {
const adContact=schoolContacts.find(c=>/athletic director/i.test(c.title||""))||null;
const covered=new Map();
schoolContacts.forEach(c=>{
let sp=typeof c.sport==="string"?c.sport:c.sport?.name||"";
if(!sp||sp==="General"||!ACCOUNT_SPORTS.includes(sp)) sp=inferSportFromTitle(c.title)||"";
if(sp&&ACCOUNT_SPORTS.includes(sp)&&!covered.has(sp)) covered.set(sp,c);
});
const gaps=ACCOUNT_SPORTS.filter(sp=>!covered.has(sp));
return {adContact,covered,gaps};
}
// The "they replied" threshold from the SCORE_CONTACT point system
// (replied:50, meeting:75, deal:100) — shared by the CRM-tab cold-contact
// sweep and anything else that needs to ask "has this contact shown intent?"
const CONTACT_INTENT_SCORE=50;
// Texting is for 1:1 follow-up with people we already have a real relationship
// with — never cold prospects — so the Text tab only shows up once a contact
// is a real Zoho Contact, has shown reply intent, has a deal, or is invoiced.
function isWarmContact(c,cd,invoices) {
if(!c) return false;
if((c.id||"").startsWith("zoho_c_")) return true;
if((c.score||0)>=CONTACT_INTENT_SCORE) return true;
if(["replied","interested"].includes(c.outreachStatus)) return true;
if(cd?.cd?.length>0) return true;
if(findCustomerInvoice(c,invoices||[])) return true;
return false;
}
function scoreTier(score) {
const n=score||0;
if(n>=100) return {label:"🔥 FIRE",color:"#C0392B",bg:"#FDECEA"};
if(n>=60)  return {label:"HOT",    color:"#F37321",bg:"#FEF3EC"};
if(n>=25)  return {label:"WARM",   color:"#1A5FA8",bg:"#E8F0FA"};
return           {label:"COLD",   color:"#7A7872",bg:"#F8F7F5"};
}
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
case "SET_DEALS":         return {...prev, deals:payload};
case "ADD_CONTACTS":      return {...prev, contacts:[...payload,...(prev.contacts||[])]};
case "UPDATE_CONTACT":      return {...prev, contacts:(prev.contacts||[]).map(c=>c.id===payload.id?{...c,...payload}:c)};
case "SCORE_CONTACT": {
const {contactId,type,note,campaignId} = payload;
const pts=({enrolled:5,sent:15,opened:10,clicked:25,replied:50,meeting:75,deal:100})[type]||5;
const BOT_WIN=30*60*1000;
return {...prev,contacts:(prev.contacts||[]).map(c=>{
if(c.id!==contactId)return c;
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
case "DEL_COMPETE_INTEL":   {const next={...(prev.competeIntel||{})};delete next[payload];return {...prev,competeIntel:next};}
case "SET_BATTLECARD":      return {...prev, battlecards:{...(prev.battlecards||{}),...payload}};
case "SET_PROSPECT_AREAS":  return {...prev, prospectAreas:payload};
case "SET_CRM_NAV":         return {...prev, crmNav:payload};
case "SET_PROSPECTING_NAV": return {...prev, prospectingNav:payload};
case "SET_AGENT_HISTORY":   return {...prev, agentHistory:payload};
case "SET_AGENT_DRAFT":     return {...prev, agentDraft:payload};
case "SET_EDGAR_DRAFT":     return {...prev, edgarDraft:payload};
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
const {campId, touchIdx, touchDraft} = payload;
return {...prev, campaigns:(prev.campaigns||[]).map(c=>{
if(campId && c.id!==campId) return c;
if(!campId) return c;
const touches=(c.touches||[]).map((t,i)=>i===touchIdx?{...t,...touchDraft}:t);
return {...c,touches};
})};
}
case "DELETE_CAMPAIGN": return {...prev, campaigns:(prev.campaigns||[]).filter(c=>c.id!==payload)};
case "ADD_PRICE_LIST":  return {...prev, priceLists:(prev.priceLists||[]).some(pl=>pl.id===payload.id)?(prev.priceLists||[]).map(pl=>pl.id===payload.id?payload:pl):[payload,...(prev.priceLists||[])]};
case "UPDATE_PRICE_LIST": return {...prev, priceLists:(prev.priceLists||[]).map(pl=>pl.id===payload.id?{...pl,...payload}:pl)};
case "DEL_PRICE_LIST":  return {...prev, priceLists:(prev.priceLists||[]).filter(pl=>pl.id!==payload)};
case "UPDATE_PRICE_LIST_ITEM": {
const {listId, itemId, updates} = payload;
return {...prev, priceLists:(prev.priceLists||[]).map(pl=>pl.id!==listId?pl:{...pl,items:(pl.items||[]).map(it=>it.id===itemId?{...it,...updates}:it)})};
}
case "RESET":               return {...SEED, currentUserId:prev.currentUserId, integrations:prev.integrations, company:prev.company, brandAssets:prev.brandAssets||[], savedAds:prev.savedAds||[], appUsers:prev.appUsers||[], contactLists:prev.contactLists||[], campaigns:prev.campaigns||[], reps:prev.reps||[]};
default:                  return prev;
}
}
function GmailStatusBanner({repKey="",repEmail=""}) {
const [status,setStatus]=React.useState(null);
const check=React.useCallback(()=>{
setStatus(null);
fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({action:"profile",...(repKey?{repEnvKey:repKey}:{})})})
.then(r=>{
if(!r.ok) return r.json().then(d=>{throw new Error(d.error||`HTTP ${r.status}`);});
return r.json();
})
.then(d=>setStatus(d.email?{ok:true,email:d.email}:{ok:false,error:d.error||"unknown",type:"auth"}))
.catch(err=>{
const msg=err.message||"";
const type=msg==="Failed to fetch"?"network":
msg.includes("not configured")?"setup":
msg.includes("invalid_grant")||msg.includes("token")?"expired":"auth";
setStatus({ok:false,error:msg,type});
});
},[repKey]);
React.useEffect(()=>{check();},[check]);
if(!status) return(
<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#f8f8f6",border:"1px solid #e0e0d0",borderRadius:5,marginBottom:8,fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#888"}}>
<span style={{opacity:.6}}>⏳</span> Checking Gmail connection…
</div>
);
if(status.ok) return(
<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:5,marginBottom:8,fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#15803d"}}>
<span>✓</span> Gmail connected — sending as <strong style={{marginLeft:3}}>{status.email}</strong>
<button onClick={check} style={{marginLeft:"auto",background:"none",border:"1px solid #bbf7d0",borderRadius:3,padding:"1px 7px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:"#15803d",cursor:"pointer"}}>RECHECK</button>
</div>
);
const setupUrl=repKey?`/api/gmail-setup?repKey=${repKey}${repEmail?`&hint=${encodeURIComponent(repEmail)}`:""}`:"/api/gmail-setup";
const fixes={
network:<>The API server is unreachable. <strong>Try a hard refresh (Ctrl+Shift+R)</strong> — if the problem persists, check that your Vercel deployment is live and the function logs show no build errors.</>,
setup:<>Gmail not connected. <a href={setupUrl} target="_blank" style={{color:"#b91c1c",fontWeight:600,textDecoration:"none",border:"1px solid #b91c1c",borderRadius:3,padding:"1px 8px",marginLeft:4}}>Connect your Gmail →</a></>,
expired:<>Gmail authorization has expired for {repKey||"this account"}. <a href={setupUrl} target="_blank" style={{color:"#b91c1c",fontWeight:600}}>Re-authorize Gmail →</a></>,
auth:<>Gmail auth error: <code style={{fontSize:10}}>{status.error}</code>. <a href={setupUrl} target="_blank" style={{color:"#b91c1c",fontWeight:600}}>Re-authorize Gmail →</a></>,
};
return(
<div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:5,marginBottom:8}}>
<span style={{flexShrink:0,fontSize:15}}>⚠️</span>
<div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#b91c1c",lineHeight:1.6}}>
{fixes[status.type]||fixes.auth}
</div>
<button onClick={check} style={{flexShrink:0,background:"#b91c1c",color:"#fff",border:"none",borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>RETRY</button>
</div>
);
}
const mergeTags=(text,c)=>(text||"")
.replace(/\{\{firstName\}\}/gi,c?.firstName||(c?.fullName||"").split(" ")[0]||"there")
.replace(/\{\{orgName\}\}/gi,(typeof c?.school==="string"?c.school:c?.school?.name)||"your school")
.replace(/\{\{lastName\}\}/gi,c?.lastName||"")
.replace(/\{\{sport\}\}/gi,(typeof c?.sport==="string"?c.sport:c?.sport?.name)||"athletics");
const DEAL_STAGES = ["Quoted","Follow-Up 1","Follow-Up 2","Negotiating","PO Received","Closed Won","Closed Lost","On Hold"];
const DSC ={Quoted:B.blue,"Follow-Up 1":B.purple,"Follow-Up 2":B.orange,Negotiating:B.yellow,"PO Received":B.teal,"Closed Won":B.green,"Closed Lost":B.red,"On Hold":B.muted};
const DBG = {Quoted:B.blueBg,"Follow-Up 1":B.purpleBg,"Follow-Up 2":B.orangeBg,Negotiating:B.yellowBg,"PO Received":B.tealBg,"Closed Won":B.greenBg,"Closed Lost":B.redBg,"On Hold":B.surface};
const RSC = {
"New":B.blue,"In Process":B.orange,"Bid":B.green,"No Bid":B.muted,
Received:B.blue,Reviewing:B.purple,Pricing:B.orange,"Building Response":B.yellow,Submitted:B.teal,Won:B.green,Lost:B.red,
};
const ST1 = `ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa. Owner: Matt Stone (matt@st1sports.com, 719-256-0275). Brands: Blazer, Gill Athletics, Diamond, All-Star, Molten, Wilson, DeMarini, Louisville Slugger, FinishLynx, Pro-Nine. Markets: Iowa, Colorado, Minnesota, North Dakota. Sells to K-12 school districts, ADs, coaches. Brand voice: warm/direct, athlete-first, relationship before product. Owns: Human Contact ("I pick up the phone"), All-Sport Breadth, Exclusive Culture (graphic tee drops). Avoid efficiency-first hooks, corporate tone, generic inspiration.`;
const SPORTS_LIST = ["Track & Field","Baseball","Softball","Volleyball","Cross Country","Football","Basketball","Wrestling"];
const SPORT_ALIASES_MAP = {
  "Cross Country": ["xc","cross-country"],
  "Track & Field": ["t&f","track and field"],
};
const STATE_FULL_TO_ABBR = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC",
  "florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL",
  "indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
  "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN",
  "mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR",
  "pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  "tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA",
  "washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY",
};
function toStateAbbrClient(raw){
  if(!raw) return '';
  const s=raw.trim();
  if(s.length===2) return s.toUpperCase();
  const fromFull=STATE_FULL_TO_ABBR[s.toLowerCase()];
  if(fromFull) return fromFull;
  const lastTwo=s.slice(-2).toUpperCase();
  return lastTwo;
}
const STATES_LIST = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const US_REGIONS = {
"Midwest":       {states:["IA","MN","WI","MO","IL","IN","MI","OH","ND","SD","NE","KS"],color:"#1A5FA8"},
"Southeast":     {states:["FL","GA","TN","AL","MS","SC","NC","VA","KY","AR","LA"],color:"#1E8F4E"},
"Southwest":     {states:["TX","OK","NM","AZ"],color:"#C77800"},
"Mountain West": {states:["CO","UT","NV","ID","MT","WY"],color:"#F37321"},
"West Coast":    {states:["CA","WA","OR"],color:"#6B3FA0"},
"Northeast":     {states:["NY","PA","NJ","CT","MA","MD","DE","NH","VT","ME","RI"],color:"#C0392B"},
};
const US_STATES=["AK","AL","AR","AZ","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WY"];
const PRODUCT_CATS = ["Track & Field Equipment","Baseball / Softball","Volleyball","Timing Systems","Custom Team Stores","Apparel","Competition Spikes","Cross Country","Other"];
const CLUB_ROLES = ["Club Director","Program Coordinator","League Administrator","Head Coach","Travel Team Director","Tournament Director","Activities Coordinator"];
function urgentCount(s) {
return (s.deals||[]).filter(d=>!["Closed Won","Closed Lost","PO Received","On Hold"].includes(d.stage)&&d.followUpDate&&dUntil(d.followUpDate)<0).length;
}
export default function App() {
const [s, set, lastSynced, syncing, pullFromServer] = useStore();
const [mod, setMod]   = useState("briefing");
const [slim, setSlim] = useState(false);
const [mobileNavOpen, setMobileNavOpen] = useState(false);
const [expandedGroups, setExpandedGroups] = useState(new Set());
const toggleGroup = (id) => setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
const [toasts, setToasts] = useState([]);
const [showSearch, setShowSearch] = useState(false);
const [searchQuery, setSearchQuery] = useState("");
const [showAlerts, setShowAlerts] = useState(false);
const dispatch = useCallback((action, payload) => {
set(prev => {
const next = reducer(prev, action, payload);
const skipSync = new Set([
"LOGIN",
"SCORE_CONTACT",
"UPDATE_CAMPAIGN",
"UPDATE_CAMPAIGN_TOUCH",
"SET_INVOICES","SET_CONTACTS","SET_REORDERS","SET_ACTIVITIES",
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
if (s.currentUserId === "__owner__") {
return { id:"__owner__", name:"Admin", email:"", initials:"AD", color:B.orange, role:"owner", isAdmin:true };
}
const rep = (s.reps||[]).find(r=>r.id===s.currentUserId);
if (!rep) return null;
const initials = (rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
const appUser = (s.appUsers||[]).find(u=>u.repId===s.currentUserId);
return { ...rep, initials, color: B.blue, role: rep.title || "rep", isAdmin: appUser?.isAdmin || false };
})();
const crmSyncRef = useRef(null);
const ctx = {s, dispatch, toast, cu, mod, setMod, crmSyncRef, lastSynced, syncing, pullFromServer};
useEffect(()=>{
if(!s.currentUserId) return;
const SIX_H=6*60*60*1000;
// Contacts sync more often than invoices: this is the path that surfaces a
// Brad-driven Zoho Account/Contact promotion (fully server-side — cron/
// webhook, no rep in the loop) into the CRM tab. Waiting a full 6h for that
// to show up is too slow to feel like "shows positive intent → appears in
// CRM," so contacts get their own faster cadence.
const CONTACT_SYNC_INTERVAL=15*60*1000;
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
await new Promise(r=>setTimeout(r,150));
}
return all;
};
const dealStageMap={"Qualification":"Quoted","Value Proposition":"Quoted","Id. Decision Makers":"Follow-Up 1","Perception Analysis":"Follow-Up 1","Proposal/Price Quote":"Quoted","Negotiation/Review":"Negotiating","Closed Won":"Closed Won","Closed Lost":"Closed Lost"};
// A synced Zoho contact/lead belongs in the CRM tab only once someone's
// actually working it — an open deal, or a real reply/interest signal.
// Everything else is cold and belongs in the prospecting pool instead.
const hasContactIntent=(c,dealList,invoiceList)=>{
if((c.score||0)>=CONTACT_INTENT_SCORE) return true;
if(["replied","interested"].includes(c.outreachStatus)) return true;
if(findCustomerInvoice(c,invoiceList)) return true;
const nm=(c.fullName||`${c.firstName||""} ${c.lastName||""}`).trim().toLowerCase();
return dealList.some(d=>d.contactId===c.id||(d.contact||"").toLowerCase()===nm);
};
const splitColdContacts=(contactList,dealList,invoiceList)=>{
const cold=[],keep=[],discard=[];
for(const c of contactList){
// "manual" = a rep typed this in by hand — trust that judgment call same
// as any other deliberate single-record action.
if(c.source==="manual"){keep.push(c);continue;}
const isZoho=(c.source||"").startsWith("zoho");
// A real Zoho Contact (as opposed to a Lead) is already a qualified
// relationship by Zoho's own definition — either a pre-existing customer,
// or exactly what Brad's positive-intent promotion creates
// (createAsContact in api/contacts/promote.js). Don't re-run the
// deal/intent check on these: a freshly-promoted contact has no local
// score/outreachStatus/deal yet on its very first sync, and re-checking
// would immediately sweep it right back out — undoing the promotion.
const isZohoContact=(c.id||"").startsWith("zoho_c_");
if(isZohoContact){keep.push(c);continue;}
if(!c.email){
// No email = can't be migrated to Prospecting (keyed by email) and can't
// be worked via Brad/Edgar's email outreach either — not CRM-worthy and
// not prospecting-worthy. Keep it only if it's a real Zoho CRM record
// (rare to lack an email); everything else is unworkable junk, drop it.
if(isZoho) keep.push(c); else discard.push(c);
continue;
}
// Zoho Leads still get the deal/intent check — a raw Lead really can be
// an unqualified, unengaged prospect. Anything non-Zoho
// (bulk import, list-import, scraped, website/directory finds) was never
// CRM data to begin with — it belongs in Prospecting unconditionally,
// deal or no deal.
if(isZoho&&hasContactIntent(c,dealList,invoiceList)){keep.push(c);continue;}
cold.push(c);
}
return {cold,keep,discard};
};
const pushColdContactsToProspecting=async(cold)=>{
let moved=0;
for(let i=0;i<cold.length;i+=500){
const batch=cold.slice(i,i+500).map(c=>({
email:c.email,firstName:c.firstName,lastName:c.lastName,title:c.title,school:c.school,
phone:c.phone,sport:c.sport,state:c.state,city:c.city,score:c.score||0,
source:c.source||"revops-crm",
}));
try{
const r=await fetch("/api/contacts/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contacts:batch})});
const d=await r.json();
moved+=(d.added||0)+(d.updated||0);
}catch{}
}
return moved;
};
const syncContacts=async(force=false)=>{
if(!force&&s.contactsLastSync&&Date.now()-s.contactsLastSync<CONTACT_SYNC_INTERVAL) return;
const now=Date.now();
const existingDeals=s.deals||[];
let toAdd=[],toUpdate=[],dealRows=[],dealsAdded=0,dealsUpdated=0,fetchFailed=false,fetchErrMsg="";
try {
const [contactRows,leadRows,_dealRows]=await Promise.all([
fetchAllPages("/Contacts?fields=First_Name,Last_Name,Email,Phone,Title,Account_Name,Mailing_City,Mailing_State,Lead_Source"),
fetchAllPages("/Leads?fields=First_Name,Last_Name,Email,Phone,Title,Company,City,State,Lead_Source,Lead_Status,Rating,No_of_Calls,No_of_Chats,Last_Activity_Time"),
fetchAllPages("/Deals?fields=Deal_Name,Amount,Stage,Closing_Date,Account_Name,Contact_Name,Description,Modified_Time,Created_Time"),
]);
dealRows=_dealRows;
const contacts=contactRows.map(c=>({id:"zoho_c_"+c.id,firstName:zs(c.First_Name),lastName:zs(c.Last_Name),fullName:`${zs(c.First_Name)} ${zs(c.Last_Name)}`.trim(),email:zs(c.Email),phone:zs(c.Phone),title:zs(c.Title),school:zs(c.Account_Name),city:zs(c.Mailing_City),state:zs(c.Mailing_State),orgType:"school",source:"zoho-crm",zohoSource:zs(c.Lead_Source),confidence:"high",outreachStatus:"new",importedAt:now}));
const leads=leadRows.map(l=>({id:"zoho_l_"+l.id,firstName:zs(l.First_Name),lastName:zs(l.Last_Name),fullName:`${zs(l.First_Name)} ${zs(l.Last_Name)}`.trim(),email:zs(l.Email),phone:zs(l.Phone),title:zs(l.Title),school:zs(l.Company),city:zs(l.City),state:zs(l.State),orgType:"school",source:"zoho-crm",zohoSource:zs(l.Lead_Source),zohoStatus:zs(l.Lead_Status),rating:zs(l.Rating),confidence:"medium",outreachStatus:"new",importedAt:now}));
const existingIds=new Set((s.contacts||[]).map(c=>c.id));
const allZoho=[...contacts,...leads];
toAdd=allZoho.filter(c=>!existingIds.has(c.id));
toUpdate=allZoho.filter(c=>existingIds.has(c.id));

const existingDealZohoIds=new Set(existingDeals.map(d=>d.zohoId).filter(Boolean));
dealRows.forEach(zd=>{
const zStage=zs(zd.Stage)||"Quoted";
const localStage=DEAL_STAGES.includes(zStage)?zStage:(dealStageMap[zStage]||"Quoted");
if(existingDealZohoIds.has(zd.id)){
const local=existingDeals.find(d=>d.zohoId===zd.id);
if(local&&local.stage!==localStage){dispatch("UPDATE_DEAL",{id:local.id,stage:localStage,zohoStage:zStage});dealsUpdated++;autoInvoiceOnClosedWon(local,local.stage,localStage,toast);}
}else{
dispatch("ADD_DEAL",{id:"zoho_d_"+zd.id,zohoId:zd.id,name:zs(zd.Deal_Name)||"Untitled",contact:zs(zd.Contact_Name),school:zs(zd.Account_Name),value:Number(zd.Amount)||0,stage:localStage,zohoStage:zStage,notes:zd.Description||"",followUpDate:zd.Closing_Date||"",lastTouch:now,priority:"warm",touchHistory:[],source:"zoho-crm"});
dealsAdded++;
}
});
} catch(e){
fetchFailed=true; fetchErrMsg=e.message;
console.error("CRM sync (Zoho fetch) failed:",e);
}

// Local cold-contact sweep — runs whether or not the Zoho fetch above
// succeeded, since it only needs what's already cached locally: merge in
// anything freshly fetched, then split off any contact (any source, except
// a rep's own manual one-by-one adds) with no deal/quote/order and no
// reply/interest signal. Those move to the Prospecting pool instead of
// cluttering the CRM tab. Runs every sync, so this also sweeps the existing
// backlog, not just newly-fetched records.
const updMap=new Map(toUpdate.map(c=>[c.id,c]));
const mergedExisting=(s.contacts||[]).map(c=>updMap.has(c.id)?{...c,...updMap.get(c.id)}:c);
const fullContactSet=[...toAdd,...mergedExisting];
const allDealsForPhase=[...existingDeals,...dealRows.map(zd=>({contact:zs(zd.Contact_Name),school:zs(zd.Account_Name)}))];
const {cold,keep,discard}=splitColdContacts(fullContactSet,allDealsForPhase,s.invoices||[]);
dispatch("SET_CONTACTS",keep);
if(!fetchFailed) dispatch("SET_CONTACTS_LAST_SYNC",now);
let movedToProspecting=0;
if(cold.length) movedToProspecting=await pushColdContactsToProspecting(cold);

if(force){
const discardNote=discard.length?` · ${discard.length} discarded (no email, unworkable)`:"";
if(fetchFailed) toast(`Zoho fetch failed (${fetchErrMsg}) — cleaned up local cache anyway: ${movedToProspecting} cold contact(s) moved to Prospecting DB${discardNote}`,cold.length?"info":"error");
else toast(`Zoho CRM: ${toAdd.length} contacts added, ${toUpdate.length} updated · ${dealsAdded} deals added, ${dealsUpdated} updated${cold.length?` · ${movedToProspecting} cold contact(s) moved to Prospecting DB (no deal/reply yet)`:""}${discardNote}`, "success");
}
};
crmSyncRef.current = syncContacts;
const initTimer=setTimeout(()=>{syncInvoices();syncContacts();},8000);
const invIv=setInterval(syncInvoices,SIX_H);
const contactIv=setInterval(syncContacts,CONTACT_SYNC_INTERVAL);
return()=>{clearTimeout(initTimer);clearInterval(invIv);clearInterval(contactIv);};
},[s.currentUserId]);
useEffect(()=>{ setMobileNavOpen(false); },[mod]);
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
const NAV = useMemo(()=>[
{id:"_s_sales"},
{id:"briefing",    icon:"⌂", label:"Home",            badge:urgentCount(s)},
{id:"analytics",   icon:"▣", label:"Analytics"},
{id:"crm",           icon:"◈", label:"CRM"},
{id:"sponsorships",  icon:"★", label:"Sponsorships",  badge:(s.contacts||[]).filter(c=>c.sponsorshipStatus==="proposed").length||0},
{id:"_s_growth"},
{id:"prospecting", icon:"⊕", label:"Prospecting"},
{id:"social",      icon:"📱", label:"Social"},
{id:"reddit",      icon:"💬", label:"Reddit Engagement"},
{id:"cc-ad-hub",   icon:"📊", label:"Ad Hub"},
{id:"_s_tools"},
{id:"reorder",     icon:"↺", label:"Reorder Engine", badge:(s.reorders||[]).filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date())).length},
{id:"team-stores", icon:"🛒", label:"Team Stores"},
{id:"flagship-store", icon:"🏪", label:"Flagship Store"},
{id:"compete",     icon:"⊗", label:"Competitors"},
{id:"price-lists", icon:"$", label:"Price Lists"},
{id:"edgar",       icon:"▤", label:"Edgar – Quotes"},
{id:"expansion",   icon:"◉", label:"Expansion Playbook"},
{id:"_s_finance"},
{id:"finance",     icon:"⬡", label:"Finance"},
{id:"_s_system"},
{id:"activity",      icon:"≡", label:"Activity"},
{id:"settings",      icon:"⚙", label:"Settings"},
{id:"integrations",  icon:"⚡", label:"Integrations"},
...(cu?.isAdmin ? [{id:"admin", icon:"◐", label:"Admin Panel"}] : []),
],[s.reorders,s.deals,s.rfps,cu?.isAdmin]);
usePrefetchPanels();
function EdgarSidebarWidget() {
const {dispatch:d2}=useApp();
const [val,setVal]=useState("");
const submit=()=>{if(val.trim()){d2("SET_EDGAR_DRAFT",val.trim());setMod("edgar");setVal("");}};
if(slim) return <button onClick={()=>setMod("edgar")} title="Edgar – Quotes" style={{width:"100%",background:mod==="edgar"?`${B.teal}33`:"rgba(255,255,255,0.04)",border:"none",borderTop:"1px solid rgba(255,255,255,0.07)",color:mod==="edgar"?B.teal:"rgba(255,255,255,0.5)",padding:"9px 0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>▤</button>;
return(
<div style={{borderTop:"1px solid rgba(255,255,255,0.07)",padding:"9px 11px 10px",background:`${B.teal}10`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.teal,letterSpacing:1.5,marginBottom:6}}>▤ EDGAR – QUICK QUOTE</div>
<textarea rows={2} placeholder="e.g. 12 hurdles, 2 blocks for Valley High..." value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}} style={{width:"100%",background:"rgba(255,255,255,0.06)",border:`1px solid ${B.teal}4D`,color:"#e5e7eb",borderRadius:4,padding:"5px 7px",fontSize:10,fontFamily:"'Lexend',sans-serif",lineHeight:1.55,resize:"none",outline:"none",boxSizing:"border-box"}}/>
<button onClick={submit} style={{marginTop:5,width:"100%",background:`${B.teal}2E`,border:`1px solid ${B.teal}66`,color:B.teal,borderRadius:4,padding:"5px 0",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,fontWeight:700,cursor:"pointer"}}>▤ QUOTE</button>
</div>
);
}
const [approvedQuotes,setApprovedQuotes]=useState({});
const [quoteEmailDrafts,setQuoteEmailDrafts]=useState({});
const [sendingQuoteEmail,setSendingQuoteEmail]=useState(null);
const downloadQuotePdf=(key)=>{
const q=approvedQuotes[key];
if(!q?.pdfBase64)return;
const bytes=Uint8Array.from(atob(q.pdfBase64),c=>c.charCodeAt(0));
const blob=new Blob([bytes],{type:"application/pdf"});
const url=URL.createObjectURL(blob);
const a=document.createElement("a");
a.href=url;a.download=`Quote-${q.quoteNumber}.pdf`;a.click();
URL.revokeObjectURL(url);
};
const sendQuoteEmail=async(key)=>{
const draft=quoteEmailDrafts[key];
const q=approvedQuotes[key];
if(!draft?.to||!q?.pdfBase64)return;
setSendingQuoteEmail(key);
try{
const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
action:"send",
...(cu?.gmailEnvKey?{repEnvKey:cu.gmailEnvKey}:{}),
to_email:draft.to,subject:draft.subject,body:draft.body,
...(cu?.email?{reply_to:cu.email,from_name:cu.name||""}:{}),
attachments:[{filename:`Quote-${q.quoteNumber}.pdf`,mimeType:"application/pdf",contentBase64:q.pdfBase64}],
})});
const d=await r.json();
if(d.sent||d.ok){
setQuoteEmailDrafts(prev=>({...prev,[key]:{...prev[key],sent:true}}));
toast(`Quote emailed to ${draft.to}`,"success");
dispatch("LOG",{msg:`Quote ${q.quoteNumber} emailed to ${draft.to}`});
}else toast(d.error||"Send failed","error");
}catch(e){toast(`Send error: ${e.message}`,"error");}
setSendingQuoteEmail(null);
};
const sharedCreateQuoteNow=async(action,key,setSQ)=>{
setSQ(key);
try{
const r=await fetch("/api/crm/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
customerName:action.customer_name,
accountCity:action.account_city||"",
accountState:action.account_state||"",
contactPerson:action.contact_person||"",
email:action.email||"",
lineItems:(action.line_items||[]).map(li=>({name:li.name,description:li.description||"",quantity:Number(li.quantity)||1,rate:Number(li.rate)||0,cost:Number(li.cost)||0})),
shippingCost:Number(action.shipping_cost)||0,
notes:action.notes||"",
})});
const d=await r.json();
if(d.ok){
toast(`Quote created: ${d.quoteNumber}!`,"success");
dispatch("LOG",{msg:`Quote ${d.quoteNumber} created for ${action.customer_name}`});
const matchDeal=(s.deals||[]).find(d2=>(d2.name||"").toLowerCase().includes((action.customer_name||"").toLowerCase().slice(0,6)));
if(matchDeal)dispatch("UPDATE_DEAL",{id:matchDeal.id,stage:"Quoted",notes:(matchDeal.notes?matchDeal.notes+"\n":"")+`Quote ${d.quoteNumber} created`});
setApprovedQuotes(prev=>({...prev,[key]:d}));
setQuoteEmailDrafts(prev=>({...prev,[key]:{
to:action.email||"",
subject:`Your quote from ST1 Sports — ${d.quoteNumber}`,
body:`Hi ${action.contact_person||"there"},\n\nAttached is your quote (${d.quoteNumber}) from ST1 Sports. Let me know if you have any questions.\n\nThanks,\n${cu?.name||"Matt Stone"}\n${cu?.email||""}\n${cu?.phone||""}`,
sent:false,
}}));
}else{toast(d.error||"Quote creation failed","error");}
}catch(e){toast(`Quote error: ${e.message}`,"error");}
setSQ(null);
};
const sharedCreateEdgarQuoteInZoho=(action,key,setSQ)=>{
const q=action.quote||{};
return sharedCreateQuoteNow({
customer_name:q.customer||action.customer||"Customer",
line_items:(q.lineItems||[]).filter(li=>!li.notFound).map(li=>({name:li.name,description:li.notes||"",quantity:Number(li.qty)||1,rate:Number(li.quotedPrice)||0,cost:Number(li.cost)||0})),
notes:(q.warnings||[]).join("\n"),
},key,setSQ);
};
const sharedSendBradEmail=async(draft,key,setSI)=>{
if(!draft.contactEmail){toast("No email — can't send","error");return;}
setSI(key);
try{
const r=await fetch("/api/agents/brad-send",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({contactEmail:draft.contactEmail,contactName:draft.contactName,subject:draft.subject,body:draft.body,contactId:draft.contactId})});
const d=await r.json();
if(d.sent){
toast(`✉ Sent to ${draft.contactName||draft.contactEmail}`,"success");
dispatch("LOG",{msg:`Brad email sent: ${draft.contactName||draft.contactEmail} — "${draft.subject}"`});
const contact=(s.contacts||[]).find(c=>c.email===draft.contactEmail);
if(contact)dispatch("SCORE_CONTACT",{contactId:contact.id,type:"sent",campaignId:"brad",note:`Brad: ${draft.subject}`});
}else toast(d.error||"Send failed","error");
}catch(e){toast(`Send error: ${e.message}`,"error");}
setSI(null);
};
const sharedSendEmailNow=async(action,key,setSE,sendFn)=>{
if(!action.to_email){toast("No email — can't send","error");return;}
setSE(key);
try{
const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",to_email:action.to_email,to_name:action.to_name,subject:action.subject,body:action.body})});
const d=await r.json();
if(d.sent){
toast(`Email sent to ${action.to_name||action.to_email}`,"success");
dispatch("LOG",{msg:`Email sent to ${action.to_name||action.to_email}: "${action.subject}"`});
const contact=(s.contacts||[]).find(c=>c.email===action.to_email);
if(contact)dispatch("SCORE_CONTACT",{contactId:contact.id,type:"sent",campaignId:"agent_email",note:`Agent email: ${action.subject}`});
const nameParts=(action.to_name||"").toLowerCase().split(" ");
const matchDeal=(s.deals||[]).find(d=>{const dn=(d.name||"").toLowerCase();return nameParts.some(p=>p.length>2&&dn.includes(p))||(contact?.school&&dn.includes((contact.school||"").toLowerCase().slice(0,6)));});
if(matchDeal&&!matchDeal.followUpDate){const f=new Date(Date.now()+3*86400000).toISOString().slice(0,10);dispatch("UPDATE_DEAL",{id:matchDeal.id,followUpDate:f});toast(`Follow-up auto-set ${f}`,"info");}
setTimeout(()=>sendFn(`Email sent ✓ to ${action.to_name||action.to_email} — "${action.subject}". Auto-execute: log this touch and schedule follow-up.`),600);
}else{toast(d.error||"Send failed","error");}
}catch(e){toast(`Send error: ${e.message}`,"error");}
setSE(null);
};
if (!s.currentUserId) return <Login dispatch={dispatch} reps={s.reps||[]} appUsers={s.appUsers||[]}/>;
const navLabel = (id) => {
for (const n of NAV) {
if (n.id === id) return n.label;
if (n.children) { const c = n.children.find(ch=>ch.id===id); if(c) return c.label; }
}
return "";
};
return (
<AppCtx.Provider value={ctx}>
<div style={{display:"flex",height:"100vh",background:B.pageBg,overflow:"hidden",fontFamily:"'Lexend',sans-serif",color:B.text}}>
<style>{`
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px}
button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s} button:hover{opacity:.82} button:active{transform:scale(.97)}
input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
@keyframes fu{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.fu{animation:fu .2s ease} .blink{animation:blink 2s infinite}
.card{background:${B.white};border:1px solid ${B.border};border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.rv-hamburger{display:none!important}
.rv-mob-close{display:none!important}
@media(max-width:768px){
  .rv-sidebar{position:fixed!important;top:0!important;left:0!important;height:100vh!important;width:240px!important;z-index:50;transform:translateX(-100%);transition:transform .22s ease,width .18s!important}
  .rv-sidebar.open{transform:translateX(0)}
  .rv-slim-toggle{display:none!important}
  .rv-mob-close{display:flex!important;align-items:center}
  .rv-hamburger{display:flex!important;align-items:center}
  .rv-int-status{display:none!important}
  .rv-sync-btn{display:none!important}
  .rv-sep{display:none!important}
  .rv-crm-split{flex-direction:column!important}
  .rv-crm-left{width:100%!important;max-height:220px!important;border-right:none!important;border-bottom:1px solid ${B.border}!important;flex-shrink:0!important}
  .rv-kpi-grid{grid-template-columns:repeat(2,1fr)!important}
  .rv-info-grid{grid-template-columns:repeat(2,1fr)!important}
  .rv-2col-grid{grid-template-columns:1fr!important}
  .rv-3col-grid{grid-template-columns:1fr!important}
  .rv-results-split{grid-template-columns:1fr!important}
  .rv-results-split .rv-sticky-log{position:static!important}
  .rv-segment-cards{grid-template-columns:1fr!important}
}
`}</style>
{/* SIDEBAR */}
<aside className={"rv-sidebar"+(mobileNavOpen?" open":"")} style={{width:slim?52:208,background:"#111827",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",flexShrink:0,transition:"width .18s",overflow:"hidden"}}>
<div style={{padding:"14px 10px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:slim?"center":"space-between",minHeight:60}}>
{!slim&&<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{width:30,height:30,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white,letterSpacing:-1}}>ST1</span>
</div>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:"#fff",letterSpacing:.3}}>ST1 SPORTS</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:6,color:B.orange,letterSpacing:2}}>REVOPS</div>
</div>
</div>}
{slim&&<div style={{width:30,height:30,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.white,letterSpacing:-1}}>ST1</span>
</div>}
<button onClick={()=>setMobileNavOpen(false)} className="rv-mob-close" style={{background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:17,padding:"0 2px",flexShrink:0,lineHeight:1}}>✕</button>
<button onClick={()=>setSlim(c=>!c)} className="rv-slim-toggle" style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",fontSize:13,padding:2,flexShrink:0,marginLeft:slim?0:2}}>{slim?"→":"←"}</button>
</div>
<nav style={{flex:1,overflowY:"auto",overflowX:"hidden",paddingTop:6}}>
{NAV.map(n=>{
if(n.id.startsWith("_s_")) {
const label = n.label || n.id.replace("_s_","").toUpperCase();
return !slim
? <div key={n.id} style={{padding:"10px 13px 3px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:"rgba(255,255,255,0.3)",letterSpacing:2}}>{label}</div>
: <div key={n.id} style={{height:1,background:"rgba(255,255,255,0.07)",margin:"5px 8px"}}/>;
}
if(n.id==="_div") return <div key="_div" style={{height:1,background:"rgba(255,255,255,0.07)",margin:"6px 8px"}}/>;
if(n.group) {
const isExp = expandedGroups.has(n.id);
const hasActive = (n.children||[]).some(c=>c.id===mod);
return (
<div key={n.id}>
<button onClick={()=>{ if(slim){setSlim(false);} toggleGroup(n.id); }} title={slim?n.label:undefined}
style={{width:"100%",background:hasActive?"rgba(243,115,33,0.15)":"transparent",border:"none",borderLeft:`3px solid ${hasActive?B.orange:"transparent"}`,color:hasActive?B.orange:"rgba(255,255,255,0.55)",padding:slim?"9px 0":"7px 11px 7px 10px",display:"flex",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:hasActive?500:400,textAlign:"left"}}>
<span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
{!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1}}>{n.label}</span>}
{!slim&&<span style={{fontSize:8,color:"rgba(255,255,255,0.3)",flexShrink:0,marginLeft:2}}>{isExp?"▾":"▸"}</span>}
</button>
{isExp&&!slim&&(n.children||[]).map(ch=>(
<button key={ch.id} onClick={()=>setMod(ch.id)}
style={{width:"100%",background:mod===ch.id?"rgba(243,115,33,0.15)":"transparent",border:"none",borderLeft:`3px solid ${mod===ch.id?B.orange:"transparent"}`,color:mod===ch.id?B.orange:"rgba(255,255,255,0.5)",padding:"6px 11px 6px 26px",display:"flex",alignItems:"center",gap:7,fontSize:10,fontWeight:mod===ch.id?500:400,textAlign:"left"}}>
<span style={{fontSize:11,width:14,textAlign:"center",flexShrink:0}}>{ch.icon}</span>
<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ch.label}</span>
</button>
))}
</div>
);
}
if(n.href) return (
<a key={n.id} href={n.href} target="_blank" rel="noreferrer" title={slim?n.label:undefined}
style={{display:"flex",textDecoration:"none",width:"100%",background:"transparent",borderLeft:"3px solid transparent",color:"rgba(255,255,255,0.45)",padding:slim?"9px 0":"7px 11px 7px 10px",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:400}}>
<span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
{!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n.label}</span>}
{!slim&&<span style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.3)",flexShrink:0}}>↗</span>}
</a>
);
return (
<button key={n.id} onClick={()=>setMod(n.id)} title={slim?n.label:undefined}
style={{width:"100%",background:mod===n.id?"rgba(243,115,33,0.15)":"transparent",border:"none",borderLeft:`3px solid ${mod===n.id?B.orange:"transparent"}`,color:mod===n.id?B.orange:"rgba(255,255,255,0.55)",padding:slim?"9px 0":"7px 11px 7px 10px",display:"flex",alignItems:"center",gap:slim?0:8,justifyContent:slim?"center":"flex-start",fontSize:11,fontWeight:mod===n.id?500:400,textAlign:"left",position:"relative"}}>
<span style={{fontSize:12,width:15,textAlign:"center",flexShrink:0}}>{n.icon}</span>
{!slim&&<span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{n.label}</span>}
{!slim&&n.badge>0&&<span style={{marginLeft:"auto",background:B.orange,color:"#fff",borderRadius:10,padding:"1px 5px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,flexShrink:0}}>{n.badge}</span>}
{slim&&n.badge>0&&<span style={{position:"absolute",top:5,right:5,background:B.orange,color:"#fff",borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{n.badge}</span>}
</button>
);
})}
</nav>
{/* ── EDGAR QUICK QUOTE ── */}
{s.currentUserId&&<EdgarSidebarWidget/>}
{s.currentUserId&&!slim&&<div style={{padding:"9px 11px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:7}}>
{cu&&<div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
</div>}
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#fff",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cu?.name||s.currentUserId}</div>
{cu&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:6,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>{(cu.role||"").toUpperCase()}</div>}
</div>
<button onClick={()=>dispatch("LOGOUT")} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.5)",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>OUT</button>
</div>}
{s.currentUserId&&slim&&<div style={{padding:"8px 0",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
{cu&&<div style={{width:26,height:26,borderRadius:"50%",background:cu.color,display:"flex",alignItems:"center",justifyContent:"center"}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{cu.initials}</span>
</div>}
<button onClick={()=>dispatch("LOGOUT")} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.4)",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>OUT</button>
</div>}
</aside>
{mobileNavOpen&&<div onClick={()=>setMobileNavOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:49}}/>}
{/* MAIN */}
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<header style={{background:B.white,borderBottom:`1px solid ${B.border}`,height:46,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px 0 12px",flexShrink:0,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<button className="rv-hamburger" onClick={()=>setMobileNavOpen(o=>!o)} style={{background:"none",border:"none",fontSize:18,color:B.muted,padding:"2px 6px 2px 2px",lineHeight:1,flexShrink:0}}>☰</button>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2}}>{navLabel(mod).toUpperCase()}</div>
</div>
<div style={{display:"flex",gap:12,alignItems:"center"}}>
<div className="rv-int-status" style={{display:"flex",gap:12,alignItems:"center"}}>
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
</div>
<div className="rv-sep" style={{width:1,height:14,background:B.border}}/>
{/* Live sync indicator */}
{(()=>{
const secAgo = lastSynced ? Math.round((Date.now()-lastSynced)/1000) : null;
const fresh  = secAgo !== null && secAgo < 60;
return(
<button className="rv-sync-btn" onClick={()=>pullFromServer()} title="Sync now — pull latest from server"
style={{display:"flex",alignItems:"center",gap:5,background:"none",border:`1px solid ${fresh?B.green+"40":B.border}`,borderRadius:4,padding:"3px 9px",cursor:"pointer"}}>
<div style={{width:6,height:6,borderRadius:"50%",background:syncing?B.orange:fresh?B.green:B.muted,
animation:syncing?"pulse 1s infinite":undefined}}/>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:syncing?B.orange:fresh?B.green:B.muted}}>
{syncing?"SYNCING…":secAgo===null?"SYNC":secAgo<10?"LIVE":secAgo<60?`${secAgo}s ago`:secAgo<3600?`${Math.round(secAgo/60)}m ago`:"SYNC"}
</span>
</button>
);
})()}
<div className="rv-sep" style={{width:1,height:14,background:B.border}}/>
<button onClick={()=>{setShowSearch(true);setSearchQuery("");}} title="Search (press /)" style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:11,borderRadius:4,padding:"3px 9px",display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
<span style={{fontSize:12}}>⌕</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10}}>Search</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,border:`1px solid ${B.border}`,borderRadius:3,padding:"1px 4px"}}>/</span>
</button>
<div style={{width:1,height:14,background:B.border}}/>
{(()=>{const alerts=s.alerts||[];const unread=alerts.filter(a=>!a.sent).length;return(
<div style={{position:"relative"}}>
<button onClick={()=>setShowAlerts(v=>!v)} style={{background:"none",border:"none",color:unread?B.orange:B.muted,fontSize:13,position:"relative",padding:2,cursor:"pointer"}}>◎{unread>0&&<span style={{position:"absolute",top:-3,right:-3,background:B.orange,color:B.white,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontFamily:"'Lexend Zetta',sans-serif"}}>{unread}</span>}</button>
{showAlerts&&(
<div style={{position:"absolute",top:"calc(100% + 6px)",right:0,width:280,maxHeight:340,overflowY:"auto",background:B.white,border:`1px solid ${B.border}`,borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,.12)",zIndex:50}}>
<div style={{padding:"8px 12px",borderBottom:`1px solid ${B.border}`,fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5}}>ALERTS</div>
{alerts.length===0?(
<div style={{padding:16,textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No alerts</div>
):alerts.map(a=>(
<div key={a.id} style={{padding:"9px 12px",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start",opacity:a.sent?0.55:1}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{a.msg}</div>
{a.action&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{a.action}</div>}
</div>
{!a.sent&&<button onClick={()=>dispatch("DISMISS_ALERT",a.id)} title="Dismiss" style={{background:"none",border:"none",color:B.muted,fontSize:12,cursor:"pointer",padding:0,flexShrink:0}}>×</button>}
</div>
))}
</div>
)}
</div>
);})()}
</div>
</header>
<main style={{flex:1,overflowY:"auto",background:B.pageBg,display:"flex",flexDirection:"column"}}>
<ErrBound key={mod}>
{mod==="analytics"   && <ModAnalytics/>}
{mod==="briefing"    && <ModHome/>}
{mod==="crm"          && <ModCRM/>}
{mod==="sponsorships" && <ModSponsorships/>}
{mod==="deals"        && <ModDeals/>}
{mod==="orders"      && <ModOrders/>}
{mod==="reorder"     && <ModReorder/>}
{mod==="prospecting" && <ModProspecting/>}
{mod==="social"      && <ModSocial/>}
{mod==="compete"     && <ModCompete/>}
{mod==="activity"    && <ModActivity/>}
{mod==="settings"    && <ModSettings/>}
{mod==="admin"       && <ModAdmin/>}
{/* ── Inline tools (formerly separate pages) ── */}
{mod==="integrations"&&<Suspense fallback={<PanelLoader/>}><IntegrationsPage/></Suspense>}
{mod==="finance"     && <ModFinance/>}
{mod==="reddit"      &&<Suspense fallback={<PanelLoader/>}><RedditPage/></Suspense>}
{mod==="price-lists" &&<ModPriceLists/>}
{mod==="edgar"       &&<ModEdgar/>}
{mod==="expansion"   &&<Suspense fallback={<PanelLoader/>}><ExpansionPage s={s} dispatch={dispatch} toast={toast}/></Suspense>}
{mod==="team-stores" &&<Suspense fallback={<PanelLoader/>}><TeamStoresPage/></Suspense>}
{mod==="flagship-store" &&<Suspense fallback={<PanelLoader/>}><FlagshipStorePage/></Suspense>}
{/* ── AI Tools (Command Center modules embedded) ── */}
{mod.startsWith("cc-")&&<Suspense fallback={<PanelLoader/>}><CmdCenter initialModuleId={mod.slice(3)} embedded key={mod} s={s} dispatch={dispatch} toast={toast}/></Suspense>}
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
<Grp title="CONTACTS" items={contacts} go={(c)=>{dispatch("SET_CRM_NAV",{id:c.id});setMod("crm");}} getLabel={c=>c.fullName||c.firstName||"Unnamed"} getSub={c=>`${typeof c.school==="string"?c.school:c.school?.name||""} · ${c.email||"no email"}`}/>
<Grp title="DEALS" items={deals} go={()=>setMod("deals")} getLabel={d=>d.name} getSub={d=>`${d.contact} · ${d.school} · ${d.stage}`}/>
<Grp title="CAMPAIGNS" items={campaigns} go={()=>{dispatch("SET_PROSPECTING_NAV","campaigns");setMod("prospecting");}} getLabel={c=>c.name} getSub={c=>`${(c.enrollments||[]).length} enrolled`}/>
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
function Login({dispatch, reps=[], appUsers=[]}) {
const [sel,setSel]=useState(null);
const [pin,setPin]=useState("");
const [shake,setShake]=useState(false);
const [loading,setLoading]=useState(false);
const loginUsers = appUsers.map(au=>{
const rep = reps.find(r=>r.id===au.repId);
if(!rep) return null;
const initials = (rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
return { id: rep.id, name: rep.name, email: rep.email, initials, color: B.blue, pin: au.pin };
}).filter(Boolean);
const doLogin=async()=>{
if(!sel||pin.length<4) return;
setLoading(true);
const user = loginUsers.find(u=>u.id===sel.id);
await new Promise(r=>setTimeout(r,200));
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
{/* Admin bypass — only visible when no admin accounts are set up */}
{!appUsers.some(au=>au.isAdmin)&&(
<div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${B.border}`,textAlign:"center"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>No admin account configured yet</div>
<button onClick={()=>dispatch("LOGIN","__owner__")}
style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"8px 18px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
ADMIN ACCESS →
</button>
</div>
)}
</div>
</div>
);
}
const PH=React.memo(function PH({title,sub,action}){return <div style={{marginBottom:18,display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}><div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3,lineHeight:1.1}}>{title}</div>{sub&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:3}}>{sub}</div>}<div style={{width:30,height:3,background:B.orange,marginTop:7,borderRadius:2}}/></div>{action}</div>;});
const Lbl=React.memo(function Lbl({c,s={},children}){return <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c||B.muted,letterSpacing:2.5,textTransform:"uppercase",...s}}>{children}</div>;});
const OBtn=React.memo(function OBtn({children,onClick,disabled,sm,col,style={}}){const c=col||B.orange;return <button onClick={onClick} disabled={disabled} style={{background:disabled?B.border:c,color:disabled?B.muted:B.white,border:"none",borderRadius:5,padding:sm?"5px 11px":"8px 16px",fontSize:sm?10:11,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:disabled?"not-allowed":"pointer",...style}}>{children}</button>;});
const GBtn=React.memo(function GBtn({children,onClick,style={}}){return <button onClick={onClick} style={{background:B.white,color:B.textMid,border:`1px solid ${B.borderD}`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif",...style}}>{children}</button>;});
const Pill=React.memo(function Pill({v,sc,bc}){const c=(sc||{})[v]||B.muted;const bg=(bc||{})[v]||B.surface;return <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c,background:bg,padding:"2px 6px",borderRadius:3,letterSpacing:.5,whiteSpace:"nowrap"}}>{v?.toUpperCase()}</span>;});
const DbSyncBadge=React.memo(function DbSyncBadge({pl,sm}){
const fs=sm?7:8,pad=sm?"0 4px":"1px 6px";
if(!pl.dbSyncedAt) return <span title="Never saved to the database — Edgar can't quote from this list yet" style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:fs,color:B.muted,background:B.surface,border:`1px solid ${B.border}`,borderRadius:2,padding:pad,letterSpacing:.3,whiteSpace:"nowrap"}}>NOT IN DB</span>;
if(pl.dbItemCount!==(pl.items||[]).length) return <span title={`${(pl.items||[]).length} items now vs ${pl.dbItemCount} last saved — click Save to DB to update`} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:fs,color:"#C77800",background:"#FFF8E6",borderRadius:2,padding:pad,letterSpacing:.3,whiteSpace:"nowrap"}}>OUT OF SYNC</span>;
return <span title={`Saved to the database ${new Date(pl.dbSyncedAt).toLocaleString()}`} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:fs,color:B.green,background:B.greenBg,borderRadius:2,padding:pad,letterSpacing:.3,whiteSpace:"nowrap"}}>✓ IN DB</span>;
});
const UCh=React.memo(function UCh({uid}){const {s}=useApp();const u=(s.reps||[]).find(r=>r.id===uid);if(!u)return null;const ini=(u.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();return <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:16,height:16,borderRadius:"50%",background:B.blue,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:6,color:B.white}}>{ini}</span></div><span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{u.name.split(" ")[0]}</span></div>;});
const Spin=React.memo(function Spin(){return <div style={{width:18,height:18,border:`2px solid ${B.border}`,borderTop:`2px solid ${B.orange}`,borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0}}/>;});
const KCard=React.memo(function KCard({l,v,c,sub,onClick}){return <div onClick={onClick} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"12px 14px",borderTop:`2px solid ${c}`,textAlign:"center",cursor:onClick?"pointer":"default",boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}><div style={{fontFamily:"'Russo One',sans-serif",fontSize:21,color:c,letterSpacing:.3}}>{v}</div><Lbl s={{marginTop:3}}>{l}</Lbl>{sub&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{sub}</div>}</div>;});
const ORDER_STAGES = ["Order Received","Order Placed","Invoiced"];
function ModAnalytics() {
const {s,setMod}=useApp();
const [tab,setTab]=useState("overview");
const deals=s.deals||[];
const campaigns=s.campaigns||[];
const contacts=s.contacts||[];
const reps=s.reps||[];
const {openDeals,won,lost,openPipeline,wonTotal,activeCampaigns,hotLeads,totalClosed,convRate,avgDeal,campaignDeals}=useMemo(()=>{
const closedStages=["Closed Won","Closed Lost","PO Received"];
const openDeals=deals.filter(d=>!closedStages.includes(d.stage));
const won=deals.filter(d=>d.stage==="Closed Won");
const lost=deals.filter(d=>d.stage==="Closed Lost");
const openPipeline=openDeals.reduce((a,d)=>a+(d.value||0),0);
const wonTotal=won.reduce((a,d)=>a+(d.value||0),0);
const activeCampaigns=campaigns.filter(c=>c.status==="active").length;
const hotLeads=contacts.filter(c=>(c.score||0)>=40).length;
const totalClosed=won.length+lost.length;
const convRate=totalClosed>0?Math.round((won.length/totalClosed)*100):0;
const avgDeal=won.length>0?Math.round(wonTotal/won.length):0;
const campaignDeals=deals.filter(d=>d.campaignId).sort((a,b)=>(b.value||0)-(a.value||0));
return{openDeals,won,lost,openPipeline,wonTotal,activeCampaigns,hotLeads,totalClosed,convRate,avgDeal,campaignDeals};
},[deals,campaigns,contacts]);
const TABS=[["overview","Overview"],["pipeline","Pipeline"],["campaigns","Campaigns"],["hotleads","Hot Leads"],["emails","Emails"]];
return (
<div style={{padding:"22px 26px",overflowY:"auto",height:"calc(100vh - 46px)"}}>
<PH title="ANALYTICS" sub="Pipeline, campaigns, and lead performance"/>
<div style={{display:"flex",gap:5,marginBottom:18,borderBottom:`1px solid ${B.border}`}}>
{TABS.map(([id,label])=>(
<button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===id?B.orange:"transparent"}`,color:tab===id?B.orange:B.muted,padding:"7px 14px 9px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,letterSpacing:1.5,fontWeight:700,cursor:"pointer"}}>{label}</button>
))}
</div>
{tab==="overview"&&(
<div>
<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:11,marginBottom:20}}>
<KCard l="Total Won" v={fmt$K(wonTotal)} c={B.green} sub="closed won"/>
<KCard l="Open Pipeline" v={fmt$K(openPipeline)} c={B.orange} sub={`${openDeals.length} deals`}/>
<KCard l="Avg Deal Size" v={fmt$K(avgDeal)} c={B.yellow}/>
<KCard l="Win Rate" v={`${convRate}%`} c={B.blue}/>
<KCard l="Active Campaigns" v={activeCampaigns} c={B.purple}/>
<KCard l="Hot Leads" v={hotLeads} c={B.teal} sub="score ≥ 40"/>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
<div className="card" style={{padding:14}}>
<Lbl s={{marginBottom:10}}>Recent Deals</Lbl>
<div style={{display:"flex",flexDirection:"column",gap:7}}>
{deals.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5).map(d=>(
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
const rep=reps.find(r=>r.id===camp.repId);
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
const u=reps.find(r=>r.id===rid);
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
{campaignDeals.map(d=>{
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
const lastAct=(c.activity||[]).reduce((best,a)=>(!best||a.ts>best.ts)?a:best,null);
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
function ModHome() {
const {s,dispatch,toast,cu,setMod}=useApp();
const history=s.agentHistory||[];
const setHistory=(fn)=>dispatch("SET_AGENT_HISTORY",typeof fn==="function"?fn(history):fn);
const [input,setInput]=useState("");
const [running,setRunning]=useState(false);
const [expandedEmail,setExpandedEmail]=useState(null);
const [expandedQuote,setExpandedQuote]=useState(null);
const [expandedCampaign,setExpandedCampaign]=useState(null);
const [expandedEdgarQuote,setExpandedEdgarQuote]=useState(null);
const [expandedBradOutreach,setExpandedBradOutreach]=useState(null);
const [expandedLedgerReconcile,setExpandedLedgerReconcile]=useState(null);
const [expandedLedgerBill,setExpandedLedgerBill]=useState(null);
const [invoiceCreated,setInvoiceCreated]=useState({});
const [billCreated,setBillCreated]=useState({});
const [billPdfStore,setBillPdfStore]=useState({});
const [agentStatus,setAgentStatus]=useState(null);
const [lastMeta,setLastMeta]=useState(null);
const [sendingEmail,setSendingEmail]=useState(null);
const [sendingInstantly,setSendingInstantly]=useState(null);
const [sendingQuote,setSendingQuote]=useState(null);
const [launchingCampaign,setLaunchingCampaign]=useState(null);
const [campaignSendTime,setCampaignSendTime]=useState({});
const [sessions,setSessions]=useState([]);
const [sessionsLoading,setSessionsLoading]=useState(true);
const [activeSessionId,setActiveSessionId]=useState(null);
const [insights,setInsights]=useState({});
const sessionIdRef=useRef(null);
const endRef=useRef(null);
const inputRef=useRef(null);
useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[history]);
useEffect(()=>{
if(s.agentDraft){setInput(s.agentDraft);dispatch("SET_AGENT_DRAFT","");}
},[s.agentDraft]);
useEffect(()=>{
if(!cu?.id){setSessionsLoading(false);return;}
fetch(`/api/chat?userId=${encodeURIComponent(cu.id)}&limit=40`)
.then(r=>r.json())
.then(d=>{
const valid=(d.sessions||[]).filter(s=>(s.messages||[]).some(m=>m.role==="user"));
setSessions(valid);
setSessionsLoading(false);
})
.catch(()=>setSessionsLoading(false));
},[cu?.id]);
const sessionTitle=(sess)=>{
const first=(sess.messages||[]).find(m=>m.role==="user");
const txt=first?.content||"Conversation";
return txt.length>44?txt.slice(0,44)+"…":txt;
};
const relDate=(iso)=>{
const d=new Date(iso);const now=new Date();
const days=Math.floor((now-d)/86400000);
if(days===0)return"Today";if(days===1)return"Yesterday";
if(days<7)return`${days}d ago`;
return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
};
const saveMsg=(role,content,actions)=>{
if(!sessionIdRef.current)return;
fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({action:"save_message",sessionId:sessionIdRef.current,role,content,actions:actions||null})})
.catch(()=>{});
};
const newChat=()=>{
setHistory([]);setInsights({});
sessionIdRef.current=null;setActiveSessionId(null);
setTimeout(()=>inputRef.current?.focus(),100);
};
const loadSession=async(sess)=>{
setActiveSessionId(sess.id);
sessionIdRef.current=sess.id;
setInsights({});
const msgs=(sess.messages||[]).map(m=>({
id:m.id,role:m.role,content:m.content,
actions:Array.isArray(m.actions)?m.actions:m.actions?[]:m.actions||[],
suggestions:[],ts:new Date(m.ts).getTime(),
}));
setHistory(msgs);
setTimeout(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),80);
};
const copyEmail=(action)=>{
const text=`To: ${action.to_name} <${action.to_email||"(find email)"}>\nSubject: ${action.subject}\n\n${action.body}`;
try{navigator.clipboard.writeText(text);}catch{}
toast("Email copied to clipboard","success");
dispatch("LOG",{msg:`Agent drafted email to ${action.to_name}`});
};
const executeAction=async(action,msgIdx,actionIdx)=>{
if(action.type==="navigate"){setMod(action.target);return;}
if(action.type==="draft_email"){const key=`${msgIdx}_${actionIdx}`;setExpandedEmail(e=>e===key?null:key);return;}
if(action.type==="create_deal"){
const d={id:mkId(),name:action.name||action.org,school:action.org,value:parseFloat(action.value)||0,stage:action.stage||"Quoted",product:action.product||"",priority:"warm",createdAt:today(),followUpDate:"",notes:action.note||""};
dispatch("ADD_DEAL",d);toast(`Deal created: ${d.name}`,"success");
pushDealToZoho({dealName:d.name,amount:d.value,stage:d.stage,accountName:d.school}).then(dd=>{if(dd.dealId){dispatch("UPDATE_DEAL",{id:d.id,zohoId:dd.dealId});toast("✓ Created in Zoho CRM","success");}});
return;
}
if(action.type==="flag_deal"){
const d=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
if(d){dispatch("UPDATE_DEAL",{id:d.id,priority:action.priority||"hot"});toast(`${d.name} flagged as ${action.priority||"hot"}`,"success");}
return;
}
if(action.type==="schedule_followup"){
const d=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
if(d){dispatch("UPDATE_DEAL",{id:d.id,followUpDate:action.date,...(action.note?{notes:(d.notes?d.notes+"\n":"")+action.note}:{})});toast(`Follow-up set: ${action.date}`,"success");
crmAddNote("Deals",d.zohoId,`Follow-up: ${action.date}. ${action.note||""}`);}
return;
}
if(action.type==="log_note"){
const d=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((action.deal_name||"").toLowerCase()));
if(d){dispatch("UPDATE_DEAL",{id:d.id,notes:(d.notes?d.notes+"\n":"")+action.note});toast(`Note logged on ${d.name}`,"success");
crmAddNote("Deals",d.zohoId,action.note);}
return;
}
if(action.type==="add_contact"){
const c={id:mkId(),firstName:action.firstName||"",lastName:action.lastName||"",fullName:`${action.firstName||""} ${action.lastName||""}`.trim(),title:action.title||"",school:action.school||"",state:action.state||"",email:action.email||"",phone:action.phone||"",sport:action.sport||"",orgType:"school",priority:"medium",confidence:"medium",source:"agent",importedAt:Date.now()};
dispatch("ADD_CONTACTS",[c]);toast(`Contact added: ${c.fullName}`,"success");
// A new prospect from chat is engagement at most, not a sale — this goes to
// Zoho as a Lead, never a real Account-linked Contact. Contacts only get
// created later, when an actual quote/deal gets built for them (Edgar's
// "Create in Zoho" flow), and Account_Name as a bare string here wouldn't
// have linked to a real Account anyway (that field is a lookup, not text).
crmCreate("Leads",{First_Name:c.firstName,Last_Name:c.lastName,Email:c.email,Phone:c.phone,Designation:c.title,Company:c.school,Lead_Source:"ST1 RevOps",Lead_Status:"Working"}).then(()=>toast("✓ Synced to Zoho as a Lead","success")).catch(()=>{});
return;
}
if(action.type==="create_campaign"){dispatch("SET_PROSPECTING_NAV","campaigns");setMod("prospecting");toast("Switched to Campaigns","info");return;}
if(action.type==="create_quote"){const key=`${msgIdx}_${actionIdx}`;setExpandedQuote(e=>e===key?null:key);return;}
if(action.type==="create_campaign_sequence"){const key=`${msgIdx}_${actionIdx}`;setExpandedCampaign(e=>e===key?null:key);return;}
if(action.type==="edgar_quote"){const key=`${msgIdx}_${actionIdx}`;setExpandedEdgarQuote(e=>e===key?null:key);return;}
if(action.type==="brad_outreach"){const key=`${msgIdx}_${actionIdx}`;setExpandedBradOutreach(e=>e===key?null:key);return;}
if(action.type==="ledger_reconcile"){const key=`${msgIdx}_${actionIdx}`;setExpandedLedgerReconcile(e=>e===key?null:key);return;}
if(action.type==="ledger_vendor_bill"){const key=`${msgIdx}_${actionIdx}`;setExpandedLedgerBill(e=>e===key?null:key);return;}
};
const createQuoteNow=(action,key)=>sharedCreateQuoteNow(action,key,setSendingQuote);
const createEdgarQuoteInZoho=(action,key)=>sharedCreateEdgarQuoteInZoho(action,key,setSendingQuote);
const launchCampaignNow=async(action,key,matchedContacts)=>{
setLaunchingCampaign(key);
try{
const sendAt=campaignSendTime[key]||"";
const touches=(action.emails||[]).map((e,i)=>({id:mkId(),step:i,subject:e.subject,body:e.body,delay:e.delay_days||0,channel:"email"}));
const enrollments=matchedContacts.map(c=>({contactId:c.id,email:c.email,name:c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim(),status:"active",step:0,enrolledAt:Date.now()}));
const camp={
id:mkId(),
name:action.campaign_name,
product:action.product||"",
status:"active",
createdAt:new Date().toISOString().slice(0,10),
touches,
enrollments,
scheduledSendAt:sendAt||null,
notes:action.notes||"",
source:"agent",
};
dispatch("ADD_CAMPAIGN",camp);
dispatch("LOG",{msg:`Campaign "${camp.name}" created with ${enrollments.length} contacts via agent`});
toast(`✓ "${camp.name}" created — ${enrollments.length} contacts enrolled${sendAt?`, scheduled ${sendAt}`:""}. Go to Campaigns to send.`,"success");
setTimeout(()=>{dispatch("SET_PROSPECTING_NAV","campaigns");setMod("prospecting");},1200);
}catch(e){toast(`Campaign error: ${e.message}`,"error");}
setLaunchingCampaign(null);
};
const sendEmailNow=(action,key)=>sharedSendEmailNow(action,key,setSendingEmail,send);
const sendBradEmail=(draft,key)=>sharedSendBradEmail(draft,key,setSendingInstantly);
const send=async(overrideMsg)=>{
const msg=(overrideMsg||input).trim();
if(!msg||running)return;
setInput("");setRunning(true);setAgentStatus("thinking");
if(!sessionIdRef.current){
try{
const sr=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({action:"start_session",userId:cu?.id||null,userName:cu?.name||null,context:"home-agent"})});
const sd=await sr.json();
if(sd.sessionId){
sessionIdRef.current=sd.sessionId;
setActiveSessionId(sd.sessionId);
const stub={id:sd.sessionId,userId:cu?.id,userName:cu?.name,createdAt:new Date().toISOString(),messages:[]};
setSessions(prev=>[stub,...prev]);
}
}catch{}
}
const msgId=mkId();
const userEntry={id:msgId,role:"user",content:msg,ts:Date.now()};
const nextHistory=[...history,userEntry];
setHistory(nextHistory);
saveMsg("user",msg,null);
setSessions(prev=>prev.map(s=>s.id===sessionIdRef.current
?{...s,messages:[...(s.messages||[]),{id:msgId,role:"user",content:msg,ts:new Date().toISOString()}]}:s));
const apiMsgs=nextHistory.slice(-20).map(m=>({role:m.role==="user"?"user":"assistant",content:m.role==="user"?m.content:(m.raw||m.content||"")}));
const allContacts=s.contacts||[];
const scoredContacts=[...allContacts].filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,40);
const unscoredContacts=allContacts.filter(c=>!(c.score||0)).slice(0,20);
const localContext={
deals:(s.deals||[]).slice(0,60),
contacts:[...scoredContacts,...unscoredContacts],
rfps:(s.rfps||[]).slice(0,20),
invoices:(s.invoices||[]).slice(0,20),
sequences:(s.sequences||[]).slice(0,10).map(seq=>({
id:seq.id,name:seq.name,status:seq.status,
enrollmentCount:(seq.enrollments||[]).length,
activeCount:(seq.enrollments||[]).filter(e=>e.status==="active").length,
touches:(seq.touches||[]).map(t=>({subject:t.subject,day:t.day})),
})),
priceLists:(s.priceLists||[]).map(pl=>({
id:pl.id,
name:pl.name,
type:pl.type,
competitorName:pl.competitorName||"",
source:pl.source||"",
itemCount:(pl.items||[]).length,
items:(pl.items||[]).slice(0,50).map(it=>({name:it.name,sku:it.sku||"",category:it.category||"",unit:it.unit||"",cost:it.cost||0,price:it.price||0,map:it.map||0})),
})),
competeIntel:Object.entries(s.competeIntel||{}).slice(0,10).map(([name,text])=>({name,summary:(text||"").slice(0,400)})),
brandVoice:`ST1 owns 5 unoccupied brand positions: (1) WARM CONFIDENCE — approachable, teal/earth tone, zero competitors here; (2) ATHLETE IDENTITY — speak to the kid, not the admin; (3) HUMAN CONTACT — "Someone picks up the phone" — no one else claims this; (4) ALL-SPORT BREADTH — one contact, every sport your school runs; (5) EXCLUSIVE CULTURE — graphic tee drops as named collections (I Hit Dingers, Oppo Taco). VOICE: warm, direct, short sentences, athlete-aware. Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com. AVOID: "2-week turnaround", "no minimums", "lowest prices", "hope this finds you well", generic inspiration, social proof as personality, corporate we-language.`,
};
try{
const ctrl=new AbortController();
const timeout=setTimeout(()=>ctrl.abort(),90000);
let r;
try{
r=await fetch("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:apiMsgs,localContext}),signal:ctrl.signal});
}finally{clearTimeout(timeout);}
if(!r.ok){let errMsg=`HTTP ${r.status}`;try{const e=await r.json();errMsg=e.error||errMsg;}catch{}throw new Error(errMsg);}
const raw=await r.json();
const message=raw?.message||"Sorry, something went wrong.";
const actions=Array.isArray(raw?.actions)?raw.actions:[];
const suggestions=Array.isArray(raw?.suggestions)?raw.suggestions.slice(0,3):[];
const meta={liveZoho:!!raw.liveZoho,searchUsed:!!raw.searchUsed};
setLastMeta(meta);
const aId=mkId();
const assistantEntry={id:aId,role:"assistant",content:message,actions,suggestions,raw:message,meta,ts:Date.now()};
setHistory(h=>[...h,assistantEntry]);
saveMsg("assistant",message,actions.length?actions:null);
if(message.includes("🔥"))dispatch("ADD_ALERT",{msg:"Agent flagged high priority action",action:"Review in Home"});
dispatch("LOG",{msg:`${cu?.name||"User"} — agent: ${msg.slice(0,60)}`});
actions.forEach(a=>{
if(a.type==="schedule_followup"){
const d=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((a.deal_name||"").toLowerCase()));
if(d){dispatch("UPDATE_DEAL",{id:d.id,followUpDate:a.date,...(a.note?{notes:(d.notes?d.notes+"\n":"")+`${a.date}: ${a.note}`}:{})});toast(`📅 Auto: follow-up set ${a.date} — ${d.name}`,"info");
crmAddNote("Deals",d.zohoId,`Follow-up: ${a.date}. ${a.note||""}`);}
}
if(a.type==="log_note"){
const d=(s.deals||[]).find(d=>d.name?.toLowerCase().includes((a.deal_name||"").toLowerCase()));
if(d){dispatch("UPDATE_DEAL",{id:d.id,notes:(d.notes?d.notes+"\n":"")+`${today()}: ${a.note}`});toast(`📝 Auto: note logged — ${d.name}`,"info");
crmAddNote("Deals",d.zohoId,a.note);}
}
if(a.type==="store_competitor_intel"&&a.competitor_name&&a.intel){
dispatch("SET_COMPETE_INTEL",{[a.competitor_name]:a.intel});
toast(`⊗ Intel saved: ${a.competitor_name}`,"info");
}
});
if(cu?.id){
fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({action:"find_similar",query:msg,excludeUserId:cu.id,limit:2})})
.then(r=>r.json())
.then(d=>{if(d.matches?.length)setInsights(prev=>({...prev,[aId]:d.matches}));})
.catch(()=>{});
}
}catch(e){
setHistory(h=>[...h,{id:mkId(),role:"assistant",content:`Error: ${e.message}`,actions:[],suggestions:[],ts:Date.now()}]);
saveMsg("assistant",`Error: ${e.message}`,null);
}
setAgentStatus(null);setRunning(false);
setTimeout(()=>inputRef.current?.focus(),100);
};
const clearHistory=()=>{dispatch("SET_AGENT_HISTORY",[]);setInsights({});toast("Conversation cleared","info");};
const openDeals=useMemo(()=>(s.deals||[]).filter(d=>!["Closed Won","Closed Lost"].includes(d.stage)),[s.deals]);
const pipeline=useMemo(()=>openDeals.reduce((a,d)=>a+d.value,0),[openDeals]);
const overdueDeals=useMemo(()=>openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0).slice(0,4),[openDeals]);
const hotDeals=useMemo(()=>openDeals.filter(d=>d.priority==="hot").slice(0,3),[openDeals]);
const topContacts=useMemo(()=>(s.contacts||[]).filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4),[s.contacts]);
const openRfps=useMemo(()=>(s.rfps||[]).filter(r=>!["No Bid","Lost","Won"].includes(r.stage)).slice(0,3),[s.rfps]);
const ACTION_COLORS={create_deal:{c:B.orange,bg:B.orangeBg},flag_deal:{c:B.red,bg:B.redBg},schedule_followup:{c:B.blue,bg:B.blueBg},log_note:{c:B.teal,bg:B.tealBg},add_contact:{c:B.purple,bg:B.purpleBg},create_campaign:{c:B.blue,bg:B.blueBg},add_to_nurture:{c:B.green,bg:B.greenBg},create_quote:{c:B.blue,bg:B.blueBg},create_campaign_sequence:{c:B.purple,bg:B.purpleBg},store_competitor_intel:{c:B.orange,bg:B.orangeBg},edgar_quote:{c:B.teal,bg:B.tealBg},brad_outreach:{c:B.green,bg:B.greenBg},ledger_reconcile:{c:B.blue,bg:B.blueBg},ledger_invoice:{c:B.purple,bg:B.purpleBg},ledger_vendor_bill:{c:B.orange,bg:B.orangeBg},ledger_payments:{c:B.green,bg:B.greenBg}};
const ACTION_LABELS={create_deal:"◫ CREATE DEAL",flag_deal:"🔥 FLAG DEAL",schedule_followup:"📅 SET FOLLOW-UP",log_note:"📝 LOG NOTE",add_contact:"+ ADD LEAD",create_campaign:"✦ GO TO CAMPAIGNS",add_to_nurture:"✉ ADD TO NURTURE",navigate:"→ GO THERE",create_quote:"▤ CREATE QUOTE",create_campaign_sequence:"✦ LAUNCH CAMPAIGN",store_competitor_intel:"⊗ COMPETITOR INTEL SAVED",edgar_quote:"▤ EDGAR QUOTE",brad_outreach:"✉ BRAD DRAFTS",ledger_reconcile:"◎ RECONCILE",ledger_invoice:"◫ INVOICE",ledger_vendor_bill:"◉ VENDOR BILL",ledger_payments:"◎ PAYMENTS"};
const STARTERS=[
"Who should I call or email today?",
"Draft outreach for my highest-priority contact",
"Build a 3-email sequence for Baseball coaches in Iowa and enroll them",
"Build a quote for 10 hurdles and 2 starting blocks",
"Which deals are most at risk right now?",
"How do I counter BSN Sports on pricing?",
"Check overdue invoices — who hasn't paid?",
"Reconcile my latest deposits",
];
return(
<div style={{display:"flex",height:"100%",overflow:"hidden"}}>
{/* ── SESSIONS RAIL (left) ── */}
<div style={{width:220,background:B.surface,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>
<div style={{padding:"12px 12px 10px",borderBottom:`1px solid ${B.border}`,flexShrink:0}}>
<button onClick={newChat} style={{width:"100%",background:B.orange,color:"#fff",border:"none",borderRadius:6,padding:"8px 0",fontSize:11,fontWeight:700,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:"pointer"}}>+ NEW CHAT</button>
</div>
<div style={{padding:"8px 8px 4px",flexShrink:0}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,padding:"0 4px"}}>CHAT HISTORY</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"0 8px 8px"}}>
{sessionsLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px 4px"}}>Loading…</div>}
{!sessionsLoading&&sessions.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px 4px",lineHeight:1.5}}>Your conversations will appear here.</div>}
{sessions.map(sess=>{
const isActive=sess.id===activeSessionId;
const title=sessionTitle(sess);
const msgCount=(sess.messages||[]).filter(m=>m.role==="user").length;
return(
<button key={sess.id} onClick={()=>loadSession(sess)}
style={{width:"100%",textAlign:"left",background:isActive?B.orangeBg:"transparent",border:`1px solid ${isActive?B.orange:B.border}`,borderRadius:6,padding:"8px 9px",marginBottom:4,cursor:"pointer",display:"block"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:isActive?600:400,color:isActive?B.orange:B.text,lineHeight:1.35,marginBottom:3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{title}</div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{relDate(sess.createdAt)}</span>
{msgCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>{msgCount}q</span>}
</div>
</button>
);
})}
</div>
</div>
{/* ── CHAT ── */}
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
{/* Header */}
<div style={{padding:"11px 18px 9px",borderBottom:`1px solid ${B.border}`,background:B.white,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.black,letterSpacing:.3}}>RevOps Agent</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Full context · chats saved per user · team insights surfaced</div>
</div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
{lastMeta?.liveZoho&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 7px",borderRadius:10,letterSpacing:.5}}>● LIVE ZOHO</span>}
{lastMeta?.searchUsed&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 7px",borderRadius:10,letterSpacing:.5}}>🔍 WEB</span>}
{history.length>0&&<GBtn onClick={clearHistory} style={{fontSize:9,padding:"3px 9px"}}>CLEAR</GBtn>}
</div>
</div>
{/* Messages */}
<div style={{flex:1,overflowY:"auto",padding:"18px 20px 8px",display:"flex",flexDirection:"column",gap:12}}>
{history.length===0&&(
<div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",paddingTop:16}}>
<div style={{textAlign:"center",marginBottom:18}}>
{(()=>{const h=new Date().getHours();const gr=h<12?"Good morning":h<17?"Good afternoon":"Good evening";const nm=cu?.name?.split(" ")[0]||"there";return<div style={{fontFamily:"'Lexend',sans-serif",fontSize:14,color:B.muted}}>{gr}, {nm}. What do you need?</div>;})()}
</div>
<button onClick={()=>setMod("edgar")} style={{display:"block",width:"100%",maxWidth:500,margin:"0 auto 10px",background:B.tealBg,border:`1px solid ${B.teal}59`,borderRadius:8,padding:"10px 14px",cursor:"pointer",textAlign:"left"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:16,color:B.teal}}>▤</span>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.teal,letterSpacing:.3}}>Edgar – Quote Engine</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>Build a detailed quote with GM margins and MAP guardrails</div>
</div>
<span style={{marginLeft:"auto",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,flexShrink:0}}>OPEN →</span>
</div>
</button>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxWidth:500,margin:"0 auto",width:"100%"}}>
{STARTERS.map(st=>(
<button key={st} onClick={()=>send(st)} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:6,padding:"9px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,textAlign:"left",cursor:"pointer",lineHeight:1.5}}>{st}</button>
))}
</div>
</div>
)}
{history.map((m,msgIdx)=>(
<div key={m.id||msgIdx} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
<div style={{maxWidth:"88%",padding:"10px 14px",borderRadius:8,fontFamily:"'Lexend',sans-serif",fontSize:13,lineHeight:1.75,background:m.role==="user"?B.orange:B.surface,color:m.role==="user"?B.white:B.text,border:m.role==="assistant"?`1px solid ${B.border}`:"none",whiteSpace:"pre-wrap"}}>{m.content}</div>
{/* Action buttons */}
{m.actions?.length>0&&(
<div style={{display:"flex",flexDirection:"column",gap:5,marginTop:6,maxWidth:"88%",width:"88%"}}>
{m.actions.map((a,ai)=>{
if(a.type==="draft_email"){
const key=`${msgIdx}_${ai}`;const expanded=expandedEmail===key;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.green}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.greenBg,borderBottom:expanded?`1px solid ${B.green}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>✉</span>
<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:600}}>{a.to_name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{a.subject}</div></div>
</div>
<div style={{display:"flex",gap:5,flexShrink:0}}>
{a.to_email&&<button onClick={()=>sendEmailNow(a,`${msgIdx}_${ai}`)} disabled={sendingEmail===`${msgIdx}_${ai}`} style={{background:B.green,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingEmail===`${msgIdx}_${ai}`?.6:1}}>{sendingEmail===`${msgIdx}_${ai}`?"SENDING...":"✉ SEND NOW"}</button>}
<button onClick={()=>copyEmail(a)} style={{background:"none",border:`1px solid ${B.green}50`,color:B.green,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>📋 COPY</button>
<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
</div>
</div>
{expanded&&<div style={{padding:"10px 12px"}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>To: {a.to_name}{a.to_email?` <${a.to_email}>`:" — (find email)"}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.65}}>{a.body}</div></div>}
</div>
);
}
if(a.type==="create_quote"){
const key=`${msgIdx}_${ai}`;const expanded=expandedQuote===key;
const lineItems=a.line_items||[];
const total=lineItems.reduce((sum,li)=>sum+(Number(li.rate)||0)*(Number(li.quantity)||1),0);
const approved=approvedQuotes[key];
const draft=quoteEmailDrafts[key];
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.blue}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.blueBg,borderBottom:expanded?`1px solid ${B.blue}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>▤</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,fontWeight:600}}>{a.customer_name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{lineItems.length} item{lineItems.length!==1?"s":""} · ${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
</div>
</div>
<div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
{approved
?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green,background:B.greenBg,padding:"3px 9px",borderRadius:4,letterSpacing:.3}}>✓ APPROVED — {approved.quoteNumber}</span>
:<button onClick={()=>createQuoteNow(a,key)} disabled={sendingQuote===key} style={{background:B.blue,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingQuote===key?.6:1}}>{sendingQuote===key?"APPROVING...":"✓ APPROVE"}</button>}
<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
</div>
</div>
{expanded&&(
<div style={{padding:"10px 12px"}}>
{a.contact_person&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:4}}>Contact: {a.contact_person}{a.email?` · ${a.email}`:""}</div>}
<table style={{width:"100%",borderCollapse:"collapse",marginBottom:6}}>
<thead>
<tr style={{borderBottom:`1px solid ${B.border}`}}>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 0",fontWeight:700}}>ITEM</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>QTY</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>RATE</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>TOTAL</th>
</tr>
</thead>
<tbody>
{lineItems.map((li,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}20`}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"5px 0",paddingRight:8}}>{li.name}{li.description?<span style={{color:B.muted,display:"block",fontSize:9}}>{li.description}</span>:null}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"5px 0"}}>{li.quantity}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"5px 0"}}>${Number(li.rate).toFixed(2)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"5px 0",fontWeight:600}}>${(Number(li.rate)*Number(li.quantity)).toFixed(2)}</td>
</tr>
))}
</tbody>
<tfoot>
<tr>
<td colSpan={3} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,textAlign:"right",paddingTop:6,letterSpacing:.5,fontWeight:700}}>TOTAL</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.blue,textAlign:"right",paddingTop:6,fontWeight:700}}>${total.toFixed(2)}</td>
</tr>
</tfoot>
</table>
{a.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,fontStyle:"italic"}}>{a.notes}</div>}
{a.send_email&&a.email&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,marginTop:4,letterSpacing:.3}}>✉ Quote will be emailed to {a.email}</div>}
{!approved&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:6,fontStyle:"italic"}}>Ask Edgar to adjust anything — quantities, pricing, items — then click Approve when it's ready.</div>}
</div>
)}
{approved&&(
<div style={{padding:"10px 12px",borderTop:`1px solid ${B.blue}20`}}>
<div style={{display:"flex",gap:6,marginBottom:draft?.sent?0:8}}>
<button onClick={()=>downloadQuotePdf(key)} style={{background:"none",border:`1px solid ${B.blue}50`,color:B.blue,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>⬇ DOWNLOAD PDF</button>
{approved.reviewUrl&&<a href={approved.reviewUrl} target="_blank" rel="noreferrer" style={{background:"none",border:`1px solid ${B.blue}50`,color:B.blue,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,textDecoration:"none",letterSpacing:.3}}>OPEN IN ZOHO →</a>}
</div>
{draft?.sent
?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>✓ Emailed to {draft.to}</div>
:draft&&(
<div style={{display:"flex",flexDirection:"column",gap:5}}>
<input value={draft.to} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,[key]:{...prev[key],to:e.target.value}}))} placeholder="To" style={{fontFamily:"'Lexend',sans-serif",fontSize:11,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 8px",color:B.text}}/>
<input value={draft.subject} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,[key]:{...prev[key],subject:e.target.value}}))} placeholder="Subject" style={{fontFamily:"'Lexend',sans-serif",fontSize:11,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 8px",color:B.text}}/>
<textarea rows={4} value={draft.body} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,[key]:{...prev[key],body:e.target.value}}))} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 8px",color:B.text,resize:"vertical"}}/>
<button onClick={()=>sendQuoteEmail(key)} disabled={sendingQuoteEmail===key||!draft.to} style={{alignSelf:"flex-start",background:B.green,border:"none",color:B.white,borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingQuoteEmail===key?.6:1}}>{sendingQuoteEmail===key?"SENDING...":"📧 SEND EMAIL"}</button>
</div>
)}
</div>
)}
</div>
);
}
if(a.type==="create_campaign_sequence"){
const key=`${msgIdx}_${ai}`;const expanded=expandedCampaign===key;
const filters=a.contact_filters||{};
const matched=(s.contacts||[]).filter(c=>{
if(c.deadStatus||!c.email) return false;
const sport=(c.sport||"").toLowerCase();
const state=(c.state||"").toLowerCase();
const title=(c.title||"").toLowerCase();
const score=c.score||0;
if(filters.sports?.length&&!filters.sports.some(sp=>sport.includes(sp.toLowerCase()))) return false;
if(filters.states?.length&&!filters.states.some(st=>state===st.toLowerCase()||state.includes(st.toLowerCase()))) return false;
if(filters.titles?.length&&!filters.titles.some(t=>title.includes(t.toLowerCase()))) return false;
if(filters.min_score&&score<filters.min_score) return false;
return true;
});
const emails=a.emails||[];
const ck=key;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.purple}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.purpleBg,borderBottom:expanded?`1px solid ${B.purple}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>✦</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,fontWeight:600}}>{a.campaign_name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{emails.length} emails · {matched.length} contacts matched</div>
</div>
</div>
<div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
<input type="datetime-local" value={campaignSendTime[ck]||""} onChange={e=>setCampaignSendTime(prev=>({...prev,[ck]:e.target.value}))}
style={{fontSize:9,fontFamily:"'Lexend',sans-serif",border:`1px solid ${B.border}`,borderRadius:4,padding:"2px 5px",color:B.text,background:B.white}}/>
<button onClick={()=>{if(!matched.length){toast("No contacts match these filters","error");return;}launchCampaignNow(a,ck,matched);}} disabled={launchingCampaign===ck} style={{background:B.purple,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:launchingCampaign===ck?.6:1,whiteSpace:"nowrap"}}>{launchingCampaign===ck?"CREATING...":"✦ CREATE & ENROLL"}</button>
<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
</div>
</div>
{expanded&&(
<div style={{padding:"10px 12px"}}>
{/* Contact filters summary */}
<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
{filters.sports?.map(sp=><span key={sp} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.purple,background:B.purpleBg,padding:"2px 7px",borderRadius:10,letterSpacing:.3}}>{sp}</span>)}
{filters.states?.map(st=><span key={st} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 7px",borderRadius:10,letterSpacing:.3}}>{st}</span>)}
{filters.titles?.map(t=><span key={t} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.teal,background:B.tealBg,padding:"2px 7px",borderRadius:10,letterSpacing:.3}}>{t}</span>)}
{filters.min_score&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:B.orangeBg,padding:"2px 7px",borderRadius:10,letterSpacing:.3}}>score ≥ {filters.min_score}</span>}
</div>
{/* Matched contacts */}
<div style={{marginBottom:10}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:5}}>{matched.length} CONTACTS MATCHED</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4}}>
{matched.slice(0,12).map(c=>(
<div key={c.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"2px 7px"}}>
{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}
{c.school&&<span style={{color:B.muted}}> · {typeof c.school==="string"?c.school:c.school?.name||""}</span>}
</div>
))}
{matched.length>12&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"2px 7px"}}>+{matched.length-12} more</div>}
</div>
{matched.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>No contacts match — adjust filters or add contacts first.</div>}
</div>
{/* Email sequence */}
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:6}}>EMAIL SEQUENCE</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{emails.map((e,i)=>(
<div key={i} style={{border:`1px solid ${B.border}`,borderRadius:5,overflow:"hidden"}}>
<div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:B.surface,borderBottom:`1px solid ${B.border}`}}>
<div style={{width:18,height:18,borderRadius:"50%",background:B.purple,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:8,color:B.white}}>{i+1}</span></div>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:600,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subject}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{i===0?"Send immediately":`+${e.delay_days} day${e.delay_days!==1?"s":""} after previous`}</div>
</div>
</div>
<div style={{padding:"8px 10px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.6,maxHeight:120,overflow:"hidden"}}>{e.body}</div>
</div>
))}
</div>
{a.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,fontStyle:"italic",marginTop:8}}>{a.notes}</div>}
</div>
)}
</div>
);
}
if(a.type==="edgar_quote"){
const key=`${msgIdx}_${ai}`;const expanded=expandedEdgarQuote===key;
const q=a.quote||{};const items=(q.lineItems||[]);const warns=a.warnings||q.warnings||[];
const revenue=q.totalRevenue||items.reduce((s,i)=>s+(Number(i.quotedPrice)||0)*(Number(i.qty)||1),0);
const gm=q.overallGmPct!=null?q.overallGmPct:null;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.teal}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.tealBg,borderBottom:expanded?`1px solid ${B.teal}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>▤</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.teal,fontWeight:600}}>{q.customer||a.customer||"Quote"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{items.length} item{items.length!==1?"s":""} · ${Number(revenue).toFixed(2)}{gm!=null?` · ${gm}% GM`:""}{warns.length>0?` · ${warns.length} warning${warns.length!==1?"s":""}`:""}</div>
</div>
</div>
<div style={{display:"flex",gap:5,flexShrink:0}}>
<button onClick={()=>createEdgarQuoteInZoho(a,key)} disabled={sendingQuote===key} style={{background:B.teal,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingQuote===key?.6:1}}>{sendingQuote===key?"CREATING...":"▤ CREATE IN ZOHO"}</button>
<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
</div>
</div>
{expanded&&(
<div style={{padding:"10px 12px"}}>
{warns.length>0&&<div style={{background:B.yellowBg,border:`1px solid ${B.yellow}30`,borderRadius:4,padding:"6px 10px",marginBottom:8}}>{warns.map((w,wi)=><div key={wi} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.yellow}}>⚠ {w}</div>)}</div>}
<table style={{width:"100%",borderCollapse:"collapse",marginBottom:6}}>
<thead><tr style={{borderBottom:`1px solid ${B.border}`}}>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 0",fontWeight:700}}>ITEM</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>QTY</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>COST</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>QUOTED</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>GM%</th>
</tr></thead>
<tbody>
{items.map((li,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}20`,opacity:li.notFound?.5:1}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"5px 0",paddingRight:8}}>
{li.name}{li.mapFlag&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:B.yellowBg,borderRadius:2,padding:"1px 4px",marginLeft:5,letterSpacing:.3}}>MAP</span>}
{li.notFound&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.red,marginLeft:5}}>NOT FOUND</span>}
</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"5px 0"}}>{li.qty||1}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"right",padding:"5px 0"}}>{li.cost?`$${Number(li.cost).toFixed(2)}`:"—"}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.teal,textAlign:"right",padding:"5px 0",fontWeight:600}}>{li.notFound?"—":`$${Number(li.quotedPrice||0).toFixed(2)}`}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:li.gmPct>=20?B.green:B.yellow,textAlign:"right",padding:"5px 0"}}>{li.gmPct!=null?`${li.gmPct}%`:"—"}</td>
</tr>
))}
</tbody>
<tfoot><tr>
<td colSpan={3} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.teal,textAlign:"right",paddingTop:6,letterSpacing:.5,fontWeight:700}}>TOTAL</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.teal,textAlign:"right",paddingTop:6,fontWeight:700}}>${Number(revenue).toFixed(2)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:gm>=20?B.green:B.yellow,textAlign:"right",paddingTop:6,fontWeight:600}}>{gm!=null?`${gm}%`:""}</td>
</tr></tfoot>
</table>
</div>
)}
</div>
);
}
if(a.type==="brad_outreach"){
const key=`${msgIdx}_${ai}`;const expanded=expandedBradOutreach===key;
const drafts=a.drafts||[];const skipped=a.skipped||[];
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.green}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.greenBg,borderBottom:expanded?`1px solid ${B.green}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>✉</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:600}}>Brad Outreach — {drafts.length} draft{drafts.length!==1?"s":""} ready</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{skipped.length>0?`${skipped.length} skipped (DNC / re-touch / cap)`:"All contacts cleared"} · requires approval</div>
</div>
</div>
<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>
</div>
{expanded&&(
<div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
{drafts.map((d,di)=>{
const dKey=`b${msgIdx}_${ai}_${di}`;const dExpanded=expandedEmail===dKey;
const emailAction={to_name:d.contactName,to_email:d.contactEmail,subject:d.subject,body:d.body};
return(
<div key={di} style={{border:`1px solid ${B.border}`,borderRadius:5,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",background:B.surface,borderBottom:dExpanded?`1px solid ${B.border}`:"none"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:600,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.contactName}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.subject}</div>
</div>
<div style={{display:"flex",gap:5,flexShrink:0,marginLeft:8}}>
{d.contactEmail&&<button onClick={()=>sendBradEmail(d,dKey)} disabled={sendingInstantly===dKey} style={{background:B.green,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingInstantly===dKey?.6:1}}>{sendingInstantly===dKey?"SENDING...":"✉ SEND"}</button>}
<button onClick={()=>copyEmail(emailAction)} style={{background:"none",border:`1px solid ${B.green}50`,color:B.green,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>📋</button>
<button onClick={()=>setExpandedEmail(e=>e===dKey?null:dKey)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{dExpanded?"▲":"▼"}</button>
</div>
</div>
{dExpanded&&<div style={{padding:"8px 10px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,whiteSpace:"pre-wrap",lineHeight:1.65}}>{d.body}</div>}
{d.notes&&!dExpanded&&<div style={{padding:"2px 10px 6px",fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,fontStyle:"italic"}}>{d.notes}</div>}
</div>
);
})}
{skipped.length>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,paddingTop:4}}>Skipped: {[...new Set(skipped.map(s=>s.blockedBy))].join(", ")}</div>}
</div>
)}
</div>
);
}
if(a.type==="ledger_reconcile"){
const key=`${msgIdx}_${ai}`;const expanded=expandedLedgerReconcile===key;
const meta=a.result?.metadata||{};const totals=meta.totals||{};
const txns=meta.transactions||[];const dryMode=a.dryRun||meta.dryRun;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.blue}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.blueBg,borderBottom:expanded?`1px solid ${B.blue}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>◎</span>
<div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,fontWeight:600}}>Reconcile — {totals.polled??0} polled</span>
{dryMode&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:B.yellowBg,borderRadius:2,padding:"1px 5px",letterSpacing:.3}}>DRY RUN</span>}
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>{totals.withSuggestion??0} coded · {totals.pending??0} pending review{(totals.duplicates||0)>0?` · ${totals.duplicates} dup`:""}</div>
</div>
</div>
{txns.length>0&&<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>}
</div>
{expanded&&txns.length>0&&(
<div style={{padding:"10px 12px",overflowX:"auto"}}>
<table style={{width:"100%",borderCollapse:"collapse",minWidth:480}}>
<thead><tr style={{borderBottom:`1px solid ${B.border}`}}>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 0",fontWeight:700}}>DATE</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 6px",fontWeight:700}}>DESCRIPTION</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>AMOUNT</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 6px",fontWeight:700}}>MATCH</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 0",fontWeight:700}}>STATUS</th>
</tr></thead>
<tbody>
{txns.map((t,ti)=>{
const sc={APPROVED:B.green,PENDING_REVIEW:t.suggestedLabel?B.teal:B.yellow,DUPLICATE:B.muted,REVERSED:B.red}[t.status]||B.muted;
return(
<tr key={ti} style={{borderBottom:`1px solid ${B.border}20`}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"5px 0",whiteSpace:"nowrap"}}>{t.date||"—"}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"5px 6px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.extractedName||t.description||"—"}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,textAlign:"right",padding:"5px 0",whiteSpace:"nowrap",fontWeight:600}}>${Number(t.amount||0).toFixed(2)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"5px 6px",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.match||"—"}</td>
<td style={{padding:"5px 0"}}><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sc,background:`${sc}18`,borderRadius:2,padding:"2px 5px",letterSpacing:.3,whiteSpace:"nowrap"}}>{t.status}</span></td>
</tr>
);
})}
</tbody>
</table>
</div>
)}
</div>
);
}
if(a.type==="ledger_invoice"){
const ikey=`${msgIdx}_${ai}`;
const meta=a.result?.metadata||{};
const preview=meta.preview||{};
const created=invoiceCreated[ikey]||null;
const customerName=created?.customerName||preview.customerName||meta.customerName||a.crmDealName||"Invoice";
const lineItems=preview.lineItems||[];
const total=created?.total||preview.total||meta.total||0;
const dueDate=created?.dueDate||preview.dueDate||meta.dueDate||"";
const poNumber=preview.poNumber||meta.poNumber||"";
const zohoId=created?.zohoInvoiceId||meta.zohoInvoiceId||"";
const dealInvoiceId=created?.dealInvoiceId||meta.dealInvoiceId||"";
const invStatus=created?.status||meta.status||"PREVIEW";
const reviewUrl=created?.reviewUrl||meta.reviewUrl||"";
const creatingKey=invoiceCreated[ikey+"_creating"];
const sendingKey=invoiceCreated[ikey+"_sending"];
const sendDone=created?.status==="SENT";
const createDraft=async()=>{
setInvoiceCreated(p=>({...p,[ikey+"_creating"]:true}));
try{
const r=await fetch("/api/agents/ledger/invoice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"draft",crmDealId:meta.crmDealId,crmDealName:customerName,dryRun:false})});
const d=await r.json();
if(d.ok){setInvoiceCreated(p=>({...p,[ikey]:d}));toast(`Invoice ${d.invoiceNumber||d.zohoInvoiceId} created as draft`,"success");}
else toast(d.error||"Draft creation failed","error");
}catch(e){toast(e.message,"error");}
setInvoiceCreated(p=>({...p,[ikey+"_creating"]:false}));
};
const sendInvoice=async()=>{
if(!dealInvoiceId){toast("No local invoice ID — create draft first","error");return;}
setInvoiceCreated(p=>({...p,[ikey+"_sending"]:true}));
try{
const r=await fetch("/api/agents/ledger/invoice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm",dealInvoiceId})});
const d=await r.json();
if(d.ok){setInvoiceCreated(p=>({...p,[ikey]:{...created,...d}}));toast("Invoice sent to customer","success");}
else toast(d.error||"Send failed","error");
}catch(e){toast(e.message,"error");}
setInvoiceCreated(p=>({...p,[ikey+"_sending"]:false}));
};
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.purple}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.purpleBg}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>◫</span>
<div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,fontWeight:600}}>{customerName}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sendDone?B.green:invStatus==="DRAFT"?B.teal:B.yellow,background:sendDone?B.greenBg:invStatus==="DRAFT"?B.tealBg:B.yellowBg,borderRadius:2,padding:"1px 5px",letterSpacing:.3}}>{sendDone?"SENT":invStatus}</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>${Number(total).toFixed(2)}{dueDate?` · Net 30 (${dueDate})`:""}{ poNumber?` · PO: ${poNumber}`:""}</div>
</div>
</div>
<div style={{display:"flex",gap:5,flexShrink:0}}>
{reviewUrl&&<a href={reviewUrl} target="_blank" rel="noreferrer" style={{background:"none",border:`1px solid ${B.purple}40`,color:B.purple,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,textDecoration:"none"}}>VIEW →</a>}
{!zohoId&&<button onClick={createDraft} disabled={!!creatingKey} style={{background:B.purple,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:creatingKey?.6:1}}>{creatingKey?"CREATING...":"◫ CREATE DRAFT"}</button>}
{zohoId&&!sendDone&&<button onClick={sendInvoice} disabled={!!sendingKey} style={{background:B.green,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingKey?.6:1}}>{sendingKey?"SENDING...":"✉ SEND"}</button>}
</div>
</div>
{lineItems.length>0&&(
<div style={{padding:"8px 12px 10px"}}>
<table style={{width:"100%",borderCollapse:"collapse"}}>
<thead><tr style={{borderBottom:`1px solid ${B.border}`}}>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"3px 0",fontWeight:700}}>ITEM</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"3px 0",fontWeight:700}}>QTY</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"3px 0",fontWeight:700}}>RATE</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"3px 0",fontWeight:700}}>AMOUNT</th>
</tr></thead>
<tbody>
{lineItems.map((li,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}20`}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"4px 0",paddingRight:8}}>{li.name}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"4px 0"}}>{li.quantity||li.qty||1}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"right",padding:"4px 0"}}>${Number(li.rate||li.quotedPrice||0).toFixed(2)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple,textAlign:"right",padding:"4px 0",fontWeight:600}}>${(Number(li.rate||li.quotedPrice||0)*Number(li.quantity||li.qty||1)).toFixed(2)}</td>
</tr>
))}
</tbody>
<tfoot><tr>
<td colSpan={3} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,textAlign:"right",paddingTop:6,letterSpacing:.5,fontWeight:700}}>TOTAL</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.purple,textAlign:"right",paddingTop:6,fontWeight:700}}>${Number(total).toFixed(2)}</td>
</tr></tfoot>
</table>
</div>
)}
</div>
);
}
if(a.type==="ledger_vendor_bill"){
const bkey=`${msgIdx}_${ai}`;
const expanded=expandedLedgerBill===bkey;
const meta=a.result?.metadata||{};
const bill=meta.bill||{};
const lineItems=bill.lineItems||meta.lineItems||[];
const created=billCreated[bkey];
const hasPdf=Boolean(billPdfStore[bkey]);
const createBill=async()=>{
  const pdf=billPdfStore[bkey];
  if(!pdf){toast("Upload a PDF first","error");return;}
  setBillCreated(p=>({...p,[bkey+"_creating"]:true}));
  try{
    const r=await fetch("/api/agents/ledger/vendor-bill",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",pdfBase64:pdf,pdfName:billPdfStore[bkey+"_name"]||"vendor-invoice.pdf",dryRun:false})});
    const d=await r.json();
    if(d.ok){setBillCreated(p=>({...p,[bkey]:d}));toast(`Bill ${d.billNumber||d.zohoBillId} created`,"success");}
    else toast(d.error||"Bill creation failed","error");
  }catch(e){toast(e.message,"error");}
  setBillCreated(p=>({...p,[bkey+"_creating"]:false}));
};
const onFileChange=async(e)=>{
  const file=e.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const b64=ev.target.result.split(",")[1];
    setBillPdfStore(p=>({...p,[bkey]:b64,[bkey+"_name"]:file.name}));
    toast("PDF loaded — review extraction and click CREATE BILL","success");
  };
  reader.readAsDataURL(file);
};
const isDone=created?.ok&&created?.vendorBillId;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.orange}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:B.orangeBg,borderBottom:expanded||lineItems.length>0?`1px solid ${B.orange}20`:"none"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>◉</span>
<div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,fontWeight:600}}>{bill.supplierName||meta.supplierName||"Vendor Bill"}</span>
{meta.dryRun&&!isDone&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:`${B.yellow}20`,padding:"2px 5px",borderRadius:3,letterSpacing:.4}}>PREVIEW</span>}
{isDone&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"2px 5px",borderRadius:3,letterSpacing:.4}}>CREATED</span>}
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.3}}>
{bill.vendorInvoiceNo?`Inv ${bill.vendorInvoiceNo}`:""}
{bill.poNumber?` · PO: ${bill.poNumber}`:""}
{bill.totalAmount?` · $${Number(bill.totalAmount).toFixed(2)}`:""}
{lineItems.length>0?` · ${lineItems.length} item${lineItems.length!==1?"s":""}, ${bill.reviewCount||0} need review`:""}
</div>
</div>
</div>
<div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
{isDone&&created.reviewUrl&&<a href={created.reviewUrl} target="_blank" rel="noreferrer" style={{background:"none",border:`1px solid ${B.orange}40`,color:B.orange,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,textDecoration:"none"}}>VIEW →</a>}
{!isDone&&(
<>
<label style={{background:"none",border:`1px solid ${hasPdf?B.green:B.border}`,color:hasPdf?B.green:B.muted,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>
{hasPdf?"PDF ✓":"UPLOAD PDF"}
<input type="file" accept="application/pdf" style={{display:"none"}} onChange={onFileChange}/>
</label>
{hasPdf&&<button onClick={createBill} disabled={!!billCreated[bkey+"_creating"]} style={{background:B.orange,border:"none",color:B.white,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:billCreated[bkey+"_creating"]?.6:1}}>{billCreated[bkey+"_creating"]?"CREATING...":"◉ CREATE BILL"}</button>}
</>
)}
{lineItems.length>0&&<button onClick={()=>executeAction(a,msgIdx,ai)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 7px",fontSize:10,cursor:"pointer"}}>{expanded?"▲":"▼"}</button>}
</div>
</div>
{expanded&&lineItems.length>0&&(
<div style={{padding:"10px 12px"}}>
<table style={{width:"100%",borderCollapse:"collapse"}}>
<thead><tr style={{borderBottom:`1px solid ${B.border}`}}>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"left",padding:"4px 0",fontWeight:700}}>DESCRIPTION</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>QTY</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>UNIT COST</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>TOTAL</th>
<th style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,textAlign:"right",padding:"4px 0",fontWeight:700}}>COGS</th>
</tr></thead>
<tbody>
{lineItems.map((li,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}20`,opacity:li.needsReview?.7:1}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"5px 0",paddingRight:8}}>
{li.rawDescription||li.description}
{li.needsReview&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,marginLeft:5}}>REVIEW</span>}
{li.matchedItemName&&li.matchedItemName!==li.rawDescription&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginLeft:5}}>→ {li.matchedItemName}</span>}
</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",padding:"5px 0"}}>{li.quantity}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"right",padding:"5px 0"}}>${Number(li.unitCost||0).toFixed(2)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,textAlign:"right",padding:"5px 0",fontWeight:600}}>${Number((li.quantity||0)*(li.unitCost||0)).toFixed(2)}</td>
<td style={{textAlign:"right",padding:"5px 0"}}>
{li.cogsAccountId?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.teal,background:B.tealBg,padding:"2px 4px",borderRadius:3}}>MAPPED</span>:<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:`${B.yellow}15`,padding:"2px 4px",borderRadius:3}}>UNMAP</span>}
</td>
</tr>
))}
</tbody>
</table>
</div>
)}
</div>
);
}
if(a.type==="ledger_payments"){
const meta=a.result?.metadata||{};const totals=meta.totals||{};
const overdue=meta.overdue||[];const upcoming=meta.upcoming||[];const changes=meta.changes||[];
const fmt$=n=>`$${Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
return(
<div key={ai} style={{background:B.white,border:`1px solid ${B.green}50`,borderRadius:6,overflow:"hidden"}}>
<div style={{padding:"8px 12px",background:B.greenBg,borderBottom:`1px solid ${B.green}20`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>◎</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:600}}>Payment Tracker</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
{totals.checked??0} checked · {totals.updated??0} updated · {totals.overdue??0} overdue · {totals.upcoming??0} upcoming{totals.paid>0?` · ${totals.paid} paid`:""}
</div>
</div>
</div>
{meta.dryRun&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:`${B.yellow}20`,padding:"2px 6px",borderRadius:3,letterSpacing:.5}}>DRY RUN</span>}
</div>
{overdue.length>0&&(
<div style={{padding:"8px 12px",borderBottom:`1px solid ${B.border}20`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,letterSpacing:.5,marginBottom:5}}>OVERDUE</div>
{overdue.map((inv,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<overdue.length-1?`1px solid ${B.border}15`:"none"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{inv.crmDealName||"Unknown"}</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,fontWeight:600}}>{fmt$(inv.amountTotal)}</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.dueDate}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.red,background:`${B.red}15`,padding:"2px 5px",borderRadius:3}}>{Math.abs(inv.daysFromNow||0)}d OVERDUE</span>
</div>
</div>
))}
</div>
)}
{upcoming.length>0&&(
<div style={{padding:"8px 12px",borderBottom:changes.length>0?`1px solid ${B.border}20`:"none"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.yellow,letterSpacing:.5,marginBottom:5}}>DUE SOON</div>
{upcoming.map((inv,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<upcoming.length-1?`1px solid ${B.border}15`:"none"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{inv.crmDealName||"Unknown"}</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:600}}>{fmt$(inv.amountTotal)}</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.dueDate}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.yellow,background:`${B.yellow}15`,padding:"2px 5px",borderRadius:3}}>{inv.daysFromNow}d</span>
</div>
</div>
))}
</div>
)}
{changes.length>0&&(
<div style={{padding:"8px 12px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:.5,marginBottom:5}}>STATUS CHANGES</div>
{changes.map((c,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:i<changes.length-1?`1px solid ${B.border}15`:"none"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{c.crmDealName||"Unknown"}</div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,background:`${B.surface}`,padding:"2px 5px",borderRadius:3}}>{c.from}</span>
<span style={{color:B.muted,fontSize:9}}>→</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:c.to==="PAID"?B.green:c.to==="OVERDUE"?B.red:B.yellow,background:c.to==="PAID"?`${B.green}15`:c.to==="OVERDUE"?`${B.red}15`:`${B.yellow}15`,padding:"2px 5px",borderRadius:3}}>{c.to}</span>
</div>
</div>
))}
</div>
)}
</div>
);
}
if(a.type==="store_competitor_intel"){
return(
<div key={ai} style={{background:`${B.orange}08`,border:`1px solid ${B.orange}30`,borderRadius:5,padding:"6px 11px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div style={{display:"flex",gap:7,alignItems:"center"}}>
<span style={{fontSize:13,color:B.orange}}>⊗</span>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5}}>COMPETITOR INTEL SAVED</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{a.competitor_name}</div>
</div>
</div>
<button onClick={()=>setMod("compete")} style={{background:"none",border:`1px solid ${B.orange}40`,color:B.orange,borderRadius:4,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>VIEW →</button>
</div>
);
}
const col=ACTION_COLORS[a.type]||{c:B.muted,bg:B.surface};
return(
<button key={ai} onClick={()=>executeAction(a,msgIdx,ai)} style={{background:col.bg,color:col.c,border:`1px solid ${col.c}40`,borderRadius:5,padding:"5px 11px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer",textAlign:"left"}}>
{ACTION_LABELS[a.type]||"▶ DO IT"}{a.deal_name&&` — ${a.deal_name}`}{a.name&&` — ${a.name}`}{a.to_name&&` — ${a.to_name}`}{a.date&&` (${a.date})`}
</button>
);
})}
</div>
)}
{/* Team insights — similar questions from other users */}
{m.role==="assistant"&&insights[m.id]?.length>0&&(
<div style={{maxWidth:"88%",marginTop:5,background:`${B.blue}08`,border:`1px solid ${B.blue}25`,borderRadius:6,padding:"7px 12px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.6,marginBottom:5}}>💡 TEAM ASKED SOMETHING SIMILAR</div>
{insights[m.id].map((ins,i)=>(
<div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.mid,lineHeight:1.5,marginBottom:i<insights[m.id].length-1?4:0}}>
<span style={{color:B.blue,fontWeight:600}}>{ins.userName}</span> · <span style={{fontStyle:"italic"}}>"{ins.snippet}{ins.snippet.length>=80?"…":""}"</span>
<span style={{color:B.muted,fontSize:9,marginLeft:6}}>{relDate(ins.ts)}</span>
</div>
))}
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
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3}}>{m.role==="user"?(cu?.name?.split(" ")[0]||"You"):"RevOps Agent"} · {new Date(m.ts).toLocaleTimeString()}</div>
</div>
))}
{running&&(
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{padding:"10px 14px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:8,display:"flex",gap:8,alignItems:"center"}}>
<Spin/><span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>{agentStatus==="searching"?"🔍 Searching web...":agentStatus==="zoho"?"📡 Fetching live Zoho data...":"Thinking..."}</span>
</div>
</div>
)}
<div ref={endRef}/>
</div>
{/* Input bar */}
<div style={{background:B.white,borderTop:`1px solid ${B.border}`,padding:"11px 16px"}}>
<div style={{display:"flex",gap:9}}>
<input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Ask about your pipeline, contacts, deals — or say 'draft outreach for [name]'..." style={{flex:1,background:B.pageBg,border:`1px solid ${B.border}`,color:B.text,borderRadius:6,padding:"10px 13px",fontSize:13,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn onClick={()=>send()} disabled={running||!input.trim()}>SEND →</OBtn>
</div>
<div style={{marginTop:6,display:"flex",gap:5,flexWrap:"wrap"}}>
{["What's urgent today?","Overdue deals","Draft email to top lead","Who's close to closing?","Summarize this week"].map(q=>(
<button key={q} onClick={()=>send(q)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:99,padding:"3px 11px",fontSize:11,color:B.muted,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>{q}</button>
))}
</div>
</div>
</div>
{/* ── PRIORITY SIDEBAR (right) ── */}
<div style={{width:220,background:B.white,borderLeft:`1px solid ${B.border}`,display:"flex",flexDirection:"column",overflowY:"auto",flexShrink:0}}>
<div style={{padding:"14px 14px 12px",borderBottom:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>PIPELINE</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.orange}}>{fmt$(pipeline)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>{openDeals.length} open deal{openDeals.length!==1?"s":""}</div>
<button onClick={()=>setMod("deals")} style={{width:"100%",background:B.orange,color:"#fff",border:"none",borderRadius:6,padding:"7px 12px",fontSize:11,fontWeight:600,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>+ New Deal</button>
</div>
{overdueDeals.length>0&&(
<div style={{padding:"12px 14px",borderBottom:`1px solid ${B.border}`}}>
<div style={{display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,letterSpacing:1.5}}>OVERDUE</span>
<span style={{marginLeft:"auto",background:B.red,color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif"}}>{overdueDeals.length}</span>
</div>
{overdueDeals.map(d=>(
<div key={d.id} onClick={()=>setMod("deals")} style={{background:B.redBg,border:`1px solid ${B.red}25`,borderLeft:`3px solid ${B.red}`,borderRadius:5,padding:"7px 9px",marginBottom:4,cursor:"pointer"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,lineHeight:1.3,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red}}>{Math.abs(dUntil(d.followUpDate))}d OVERDUE · {fmt$(d.value)}</div>
</div>
))}
</div>
)}
{hotDeals.length>0&&(
<div style={{padding:"12px 14px",borderBottom:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>HOT DEALS</div>
{hotDeals.map(d=>(
<div key={d.id} onClick={()=>setMod("deals")} style={{background:B.orangeBg,border:`1px solid ${B.orange}25`,borderRadius:5,padding:"7px 9px",marginBottom:4,cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:4}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
<span style={{fontSize:9,fontWeight:700,color:B.orange,fontFamily:"'Lexend Zetta',sans-serif",flexShrink:0}}>HOT</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{d.stage} · {fmt$(d.value)}</div>
</div>
))}
</div>
)}
{topContacts.length>0&&(
<div style={{padding:"12px 14px",borderBottom:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>HOT CONTACTS</div>
{topContacts.map(c=>(
<div key={c.id} onClick={()=>setMod("crm")} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px",marginBottom:4,cursor:"pointer"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,marginBottom:1}}>{c.fullName||c.firstName}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,lineHeight:1.3}}>{(typeof c.title==="string"?c.title:c.title?.name||"").split(" ").slice(0,3).join(" ")}{c.state?` · ${c.state}`:""}</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:B.orange,marginTop:2}}>{c.score||0} pts</div>
</div>
))}
</div>
)}
{openRfps.length>0&&(
<div style={{padding:"12px 14px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>OPEN RFPS</div>
{openRfps.map(r=>(
<div key={r.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px",marginBottom:4}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,lineHeight:1.3,marginBottom:2}}>{r.name}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:RSC[r.stage]||B.muted}}>{r.stage}{r.dueDate?` · due ${r.dueDate}`:""}</div>
</div>
))}
</div>
)}
{!openDeals.length&&!topContacts.length&&!openRfps.length&&(
<div style={{padding:"16px 14px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6}}>Add deals and contacts to see live context here.</div>
)}
</div>
</div>
);
}
const TT_PHASES=[
{id:"RAPPORT",   label:"Rapport",    script:"Start by building genuine rapport. Ask about their season, recent wins, or team achievements. Listen actively and find common ground before moving to business."},
{id:"INTRO",     label:"ST1 Intro",  script:"ST1 Sports is a full-service athletic supplier serving 200+ schools across the region. We go beyond equipment — we're a partner for team stores, sponsorship revenue, and streamlined procurement. Our goal is to make your program stronger and take work off your plate."},
{id:"DISCOVERY", label:"Discovery",  script:"Now let's understand your program. These questions help us build a custom value model and show exactly what a partnership looks like for your school."},
{id:"PAIN",      label:"Pain Points",script:"Let's identify where your program has the biggest opportunities. Walk through each challenge below and confirm any that apply."},
{id:"SOLUTION",  label:"Solution",   script:"Based on what you've shared, here's what partnering with ST1 means for your program. Let me walk you through the numbers."},
];
const PAIN_CARDS=[
{id:"budget",      title:"Equipment Budget Constraints",     body:"School struggles to buy quality gear within tight budget limits. Coaches spend too much time hunting for deals."},
{id:"nostore",     title:"No Online Team Store",             body:"Manual collection of payments and orders overwhelms coaches during uniform season. Parents are frustrated."},
{id:"booster",     title:"Weak Booster / Community Support", body:"Fundraising is disorganized, participation is low, and the booster club isn't generating meaningful program revenue."},
{id:"vendors",     title:"Multiple Vendor Headaches",        body:"Dealing with 5+ vendors for different sports. No consolidated ordering, inconsistent quality, no single point of contact."},
{id:"sponsorship", title:"No Sponsorship Revenue",           body:"Program hasn't tapped brand partnership or giveback opportunities — leaving thousands on the table each year."},
];
function QuestionInput({question,value,onChange}){
const inp={width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif",boxSizing:"border-box"};
return(
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,marginBottom:3,fontWeight:500}}>
{question.questionText}{question.isRequired&&<span style={{color:B.orange,marginLeft:3}}>*</span>}
</div>
{question.helpText&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:5}}>{question.helpText}</div>}
{question.inputType==="TEXT"&&<input value={value||""} onChange={e=>onChange(e.target.value)} style={inp}/>}
{question.inputType==="TEXTAREA"&&<textarea value={value||""} onChange={e=>onChange(e.target.value)} rows={3} style={{...inp,resize:"vertical"}}/>}
{question.inputType==="NUMBER"&&<input type="number" value={value==null?"":value} onChange={e=>onChange(e.target.value===""?null:Number(e.target.value))} style={{...inp,width:140}}/>}
{question.inputType==="SELECT"&&(
<select value={value||""} onChange={e=>onChange(e.target.value)} style={inp}>
<option value="">— Select —</option>
{(Array.isArray(question.selectOptions)?question.selectOptions:[]).map(o=><option key={o} value={o}>{o}</option>)}
</select>
)}
{question.inputType==="BOOLEAN"&&(
<div style={{display:"flex",gap:6}}>
{["Yes","No"].map(opt=>(
<button key={opt} onClick={()=>onChange(opt==="Yes")} style={{background:(opt==="Yes"?value===true:value===false)?B.orange:B.surface,color:(opt==="Yes"?value===true:value===false)?B.white:B.muted,border:`1px solid ${(opt==="Yes"?value===true:value===false)?B.orange:B.border}`,borderRadius:5,padding:"5px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,cursor:"pointer"}}>{opt}</button>
))}
</div>
)}
</div>
);
}
function PainCards({selected,onToggle}){
return(
<div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
{PAIN_CARDS.map(c=>{
const on=selected.includes(c.id);
return(
<button key={c.id} onClick={()=>onToggle(c.id)} style={{textAlign:"left",background:on?`${B.orange}10`:B.surface,border:`1px solid ${on?B.orange:B.border}`,borderRadius:6,padding:"10px 13px",cursor:"pointer",width:"100%"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
<div style={{flex:1}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:on?B.orange:B.text}}>{c.title}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:3,lineHeight:1.5}}>{c.body}</div>
</div>
<div style={{width:18,height:18,borderRadius:4,border:`2px solid ${on?B.orange:B.border}`,background:on?B.orange:"transparent",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center"}}>
{on&&<span style={{color:B.white,fontSize:10}}>✓</span>}
</div>
</div>
</button>
);
})}
</div>
);
}
function CrmLinker({linked,onLink,onUnlink}){
const [q,setQ]=useState("");
const [results,setResults]=useState([]);
const [loading,setLoading]=useState(false);
const [showCreate,setShowCreate]=useState(false);
const [form,setForm]=useState({firstName:"",lastName:"",school:"",phone:"",email:""});
const [creating,setCreating]=useState(false);
const searchTimer=useRef(null);
const doSearch=(val)=>{
clearTimeout(searchTimer.current);
if(!val.trim()){setResults([]);return;}
searchTimer.current=setTimeout(()=>{
setLoading(true);
fetch(`/api/crm/search?q=${encodeURIComponent(val)}`)
.then(r=>r.json()).then(d=>{setResults(d.results||[]);setLoading(false);})
.catch(()=>setLoading(false));
},400);
};
const createLead=()=>{
if(!form.lastName)return;
setCreating(true);
fetch("/api/crm/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)})
.then(r=>r.json()).then(d=>{
setCreating(false);
onLink({id:d.zohoId||d.id||"new",name:`${form.firstName} ${form.lastName}`.trim(),module:"Lead"});
setShowCreate(false);
}).catch(()=>setCreating(false));
};
if(linked){
return(
<div style={{padding:"8px 22px",borderBottom:`1px solid ${B.border}`,background:`${B.green}08`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:10}}>🔗</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{linked.name||linked.id}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:`${B.green}18`,padding:"2px 6px",borderRadius:3}}>{(linked.module||"").toUpperCase()}</span>
</div>
<button onClick={onUnlink} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>unlink</button>
</div>
);
}
return(
<div style={{padding:"10px 22px",borderBottom:`1px solid ${B.border}`,background:`${B.orange}06`,flexShrink:0}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:6}}>LINK TO CRM CONTACT</div>
{!showCreate?(
<div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
<div style={{flex:1,position:"relative"}}>
<input value={q} onChange={e=>{setQ(e.target.value);doSearch(e.target.value);}} placeholder="Search by name, school, or email…" style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 10px",fontSize:11,color:B.text,boxSizing:"border-box"}}/>
{loading&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:9,color:B.muted}}>…</span>}
{results.length>0&&(
<div style={{position:"absolute",top:"calc(100% + 2px)",left:0,right:0,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.1)",zIndex:20,maxHeight:160,overflowY:"auto"}}>
{results.map(r=>(
<button key={`${r.module}-${r.id}`} onClick={()=>{onLink({id:r.id,name:r.name,module:r.module});setResults([]);setQ(r.name);}} style={{width:"100%",textAlign:"left",background:"transparent",border:"none",borderBottom:`1px solid ${B.border}`,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,flex:1}}>{r.name}</span>
{r.company&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{r.company}</span>}
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,flexShrink:0}}>{(r.module||"").toUpperCase()}</span>
</button>
))}
</div>
)}
</div>
<GBtn sm onClick={()=>setShowCreate(true)}>+ NEW LEAD</GBtn>
</div>
):(
<div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
<input value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))} placeholder="First name" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text}}/>
<input value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))} placeholder="Last name *" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text}}/>
<input value={form.school} onChange={e=>setForm(f=>({...f,school:e.target.value}))} placeholder="School" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text}}/>
<input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text}}/>
<input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text,gridColumn:"1/-1"}}/>
</div>
<div style={{display:"flex",gap:6}}><OBtn onClick={createLead} disabled={creating||!form.lastName}>{creating?"CREATING…":"CREATE LEAD"}</OBtn><GBtn onClick={()=>setShowCreate(false)}>Cancel</GBtn></div>
</div>
)}
</div>
);
}
function TalkTrack({onClose,linkedContact}){
const {s,cu,toast,dispatch}=useApp();
const [sessionId,setSessionId]=useState(null);
const [questions,setQuestions]=useState([]);
const [phaseIdx,setPhaseIdx]=useState(0);
const [answers,setAnswers]=useState({});
const [pains,setPains]=useState([]);
const [linked,setLinked]=useState(linkedContact||null);
const [calcInputs,setCalcInputs]=useState(()=>({
schoolClass:linkedContact?.schoolClass||"",
numSports:String(linkedContact?.numSports||""),
numAthletes:String(linkedContact?.numAthletes||""),
hasOnlineStore:linkedContact?.hasOnlineStore!=null?linkedContact.hasOnlineStore:null,
hasBoosterClub:linkedContact?.hasBoosterClub!=null?linkedContact.hasBoosterClub:null,
}));
const [calcResult,setCalcResult]=useState(null);
const [calcLoading,setCalcLoading]=useState(false);
const [draftEmail,setDraftEmail]=useState("");
const [drafting,setDrafting]=useState(false);
const [saving,setSaving]=useState(false);
const saveTimer=useRef(null);
const sessRef=useRef(null);
useEffect(()=>{
fetch("/api/admin/questions")
.then(r=>r.json()).then(d=>setQuestions((d.questions||[]).filter(q=>q.isActive)))
.catch(()=>{});
const existing=sessionStorage.getItem("ttSessionId");
if(existing){
fetch(`/api/sessions/${existing}?repId=${cu?.id||""}`)
.then(r=>r.ok?r.json():null)
.then(d=>{
if(d?.session){
const sess=d.session;
setSessionId(sess.id);sessRef.current=sess.id;
setAnswers(sess.answers||{});
setPains(Array.isArray(sess.confirmedPains)?sess.confirmedPains:[]);
if(sess.sponsorshipGuaranteedMin!=null) setCalcResult({guaranteedMin:sess.sponsorshipGuaranteedMin,upsideMax:sess.sponsorshipUpsideMax});
if(sess.schoolClass||sess.numAthletes||sess.numSports) setCalcInputs(ci=>({
schoolClass:sess.schoolClass||ci.schoolClass,
numSports:String(sess.numSports||ci.numSports||""),
numAthletes:String(sess.numAthletes||ci.numAthletes||""),
hasOnlineStore:sess.hasOnlineStore!=null?sess.hasOnlineStore:ci.hasOnlineStore,
hasBoosterClub:sess.hasBoosterClub!=null?sess.hasBoosterClub:ci.hasBoosterClub,
}));
if(!linkedContact&&(sess.crmContactId||sess.crmLeadId)){
setLinked({id:sess.crmContactId||sess.crmLeadId,module:sess.crmModule,name:""});
}
} else {
doCreateSession();
}
}).catch(()=>doCreateSession());
} else {
doCreateSession();
}
},[]);
const doCreateSession=()=>{
fetch("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({repId:cu?.id||"unknown"})})
.then(r=>r.json()).then(d=>{
setSessionId(d.session.id);sessRef.current=d.session.id;
sessionStorage.setItem("ttSessionId",d.session.id);
}).catch(()=>{});
};
const scheduleSave=(patch)=>{
if(!sessRef.current)return;
clearTimeout(saveTimer.current);
saveTimer.current=setTimeout(()=>{
setSaving(true);
fetch(`/api/sessions/${sessRef.current}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({repId:cu?.id||"unknown",...patch})})
.then(()=>setSaving(false)).catch(()=>setSaving(false));
},800);
};
const setAnswer=(qId,val)=>{const next={...answers,[qId]:val};setAnswers(next);scheduleSave({answers:next});};
const togglePain=(painId)=>{const next=pains.includes(painId)?pains.filter(p=>p!==painId):[...pains,painId];setPains(next);scheduleSave({confirmedPains:next});};
const linkContact=(c)=>{
setLinked(c);
const full=(s.contacts||[]).find(ct=>ct.id===c.id);
if(full) setCalcInputs(ci=>({
schoolClass:full.schoolClass||ci.schoolClass,
numSports:String(full.numSports||ci.numSports||""),
numAthletes:String(full.numAthletes||ci.numAthletes||""),
hasOnlineStore:full.hasOnlineStore!=null?full.hasOnlineStore:ci.hasOnlineStore,
hasBoosterClub:full.hasBoosterClub!=null?full.hasBoosterClub:ci.hasBoosterClub,
}));
const patch=c.module==="Contact"?{crmContactId:c.id,crmModule:"Contact"}:{crmLeadId:c.id,crmModule:"Lead"};
scheduleSave(patch);
};
const unlinkContact=()=>{setLinked(null);scheduleSave({crmContactId:null,crmLeadId:null,crmModule:null});};
const doCalc=()=>{
const {schoolClass,numSports,numAthletes,hasOnlineStore,hasBoosterClub}=calcInputs;
if(!numAthletes&&!numSports)return;
setCalcLoading(true);
fetch("/api/sponsorship/calculate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
schoolClass,numSports:Number(numSports||0),numAthletes:Number(numAthletes||0),
hasOnlineStore:hasOnlineStore===true,hasBoosterClub:hasBoosterClub===true,
})})
.then(r=>r.json()).then(d=>{
setCalcResult(d);setCalcLoading(false);
scheduleSave({sponsorshipGuaranteedMin:d.guaranteedMin,sponsorshipUpsideMax:d.upsideMax,
schoolClass,numSports:Number(numSports||0),numAthletes:Number(numAthletes||0),
hasOnlineStore:hasOnlineStore===true,hasBoosterClub:hasBoosterClub===true});
if(linked?.id){
const full=(s.contacts||[]).find(c=>c.id===linked.id);
dispatch("UPDATE_CONTACT",{id:linked.id,schoolClass,numSports:Number(numSports||0),numAthletes:Number(numAthletes||0),hasOnlineStore:hasOnlineStore===true,hasBoosterClub:hasBoosterClub===true,sponsorshipMin:d.guaranteedMin,sponsorshipMax:d.upsideMax});
const zohoMod=(linked.module||full?.source==="zoho-crm"?"":"")+(full?.id?.startsWith("zoho_l_")?"Leads":"Contacts");
const zohoId=full?.zohoId;
if(zohoId) crmAddNote(zohoMod,zohoId,`Sponsorship Calc — Guaranteed Min: $${d.guaranteedMin?.toLocaleString()||0} / Upside Max: $${d.upsideMax?.toLocaleString()||0}\nSchool Class: ${schoolClass||"—"} | Athletes: ${numAthletes||"—"} | Sports: ${numSports||"—"} | Team Store: ${hasOnlineStore?"Yes":"No"} | Booster Club: ${hasBoosterClub?"Yes":"No"}`);
}
}).catch(()=>setCalcLoading(false));
};
const doDraftEmail=async()=>{
setDrafting(true);
const activePains=PAIN_CARDS.filter(c=>pains.includes(c.id)).map(c=>c.title).join(", ");
const prompt=`Write a follow-up sales email from ST1 Sports to the AD/coach at ${linked?.name||"this school"}.${activePains?` Key challenges identified: ${activePains}.`:""}${calcResult?` Sponsorship potential: $${calcResult.guaranteedMin} guaranteed minimum.`:""} Under 80 words. Include subject line. Warm, direct, conversational — not salesy. Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`;
const t=await aiCall(prompt);
setDraftEmail(t||"");setDrafting(false);
if(t&&sessRef.current){
const lines=t.split("\n");
const subj=lines.find(l=>l.toLowerCase().startsWith("subject:"))?.replace(/^subject:\s*/i,"")||"";
const body=lines.filter(l=>!l.toLowerCase().startsWith("subject:")).join("\n").trim();
scheduleSave({draftEmailSubject:subj,draftEmailBody:body,status:"COMPLETE"});
}
};
const currentPhase=TT_PHASES[phaseIdx];
const phaseQs=questions.filter(q=>q.phase===currentPhase.id).sort((a,b)=>a.order-b.order);
return(
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{padding:"14px 22px 10px",borderBottom:`1px solid ${B.border}`,background:B.white,flexShrink:0}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2.5}}>TALK TRACK</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,marginTop:1}}>{linked?.name||"New Session"}</div>
</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
{saving&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>saving…</span>}
<GBtn sm onClick={()=>{sessionStorage.removeItem("ttSessionId");onClose();}}>✕ EXIT</GBtn>
</div>
</div>
<div style={{display:"flex",alignItems:"center"}}>
{TT_PHASES.map((p,i)=>{
const done=i<phaseIdx;const active=i===phaseIdx;
const col=done?B.green:active?B.orange:B.border;
return(
<React.Fragment key={p.id}>
<button onClick={()=>setPhaseIdx(i)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:0}}>
<div style={{width:22,height:22,borderRadius:"50%",background:done?B.green:active?B.orange:B.surface,border:`2px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
{done?<span style={{color:B.white,fontSize:9}}>✓</span>:<span style={{width:6,height:6,borderRadius:"50%",background:active?B.white:B.border,display:"block"}}/>}
</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:col,letterSpacing:.5,whiteSpace:"nowrap"}}>{p.label.toUpperCase()}</div>
</button>
{i<TT_PHASES.length-1&&<div style={{flex:1,height:2,background:done?B.green:B.border,margin:"0 4px",marginBottom:16}}/>}
</React.Fragment>
);
})}
</div>
</div>
<CrmLinker linked={linked} onLink={linkContact} onUnlink={unlinkContact}/>
<div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
<blockquote style={{margin:"0 0 16px",padding:"10px 14px",borderLeft:`3px solid ${B.orange}`,background:`${B.orange}08`,borderRadius:"0 4px 4px 0"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6,fontStyle:"italic"}}>{currentPhase.script}</div>
</blockquote>
{currentPhase.id==="PAIN"&&<PainCards selected={pains} onToggle={togglePain}/>}
{currentPhase.id==="SOLUTION"&&(
<div style={{marginBottom:16}}>
<div className="card" style={{padding:14,marginBottom:10}}>
<Lbl s={{marginBottom:10}}>Sponsorship Value Calculator</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
<div><Lbl s={{marginBottom:3}}>School Class</Lbl><select value={calcInputs.schoolClass} onChange={e=>setCalcInputs(c=>({...c,schoolClass:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}><option value="">— Select —</option>{["1A","2A","3A","4A","5A","6A"].map(v=><option key={v}>{v}</option>)}</select></div>
<div><Lbl s={{marginBottom:3}}># Sports</Lbl><input type="number" value={calcInputs.numSports} onChange={e=>setCalcInputs(c=>({...c,numSports:e.target.value}))} placeholder="0" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div><Lbl s={{marginBottom:3}}># Athletes</Lbl><input type="number" value={calcInputs.numAthletes} onChange={e=>setCalcInputs(c=>({...c,numAthletes:e.target.value}))} placeholder="0" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div><Lbl s={{marginBottom:3}}>Team Store?</Lbl><div style={{display:"flex",gap:5}}>{["Yes","No"].map(opt=>(<button key={opt} onClick={()=>setCalcInputs(c=>({...c,hasOnlineStore:opt==="Yes"}))} style={{flex:1,background:(opt==="Yes"?calcInputs.hasOnlineStore===true:calcInputs.hasOnlineStore===false)?B.green:B.surface,color:(opt==="Yes"?calcInputs.hasOnlineStore===true:calcInputs.hasOnlineStore===false)?B.white:B.muted,border:`1px solid ${(opt==="Yes"?calcInputs.hasOnlineStore===true:calcInputs.hasOnlineStore===false)?B.green:B.border}`,borderRadius:4,padding:"5px 8px",fontSize:9,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif"}}>{opt}</button>))}</div></div>
<div><Lbl s={{marginBottom:3}}>Booster Club?</Lbl><div style={{display:"flex",gap:5}}>{["Yes","No"].map(opt=>(<button key={opt} onClick={()=>setCalcInputs(c=>({...c,hasBoosterClub:opt==="Yes"}))} style={{flex:1,background:(opt==="Yes"?calcInputs.hasBoosterClub===true:calcInputs.hasBoosterClub===false)?B.green:B.surface,color:(opt==="Yes"?calcInputs.hasBoosterClub===true:calcInputs.hasBoosterClub===false)?B.white:B.muted,border:`1px solid ${(opt==="Yes"?calcInputs.hasBoosterClub===true:calcInputs.hasBoosterClub===false)?B.green:B.border}`,borderRadius:4,padding:"5px 8px",fontSize:9,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif"}}>{opt}</button>))}</div></div>
</div>
<OBtn onClick={doCalc} disabled={calcLoading} style={{width:"100%"}}>{calcLoading?"CALCULATING…":"✦ CALCULATE SPONSORSHIP VALUE"}</OBtn>
</div>
{calcResult&&(
<div className="card" style={{padding:14,marginBottom:10,borderTop:`3px solid ${B.orange}`}}>
<Lbl s={{marginBottom:8}}>Sponsorship Potential</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
<div style={{background:`${B.green}10`,borderRadius:6,padding:"12px 14px"}}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:1,marginBottom:4}}>GUARANTEED MIN</div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.green}}>{fmt$(calcResult.guaranteedMin||0)}</div></div>
<div style={{background:`${B.orange}10`,borderRadius:6,padding:"12px 14px"}}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1,marginBottom:4}}>UPSIDE MAX</div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.orange}}>{fmt$(calcResult.upsideMax||0)}</div></div>
</div>
</div>
)}
<OBtn onClick={doDraftEmail} disabled={drafting} style={{width:"100%",marginBottom:8}}>{drafting?"WRITING…":"✦ DRAFT FOLLOW-UP EMAIL"}</OBtn>
{draftEmail&&(
<div style={{background:B.surface,borderRadius:4,padding:10}}>
<textarea value={draftEmail} onChange={e=>setDraftEmail(e.target.value)} rows={8} style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical",boxSizing:"border-box",fontFamily:"'Lexend',sans-serif"}}/>
<GBtn onClick={()=>navigator.clipboard?.writeText(draftEmail)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>
</div>
)}
</div>
)}
{phaseQs.length>0&&(
<div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:8}}>
{phaseQs.map(q=>(<QuestionInput key={q.id} question={q} value={answers[q.id]} onChange={val=>setAnswer(q.id,val)}/>))}
</div>
)}
<div style={{display:"flex",justifyContent:"space-between",marginTop:24,paddingTop:16,borderTop:`1px solid ${B.border}`}}>
<GBtn onClick={()=>setPhaseIdx(i=>Math.max(0,i-1))} disabled={phaseIdx===0}>← PREV</GBtn>
{phaseIdx<TT_PHASES.length-1
?<OBtn onClick={()=>setPhaseIdx(i=>i+1)}>NEXT →</OBtn>
:<OBtn col={B.green} onClick={()=>{
if(sessRef.current) fetch(`/api/sessions/${sessRef.current}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({repId:cu?.id||"unknown",status:"COMPLETE"})}).catch(()=>{});
sessionStorage.removeItem("ttSessionId");
if(linked?.id){
const now=new Date().toISOString();
const full=(s.contacts||[]).find(c=>c.id===linked.id);
dispatch("UPDATE_CONTACT",{id:linked.id,ttCompletedAt:now,confirmedPains:pains});
const zohoMod=full?.id?.startsWith("zoho_l_")?"Leads":"Contacts";
const zohoId=full?.zohoId;
if(zohoId){
const painLabels=PAIN_CARDS.filter(c=>pains.includes(c.id)).map(c=>c.title);
const noteLines=["Talk Track COMPLETED — "+new Date(now).toLocaleDateString()];
if(painLabels.length) noteLines.push("Pain Points: "+painLabels.join(", "));
if(calcResult) noteLines.push(`Sponsorship: $${calcResult.guaranteedMin?.toLocaleString()||0} guaranteed / $${calcResult.upsideMax?.toLocaleString()||0} upside`);
crmAddNote(zohoMod,zohoId,noteLines.join("\n"));
}
}
toast("Talk Track complete!","success");
onClose();
}}>✓ COMPLETE</OBtn>
}
</div>
</div>
</div>
);
}
function ModCRM() {
const {s,dispatch,toast,cu,setMod,crmSyncRef}=useApp();
const [crmSyncing,setCrmSyncing]=useState(false);
const runCrmSync=async()=>{
if(!crmSyncRef?.current){toast("Sync not ready — reload the page","error");return;}
setCrmSyncing(true);
await crmSyncRef.current(true);
setCrmSyncing(false);
};
const [search,setSearch]=useState("");
const [filter,setFilter]=useState("all");
const [selId,setSelId]=useState(null);
const [crmTab,setCrmTab]=useState("overview");
const [noteText,setNoteText]=useState("");
const [touchNote,setTouchNote]=useState("");
const [showNewDeal,setShowNewDeal]=useState(false);
const [dealForm,setDealForm]=useState({name:"",value:"",stage:"Quoted",product:""});
const [showNewOrder,setShowNewOrder]=useState(false);
const [orderForm,setOrderForm]=useState({name:"",value:"",notes:""});
const [quoteNum,setQuoteNum]=useState("");
const [drafting,setDrafting]=useState(false);
const [draft,setDraft]=useState("");
const [ttView,setTtView]=useState(false);
const [ttContact,setTtContact]=useState(null);
const [dealValueInput,setDealValueInput]=useState("");
const [dealValueSaved,setDealValueSaved]=useState(false);
const [overviewEditDealId,setOverviewEditDealId]=useState(null);
const [overviewEditValue,setOverviewEditValue]=useState("");
const [quoteItems,setQuoteItems]=useState([]);
const [showAddContact,setShowAddContact]=useState(false);
const [addForm,setAddForm]=useState({firstName:"",lastName:"",school:"",email:"",phone:""});
const [leftMode,setLeftMode]=useState("accounts");
const [selSchool,setSelSchool]=useState(null);
const [profileForm,setProfileForm]=useState({});
const [profileDirty,setProfileDirty]=useState(false);
const [zohoSyncing,setZohoSyncing]=useState(false);
const [editingAccountName,setEditingAccountName]=useState(false);
const [accountNameInput,setAccountNameInput]=useState("");
const [savingAccountName,setSavingAccountName]=useState(false);
const [backfillingOrgs,setBackfillingOrgs]=useState(false);
const [acctStatus,setAcctStatus]=useState(null);
const [loadingAcctStatus,setLoadingAcctStatus]=useState(false);
const [showNewAccounts,setShowNewAccounts]=useState(false);
const [showUnassigned,setShowUnassigned]=useState(false);
const [assigningContactId,setAssigningContactId]=useState(null);
const [booksContactsByCustomer,setBooksContactsByCustomer]=useState({});
const [loadingBooksContacts,setLoadingBooksContacts]=useState(null);
const [enrichingWebsite,setEnrichingWebsite]=useState(false);
const [smsHistory,setSmsHistory]=useState([]);
const [smsLoading,setSmsLoading]=useState(false);
const [smsBody,setSmsBody]=useState("");
const [smsSending,setSmsSending]=useState(false);
const contacts=s.contacts||[];
const deals=s.deals||[];
const orders=s.orders||[];
const cName=(c)=>c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"Unnamed";
// Two same-named schools in different states are different accounts —
// group/select by name+state, not name alone, so they don't collide.
const schoolKeyOf=(c)=>{
const sch=(typeof c.school==="string"?c.school:c.school?.name||"")||"(No School)";
const st=(c.state||"").trim();
return st?`${sch} — ${st}`:sch;
};
const cleanSchoolName=(key)=>(key||"").replace(/ — [^—]*$/,"");
// Matches the server-side normalizeAccountName (api/_lib/accountUtils.js) so a
// Books customer name and a CRM Account/school name line up on more than an
// exact string match — case/whitespace/trailing-punctuation only, no suffix
// stripping, so it doesn't risk merging two genuinely different orgs.
const normalizeOrgName=(raw)=>(raw||"").trim().replace(/\s+/g," ").replace(/[.,]+$/g,"").toLowerCase();
const orgNamesMatch=(a,b)=>{
const na=normalizeOrgName(a),nb=normalizeOrgName(b);
if(!na||!nb)return false;
if(na===nb)return true;
return na.length>4&&nb.length>4&&(na.includes(nb)||nb.includes(na));
};
const setPF=(k,v)=>{setProfileForm(f=>({...f,[k]:v}));setProfileDirty(true);};
const FREE_EMAIL_DOMAINS=new Set(["gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com","comcast.net","msn.com","live.com","me.com","protonmail.com"]);
const pullTeammatesIntoQualifyingAccounts=async()=>{
setBackfillingOrgs(true);
let backendLinked=0,backendPushed=0,backendLeadsPushed=0,noContactAccounts=0;
const backendErrors=[];
try{
const syncRes=await fetch("/api/contacts/sync-books-accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}).then(r=>r.json());
backendLinked=syncRes?.contactsLinked||0;
noContactAccounts=(syncRes?.accountsWithNoContacts||[]).length;
// zoho-align-accounts only processes `limit` qualifying accounts per call
// (so any single run stays fast) — keep re-triggering it until it reports
// nothing left, instead of silently leaving most qualifying accounts at
// "0 contacts" after a single pass.
let remaining=1,guard=0;
while(remaining>0&&guard<10){
const alignRes=await fetch("/api/contacts/zoho-align-accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({limit:100})}).then(r=>r.json());
backendPushed+=alignRes?.contactsPushed||0;
// Only invoiced (real customer) accounts get pushed as Contacts; everyone
// else who merely qualified by engagement goes to Zoho as a Lead instead
// — see zoho-align-accounts.js for why. Tracked separately so this toast
// doesn't overstate how many became real, Account-linked Contacts.
backendLeadsPushed+=alignRes?.leadsPushed||0;
backendErrors.push(...(alignRes?.errors||[]));
remaining=alignRes?.accountsRemaining||0;
guard++;
if(!alignRes?.accountsProcessed)break;
}
if(crmSyncRef?.current)await crmSyncRef.current(true);
}catch(e){toast(`Books/Zoho sync error: ${e.message}`,"error");}
if(backendErrors.length){
toast(`${backendErrors.length} error${backendErrors.length!==1?"s":""} while pushing to Zoho — first: ${backendErrors[0]}`,"error");
dispatch("LOG",{msg:`zoho-align-accounts errors (${backendErrors.length}): ${backendErrors.slice(0,5).join(" | ")}`});
}
const byDomain=new Map();
contacts.filter(c=>!c.deadStatus&&c.email?.includes("@")).forEach(c=>{
const domain=c.email.split("@")[1].toLowerCase();
if(FREE_EMAIL_DOMAINS.has(domain))return;
if(!byDomain.has(domain))byDomain.set(domain,[]);
byDomain.get(domain).push(c);
});
// Never create or assign an account off cold prospect data alone — only pull
// teammates in once someone at that org has actually shown positive intent
// (same bar used everywhere else in this view: replied/interested, scored,
// or already a real Zoho contact). A shared email domain by itself is not
// intent; it's just how we find the Athletic Director and other coaches
// once the track coach who DID reply tells us which school they're at.
const toFix=[];
for(const group of byDomain.values()){
const named=group.filter(c=>(c.school||"").trim());
const blank=group.filter(c=>!(c.school||"").trim());
if(!named.length||!blank.length)continue;
const hasIntent=group.some(c=>(c.id||"").startsWith("zoho_c_")||(c.score||0)>=CONTACT_INTENT_SCORE||["replied","interested"].includes(c.outreachStatus));
if(!hasIntent)continue;
const counts=new Map();
named.forEach(c=>counts.set(c.school,(counts.get(c.school)||0)+1));
const bestSchool=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0];
const bestMatch=named.find(c=>c.school===bestSchool);
blank.forEach(c=>toFix.push({contact:c,school:bestSchool,state:bestMatch.state,city:bestMatch.city}));
}
if(!toFix.length){
const gapNote=noContactAccounts?` · ${noContactAccounts} invoiced account${noContactAccounts!==1?"s":""} still ha${noContactAccounts!==1?"ve":"s"} no known contact anywhere in our system — those need a real person added manually, not matched`:"";
toast((backendLinked||backendPushed||backendLeadsPushed?`${backendLinked} contact${backendLinked!==1?"s":""} linked from Books, ${backendPushed} pushed as Contacts (invoiced customers), ${backendLeadsPushed} pushed as Leads (engaged, not yet a customer) — no other qualifying accounts had teammates to pull in`:"No matches — no Books/CRM links, and no domain shared a contact who's shown positive intent yet")+gapNote,"info");
setBackfillingOrgs(false);refreshAcctStatus();return;
}
for(const {contact,school,state,city}of toFix){
dispatch("UPDATE_CONTACT",{id:contact.id,school,...(state?{state}:{}),...(city?{city}:{})});
if(contact.zohoId){
const isLead=(contact.id||"").startsWith("zoho_l_");
if(isLead){crmUpdate("Leads",contact.zohoId,{Company:school});}
else{
try{
const r=await fetch("/api/crm/account-name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:school,city,state})});
const d=await r.json();
if(d.ok)crmUpdate("Contacts",contact.zohoId,{Account_Name:{id:d.accountId}});
}catch{}
}
}
}
const gapNote=noContactAccounts?` · ${noContactAccounts} invoiced account${noContactAccounts!==1?"s":""} still ha${noContactAccounts!==1?"ve":"s"} no known contact anywhere — need a real person added manually`:"";
toast(`Pulled in ${toFix.length} teammate${toFix.length!==1?"s":""} at ${new Set(toFix.map(f=>f.school)).size} qualifying account${new Set(toFix.map(f=>f.school)).size!==1?"s":""} — plus ${backendLinked} linked from Books, ${backendPushed} pushed as Contacts (invoiced), ${backendLeadsPushed} pushed as Leads`+gapNote,"success");
setBackfillingOrgs(false);
refreshAcctStatus();
};
// Real Zoho Accounts count + who's new + which already-real Contacts match an
// Account by name but never got linked (the visibility this backfill button
// used to have none of — it just ran, then a toast said how many, with no way
// to see the actual accounts or fix a leftover unlinked match by hand).
const refreshAcctStatus=useCallback(async()=>{
setLoadingAcctStatus(true);
try{
const r=await fetch("/api/crm/accounts-status");
const d=await r.json();
setAcctStatus(d.ok?d:null);
}catch{setAcctStatus(null);}
setLoadingAcctStatus(false);
},[]);
useEffect(()=>{
if(leftMode==="accounts"&&!acctStatus&&!loadingAcctStatus)refreshAcctStatus();
},[leftMode]);
const assignContactToAccount=async(contactId,accountId)=>{
setAssigningContactId(contactId);
try{
const r=await fetch("/api/crm/assign-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId,accountId})});
const d=await r.json();
if(d.ok){
toast("Linked to account","success");
setAcctStatus(prev=>prev?{...prev,unassignedMatches:prev.unassignedMatches.filter(m=>m.contactId!==contactId)}:prev);
}else toast(d.error||"Assign failed","error");
}catch(e){toast(`Assign error: ${e.message}`,"error");}
setAssigningContactId(null);
};
const loadBooksContacts=async(customerId)=>{
if(!customerId||booksContactsByCustomer[customerId])return;
setLoadingBooksContacts(customerId);
try{
const r=await fetch(`/api/crm/books-contacts?customerId=${encodeURIComponent(customerId)}`);
const d=await r.json();
setBooksContactsByCustomer(prev=>({...prev,[customerId]:d.ok?d.contacts:[]}));
}catch{
setBooksContactsByCustomer(prev=>({...prev,[customerId]:[]}));
}
setLoadingBooksContacts(null);
};
const cdMap=useMemo(()=>{
const m=new Map();
for(const c of contacts){
const nm=cName(c).toLowerCase();
const cd=deals.filter(d=>d.contactId===c.id||(d.contact||"").toLowerCase()===nm);
const co=orders.filter(o=>o.contactId===c.id||(o.contact||"").toLowerCase()===nm);
let phase="lead";
if(co.length>0||cd.some(d=>["PO Received","Closed Won"].includes(d.stage))) phase="order";
else if(cd.some(d=>["Quoted","Negotiating"].includes(d.stage))) phase="quote";
else if(cd.length>0) phase="deal";
m.set(c.id,{cd,co,phase});
}
return m;
},[contacts,deals,orders]);
const getCD=(c)=>cdMap.get(c.id)||{cd:[],co:[],phase:"lead"};
const PCOL={lead:B.muted,deal:B.orange,quote:B.blue,order:B.green};
useEffect(()=>{
if(!s.crmNav) return;
const {id,school}=s.crmNav;
if(id){setLeftMode("contacts");setSelId(id);setSelSchool(null);setCrmTab("overview");}
else if(school){setLeftMode("accounts");setSelSchool(school);setSelId(null);}
dispatch("SET_CRM_NAV",null);
},[s.crmNav]);
const filtered=useMemo(()=>{
const q=search.toLowerCase();
const po={order:0,quote:1,deal:2,lead:3};
return contacts.filter(c=>{
if(c.deadStatus) return false;
if(q&&!cName(c).toLowerCase().includes(q)&&!(c.school||"").toLowerCase().includes(q)&&!(c.email||"").toLowerCase().includes(q)) return false;
if(filter==="all") return true;
if(filter==="mine") return (c.ownerId===cu?.id)||(!c.ownerId);
return (cdMap.get(c.id)||{phase:"lead"}).phase===filter;
}).sort((a,b)=>{
const pa=(cdMap.get(a.id)||{phase:"lead"}).phase;
const pb=(cdMap.get(b.id)||{phase:"lead"}).phase;
if(po[pa]!==po[pb]) return po[pa]-po[pb];
return cName(a).localeCompare(cName(b));
});
},[contacts,cdMap,search,filter,cu?.id]);
const sel=selId?contacts.find(c=>c.id===selId):null;
const selCD=sel?getCD(sel):null;
const activeDeal=selCD?.cd.find(d=>!["Closed Won","Closed Lost"].includes(d.stage))||selCD?.cd[0];
useEffect(()=>{
setCrmTab("overview");setDraft("");setDrafting(false);
setQuoteNum(activeDeal?.quoteNumber||"");
setTtView(false);setTtContact(null);
setDealValueInput(String(activeDeal?.value||0));
setDealValueSaved(false);
setQuoteItems(activeDeal?.quoteItems||[]);
setOverviewEditDealId(null);
const c=selId?(contacts.find(x=>x.id===selId)||null):null;
if(c) setProfileForm({firstName:c.firstName||"",lastName:c.lastName||"",title:c.title||"",school:c.school||"",state:c.state||"",city:c.city||"",email:c.email||"",phone:c.phone||"",sport:c.sport||"",orgType:c.orgType||"school",schoolClass:c.schoolClass||"",numAthletes:String(c.numAthletes||""),numSports:String(c.numSports||""),priority:c.priority||"medium",outreachStatus:c.outreachStatus||"new"});
setProfileDirty(false);
},[selId]);
useEffect(()=>{
setSmsBody("");setSmsHistory([]);
if(!sel?.phone)return;
let cancelled=false;
setSmsLoading(true);
fetch(`/api/sms?phone=${encodeURIComponent(sel.phone)}`).then(r=>r.json()).then(d=>{if(!cancelled)setSmsHistory(d.ok?d.messages:[]);}).catch(()=>{}).finally(()=>{if(!cancelled)setSmsLoading(false);});
return()=>{cancelled=true;};
},[sel?.phone]);
const sendText=async()=>{
if(!sel?.phone||!smsBody.trim())return;
setSmsSending(true);
try{
const r=await fetch("/api/sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:sel.phone,body:smsBody.trim()})});
const d=await r.json();
if(d.ok){
setSmsHistory(prev=>[...prev,d.message]);
setSmsBody("");
dispatch("LOG",{msg:`Texted ${cName(sel)}: "${smsBody.trim().slice(0,60)}"`});
}else toast(d.error||"Text failed","error");
}catch(e){toast(`Text error: ${e.message}`,"error");}
setSmsSending(false);
};
const logTouch=()=>{
if(!touchNote.trim()||!activeDeal) return;
dispatch("UPDATE_DEAL",{id:activeDeal.id,touchHistory:[...(activeDeal.touchHistory||[]),{id:mkId(),type:"note",date:today(),note:touchNote,author:cu?.id}]});
crmAddNote("Deals",activeDeal.zohoId,touchNote);
setTouchNote("");toast("Touch logged","success");
};
const saveProfile=async()=>{
if(!sel)return;
const pf=profileForm;
const patch={...pf,numAthletes:pf.numAthletes?Number(pf.numAthletes)||pf.numAthletes:undefined,numSports:pf.numSports?Number(pf.numSports)||pf.numSports:undefined};
if(patch.firstName||patch.lastName) patch.fullName=`${patch.firstName||""} ${patch.lastName||""}`.trim();
dispatch("UPDATE_CONTACT",{id:sel.id,...patch});
setProfileDirty(false);
if(sel.zohoId){
setZohoSyncing(true);
const isLead=sel.id?.startsWith("zoho_l_");
const mod=isLead?"Leads":"Contacts";
try{
let accountId=null;
const schoolChanged=pf.school!==sel.school||pf.city!==sel.city||pf.state!==sel.state;
if(!isLead&&pf.school){
if(!schoolChanged&&sel.zohoAccountId){
// Nothing about the school changed since the last successful resolve —
// skip the extra Zoho round-trip and reuse the id already on file.
accountId=sel.zohoAccountId;
}else{
// Contacts' Account_Name is a lookup field — sending the school name as a
// bare string here wouldn't actually link it, same issue as Deals/Quotes
// had before those were fixed to resolve a real Account id first.
const r=await fetch("/api/crm/account-name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:pf.school,city:pf.city,state:pf.state})});
const d=await r.json();
if(d.ok){accountId=d.accountId;dispatch("UPDATE_CONTACT",{id:sel.id,zohoAccountId:accountId});}
}
}
const fields=isLead?{First_Name:pf.firstName,Last_Name:pf.lastName,Email:pf.email,Phone:pf.phone,Designation:pf.title,Company:pf.school,State:pf.state,City:pf.city}:{First_Name:pf.firstName,Last_Name:pf.lastName,Email:pf.email,Phone:pf.phone,Title:pf.title,...(accountId?{Account_Name:{id:accountId}}:{}),Mailing_State:pf.state,Mailing_City:pf.city};
await crmUpdate(mod,sel.zohoId,fields);
if(pf.sport&&pf.sport!==sel.sport) await crmAddNote(mod,sel.zohoId,`Sport / primary contact sport: ${pf.sport}`);
toast("Profile saved + synced to Zoho","success");
}catch(e){
toast("Saved locally (Zoho sync failed)","info");
}
setZohoSyncing(false);
} else {
toast("Profile saved","success");
}
};
const doDraftEmail=async()=>{
if(!sel||!activeDeal) return;
setDrafting(true);setDraft("");
const t=await aiCall(`Write a follow-up email from ST1 Sports to ${cName(sel)}, ${sel.title||""} at ${sel.school||""}. Deal: ${activeDeal.name}, Stage: ${activeDeal.stage}, Value: ${fmt$(activeDeal.value||0)}. Under 80 words. Include subject line. Brand voice: warm and direct, lead with the person not the product, athlete-aware. No "hope this finds you well", no generic inspiration, no efficiency-first hooks. Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`);
setDraft(t||"");setDrafting(false);
};
const [findingStaff,setFindingStaff]=useState(false);
const findMissingStaff=async(school,schoolCity,schoolState,gaps,needsAD)=>{
setFindingStaff(true);
const roles=[...(needsAD?["Athletic Director"]:[]),...gaps.map(sp=>`Head ${sp} Coach`)];
try{
const found=await aiCall(
`Find real ${roles.join(", ")} contacts at ${school}${schoolCity?` in ${schoolCity}, ${schoolState||""}`:""}. Search their school athletics staff directory page and district website — look for /athletics/staff or /directory. Search: "${school} ${roles[0]} email contact". Email format is usually firstname.lastname@district.org or first@schoolname.edu. Return JSON array (ONLY verified real contacts — return empty array [] if you cannot confirm the person exists): [{"firstName":"","lastName":"","fullName":"","title":"","school":"${school}","orgType":"school","city":"${schoolCity||""}","state":"${schoolState||""}","email":"","phone":"","source":"scraped","confidence":"high|medium|low"}]`,
{search:true,json:true,tokens:1600}
);
const valid=(Array.isArray(found)?found:[]).filter(c=>c.fullName||c.firstName).map(c=>({...c,id:mkId(),source:"scraped"}));
if(valid.length){dispatch("ADD_CONTACTS",valid);toast(`Found ${valid.length} contact${valid.length!==1?"s":""} for ${school} — added to Prospecting for review`,"success");}
else toast(`No verified contacts found for the missing roles at ${school}`,"info");
}catch(e){toast(`Search error: ${e.message}`,"error");}
setFindingStaff(false);
};
const PHASES=[{id:"lead",label:"Lead"},{id:"deal",label:"Deal"},{id:"quote",label:"Quote"},{id:"order",label:"Order"}];
const phaseIdx={lead:0,deal:1,quote:2,order:3};
const [showBreakdown,setShowBreakdown]=useState(false);
const [showDuplicates,setShowDuplicates]=useState(false);
const sourceBreakdown=useMemo(()=>{
const buckets={};
let dead=0,zohoSynced=0,leads=0,zohoContacts=0;
const nameMap=new Map(); // normalized full name -> contacts sharing it
for(const c of contacts){
if(c.deadStatus) dead++;
if(c.zohoId||(c.id||"").startsWith("zoho_")) zohoSynced++;
const isLead=(c.id||"").startsWith("zoho_l_");
if(isLead) leads++;
else if((c.id||"").startsWith("zoho_c_")) zohoContacts++;
const src=c.source||"(none)";
const key=src.startsWith("zoho")?(isLead?"zoho-crm-lead (real Zoho CRM sync)":"zoho-crm (real Zoho CRM sync)"):src;
buckets[key]=(buckets[key]||0)+1;
if(!c.deadStatus){
const nm=cName(c).trim().toLowerCase();
if(nm&&nm!=="unnamed"){
if(!nameMap.has(nm))nameMap.set(nm,[]);
nameMap.get(nm).push(c);
}
}
}
// Same name, more than one distinct email — likely the same person entered
// twice (or a lead/contact pair that never got merged), not a real
// coincidence at this volume.
const dupGroups=[...nameMap.entries()]
.map(([name,list])=>({name,contacts:list,emails:[...new Set(list.map(c=>(c.email||"").toLowerCase()).filter(Boolean))]}))
.filter(g=>g.emails.length>1)
.sort((a,b)=>b.contacts.length-a.contacts.length);
const schoolKeys=new Set();
contacts.filter(c=>!c.deadStatus).forEach(c=>{
const key=schoolKeyOf(c);
if(cleanSchoolName(key)!=="(No School)")schoolKeys.add(key);
});
return {
rows:Object.entries(buckets).sort(([,a],[,b])=>b-a),
dead,zohoSynced,total:contacts.length,
leads,zohoContacts,accounts:schoolKeys.size,
dupGroups,dupPeopleCount:dupGroups.reduce((s,g)=>s+g.contacts.length,0),
};
},[contacts]);
return(
<div className="rv-crm-split" style={{display:"flex",height:"100%",overflow:"hidden"}}>
{/* LEFT LIST */}
<div className="rv-crm-left" style={{width:272,background:B.white,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
<div style={{padding:"14px 13px 10px",borderBottom:`1px solid ${B.border}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<div style={{display:"flex",gap:3}}>
{[["contacts","CONTACTS"],["accounts","ACCOUNTS"]].map(([v,l])=>(
<button key={v} onClick={()=>{setLeftMode(v);setSelId(null);setSelSchool(null);}} style={{padding:"4px 10px",background:leftMode===v?B.orange:B.surface,color:leftMode===v?B.white:B.muted,border:`1px solid ${leftMode===v?B.orange:B.border}`,borderRadius:4,fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,letterSpacing:.5,cursor:"pointer"}}>{l}</button>
))}
</div>
<button onClick={()=>setShowAddContact(v=>!v)} style={{background:"none",border:"none",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,cursor:"pointer",letterSpacing:1}}>+ ADD</button>
</div>
<div style={{marginBottom:7}}>
<div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:4}}>
<div><span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.text}}>{sourceBreakdown.leads.toLocaleString()}</span><span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}> leads</span></div>
<div><span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.text}}>{sourceBreakdown.zohoContacts.toLocaleString()}</span><span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}> contacts</span></div>
<div><span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{sourceBreakdown.accounts.toLocaleString()}</span><span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}> accounts</span></div>
</div>
<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
<button onClick={()=>setShowBreakdown(v=>!v)} style={{background:"none",border:"none",padding:0,fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}>{sourceBreakdown.total.toLocaleString()} contacts total ({sourceBreakdown.zohoSynced.toLocaleString()} synced from Zoho) — {showBreakdown?"hide":"show"} breakdown</button>
<button onClick={runCrmSync} disabled={crmSyncing} title="Re-sync from Zoho and move any contact with no deal/quote/order and no reply signal into the Prospecting database" style={{background:"none",border:`1px solid ${crmSyncing?B.border:B.purple}`,color:crmSyncing?B.muted:B.purple,borderRadius:3,padding:"2px 7px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.5,cursor:crmSyncing?"default":"pointer"}}>{crmSyncing?"SYNCING…":"⟳ SYNC & MOVE COLD CONTACTS"}</button>
</div>
{showBreakdown&&(
<div style={{marginTop:5,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px"}}>
{sourceBreakdown.rows.map(([src,n])=>(
<div key={src} style={{display:"flex",justifyContent:"space-between",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"1px 0"}}><span>{src}</span><span style={{color:B.muted}}>{n.toLocaleString()}</span></div>
))}
{sourceBreakdown.dead>0&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"1px 0",marginTop:3,borderTop:`1px solid ${B.border}`}}><span>marked dead (hidden from list)</span><span>{sourceBreakdown.dead.toLocaleString()}</span></div>}
</div>
)}
{sourceBreakdown.dupGroups.length>0&&(
<div style={{marginTop:5}}>
<button onClick={()=>setShowDuplicates(v=>!v)} style={{background:"none",border:"none",padding:0,fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.red,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}>⚠ {sourceBreakdown.dupPeopleCount.toLocaleString()} contacts share a name with a different email ({sourceBreakdown.dupGroups.length.toLocaleString()} names) — {showDuplicates?"hide":"show"}</button>
{showDuplicates&&(
<div style={{marginTop:5,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px",maxHeight:220,overflowY:"auto"}}>
{sourceBreakdown.dupGroups.slice(0,50).map(g=>(
<div key={g.name} style={{padding:"4px 0",borderBottom:`1px solid ${B.border}20`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,fontWeight:600,textTransform:"capitalize"}}>{g.name} <span style={{color:B.muted,fontWeight:400}}>({g.contacts.length})</span></div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{g.emails.join(" · ")}</div>
</div>
))}
{sourceBreakdown.dupGroups.length>50&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,paddingTop:4}}>+{sourceBreakdown.dupGroups.length-50} more</div>}
</div>
)}
</div>
)}
</div>
<input value={search} onChange={e=>setSearch(e.target.value)} placeholder={leftMode==="accounts"?"Search schools...":"Search contacts..."} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 10px",fontSize:11,color:B.text,fontFamily:"'Lexend',sans-serif",boxSizing:"border-box"}}/>
{leftMode==="accounts"&&(
<button onClick={pullTeammatesIntoQualifyingAccounts} disabled={backfillingOrgs} title="Never creates an account from cold prospects. Only for accounts that already qualify (invoiced, or a contact who replied/scored/is already in Zoho) — pulls in other contacts at the same org (e.g. the AD, other coaches) from our database so the whole staff shows up under that account." style={{marginTop:7,width:"100%",background:"none",border:`1px solid ${backfillingOrgs?B.border:B.purple}`,color:backfillingOrgs?B.muted:B.purple,borderRadius:4,padding:"5px 0",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.5,cursor:backfillingOrgs?"default":"pointer"}}>{backfillingOrgs?"MATCHING…":"⟳ PULL TEAMMATES INTO QUALIFYING ACCOUNTS"}</button>
)}
{leftMode==="accounts"&&(
<div style={{marginTop:8,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 9px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,letterSpacing:.5,color:B.muted}}>ZOHO ACCOUNTS</span>
<button onClick={refreshAcctStatus} disabled={loadingAcctStatus} title="Re-check real Zoho Account counts + unlinked matches" style={{background:"none",border:"none",fontSize:10,color:loadingAcctStatus?B.muted:B.purple,cursor:loadingAcctStatus?"default":"pointer"}}>{loadingAcctStatus?"…":"↻"}</button>
</div>
{!acctStatus&&!loadingAcctStatus&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3}}>Not loaded yet</div>}
{loadingAcctStatus&&!acctStatus&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3}}>Checking Zoho…</div>}
{acctStatus&&(<>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.text,marginTop:3}}>{acctStatus.totalAccounts.toLocaleString()}<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,fontWeight:400}}> accounts in Zoho</span></div>
{acctStatus.newAccounts.length>0&&(
<div style={{marginTop:4}}>
<button onClick={()=>setShowNewAccounts(v=>!v)} style={{background:"none",border:"none",padding:0,fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.green,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}>{acctStatus.newAccounts.length} new in the last week — {showNewAccounts?"hide":"show"}</button>
{showNewAccounts&&(
<div style={{marginTop:4,maxHeight:160,overflowY:"auto"}}>
{acctStatus.newAccounts.map(a=>(
<div key={a.id} style={{padding:"3px 0",borderBottom:`1px solid ${B.border}20`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text}}>{a.name||"(unnamed)"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted}}>{[a.city,a.state].filter(Boolean).join(", ")}{a.createdTime?` · ${new Date(a.createdTime).toLocaleDateString()}`:""}</div>
</div>
))}
</div>
)}
</div>
)}
{acctStatus.unassignedMatches.length>0&&(
<div style={{marginTop:5}}>
<button onClick={()=>setShowUnassigned(v=>!v)} style={{background:"none",border:"none",padding:0,fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}>⚠ {acctStatus.unassignedMatches.length} contact{acctStatus.unassignedMatches.length!==1?"s":""} match an account but aren't linked — {showUnassigned?"hide":"show"}</button>
{showUnassigned&&(
<div style={{marginTop:4,maxHeight:220,overflowY:"auto"}}>
{acctStatus.unassignedMatches.map(m=>(
<div key={m.contactId} style={{padding:"5px 0",borderBottom:`1px solid ${B.border}20`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text}}>{m.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:8,color:B.muted}}>{m.companyName} → matches <b>{m.matchedAccountName}</b></div>
<button onClick={()=>assignContactToAccount(m.contactId,m.matchedAccountId)} disabled={assigningContactId===m.contactId} style={{marginTop:2,background:"none",border:`1px solid ${assigningContactId===m.contactId?B.border:B.orange}`,color:assigningContactId===m.contactId?B.muted:B.orange,borderRadius:3,padding:"2px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:assigningContactId===m.contactId?"default":"pointer"}}>{assigningContactId===m.contactId?"LINKING…":"ASSIGN TO ACCOUNT"}</button>
</div>
))}
</div>
)}
</div>
)}
</>)}
</div>
)}
{leftMode==="contacts"&&(
<div style={{display:"flex",gap:4,marginTop:7,flexWrap:"wrap"}}>
{[["all","All"],["mine","Mine"],["deal","Deal"],["quote","Quote"],["order","Order"],["lead","Lead"]].map(([v,l])=>(
<button key={v} onClick={()=>setFilter(v)} style={{background:filter===v?B.orange:"none",color:filter===v?B.white:B.muted,border:`1px solid ${filter===v?B.orange:B.border}`,borderRadius:99,padding:"2px 9px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,cursor:"pointer"}}>{l}</button>
))}
</div>
)}
</div>
{showAddContact&&(
<div style={{padding:"10px 13px",borderBottom:`1px solid ${B.border}`,background:`${B.orange}05`}}>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:6}}>
<input value={addForm.firstName} onChange={e=>setAddForm(f=>({...f,firstName:e.target.value}))} placeholder="First name" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,color:B.text}}/>
<input value={addForm.lastName} onChange={e=>setAddForm(f=>({...f,lastName:e.target.value}))} placeholder="Last name *" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,color:B.text}}/>
<input value={addForm.school} onChange={e=>setAddForm(f=>({...f,school:e.target.value}))} placeholder="School / Org" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,color:B.text,gridColumn:"1/-1"}}/>
<input value={addForm.email} onChange={e=>setAddForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,color:B.text}}/>
<input value={addForm.phone} onChange={e=>setAddForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 7px",fontSize:10,color:B.text}}/>
</div>
<div style={{display:"flex",gap:5}}>
<OBtn sm onClick={()=>{
if(!addForm.lastName) return;
const c={id:mkId(),firstName:addForm.firstName,lastName:addForm.lastName,fullName:`${addForm.firstName} ${addForm.lastName}`.trim(),school:addForm.school,email:addForm.email,phone:addForm.phone,ownerId:cu?.id,source:"manual",orgType:"school",importedAt:Date.now()};
dispatch("ADD_CONTACTS",[c]);
setSelId(c.id);
setShowAddContact(false);
setAddForm({firstName:"",lastName:"",school:"",email:"",phone:""});
toast(`${c.fullName} added`,"success");
fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:"/Leads",method:"POST",body:{data:[{First_Name:addForm.firstName,Last_Name:addForm.lastName,Email:addForm.email,Phone:addForm.phone,Company:addForm.school}]}})})
.then(r=>r.json()).then(d=>{const zid=d?.data?.[0]?.details?.id;if(zid)dispatch("UPDATE_CONTACT",{id:c.id,zohoId:zid});}).catch(()=>{});
}} disabled={!addForm.lastName}>SAVE</OBtn>
<GBtn sm onClick={()=>{setShowAddContact(false);setAddForm({firstName:"",lastName:"",school:"",email:"",phone:""});}}>Cancel</GBtn>
</div>
</div>
)}
<div style={{flex:1,overflowY:"auto"}}>
{leftMode==="contacts"&&(<>
{filtered.length===0&&<div style={{padding:"24px 13px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center"}}>No contacts found</div>}
{filtered.map(c=>{
const {cd,phase}=getCD(c);
const top=cd.find(d=>!["Closed Won","Closed Lost"].includes(d.stage))||cd[0];
const pc=PCOL[phase];
return(
<button key={c.id} onClick={()=>setSelId(c.id)} style={{width:"100%",textAlign:"left",background:selId===c.id?`${B.orange}08`:"transparent",border:"none",borderLeft:`3px solid ${selId===c.id?B.orange:"transparent"}`,borderBottom:`1px solid ${B.border}`,padding:"9px 12px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cName(c)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{typeof c.school==="string"?c.school:c.school?.name||""}</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:pc,background:`${pc}18`,padding:"2px 6px",borderRadius:3,textTransform:"uppercase"}}>{phase}</span>
{c.ownerId && c.ownerId !== cu?.id && (()=>{
const owner=(s.reps||[]).find(r=>r.id===c.ownerId);
const initials=(owner?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
return <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.white,background:B.blue,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{initials}</span>;
})()}
</div>
</div>
{top&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:DSC[top.stage]||B.muted,marginTop:4}}>{top.stage} · {fmt$(top.value||0)}</div>}
</button>
);
})}
</>)}
{leftMode==="accounts"&&(()=>{
const sq=search.toLowerCase();
const invoices=s.invoices||[];
const fuzzyMatch=orgNamesMatch;
const isInvoiced=(school)=>invoices.some(inv=>fuzzyMatch(school,inv.customer));
const groups={};
contacts.filter(c=>!c.deadStatus).forEach(c=>{
const key=schoolKeyOf(c);
const displayName=cleanSchoolName(key);
if(sq&&!key.toLowerCase().includes(sq)&&!cName(c).toLowerCase().includes(sq)) return;
if(!groups[key]) groups[key]={name:displayName,contacts:[],deals:[],value:0,invoiced:isInvoiced(displayName)};
groups[key].contacts.push(c);
const cd=getCD(c);
cd.cd.forEach(d=>{if(!["Closed Won","Closed Lost"].includes(d.stage)){groups[key].deals.push(d);groups[key].value+=(d.value||0);}});
});
// A customer we've actually invoiced belongs on this list at the account
// level even if we don't have a synced contact for them yet — surface a
// zero-contact row so the account itself isn't invisible.
invoices.forEach(inv=>{
const custName=(inv.customer||"").trim();
if(!custName) return;
if(sq&&!custName.toLowerCase().includes(sq)) return;
if(Object.keys(groups).some(sch=>fuzzyMatch(sch,custName))) return;
groups[custName]={name:custName,contacts:[],deals:[],value:0,invoiced:true};
});
const schoolList=Object.entries(groups).sort(([a,ga],[b,gb])=>(gb.invoiced-ga.invoiced)||a.localeCompare(b));
if(schoolList.length===0) return <div style={{padding:"24px 13px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center"}}>No accounts found</div>;
return schoolList.map(([key,g])=>{
const isActive=selSchool===key;
const phases=g.contacts.map(c=>getCD(c).phase);
const topPhase=phases.includes("order")?"order":phases.includes("quote")?"quote":phases.includes("deal")?"deal":"lead";
const pc=g.invoiced?B.green:PCOL[topPhase];
const cov=g.contacts.length>0?computeAccountCoverage(g.contacts):null;
return(
<button key={key} onClick={()=>{setSelSchool(key);setSelId(null);}} style={{width:"100%",textAlign:"left",background:isActive?`${B.orange}08`:"transparent",border:"none",borderLeft:`3px solid ${isActive?B.orange:"transparent"}`,borderBottom:`1px solid ${B.border}`,padding:"9px 12px",cursor:"pointer"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{g.contacts.length} contact{g.contacts.length!==1?"s":""}{g.deals.length>0?` · ${g.deals.length} deal${g.deals.length!==1?"s":""}`:""}</div>
{cov&&(!cov.adContact||cov.gaps.length>0)&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:1}}>{!cov.adContact?"no AD on file":""}{!cov.adContact&&cov.gaps.length>0?" · ":""}{cov.gaps.length>0?`${cov.gaps.length} sport${cov.gaps.length!==1?"s":""} not covered`:""}</div>}
</div>
<div style={{flexShrink:0,textAlign:"right"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:pc,background:`${pc}18`,padding:"2px 6px",borderRadius:3,textTransform:"uppercase"}}>{g.invoiced?"customer":topPhase}</span>
{g.value>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,marginTop:2}}>{fmt$K(g.value)}</div>}
</div>
</div>
</button>
);
});
})()}
</div>
</div>
{/* RIGHT DETAIL */}
{ttView?(
<TalkTrack
onClose={()=>{setTtView(false);setTtContact(null);}}
linkedContact={ttContact}
/>
):leftMode==="accounts"&&selSchool?(()=>{
const schoolContacts=contacts.filter(c=>!c.deadStatus&&schoolKeyOf(c)===selSchool);
const coverage=computeAccountCoverage(schoolContacts);
const hasPositiveIntent=schoolContacts.some(c=>(c.id||"").startsWith("zoho_c_")||(c.score||0)>=CONTACT_INTENT_SCORE||["replied","interested"].includes(c.outreachStatus));
const schoolDeals=deals.filter(d=>schoolContacts.some(c=>c.id===d.contactId||(c.fullName||"")===d.contact));
const openDeals=schoolDeals.filter(d=>!["Closed Won","Closed Lost"].includes(d.stage));
const closedWon=schoolDeals.filter(d=>d.stage==="Closed Won");
const allDeals=schoolDeals;
const totalOpen=openDeals.reduce((a,d)=>a+(d.value||0),0);
const totalWon=closedWon.reduce((a,d)=>a+(d.value||0),0);
const primaryC=schoolContacts[0]||null;
const schoolCleanName=primaryC?.school||cleanSchoolName(selSchool);
const schoolOrgType=primaryC?.orgType||"";
const schoolClass=primaryC?.schoolClass||"";
const numAthletes=primaryC?.numAthletes||"";
const numSports=primaryC?.numSports||"";
const state=primaryC?.state||"";
const city=primaryC?.city||"";
const website=primaryC?.website||"";
const renameAccount=async()=>{
const newName=accountNameInput.trim();
if(!newName||newName===schoolCleanName){setEditingAccountName(false);return;}
setSavingAccountName(true);
try{
const r=await fetch("/api/crm/account-name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newName,city,state})});
const d=await r.json();
if(!d.ok){toast(d.error||"Could not resolve Zoho Account","error");setSavingAccountName(false);return;}
schoolContacts.forEach(c=>{
dispatch("UPDATE_CONTACT",{id:c.id,school:newName});
if(c.zohoId){
const isLead=(c.id||"").startsWith("zoho_l_");
crmUpdate(isLead?"Leads":"Contacts",c.zohoId,isLead?{Company:newName}:{Account_Name:{id:d.accountId}});
}
});
setSelSchool(state?`${newName} — ${state}`:newName);
setEditingAccountName(false);
toast(`Renamed to ${newName}${d.accountCreated?" (new Zoho Account created)":""}`,"success");
}catch(e){toast(`Rename error: ${e.message}`,"error");}
setSavingAccountName(false);
};
const enrichWebsite=async()=>{
setEnrichingWebsite(true);
try{
const r=await fetch("/api/contacts/enrich-website",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:schoolCleanName,city,state})});
const d=await r.json();
if(!d.ok){toast(d.error||"Website search failed","error");setEnrichingWebsite(false);return;}
if(!d.website){toast("Couldn't confidently find an official website","info");setEnrichingWebsite(false);return;}
// Store on every contact in the account (synced to Postgres via the same
// app-state pipeline as school/city/state) so it's visible to the whole
// team on next load — not just this browser tab.
schoolContacts.forEach(c=>dispatch("UPDATE_CONTACT",{id:c.id,website:d.website}));
try{await fetch("/api/crm/account-name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:schoolCleanName,city,state,website:d.website})});}catch{}
toast(`Found ${d.website} — saved to Zoho and shared account record`,"success");
}catch(e){toast(`Enrich error: ${e.message}`,"error");}
setEnrichingWebsite(false);
};
const sponsorshipMin=primaryC?.sponsorshipMin||null;
const sponsorshipMax=primaryC?.sponsorshipMax||null;
const sponsorshipStatus=primaryC?.sponsorshipStatus||null;
const sponsorshipConfirmed=primaryC?.sponsorshipConfirmedAmount||null;
const sponsorshipPaid=primaryC?.sponsorshipPaid||false;
const hasOnlineStore=primaryC?.hasOnlineStore||false;
const hasBoosterClub=primaryC?.hasBoosterClub||false;
const schoolInvoices=(s.invoices||[]).filter(inv=>{
const cust=(inv.customer||"").toLowerCase();
return orgNamesMatch(inv.customer,schoolCleanName)||schoolContacts.some(c=>(c.fullName||"").toLowerCase()===cust||(c.school||"").toLowerCase()===cust);
});
const totalInvoiced=schoolInvoices.reduce((a,i)=>a+(i.total||0),0);
const totalPaid=schoolInvoices.filter(i=>i.status==="paid").reduce((a,i)=>a+(i.total||0),0);
const totalOwed=schoolInvoices.filter(i=>i.status!=="paid").reduce((a,i)=>a+(i.balance||i.total||0),0);
const allItems=schoolInvoices.flatMap(inv=>(inv.items||[]).map(it=>({...it,invoiceNum:inv.number,date:inv.date})));
const itemMap={};
allItems.forEach(it=>{const k=(it.name||"").toLowerCase();if(!itemMap[k])itemMap[k]={name:it.name||"",qty:0,total:0,lastDate:""};itemMap[k].qty+=Number(it.qty||0);itemMap[k].total+=(it.total||0);if(!itemMap[k].lastDate||it.date>itemMap[k].lastDate)itemMap[k].lastDate=it.date;});
const purchasedItems=Object.values(itemMap).sort((a,b)=>b.total-a.total);
const schoolOrders=(s.orders||[]).filter(o=>schoolContacts.some(c=>c.id===o.contactId)||(o.school||"").toLowerCase()===schoolCleanName.toLowerCase());
const expandOps=[];
if(!hasOnlineStore) expandOps.push({icon:"🛒",title:"Team Store",desc:"No online store yet — potential $35/athlete in additional annual revenue"});
if(!hasBoosterClub) expandOps.push({icon:"🏅",title:"Booster Club",desc:"No booster program tracked — could add 15% revenue lift via fundraising"});
if(sponsorshipMin&&!sponsorshipStatus) expandOps.push({icon:"★",title:"Sponsorship",desc:`Estimated sponsorship potential ${fmt$(sponsorshipMin)}${sponsorshipMax?` – ${fmt$(sponsorshipMax)}`:""}`});
if(numSports&&Number(numSports)>0&&closedWon.length>0){
const sportsWithOrders=new Set(closedWon.map(d=>d.sport||"").filter(Boolean)).size;
if(sportsWithOrders<Number(numSports)) expandOps.push({icon:"🏆",title:"More Sports",desc:`${numSports} sports on file, orders only tracked for ${sportsWithOrders} — expand to other programs`});
}
if(schoolInvoices.length>0&&closedWon.length>0) expandOps.push({icon:"🔄",title:"Reorder Timing",desc:`Last order ${schoolInvoices[0]?.date||"on file"} — check if next season procurement is open`});
const SectionHdr=({children,sub})=>(
<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,marginTop:20,paddingTop:16,borderTop:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5}}>{children}</div>
{sub&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{sub}</div>}
</div>
);
return(
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
{/* Header */}
<div style={{padding:"16px 22px 12px",borderBottom:`1px solid ${B.border}`,background:B.white,flexShrink:0}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:3}}>{schoolOrgType==="school"?"SCHOOL / DISTRICT":schoolOrgType==="college"?"COLLEGE / UNIVERSITY":"ORGANIZATION"}</div>
{editingAccountName?(
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<input autoFocus value={accountNameInput} onChange={e=>setAccountNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")renameAccount();if(e.key==="Escape")setEditingAccountName(false);}} style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,border:`1px solid ${B.orange}`,borderRadius:4,padding:"3px 8px",minWidth:220}}/>
<button onClick={renameAccount} disabled={savingAccountName} style={{background:B.orange,border:"none",color:B.white,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer"}}>{savingAccountName?"SAVING...":"SAVE"}</button>
<button onClick={()=>setEditingAccountName(false)} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>CANCEL</button>
</div>
):(
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{schoolCleanName}</div>
<button onClick={()=>{setAccountNameInput(schoolCleanName==="(No School)"?"":schoolCleanName);setEditingAccountName(true);}} title="Rename account" style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:12,padding:2}}>✎</button>
{!website&&<button onClick={enrichWebsite} disabled={enrichingWebsite} title="Search for this org's official website and save it to Zoho" style={{background:"none",border:`1px solid ${B.border}`,color:enrichingWebsite?B.muted:B.blue,borderRadius:4,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:enrichingWebsite?"default":"pointer",letterSpacing:.3,whiteSpace:"nowrap"}}>{enrichingWebsite?"SEARCHING…":"🔍 ENRICH"}</button>}
</div>
)}
<div style={{display:"flex",gap:10,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
{website&&<a href={website} target="_blank" rel="noreferrer" style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>{website.replace(/^https?:\/\//,"")}</a>}
{schoolClass&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}15`,padding:"2px 8px",borderRadius:3}}>{schoolClass}</span>}
{(city||state)&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[city,state].filter(Boolean).join(", ")}</span>}
{numAthletes&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{numAthletes} athletes</span>}
{numSports&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{numSports} sports</span>}
{hasOnlineStore&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:`${B.green}18`,padding:"2px 6px",borderRadius:3}}>TEAM STORE</span>}
{hasBoosterClub&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple||"#7c3aed",background:"#7c3aed18",padding:"2px 6px",borderRadius:3}}>BOOSTER CLUB</span>}
</div>
</div>
{/* Revenue summary */}
<div style={{display:"flex",gap:8,flexShrink:0}}>
{totalWon>0&&(
<div style={{textAlign:"right",background:B.greenBg||`${B.green}10`,border:`1px solid ${B.green}30`,borderRadius:6,padding:"8px 12px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,letterSpacing:1}}>WON</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.green}}>{fmt$(totalWon)}</div>
</div>
)}
{totalOpen>0&&(
<div style={{textAlign:"right",background:`${B.orange}08`,border:`1px solid ${B.orange}25`,borderRadius:6,padding:"8px 12px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:1}}>PIPELINE</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.orange}}>{fmt$(totalOpen)}</div>
</div>
)}
{sponsorshipMin&&(
<div style={{textAlign:"right",background:"#7c3aed08",border:"1px solid #7c3aed25",borderRadius:6,padding:"8px 12px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:"#7c3aed",letterSpacing:1}}>SPONS. EST.</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:"#7c3aed"}}>{fmt$(sponsorshipMin)}</div>
</div>
)}
</div>
</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"12px 22px 30px"}}>
{/* Action bar */}
<div style={{display:"flex",gap:8,marginBottom:4,paddingTop:6}}>
<OBtn sm onClick={()=>{setTtContact(schoolContacts[0]||null);setTtView(true);}}>⤳ TALK TRACK</OBtn>
<GBtn sm onClick={()=>{setAddForm(f=>({...f,school:schoolCleanName}));setShowAddContact(true);}}>+ ADD CONTACT</GBtn>
</div>
{/* ── KPI STRIP ── */}
<div className="rv-kpi-grid" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginTop:14,marginBottom:4}}>
<KCard l="Total Invoiced" v={fmt$K(totalInvoiced)} c={B.orange}/>
<KCard l="Paid" v={fmt$K(totalPaid)} c={B.green}/>
<KCard l="Outstanding" v={fmt$K(totalOwed)} c={totalOwed>0?B.red:B.muted}/>
<KCard l="Open Deals" v={openDeals.length} c={B.blue} sub={fmt$K(totalOpen)}/>
<KCard l="Closed Won" v={closedWon.length} c={B.green} sub={fmt$K(totalWon)}/>
</div>
{/* ── ACCOUNT INFO ── */}
<SectionHdr>ACCOUNT INFO</SectionHdr>
<div className="rv-info-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,background:B.surface,borderRadius:6,padding:14,border:`1px solid ${B.border}`}}>
{[
["School Class",schoolClass||"—"],
["Location",[city,state].filter(Boolean).join(", ")||"—"],
["Org Type",schoolOrgType||"—"],
["# Athletes",numAthletes||"—"],
["# Sports",numSports||"—"],
["Team Store",hasOnlineStore?"Yes":"No"],
["Booster Club",hasBoosterClub?"Yes":"No"],
["Contacts",schoolContacts.length],
["Open Deals",openDeals.length],
].map(([k,v])=>(
<div key={k}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>{k}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{v}</div>
</div>
))}
</div>
{/* ── STAFF COVERAGE ── */}
<SectionHdr sub={hasPositiveIntent&&coverage.gaps.length>0?"Positive intent on file — go fill the gaps below":undefined}>STAFF COVERAGE</SectionHdr>
<div style={{background:B.surface,borderRadius:6,padding:14,border:`1px solid ${B.border}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>ATHLETIC DIRECTOR</span>
{coverage.adContact?
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green,fontWeight:500}}>{cName(coverage.adContact)}</span>
:<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.border,padding:"2px 7px",borderRadius:3}}>NOT ON FILE</span>}
</div>
{coverage.gaps.length>0&&hasPositiveIntent&&(
<OBtn sm color={B.teal} disabled={findingStaff} onClick={()=>findMissingStaff(schoolCleanName,city,state,coverage.gaps,!coverage.adContact)}>{findingStaff?"SEARCHING…":"🔎 FIND MISSING STAFF"}</OBtn>
)}
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{ACCOUNT_SPORTS.map(sp=>{
const c=coverage.covered.get(sp);
return(
<span key={sp} title={c?cName(c):"Not on file"} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,letterSpacing:.3,padding:"3px 8px",borderRadius:3,color:c?B.green:B.muted,background:c?`${B.green}15`:B.border}}>{sp}{c?" ✓":""}</span>
);
})}
</div>
{coverage.gaps.length>0&&!hasPositiveIntent&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:8}}>{coverage.gaps.length} sport{coverage.gaps.length!==1?"s":""} with no coach on file — search unlocks once someone here shows positive intent.</div>}
</div>
{/* ── SPONSORSHIP ── */}
{(sponsorshipMin||sponsorshipStatus)&&(
<>
<SectionHdr sub={sponsorshipStatus?sponsorshipStatus.toUpperCase():""}>SPONSORSHIP</SectionHdr>
<div style={{background:sponsorshipPaid?B.greenBg||`${B.green}10`:sponsorshipStatus==="confirmed"?`${B.orange}08`:`#7c3aed08`,border:`1px solid ${sponsorshipPaid?B.green:sponsorshipStatus==="confirmed"?B.orange:"#7c3aed"}30`,borderRadius:6,padding:14}}>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>ESTIMATED MIN</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:"#7c3aed"}}>{fmt$(sponsorshipMin||0)}</div>
</div>
{sponsorshipMax&&<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>UPSIDE MAX</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.orange}}>{fmt$(sponsorshipMax)}</div>
</div>}
{sponsorshipConfirmed&&<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>CONFIRMED AMT</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.green}}>{fmt$(sponsorshipConfirmed)}</div>
</div>}
</div>
{sponsorshipPaid&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green,marginTop:8}}>✓ PAID</div>}
</div>
</>
)}
{/* ── CONTACTS ── */}
<SectionHdr sub={`${schoolContacts.length} total`}>CONTACTS / COACHES</SectionHdr>
{schoolContacts.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No contacts yet.</div>}
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{schoolContacts.map(c=>{
const {cd,phase}=getCD(c);
const top=cd.find(d=>!["Closed Won","Closed Lost"].includes(d.stage))||cd[0];
const pc=PCOL[phase];
return(
<div key={c.id} onClick={()=>{setLeftMode("contacts");setSelId(c.id);setSelSchool(null);}} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"10px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text}}>{cName(c)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{[c.title,c.sport,c.email].filter(Boolean).join(" · ")}</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
{top&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:DSC[top.stage]||B.muted}}>{top.stage} · {fmt$(top.value||0)}</div>}
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:pc,background:`${pc}18`,padding:"2px 6px",borderRadius:3}}>{phase}</span>
</div>
</div>
);
})}
</div>
{/* ── ALL DEALS ── */}
{allDeals.length>0&&(<>
<SectionHdr sub={`${allDeals.length} total · ${fmt$K(allDeals.reduce((a,d)=>a+(d.value||0),0))} pipeline`}>DEALS</SectionHdr>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{allDeals.sort((a,b)=>{const o=["Closed Won","Closed Lost"];const ai=o.includes(a.stage)?1:0;const bi=o.includes(b.stage)?1:0;return ai-bi;}).map(d=>(
<div key={d.id} style={{background:B.white,border:`1px solid ${["Closed Won"].includes(d.stage)?B.green:["Closed Lost"].includes(d.stage)?B.border:B.border}`,borderLeft:`3px solid ${DSC[d.stage]||B.muted}`,borderRadius:6,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500,color:B.text}}>{d.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{d.contact||""}{d.quoteNumber?` · Quote #${d.quoteNumber}`:""}</div>
</div>
<div style={{textAlign:"right",flexShrink:0}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:DSC[d.stage]||B.muted}}>{d.stage}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,fontWeight:500}}>{fmt$(d.value||0)}</div>
</div>
</div>
))}
</div>
</>)}
{/* ── INVOICES & PAYMENTS ── */}
{schoolInvoices.length>0&&(<>
<SectionHdr sub={`${schoolInvoices.length} invoices · ${fmt$K(totalInvoiced)} total`}>INVOICES & PAYMENTS</SectionHdr>
<div style={{display:"flex",flexDirection:"column",gap:5}}>
{schoolInvoices.map(inv=>(
<div key={inv.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 13px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>#{inv.number||inv.id}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{inv.date||""}</div>
</div>
<div style={{display:"flex",gap:12,alignItems:"center"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:inv.status==="paid"?B.green:inv.status==="overdue"?B.red:B.orange}}>{(inv.status||"").toUpperCase()}</span>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{fmt$(inv.total||0)}</div>
{inv.balance>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.red}}>Owed: {fmt$(inv.balance)}</div>}
</div>
</div>
</div>
))}
</div>
</>)}
{/* ── CONTACTS FROM BOOKS ── */}
{schoolInvoices.length>0&&schoolInvoices[0].customerId&&(()=>{
const booksCustomerId=schoolInvoices[0].customerId;
const bContacts=booksContactsByCustomer[booksCustomerId];
return(<>
<SectionHdr sub={bContacts?`${bContacts.length} contact${bContacts.length!==1?"s":""}`:undefined}>CONTACTS (FROM BOOKS)</SectionHdr>
{!bContacts?(
<button onClick={()=>loadBooksContacts(booksCustomerId)} disabled={loadingBooksContacts===booksCustomerId} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>{loadingBooksContacts===booksCustomerId?"LOADING…":"LOAD CONTACTS FROM BOOKS"}</button>
):bContacts.length===0?(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No contact persons on file in Books for this customer.</div>
):(
<div style={{display:"flex",flexDirection:"column",gap:5}}>
{bContacts.map((c,i)=>(
<div key={i} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 13px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.name}{c.isPrimary&&<span style={{marginLeft:6,fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange}}>PRIMARY</span>}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"right"}}>{c.email}{c.phone?` · ${c.phone}`:""}</div>
</div>
))}
</div>
)}
</>);
})()}
{/* ── ITEMS PURCHASED ── */}
{purchasedItems.length>0&&(<>
<SectionHdr sub={`${allItems.length} line items across ${schoolInvoices.length} invoice${schoolInvoices.length!==1?"s":""}`}>ITEMS PURCHASED</SectionHdr>
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden"}}>
<div style={{display:"grid",gridTemplateColumns:"1fr 60px 80px 60px",gap:0}}>
{["ITEM","QTY","TOTAL","LAST"].map(h=>(
<div key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,padding:"7px 12px",background:B.surface,borderBottom:`1px solid ${B.border}`}}>{h}</div>
))}
</div>
{purchasedItems.map((it,i)=>(
<div key={i} style={{display:"grid",gridTemplateColumns:"1fr 60px 80px 60px",gap:0,borderBottom:i<purchasedItems.length-1?`1px solid ${B.border}`:"none"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"7px 12px"}}>{it.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"7px 12px",textAlign:"center"}}>{it.qty}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,padding:"7px 12px",textAlign:"right",fontWeight:500}}>{fmt$(it.total)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"7px 12px"}}>{it.lastDate||"—"}</div>
</div>
))}
</div>
</>)}
{/* ── ORDERS ── */}
{schoolOrders.length>0&&(<>
<SectionHdr sub={`${schoolOrders.length} order${schoolOrders.length!==1?"s":""}`}>ORDERS</SectionHdr>
<div style={{display:"flex",flexDirection:"column",gap:5}}>
{schoolOrders.map(o=>(
<div key={o.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 13px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{o.name||"Order"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{o.contact||""}{o.createdAt?` · ${new Date(o.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:""}</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted}}>{o.stage||o.status||""}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange}}>{fmt$(o.value||0)}</div>
</div>
</div>
))}
</div>
</>)}
{/* ── EXPANSION OPPORTUNITIES ── */}
{expandOps.length>0&&(<>
<SectionHdr>EXPANSION OPPORTUNITIES</SectionHdr>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{expandOps.map((op,i)=>(
<div key={i} style={{background:`${B.orange}05`,border:`1px solid ${B.orange}20`,borderLeft:`3px solid ${B.orange}`,borderRadius:5,padding:"10px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
<span style={{fontSize:16,flexShrink:0}}>{op.icon}</span>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:600,color:B.text,marginBottom:2}}>{op.title}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.4}}>{op.desc}</div>
</div>
</div>
))}
</div>
</>)}
</div>
</div>
);
})():!sel?(
<div style={{flex:1,overflowY:"auto",padding:"22px 26px"}}>
{(()=>{
const openDeals=(s.deals||[]).filter(d=>!["Closed Won","Closed Lost","PO Received"].includes(d.stage));
const myDeals=openDeals.filter(d=>d.repId===cu?.id||d.assignee===cu?.id||!d.repId);
const overdue=openDeals.filter(d=>d.followUpDate&&dUntil(d.followUpDate)<0);
const myPipeline=myDeals.reduce((a,d)=>a+(d.value||0),0);
const totalContacts=(s.contacts||[]).filter(c=>!c.deadStatus).length;
return(<>
{/* Stats */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:22}}>
<KCard l="Open Deals" v={openDeals.length} c={B.orange} sub={`${fmt$K(openDeals.reduce((a,d)=>a+(d.value||0),0))} pipeline`}/>
<KCard l="My Deals" v={myDeals.length} c={B.blue} sub={fmt$K(myPipeline)}/>
<KCard l="Overdue Tasks" v={overdue.length} c={overdue.length>0?B.red:B.green}/>
<KCard l="Contacts" v={totalContacts} c={B.muted}/>
</div>
{/* Overdue follow-ups */}
{overdue.length>0&&(
<div style={{marginBottom:22}}>
<Lbl s={{marginBottom:8,color:B.red}}>OVERDUE FOLLOW-UPS</Lbl>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{overdue.slice(0,5).map(d=>{
const c=(s.contacts||[]).find(ct=>ct.id===d.contactId||(ct.fullName||"")===d.contact);
return(
<div key={d.id} onClick={()=>setSelId(c?.id)} style={{background:B.white,border:`1px solid ${B.red}30`,borderLeft:`3px solid ${B.red}`,borderRadius:4,padding:"9px 13px",cursor:c?"pointer":"default",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text}}>{d.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{d.contact||"—"} · {d.stage}</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red}}>{Math.abs(dUntil(d.followUpDate))}d OVERDUE</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange}}>{fmt$(d.value||0)}</div>
</div>
</div>
);
})}
</div>
</div>
)}
{/* My open deals */}
<div style={{marginBottom:22}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<Lbl>MY OPEN DEALS</Lbl>
<GBtn sm onClick={()=>setMod("deals")}>View all →</GBtn>
</div>
{myDeals.length===0?(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"14px 0"}}>No open deals — start a Talk Track to create one.</div>
):(
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{myDeals.slice(0,8).map(d=>{
const c=(s.contacts||[]).find(ct=>ct.id===d.contactId||(ct.fullName||"")===d.contact);
const dsc=DSC[d.stage]||B.muted;
return(
<div key={d.id} onClick={()=>c&&setSelId(c.id)} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"9px 13px",cursor:c?"pointer":"default",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text}}>{d.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{d.contact||c&&(c.fullName||"")}</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:dsc}}>{d.stage}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,fontWeight:500}}>{fmt$(d.value||0)}</div>
</div>
</div>
);
})}
</div>
)}
</div>
{/* Quick actions */}
<div style={{display:"flex",gap:8}}>
<OBtn sm onClick={()=>{setTtContact(null);setTtView(true);}}>⤳ NEW TALK TRACK</OBtn>
</div>
</>);
})()}
</div>
):(
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
{/* Header */}
<div style={{padding:"16px 22px 12px",borderBottom:`1px solid ${B.border}`,background:B.white,flexShrink:0}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black}}>{cName(sel)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{(()=>{const t=typeof sel.title==="string"?sel.title:sel.title?.name||"";const sc=typeof sel.school==="string"?sel.school:sel.school?.name||"";return(<>{t}{t&&sc?" · ":""}{sc}{sel.state?` · ${sel.state}`:""}</>);})()}</div>
<div style={{display:"flex",gap:10,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
{sel.email&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>✉ {sel.email}</span>}
{sel.phone&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>☎ {sel.phone}</span>}
<select
value={sel.sport||""}
onChange={e=>{
const sp=e.target.value;
dispatch("UPDATE_CONTACT",{id:sel.id,sport:sp});
setPF("sport",sp);
if(sel.zohoId){const isLead=sel.id?.startsWith("zoho_l_");crmAddNote(isLead?"Leads":"Contacts",sel.zohoId,`Sport: ${sp}`);}
}}
style={{background:sel.sport?B.purpleBg:B.surface,border:`1px solid ${sel.sport?B.purple:B.border}30`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:sel.sport?B.purple:B.muted,letterSpacing:.5,cursor:"pointer"}}
>
<option value="">+ SET SPORT</option>
{COMMON_SPORTS.map(sp=><option key={sp}>{sp}</option>)}
</select>
</div>
<div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Owner:</span>
<select
value={sel.ownerId||""}
onChange={e=>{
const newOwner=e.target.value;
dispatch("UPDATE_CONTACT",{id:sel.id,ownerId:newOwner||null});
const rep=(s.reps||[]).find(r=>r.id===newOwner);
toast(`Assigned to ${rep?.name||"unassigned"}`,"success");
}}
style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"2px 6px",fontSize:10,color:B.text,fontFamily:"'Lexend',sans-serif"}}
>
<option value="">Unassigned</option>
{(s.reps||[]).map(r=>(
<option key={r.id} value={r.id}>{r.name}{r.id===cu?.id?" (me)":""}</option>
))}
</select>
</div>
</div>
<OBtn sm onClick={()=>{setTtContact({id:sel.id,name:cName(sel),school:sel.school||"",email:sel.email||"",module:"Contact"});setTtView(true);}}>⤳ TALK TRACK</OBtn>
</div>
{/* Phase timeline */}
<div style={{display:"flex",alignItems:"center"}}>
{PHASES.map((p,i)=>{
const cur=phaseIdx[selCD.phase];
const done=i<=cur; const active=i===cur;
const col=done?(active?PCOL[p.id]:B.green):B.border;
return(
<React.Fragment key={p.id}>
<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
<div style={{width:24,height:24,borderRadius:"50%",background:done?col:B.surface,border:`2px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
{i<cur?<span style={{color:B.white,fontSize:9}}>✓</span>:<span style={{width:7,height:7,borderRadius:"50%",background:active?col:B.border,display:"block"}}/>}
</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:done?col:B.muted,letterSpacing:.5}}>{p.label.toUpperCase()}</div>
</div>
{i<PHASES.length-1&&<div style={{flex:1,height:2,background:i<cur?B.green:B.border,margin:"0 4px",marginBottom:16}}/>}
</React.Fragment>
);
})}
</div>
</div>
{/* Tabs */}
<div style={{display:"flex",borderBottom:`1px solid ${B.border}`,background:B.white,flexShrink:0}}>
{[["overview","Profile"],["history","History"],["discovery","Discovery"],["deal","Deal"],["quote","Quote"],["order","Order"],...(sel.phone&&isWarmContact(sel,selCD,s.invoices)?[["sms","Text"]]:[])].map(([id,label])=>(
<button key={id} onClick={()=>setCrmTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${crmTab===id?B.orange:"transparent"}`,color:crmTab===id?B.orange:B.muted,padding:"8px 16px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,letterSpacing:1.5,fontWeight:700,cursor:"pointer",position:"relative"}}>
{label}
{id==="discovery"&&sel.ttCompletedAt&&<span style={{position:"absolute",top:6,right:4,width:6,height:6,borderRadius:"50%",background:B.green,display:"block"}}/>}
</button>
))}
</div>
{/* Tab content */}
<div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
{crmTab==="overview"&&(()=>{
const iS={width:"100%",boxSizing:"border-box",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"};
return(
<div>
{/* ── CONTACT PROFILE ── */}
<div className="card" style={{padding:14,marginBottom:14}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<Lbl>CONTACT PROFILE</Lbl>
<div style={{display:"flex",gap:7,alignItems:"center"}}>
{profileDirty&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange}}>Unsaved changes</span>}
<OBtn sm onClick={saveProfile} disabled={zohoSyncing||!profileDirty}>
{zohoSyncing?"SYNCING…":sel.zohoId?"SAVE + SYNC TO ZOHO":"SAVE"}
</OBtn>
</div>
</div>
{/* Name */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3,fontSize:8}}>First Name</Lbl><input value={profileForm.firstName||""} onChange={e=>setPF("firstName",e.target.value)} style={iS}/></div>
<div><Lbl s={{marginBottom:3,fontSize:8}}>Last Name</Lbl><input value={profileForm.lastName||""} onChange={e=>setPF("lastName",e.target.value)} style={iS}/></div>
</div>
{/* Title + Sport (prominent) */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3,fontSize:8}}>Title / Role</Lbl><input value={profileForm.title||""} onChange={e=>setPF("title",e.target.value)} style={iS}/></div>
<div>
<Lbl s={{marginBottom:3,fontSize:8,color:B.purple,letterSpacing:1}}>★ SPORT</Lbl>
<select value={profileForm.sport||""} onChange={e=>setPF("sport",e.target.value)}
style={{...iS,border:`1.5px solid ${profileForm.sport?B.purple:B.border}`,color:profileForm.sport?B.purple:B.muted,fontWeight:profileForm.sport?600:400}}>
<option value="">— Select sport —</option>
{COMMON_SPORTS.map(sp=><option key={sp}>{sp}</option>)}
</select>
</div>
</div>
{/* School + State + City */}
<div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3,fontSize:8}}>School / Organization</Lbl><input value={profileForm.school||""} onChange={e=>setPF("school",e.target.value)} style={iS}/></div>
<div><Lbl s={{marginBottom:3,fontSize:8}}>State</Lbl><select value={profileForm.state||""} onChange={e=>setPF("state",e.target.value)} style={iS}><option value="">—</option>{STATES_LIST.map(st=><option key={st}>{st}</option>)}</select></div>
<div><Lbl s={{marginBottom:3,fontSize:8}}>City</Lbl><input value={profileForm.city||""} onChange={e=>setPF("city",e.target.value)} style={iS}/></div>
</div>
{/* Email + Phone */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3,fontSize:8}}>Email</Lbl><input type="email" value={profileForm.email||""} onChange={e=>setPF("email",e.target.value)} style={iS}/></div>
<div><Lbl s={{marginBottom:3,fontSize:8}}>Phone</Lbl><input type="tel" value={profileForm.phone||""} onChange={e=>setPF("phone",e.target.value)} style={iS}/></div>
</div>
{/* Org details */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
<div>
<Lbl s={{marginBottom:3,fontSize:8}}>School Class</Lbl>
<select value={profileForm.schoolClass||""} onChange={e=>setPF("schoolClass",e.target.value)} style={iS}>
<option value="">—</option>
{["1A","2A","3A","4A","5A","6A","7A","College","Other"].map(c=><option key={c}>{c}</option>)}
</select>
</div>
<div><Lbl s={{marginBottom:3,fontSize:8}}># Athletes</Lbl><input type="number" value={profileForm.numAthletes||""} onChange={e=>setPF("numAthletes",e.target.value)} style={iS}/></div>
<div><Lbl s={{marginBottom:3,fontSize:8}}># Sports</Lbl><input type="number" value={profileForm.numSports||""} onChange={e=>setPF("numSports",e.target.value)} style={iS}/></div>
<div>
<Lbl s={{marginBottom:3,fontSize:8}}>Priority</Lbl>
<select value={profileForm.priority||"medium"} onChange={e=>setPF("priority",e.target.value)} style={iS}>
{["hot","warm","medium","cold"].map(p=><option key={p}>{p}</option>)}
</select>
</div>
</div>
</div>
{/* ── ACTIVITY SUMMARY ── */}
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
<KCard l="Score" v={sel.score||0} c={B.orange}/>
<KCard l="Status" v={(sel.outreachStatus||"new").toUpperCase()} c={B.blue}/>
<KCard l="Phase" v={selCD.phase.toUpperCase()} c={PCOL[selCD.phase]}/>
</div>
{/* Source + last contact */}
{(sel.source||sel.lastOutreach||sel.importedAt)&&(
<div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap"}}>
{sel.source&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Source: <strong>{sel.source}</strong></span>}
{sel.lastOutreach&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Last contacted: <strong>{sel.lastOutreach}</strong></span>}
{sel.importedAt&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Added: <strong>{new Date(sel.importedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</strong></span>}
</div>
)}
{/* ── PIPELINE SUMMARY ── */}
{(selCD.cd.length>0||selCD.co.length>0)?(
<div className="card" style={{padding:14}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<Lbl>PIPELINE</Lbl>
<OBtn sm onClick={()=>setCrmTab("deal")}>+ NEW DEAL</OBtn>
</div>
{selCD.cd.map(d=>(
<div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.border}`}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text}}>{d.name}</div>
<div style={{marginTop:2}}><Pill v={d.stage} sc={DSC} bc={DBG}/></div>
</div>
<div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
{overviewEditDealId===d.id?(
<div style={{display:"flex",gap:4,alignItems:"center"}}>
<input type="number" value={overviewEditValue} onChange={e=>setOverviewEditValue(e.target.value)} autoFocus style={{width:80,background:B.surface,border:`1px solid ${B.orange}`,color:B.orange,borderRadius:4,padding:"3px 6px",fontSize:12,fontFamily:"'Russo One',sans-serif",textAlign:"right"}}/>
<OBtn sm onClick={()=>{const v=Number(overviewEditValue||0);dispatch("UPDATE_DEAL",{id:d.id,value:v});crmUpdate("Deals",d.zohoId,{Amount:v});setOverviewEditDealId(null);toast("Updated","success");}}>SAVE</OBtn>
<button onClick={()=>setOverviewEditDealId(null)} style={{background:"none",border:"none",color:B.muted,fontSize:12,cursor:"pointer"}}>✕</button>
</div>
):(
<div style={{display:"flex",gap:5,alignItems:"center"}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.orange}}>{fmt$(d.value||0)}</div>
<button onClick={()=>{setOverviewEditDealId(d.id);setOverviewEditValue(String(d.value||0));}} style={{background:"none",border:"none",color:B.muted,fontSize:11,cursor:"pointer"}}>✎</button>
</div>
)}
{d.followUpDate&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:dUntil(d.followUpDate)<0?B.red:B.muted}}>Due {d.followUpDate}</div>}
</div>
</div>
))}
{selCD.co.map(o=>(
<div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.border}`}}>
<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text}}>{o.name}</div><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"2px 6px",borderRadius:3}}>ORDER</span></div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.green}}>{fmt$(o.value||0)}</div>
</div>
))}
</div>
):(
<div style={{background:B.surface,borderRadius:6,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${B.border}`}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No deals or orders yet</span>
<OBtn sm onClick={()=>setCrmTab("deal")}>+ START DEAL</OBtn>
</div>
)}
</div>
);
})()}
{crmTab==="discovery"&&(
<div>
{!sel.ttCompletedAt?(
<div style={{textAlign:"center",padding:"40px 0"}}>
<div style={{fontSize:28,marginBottom:10}}>⤳</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:14}}>No Talk Track completed yet for this contact.</div>
<OBtn onClick={()=>{setTtContact(sel);setTtView(true);}}>START TALK TRACK</OBtn>
</div>
):(
<>
{/* Sponsorship estimate */}
{sel.sponsorshipMin&&(
<div style={{background:`${B.orange}08`,border:`1px solid ${B.orange}30`,borderRadius:8,padding:"14px 18px",marginBottom:16}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1.5,marginBottom:6}}>SPONSORSHIP ESTIMATE</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:28,color:B.orange,lineHeight:1.1}}>{fmt$(sel.sponsorshipMin)}<span style={{fontSize:13,marginLeft:6}}>guaranteed</span></div>
{sel.sponsorshipMax&&sel.sponsorshipMax>sel.sponsorshipMin&&(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:4}}>Up to {fmt$(sel.sponsorshipMax - sel.sponsorshipMin)} additional based on actual sales</div>
)}
</div>
)}
{/* Org profile */}
<div className="card" style={{padding:14,marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:10}}>ORG PROFILE</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
{[
["Type", sel.orgType==="school"?"School / District":sel.orgType==="college"?"College / University":sel.orgType?"Organization / Club":"—"],
["School Class", sel.schoolClass||"—"],
["# Athletes", sel.numAthletes||"—"],
["# Sports", sel.numSports||"—"],
].map(([l,v])=>(
<div key={l}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginBottom:2}}>{l}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{v}</div>
</div>
))}
</div>
</div>
{/* Confirmed pain points */}
{Array.isArray(sel.ttPains)&&sel.ttPains.length>0&&(
<div className="card" style={{padding:14,marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:10}}>CONFIRMED PAIN POINTS</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{sel.ttPains.map(p=>(
<div key={p} style={{display:"flex",alignItems:"center",gap:8,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
<span style={{color:B.orange,fontWeight:700}}>✓</span>{p}
</div>
))}
</div>
</div>
)}
{/* Call Q&A */}
{Array.isArray(sel.ttAnswers)&&sel.ttAnswers.length>0&&(
<div className="card" style={{padding:14,marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:10}}>CALL NOTES</div>
<div style={{display:"flex",flexDirection:"column",gap:10}}>
{sel.ttAnswers.map((qa,i)=>(
<div key={i}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:2}}>{qa.question}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{qa.answer}</div>
</div>
))}
</div>
</div>
)}
{/* Sponsorship actions */}
{sel.sponsorshipMin&&(
<div style={{display:"flex",gap:8,marginTop:6,marginBottom:8}}>
{sel.sponsorshipStatus==="confirmed"?(
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,border:`1px solid ${B.green}30`,borderRadius:4,padding:"4px 10px"}}>★ SPONSORSHIP CONFIRMED — {fmt$(sel.sponsorshipConfirmedAmount||sel.sponsorshipMin)}</span>
):(
<OBtn sm col={B.green} onClick={()=>{dispatch("UPDATE_CONTACT",{id:sel.id,sponsorshipStatus:"confirmed",sponsorshipConfirmedAmount:sel.sponsorshipMin,sponsorshipConfirmedAt:new Date().toISOString(),sponsorshipPaid:false});toast("Sponsorship confirmed!","success");}}>★ CONFIRM SPONSORSHIP</OBtn>
)}
<GBtn sm onClick={()=>setMod("sponsorships")}>View all sponsorships →</GBtn>
</div>
)}
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,textAlign:"right"}}>
Talk Track completed {new Date(sel.ttCompletedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
</div>
</>
)}
</div>
)}
{crmTab==="deal"&&(
<div>
{!activeDeal&&!showNewDeal&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:12}}>No deal yet</div><OBtn onClick={()=>setShowNewDeal(true)}>+ CREATE DEAL</OBtn></div>}
{showNewDeal&&(
<div className="card" style={{padding:14,marginBottom:14}}>
<Lbl s={{marginBottom:10}}>New Deal</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3}}>Deal Name</Lbl><input value={dealForm.name} onChange={e=>setDealForm(f=>({...f,name:e.target.value}))} placeholder={`${cName(sel)} — Equipment`} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div><Lbl s={{marginBottom:3}}>Value ($)</Lbl><input type="number" value={dealForm.value} onChange={e=>setDealForm(f=>({...f,value:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div><Lbl s={{marginBottom:3}}>Stage</Lbl><select value={dealForm.stage} onChange={e=>setDealForm(f=>({...f,stage:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}>{DEAL_STAGES.map(st=><option key={st}>{st}</option>)}</select></div>
<div><Lbl s={{marginBottom:3}}>Product</Lbl><select value={dealForm.product} onChange={e=>setDealForm(f=>({...f,product:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}><option value="">— Select —</option>{PRODUCT_CATS.map(p=><option key={p}>{p}</option>)}</select></div>
</div>
<div style={{display:"flex",gap:6}}>
<OBtn onClick={()=>{
if(!dealForm.name) return;
const d={id:mkId(),name:dealForm.name,contact:cName(sel),contactId:sel.id,school:sel.school||"",state:sel.state||"",value:Number(dealForm.value||0),stage:dealForm.stage,product:dealForm.product,priority:"warm",createdAt:today(),followUpDate:"",notes:"",touchHistory:[],notes_list:[]};
dispatch("ADD_DEAL",d);
pushDealToZoho({dealName:d.name,amount:d.value,stage:d.stage,accountName:d.school,accountState:d.state}).then(dd=>{if(dd.dealId)dispatch("UPDATE_DEAL",{id:d.id,zohoId:dd.dealId});});
setShowNewDeal(false);setDealForm({name:"",value:"",stage:"Quoted",product:""});toast("Deal created","success");
}}>SAVE DEAL</OBtn>
<GBtn onClick={()=>setShowNewDeal(false)}>Cancel</GBtn>
</div>
</div>
)}
{activeDeal&&(
<>
<div className="card" style={{padding:14,marginBottom:12,borderTop:`3px solid ${DSC[activeDeal.stage]||B.orange}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
<div><div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>{activeDeal.name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{typeof activeDeal.school==="string"?activeDeal.school:activeDeal.school?.name||""}</div></div>
<div><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,textAlign:"right",marginBottom:2}}>VALUE ($)</div><div style={{display:"flex",gap:4,alignItems:"center"}}><input type="number" value={dealValueInput} onChange={e=>{setDealValueInput(e.target.value);setDealValueSaved(false);}} style={{width:90,background:B.surface,border:`1px solid ${B.orange}`,color:B.orange,borderRadius:4,padding:"4px 7px",fontSize:13,fontFamily:"'Russo One',sans-serif",textAlign:"right"}}/>{dealValueSaved?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green}}>✓</span>:<OBtn sm onClick={()=>{const v=Number(dealValueInput||0);dispatch("UPDATE_DEAL",{id:activeDeal.id,value:v});crmUpdate("Deals",activeDeal.zohoId,{Amount:v});setDealValueSaved(true);setTimeout(()=>setDealValueSaved(false),2000);toast("Deal value updated","success");}}>SAVE</OBtn>}</div></div>
</div>
<Lbl s={{marginBottom:5}}>Stage</Lbl>
<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
{DEAL_STAGES.map(st=>(
<button key={st} onClick={()=>{const prevStage=activeDeal.stage;dispatch("UPDATE_DEAL",{id:activeDeal.id,stage:st});crmUpdate("Deals",activeDeal.zohoId,{Stage:st});toast("Stage updated","success");if(st==="Quoted")setCrmTab("quote");autoInvoiceOnClosedWon(activeDeal,prevStage,st,toast);}} style={{background:activeDeal.stage===st?DSC[st]:B.surface,color:activeDeal.stage===st?B.white:B.muted,border:`1px solid ${activeDeal.stage===st?DSC[st]:B.border}`,borderRadius:3,padding:"3px 7px",fontSize:9,cursor:"pointer"}}>{st}</button>
))}
</div>
<div style={{display:"flex",gap:6,marginBottom:10}}>
<input type="date" value={activeDeal.followUpDate||""} onChange={e=>{dispatch("UPDATE_DEAL",{id:activeDeal.id,followUpDate:e.target.value});crmUpdate("Deals",activeDeal.zohoId,{Closing_Date:e.target.value});}} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
<GBtn onClick={()=>dispatch("UPDATE_DEAL",{id:activeDeal.id,followUpDate:new Date(Date.now()+86400000*7).toISOString().slice(0,10)})}>+7d</GBtn>
</div>
<OBtn onClick={doDraftEmail} disabled={drafting} style={{width:"100%"}}>{drafting?"WRITING...":"✦ DRAFT FOLLOW-UP"}</OBtn>
{draft&&<div style={{marginTop:10,background:B.surface,borderRadius:4,padding:9}}><textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={7} style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical",boxSizing:"border-box"}}/><GBtn onClick={()=>navigator.clipboard?.writeText(draft)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn></div>}
</div>
<div className="card" style={{padding:14}}>
<Lbl s={{marginBottom:7}}>Touch History</Lbl>
<div style={{display:"flex",gap:6,marginBottom:7}}>
<input value={touchNote} onChange={e=>setTouchNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&logTouch()} placeholder="Log a call, email, note..." style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11}}/>
<OBtn sm col={B.green} onClick={logTouch}>LOG</OBtn>
</div>
<div style={{maxHeight:150,overflowY:"auto"}}>
{[...(activeDeal.touchHistory||[])].reverse().map(t=>(
<div key={t.id} style={{display:"flex",gap:7,padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>
<div style={{width:6,height:6,borderRadius:"50%",background:B.orange,marginTop:4,flexShrink:0}}/>
<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{t.note}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{fmtD(t.date)}</div></div>
</div>
))}
</div>
</div>
</>
)}
</div>
)}
{crmTab==="quote"&&(()=>{
const qSubtotal=quoteItems.reduce((a,i)=>a+(i.qty||0)*(i.rate||0),0);
const zohoCustomer=(s.invoices||[]).find(inv=>inv.customer&&sel&&(inv.customer.toLowerCase()===(sel.school||"").toLowerCase()||(activeDeal&&inv.customer.toLowerCase()===activeDeal.school?.toLowerCase())));
const zohoCustomerId=zohoCustomer?.customerId||null;
const zbUrl=zohoCustomerId?`https://books.zoho.com/app/#contacts/view/${zohoCustomerId}`:"https://books.zoho.com/app/";
const printPDF=()=>{
const rows=quoteItems.map(i=>`<tr><td>${i.name||""}</td><td style="text-align:center">${i.qty||0}</td><td style="text-align:right">$${Number(i.rate||0).toFixed(2)}</td><td style="text-align:right">$${((i.qty||0)*(i.rate||0)).toFixed(2)}</td></tr>`).join("");
const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quote ${quoteNum||""}</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#111;max-width:760px;margin:0 auto}h1{color:#f37321;font-size:28px;margin:0}h2{font-size:13px;font-weight:400;color:#666;margin:4px 0 0}table{width:100%;border-collapse:collapse;margin-top:28px}th{background:#f37321;color:#fff;padding:10px 12px;text-align:left;font-size:13px}td{padding:9px 12px;border-bottom:1px solid #eee;font-size:13px}.total-row{font-weight:700;font-size:15px;color:#f37321}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #f37321;padding-bottom:16px;margin-bottom:8px}.meta{font-size:12px;color:#444;margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:4px}.meta span{color:#666}footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center}@media print{body{padding:20px}}</style></head><body><div class="header"><div><h1>ST1 SPORTS</h1><h2>Premium Athletic Equipment</h2></div><div style="text-align:right"><div style="font-size:22px;font-weight:700;color:#f37321">QUOTE</div><div style="font-size:13px;color:#666">#${quoteNum||"—"}</div><div style="font-size:12px;color:#999">${new Date().toLocaleDateString()}</div></div></div><div class="meta"><div><span>To:</span> <strong>${sel?sel.fullName||[sel.firstName,sel.lastName].filter(Boolean).join(" "):"—"}</strong></div><div><span>School/Org:</span> <strong>${activeDeal?.school||sel?.school||"—"}</strong></div><div><span>Email:</span> ${sel?.email||"—"}</div><div><span>Phone:</span> ${sel?.phone||"—"}</div></div><table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}<tr class="total-row"><td colspan="3" style="text-align:right;padding-top:16px">TOTAL</td><td style="text-align:right;padding-top:16px">$${qSubtotal.toFixed(2)}</td></tr></tbody></table><div style="margin-top:20px;font-size:12px;color:#555">${activeDeal?.quoteNotes||""}</div><footer>ST1 Sports · matt@st1sports.com · 719-256-0275 · st1sports.com · This quote is valid for 30 days.</footer></body></html>`;
const w=window.open("","_blank","width=800,height=600");
if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),400);}
};
return (
<div>
<div className="card" style={{padding:16,marginBottom:12}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<Lbl>Quote</Lbl>
{zohoCustomer&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green}}>✓ Zoho account: {zohoCustomer.customer}</div>}
</div>
{activeDeal?(
<>
<div style={{marginBottom:12}}>
<Lbl s={{marginBottom:3}}>Quote Number</Lbl>
<input value={quoteNum} onChange={e=>setQuoteNum(e.target.value)} onBlur={()=>activeDeal&&dispatch("UPDATE_DEAL",{id:activeDeal.id,quoteNumber:quoteNum})} placeholder="Q-2025-001" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:11,boxSizing:"border-box"}}/>
</div>
<Lbl s={{marginBottom:6}}>Line Items</Lbl>
{quoteItems.length>0&&(
<div style={{marginBottom:8}}>
<div style={{display:"grid",gridTemplateColumns:"1fr 56px 80px 70px 24px",gap:4,marginBottom:4}}>
{["ITEM","QTY","UNIT PRICE","TOTAL",""].map(h=><div key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>{h}</div>)}
</div>
{quoteItems.map((item,idx)=>(
<div key={item.id} style={{display:"grid",gridTemplateColumns:"1fr 56px 80px 70px 24px",gap:4,marginBottom:4,alignItems:"center"}}>
<input value={item.name} onChange={e=>setQuoteItems(qi=>qi.map((q,i)=>i===idx?{...q,name:e.target.value}:q))} placeholder="Item name" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"5px 7px",fontSize:11}}/>
<input type="number" min="1" value={item.qty} onChange={e=>setQuoteItems(qi=>qi.map((q,i)=>i===idx?{...q,qty:Number(e.target.value||1)}:q))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"5px 7px",fontSize:11,textAlign:"center"}}/>
<input type="number" min="0" step="0.01" value={item.rate} onChange={e=>setQuoteItems(qi=>qi.map((q,i)=>i===idx?{...q,rate:Number(e.target.value||0)}:q))} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:3,padding:"5px 7px",fontSize:11,textAlign:"right"}}/>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:12,color:B.orange,textAlign:"right"}}>{fmt$((item.qty||0)*(item.rate||0))}</div>
<button onClick={()=>setQuoteItems(qi=>qi.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:B.muted,fontSize:14,cursor:"pointer",padding:0,lineHeight:1,textAlign:"center"}}>✕</button>
</div>
))}
<div style={{display:"flex",justifyContent:"flex-end",marginTop:6,paddingTop:6,borderTop:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.orange}}>Total: {fmt$(qSubtotal)}</div>
</div>
</div>
)}
<button onClick={()=>setQuoteItems(qi=>[...qi,{id:mkId(),name:"",qty:1,rate:0}])} style={{background:"none",border:`1px dashed ${B.border}`,color:B.muted,borderRadius:4,padding:"6px 12px",fontSize:11,cursor:"pointer",width:"100%",marginBottom:12,fontFamily:"'Lexend',sans-serif"}}>+ ADD ITEM</button>
<div style={{marginBottom:12}}><Lbl s={{marginBottom:4}}>Notes</Lbl><textarea defaultValue={activeDeal.quoteNotes||""} onBlur={e=>dispatch("UPDATE_DEAL",{id:activeDeal.id,quoteNotes:e.target.value})} placeholder="Special pricing, terms, conditions..." rows={2} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical",boxSizing:"border-box"}}/></div>
<div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
<OBtn onClick={()=>{dispatch("UPDATE_DEAL",{id:activeDeal.id,quoteItems,quoteNumber:quoteNum,quoteAmount:qSubtotal});toast("Quote saved","success");}}>SAVE QUOTE</OBtn>
<OBtn col={B.blue} onClick={printPDF} disabled={quoteItems.length===0}>PRINT / PDF</OBtn>
<a href={zbUrl} target="_blank" rel="noreferrer" style={{background:B.surface,color:B.textMid,border:`1px solid ${B.borderD}`,borderRadius:5,padding:"8px 13px",fontFamily:"'Lexend',sans-serif",fontSize:11,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>OPEN ZOHO BOOKS ↗</a>
{activeDeal.stage!=="Quoted"&&<OBtn col={B.green} onClick={()=>{dispatch("UPDATE_DEAL",{id:activeDeal.id,stage:"Quoted"});crmUpdate("Deals",activeDeal.zohoId,{Stage:"Quoted"});toast("Marked as Quoted","success");}}>MARK AS QUOTED</OBtn>}
</div>
{activeDeal.quoteNumber&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>✓ Quote {activeDeal.quoteNumber} on file{activeDeal.quoteAmount?` — ${fmt$(activeDeal.quoteAmount)}`:""}</div>}
</>
):<div style={{textAlign:"center",padding:"20px 0",color:B.muted,fontSize:11}}><OBtn onClick={()=>setCrmTab("deal")}>Create a deal first →</OBtn></div>}
</div>
{/* Past quotes across all deals */}
{(()=>{
const pastDeals=(s.deals||[]).filter(d=>d.contactId===sel.id&&d.quoteNumber);
if(pastDeals.length===0) return null;
return(
<div className="card" style={{padding:14}}>
<Lbl s={{marginBottom:10}}>Quote History</Lbl>
{pastDeals.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(d=>(
<div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.border}`}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>#{d.quoteNumber||"—"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{d.stage||""}{d.quoteAmount?` · ${fmt$(d.quoteAmount)}`:""}</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:d.stage==="Closed Won"?B.green:d.stage==="Closed Lost"?"#ef4444":B.orange,fontWeight:600}}>{d.quoteAmount?fmt$(d.quoteAmount):""}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{d.updatedAt?new Date(d.updatedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""}</div>
</div>
</div>
))}
</div>
);
})()}
</div>
);
})()}
{crmTab==="order"&&(
<div>
{selCD.co.length===0&&!showNewOrder&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:12}}>No orders yet</div><OBtn onClick={()=>setShowNewOrder(true)}>+ CREATE ORDER</OBtn></div>}
{showNewOrder&&(
<div className="card" style={{padding:14,marginBottom:12}}>
<Lbl s={{marginBottom:10}}>New Order</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<div><Lbl s={{marginBottom:3}}>Order Name</Lbl><input value={orderForm.name} onChange={e=>setOrderForm(f=>({...f,name:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div><Lbl s={{marginBottom:3}}>Value ($)</Lbl><input type="number" value={orderForm.value} onChange={e=>setOrderForm(f=>({...f,value:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
</div>
<div style={{marginBottom:8}}><Lbl s={{marginBottom:3}}>Notes</Lbl><input value={orderForm.notes} onChange={e=>setOrderForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/></div>
<div style={{display:"flex",gap:6}}><OBtn onClick={()=>{if(!orderForm.name)return;const o={id:mkId(),name:orderForm.name,contact:cName(sel),contactId:sel.id,school:sel.school||"",email:sel.email||"",value:Number(orderForm.value||0),notes:orderForm.notes,stage:"Order Received",source:"manual",createdAt:today()};dispatch("ADD_ORDER",o);setShowNewOrder(false);setOrderForm({name:"",value:"",notes:""});toast("Order created","success");}}>SAVE ORDER</OBtn><GBtn onClick={()=>setShowNewOrder(false)}>Cancel</GBtn></div>
</div>
)}
{selCD.co.map(o=>{
const stCol={"Order Received":B.blue,"Order Placed":B.purple,"Invoiced":B.green}[o.stage]||B.muted;
const stBg={"Order Received":B.blueBg,"Order Placed":B.purpleBg,"Invoiced":B.greenBg}[o.stage]||B.surface;
const nextIdx=ORDER_STAGES.indexOf(o.stage)+1;
return(
<div key={o.id} className="card" style={{padding:14,marginBottom:10,borderLeft:`3px solid ${stCol}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,fontWeight:500,color:B.text}}>{o.name}</div><span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:stCol,background:stBg,padding:"2px 6px",borderRadius:3}}>{o.stage}</span></div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.green}}>{fmt$(o.value||0)}</div>
</div>
{o.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>{o.notes}</div>}
{o.invoiceNumber&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,marginBottom:8}}>✓ INVOICE: {o.invoiceNumber}</div>}
{nextIdx<ORDER_STAGES.length&&<OBtn sm onClick={()=>{dispatch("UPDATE_ORDER",{id:o.id,stage:ORDER_STAGES[nextIdx]});toast(`Moved to ${ORDER_STAGES[nextIdx]}`,"success");}}>→ {ORDER_STAGES[nextIdx].toUpperCase()}</OBtn>}
</div>
);
})}
{selCD.co.length>0&&<OBtn sm onClick={()=>setShowNewOrder(true)} style={{marginTop:6}}>+ ADD ANOTHER ORDER</OBtn>}
</div>
)}
{crmTab==="sms"&&(
<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>Texting {sel.phone} — every message includes a "Reply STOP to opt out" line automatically.</div>
<div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:6,marginBottom:12,minHeight:120}}>
{smsLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:20}}>Loading conversation…</div>}
{!smsLoading&&smsHistory.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:20}}>No texts yet — say hello.</div>}
{smsHistory.map(m=>(
<div key={m.id} style={{alignSelf:m.direction==="out"?"flex-end":"flex-start",maxWidth:"75%",background:m.direction==="out"?B.orange:B.surface,color:m.direction==="out"?B.white:B.text,border:m.direction==="out"?"none":`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:12,whiteSpace:"pre-wrap"}}>
{m.body}
<div style={{fontSize:9,opacity:.7,marginTop:3}}>{new Date(m.createdAt).toLocaleString()}</div>
</div>
))}
</div>
<div style={{display:"flex",gap:6}}>
<input value={smsBody} onChange={e=>setSmsBody(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}} placeholder="Type a text…" style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"8px 11px",fontSize:12,fontFamily:"'Lexend',sans-serif",boxSizing:"border-box"}}/>
<OBtn onClick={sendText} disabled={smsSending||!smsBody.trim()}>{smsSending?"SENDING...":"SEND"}</OBtn>
</div>
</div>
)}
{crmTab==="history"&&(()=>{
const srcMeta={
note:{label:"NOTE",color:B.orange,icon:"📝"},
deal:{label:"DEAL NOTE",color:B.blue,icon:"💼"},
touch:{label:"TOUCH",color:B.green,icon:"🤝"},
email:{label:"EMAIL",color:B.purple||"#7c3aed",icon:"✉️"},
campaign:{label:"CAMPAIGN",color:"#0ea5e9",icon:"⚡"},
quote:{label:"QUOTE",color:"#f59e0b",icon:"📄"},
order:{label:"ORDER",color:"#10b981",icon:"🏆"},
};
const allEvents=[
...(sel.notes||[]).map(n=>({...n,src:"note"})),
...(activeDeal?.notes_list||[]).map(n=>({...n,src:"deal"})),
...(activeDeal?.touchHistory||[]).map(t=>({id:t.id,text:t.note||t.type,ts:new Date(t.date+"T00:00").getTime(),author:t.author,src:"touch"})),
...(sel.activity||[]).filter(a=>a.type==="email"||a.type==="email_sent"||a.type==="email_opened").map(a=>({id:a.id||mkId(),text:a.subject||a.text||"Email sent",ts:a.ts||a.sentAt||Date.now(),author:a.author||a.from||"",src:"email",meta:a.status})),
...(sel.campaigns||[]).map(c=>({id:c.id||mkId(),text:`Added to campaign: ${c.name||c.campaignId||""}`,ts:c.addedAt||Date.now(),author:"System",src:"campaign"})),
...(activeDeal?.quotes||[]).map(q=>({id:q.id,text:`Quote sent — ${q.title||"Untitled"} (${q.status||"draft"})`,ts:q.createdAt||Date.now(),author:q.author||"",src:"quote"})),
...(s.orders||[]).filter(o=>o.contactId===sel.id).map(o=>({id:o.id,text:`Order ${o.status||"placed"} — ${o.title||"Order"}`,ts:o.createdAt||Date.now(),author:"",src:"order"})),
].sort((a,b)=>b.ts-a.ts);
return(
<div>
{/* Add note */}
<div style={{display:"flex",gap:6,marginBottom:16}}>
<textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a note about this contact…" rows={2}
style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
<OBtn sm col={B.orange} onClick={()=>{
if(!noteText.trim()) return;
const nt=noteText.trim();
dispatch("UPDATE_CONTACT",{id:sel.id,notes:[...(sel.notes||[]),{id:mkId(),text:nt,ts:Date.now(),author:cu?.name||"Matt"}]});
if(activeDeal) dispatch("UPDATE_DEAL",{id:activeDeal.id,notes_list:[...(activeDeal.notes_list||[]),{id:mkId(),text:nt,ts:Date.now(),author:cu?.name||"Matt"}]});
if(sel.zohoId){const isLead=sel.id?.startsWith("zoho_l_");crmAddNote(isLead?"Leads":"Contacts",sel.zohoId,nt);}
setNoteText("");toast("Note added","success");
}}>ADD</OBtn>
</div>
{/* Timeline */}
{allEvents.length===0?(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"center",padding:"40px 0"}}>
<div style={{fontSize:24,marginBottom:8}}>📋</div>
No history yet — add a note or send a quote to get started
</div>
):(
<div style={{position:"relative"}}>
<div style={{position:"absolute",left:11,top:0,bottom:0,width:2,background:B.border,borderRadius:2}}/>
{allEvents.map((ev,i)=>{
const sm=srcMeta[ev.src]||{label:ev.src.toUpperCase(),color:B.muted,icon:"•"};
return(
<div key={ev.id||i} style={{display:"flex",gap:14,paddingBottom:16,position:"relative"}}>
<div style={{width:24,height:24,borderRadius:"50%",background:B.white,border:`2px solid ${sm.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0,zIndex:1}}>
{sm.icon}
</div>
<div style={{flex:1,background:B.surface,borderRadius:6,padding:"8px 12px",border:`1px solid ${B.border}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:3}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sm.color,letterSpacing:1,fontWeight:700}}>{sm.label}</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,whiteSpace:"nowrap"}}>
{new Date(ev.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.5}}>{ev.text}</div>
{(ev.author||ev.meta)&&(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3}}>
{ev.author&&<span>{ev.author}</span>}
{ev.author&&ev.meta&&<span> · </span>}
{ev.meta&&<span style={{color:ev.meta==="opened"?B.green:B.muted}}>{ev.meta}</span>}
</div>
)}
</div>
</div>
);
})}
</div>
)}
</div>
);
})()}
</div>
</div>
)}
</div>
);
}
const SPONS_CONFIG_DEFAULTS={avgOrderValuePerAthlete:85,avgEquipmentOrderPerSport:400,netMarginPct:0.18,givebackPct:0.30,schoolClassConfidence:{"1A":0.40,"2A":0.50,"3A":0.60,"4A":0.70,"5A":0.78,"6A":0.85},teamStoreRevenuePerAthlete:35,purchaseFrequencyPerYear:1.5,boosterMultiplier:1.15};
function ModSponsorships(){
const {s,dispatch,toast,setMod,cu}=useApp();
const [tab,setTab]=useState("proposed");
const [confirmId,setConfirmId]=useState(null);
const [confirmAmt,setConfirmAmt]=useState("");
const [payFilter,setPayFilter]=useState("all");
const [cfg,setCfg]=useState(null);
const [cfgLoading,setCfgLoading]=useState(false);
const [cfgSaving,setCfgSaving]=useState(false);
useEffect(()=>{
if(tab!=="settings"||cfg!==null)return;
setCfgLoading(true);
fetch("/api/sponsorship/config").then(r=>r.json()).then(d=>{
setCfg(d.config??{...SPONS_CONFIG_DEFAULTS});
}).catch(()=>setCfg({...SPONS_CONFIG_DEFAULTS})).finally(()=>setCfgLoading(false));
},[tab]);
const saveConfig=async()=>{
if(!cfg)return;
setCfgSaving(true);
try{
const r=await fetch("/api/sponsorship/config",{method:"PATCH",headers:{"Content-Type":"application/json"},
body:JSON.stringify({...cfg,lastUpdatedBy:cu?.name||null})});
const d=await r.json();
if(d.ok){toast("Calculator settings saved","success");}
else{toast(d.error||"Save failed","error");}
}catch(e){toast("Save failed: "+e.message,"error");}
setCfgSaving(false);
};
const setC=(k,v)=>setCfg(c=>({...c,[k]:v}));
const setCC=(cls,v)=>setCfg(c=>({...c,schoolClassConfidence:{...(c.schoolClassConfidence||{}),[cls]:v}}));
const contacts=s.contacts||[];
const proposed=contacts.filter(c=>!c.deadStatus&&c.sponsorshipStatus==="proposed");
const confirmed=contacts.filter(c=>!c.deadStatus&&c.sponsorshipStatus==="confirmed");
const totalCommitted=confirmed.reduce((a,c)=>a+(c.sponsorshipConfirmedAmount||c.sponsorshipMin||0),0);
const totalPaid=confirmed.filter(c=>c.sponsorshipPaid).reduce((a,c)=>a+(c.sponsorshipConfirmedAmount||c.sponsorshipMin||0),0);
const totalOwed=totalCommitted-totalPaid;
const confirmSponsor=(c)=>{
const amt=parseFloat(confirmAmt)||c.sponsorshipMin||0;
dispatch("UPDATE_CONTACT",{id:c.id,sponsorshipStatus:"confirmed",sponsorshipConfirmedAmount:amt,sponsorshipConfirmedAt:new Date().toISOString(),sponsorshipPaid:false});
toast(`${c.fullName||c.school||"Contact"} confirmed — ${fmt$(amt)}`,"success");
setConfirmId(null);setConfirmAmt("");
};
const markPaid=(c)=>{
dispatch("UPDATE_CONTACT",{id:c.id,sponsorshipPaid:true,sponsorshipPaidAt:new Date().toISOString()});
toast("Marked as paid","success");
};
const revertToProposed=(c)=>{
dispatch("UPDATE_CONTACT",{id:c.id,sponsorshipStatus:"proposed",sponsorshipConfirmedAmount:null,sponsorshipConfirmedAt:null,sponsorshipPaid:false,sponsorshipPaidAt:null});
toast("Moved back to proposed","info");
};
const cName=(c)=>c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()||"Unnamed";
const inp={background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 8px",fontSize:11,color:B.text,width:"100%",boxSizing:"border-box"};
const SCard=({c,showConfirmForm})=>{
const amt=c.sponsorshipConfirmedAmount||c.sponsorshipMin||0;
const upside=c.sponsorshipMax||0;
const isConfirming=confirmId===c.id;
return(
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:"14px 18px",marginBottom:10}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,fontWeight:600,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(typeof c.school==="string"?c.school:c.school?.name||"")||cName(c)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:2}}>{cName(c)}{c.title?` · ${c.title}`:""}</div>
<div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
{c.schoolClass&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}15`,padding:"2px 7px",borderRadius:3}}>{c.schoolClass}</span>}
{c.numAthletes&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.numAthletes} athletes</span>}
{c.numSports&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.numSports} sports</span>}
{Array.isArray(c.selectedSports)&&c.selectedSports.length>0&&(
c.selectedSports.slice(0,3).map(sp=><span key={sp} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:`${B.blue}10`,padding:"2px 6px",borderRadius:3}}>{sp}</span>)
)}
{Array.isArray(c.selectedSports)&&c.selectedSports.length>3&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>+{c.selectedSports.length-3} more</span>}
</div>
{Array.isArray(c.ttPains)&&c.ttPains.length>0&&(
<div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
Pain: {c.ttPains.slice(0,2).join(" · ")}{c.ttPains.length>2?` +${c.ttPains.length-2} more`:""}
</div>
)}
</div>
<div style={{textAlign:"right",flexShrink:0}}>
{showConfirmForm?(
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.orange}}>{fmt$(c.sponsorshipConfirmedAmount||c.sponsorshipMin||0)}</div>
):(
<>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.orange}}>{fmt$(c.sponsorshipMin||0)}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>guaranteed</div>
{upside>c.sponsorshipMin&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>up to {fmt$(upside)}</div>}
</>
)}
<button onClick={()=>setMod("crm")} style={{marginTop:6,background:"none",border:"none",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,cursor:"pointer",padding:0}}>View profile →</button>
</div>
</div>
{/* Confirm form */}
{showConfirmForm&&isConfirming&&(
<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${B.border}`,display:"flex",gap:8,alignItems:"flex-end"}}>
<div style={{flex:1}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginBottom:4}}>CONFIRMED AMOUNT ($)</div>
<input type="number" value={confirmAmt} onChange={e=>setConfirmAmt(e.target.value)} placeholder={String(c.sponsorshipMin||0)} style={inp}/>
</div>
<OBtn col={B.green} onClick={()=>confirmSponsor(c)}>✓ CONFIRM</OBtn>
<GBtn onClick={()=>{setConfirmId(null);setConfirmAmt("");}}>Cancel</GBtn>
</div>
)}
{/* Actions */}
<div style={{marginTop:10,display:"flex",gap:6,justifyContent:"flex-end"}}>
{showConfirmForm?(
!isConfirming&&<OBtn sm col={B.green} onClick={()=>{setConfirmId(c.id);setConfirmAmt(String(c.sponsorshipConfirmedAmount||c.sponsorshipMin||""));}}>✎ Edit Amount</OBtn>
):(
<>
{!isConfirming&&<OBtn sm col={B.green} onClick={()=>{setConfirmId(c.id);setConfirmAmt(String(c.sponsorshipMin||""));}}>✓ CONFIRM SPONSORSHIP</OBtn>}
{!isConfirming&&<GBtn sm onClick={()=>{dispatch("UPDATE_CONTACT",{id:c.id,sponsorshipStatus:null,sponsorshipMin:null,sponsorshipMax:null});toast("Removed from pipeline","info");}}>✕ Remove</GBtn>}
</>
)}
{showConfirmForm&&!c.sponsorshipPaid&&<OBtn sm col={B.blue} onClick={()=>markPaid(c)}>Mark Paid</OBtn>}
{showConfirmForm&&c.sponsorshipPaid&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"3px 8px",borderRadius:4}}>✓ PAID</span>}
{showConfirmForm&&<GBtn sm onClick={()=>revertToProposed(c)}>↩ Move to Proposed</GBtn>}
</div>
</div>
);
};
return(
<div style={{padding:"22px 28px",maxWidth:900,margin:"0 auto"}}>
{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2.5,marginBottom:4}}>SPONSORSHIPS</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.black}}>Sponsorship Pipeline</div>
</div>
<OBtn onClick={()=>setMod("crm")}>← Back to CRM</OBtn>
</div>
{/* Summary cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
<KCard l="Proposed" v={proposed.length} c={B.orange} sub={fmt$K(proposed.reduce((a,c)=>a+(c.sponsorshipMin||0),0))+" potential"}/>
<KCard l="Confirmed" v={confirmed.length} c={B.green} sub={fmt$K(totalCommitted)+" committed"}/>
<KCard l="Outstanding" v={fmt$K(totalOwed)} c={totalOwed>0?B.red:B.green} sub="owed to schools"/>
<KCard l="Paid Out" v={fmt$K(totalPaid)} c={B.blue} sub={`${confirmed.filter(c=>c.sponsorshipPaid).length} of ${confirmed.length} paid`}/>
</div>
{/* Tabs */}
<div style={{display:"flex",borderBottom:`1px solid ${B.border}`,marginBottom:18}}>
{[["proposed",`Proposed (${proposed.length})`],["confirmed",`Confirmed (${confirmed.length})`],["settings","⚙ Settings"]].map(([id,label])=>(
<button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${tab===id?B.orange:"transparent"}`,color:tab===id?B.orange:B.muted,padding:"8px 18px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,letterSpacing:1.5,cursor:"pointer"}}>{label}</button>
))}
</div>
{/* Proposed tab */}
{tab==="proposed"&&(
proposed.length===0?(
<div style={{textAlign:"center",padding:"60px 0"}}>
<div style={{fontSize:32,marginBottom:12}}>★</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted,marginBottom:16}}>No sponsorships proposed yet.<br/>Complete a Talk Track with a school to generate an estimate.</div>
<OBtn onClick={()=>setMod("crm")}>Go to CRM →</OBtn>
</div>
):(
proposed.map(c=><SCard key={c.id} c={c} showConfirmForm={false}/>)
)
)}
{/* Confirmed tab */}
{tab==="confirmed"&&(
<>
{confirmed.length>0&&(
<div style={{display:"flex",gap:6,marginBottom:14}}>
{[["all","All"],["unpaid","Unpaid"],["paid","Paid"]].map(([v,l])=>(
<button key={v} onClick={()=>setPayFilter(v)} style={{background:payFilter===v?B.orange:"none",color:payFilter===v?B.white:B.muted,border:`1px solid ${payFilter===v?B.orange:B.border}`,borderRadius:99,padding:"3px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,cursor:"pointer"}}>{l}</button>
))}
</div>
)}
{confirmed.length===0?(
<div style={{textAlign:"center",padding:"60px 0"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted}}>No confirmed sponsorships yet — confirm a proposed one above.</div>
</div>
):(
confirmed
.filter(c=>payFilter==="all"?true:payFilter==="paid"?c.sponsorshipPaid:!c.sponsorshipPaid)
.map(c=><SCard key={c.id} c={c} showConfirmForm={true}/>)
)}
</>
)}
{/* Settings tab */}
{tab==="settings"&&(
<div style={{maxWidth:620}}>
{cfgLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,padding:"40px 0",textAlign:"center"}}><Spin/> Loading settings…</div>}
{!cfgLoading&&cfg&&(()=>{
const fld=({label,help,k,pct,step="1"})=>(
<div key={k} style={{marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.8,marginBottom:4}}>{label}</div>
{help&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:5,lineHeight:1.4}}>{help}</div>}
<div style={{display:"flex",alignItems:"center",gap:6}}>
<input type="number" step={step} value={pct?Math.round((cfg[k]||0)*100):cfg[k]||""}
onChange={e=>setC(k,pct?Number(e.target.value)/100:Number(e.target.value))}
style={{width:100,...inp}}/>
{pct&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>%</span>}
</div>
</div>
);
return(
<>
{/* Formula explainer */}
<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:6,padding:"12px 16px",marginBottom:22,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.8}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1,marginBottom:6}}>HOW THE ESTIMATE IS CALCULATED</div>
<div><b style={{color:B.text}}>Revenue</b> = (athletes × $AOV × purchases/yr) + (sports × $equip) + (store rev if online store) × booster multiplier</div>
<div><b style={{color:B.text}}>Giveback Pool</b> = Revenue × net margin × giveback %</div>
<div><b style={{color:B.text}}>Guaranteed Min</b> = Pool × class confidence %</div>
<div><b style={{color:B.text}}>Upside Max</b> = Pool × 100%</div>
</div>
{/* Revenue inputs */}
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:"16px 18px",marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:14}}>REVENUE ASSUMPTIONS</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
{fld({label:"AVG ORDER VALUE PER ATHLETE ($)",help:"Avg dollars ST1 earns per athlete per order (uniforms, gear, etc.)",k:"avgOrderValuePerAthlete"})}
{fld({label:"AVG EQUIPMENT ORDER PER SPORT ($)",help:"Avg equipment purchase per sport per season",k:"avgEquipmentOrderPerSport"})}
{fld({label:"TEAM STORE REVENUE PER ATHLETE ($)",help:"Online team store earnings per athlete if store is active",k:"teamStoreRevenuePerAthlete"})}
{fld({label:"PURCHASE FREQUENCY PER YEAR",help:"How many times per year athletes/coaches order",k:"purchaseFrequencyPerYear",step:"0.1"})}
{fld({label:"BOOSTER CLUB MULTIPLIER",help:"Revenue uplift factor when a booster club is active (e.g. 1.15 = +15%)",k:"boosterMultiplier",step:"0.01"})}
</div>
</div>
{/* Margin & giveback */}
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:"16px 18px",marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:14}}>MARGIN & GIVEBACK</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
{fld({label:"NET MARGIN %",help:"ST1's net profit margin after cost of goods and fulfillment",k:"netMarginPct",pct:true,step:"1"})}
{fld({label:"GIVEBACK %",help:"% of net profit returned to the school as sponsorship",k:"givebackPct",pct:true,step:"1"})}
</div>
</div>
{/* School class confidence */}
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:"16px 18px",marginBottom:20}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:6}}>SCHOOL CLASS CONFIDENCE %</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:14,lineHeight:1.4}}>How likely ST1 captures the full projected revenue at each school size. Larger schools have more competition so confidence is higher for smaller classes.</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8}}>
{["1A","2A","3A","4A","5A","6A"].map(cls=>(
<div key={cls} style={{textAlign:"center"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,marginBottom:4}}>{cls}</div>
<input type="number" min="0" max="100" step="1"
value={Math.round(((cfg.schoolClassConfidence||{})[cls]||0)*100)}
onChange={e=>setCC(cls,Number(e.target.value)/100)}
style={{width:"100%",textAlign:"center",...inp}}/>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>%</div>
</div>
))}
</div>
</div>
<OBtn onClick={saveConfig} disabled={cfgSaving} style={{width:"100%",justifyContent:"center"}}>
{cfgSaving?"SAVING…":"SAVE CALCULATOR SETTINGS"}
</OBtn>
</>
);
})()}
</div>
)}
</div>
);
}
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
const [edgarResult,setEdgarResult]=useState(null);
const [edgarLoading,setEdgarLoading]=useState(false);
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
pushDealToZoho({dealName:deal.name,stage:"Quoted",closingDate:followUp,description:deal.notes,accountName:school})
.then(dd=>{if(dd.dealId) dispatch("UPDATE_DEAL",{id:deal.id,zohoId:dd.dealId});});
ids.push(q.id);
created++;
}
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
const pool=useMemo(()=>isOwner?(s.deals||[]):(s.deals||[]).filter(d=>d.assignee===cu?.id),[s.deals,isOwner,cu?.id]);
const list=useMemo(()=>pool.filter(d=>{
if(flt==="active") return !["Closed Won","Closed Lost","On Hold"].includes(d.stage);
if(flt==="overdue") return d.followUpDate&&dUntil(d.followUpDate)<0&&!["Closed Won","Closed Lost","PO Received"].includes(d.stage);
if(flt==="won") return d.stage==="Closed Won";
if(flt==="all") return true;
return d.stage===flt;
}).sort((a,b)=>{
const aLost=a.stage==="Closed Lost"?1:0;
const bLost=b.stage==="Closed Lost"?1:0;
if(aLost!==bLost) return aLost-bLost;
return b.value-a.value;
}),[pool,flt]);
const sel_d=sel?(s.deals||[]).find(d=>d.id===sel):null;
const addDeal=()=>{
if(!form.name) return;
const d={...form,id:mkId(),value:Number(form.value||0),lastTouch:Date.now(),priority:"warm",touchHistory:[{id:mkId(),type:"quote",date:form.quoteDate||today(),note:"Quote sent",author:form.assignee}],competitor:null,zoho_synced:false};
dispatch("ADD_DEAL",d);dispatch("LOG",{msg:`${cu?.name} added deal: ${d.name}`});
toast("Deal added","success");setAdding(false);
const _dealZohoData={dealName:d.name||d.contact,amount:d.value||0,stage:d.stage||"Quoted",closingDate:d.followUpDate||new Date(Date.now()+30*86400000).toISOString().slice(0,10),description:d.notes||"",accountName:d.school,accountState:d.state};
pushDealToZoho(_dealZohoData).then(dd=>{if(dd.dealId)dispatch("UPDATE_DEAL",{id:d.id,zohoId:dd.dealId});});
};
const logTouch=()=>{
if(!note.trim()||!sel_d) return;
dispatch("UPDATE_DEAL",{id:sel_d.id,touchHistory:[...(sel_d.touchHistory||[]),{id:mkId(),type:"note",date:today(),note,author:cu?.id}],followUpDate:new Date(Date.now()+86400000*7).toISOString().slice(0,10)});
dispatch("LOG",{msg:`${cu?.name} logged touch on ${sel_d.name}: ${note}`});
crmAddNote("Deals",sel_d.zohoId,note);
setNote("");toast("Touch logged","success");
};
const runEdgar=async()=>{
if(!sel_d) return;
setEdgarLoading(true);setEdgarResult(null);
try{
const r=await fetch('/api/agents/edgar',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({task:`Build a quote for: ${sel_d.name} at ${sel_d.school||"school"}, ${sel_d.state||""}. Deal value ~${fmt$(sel_d.value)}.${sel_d.notes?' Notes: '+sel_d.notes.slice(0,200):''}`,
input:{dealName:sel_d.name,school:sel_d.school,state:sel_d.state,value:sel_d.value}})});
const d=await r.json();
setEdgarResult(d.metadata?.quote||null);
if(d.output) toast(d.output.slice(0,120),'info');
}catch(e){toast('Edgar error: '+e.message,'error');}
setEdgarLoading(false);
};
const draftEmail=async()=>{
if(!sel_d) return;setDrafting(true);setDraft("");
const t=await aiCall(`Write a follow-up email from ST1 Sports (matt@st1sports.com, 719-256-0275, st1sports.com).
Deal: ${sel_d.name} | Contact: ${sel_d.contact} at ${sel_d.school}, ${sel_d.state}
Stage: ${sel_d.stage} | Value: ${fmt$(sel_d.value)} | Notes: ${sel_d.notes}
Recent touches: ${(sel_d.touchHistory||[]).slice(-2).map(t=>t.note).join("; ")}
Under 80 words. Include subject line. Brand voice: warm, direct, relationship-first — lead with the person or their program, not the product. No "hope this finds you well", no efficiency-first hooks ("2 weeks", "no minimums"). Athlete-aware tone. Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`);
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
{[["Stage",DEAL_STAGES,"stage"],["Product",PRODUCT_CATS,"product"],["State",STATES_LIST,"state"]].map(([l,opts,k])=>(
<div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl><select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>
))}
<div><Lbl s={{marginBottom:3}}>Assignee</Lbl><select value={form.assignee||""} onChange={e=>setForm(f=>({...f,assignee:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}><option value="">— Unassigned —</option>{(s.reps||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
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
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{typeof d.contact==="string"?d.contact:d.contact?.name||""} · {typeof d.school==="string"?d.school:d.school?.name||""} · {d.state}</div>
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
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{typeof sel_d.contact==="string"?sel_d.contact:sel_d.contact?.name||""} · {typeof sel_d.school==="string"?sel_d.school:sel_d.school?.name||""}</div>
</div>
<div style={{flexShrink:0,marginLeft:9,textAlign:"right"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1,marginBottom:2}}>VALUE ($)</div>
<input type="number" defaultValue={sel_d.value||0} onBlur={e=>{const _v=Number(e.target.value||0);dispatch("UPDATE_DEAL",{id:sel_d.id,value:_v});crmUpdate("Deals",sel_d.zohoId,{Amount:_v});}}
style={{width:100,background:B.surface,border:`1px solid ${B.orange}`,color:B.orange,borderRadius:4,padding:"4px 7px",fontSize:13,fontFamily:"'Russo One',sans-serif",textAlign:"right"}}/>
</div>
</div>
<Lbl s={{marginBottom:5}}>Move Stage</Lbl>
<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
{DEAL_STAGES.map(st=>(
<button key={st} onClick={()=>{const prevStage=sel_d.stage;dispatch("UPDATE_DEAL",{id:sel_d.id,stage:st});dispatch("LOG",{msg:cu?.name+" moved "+sel_d.name+" → "+st});toast("Moved to "+st,"success");if(sel_d.zohoId)fetch("/api/zoho",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"crm",endpoint:`/Deals/${sel_d.zohoId}`,method:"PUT",body:{data:[{Stage:st}]}})}).catch(()=>{});autoInvoiceOnClosedWon(sel_d,prevStage,st,toast);}} style={{background:sel_d.stage===st?DSC[st]:B.surface,color:sel_d.stage===st?B.white:B.muted,border:"1px solid "+(sel_d.stage===st?DSC[st]:B.border),borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif"}}>{st}</button>
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
<input type="date" value={sel_d.followUpDate||""} onChange={e=>{dispatch("UPDATE_DEAL",{id:sel_d.id,followUpDate:e.target.value});crmUpdate("Deals",sel_d.zohoId,{Closing_Date:e.target.value});}} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 8px",fontSize:11}}/>
<GBtn onClick={()=>dispatch("UPDATE_DEAL",{id:sel_d.id,followUpDate:new Date(Date.now()+86400000*7).toISOString().slice(0,10)})} style={{fontSize:10,padding:"5px 8px"}}>+7d</GBtn>
</div>
<OBtn onClick={draftEmail} disabled={drafting} style={{width:"100%"}}>{drafting?"WRITING...":"✦ DRAFT FOLLOW-UP"}</OBtn>
{draft&&<div style={{marginTop:9,background:B.surface,borderRadius:4,padding:9}}>
<textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={7} style={{width:"100%",background:"transparent",border:"none",color:B.text,fontSize:11,lineHeight:1.7,resize:"vertical"}}/>
<GBtn onClick={()=>navigator.clipboard?.writeText(draft)} style={{fontSize:10,padding:"3px 8px"}}>COPY</GBtn>
</div>}
<button onClick={runEdgar} disabled={edgarLoading} style={{width:"100%",marginTop:8,padding:"8px 0",background:edgarLoading?B.surface:B.teal,color:edgarLoading?B.muted:B.white,border:`1px solid ${B.teal}`,borderRadius:4,fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
{edgarLoading?"QUOTING…":"▤ EDGAR QUOTE"}
</button>
{edgarResult&&(
<div style={{marginTop:8,background:B.tealBg,border:`1px solid ${B.teal}30`,borderRadius:6,padding:10}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.teal,letterSpacing:.5,marginBottom:6}}>EDGAR QUOTE</div>
{edgarResult.summary&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginBottom:7,lineHeight:1.5}}>{edgarResult.summary}</div>}
{(edgarResult.lineItems||[]).length>0&&(
<div style={{maxHeight:160,overflowY:"auto",marginBottom:6}}>
{(edgarResult.lineItems||[]).filter(li=>!li.notFound).map((li,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:10}}>
<span style={{flex:1,color:B.text}}>{li.name}</span>
<span style={{color:B.muted,marginRight:8}}>×{li.qty||1}</span>
<span style={{color:B.orange,fontWeight:600}}>{fmt$(li.quotedPrice||0)}</span>
</div>
))}
</div>
)}
{(edgarResult.warnings||[]).map((w,i)=>(
<div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.red,padding:"2px 0"}}>⚠ {w}</div>
))}
</div>
)}
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
<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.4}}>{t.note}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{fmtD(t.date)} · {(s.reps||[]).find(r=>r.id===t.author)?.name||t.author}</div></div>
</div>
))}
</div>
</div>
<div className="card" style={{padding:13}}>
<Lbl s={{marginBottom:7}}>Notes ({(sel_d.notes_list||[]).length})</Lbl>
<div style={{display:"flex",gap:6,marginBottom:8}}>
<textarea value={dealNoteText} onChange={e=>setDealNoteText(e.target.value)} placeholder="Add a note..." rows={2} style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif",resize:"vertical"}}/>
<OBtn sm col={B.orange} onClick={()=>{if(!dealNoteText.trim())return;const _nt=dealNoteText.trim();dispatch("UPDATE_DEAL",{id:sel_d.id,notes_list:[...(sel_d.notes_list||[]),{id:mkId(),text:_nt,ts:Date.now(),author:cu?.name||"Matt"}]});crmAddNote("Deals",sel_d.zohoId,_nt);setDealNoteText("");toast("Note added","success");}}>ADD</OBtn>
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
function ModOrders() {
const {s,dispatch,toast}=useApp();
const orders=s.orders||[];
const [view,setView]=useState("kanban");
const [scanning,setScanning]=useState(false);
const [emailProposals,setEmailProposals]=useState([]);
const [creating,setCreating]=useState(null);
const [oForm,setOForm]=useState({name:"",contact:"",email:"",school:"",value:"",notes:"",source:"manual",items:[]});
const [addingManual,setAddingManual]=useState(false);
const [invoicing,setInvoicing]=useState(null);
const stageCol={"Order Received":B.blue,"Order Placed":B.purple,"Invoiced":B.green};
const advanceOrder=async(o)=>{
const idx=ORDER_STAGES.indexOf(o.stage);
if(idx>=ORDER_STAGES.length-1)return;
const nextStage=ORDER_STAGES[idx+1];
dispatch("UPDATE_ORDER",{id:o.id,stage:nextStage,updatedAt:today()});
toast(`${o.name} → ${nextStage}`,"success");
dispatch("LOG",{msg:`Order "${o.name}" advanced to ${nextStage}`});
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
{o.contact&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:2}}>{typeof o.contact==="string"?o.contact:o.contact?.name||""}{o.school?` · ${typeof o.school==="string"?o.school:o.school?.name||""}`:""}</div>}
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
function ModReorder() {
const {s,dispatch,toast}=useApp();
const [drafts,setDrafts]=useState({});
const [drafting,setDrafting]=useState(null);
const [pulling,setPulling]=useState(false);
const [showAdd,setShowAdd]=useState(false);
const [autoDrafting,setAutoDrafting]=useState(false);
const [dayFilter,setDayFilter]=useState("all");
const [form,setForm]=useState({school:"",contact:"",state:"",sport:"Track & Field",lastOrderDate:"",lastItems:"",lastOrderValue:""});
const now=Date.now();
const withDays=useMemo(()=>(s.reorders||[])
.filter(r=>r.status==="pending"&&(!r.snoozedUntil||new Date(r.snoozedUntil)<new Date()))
.map(r=>{
const daysSince=r.lastOrderDate?Math.floor((now-new Date(r.lastOrderDate).getTime())/86400000):0;
const stage=daysSince>=365?"lapsed":daysSince>=270?"follow-up":daysSince>=180?"check-in":"early";
return{...r,daysSince,stage};
}),[s.reorders]);
const filtered=useMemo(()=>
dayFilter==="90"  ?withDays.filter(r=>r.daysSince>=90&&r.daysSince<180):
dayFilter==="180" ?withDays.filter(r=>r.daysSince>=180&&r.daysSince<270):
dayFilter==="270" ?withDays.filter(r=>r.daysSince>=270&&r.daysSince<365):
dayFilter==="365" ?withDays.filter(r=>r.daysSince>=365):
withDays,[withDays,dayFilter]);
const stageRank={lapsed:50,"follow-up":100,"check-in":80,early:20};
const top5=useMemo(()=>[...withDays]
.sort((a,b)=>((stageRank[b.stage]||0)+(b.lastOrderValue||0)/200)-((stageRank[a.stage]||0)+(a.lastOrderValue||0)/200))
.slice(0,5),[withDays]);
const STAGE={
"early":      {color:B.blue,  label:"EARLY",      dot:"·"},
"check-in":   {color:B.orange,label:"CHECK-IN",   dot:"·"},
"follow-up":  {color:B.red,   label:"FOLLOW-UP",  dot:"·"},
"lapsed":     {color:B.muted, label:"LAPSED",     dot:"·"},
};
const draftPrompt=(r)=>{
if(r.stage==="check-in")
return `This is a friendly 6-month check-in — keep it warm and low-pressure, ask if they're thinking about the upcoming season.`;
if(r.stage==="follow-up")
return `They haven't reordered in 9 months — be a bit more direct, mention limited stock or seasonal timing, and ask if they want the same items.`;
if(r.stage==="lapsed")
return `Over a year since their last order — acknowledge the time, share what's new at ST1, make it easy for them to re-engage.`;
return `Early seasonal check-in — light touch, mention new products or season prep.`;
};
const draftReo=async(r)=>{
setDrafting(r.id);
const t=await aiCall(`Write a short reorder email from Matt Stone at ST1 Sports (matt@st1sports.com, 719-256-0275, st1sports.com).
School: ${r.school} | Contact: ${r.contact}${r.state?", "+r.state:""} | Sport: ${r.sport}
Last order: ${fmtD(r.lastOrderDate)} (${r.daysSince} days ago) — ${(r.lastItems||[]).join(", ")||"previous order"} — ${fmt$(r.lastOrderValue)}
${draftPrompt(r)}
Under 80 words. Reference the exact last order. Brand voice: warm, direct, athlete-aware — reference the sport, the team, or the season coming up. No "hope this finds you well", no efficiency-first hooks. Lead with the relationship, then the reorder reason. Sign as: ST1 Sports | matt@st1sports.com | 719-256-0275`);
setDrafts(d=>({...d,[r.id]:t||""}));
setDrafting(null);
};
const autoDraftCheckIns=async()=>{
const targets=withDays.filter(r=>r.stage==="check-in"&&!drafts[r.id]);
if(!targets.length){toast("No new 180d check-ins to draft","info");return;}
setAutoDrafting(true);
toast(`Auto-drafting ${targets.length} check-in${targets.length>1?"s":""}…`,"info");
for(const r of targets) await draftReo(r);
setAutoDrafting(false);
toast(`${targets.length} draft${targets.length>1?"s":""} ready — review and send`,"success");
};
const pullFromZoho=async()=>{
setPulling(true);
try{
const res=await zohoCall("books","/invoices?filter_by=Status.Paid&per_page=200&sort_column=date&sort_order=D");
const invoices=res.invoices||[];
if(!invoices.length&&res.message) throw new Error(res.message);
const byCustomer={};
for(const inv of invoices){
const key=inv.customer_id||inv.customer_name;
if(!byCustomer[key]||new Date(inv.date)>new Date(byCustomer[key].date))
byCustomer[key]=inv;
}
const existingIds=new Set((s.reorders||[]).map(r=>r.zohoInvoiceId).filter(Boolean));
let added=0;
for(const inv of Object.values(byCustomer)){
if(existingIds.has(inv.invoice_id)) continue;
const daysSince=Math.floor((now-new Date(inv.date).getTime())/86400000);
if(daysSince<75||daysSince>550) continue;
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
toast(added>0?`${added} accounts added to reorder queue`:`No new accounts in reorder window`,"success");
}catch(e){
toast(`Zoho sync failed: ${e.message.slice(0,100)}`,"error");
}
setPulling(false);
};
const addManual=()=>{
if(!form.school.trim()) return toast("School name required","error");
dispatch("ADD_REORDER",{
id:mkId(),
school:form.school,contact:form.contact,state:form.state,sport:form.sport,
lastOrderDate:form.lastOrderDate,
lastItems:form.lastItems.split(",").map(x=>x.trim()).filter(Boolean),
lastOrderValue:parseFloat(form.lastOrderValue)||0,
status:"pending",source:"manual",
});
setForm({school:"",contact:"",state:"",sport:"Track & Field",lastOrderDate:"",lastItems:"",lastOrderValue:""});
setShowAdd(false);
toast("Added to reorder queue","success");
};
const checkInCount=withDays.filter(r=>r.stage==="check-in").length;
const followUpCount=withDays.filter(r=>r.stage==="follow-up").length;
const FILTERS=[
["all","ALL",null],
["90","90D · EARLY",B.blue],
["180","180D · CHECK-IN",B.orange],
["270","270D · FOLLOW-UP",B.red],
["365","365D · LAPSED",B.muted],
];
return (
<div style={{padding:"22px 26px"}}>
<PH title="REORDER ENGINE"
sub={`${withDays.length} in window · ${checkInCount} check-in${checkInCount!==1?"s":""} ready · ${followUpCount} need follow-up`}
action={
<div style={{display:"flex",gap:7}}>
<GBtn onClick={autoDraftCheckIns} disabled={autoDrafting} style={{fontSize:10,padding:"4px 10px"}}>
{autoDrafting?"DRAFTING…":"⚡ AUTO-DRAFT 180D"}
</GBtn>
<GBtn onClick={()=>setShowAdd(v=>!v)} style={{fontSize:10,padding:"4px 10px"}}>{showAdd?"CANCEL":"+ ADD"}</GBtn>
<OBtn onClick={pullFromZoho} disabled={pulling}>{pulling?"SYNCING…":"↓ SYNC ZOHO"}</OBtn>
</div>
}
/>
{/* Stats */}
<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:11,marginBottom:18}}>
<KCard l="Queue" v={withDays.length} c={B.text}/>
<KCard l="90d Early" v={withDays.filter(r=>r.stage==="early").length} c={B.blue}/>
<KCard l="180d Check-In" v={checkInCount} c={B.orange}/>
<KCard l="270d Follow-Up" v={followUpCount} c={B.red}/>
<KCard l="Sent" v={(s.reorders||[]).filter(r=>r.status==="sent").length} c={B.green}/>
</div>
{/* Top 5 priority panel */}
{top5.length>0&&(
<div style={{background:B.surface,borderRadius:8,padding:14,marginBottom:18,border:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:11}}>TOP 5 · REACH OUT NOW</div>
<div style={{display:"flex",flexDirection:"column",gap:7}}>
{top5.map((r,i)=>{
const st=STAGE[r.stage]||STAGE.early;
return(
<div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 11px",background:B.white,borderRadius:6,border:`1px solid ${B.border}`,borderLeft:`3px solid ${st.color}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,minWidth:18}}>#{i+1}</div>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{typeof r.school==="string"?r.school:r.school?.name||""}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{r.sport}{r.contact?` · ${typeof r.contact==="string"?r.contact:r.contact?.name||""}`:""}{r.state?`, ${r.state}`:""}</div>
</div>
<div style={{textAlign:"right",flexShrink:0,marginRight:6}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:st.color,letterSpacing:.5,marginBottom:1}}>{st.label} · {r.daysSince}d AGO</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{fmt$(r.lastOrderValue)}</div>
</div>
<OBtn sm onClick={()=>draftReo(r)} disabled={drafting===r.id}>{drafting===r.id?"…":"✦ DRAFT"}</OBtn>
</div>
);
})}
</div>
</div>
)}
{/* Day-range filter tabs */}
<div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
{FILTERS.map(([v,label,col])=>{
const active=dayFilter===v;
const c=active?(col||B.orange):B.muted;
return(
<button key={v} onClick={()=>setDayFilter(v)}
style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:.5,padding:"4px 11px",borderRadius:4,
border:`1px solid ${active?(col||B.orange):B.border}`,
background:active?(col||B.orange)+"22":"transparent",
color:active?(col||B.orange):B.muted,cursor:"pointer"}}>
{label}
</button>
);
})}
{dayFilter!=="all"&&(
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,alignSelf:"center",marginLeft:4}}>
{filtered.length} account{filtered.length!==1?"s":""}
</span>
)}
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
<input value={form.lastItems} onChange={e=>setForm(f=>({...f,lastItems:e.target.value}))} placeholder="Blazer blocks, Gill discus…" style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
</div>
<div>
<Lbl s={{marginBottom:3}}>Order Value</Lbl>
<input type="number" value={form.lastOrderValue} onChange={e=>setForm(f=>({...f,lastOrderValue:e.target.value}))} placeholder="0" style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/>
</div>
</div>
<OBtn onClick={addManual}>ADD TO QUEUE</OBtn>
</div>
)}
{filtered.length===0&&!showAdd&&(
<div style={{textAlign:"center",padding:"40px 0"}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.border,marginBottom:6}}>ALL CLEAR</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
{dayFilter==="all"?"Sync Zoho Books or add accounts manually to populate this queue.":"No accounts in this time window."}
</div>
</div>
)}
{filtered.map(r=>{
const st=STAGE[r.stage]||STAGE.early;
return(
<div key={r.id} className="card fu" style={{padding:"11px 13px",marginBottom:10,borderLeft:`3px solid ${st.color}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500}}>{typeof r.school==="string"?r.school:r.school?.name||""}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:st.color,background:st.color+"18",padding:"2px 6px",borderRadius:3,letterSpacing:.5}}>{st.label}</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[r.contact,r.state,r.sport].filter(Boolean).join(" · ")}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>
Last order: {fmtD(r.lastOrderDate)}&nbsp;
<span style={{color:st.color,fontWeight:600}}>({r.daysSince}d ago)</span>
&nbsp;· {(r.lastItems||[]).slice(0,2).join(", ")||"—"} · {fmt$(r.lastOrderValue)}
</div>
</div>
<div style={{display:"flex",gap:6,flexShrink:0,marginLeft:11}}>
<OBtn sm onClick={()=>draftReo(r)} disabled={drafting===r.id}>{drafting===r.id?"…":"✦ DRAFT"}</OBtn>
<GBtn onClick={()=>{dispatch("UPDATE_REORDER",{id:r.id,snoozedUntil:new Date(now+86400000*30).toISOString().slice(0,10)});toast("Snoozed 30 days");}} style={{fontSize:10,padding:"4px 8px"}}>Snooze 30d</GBtn>
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
);
})}
</div>
);
}
const SCRAPE_TASK_ID = "prospecting_scrape";
// Contact lists only store contactIds — the actual contact record can live
// in the local (uploaded/scraped) s.contacts array OR in the Postgres
// salesContact table (contacts found via CRM search / area-browse never get
// copied into s.contacts). Resolve against local state first, then fetch
// whatever's missing from /api/contacts?ids=... . Used by both the Brad
// "MY LISTS" tab and the Segments "LISTS" tab so both stay in sync.
function ContactListCard({ list, localContacts, isOpen, onToggle, isRenaming, renameValue, onRenameStart, onRenameChange, onRenameSave, onRenameCancel, onDelete, onUseInCampaign }) {
const [preview,setPreview]=useState(null);
const [full,setFull]=useState(null);
const [fullLoading,setFullLoading]=useState(false);
const total=(list.contactIds||[]).length;
const companyOf=c=>(typeof c.school==="string"?c.school:c.school?.name||"")||c.companyName||"";
const resolveIds=async(ids)=>{
if(!ids.length) return [];
const localMap=Object.fromEntries((localContacts||[]).map(c=>[c.id,c]));
const missing=ids.filter(id=>!localMap[id]);
let fetchedMap={};
if(missing.length){
try{
const r=await fetch(`/api/contacts?ids=${encodeURIComponent(missing.join(","))}`);
const d=await r.json();
fetchedMap=Object.fromEntries((d.contacts||[]).map(c=>[c.id,c]));
}catch{}
}
return ids.map(id=>localMap[id]||fetchedMap[id]).filter(Boolean);
};
useEffect(()=>{
let alive=true;
resolveIds((list.contactIds||[]).slice(0,3)).then(r=>{if(alive)setPreview(r);});
return ()=>{alive=false;};
// eslint-disable-next-line react-hooks/exhaustive-deps
},[list.id,total]);
useEffect(()=>{
if(!isOpen) return;
let alive=true;
setFullLoading(true);
resolveIds((list.contactIds||[]).slice(0,300)).then(r=>{if(alive){setFull(r);setFullLoading(false);}});
return ()=>{alive=false;};
// eslint-disable-next-line react-hooks/exhaustive-deps
},[isOpen,list.id]);
return(
<div className="card" style={{padding:0,overflow:"hidden",borderLeft:`3px solid ${B.orange}`}}>
<div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",flexWrap:"wrap"}}>
{isRenaming?(
<input autoFocus value={renameValue} onChange={e=>onRenameChange(e.target.value)}
onKeyDown={e=>{if(e.key==="Enter")onRenameSave();if(e.key==="Escape")onRenameCancel();}}
style={{flex:1,background:B.surface,border:`1px solid ${B.orange}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:13,fontFamily:"'Lexend',sans-serif",fontWeight:600}}/>
):(
<div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={onToggle}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{list.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{total} contacts · {list.createdAt?new Date(list.createdAt).toLocaleDateString():""} {isOpen?"· click to collapse":"· click to preview"}</div>
{!isOpen&&(
preview===null?(
<div style={{marginTop:5,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Loading preview…</div>
):preview.length>0?(
<div style={{marginTop:5,display:"flex",flexDirection:"column",gap:2}}>
{preview.map(c=>{const name=[c.firstName,c.lastName].filter(Boolean).join(" ")||c.email||"Unnamed";const company=companyOf(c);return(
<div key={c.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
<span style={{color:B.text,fontWeight:500}}>{name}</span>{c.email?` · ${c.email}`:""}{company?` · ${company}`:""}
</div>
);})}
{total>preview.length&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange}}>+{total-preview.length} more — click to view full list</div>}
</div>
):(
<div style={{marginTop:5,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,fontStyle:"italic"}}>Contacts not found — they may have been removed</div>
)
)}
</div>
)}
<div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
{isRenaming?(<><OBtn sm onClick={onRenameSave}>SAVE</OBtn><button onClick={onRenameCancel} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:13}}>✕</button></>):(<>
<button onClick={onRenameStart} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>RENAME</button>
<OBtn sm col={B.teal} onClick={onUseInCampaign}>USE IN CAMPAIGN →</OBtn>
<button onClick={onDelete} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:16,padding:"2px 4px"}}>×</button>
<span onClick={onToggle} style={{color:B.muted,fontSize:11,cursor:"pointer"}}>{isOpen?"▲":"▼"}</span>
</>)}
</div>
</div>
{isOpen&&(
<div style={{borderTop:`1px solid ${B.border}`,padding:"10px 14px",maxHeight:360,overflowY:"auto"}}>
{fullLoading&&full===null?(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>Loading contacts…</div>
):(full||[]).length===0?(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>No contacts could be resolved for this list.</div>
):(
<div style={{display:"flex",flexDirection:"column",gap:4}}>
{full.map(c=>{const name=[c.firstName,c.lastName].filter(Boolean).join(" ")||c.email||"Unnamed";const company=companyOf(c);return(
<div key={c.id} style={{display:"flex",gap:8,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,padding:"4px 0",borderBottom:`1px solid ${B.border}`,flexWrap:"wrap"}}>
<span style={{fontWeight:600,minWidth:150}}>{name}</span>
<span style={{color:B.muted,fontSize:10}}>{c.email||"no email"}</span>
{company&&<span style={{color:B.blue,fontSize:9,background:B.blueBg,padding:"1px 6px",borderRadius:3}}>{company}</span>}
</div>
);})}
{total>full.length&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>…and {total-full.length} more (showing first {full.length})</div>}
</div>
)}
</div>
)}
</div>
);
}
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
const [view,setView]=useState("brad");
useEffect(()=>{
if(!s.prospectingNav) return;
setView(s.prospectingNav);
dispatch("SET_PROSPECTING_NAV",null);
},[s.prospectingNav]);
const [areas,setAreas]=useState((s.prospectAreas||[]).length>0?s.prospectAreas:[DEFAULT_AREA]);
const [segView,setSegView]=useState("segments");
const [editing,setEditing]=useState(null);
const [areaCounts,setAreaCounts]=useState({});
useEffect(()=>{ dispatch("SET_PROSPECT_AREAS",areas); },[JSON.stringify(areas)]);
const loadAreaCounts=async(areaList)=>{
const counts={};
await Promise.all((areaList||areas).map(async area=>{
try{
const r=await fetch('/api/contacts/area-count',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({sports:area.sports||[],states:area.states||[],roles:area.roles||[]})});
const d=await r.json();
counts[area.id]=d.count||0;
}catch{counts[area.id]=0;}
}));
setAreaCounts(counts);
};
const [activeArea,setActiveArea]=useState(null);
const abortRef=useRef(false);
const importFileRef=useRef();
const apolloFileRef=useRef();
const savedTask = bgTasks.getTask(SCRAPE_TASK_ID);
const [phase,setPhase]     = useState(savedTask?.status==="running"?"scraping":savedTask?.status==="done"?"done":"idle");
const [progress,setProgress] = useState(savedTask?.progress||0);
const [schools,setSchools] = useState(savedTask?.orgs||[]);
const [contacts,setContacts] = useState(savedTask?.contacts||[]);
const [log,setLog]         = useState(savedTask?.log||[]);
const [zohoPulling, setZohoPulling] = useState(false);
const [zohoPullResult, setZohoPullResult] = useState(null);
const [backfillRunning,setBackfillRunning] = useState(false);
const [backfillResult,setBackfillResult]   = useState(null);
const [linkingAccounts,setLinkingAccounts] = useState(false);
const [linkAccountsResult,setLinkAccountsResult] = useState(null);
const [aligningZoho,setAligningZoho] = useState(false);
const [alignZohoResult,setAlignZohoResult] = useState(null);
const [syncingBooks,setSyncingBooks] = useState(false);
const [syncBooksResult,setSyncBooksResult] = useState(null);
const [showNoContactAccounts,setShowNoContactAccounts] = useState(false);
const [importPhase,setImportPhase]     = useState("idle");
const [importState,setImportState]     = useState("");
const [importRows,setImportRows]       = useState([]);
const [importSel,setImportSel]             = useState(new Set());
const [importListName,setImportListName]   = useState("");
const [importSport,setImportSport]         = useState("");
const [importNotes,setImportNotes]         = useState("");
const [importFile,setImportFile]           = useState(null);
const [importProgress,setImportProgress]   = useState(0);
const [importStatus,setImportStatus]       = useState("");
const [expandedListId,setExpandedListId]   = useState(null);
const [renamingListId,setRenamingListId]   = useState(null);
const [renameValue,setRenameValue]         = useState("");
const [addingToListId,setAddingToListId]   = useState(null);
const [listContactSearch,setListContactSearch] = useState("");
const [enrollingContact,setEnrollingContact] = useState(null);
const [flaggingContact,setFlaggingContact] = useState(null);
const [dbFilter,setDbFilter] = useState("all");
const [bulkSel,setBulkSel] = useState(new Set());
const [timelineContact,setTimelineContact] = useState(null);
const [bulkEnrolling,setBulkEnrolling] = useState(false);
const [noteContactId,setNoteContactId] = useState(null);
const [noteText,setNoteText] = useState("");
const [bradTask,setBradTask]=useState("");
const [bradLoading,setBradLoading]=useState(false);
const [bradResult,setBradResult]=useState(null);
const [bradSending,setBradSending]=useState(null);
const [oneOffName,setOneOffName]=useState("");
const [oneOffEmail,setOneOffEmail]=useState("");
const [oneOffContext,setOneOffContext]=useState("");
const [oneOffDraft,setOneOffDraft]=useState(null);
const [oneOffLoading,setOneOffLoading]=useState(false);
const [oneOffSending,setOneOffSending]=useState(false);
const [oneOffMode,setOneOffMode]=useState("ai");
const [oneOffSubject,setOneOffSubject]=useState("");
const [oneOffBody,setOneOffBody]=useState("");
const [bradReplies,setBradReplies]=useState([]);
const [bradRepliesLoading,setBradRepliesLoading]=useState(false);
const [bradTab,setBradTab]=useState("prospect");
const [dbContacts,setDbContacts]=useState([]);
const [dbTotal,setDbTotal]=useState(0);
const [dbPage,setDbPage]=useState(1);
const [dbSearch,setDbSearch]=useState("");
const [dbLoading,setDbLoading]=useState(false);
const [dbPromoting,setDbPromoting]=useState(null);
const dbSearchRef=React.useRef("");
const [areaContactsAreaId,setAreaContactsAreaId]=useState(null);
const [areaContactsList,setAreaContactsList]=useState([]);
const [areaContactsTotal,setAreaContactsTotal]=useState(0);
const [areaContactsPage,setAreaContactsPage]=useState(1);
const [areaContactsLoading,setAreaContactsLoading]=useState(false);
const [areaContactsSel,setAreaContactsSel]=useState(new Set());
const [areaContactsStateF,setAreaContactsStateF]=useState('');
const [areaContactsSportF,setAreaContactsSportF]=useState('');
const [areaContactsAllLoading,setAreaContactsAllLoading]=useState(false);
const [buildingSegment,setBuildingSegment]=useState(null);
const [buildingSegmentIsNew,setBuildingSegmentIsNew]=useState(false);
const [buildingSegmentCount,setBuildingSegmentCount]=useState(null);
const [buildingSegmentCountLoading,setBuildingSegmentCountLoading]=useState(false);
const [segFacets,setSegFacets]=useState(null);
const [segFacetsLoading,setSegFacetsLoading]=useState(false);
const addLog=(msg,type="info")=>{
const entry={id:mkId(),msg,type,ts:Date.now()};
setLog(l=>[entry,...l.slice(0,99)]);
bgTasks.appendLog(SCRAPE_TASK_ID,msg,type);
};
const loadDbContacts=async(page=1,search=dbSearchRef.current)=>{
setDbLoading(true);
try{
const params=new URLSearchParams({page,limit:50});
if(search)params.set("search",search);
const r=await fetch(`/api/contacts?${params}`);
const d=await r.json();
setDbContacts(d.contacts||[]);
setDbTotal(d.total||0);
setDbPage(page);
}catch(e){toast("Could not load contacts: "+e.message,"error");}
setDbLoading(false);
};
const promoteToZoho=async(contactId)=>{
setDbPromoting(contactId);
try{
const r=await fetch('/api/contacts/promote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactId})});
const d=await r.json();
if(d.ok){
toast("Promoted to Zoho CRM","success");
setDbContacts(cs=>cs.map(c=>c.id===contactId?{...c,pushedToZoho:true,zohoCrmId:d.zohoId}:c));
}else toast(d.error||"Promote failed","error");
}catch(e){toast("Promote error: "+e.message,"error");}
setDbPromoting(null);
};
const loadAreaContacts=async(area,page=1,stateF='',sportF='')=>{
setAreaContactsLoading(true);
setAreaContactsPage(page);
try{
const r=await fetch('/api/contacts/area-browse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sports:area.sports||[],states:area.states||[],roles:area.roles||[],page,limit:50,stateFilter:stateF,sportFilter:sportF})});
const d=await r.json();
setAreaContactsList(d.contacts||[]);
setAreaContactsTotal(d.total||0);
}catch(e){toast('Failed to load contacts: '+e.message,'error');}
setAreaContactsLoading(false);
};
const selectAllAreaContacts=async(area,stateF,sportF)=>{
setAreaContactsAllLoading(true);
try{
const r=await fetch('/api/contacts/area-browse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sports:area.sports||[],states:area.states||[],roles:area.roles||[],page:1,limit:5000,stateFilter:stateF,sportFilter:sportF})});
const d=await r.json();
const ids=new Set((d.contacts||[]).map(c=>c.id));
setAreaContactsSel(ids);
toast(`${ids.size.toLocaleString()} contacts selected`,'success');
}catch(e){toast('Select all failed','error');}
setAreaContactsAllLoading(false);
};
const loadBradReplies=async()=>{
setBradRepliesLoading(true);
try{
const r=await fetch('/api/brad-replies');
const d=await r.json();
setBradReplies((d.replies||[]).filter(r=>r.outcome==='pending'));
}catch{}
setBradRepliesLoading(false);
};
const markReplyHandled=async(id)=>{
try{
await fetch('/api/brad-replies',{method:'POST',headers:{'Content-Type':'application/json','x-action':'mark-handled'},body:JSON.stringify({id})});
setBradReplies(rs=>rs.filter(r=>r.id!==id));
toast("Marked handled","success");
}catch(e){toast("Error: "+e.message,"error");}
};
const sendManualEmail=async()=>{
if(!oneOffEmail.trim()){toast("Email is required","error");return;}
if(!oneOffSubject.trim()){toast("Subject is required","error");return;}
if(!oneOffBody.trim()){toast("Body is required","error");return;}
setOneOffSending(true);
try{
const r=await fetch('/api/agents/brad-send',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({contactEmail:oneOffEmail.trim(),contactName:oneOffName.trim()||oneOffEmail.split('@')[0],subject:oneOffSubject.trim(),body:oneOffBody.trim()})});
const d=await r.json();
if(d.sent){
toast(`✉ Sent to ${oneOffName||oneOffEmail}`,'success');
dispatch("LOG",{msg:`Brad sent: ${oneOffName||oneOffEmail} — "${oneOffSubject}"`});
setOneOffName("");setOneOffEmail("");setOneOffContext("");setOneOffSubject("");setOneOffBody("");
}else toast(d.error||"Send failed","error");
}catch(e){toast("Send error: "+e.message,"error");}
setOneOffSending(false);
};
const tog=(arr,v)=>arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];
const hotLeads=useMemo(()=>(s.contacts||[]).filter(c=>(c.score||0)>0).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5),[s.contacts]);
const BRAD_AUTO_TASK="Look at my top-scored contacts and identify who I should reach out to today. Prioritize contacts not touched in 2+ weeks, contacts at schools near active pipeline deals, and high-value prospects. Draft personalized emails for the 5 best targets. Include a brief note on why each one is worth contacting right now.";
const runBrad=async(task)=>{
setBradLoading(true);setBradResult(null);
try{
const r=await fetch('/api/agents/brad',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({task:task||BRAD_AUTO_TASK,input:{limit:5,dryRun:true}})});
const d=await r.json();
setBradResult(d.metadata||d);
}catch(e){toast('Brad error: '+e.message,'error');}
setBradLoading(false);
};
const runOneOff=async()=>{
if(!oneOffEmail.trim()){toast("Email is required","error");return;}
setOneOffLoading(true);setOneOffDraft(null);
try{
const name=oneOffName.trim()||oneOffEmail.split("@")[0];
const r=await fetch('/api/agents/brad',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({
task:`Draft a warm, personalized first-touch email to ${name}${oneOffContext?` at ${oneOffContext}`:""}. Use the ST1 voice — direct, athlete-aware, under 120 words.${oneOffContext?" Context: "+oneOffContext:""}`,
input:{limit:1,dryRun:true,contacts:[{id:`oneoff-${Date.now()}`,firstName:name.split(" ")[0],lastName:name.split(" ").slice(1).join(" "),email:oneOffEmail.trim(),companyName:oneOffContext,school:oneOffContext,score:0,segment:"",notes:oneOffContext||"",status:"active"}]}
})});
const d=await r.json();
const draft=(d.metadata?.drafts||d.drafts||[])[0];
if(draft)setOneOffDraft(draft);
else toast(d.output||"No draft returned — Brad may have blocked this contact","error");
}catch(e){toast("Error: "+e.message,"error");}
setOneOffLoading(false);
};
const sendOneOff=async()=>{
if(!oneOffDraft)return;
setOneOffSending(true);
try{
const r=await fetch('/api/agents/brad-send',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({contactEmail:oneOffDraft.contactEmail,contactName:oneOffDraft.contactName,subject:oneOffDraft.subject,body:oneOffDraft.body})});
const d=await r.json();
if(d.sent){
toast(`✉ Sent to ${oneOffDraft.contactName||oneOffDraft.contactEmail}`,'success');
dispatch("LOG",{msg:`Brad one-off sent: ${oneOffDraft.contactName} — "${oneOffDraft.subject}"`});
setOneOffDraft(null);setOneOffName("");setOneOffEmail("");setOneOffContext("");
}else toast(d.error||"Send failed","error");
}catch(e){toast("Send error: "+e.message,"error");}
setOneOffSending(false);
};
const sendDraftEmail=async(draft,key)=>{
if(!draft.contactEmail){toast("No email address on file","error");return;}
setBradSending(key);
try{
const r=await fetch('/api/agents/brad-send',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({contactEmail:draft.contactEmail,contactName:draft.contactName,subject:draft.subject,body:draft.body,contactId:draft.contactId})});
const d=await r.json();
if(d.sent){
toast(`✉ Sent to ${draft.contactName||draft.contactEmail}`,'success');
dispatch("LOG",{msg:`Brad sent: ${draft.contactName||draft.contactEmail} — "${draft.subject}"`});
const contact=(s.contacts||[]).find(c=>c.email===draft.contactEmail);
if(contact)dispatch("SCORE_CONTACT",{contactId:contact.id,type:"sent",campaignId:"brad",note:`Brad: ${draft.subject}`});
}else toast(d.error||"Send failed","error");
}catch(e){toast(`Send error: ${e.message}`,"error");}
setBradSending(null);
};
useEffect(()=>{runBrad();loadBradReplies();},[]);
useEffect(()=>{if(view==="contacts"&&dbContacts.length===0)loadDbContacts(1,"");},[view]);
useEffect(()=>{if(view==="areas")loadAreaCounts();},[view]);
useEffect(()=>{
if(!buildingSegment)return;
const sports=buildingSegment.sports||[];
const states=buildingSegment.states||[];
const roles=buildingSegment.roles||[];
if(!sports.length&&!states.length&&!roles.length){setBuildingSegmentCount(null);return;}
setBuildingSegmentCountLoading(true);
const t=setTimeout(async()=>{
try{const r=await fetch("/api/contacts/area-count",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sports,states,roles})});const d=await r.json();setBuildingSegmentCount(d.count??0);}catch(e){}finally{setBuildingSegmentCountLoading(false);}
},400);
return()=>clearTimeout(t);
},[JSON.stringify(buildingSegment?.sports),JSON.stringify(buildingSegment?.states),JSON.stringify(buildingSegment?.roles)]);
useEffect(()=>{
if(!buildingSegment){setSegFacets(null);return;}
const sports=buildingSegment.sports||[];
const states=buildingSegment.states||[];
if(!sports.length&&!states.length){setSegFacets(null);return;}
setSegFacetsLoading(true);
const t=setTimeout(async()=>{
try{const r=await fetch("/api/contacts/segment-facets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sports,states})});const d=await r.json();setSegFacets(d);}catch(e){}
finally{setSegFacetsLoading(false);}
},300);
return()=>clearTimeout(t);
},[JSON.stringify(buildingSegment?.sports),JSON.stringify(buildingSegment?.states)]);
// Client-side facets from Redux s.contacts (campaign-tab uploads that never hit the DB)
const localSegFacets=useMemo(()=>{
  if(!buildingSegment) return {byState:{},titles:{},count:0};
  const sports=buildingSegment.sports||[];
  const states=buildingSegment.states||[];
  const roles=buildingSegment.roles||[];
  const allC=s.contacts||[];
  if(!sports.length&&!states.length) return {byState:{},titles:{},count:0};
  // Sport match: check sport field + title field, with aliases (XC = Cross Country)
  const sportMatch=(c)=>{
    if(!sports.length) return true;
    return sports.some(sp=>{
      const terms=[sp.toLowerCase(),...(SPORT_ALIASES_MAP[sp]||[])];
      const sportVal=(c.sport||'').toLowerCase();
      const titleVal=(c.title||'').toLowerCase();
      return terms.some(t=>sportVal.includes(t)||titleVal.includes(t));
    });
  };
  const stateMatch=(c)=>!states.length||states.some(st=>toStateAbbrClient(c.state||'')===st.toUpperCase());
  const roleMatch=(c)=>!roles.length||roles.some(r=>(c.title||'').toLowerCase().includes(r.toLowerCase()));
  // byState: sport-only filter (geographic landscape for selected sports)
  // Keys normalized to 2-letter abbr so the UI's st-keyed lookup works for "Iowa" → "IA" etc.
  const byState={};
  allC.filter(sportMatch).forEach(c=>{
    if(c.state){const abbr=toStateAbbrClient(c.state)||c.state;byState[abbr]=(byState[abbr]||0)+1;}
  });
  // titles: state-only filter (NOT sport-filtered — shows ADs and all roles in the state)
  const stateFiltered=states.length?allC.filter(stateMatch):allC.filter(sportMatch);
  const titleMap={};
  stateFiltered.forEach(c=>{if(c.title?.trim()) titleMap[c.title]=(titleMap[c.title]||0)+1;});
  // count: full AND filter
  const count=allC.filter(c=>sportMatch(c)&&stateMatch(c)&&roleMatch(c)).length;
  return {byState,titles:titleMap,count};
},[
  JSON.stringify(buildingSegment?.sports),
  JSON.stringify(buildingSegment?.states),
  JSON.stringify(buildingSegment?.roles),
  s.contacts
]);
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
const zohoFetchSince = async (module, fields, sinceMs, onProgress) => {
const fList = [...new Set(["id","Modified_Time",...fields])].join(",");
const dt = new Date(sinceMs).toISOString();
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
const existingDeals=s.deals||[]; const existingDealZohoIds=new Set(existingDeals.map(d=>d.zohoId).filter(Boolean));
const stageMap={"Qualification":"Quoted","Value Proposition":"Quoted","Id. Decision Makers":"Follow-Up 1","Perception Analysis":"Follow-Up 1","Proposal/Price Quote":"Quoted","Negotiation/Review":"Negotiating","Closed Won":"Closed Won","Closed Lost":"Closed Lost"};
let dealsAdded=0,dealsUpdated=0;
dealRows.forEach(zd=>{const zn=v=>typeof v==="string"?v:v?.name||v?.display_value||"";const zStage=zn(zd.Stage)||"Quoted";const localStage=DEAL_STAGES.includes(zStage)?zStage:(stageMap[zStage]||"Quoted");if(existingDealZohoIds.has(zd.id)){const local=existingDeals.find(d=>d.zohoId===zd.id);if(local&&local.stage!==localStage){dispatch("UPDATE_DEAL",{id:local.id,stage:localStage,zohoStage:zStage});dealsUpdated++;autoInvoiceOnClosedWon(local,local.stage,localStage,toast);}}else{dispatch("ADD_DEAL",{id:"zoho_d_"+zd.id,zohoId:zd.id,name:zn(zd.Deal_Name)||"Untitled",contact:zn(zd.Contact_Name),school:zn(zd.Account_Name),value:Number(zd.Amount)||0,stage:localStage,zohoStage:zStage,notes:zd.Description||"",followUpDate:zd.Closing_Date||"",lastTouch:now,priority:"warm",touchHistory:[],source:"zoho-crm"});dealsAdded++;}});
return {contacts:contacts.length,leads:leads.length,deals:dealRows.length,added:toAdd.length,updated:toUpdate.length,dealsAdded,dealsUpdated};
};
const CONTACT_FIELDS = ["First_Name","Last_Name","Email","Phone","Title","Account_Name","Mailing_City","Mailing_State","Lead_Source","Last_Activity_Time","Modified_Time"];
const LEAD_FIELDS    = ["First_Name","Last_Name","Email","Phone","Title","Company","City","State","Lead_Source","Lead_Status","Rating","No_of_Calls","No_of_Chats","Last_Activity_Time","Modified_Time","Created_Time","Description","Converted"];
const DEAL_FIELDS    = ["Deal_Name","Amount","Stage","Closing_Date","Account_Name","Contact_Name","Description","Modified_Time","Created_Time"];
const pullFromZoho = async () => {
const lastSync = s.contactsLastSync;
if(!lastSync) { return pullFromZohoFull(); }
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
const [fullPulling,setFullPulling] = useState(false);
const pullFromZohoFull = async () => {
setFullPulling(true); setZohoPullResult(null);
toast("Full pull from Zoho CRM (all records since 2019, monthly chunks)...","info");
setZohoPullResult({contacts:0,leads:0,deals:0,added:0,updated:0,loading:true});
try {
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
const detectImportMeta=(text)=>{
if(!text) return;
const lower=text.toLowerCase();
// State: check full names first, then 2-letter abbreviations as standalone words
let detectedState='';
for(const [full,abbr] of Object.entries(STATE_FULL_TO_ABBR)){
if(lower.includes(full)){detectedState=abbr;break;}
}
if(!detectedState){
for(const abbr of US_STATES){
if(new RegExp(`\\b${abbr.toLowerCase()}\\b`).test(lower)){detectedState=abbr;break;}
}
}
if(detectedState) setImportState(s=>s||detectedState);
// Sport: detect from text
const sp=lower;
if(/\btrack\b|t&f|cross.?country|\bxc\b/.test(sp)) setImportSport(s=>s||"Track & Field");
else if(/baseball|softball/.test(sp)) setImportSport(s=>s||"Baseball/Softball");
else if(/volleyball/.test(sp)) setImportSport(s=>s||"Volleyball");
else if(/football/.test(sp)) setImportSport(s=>s||"Football");
else if(/basketball/.test(sp)) setImportSport(s=>s||"Basketball");
else if(/wrestling/.test(sp)) setImportSport(s=>s||"Wrestling");
};
const handleListUpload=async(e)=>{
const file=e.target.files[0]; if(!file)return;
e.target.value="";
const autoName=file.name.replace(/\.[^.]+$/,"").replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
setImportFile(file);
if(!importListName){setImportListName(autoName);detectImportMeta(autoName);}
setImportPhase("setup");
};
const handleApolloUpload=async(e)=>{
const file=e.target.files[0]; if(!file)return;
e.target.value="";
const autoName=file.name.replace(/\.[^.]+$/,"").replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
setImportFile({...file, _isApollo:true, name:file.name, _fileObj:file});
if(!importListName){setImportListName(autoName);detectImportMeta(autoName);}
setImportPhase("setup");
};
const analyzeImportFile=async()=>{
if(!importFile) return;
const isApollo=!!(importFile._isApollo);
const fileObj=importFile._fileObj||importFile;
setImportPhase("parsing"); setImportRows([]);
try {
setImportProgress(20); setImportStatus("Reading file…");
const buf=await toBuffer(fileObj);
const XLSX=await import("xlsx");
const wb=XLSX.read(buf,{type:"array"});
const ws=wb.Sheets[wb.SheetNames[0]];
const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
if(rows.length===0){toast("File appears empty — check the file and try again","error");setImportPhase("setup");setImportProgress(0);return;}
// --- AI column mapping ---
setImportProgress(25); setImportStatus("AI is reading your columns…");
const headers=Object.keys(rows[0]||{});
let aiMap={}; // fieldName → exact column header as it appears in the file
try{
const samp=Object.fromEntries(Object.entries(rows[0]||{}).slice(0,30));
const result=await aiCall(
`You are mapping CSV column headers to a contact database. Return ONLY valid JSON.

Column headers: ${headers.slice(0,50).join(", ")}
First row values: ${JSON.stringify(samp)}

Map each header to ONE of these field names (only include confident mappings):
firstName, lastName, email, phone, title, companyName, city, state, sport, linkedIn, notes, location

Rules:
- "location" = a single column that has combined city+state like "Des Moines, Iowa" or "Des Moines, IA"
- state variants: "Mailing State", "State/Province", "Province", "State Name" → state
- city variants: "Mailing City", "City/Town" → city
- company variants: "School", "Organization", "District", "Employer", "Account Name" → companyName
- If a column clearly maps to a field, include it. Skip ambiguous columns.

Return JSON: {"fieldName": "Exact Column Header As Written"}`,
{json:true,tokens:400,model:"claude-haiku-4-5-20251001"}
);
if(result&&typeof result==='object'&&!Array.isArray(result)) aiMap=result;
}catch(e){}
setImportProgress(50); setImportStatus(`Reading ${rows.length} contacts…`);
const norm=s=>String(s||"").toLowerCase().replace(/[\s_\-\.]/g,"");
const get=(row,...keys)=>{
const entry=Object.entries(row).find(([k])=>keys.some(kk=>norm(k)===norm(kk)));
return entry?String(entry[1]||"").trim():"";
};
// AI mapping takes priority; falls back to fuzzy header matching
const res=(row,field,...fallback)=>{
const col=aiMap[field];
if(col&&col in row) return String(row[col]||"").trim();
return get(row,...fallback);
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
const firstName=res(row,"firstName","First Name","FirstName","first","fname","first_name");
const lastName=res(row,"lastName","Last Name","LastName","last","lname","last_name");
const fullName=res(row,"fullName","Full Name","FullName","Name","full_name")||[firstName,lastName].filter(Boolean).join(" ");
const email=res(row,"email","Email","Email Address","EmailAddress","E-mail","email_address","Work Email");
const phone=res(row,"phone","Phone","Phone Number","PhoneNumber","Mobile","Cell","Telephone","phone_number","Work Phone","Direct Phone");
const title=res(row,"title","Title","Job Title","JobTitle","Position","Role","job_title","Seniority");
const school=res(row,"companyName","Company","School","Organization","Org","Institution","District","Club","Employer","Account Name","Company Name");
const notes=res(row,"notes","Notes","Note","Comments","Comment","Description","Bio");
const linkedIn=res(row,"linkedIn","LinkedIn URL","LinkedIn","LinkedInURL","linkedin_url","LinkedIn Profile","Profile URL");
let city=res(row,"city","City","Town","Mailing City","MailingCity");
let state=res(row,"state","State","Province","Mailing State","MailingState","State/Province","StateName","State Name");
if(!state){
// location column: "Des Moines, Iowa, United States" or "Des Moines, IA"
const loc=res(row,"location","Location","Address","Region","Geography","Mailing Address");
if(loc){
const parts=loc.split(",").map(p=>p.trim()).filter(Boolean);
if(parts.length>=2){
state=parts.length>=3?parts[parts.length-2]:parts[parts.length-1];
if(!city) city=parts[0];
}
}
}
// Fall back to list-level state if no state found in the row
if(!state&&importState) state=importState;
if(!fullName&&!email) return null;
const sportCol=res(row,"sport","Sport","Sports","Sport Name");
// Fall back to list-level sport if no sport found in the row
const sport=sportCol||inferSport(title)||(importSport||"General");
return {
id:mkId(), firstName, lastName,
fullName:fullName||email||"Unknown",
email, phone, title, school, city, state, linkedIn, notes,
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
const commitListImport=async()=>{
const selected=importRows.filter(c=>importSel.has(c.id)&&c.email);
if(selected.length===0){toast("No contacts with emails selected","error");return;}
const BATCH=500;
let totalAdded=0,totalUpdated=0;
setImportPhase("parsing");
for(let i=0;i<selected.length;i+=BATCH){
const batch=selected.slice(i,i+BATCH);
setImportProgress(Math.round((i/selected.length)*100));
setImportStatus(`Uploading ${Math.min(i+BATCH,selected.length)} of ${selected.length}…`);
try{
const r=await fetch('/api/contacts/import',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({contacts:batch.map(c=>({...c,score:c.priority==='high'?80:c.priority==='medium'?40:20}))})});
const d=await r.json();
totalAdded+=d.added||0;totalUpdated+=d.updated||0;
}catch(e){toast(`Upload error at batch ${Math.floor(i/BATCH)+1}: ${e.message}`,"error");}
}
setImportProgress(100);setImportStatus("Done!");
const listName=(importListName||"Imported List").trim();
const newList={id:mkId(),name:listName,contactIds:selected.map(c=>c.id),createdAt:Date.now(),source:"import"};
dispatch("ADD_CONTACT_LIST",newList);
const toastMsg=totalUpdated>0
?`"${listName}" · ${totalAdded} new · ${totalUpdated} enriched with missing fields`
:`"${listName}" · ${totalAdded} new contacts added`;
toast(toastMsg,"success");
setTimeout(()=>{
setImportPhase("idle");setImportRows([]);setImportSel(new Set());setImportListName("");setImportSport("");setImportNotes("");setImportState("");setImportFile(null);
setDbTotal(t=>totalAdded>0?t+totalAdded:t);
setView("contacts");loadDbContacts(1,"");
},800);
};
const logC={success:B.green,warn:B.yellow,error:B.red,info:B.muted,muted:B.muted};
const statDot={done:B.green,scraping:B.orange,empty:B.muted,pending:B.border};
const totalContactsAll=dbTotal+(s.contacts||[]).length;
const PVIEWS=[["brad","✉ BRAD"],["contacts",`CONTACTS (${totalContactsAll>0?totalContactsAll.toLocaleString():"DB"})`],["areas","SEGMENTS"],["campaigns","CAMPAIGNS"]];
return (
<div style={{padding:"22px 26px"}}>
<PH title="BRAD" sub="AI outreach recommendations — reads your CRM and drafts personalized emails"
action={<div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><button onClick={()=>setView("import")} style={{background:"none",color:view==="import"?B.orange:B.muted,border:`1px solid ${view==="import"?B.orange:B.border}`,borderRadius:4,padding:"4px 9px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:view==="import"?700:400,letterSpacing:.3,cursor:"pointer"}}>↑ IMPORT</button><div style={{width:1,height:18,background:B.border,margin:"0 2px",flexShrink:0}}/>{PVIEWS.map(([v,l])=><button key={v} onClick={()=>setView(v)} style={{background:view===v?B.orange:B.white,color:view===v?B.white:B.muted,border:`1px solid ${view===v?B.orange:B.border}`,borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{l}</button>)}</div>}/>
{view==="contacts"&&(
<div>
{/* Search + stats bar */}
<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
<input value={dbSearch} onChange={e=>{setDbSearch(e.target.value);dbSearchRef.current=e.target.value;}}
onKeyDown={e=>e.key==="Enter"&&loadDbContacts(1,dbSearch)}
placeholder="Search by name, email, school…"
style={{flex:1,minWidth:180,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn sm onClick={()=>loadDbContacts(1,dbSearch)} disabled={dbLoading}>{dbLoading?"LOADING…":"SEARCH"}</OBtn>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,whiteSpace:"nowrap"}}>
{totalContactsAll.toLocaleString()} total
{(s.contacts||[]).length>0&&<span style={{fontSize:9,marginLeft:5,color:B.border}}>({dbTotal.toLocaleString()} CRM · {(s.contacts||[]).length.toLocaleString()} uploaded)</span>}
</div>
</div>
{/* Contact rows */}
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{dbLoading&&<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Loading…</div>}
{!dbLoading&&dbContacts.length===0&&<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>{dbTotal===0?"No contacts imported yet — use IMPORT & SYNC to upload your list.":"No contacts matched your search."}</div>}
{dbContacts.map(c=>{
const name=[c.firstName,c.lastName].filter(Boolean).join(" ")||c.email;
const inZoho=c.pushedToZoho;
const promoting=dbPromoting===c.id;
return(
<div key={c.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,borderLeft:`3px solid ${inZoho?B.purple:B.border}`}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{name}</span>
{c.score>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,borderRadius:3,padding:"2px 5px"}}>{c.score}pts</span>}
{inZoho&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.purple,background:`${B.purple}15`,borderRadius:3,padding:"2px 5px"}}>IN ZOHO</span>}
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[c.title,c.companyName,c.email].filter(Boolean).join(" · ")}</div>
{(c.sport||c.state||c.city)&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:3}}>{c.sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c.sport}</span>}{(c.city||c.state)&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{[c.city,c.state].filter(Boolean).join(", ")}</span>}</div>}
</div>
<div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap"}}>
<button onClick={()=>{setOneOffName(name);setOneOffEmail(c.email);setOneOffContext(c.companyName||"");setView("brad");setTimeout(()=>window.scrollTo(0,document.body.scrollHeight),200);}}
style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 8px",borderRadius:3,cursor:"pointer"}}>✉ DRAFT</button>
{/* Only push to Zoho once there's a real signal (a reply) — no CRM
    promotion off a cold, unengaged contact. */}
{!inZoho&&(c.score||0)>=CONTACT_INTENT_SCORE&&<button onClick={()=>promoteToZoho(c.id)} disabled={promoting}
style={{background:promoting?B.border:B.purple,color:promoting?B.muted:B.white,border:"none",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,padding:"3px 10px",borderRadius:3,cursor:promoting?"default":"pointer",letterSpacing:.3}}>{promoting?"…":"↑ ZOHO"}</button>}
{!inZoho&&(c.score||0)<CONTACT_INTENT_SCORE&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,fontStyle:"italic"}}>no reply yet</span>}
</div>
</div>
);
})}
</div>
{/* Pagination */}
{dbTotal>50&&(
<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:16}}>
<GBtn onClick={()=>loadDbContacts(dbPage-1,dbSearch)} style={{fontSize:10,padding:"5px 10px",opacity:dbPage<=1?.4:1,pointerEvents:dbPage<=1?"none":"auto"}}>← PREV</GBtn>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Page {dbPage} of {Math.ceil(dbTotal/50)}</span>
<GBtn onClick={()=>loadDbContacts(dbPage+1,dbSearch)} style={{fontSize:10,padding:"5px 10px",opacity:dbPage>=Math.ceil(dbTotal/50)?.4:1,pointerEvents:dbPage>=Math.ceil(dbTotal/50)?"none":"auto"}}>NEXT →</GBtn>
</div>
)}
{/* Uploaded contacts section (Redux — CSVs, scraped, campaign uploads) */}
{(s.contacts||[]).length>0&&(
<div style={{marginTop:24,paddingTop:20,borderTop:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1,marginBottom:10}}>UPLOADED CONTACTS ({(s.contacts||[]).length.toLocaleString()})</div>
<div style={{display:"flex",flexDirection:"column",gap:5}}>
{(()=>{
  const q=dbSearch.toLowerCase().trim();
  const filtered=q?(s.contacts||[]).filter(c=>[c.firstName,c.lastName,c.email,c.title,c.school||c.companyName].filter(Boolean).join(" ").toLowerCase().includes(q)):(s.contacts||[]);
  return filtered.slice(0,100).map(c=>{
    const name=[c.firstName,c.lastName].filter(Boolean).join(" ")||c.email;
    return(
    <div key={c.id} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,borderLeft:`3px solid ${B.teal}`}}>
    <div style={{flex:1,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
    <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{name}</span>
    {c.score>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,borderRadius:3,padding:"2px 5px"}}>{c.score}pts</span>}
    </div>
    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[c.title,c.school||c.companyName,c.email].filter(Boolean).join(" · ")}</div>
    {(c.sport||c.state)&&<div style={{display:"flex",gap:5,marginTop:2,flexWrap:"wrap"}}>{c.sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c.sport}</span>}{c.state&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{[c.city,c.state].filter(Boolean).join(", ")}</span>}</div>}
    </div>
    </div>
    );
  });
})()}
{(()=>{
  const q=dbSearch.toLowerCase().trim();
  const filtered=q?(s.contacts||[]).filter(c=>[c.firstName,c.lastName,c.email,c.title,c.school||c.companyName].filter(Boolean).join(" ").toLowerCase().includes(q)):(s.contacts||[]);
  return filtered.length>100?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,padding:"8px 0",textAlign:"center"}}>Showing first 100 of {filtered.length.toLocaleString()} — use the search above to narrow results</div>:null;
})()}
</div>
</div>
)}
</div>
)}
{view==="areas"&&(
<div>
{areas.filter(a=>a.id===areaContactsAreaId).map(browseArea=>(
<div key={browseArea.id}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<button onClick={()=>{setAreaContactsAreaId(null);setAreaContactsSel(new Set());}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",color:B.muted,cursor:"pointer",letterSpacing:.3}}>← AREAS</button>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black}}>{browseArea.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{areaContactsLoading?"Loading…":`${areaContactsTotal.toLocaleString()} contacts match`}</div>
</div>
</div>
<div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
<button onClick={()=>setAreaContactsSel(s=>{const all=new Set(areaContactsList.map(c=>c.id));return areaContactsList.every(c=>s.has(c.id))&&s.size>0?new Set():all;})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:B.muted,cursor:"pointer"}}>{areaContactsList.length>0&&areaContactsList.every(c=>areaContactsSel.has(c.id))?"DESELECT":"SELECT PAGE"}</button>
{areaContactsTotal>areaContactsList.length&&<button onClick={()=>selectAllAreaContacts(browseArea,areaContactsStateF,areaContactsSportF)} disabled={areaContactsAllLoading} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:areaContactsAllLoading?B.muted:B.text,cursor:areaContactsAllLoading?"default":"pointer"}}>{areaContactsAllLoading?`SELECTING…`:`SELECT ALL ${areaContactsTotal.toLocaleString()}`}</button>}
{areaContactsSel.size>0&&<OBtn sm onClick={()=>{const nm=`${browseArea.name} – ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;const nl={id:mkId(),name:nm,contactIds:[...areaContactsSel],createdAt:Date.now(),source:"area-browse"};dispatch("ADD_CONTACT_LIST",nl);toast(`List "${nm}" created with ${areaContactsSel.size} contacts`,"success");setAreaContactsSel(new Set());}}>✓ CREATE LIST ({areaContactsSel.size})</OBtn>}
</div>
</div>
<div style={{marginBottom:12}}>
{(browseArea.sports||[]).length>0&&(
<div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,flexShrink:0,marginRight:2}}>SPORT</span>
{(browseArea.sports||[]).map(sp=>{const s=typeof sp==="string"?sp:sp?.name||"";const act=areaContactsSportF===s;return s?(<button key={s} onClick={()=>{const nv=act?'':s;setAreaContactsSportF(nv);loadAreaContacts(browseArea,1,areaContactsStateF,nv);}} style={{background:act?B.blue:B.white,color:act?B.white:B.muted,border:`1px solid ${act?B.blue:B.border}`,borderRadius:3,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:act?600:400}}>{s}</button>):null;})}
</div>
)}
{(browseArea.states||[]).length>0&&(
<div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,flexShrink:0,marginRight:2}}>STATE</span>
{(browseArea.states||[]).map(st=>{const s=typeof st==="string"?st:st?.name||"";const act=areaContactsStateF===s;return s?(<button key={s} onClick={()=>{const nv=act?'':s;setAreaContactsStateF(nv);loadAreaContacts(browseArea,1,nv,areaContactsSportF);}} style={{background:act?B.orange:B.white,color:act?B.white:B.muted,border:`1px solid ${act?B.orange:B.border}`,borderRadius:3,padding:"3px 9px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:act?600:400}}>{s}</button>):null;})}
{(areaContactsStateF||areaContactsSportF)&&<button onClick={()=>{setAreaContactsStateF('');setAreaContactsSportF('');loadAreaContacts(browseArea,1,'','');}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"3px 7px",fontSize:8,color:B.muted,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif",marginLeft:4}}>✕ ALL</button>}
</div>
)}
</div>
{areaContactsLoading&&<div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Loading…</div>}
{!areaContactsLoading&&areaContactsList.length===0&&<div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No matching contacts yet — import a list that includes {browseArea.sports?.join(" / ")||browseArea.name} contacts.</div>}
<div style={{display:"flex",flexDirection:"column",gap:6}}>{areaContactsList.map(c=>{const name=[c.firstName,c.lastName].filter(Boolean).join(" ")||c.email;const sel=areaContactsSel.has(c.id);return(<div key={c.id} onClick={()=>setAreaContactsSel(s=>{const ns=new Set(s);sel?ns.delete(c.id):ns.add(c.id);return ns;})} style={{background:sel?B.orangeBg:B.white,border:`1px solid ${sel?B.orange:B.border}`,borderLeft:`3px solid ${sel?B.orange:B.border}`,borderRadius:6,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}><div style={{width:16,height:16,border:`2px solid ${sel?B.orange:B.border}`,borderRadius:3,background:sel?B.orange:"none",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:B.white,fontSize:10,fontWeight:700}}>{sel&&"✓"}</div><div style={{flex:1,minWidth:0}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text,marginBottom:1}}>{name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{[c.title,c.companyName,c.email].filter(Boolean).join(" · ")}</div>{(c.sport||c.state)&&<div style={{display:"flex",gap:5,marginTop:2,flexWrap:"wrap"}}>{c.sport&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.blue,background:B.blueBg,padding:"2px 5px",borderRadius:3}}>{c.sport}</span>}{(c.city||c.state)&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{[c.city,c.state].filter(Boolean).join(", ")}</span>}</div>}</div>{c.score>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,padding:"2px 5px",borderRadius:3}}>{c.score}pts</span>}</div>);})}</div>
{areaContactsTotal>50&&(<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:14}}><GBtn onClick={()=>loadAreaContacts(browseArea,areaContactsPage-1,areaContactsStateF,areaContactsSportF)} style={{fontSize:10,padding:"5px 10px",opacity:areaContactsPage<=1?.4:1,pointerEvents:areaContactsPage<=1?"none":"auto"}}>← PREV</GBtn><span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Page {areaContactsPage} of {Math.ceil(areaContactsTotal/50)}</span><GBtn onClick={()=>loadAreaContacts(browseArea,areaContactsPage+1,areaContactsStateF,areaContactsSportF)} style={{fontSize:10,padding:"5px 10px",opacity:areaContactsPage>=Math.ceil(areaContactsTotal/50)?.4:1,pointerEvents:areaContactsPage>=Math.ceil(areaContactsTotal/50)?"none":"auto"}}>NEXT →</GBtn></div>)}
</div>
))}
{buildingSegment&&!areaContactsAreaId&&(
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:22,maxWidth:720}}>
{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginBottom:4}}>{buildingSegmentIsNew?"NEW SEGMENT":"EDIT SEGMENT"}</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black}}>Segment Builder</div>
</div>
<button onClick={()=>{setBuildingSegment(null);setBuildingSegmentIsNew(false);setBuildingSegmentCount(null);setSegFacets(null);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:B.muted,cursor:"pointer",letterSpacing:.3}}>✕ CANCEL</button>
</div>
{/* Name */}
<div style={{marginBottom:18}}>
<Lbl s={{marginBottom:6}}>SEGMENT NAME</Lbl>
<input value={buildingSegment.name} onChange={e=>setBuildingSegment(s=>({...s,name:e.target.value}))} style={{width:"100%",fontFamily:"'Lexend',sans-serif",fontSize:14,padding:"9px 11px",border:`1px solid ${B.border}`,borderRadius:5,background:B.surface,color:B.text,boxSizing:"border-box"}} placeholder="e.g. Iowa XC Coaches"/>
</div>
{/* Org Type */}
<div style={{marginBottom:20}}>
<Lbl s={{marginBottom:6}}>ORG TYPE</Lbl>
<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
{[["schools","🏫 Schools"],["clubs","⚽ Youth Clubs"],["both","Both"]].map(([v,l])=>(
<button key={v} onClick={()=>setBuildingSegment(s=>({...s,orgType:v}))} style={{background:buildingSegment.orgType===v?B.orange:B.white,color:buildingSegment.orgType===v?B.white:B.muted,border:`1px solid ${buildingSegment.orgType===v?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:buildingSegment.orgType===v?600:400}}>{l}</button>
))}
</div>
</div>
{/* Step 1: Sport */}
<div style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${B.border}`}}>
<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
<Lbl>1 · SPORT</Lbl>
{(buildingSegment.sports||[]).length>0&&(()=>{
  const dbTotal=Object.values(segFacets?.byState||{}).reduce((a,b)=>a+b,0);
  const localTotal=Object.values(localSegFacets?.byState||{}).reduce((a,b)=>a+b,0);
  const combined=dbTotal+localTotal;
  if(segFacetsLoading&&localTotal===0) return <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>…</span>;
  if(combined===0) return null;
  return <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green,background:`${B.green}12`,padding:"2px 8px",borderRadius:10,letterSpacing:.2}}>{combined.toLocaleString()} contacts found{segFacetsLoading?" (loading more…)":""}</span>;
})()}
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:5}}>
{SPORTS_LIST.map(o=>{const sel=(buildingSegment.sports||[]).includes(o);return(
<button key={o} onClick={()=>setBuildingSegment(s=>({...s,sports:tog(s.sports||[],o),roles:[]}))} style={{background:sel?`${B.orange}15`:B.white,color:sel?B.orange:B.muted,border:`1px solid ${sel?B.orange:B.border}`,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:sel?600:400}}>{o}</button>
);})}
</div>
</div>
{/* Step 2: Geography */}
<div style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${B.border}`}}>
<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
<Lbl>2 · GEOGRAPHY</Lbl>
{(buildingSegment.states||[]).length>0&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{(buildingSegment.states||[]).length} selected</span>}
{(buildingSegment.states||[]).length>0&&<button onClick={()=>setBuildingSegment(s=>({...s,states:[],regions:[]}))} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"1px 7px",fontSize:8,color:B.muted,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3}}>CLEAR</button>}
</div>
<div style={{marginBottom:10}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:6}}>REGION (bulk-select)</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4}}>
{Object.entries(US_REGIONS).map(([r,{states:rs,color}])=>{
const sel=(buildingSegment.regions||[]).includes(r);
const hasSports=(buildingSegment.sports||[]).length>0;
const regionCount=hasSports?rs.reduce((sum,st)=>sum+(segFacets?.byState?.[st]||0)+(localSegFacets?.byState?.[st]||0),0):null;
return(<button key={r} onClick={()=>setBuildingSegment(s=>{const cur=s.regions||[];const newRegions=sel?cur.filter(x=>x!==r):[...cur,r];const regionStates=[...new Set(newRegions.flatMap(rn=>US_REGIONS[rn]?.states||[]))];const curIndividual=(s.states||[]).filter(st=>!Object.values(US_REGIONS).flatMap(v=>v.states).includes(st));const newStates=[...new Set([...regionStates,...curIndividual])];return{...s,regions:newRegions,states:newStates};})} style={{background:sel?`${color}18`:B.white,color:sel?color:B.muted,border:`1px solid ${sel?color:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",fontWeight:sel?500:400,cursor:"pointer"}}>
{r}{regionCount!==null?<span style={{fontSize:8,opacity:.8}}> · {regionCount.toLocaleString()}</span>:null} <span style={{fontSize:8,opacity:.5}}>({rs.length})</span>
</button>);})}
</div>
</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:6}}>INDIVIDUAL STATES</div>
<div style={{display:"flex",flexWrap:"wrap",gap:3}}>
{US_STATES.map(st=>{
const sel=(buildingSegment.states||[]).includes(st);
const hasSports=(buildingSegment.sports||[]).length>0;
const cnt=hasSports?((segFacets?.byState?.[st]||0)+(localSegFacets?.byState?.[st]||0)):null;
const dimmed=hasSports&&!segFacetsLoading&&cnt===0&&!sel;
const regionColor=Object.entries(US_REGIONS).find(([,v])=>v.states.includes(st))?.[1]?.color||null;
return(<button key={st} onClick={()=>{if(dimmed)return;setBuildingSegment(s=>{const cur=s.states||[];return{...s,states:sel?cur.filter(x=>x!==st):[...cur,st]};});}} style={{background:sel?(regionColor?`${regionColor}18`:`${B.orange}18`):B.white,color:dimmed?`${B.border}`:sel?(regionColor||B.orange):B.muted,border:`1px solid ${sel?(regionColor||B.orange):B.border}`,borderRadius:3,padding:"3px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:dimmed?"default":"pointer",letterSpacing:.3,fontWeight:sel?600:400,opacity:dimmed?.3:1}}>
{st}{cnt!==null&&cnt>0&&<span style={{fontSize:8,opacity:.7,marginLeft:2}}>{cnt}</span>}
</button>);
})}
</div>
</div>
{/* Step 3: Roles — merged from DB + uploaded contacts */}
{((buildingSegment.sports||[]).length>0||(buildingSegment.states||[]).length>0)&&(()=>{
  const merged={};
  (segFacets?.titles||[]).forEach(({value,count})=>{merged[value]=(merged[value]||0)+count;});
  Object.entries(localSegFacets?.titles||{}).forEach(([value,count])=>{merged[value]=(merged[value]||0)+count;});
  const allTitles=Object.entries(merged).sort((a,b)=>b[1]-a[1]).map(([value,count])=>({value,count}));
  const noStates=(buildingSegment.states||[]).length===0;
  return(
  <div style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${B.border}`}}>
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
  <Lbl>3 · ROLES</Lbl>
  {segFacetsLoading&&allTitles.length===0&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>loading…</span>}
  {allTitles.length>0&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{allTitles.length} unique titles in your data</span>}
  {(buildingSegment.roles||[]).length>0&&<button onClick={()=>setBuildingSegment(s=>({...s,roles:[]}))} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"1px 7px",fontSize:8,color:B.muted,cursor:"pointer",fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3}}>CLEAR</button>}
  </div>
  {noStates&&(buildingSegment.sports||[]).length===0&&allTitles.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>Select a sport or state above to see available roles.</div>}
  {!segFacetsLoading&&allTitles.length===0&&((buildingSegment.sports||[]).length>0||(buildingSegment.states||[]).length>0)&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"10px 0"}}>No contacts found yet for this combination.</div>}
  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
  {allTitles.map(({value,count})=>{
    const sel=(buildingSegment.roles||[]).includes(value);
    return(<button key={value} onClick={()=>setBuildingSegment(s=>({...s,roles:tog(s.roles||[],value)}))} style={{background:sel?`${B.orange}15`:B.white,color:sel?B.orange:B.text,border:`1px solid ${sel?B.orange:B.border}`,borderRadius:4,padding:"5px 11px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",fontWeight:sel?600:400}}>
    {value}<span style={{fontSize:9,color:sel?B.orange:B.muted,marginLeft:5}}>({count})</span>
    </button>);
  })}
  </div>
  </div>
  );
})()}
{/* Footer */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:16,borderTop:`1px solid ${B.border}`}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:2}}>
{(buildingSegment.roles||[]).length>0?"sport + state + role match":"sport + state match"}
</div>
{(()=>{
  const combined=(buildingSegmentCount||0)+localSegFacets.count;
  const loading=buildingSegmentCountLoading;
  const ready=buildingSegmentCount!=null||localSegFacets.count>0;
  return <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:combined>0?B.green:B.muted}}>{loading&&localSegFacets.count===0?"…":ready?combined.toLocaleString():"—"}</div>;
})()}
</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
{!buildingSegmentIsNew&&<button onClick={()=>{setAreas(as=>as.filter(a=>a.id!==buildingSegment.id));setBuildingSegment(null);setBuildingSegmentIsNew(false);setBuildingSegmentCount(null);setSegFacets(null);toast("Segment deleted","info");}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:B.red,cursor:"pointer",letterSpacing:.3}}>DELETE</button>}
<OBtn onClick={()=>{const seg={...buildingSegment};if(buildingSegmentIsNew){setAreas(as=>[...as,seg]);}else{setAreas(as=>as.map(a=>a.id===seg.id?seg:a));}setBuildingSegment(null);setBuildingSegmentIsNew(false);setBuildingSegmentCount(null);setSegFacets(null);toast(`Segment "${seg.name}" saved`,"success");}}>SAVE SEGMENT</OBtn>
</div>
</div>
</div>
)}
{!buildingSegment&&!areaContactsAreaId&&<>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
<div style={{display:"flex",gap:5}}>
{[["segments",`✦ SEGMENTS (${areas.length})`],["lists",`☰ LISTS (${(s.contactLists||[]).length})`]].map(([id,l])=>(
<button key={id} onClick={()=>setSegView(id)} style={{background:segView===id?B.orange:B.white,color:segView===id?B.white:B.muted,border:`1px solid ${segView===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
))}
</div>
{segView==="segments"&&<OBtn sm onClick={()=>{setBuildingSegment({id:mkId(),name:"",states:[],sports:[],roles:[],maxSchools:10,active:true});setBuildingSegmentIsNew(true);setBuildingSegmentCount(null);}}>+ NEW SEGMENT</OBtn>}
</div>
{segView==="segments"&&(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:14}}>Define target audiences and browse matching contacts — what you've built</div>
)}
{segView==="segments"&&(
<div className="rv-segment-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
{areas.map(area=>(
<div key={area.id} className="card" style={{padding:14,borderTop:`3px solid ${B.orange}`}}>
<div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7,flexWrap:"wrap",gap:6}}>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.black,letterSpacing:.2}}>{area.name}</div>
{areaCounts[area.id]!=null&&(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:areaCounts[area.id]>0?B.green:B.muted,marginTop:2}}>
{areaCounts[area.id]>0?`${areaCounts[area.id].toLocaleString()} matching contacts`:"No matching contacts yet"}
</div>
)}
</div>
<div style={{display:"flex",gap:5}}>
<GBtn onClick={()=>{setBuildingSegment({...area});setBuildingSegmentIsNew(false);setBuildingSegmentCount(areaCounts[area.id]??null);}} style={{fontSize:9,padding:"3px 8px"}}>EDIT</GBtn>
<button onClick={()=>setAreas(as=>as.filter(a=>a.id!==area.id))} style={{background:"none",border:`1px solid ${B.border}`,color:B.red,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>✕</button>
</div>
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:7}}>
{(area.regions||[]).map(r=>{const rs=typeof r==="string"?r:r?.name||String(r);const c=US_REGIONS[rs]?.color||B.orange;return<span key={rs} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:c,background:c+"18",padding:"2px 7px",borderRadius:3}}>{rs}</span>;})}
{!(area.regions||[]).length&&(area.states||[]).map(st=>{const s2=typeof st==="string"?st:st?.name||String(st);return<span key={s2} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.orange,background:B.orangeBg,padding:"2px 6px",borderRadius:3}}>{s2}</span>;})}
{(area.sports||[]).map(sp=>{const s2=typeof sp==="string"?sp:sp?.name||String(sp);return<span key={s2} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>{s2}</span>;})}
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:10}}>
{area.orgType==="clubs"?"Youth Clubs":area.orgType==="both"?"Schools + Clubs":"Schools"} · {(area.roles||[]).map(r=>typeof r==="string"?r:r?.name||String(r)).join(", ")||"default roles"} · max {area.maxOrgs||area.maxSchools||10} orgs
</div>
<div style={{display:"flex",gap:6}}><OBtn onClick={()=>runScrape(area)} style={{flex:1}} sm>{(areaCounts[area.id]||0)>0?"↺ FIND MORE":"⊕ PROSPECT"}</OBtn>{(areaCounts[area.id]||0)>0&&<OBtn sm col={B.teal} onClick={()=>{setAreaContactsAreaId(area.id);setAreaContactsSel(new Set());setAreaContactsStateF('');setAreaContactsSportF('');loadAreaContacts(area,1,'','');}} style={{flex:1}}>BROWSE {(areaCounts[area.id]||0).toLocaleString()}</OBtn>}</div>
</div>
</div>
))}
</div>
)}
{segView==="lists"&&(
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:14}}>Contact lists uploaded or built from segments — what you've imported</div>
{(s.contactLists||[]).length===0?(
<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No lists yet — create one from a segment (browse contacts → select → create list) or import a CSV.</div>
):(
<div style={{display:"flex",flexDirection:"column",gap:12}}>
{(s.contactLists||[]).map(list=>(
<ContactListCard key={list.id} list={list} localContacts={s.contacts}
isOpen={expandedListId===list.id} onToggle={()=>setExpandedListId(expandedListId===list.id?null:list.id)}
isRenaming={renamingListId===list.id} renameValue={renameValue}
onRenameStart={()=>{setRenamingListId(list.id);setRenameValue(list.name);}}
onRenameChange={setRenameValue}
onRenameSave={()=>{dispatch("UPDATE_CONTACT_LIST",{id:list.id,name:renameValue.trim()||list.name});setRenamingListId(null);}}
onRenameCancel={()=>setRenamingListId(null)}
onDelete={()=>{if(window.confirm(`Delete list "${list.name}"?`))dispatch("DEL_CONTACT_LIST",list.id);}}
onUseInCampaign={()=>setView("campaigns")}
/>
))}
</div>
)}
</div>
)}
</>}
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
{importPhase!=="idle"&&<button onClick={()=>{setImportPhase("idle");setImportFile(null);setImportRows([]);setImportSel(new Set());setImportProgress(0);setImportStatus("");setImportState("");}} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:11}}>✕ cancel</button>}
</div>
{/* Idle: just the buttons */}
{importPhase==="idle"&&(
<>
<div style={{display:"flex",gap:10,alignItems:"center",paddingTop:10,flexWrap:"wrap"}}>
<input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleListUpload} style={{display:"none"}}/>
<input ref={apolloFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleApolloUpload} style={{display:"none"}}/>
<OBtn sm onClick={()=>importFileRef.current?.click()}>↑ UPLOAD CSV / EXCEL</OBtn>
<OBtn sm color={B.teal} onClick={()=>apolloFileRef.current?.click()}>↑ APOLLO.IO CSV</OBtn>
<OBtn sm color={B.muted} disabled={backfillRunning} onClick={async()=>{
setBackfillRunning(true);setBackfillResult(null);
try{
const r=await fetch('/api/contacts/backfill-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:false})});
const d=await r.json();
setBackfillResult(d);
if(d.updated>0){setDbTotal(t=>t);loadDbContacts(1,dbSearch);toast(`Fixed state data for ${d.updated.toLocaleString()} contacts`,"success");}
else toast("No contacts updated — state data already populated or no email patterns matched","info");
}catch(e){toast("Backfill error: "+e.message,"error");}
finally{setBackfillRunning(false);}
}}>{backfillRunning?"FIXING…":"⚙ FIX STATE DATA"}</OBtn>
{backfillResult&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{backfillResult.updated} fixed · {backfillResult.skipped} no match</span>}
<OBtn sm color={B.purple} disabled={linkingAccounts} onClick={async()=>{
setLinkingAccounts(true);setLinkAccountsResult(null);
try{
const r=await fetch('/api/contacts/backfill-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:false})});
const d=await r.json();
setLinkAccountsResult(d);
toast(`${d.accountsCreated} account(s) linked to ${d.contactsLinked} contact(s)`,"success");
}catch(e){toast("Account link error: "+e.message,"error");}
finally{setLinkingAccounts(false);}
}}>{linkingAccounts?"LINKING…":"⚙ LINK ACCOUNTS"}</OBtn>
{linkAccountsResult&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{linkAccountsResult.accountsCreated} accounts · {linkAccountsResult.contactsLinked} contacts linked</span>}
<OBtn sm color={B.teal} disabled={aligningZoho} onClick={async()=>{
try{
const preview=await fetch('/api/contacts/zoho-align-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:true})}).then(r=>r.json());
if(preview.error){toast("Zoho align error: "+preview.error,"error");return;}
if(!preview.accountsQualifying){toast("No qualifying accounts (invoiced or positive-intent) with contacts to push right now","info");return;}
if(!window.confirm(`This will push contacts for ${preview.accountsQualifying} qualifying account(s) into Zoho CRM as linked Contacts (tagged Sport + Coach Role), and may create custom fields in your Zoho Contacts module if they don't exist. Cold/unqualified accounts are untouched. Continue?`))return;
}catch(e){toast("Zoho align preview error: "+e.message,"error");return;}
setAligningZoho(true);setAlignZohoResult(null);
const totals={fieldsEnsured:[],accountsProcessed:0,contactsPushed:0,contactsUpdated:0,contactsSkipped:0,errors:[]};
try{
let remaining=1,guard=0;
while(remaining>0&&guard<200){
guard++;
const r=await fetch('/api/contacts/zoho-align-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:false,limit:25})});
const d=await r.json();
if(d.error) throw new Error(d.error);
if(d.fieldsEnsured?.length) totals.fieldsEnsured=d.fieldsEnsured;
totals.accountsProcessed+=d.accountsProcessed||0;
totals.contactsPushed+=d.contactsPushed||0;
totals.contactsUpdated+=d.contactsUpdated||0;
totals.contactsSkipped+=d.contactsSkipped||0;
totals.errors=[...totals.errors,...(d.errors||[])];
remaining=d.accountsRemaining||0;
setAlignZohoResult({...totals,accountsRemaining:remaining});
if(!d.accountsProcessed&&remaining>0) break;
}
toast(`Zoho align: ${totals.accountsProcessed} account(s) · ${totals.contactsPushed} contact(s) created · ${totals.contactsUpdated} updated${totals.errors.length?` · ${totals.errors.length} error(s) — see panel`:""}`,totals.errors.length?"info":"success");
}catch(e){toast("Zoho align error: "+e.message,"error");}
finally{setAligningZoho(false);}
}}>{aligningZoho?"ALIGNING…":"⚡ ALIGN TO ZOHO"}</OBtn>
{alignZohoResult&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{alignZohoResult.accountsProcessed} accts · {alignZohoResult.contactsPushed} new · {alignZohoResult.contactsUpdated} updated{alignZohoResult.errors.length?` · ${alignZohoResult.errors.length} errors`:""}</span>}
<OBtn sm color={B.blue} disabled={syncingBooks} onClick={async()=>{
setSyncingBooks(true);setSyncBooksResult(null);
try{
const r=await fetch('/api/contacts/sync-books-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:false})});
const d=await r.json();
if(d.error){toast("Books sync error: "+d.error,"error");return;}
setSyncBooksResult(d);
const noContactNote=d.accountsWithNoContacts?.length?` · ${d.accountsWithNoContacts.length} account(s) have NO contacts on file (see panel)`:"";
toast(`${d.accountsFromBooks} Books customer(s) → ${d.accountsCreated} account(s) created, ${d.accountsUpdated} matched · ${d.contactsLinked} contact(s) linked${noContactNote}`,d.accountsWithNoContacts?.length?"info":"success");
}catch(e){toast("Books sync error: "+e.message,"error");}
finally{setSyncingBooks(false);}
}}>{syncingBooks?"SYNCING…":"📇 SYNC BOOKS ACCOUNTS"}</OBtn>
{syncBooksResult&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{syncBooksResult.accountsCreated} new · {syncBooksResult.accountsUpdated} matched · {syncBooksResult.contactsLinked} contacts linked{syncBooksResult.accountsWithNoContacts?.length?` · ${syncBooksResult.accountsWithNoContacts.length} with no contacts`:""}</span>}
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{totalContactsAll.toLocaleString()} contacts total <span style={{fontSize:9}}>({dbTotal.toLocaleString()} CRM · {(s.contacts||[]).length.toLocaleString()} uploaded)</span></span>
</div>
{syncBooksResult?.accountsWithNoContacts?.length>0&&(
<div style={{marginTop:8}}>
<button onClick={()=>setShowNoContactAccounts(v=>!v)} style={{background:"none",border:"none",padding:0,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted"}}>{showNoContactAccounts?"hide":"show"} the {syncBooksResult.accountsWithNoContacts.length} invoiced account(s) with zero contacts on file</button>
{showNoContactAccounts&&(
<div style={{marginTop:6,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"8px 10px",maxHeight:180,overflowY:"auto"}}>
{syncBooksResult.accountsWithNoContacts.map((a,i)=>(
<div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,padding:"2px 0"}}>{a.name}{a.state?` — ${a.state}`:""}</div>
))}
</div>
)}
</div>
)}
</>
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
<div className="rv-2col-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>LIST NAME <span style={{color:B.orange}}>*</span></div>
<input value={importListName} onChange={e=>{setImportListName(e.target.value);detectImportMeta(e.target.value);}}
placeholder="e.g. Iowa Track Coaches 2025"
style={{width:"100%",background:B.surface,border:`1px solid ${importListName.trim()?B.green:B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
disabled={importPhase==="parsing"}/>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>PRIMARY SPORT (optional)</div>
<select value={importSport} onChange={e=>setImportSport(e.target.value)}
style={{width:"100%",background:B.surface,border:`1px solid ${importSport?B.green:B.border}`,color:importSport?B.text:B.muted,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
disabled={importPhase==="parsing"}>
<option value="">— any / mixed sports —</option>
{SPORTS_LIST.map(sp=><option key={sp} value={sp}>{sp}</option>)}
</select>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>STATE / REGION (optional)</div>
<select value={importState} onChange={e=>setImportState(e.target.value)}
style={{width:"100%",background:B.surface,border:`1px solid ${importState?B.green:B.border}`,color:importState?B.text:B.muted,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}
disabled={importPhase==="parsing"}>
<option value="">— all states / unknown —</option>
{US_STATES.map(st=>{const full=Object.entries(STATE_FULL_TO_ABBR).find(([,a])=>a===st)?.[0]||'';return(<option key={st} value={st}>{st}{full?` – ${full.replace(/\b\w/g,c=>c.toUpperCase())}`:''}</option>);})}
</select>
{importState&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.green,marginTop:3}}>✓ auto-detected from list name — all contacts without a state will be tagged as {importState}</div>}
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
<OBtn sm onClick={commitListImport} disabled={importSel.size===0}>⊕ UPLOAD TO DB ({importSel.size})</OBtn>
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
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>CONTACT DATABASE ({totalContactsAll.toLocaleString()})</div>
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
if(!contactMap[cid]?.email) return;
if(!updated.enrollments.some(e=>e.contactId===cid)){
updated.enrollments.push({contactId:cid,step:0,status:"active",enrolledAt:today,nextDate:today,sentSteps:[]});
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
const hot=hotLeads;
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
if(!c.email) return;
if(!updated.enrollments.some(e=>e.contactId===c.id)){
updated.enrollments.push({contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr,sentSteps:[]});
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
<div style={{display:"flex",gap:4,marginTop:5}}>
<button onClick={()=>{dispatch("SET_CRM_NAV",{id:c.id});setMod("crm");}} style={{flex:1,background:B.surface,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:3,padding:"3px 7px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",textAlign:"center"}}>→ CRM</button>
<button onClick={()=>{
const school=typeof c.school==="string"?c.school:c.school?.name||"";
const title=typeof c.title==="string"?c.title:c.title?.name||"";
const sport=typeof c.sport==="string"?c.sport:c.sport?.name||"";
const draft=`Draft an outreach email for ${c.fullName||c.firstName}, ${title}${school?` at ${school}`:""}${c.state?`, ${c.state}`:""}${sport?`. Sport: ${sport}`:""}${c.outreachWindow?`. Best outreach window: ${c.outreachWindow}`:""}. Personalize it to build a relationship and introduce ST1 Sports.`;
dispatch("SET_AGENT_DRAFT",draft);
setMod("briefing");
}} style={{flex:1,background:B.surface,color:B.blue,border:`1px solid ${B.border}`,borderRadius:3,padding:"3px 7px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,fontWeight:700,letterSpacing:.3,cursor:"pointer",textAlign:"center"}}>→ HOME</button>
</div>
<div style={{marginTop:5,position:"relative"}}>
{flaggingContact===c.id?(
<div style={{position:"absolute",right:0,top:"100%",zIndex:20,background:B.white,border:`1px solid ${B.border}`,borderRadius:5,boxShadow:"0 4px 12px rgba(0,0,0,.12)",minWidth:160,padding:6}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 6px"}}>FLAG AS</div>
{[["not_interested","Not Interested"],["wrong_contact","Wrong Contact"],["junk","Junk / Spam"]].map(([val,label])=>(
<button key={val} onClick={()=>{
dispatch("UPDATE_CONTACT",{id:c.id,deadStatus:val});
crmUpdate("Leads",c.zohoId,{Lead_Status:"Dead"});
setFlaggingContact(null);
toast(`${c.fullName||c.firstName||c.lastName} flagged as ${label}`,"info");
}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red,cursor:"pointer",borderRadius:3}}>{label}</button>
))}
{c.deadStatus&&(
<button onClick={()=>{
dispatch("UPDATE_CONTACT",{id:c.id,deadStatus:null});
crmUpdate("Leads",c.zohoId,{Lead_Status:"Contacted"});
setFlaggingContact(null);
toast(`${c.fullName||c.firstName||c.lastName} restored`,"success");
}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,cursor:"pointer",borderRadius:3}}>↩ Restore</button>
)}
<div style={{borderTop:`1px solid ${B.border}`,margin:"4px 0"}}/>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,padding:"3px 6px 3px"}}>EMAIL</div>
{!c.emailBounced?(
<button onClick={()=>{
dispatch("UPDATE_CONTACT",{id:c.id,emailBounced:true});
crmUpdate("Leads",c.zohoId,{Email_Opt_Out:true});
setFlaggingContact(null);
toast(`Email marked as bounced for ${c.fullName||c.firstName||c.lastName}`,"warn");
}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.yellow,cursor:"pointer",borderRadius:3}}>✉✗ Bad Email / Bounced</button>
):(
<button onClick={()=>{
dispatch("UPDATE_CONTACT",{id:c.id,emailBounced:false});
crmUpdate("Leads",c.zohoId,{Email_Opt_Out:false});
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
if(!c.email){ toast("Can't enroll — contact has no email address","warn"); setEnrollingContact(null); return; }
const alreadyIn=(seq.enrollments||[]).some(e=>e.contactId===c.id);
if(!alreadyIn){
dispatch("UPDATE_SEQUENCE",{...seq,enrollments:[...seq.enrollments,{contactId:c.id,step:0,status:"active",enrolledAt:today,nextDate:today,sentSteps:[]}]});
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
<button onClick={()=>{if(!noteText.trim())return;const _nt=noteText.trim();dispatch("UPDATE_CONTACT",{id:c.id,notes:[...(c.notes||[]),{id:mkId(),text:_nt,ts:Date.now(),author:"Matt"}]});crmAddNote("Leads",c.zohoId,_nt);setNoteText("");toast("Note added","success");}} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",alignSelf:"flex-end",flexShrink:0}}>ADD NOTE</button>
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
{view==="results"&&(
<div className="rv-results-split" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
<div>
{phase!=="idle"&&<div style={{height:4,background:B.border,borderRadius:2,marginBottom:12}}><div style={{height:"100%",width:`${progress}%`,background:B.orange,borderRadius:2,transition:"width .4s"}}/></div>}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:phase==="done"?B.green:B.orange,letterSpacing:1.5}}>{phase==="finding"?"FINDING SCHOOLS...":phase==="scraping"?"SCRAPING CONTACTS...":phase==="done"?"COMPLETE":"READY"}</div>
<div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
{(phase==="finding"||phase==="scraping")&&<GBtn onClick={()=>abortRef.current=true} style={{fontSize:10,padding:"4px 8px",color:B.red}}>⏹ STOP</GBtn>}
{contacts.length>0&&<OBtn sm onClick={exportCsv}>↓ EXPORT CSV</OBtn>}
{/* No bulk "push to Zoho" here on purpose — scraped contacts stay local until
    Brad/Edgar surface real intent (a reply or an interested status), per the
    no-CRM-without-intent rule. */}
</div>
</div>
{contacts.length>0&&<div className="rv-3col-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
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
<div className="card rv-sticky-log" style={{padding:13,alignSelf:"start",position:"sticky",top:0}}>
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
{view==="brad"&&(
<div style={{maxWidth:900}}>
{/* Brad sub-tab bar */}
<div style={{display:"flex",gap:5,marginBottom:18,borderBottom:`1px solid ${B.border}`,paddingBottom:12,flexWrap:"wrap"}}>
{[["prospect","✉ PROSPECT"],["campaigns",`CAMPAIGNS (${(s.campaigns||[]).length})`],["lists",`MY LISTS (${(s.contactLists||[]).length})`]].map(([t,l])=>(
<button key={t} onClick={()=>setBradTab(t)} style={{background:bradTab===t?B.orange:B.white,color:bradTab===t?B.white:B.muted,border:`1px solid ${bradTab===t?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
))}
</div>
{bradTab==="prospect"&&<div>
{/* Positive reply queue */}
{bradReplies.length>0&&(
<div style={{background:B.white,border:`2px solid ${B.green}`,borderRadius:8,padding:14,marginBottom:20}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green,letterSpacing:1}}>🔥 POSITIVE REPLIES — NEEDS FOLLOW-UP</div>
<button onClick={loadBradReplies} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif"}}>↺ refresh</button>
</div>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{bradReplies.map(rep=>{
const inp=rep.input||{};const out=rep.output||{};
return(
<div key={rep.id} style={{background:B.surface,borderRadius:6,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,borderLeft:`3px solid ${B.green}`,flexWrap:"wrap"}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{inp.contactName||inp.fromEmail}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.white,background:B.green,borderRadius:3,padding:"2px 6px"}}>INTERESTED</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>→ assigned to <strong>{out.assignedName||out.assignedTo}</strong></span>
</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.3,marginBottom:3}}>{inp.subject}</div>
{inp.snippet&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,lineHeight:1.5,fontStyle:"italic"}}>"{inp.snippet.slice(0,160)}{inp.snippet.length>160?"…":""}"</div>}
</div>
<div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap"}}>
<button onClick={()=>{setOneOffName(inp.contactName||"");setOneOffEmail(inp.fromEmail||"");setOneOffMode("self");setTimeout(()=>document.getElementById("oneoff-subject")?.focus(),100);}}
style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",padding:"3px 8px",borderRadius:3,cursor:"pointer"}}>✉ REPLY</button>
<button onClick={()=>markReplyHandled(rep.id)}
style={{background:B.green,color:B.white,border:"none",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,padding:"3px 10px",borderRadius:3,cursor:"pointer",letterSpacing:.3}}>✓ HANDLED</button>
</div>
</div>
);
})}
</div>
</div>
)}
{/* Segments quick-pick */}
{areas.length>0&&(
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"12px 14px",marginBottom:16,borderLeft:`3px solid ${B.orange}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:10}}>SEGMENTS — QUICK OUTREACH</div>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{areas.map(area=>(
<div key={area.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
<div style={{flex:1,minWidth:0}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{area.name}</span>
{areaCounts[area.id]!=null&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:areaCounts[area.id]>0?B.green:B.muted,marginLeft:8}}>{areaCounts[area.id]>0?`${areaCounts[area.id].toLocaleString()} contacts`:""}</span>}
<div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap"}}>
{(area.regions||[]).map(r=>{const c=US_REGIONS[r]?.color||B.orange;return<span key={r} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:c,background:c+"18",padding:"1px 5px",borderRadius:2}}>{r}</span>;})}
{(area.sports||[]).map(sp=>{const s2=typeof sp==="string"?sp:sp?.name||"";return s2?<span key={s2} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"1px 5px",borderRadius:2}}>{s2}</span>:null;})}
</div>
</div>
<div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap"}}>
{(areaCounts[area.id]||0)>0&&<GBtn onClick={()=>{setView("areas");setAreaContactsAreaId(area.id);setAreaContactsSel(new Set());setAreaContactsStateF('');setAreaContactsSportF('');loadAreaContacts(area,1,'','');}} style={{fontSize:9,padding:"4px 10px"}}>BROWSE</GBtn>}
{(areaCounts[area.id]||0)>0&&<OBtn sm col={B.teal} onClick={async()=>{
setAreaContactsAllLoading(true);
try{const r=await fetch("/api/contacts/area-browse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sports:area.sports||[],states:area.states||[],roles:area.roles||[],page:1,limit:5000})});const d=await r.json();const ids=(d.contacts||[]).map(c=>c.id);if(ids.length>0){const nm=`${area.name} – ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;const nl={id:mkId(),name:nm,contactIds:[...new Set(ids)],createdAt:Date.now(),source:"segment"};dispatch("ADD_CONTACT_LIST",nl);toast(`List "${nm}" created with ${ids.length} contacts`,"success");}else{toast("No contacts matched","info");}}catch(e){toast("Error: "+e.message,"error");}finally{setAreaContactsAllLoading(false);}
}}>CREATE LIST</OBtn>}
<GBtn onClick={()=>{setView("areas");setBuildingSegment({...area});setBuildingSegmentIsNew(false);setBuildingSegmentCount(areaCounts[area.id]??null);}} style={{fontSize:9,padding:"4px 10px"}}>EDIT</GBtn>
</div>
</div>
))}
</div>
<div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${B.border}`}}>
<OBtn sm onClick={()=>{setView("areas");setBuildingSegment({id:mkId(),name:"",states:[],sports:[],roles:[],maxSchools:10,active:true});setBuildingSegmentIsNew(true);setBuildingSegmentCount(null);}}>+ NEW SEGMENT</OBtn>
</div>
</div>
)}
{/* Status row */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>
{bradLoading?"Analyzing your contacts and pipeline…"
:bradResult?`${bradResult.drafts?.length||0} recommendation${(bradResult.drafts?.length||0)!==1?"s":""} · ${bradResult.skipped?.length||0} skipped`
:"Brad reads your CRM and recommends who to contact today."}
</div>
<div style={{display:"flex",gap:6}}>
<GBtn onClick={async()=>{setBradRepliesLoading(true);try{await fetch('/api/cron/brad-inbox',{method:'POST'});await loadBradReplies();}catch(e){toast("Inbox check failed: "+e.message,"error");}setBradRepliesLoading(false);}} style={{fontSize:9,padding:"4px 10px",opacity:bradRepliesLoading?.6:1,pointerEvents:bradRepliesLoading?"none":"auto"}}>{bradRepliesLoading?"CHECKING…":"📬 CHECK INBOX"}</GBtn>
<OBtn sm onClick={()=>runBrad(bradTask||undefined)} disabled={bradLoading}>{bradLoading?"THINKING…":"↺ REFRESH"}</OBtn>
</div>
</div>
{/* Loading */}
{bradLoading&&(
<div style={{textAlign:"center",padding:"60px 0",background:B.surface,borderRadius:8,border:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.textMid,marginBottom:8}}>Brad is reading your CRM…</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1.5}}>ANALYZING · CHECKING PIPELINE · DRAFTING</div>
</div>
)}
{/* Draft cards */}
{!bradLoading&&bradResult&&(
<div style={{display:"flex",flexDirection:"column",gap:12}}>
{(bradResult.drafts||[]).map((draft,i)=>{
const key=`brad_${i}`;const sending=bradSending===key;
const score=(s.contacts||[]).find(c=>c.email===draft.contactEmail)?.score||null;
return(
<div key={i} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,overflow:"hidden"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"12px 16px",background:B.surface,borderBottom:`1px solid ${B.border}`,flexWrap:"wrap",gap:8}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:13,fontWeight:600,color:B.text}}>{draft.contactName}</span>
{score>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,background:B.orangeBg,borderRadius:3,padding:"2px 6px",letterSpacing:.3}}>{score}pts</span>}
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{[draft.contactSchool,draft.contactEmail].filter(Boolean).join(" · ")}</div>
{draft.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.textMid,marginTop:6,fontStyle:"italic",lineHeight:1.55}}>💡 {draft.notes}</div>}
</div>
<div style={{display:"flex",gap:6,marginLeft:14,flexShrink:0,flexWrap:"wrap"}}>
<GBtn onClick={()=>navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).then(()=>toast("Copied","info"))} style={{fontSize:9,padding:"4px 9px"}}>📋 COPY</GBtn>
{draft.contactEmail&&<button onClick={()=>sendDraftEmail(draft,key)} disabled={sending} style={{background:sending?B.muted:B.green,border:"none",color:B.white,borderRadius:4,padding:"4px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:sending?"default":"pointer",opacity:sending?.7:1}}>{sending?"SENDING…":"✉ SEND"}</button>}
</div>
</div>
<div style={{padding:"14px 16px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>SUBJECT</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text,marginBottom:12}}>{draft.subject}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{draft.body}</div>
</div>
</div>
);
})}
{(!bradResult.drafts||bradResult.drafts.length===0)&&(
<div style={{textAlign:"center",padding:"48px 0",background:B.surface,borderRadius:8,border:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No contacts cleared guardrails today.</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:4}}>Everyone may be within the 14-day re-touch window, or the daily cap has been hit.</div>
</div>
)}
</div>
)}
{/* Empty / first-load */}
{!bradLoading&&!bradResult&&(
<div style={{textAlign:"center",padding:"60px 0"}}>
<OBtn onClick={()=>runBrad()}>✉ GET RECOMMENDATIONS</OBtn>
</div>
)}
{/* Custom task input */}
<div style={{marginTop:16,display:"flex",gap:8,alignItems:"center"}}>
<input value={bradTask} onChange={e=>setBradTask(e.target.value)} placeholder="Give Brad specific instructions — or leave blank for today's recommendations…" style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn sm onClick={()=>runBrad(bradTask||undefined)} disabled={bradLoading}>RUN</OBtn>
</div>
{/* One-off compose */}
<div style={{marginTop:24,borderTop:`1px solid ${B.border}`,paddingTop:20}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>SEND TO ANYONE</div>
<div style={{display:"flex",gap:4}}>
{[["ai","AI DRAFT"],["self","WRITE IT"]].map(([m,l])=>(
<button key={m} onClick={()=>{setOneOffMode(m);setOneOffDraft(null);}} style={{background:oneOffMode===m?B.orange:B.surface,color:oneOffMode===m?B.white:B.muted,border:`1px solid ${oneOffMode===m?B.orange:B.border}`,borderRadius:4,padding:"3px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>{l}</button>
))}
</div>
</div>
{/* Shared: name + email row */}
<div className="rv-2col-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
<input value={oneOffName} onChange={e=>setOneOffName(e.target.value)} placeholder="Name" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<input value={oneOffEmail} onChange={e=>setOneOffEmail(e.target.value)} placeholder="Email *" type="email" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
{/* AI mode */}
{oneOffMode==="ai"&&(
<div>
<div style={{display:"flex",gap:8,marginBottom:oneOffDraft?12:0}}>
<input value={oneOffContext} onChange={e=>setOneOffContext(e.target.value)} placeholder="School / sport / context (optional)" style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn sm onClick={runOneOff} disabled={oneOffLoading||!oneOffEmail.trim()}>{oneOffLoading?"DRAFTING…":"DRAFT →"}</OBtn>
</div>
{oneOffDraft&&(
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:6,overflow:"hidden"}}>
<div style={{padding:"10px 14px",background:B.surface,borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{oneOffDraft.contactName}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{oneOffDraft.contactEmail}</div>
</div>
<div style={{display:"flex",gap:6}}>
<GBtn onClick={()=>{setOneOffMode("self");setOneOffSubject(oneOffDraft.subject||"");setOneOffBody(oneOffDraft.body||"");setOneOffDraft(null);}} style={{fontSize:9,padding:"4px 9px"}}>✏ EDIT</GBtn>
<GBtn onClick={()=>navigator.clipboard?.writeText(`Subject: ${oneOffDraft.subject}\n\n${oneOffDraft.body}`).then(()=>toast("Copied","info"))} style={{fontSize:9,padding:"4px 9px"}}>📋 COPY</GBtn>
<button onClick={sendOneOff} disabled={oneOffSending} style={{background:oneOffSending?B.muted:B.green,border:"none",color:B.white,borderRadius:4,padding:"4px 14px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:oneOffSending?"default":"pointer",opacity:oneOffSending?.7:1}}>{oneOffSending?"SENDING…":"✉ SEND"}</button>
<GBtn onClick={()=>setOneOffDraft(null)} style={{fontSize:9,padding:"4px 9px"}}>DISCARD</GBtn>
</div>
</div>
<div style={{padding:"12px 14px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4}}>SUBJECT</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text,marginBottom:10}}>{oneOffDraft.subject}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{oneOffDraft.body}</div>
</div>
</div>
)}
</div>
)}
{/* Self-compose mode */}
{oneOffMode==="self"&&(
<div style={{display:"flex",flexDirection:"column",gap:8}}>
<input id="oneoff-subject" value={oneOffSubject} onChange={e=>setOneOffSubject(e.target.value)} placeholder="Subject *" style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<textarea value={oneOffBody} onChange={e=>setOneOffBody(e.target.value)} placeholder="Write your email body here…" rows={8} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"10px",fontSize:11,fontFamily:"'Lexend',sans-serif",lineHeight:1.7,resize:"vertical"}}/>
<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
<GBtn onClick={()=>navigator.clipboard?.writeText(`Subject: ${oneOffSubject}\n\n${oneOffBody}`).then(()=>toast("Copied","info"))} style={{fontSize:9,padding:"4px 9px"}}>📋 COPY</GBtn>
<button onClick={sendManualEmail} disabled={oneOffSending||!oneOffEmail.trim()||!oneOffSubject.trim()||!oneOffBody.trim()} style={{background:oneOffSending||!oneOffEmail.trim()||!oneOffSubject.trim()||!oneOffBody.trim()?B.border:B.green,color:oneOffSending||!oneOffEmail.trim()||!oneOffSubject.trim()||!oneOffBody.trim()?B.muted:B.white,border:"none",borderRadius:4,padding:"6px 18px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.3,cursor:"pointer"}}>{oneOffSending?"SENDING…":"✉ SEND AS BRAD"}</button>
</div>
</div>
)}
</div>
</div>
}
{/* CAMPAIGNS TAB */}
{bradTab==="campaigns"&&(
<div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>{(s.campaigns||[]).length} CAMPAIGN{(s.campaigns||[]).length!==1?"S":""}</div>
<div style={{display:"flex",gap:6}}>
<GBtn onClick={()=>setView("campaigns")} style={{fontSize:9,padding:"4px 10px"}}>FULL EDITOR ↗</GBtn>
<OBtn sm onClick={()=>setView("campaigns")}>+ NEW CAMPAIGN</OBtn>
</div>
</div>
{(s.campaigns||[]).length===0?(
<div style={{textAlign:"center",padding:"60px 0",background:B.surface,borderRadius:8,border:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:12}}>No campaigns yet — create one from a contact list.</div>
<OBtn onClick={()=>setView("campaigns")}>+ CREATE FIRST CAMPAIGN →</OBtn>
</div>
):(
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:20}}>
{(s.campaigns||[]).map(camp=>{
const enrs=camp.enrollments||[];
const active=enrs.filter(e=>e.status==="active").length;
const replied=enrs.filter(e=>e.status==="replied").length;
const sc={draft:B.muted,active:B.green,paused:B.yellow,completed:B.blue}[camp.status]||B.muted;
return(
<div key={camp.id} className="card" style={{padding:0,overflow:"hidden",borderTop:`3px solid ${camp.color||B.orange}`}}>
<div style={{padding:"14px 16px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600,flex:1,paddingRight:8}}>{camp.name}</div>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sc,background:`${sc}18`,padding:"2px 7px",borderRadius:3,letterSpacing:.5,flexShrink:0}}>{(camp.status||"draft").toUpperCase()}</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>{camp.product}{camp.audience?` · ${camp.audience}`:""}</div>
<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"2px 6px",borderRadius:3}}>✉ {(camp.touches||[]).length} touches</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}14`,padding:"2px 6px",borderRadius:3}}>{active} enrolled</span>
{replied>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 6px",borderRadius:3}}>{replied} replied</span>}
</div>
</div>
<div style={{borderTop:`1px solid ${B.border}`,padding:"8px 16px",background:B.surface,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete "${camp.name}"?`))dispatch("DELETE_CAMPAIGN",camp.id);}} style={{background:"none",border:"none",color:B.muted,fontSize:10,cursor:"pointer",fontFamily:"'Lexend',sans-serif",padding:0}}>✕ DELETE</button>
<button onClick={()=>setView("campaigns")} style={{background:"none",border:"none",color:B.orange,fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",padding:0,letterSpacing:.5}}>OPEN IN EDITOR →</button>
</div>
</div>
);
})}
</div>
)}
{(s.contactLists||[]).length>0&&(
<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:16,marginTop:16,borderLeft:`3px solid ${B.teal}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.teal,letterSpacing:2,marginBottom:10}}>LAUNCH FROM A LIST</div>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{(s.contactLists||[]).map(list=>(
<div key={list.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:600,color:B.text}}>{list.name}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{(list.contactIds||[]).length} contacts</div>
</div>
<OBtn sm col={B.teal} onClick={()=>setView("campaigns")}>START CAMPAIGN →</OBtn>
</div>
))}
</div>
</div>
)}
</div>
)}
{/* MY LISTS TAB */}
{bradTab==="lists"&&(
<div>
{(s.contactLists||[]).length===0?(
<div style={{textAlign:"center",padding:"60px 0",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No lists yet — create one from a Segment or browse contacts.</div>
):(
<div style={{display:"flex",flexDirection:"column",gap:12}}>
{(s.contactLists||[]).map(list=>(
<ContactListCard key={list.id} list={list} localContacts={s.contacts}
isOpen={expandedListId===list.id} onToggle={()=>setExpandedListId(expandedListId===list.id?null:list.id)}
isRenaming={renamingListId===list.id} renameValue={renameValue}
onRenameStart={()=>{setRenamingListId(list.id);setRenameValue(list.name);}}
onRenameChange={setRenameValue}
onRenameSave={()=>{dispatch("UPDATE_CONTACT_LIST",{id:list.id,name:renameValue.trim()||list.name});setRenamingListId(null);}}
onRenameCancel={()=>setRenamingListId(null)}
onDelete={()=>{if(window.confirm(`Delete list "${list.name}"?`))dispatch("DEL_CONTACT_LIST",list.id);}}
onUseInCampaign={()=>setView("campaigns")}
/>
))}
</div>
)}
</div>
)}
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
bulkSel.forEach(cid=>{if(!contactMap[cid]?.email) return; if(!updated.enrollments.some(e=>e.contactId===cid)){updated.enrollments.push({contactId:cid,step:0,status:"active",enrolledAt:today,nextDate:today,sentSteps:[]});dispatch("SCORE_CONTACT",{contactId:cid,type:"enrolled",campaignId:seq.id,note:`Enrolled in ${seq.name}`});enrolled++;}});
dispatch("UPDATE_SEQUENCE",updated);setBulkEnrolling(false);setBulkSel(new Set());toast(`${enrolled} contacts enrolled in ${seq.name}`,"success");
}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,cursor:"pointer",borderRadius:3}}>{seq.name}</button>
))}
{(s.sequences||[]).length===0&&<div style={{padding:"6px 8px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No campaigns yet</div>}
<button onClick={()=>setBulkEnrolling(false)} style={{display:"block",width:"100%",textAlign:"center",background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"4px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer",marginTop:4}}>Cancel</button>
</div>
)}
</div>
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
{view==="campaigns"&&<ModMarketing/>}
</div>
);
}
const DEFAULT_TEMPLATES=[
{id:"tpl_intro",name:"Cold Intro — Track & Field",tags:["cold","t&f"],subject:"ST1 Sports — Equipment for {{school}} T&F Program",body:`Hi {{name}},
Reaching out from ST1 Sports — we specialize in competition-grade track & field equipment (hurdles, starting blocks, shot puts, throws equipment) sold directly to programs like yours.
We work with schools across the country and hear the same thing: overpriced, slow-shipping distributors. We ship fast, price fairly, and every order gets personal attention.
Would it be worth a quick 10-minute call to see if we can help {{school}} this season?
ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`},
{id:"tpl_fu1",name:"Follow-Up 1 — After Quote",tags:["followup","quote"],subject:"Re: ST1 Sports Quote — {{school}}",body:`Hi {{name}},
Just following up on the quote I sent over. Did you get a chance to review it?
Happy to adjust quantities, add items, or answer any questions. We can also split the order across two POs if that's easier for your budget cycle.
ST1 Sports | matt@st1sports.com | 719-256-0275`},
{id:"tpl_fu2",name:"Follow-Up 2 — Final Check-in",tags:["followup"],subject:"Quick check-in — {{school}} equipment",body:`Hi {{name}},
I don't want to be a pest, so this will be my last follow-up for now. If the timing isn't right or you've gone a different direction, no worries at all — just let me know so I can close this out on my end.
If you're still interested, we can hold current pricing for one more week.
ST1 Sports | 719-256-0275`},
{id:"tpl_po",name:"PO Confirmation",tags:["order","confirmation"],subject:"ST1 Sports — Order Confirmation for {{school}}",body:`Hi {{name}},
Thank you for your order! Here's a summary:
{{items}}
Estimated ship date: {{ship_date}}
Tracking will be emailed once shipped.
Questions? Reply here or call us directly at 719-256-0275.
ST1 Sports | matt@st1sports.com | st1sports.com`},
{id:"tpl_winback",name:"Win-Back — Lapsed Customer",tags:["winback","cold"],subject:"It's been a while — new equipment for {{school}}?",body:`Hi {{name}},
ST1 Sports here — it's been a while since we last worked together, and we wanted to check in.
We've added some new items this season, and we'd love to put together a quote for {{school}} if you're gearing up for a new season. No pressure — just want to make sure you know we're here when you need us.
ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com`},
];
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
const {s,dispatch,toast,setMod}=useApp();
const [tab,setTab]=useState("campaigns");
const [selCampId,setSelCampId]=useState(null);
const [showNewCampForm,setShowNewCampForm]=useState(false);
const [showTemplateSelect,setShowTemplateSelect]=useState(false);
const [campDraft,setCampDraft]=useState(null);
const [campListUploading,setCampListUploading]=useState(false);
const [campSubTab,setCampSubTab]=useState("strategy");
const [campStep,setCampStep]=useState(1);
const [genRunning,setGenRunning]=useState(false);
const [genSocialRunning,setGenSocialRunning]=useState(false);
const [genAdRunning,setGenAdRunning]=useState(false);
const [genCallRunning,setGenCallRunning]=useState(false);
const [genMailRunning,setGenMailRunning]=useState(false);
const [editingTouchIdx,setEditingTouchIdx]=useState(null);
const [touchDraft,setTouchDraft]=useState({subject:"",body:""});
const touchSaveTimer=useRef(null);
const campDraftSaveTimer=useRef(null);
const editingTouchIdxRef=useRef(editingTouchIdx);
const selCampIdRef=useRef(null);
const campaignsRef=useRef([]);
useEffect(()=>{editingTouchIdxRef.current=editingTouchIdx;},[editingTouchIdx]);
useEffect(()=>{
if(!campDraft?.id) return;
clearTimeout(campDraftSaveTimer.current);
campDraftSaveTimer.current=setTimeout(()=>{ dispatch("UPDATE_CAMPAIGN",campDraft); },700);
return ()=>clearTimeout(campDraftSaveTimer.current);
},[campDraft]);
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
},[touchDraft]);
useEffect(()=>{
const camp=(s.campaigns||[]).find(c=>c.id===selCampId);
if(!camp){setBatchSchedules({});setBatchSentMap({});setTouchSchedStarts({});return;}
if(camp.scheduledBatches){
const uiBatches={};
Object.entries(camp.scheduledBatches).forEach(([bk,info])=>{uiBatches[bk]=info.scheduledAt;});
setBatchSchedules(uiBatches);
} else {
setBatchSchedules({});
}
if(camp.sentBatches) setBatchSentMap(camp.sentBatches);
setTouchSchedStarts({});
},[selCampId]);
const [filterSport,setFilterSport]=useState("all");
const [executeFilter,setExecuteFilter]=useState("all");
const [campContactSearch,setCampContactSearch]=useState("");
const [enrollSel,setEnrollSel]=useState(new Set());
const [sending,setSending]=useState(false);
const [checkingReplies,setCheckingReplies]=useState(false);
const [checkingOpens,setCheckingOpens]=useState(false);
const [previewModal,setPreviewModal]=useState(null);
const [schedSendTime,setSchedSendTime]=useState("");
const [schedSendTimer,setSchedSendTimer]=useState(null);
const [pendingBatch,setPendingBatch]=useState(null);
const [batchExpanded,setBatchExpanded]=useState({0:true});
const [batchSentMap,setBatchSentMap]=useState({});
const [batchSchedules,setBatchSchedules]=useState({});
const [touchSchedStarts,setTouchSchedStarts]=useState({});
const [schedStartDt,setSchedStartDt]=useState(()=>{const c=getMTComp(nextMTBizStart(Date.now()));return`${c.y}-${String(c.mo+1).padStart(2,'0')}-${String(c.d).padStart(2,'0')}T09:00`;});
const [schedDelay,setSchedDelay]=useState(60);
const [schedTouchGap,setSchedTouchGap]=useState(7);
const [maxPerDay,setMaxPerDay]=useState(0);
const [schedStatus,setSchedStatus]=useState(null);
const [lastSendErr,setLastSendErr]=useState(null);
const [intCollapsed,setIntCollapsed]=useState(false);
const [segRunning,setSegRunning]=useState(false);
const [segResult,setSegResult]=useState(null);
const [selectedContacts,setSelectedContacts]=useState(new Set());
const [enrollSearch,setEnrollSearch]=useState("");
const [enrollListId,setEnrollListId]=useState("");
const [quickAddEmail,setQuickAddEmail]=useState("");
const [nowTick,setNowTick]=useState(Date.now());
const pendingSendFnsRef=useRef({});
const batchSchedulesRef=useRef({});
const touchSchedStartsRef=useRef({});
const schedDelayRef=useRef(60);
const batchSentMapRef=useRef({});
const sendingRef=useRef(false);
useEffect(()=>{batchSchedulesRef.current=batchSchedules;},[batchSchedules]);
useEffect(()=>{touchSchedStartsRef.current=touchSchedStarts;},[touchSchedStarts]);
useEffect(()=>{schedDelayRef.current=schedDelay;},[schedDelay]);
useEffect(()=>{batchSentMapRef.current=batchSentMap;},[batchSentMap]);
useEffect(()=>{sendingRef.current=sending;},[sending]);
useEffect(()=>{const id=setInterval(()=>setNowTick(Date.now()),15000);return()=>clearInterval(id);},[]);
useEffect(()=>{
const isWorkingHours=()=>{const d=new Date();const h=d.getHours();const wd=d.getDay();return wd>=1&&wd<=5&&h>=9&&h<17;};
const id=setInterval(()=>{
if(sendingRef.current||!isWorkingHours()) return;
const now=Date.now();
for(const [bk,dt] of Object.entries(batchSchedulesRef.current)){
if(dt&&new Date(dt).getTime()<=now){
const fn=pendingSendFnsRef.current[bk];
if(fn){fn();setBatchSchedules(s=>{const n={...s};delete n[bk];return n;});return;}
}
}
},15000);
return()=>clearInterval(id);
},[]);
useEffect(()=>{
if(!selCampId||!Object.keys(touchSchedStartsRef.current).length) return;
const camp=(s.campaigns||[]).find(c=>c.id===selCampId);
if(!camp) return;
const sz=camp.batchSize||25;
const enrs=camp.enrollments||[];
const cmap=Object.fromEntries((s.contacts||[]).map(c=>[c.id,c]));
const updates={};
Object.entries(touchSchedStartsRef.current).forEach(([tiStr,startIso])=>{
const t=parseInt(tiStr);
const startMs=new Date(startIso).getTime();
const tActive=enrs.filter(e=>e.step===t&&e.status==="active"&&!cmap[e.contactId]?.optedOut);
const tPending=tActive.filter(e=>cmap[e.contactId]?.email);
const tBatches=[];
for(let i=0;i<tPending.length;i+=sz)tBatches.push(tPending.slice(i,i+sz));
tBatches.forEach((batch,bi)=>{
const bk=`${selCampId}-${t}-${batch[0]?.contactId||bi}`;
if(!batchSentMapRef.current[bk]&&!batchSchedulesRef.current[bk]){
updates[bk]=new Date(startMs+bi*schedDelayRef.current*60000).toISOString();
}
});
});
if(Object.keys(updates).length) setBatchSchedules(prev=>({...prev,...updates}));
},[selCampId,s.campaigns]);
const [showAddPost,setShowAddPost]=useState(false);
const [postDraft,setPostDraft]=useState({date:"",time:"09:00",platforms:[],caption:"",imageUrl:"",type:"post"});
const [matchingContacts,setMatchingContacts]=useState(null);
const campaigns = s.campaigns || [];
const contactMap = useMemo(()=>Object.fromEntries((s.contacts||[]).map(c=>[c.id,c])),[s.contacts]);
const selCamp = selCampId ? campaigns.find(c=>c.id===selCampId) : null;
selCampIdRef.current = selCamp?.id || null;
campaignsRef.current = campaigns;
const allSports = useMemo(()=>[...new Set((s.contacts||[]).map(c=>c.sport).filter(Boolean))].sort(),[s.contacts]);
const CHANNELS = [
{id:"email",icon:"✉",label:"Cold Email"},
{id:"social",icon:"📱",label:"Social Media"},
{id:"paid_ads",icon:"⬛",label:"Paid Ads"},
{id:"sms",icon:"💬",label:"SMS"},
{id:"phone",icon:"📞",label:"Phone"},
{id:"newsletter",icon:"📧",label:"Newsletter"},
];
const METRICS = ["Opens","Clicks","Replies","Meetings Booked","Quotes Sent","Orders","Revenue","Impressions","Engagement Rate","Cost Per Lead"];
const startNewCampaign = () => {
setSelCampId(null);
setSegResult(null);
setSelectedContacts(new Set());
setMatchingContacts(null);
setShowTemplateSelect(true);
setShowNewCampForm(false);
setCampDraft(null);
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
repId:"",
icp:{sports:[],titles:[],schoolLevel:"All School Levels",regions:[],states:[],buyingSeasonNotes:"",notes:""},
assetTypes:tpl.assetTypes||[],
});
setCampStep(1);
setShowNewCampForm(true);
setShowTemplateSelect(false);
};
const handleCampListUpload=async(e)=>{
const f=e.target.files?.[0];
if(!f) return;
setCampListUploading(true);
try{
const isCsv=f.name.toLowerCase().endsWith(".csv");
let rows;
if(isCsv){
const text=await f.text();
const lines=text.split(/\r?\n/).filter(l=>l.trim());
const hdrs=lines[0].split(",").map(h=>h.replace(/^"|"$/g,"").trim().toLowerCase());
rows=lines.slice(1).map(l=>{const cells=l.split(",").map(c=>c.replace(/^"|"$/g,"").trim());return Object.fromEntries(hdrs.map((h,i)=>[h,cells[i]||""]));});
}else{
const XLSX=await import("xlsx");
const buf=await new Promise((res)=>{const r=new FileReader();r.onload=ev=>res(new Uint8Array(ev.target.result));r.readAsArrayBuffer(f);});
const wb=XLSX.read(buf,{type:"array"});
const ws=wb.Sheets[wb.SheetNames[0]];
const raw=XLSX.utils.sheet_to_json(ws,{defval:""});
rows=raw.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k.toLowerCase().trim(),String(v).trim()])));
}
const g=(row,...keys)=>{for(const k of keys){const v=row[k]||row[k.replace(/_/," ")]||"";if(v) return String(v).trim();}return"";};
const contacts=rows.filter(r=>Object.values(r).some(v=>v)).map(r=>({
id:mkId(),
firstName:g(r,"first name","firstname","first_name"),
lastName:g(r,"last name","lastname","last_name"),
fullName:(g(r,"full name","fullname","name")||[g(r,"first name","firstname","first_name"),g(r,"last name","lastname","last_name")].filter(Boolean).join(" ")).trim(),
email:g(r,"email","email address"),
phone:g(r,"phone","phone number","mobile"),
title:g(r,"title","job title","role","position"),
school:g(r,"school","organization","company","org","account"),
state:g(r,"state","st"),
city:g(r,"city"),
sport:g(r,"sport","sports"),
source:"import",confidence:"medium",outreachStatus:"new",importedAt:Date.now(),
}));
if(contacts.length===0){toast("No contacts found in file","error");return;}
const existingByEmail=Object.fromEntries((s.contacts||[]).filter(c=>c.email).map(c=>[c.email.toLowerCase(),c.id]));
const toAdd=contacts.filter(c=>!c.email||!existingByEmail[c.email.toLowerCase()]);
const dupes=contacts.length-toAdd.length;
if(toAdd.length>0) dispatch("ADD_CONTACTS",toAdd);
const allListIds=[
...toAdd.map(c=>c.id),
...contacts.filter(c=>c.email&&existingByEmail[c.email.toLowerCase()]).map(c=>existingByEmail[c.email.toLowerCase()]),
];
const listName=f.name.replace(/\.[^.]+$/,"");
const newList={id:mkId(),name:listName,contactIds:allListIds,createdAt:Date.now(),source:"import"};
dispatch("ADD_CONTACT_LIST",newList);
setCampDraft(c=>({...c,audienceListId:newList.id,audienceMode:"list"}));
toast(`List "${listName}" ready — ${allListIds.length} contacts${dupes>0?` · ${dupes} already in DB (included)`:""}  `,"success");
}catch(err){toast("Upload failed: "+err.message,"error");}
setCampListUploading(false);
e.target.value="";
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
if(!campDraft) return;
const audienceModeCheck = campDraft.audienceMode||"ai";
const hasListSelected = audienceModeCheck==="list"&&campDraft.audienceListId;
const hasAnyContent = (campDraft?.touches||[]).length>0||(campDraft?.adCopy||"").trim()||(campDraft?.callScript||"").trim()||(campDraft?.directMail||"").trim()||(campDraft?.socialDrafts||[]).length>0;
const types = campDraft?.assetTypes||[];
if(!hasListSelected&&types.length>0&&!hasAnyContent){toast("Generate at least one asset before launching, or switch to FROM LIST mode to launch and add email templates later.","error");return;}
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
enrollments=seg.map((c,i)=>{
const dayOffset=Math.floor(i/batchSize);
const startD=new Date(startDate);
startD.setDate(startD.getDate()+dayOffset);
const enrollDate=startD.toISOString().slice(0,10);
return {contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:enrollDate,sentSteps:[]};
});
} else {
seg = segResult
? contacts.filter(c=>selectedContacts.has(c.id)&&c.email)
: contacts.filter(c=>c.email&&(campDraft.audience==="all"||!campDraft.audience||(c.title||"").toLowerCase().includes((campDraft.audience||"").toLowerCase().split(" ")[0].toLowerCase())));
enrollments=seg.map(c=>({contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr,sentSteps:[]}));
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
_draftStep: campStep,
createdAt: existingCamp?.createdAt||today(),
color: existingCamp?.color||CAMP_COLORS[campaigns.length % CAMP_COLORS.length],
};
if(isEditing) dispatch("UPDATE_CAMPAIGN", camp);
else dispatch("ADD_CAMPAIGN", camp);
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
const mergedBody=mergeTags(touch.body,c);
const plainBody=(mergedBody.trim()?mergedBody:"(No email body — edit this touch in the Assets tab)")+sigText;
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
...(rep?.gmailEnvKey ? {repEnvKey:rep.gmailEnvKey} : {}),
...(rep?.email ? {reply_to:rep.email, from_name:rep.name} : {}),
...(touch.isQuote && co.quoteTrackEmail ? {bcc:co.quoteTrackEmail} : {}),
})});
const d=await r.json();
if(d.sent) return {ok:true};
const reason=d.error||(d.raw?.error?.message)||"send failed";
return {ok:false,reason};
}catch(err){
return {ok:false,reason:err.message};
}
};
const BATCH_SIZE = 25;
const BETWEEN_EMAILS = 3000;
const executeBatch = async ({campId, queue, batchNum, sentSoFar, failedSoFar, firstErr: prevErr}) => {
const camp = campaigns.find(c=>c.id===campId);
if(!camp){setPendingBatch(null);return;}
const batch = queue.slice(0,BATCH_SIZE);
const remaining = queue.slice(BATCH_SIZE);
const totalBatches = Math.ceil((queue.length)/BATCH_SIZE) + (batchNum - 1);
setSending(true);
let sent=0, failed=0, firstErr=prevErr||null;
const todayStr=today();
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
}
}
dispatch("UPDATE_CAMPAIGN",{...camp,enrollments:updatedEnrollments});
// Quote-touch sends no longer auto-push a Deal into Zoho CRM — a send isn't
// intent. The deal stays local-only until the contact actually replies
// (Brad's classifyEmailIntent flow) or a rep manually promotes them.
dealsToCreate.forEach(deal=>{ dispatch("ADD_DEAL",deal); });
if(dealsToCreate.length>0) toast(`${dealsToCreate.length} deal${dealsToCreate.length!==1?"s":""} created in RevOps (not pushed to Zoho — no intent yet)`,"info");
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
const post = {id:mkId(),...postDraft,campId,createdAt:today(),scheduledDate:postDraft.date||""};
dispatch("UPDATE_CAMPAIGN",{...camp,socialPosts:[...(camp.socialPosts||[]),post]});
setPostDraft({date:"",time:"09:00",platforms:[],caption:"",imageUrl:"",type:"post"});
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
<PH title="CAMPAIGNS" sub="Campaign wizard and execution hub"/>
<div style={{display:"flex",gap:5,marginBottom:18,flexWrap:"wrap"}}>
{[["campaigns","CAMPAIGNS"],["send-status","⚡ SEND STATUS"]].map(([id,l])=>(
<button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
))}
</div>
{tab==="send-status"&&<SendStatusPanel/>}
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
No reps yet — <button onClick={()=>setMod("settings")} style={{background:"none",border:"none",color:B.orange,fontFamily:"'Lexend',sans-serif",fontSize:11,cursor:"pointer",padding:0}}>add them in Settings →</button>
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
{/* Image */}
<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:5}}>IMAGE</div>
<div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
<input value={p.imagePrompt||`${campDraft.product||"sports equipment"} for ${(campDraft.icp?.sports||["sports"])[0]} — social post visual`} onChange={e=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imagePrompt:e.target.value}:x)}))} placeholder="AI image prompt..." style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<button onClick={async()=>{
const prompt=p.imagePrompt||`${campDraft.product||"sports equipment"} for ${(campDraft.icp?.sports||["sports"])[0]} — social post visual`;
setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageGenerating:true,imageError:""}:x)}));
try{
const r=await fetch("/api/adengine/generate-product-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,style:"REALISTIC",sizeKey:"square"})});
const d=await r.json();
if(!r.ok||!d.imageUrl){const errMsg=d.error||"Image generation failed";setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageGenerating:false,imageError:errMsg}:x)}));toast(errMsg,"error");return;}
setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageUrl:d.imageUrl,imageGenerating:false,imageError:""}:x)}));
}catch(err){const msg=err.message||"Image generation failed";setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageGenerating:false,imageError:msg}:x)}));toast(msg,"error");}
}} disabled={p.imageGenerating} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,opacity:p.imageGenerating?.7:1}}>
{p.imageGenerating?"GENERATING...":"🎨 AI IMAGE"}
</button>
<label style={{background:B.surface,color:B.text,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
📎 UPLOAD
<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageUrl:ev.target.result,imageError:""}:x)}));r.readAsDataURL(f);}}/>
</label>
</div>
{p.imageGenerating&&<div style={{display:"flex",gap:6,alignItems:"center",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.purple}}><Spin/>Generating image…</div>}
{p.imageError&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.red,marginTop:4}}>{p.imageError}</div>}
{p.imageUrl&&<div style={{marginTop:6,position:"relative",display:"inline-block"}}><img src={p.imageUrl} alt="Post visual" style={{maxWidth:200,borderRadius:5,border:`1px solid ${B.border}`,display:"block"}}/><button onClick={()=>setCampDraft(c=>({...c,socialDrafts:c.socialDrafts.map((x,j)=>j===i?{...x,imageUrl:""}:x)}))} style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,.6)",color:"#fff",border:"none",borderRadius:3,padding:"2px 6px",fontSize:9,cursor:"pointer"}}>✕</button></div>}
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
{/* Send-from rep selector */}
<div style={{marginBottom:14}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5,marginBottom:6}}>SEND FROM — who does this campaign send as?</div>
<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
{(s.reps||[]).map(r=>{const sel=campDraft?.repId===r.id;return(
<button key={r.id} onClick={()=>setCampDraft(c=>({...c,repId:r.id}))}
style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:sel?`${B.orange}10`:B.white,border:`2px solid ${sel?B.orange:B.border}`,borderRadius:5,cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:11,color:sel?B.orange:B.text}}>
<div style={{width:22,height:22,borderRadius:"50%",background:r.gmailEnvKey?B.green:B.yellow,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:8,color:B.white}}>{(r.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span></div>
<div>
<div style={{fontWeight:sel?700:500}}>{r.name}</div>
{r.email&&<div style={{fontSize:9,color:B.muted}}>{r.email}</div>}
</div>
{r.gmailEnvKey&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"1px 5px",borderRadius:3}}>GMAIL ✓</span>}
</button>
);})}
{!(s.reps||[]).length&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No reps configured — <a href="#settings" onClick={()=>setMod("settings")} style={{color:B.blue}}>add in Settings</a>.</span>}
</div>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:16}}>AI-match your contacts to find the best fit for this campaign, then select who to enroll.</div>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{totalContactsAll.toLocaleString()} contacts <span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>({dbTotal.toLocaleString()} CRM · {(s.contacts||[]).length.toLocaleString()} uploaded)</span></div>
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
{(s.contactLists||[]).length>0&&(
<select value={campDraft.audienceListId||""} onChange={e=>setCampDraft(c=>({...c,audienceListId:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:campDraft.audienceListId?B.text:B.muted,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif",marginBottom:8}}>
<option value="">— select a contact list —</option>
{(s.contactLists||[]).map(list=>(
<option key={list.id} value={list.id}>{list.name} ({(list.contactIds||[]).length} contacts)</option>
))}
</select>
)}
<label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:B.surface,border:`1px dashed ${B.orange}60`,borderRadius:4,padding:"8px 12px",cursor:"pointer",boxSizing:"border-box",opacity:campListUploading?.6:1}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.4}}>{campListUploading?"IMPORTING…":"⬆ UPLOAD NEW LIST (.csv / .xlsx)"}</span>
<input type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} disabled={campListUploading} onChange={handleCampListUpload}/>
</label>
</div>
)}
</div>
{/* Batch size */}
<div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,flexShrink:0}}>BATCH SIZE</div>
<input type="number" min={1} max={500} value={campDraft.batchSize||25}
onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)setCampDraft(c=>({...c,batchSize:v}));}}
onBlur={e=>{if(!parseInt(e.target.value)||parseInt(e.target.value)<1)setCampDraft(c=>({...c,batchSize:25}));}}
style={{width:80,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
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
pendingSendFnsRef.current={};
const enrs=selCamp.enrollments||[];
const touches=selCamp.touches||[];
const rep=selCamp.repId?(s.reps||[]).find(r=>r.id===selCamp.repId):null;
const advanceEnroll=(updEnr,enroll,todStr,camp)=>{
const idx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
if(idx<0) return;
const ns=enroll.step+1;
const done=ns>=(camp.touches||[]).length;
const nt=(camp.touches||[])[ns];
const nd=nt?new Date(Date.now()+nt.dayOffset*86400000).toISOString().slice(0,10):null;
updEnr[idx]={...updEnr[idx],step:ns,status:done?"done":"active",nextDate:nd||enroll.nextDate,lastContacted:todStr,lastSentAt:todStr};
};
const sendOneBatch=async(batchEnrollments,batchKey,noEmailEnrs=[],forceResend=false)=>{
const camp=campaigns.find(c=>c.id===selCamp.id);
if(!camp){ toast("Campaign not found — try refreshing","error"); return; }
if(sending){ toast("Send already in progress — wait for it to finish","warn"); return; }
setSending(true);
setLastSendErr(null);
try {
let sent=0,failed=0,skipped=0,firstErr=null;
const todStr=today();
const updEnr=[...(camp.enrollments||[])];
const activeCount=batchEnrollments.filter(e=>e.status!=="interested").length;
if(activeCount>0) toast(`Sending ${activeCount} emails…`,"info");
for(const enroll of batchEnrollments){
if(enroll.status==="interested"){ skipped++; continue; }
const guardIdx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
if(guardIdx>=0 && (updEnr[guardIdx].sentSteps||[]).includes(enroll.step)){ skipped++; continue; }
if(!forceResend && guardIdx>=0 && updEnr[guardIdx].step!==enroll.step){ skipped++; continue; }
const res=await sendOneEmail(camp,enroll);
if(res.ok){
if(guardIdx>=0) updEnr[guardIdx]={...updEnr[guardIdx],sentSteps:[...(updEnr[guardIdx].sentSteps||[]),enroll.step],lastContacted:todStr,lastSentAt:todStr};
if(!forceResend) advanceEnroll(updEnr,enroll,todStr,camp);
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
for(const enroll of batchEnrollments){
if(enroll.status==="interested"){
const idx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
if(idx>=0) updEnr[idx]={...updEnr[idx],status:"done",interestedAt:updEnr[idx].interestedAt||todStr};
}
}
let noEmailAdv=0;
for(const enroll of noEmailEnrs){
const guardIdx=updEnr.findIndex(e=>e.contactId===enroll.contactId);
if(guardIdx>=0 && updEnr[guardIdx].step===enroll.step){
advanceEnroll(updEnr,enroll,todStr,camp);
noEmailAdv++;
}
}
const finalCamp=campaignsRef.current.find(c=>c.id===camp.id)||camp;
if(batchKey){
const totalProcessed=sent+skipped+noEmailAdv;
if(totalProcessed>0){
setBatchSentMap(m=>({...m,[batchKey]:{sent,failed}}));
const newSched={...(finalCamp.scheduledBatches||{})};
delete newSched[batchKey];
dispatch("UPDATE_CAMPAIGN",{...finalCamp,enrollments:updEnr,scheduledBatches:newSched,sentBatches:{...(finalCamp.sentBatches||{}),[batchKey]:{sent,failed,sentAt:new Date().toISOString()}}});
} else {
const retryMs=nextMTBizStart(Date.now());
const retryIso=new Date(retryMs).toISOString();
setBatchSchedules(s=>({...s,[batchKey]:retryIso}));
const prevInfo=finalCamp.scheduledBatches?.[batchKey]||{};
const newSched={...(finalCamp.scheduledBatches||{}),[batchKey]:{...prevInfo,scheduledAt:retryIso}};
dispatch("UPDATE_CAMPAIGN",{...finalCamp,enrollments:updEnr,scheduledBatches:newSched});
}
} else {
dispatch("UPDATE_CAMPAIGN",{...finalCamp,enrollments:updEnr});
}
const skipNote=skipped?` · ${skipped} already sent/interested`:"";
const noEmailNote=noEmailAdv?` · ${noEmailAdv} skipped (no email)`:"";
const msg=`${sent} sent${failed?`, ${failed} failed — ${firstErr}`:""}${skipNote}${noEmailNote}`;
toast(msg,sent>0||skipped>0||noEmailAdv>0?"success":"error");
if(failed>0||sent===0&&skipped===0&&noEmailAdv===0) setLastSendErr(msg);
} catch(err) {
const errMsg=`Send crashed: ${err.message}`;
toast(errMsg,"error");
setLastSendErr(errMsg);
} finally {
setSending(false);
}
};
const markBatchSent=async(batchEnrollments,batchKey)=>{
const camp=campaigns.find(c=>c.id===selCamp.id);
if(!camp) return;
const todStr=today();
const updEnr=[...(camp.enrollments||[])];
let advanced=0,skipped=0;
for(const enroll of batchEnrollments){
if(enroll.status==="interested"){
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
const allSent=enrs.filter(e=>e.lastSentAt||e.step>0).length;
const replied=enrs.filter(e=>e.status==="replied").length;
const interested=enrs.filter(e=>e.status==="interested").length;
const done=enrs.filter(e=>e.status==="done").length;
const totalPending=enrs.filter(e=>e.status==="active"&&!contactMap[e.contactId]?.optedOut).length;
const testGmailConn=async()=>{
const repKey=rep?.gmailEnvKey||"";
try{
const r=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({action:"profile",...(repKey?{repEnvKey:repKey}:{})})});
const d=await r.json();
if(d.email){toast(`Gmail OK — connected as ${d.email}`,"success");setLastSendErr(null);}
else{const e=d.error||"unknown error";toast(`Gmail error: ${e}`,"error");setLastSendErr(`Gmail connection failed: ${e}`);}
}catch(err){toast(`Gmail test failed: ${err.message}`,"error");setLastSendErr(`Gmail connection failed: ${err.message}`);}
};
return(<>
{/* Always-visible Gmail connectivity check — auto-runs on mount */}
<GmailStatusBanner repKey={rep?.gmailEnvKey||""} repEmail={rep?.email||""} />
{/* Rep sender selector */}
{rep?(
<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:rep.gmailEnvKey?`${B.green}08`:`${B.yellow}10`,border:`1px solid ${rep.gmailEnvKey?B.green+"30":B.yellow+"60"}`,borderRadius:5,marginBottom:8}}>
<div style={{width:26,height:26,borderRadius:"50%",background:rep.gmailEnvKey?B.green:B.yellow,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span></div>
<div style={{flex:1}}>
{rep.gmailEnvKey
?<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>Sending from <strong>{rep.name}</strong>'s Gmail ({rep.email||rep.gmailEnvKey})</span>
:<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>⚠️ <strong>{rep.name}</strong> has no personal Gmail configured. <a href="#settings" onClick={()=>setMod("settings")} style={{color:B.blue}}>Set a Gmail Key in Settings</a>, then have {rep.name.split(" ")[0]} open <a href={rep.gmailEnvKey?`/api/gmail-setup?repKey=${rep.gmailEnvKey}&hint=${encodeURIComponent(rep.email||"")}`:"/api/gmail-setup"} target="_blank" rel="noreferrer" style={{color:B.blue,fontWeight:600}}>this link on their own computer →</a></span>
}
</div>
<button onClick={testGmailConn} style={{background:"none",border:`1px solid ${B.blue}40`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.blue,cursor:"pointer",whiteSpace:"nowrap"}}>TEST GMAIL</button>
<button onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,repId:""})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>CHANGE</button>
</div>
):(
<div style={{padding:"10px 12px",background:B.surface,border:`1px solid ${B.orange}40`,borderRadius:5,marginBottom:8}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5,marginBottom:6}}>SEND FROM — select who this campaign sends as</div>
<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
{(s.reps||[]).length===0?(
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No sales reps configured. <a href="#settings" onClick={()=>setMod("settings")} style={{color:B.blue}}>Add reps in Settings.</a></span>
):(s.reps||[]).map(r=>(
<button key={r.id} onClick={()=>dispatch("UPDATE_CAMPAIGN",{...selCamp,repId:r.id})}
style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:B.white,border:`1px solid ${B.border}`,borderRadius:5,cursor:"pointer",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
<div style={{width:22,height:22,borderRadius:"50%",background:r.gmailEnvKey?B.green:B.yellow,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:8,color:B.white}}>{(r.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span></div>
<div>
<div style={{fontWeight:600}}>{r.name}</div>
{r.email&&<div style={{fontSize:9,color:B.muted}}>{r.email}</div>}
</div>
{r.gmailEnvKey&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.green,background:B.greenBg,padding:"1px 5px",borderRadius:3,marginLeft:2}}>GMAIL ✓</span>}
</button>
))}
</div>
</div>
)}
{/* Stuck-sending reset — if sending got stuck, show a reset button */}
{sending&&(
<div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:`${B.orange}10`,border:`1px solid ${B.orange}40`,borderRadius:5,marginBottom:8,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange}}>
<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⏳</span>
<span style={{flex:1}}>Sending in progress…</span>
<button onClick={()=>setSending(false)} style={{background:"none",border:`1px solid ${B.orange}60`,borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:B.orange,cursor:"pointer"}}>RESET</button>
</div>
)}
{/* Persistent error banner from last send attempt */}
{lastSendErr&&(
<div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 14px",background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:6,marginBottom:12}}>
<span style={{flexShrink:0,fontSize:14}}>⚠️</span>
<div style={{flex:1,fontFamily:"'Lexend',sans-serif",fontSize:11,color:"#b91c1c",lineHeight:1.5}}>{lastSendErr}</div>
<div style={{display:"flex",gap:6,flexShrink:0}}>
<button onClick={testGmailConn} style={{background:"#b91c1c",color:"#fff",border:"none",borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>TEST GMAIL</button>
<button onClick={()=>setLastSendErr(null)} style={{background:"none",border:"none",color:"#b91c1c",cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>×</button>
</div>
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
<div style={{display:"flex",alignItems:"center",gap:5,background:B.surface,border:`1px solid ${B.border}`,borderRadius:5,padding:"4px 10px"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,whiteSpace:"nowrap"}}>BATCH SZ</span>
<input type="number" min={1} max={500} value={selCamp.batchSize||25}
onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,batchSize:v});}}
onBlur={e=>{if(!parseInt(e.target.value)||parseInt(e.target.value)<1)dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,batchSize:25});}}
style={{width:44,background:"transparent",border:"none",color:B.text,fontSize:12,fontFamily:"'Lexend',sans-serif",outline:"none",textAlign:"center"}}/>
</div>
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
const _dn=`${selCamp.product||"Equipment"} — ${school||name}`;
dispatch("ADD_DEAL",{id:dealId,contactId:c.id,name:_dn,company:school||name,stage:"Qualified Lead",value:"",notes:`Re-engaged via campaign: ${selCamp.name}. Previously closed lost.`,createdAt:today(),updatedAt:today()});
pushDealToZoho({dealName:_dn,stage:"Qualified Lead",accountName:school||name,description:`Re-engaged via campaign: ${selCamp.name}. Previously closed lost.`}).then(dd=>{if(dd.dealId)dispatch("UPDATE_DEAL",{id:dealId,zohoId:dd.dealId});});
toast(`New deal created for ${name}`,"success");
}} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"5px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
↺ RE-OPEN DEAL
</button>
</div>
):(
<button onClick={()=>{
const dealId=mkId();
const _dn=`${selCamp.product||"Equipment"} — ${school||name}`;
dispatch("ADD_DEAL",{id:dealId,contactId:c.id,name:_dn,company:school||name,stage:"Qualified Lead",value:"",notes:`From campaign: ${selCamp.name}. Marked interested on ${today()}.`,createdAt:today(),updatedAt:today()});
pushDealToZoho({dealName:_dn,stage:"Qualified Lead",accountName:school||name,description:`From campaign: ${selCamp.name}. Marked interested on ${today()}.`}).then(dd=>{if(dd.dealId)dispatch("UPDATE_DEAL",{id:dealId,zohoId:dd.dealId});});
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
{/* ── Batch Schedule Panel ── */}
{touches.length>0&&(()=>{
const sz=selCamp.batchSize||25;
const ti=touches.findIndex((_,idx)=>enrs.some(e=>e.step===idx&&e.status==="active"&&!contactMap[e.contactId]?.optedOut&&contactMap[e.contactId]?.email));
const startTi=ti<0?0:ti;
const pendingScheduledCount=Object.keys(selCamp.scheduledBatches||{}).length;
const sentBatchCount=Object.keys(selCamp.sentBatches||{}).length;
const applySchedule=()=>{
const startMs=parseMTLocalStr(schedStartDt);
if(!startMs||isNaN(startMs))return;
const batchUpdates={};
const startUpdates={};
const campBatches={};
let currentMs=startMs;
let batchesThisDay=0;
const maxBpd=maxPerDay>0?Math.max(1,Math.floor(maxPerDay/sz)):Infinity;
const totalWithEmail=enrs.filter(e=>e.status==="active"&&!contactMap[e.contactId]?.optedOut&&contactMap[e.contactId]?.email).length;
for(let t=startTi;t<touches.length;t++){
startUpdates[t]=new Date(currentMs).toISOString();
const tActive=enrs.filter(e=>e.step===t&&e.status==="active"&&!contactMap[e.contactId]?.optedOut);
const tPending=tActive.filter(e=>contactMap[e.contactId]?.email);
const tBatches=[];
for(let i=0;i<tPending.length;i+=sz)tBatches.push(tPending.slice(i,i+sz));
const touchStartMs=currentMs;
const unsentBatchInfos=tBatches
.map((batch,bi)=>({bk:`${selCamp.id}-${t}-${batch[0]?.contactId||bi}`,contactIds:batch.map(e=>e.contactId)}))
.filter(({bk})=>{const si=batchSentMap[bk];return !(si&&si.sent>0);});
unsentBatchInfos.forEach(({bk,contactIds})=>{
const firesAt=new Date(currentMs).toISOString();
batchUpdates[bk]=firesAt;
const batchContacts={};
contactIds.forEach(cid=>{const c=contactMap[cid];if(c?.email)batchContacts[cid]={email:c.email,fullName:c.fullName||(((c.firstName||"")+" "+(c.lastName||"")).trim()),firstName:c.firstName||"",lastName:c.lastName||"",school:typeof c.school==="string"?c.school:c.school?.name||"",sport:typeof c.sport==="string"?c.sport:c.sport?.name||""};});
campBatches[bk]={scheduledAt:firesAt,touchIdx:t,contactIds,batchContacts};
batchesThisDay++;
const tentNext=currentMs+schedDelay*60000;
const nc=getMTComp(tentNext);
const afterHours=nc.h>=17||nc.wd===0||nc.wd===6;
const hitDayCap=maxBpd<Infinity&&batchesThisDay>=maxBpd;
if(afterHours||hitDayCap){currentMs=nextMTBizStart(currentMs);batchesThisDay=0;}
else currentMs=tentNext;
});
if(t<touches.length-1){
currentMs=addBusinessDays(touchStartMs,schedTouchGap);
const gc=getMTComp(currentMs);
if(gc.h<9){for(const off of[6,7]){const c=Date.UTC(gc.y,gc.mo,gc.d,9+off,0,0);if(getMTComp(c).h===9){currentMs=c;break;}}}
batchesThisDay=0;
}
}
setBatchSchedules(prev=>({...prev,...batchUpdates}));
setTouchSchedStarts(prev=>({...prev,...startUpdates}));
const rescheduledKeys=Object.keys(campBatches);
const updSentBatches={...(selCamp.sentBatches||{})};
rescheduledKeys.forEach(k=>delete updSentBatches[k]);
if(rescheduledKeys.length>0) setBatchSentMap(prev=>{const n={...prev};rescheduledKeys.forEach(k=>delete n[k]);return n;});
const newScheduledBatches={...(selCamp.scheduledBatches||{}),...campBatches};
dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,scheduledBatches:newScheduledBatches,sentBatches:updSentBatches});
const _uc=(s.campaigns||[]).map(c=>c.id===selCamp.id?{...c,scheduledBatches:newScheduledBatches,sentBatches:updSentBatches}:c);
const{currentUserId:_cid,contacts:_cc,agentHistory:_ah,..._ts}={...s,campaigns:_uc};
fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:_ts})}).catch(()=>{});
};
const handleScheduleClick=()=>{
setSchedStatus('applying');
setTimeout(()=>{applySchedule();setSchedStatus('done');setTimeout(()=>setSchedStatus(null),2500);},120);
};
return(
<div className="card" style={{padding:"12px 14px",marginBottom:14,borderLeft:`3px solid ${B.blue}`}}>
<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1}}>BATCH SCHEDULE</div>
{pendingScheduledCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}15`,padding:"2px 7px",borderRadius:3}}>{pendingScheduledCount} PENDING</span>}
{sentBatchCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"2px 7px",borderRadius:3}}>{sentBatchCount} SENT</span>}
</div>
<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:8}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>START (MOUNTAIN TIME)</div>
<input type="datetime-local" value={schedStartDt} onChange={e=>setSchedStartDt(e.target.value)}
style={{background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>CONTACTS / BATCH</div>
<input type="number" min={1} max={500} value={selCamp.batchSize||25}
onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,batchSize:v});}}
style={{width:65,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>MAX / DAY (0=∞)</div>
<input type="number" min={0} max={10000} value={maxPerDay}
onChange={e=>setMaxPerDay(parseInt(e.target.value)||0)}
style={{width:75,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>MINS BETWEEN BATCHES</div>
<input type="number" min={5} max={1440} value={schedDelay} onChange={e=>setSchedDelay(parseInt(e.target.value)||60)}
style={{width:70,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>BIZ DAYS BETWEEN TOUCHES</div>
<input type="number" min={1} max={60} value={schedTouchGap} onChange={e=>setSchedTouchGap(parseInt(e.target.value)||7)}
style={{width:60,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<button onClick={handleScheduleClick} disabled={schedStatus==='applying'}
style={{background:schedStatus==='done'?B.green:schedStatus==='applying'?B.muted:B.blue,color:B.white,border:"none",borderRadius:5,padding:"7px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:schedStatus==='applying'?"not-allowed":"pointer",whiteSpace:"nowrap",transition:"background .2s"}}>
{schedStatus==='applying'?"⟳ SCHEDULING…":schedStatus==='done'?"✓ SCHEDULED":"SCHEDULE ALL BATCHES"}
</button>
{pendingScheduledCount>0&&(
<button onClick={()=>{dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,scheduledBatches:{}});setBatchSchedules({});setTouchSchedStarts({});}}
style={{background:"none",border:`1px solid ${B.red}40`,borderRadius:5,padding:"7px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,cursor:"pointer",whiteSpace:"nowrap"}}>
CLEAR SCHEDULE
</button>
)}
</div>
{pendingScheduledCount>0&&(
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>
{pendingScheduledCount} batch{pendingScheduledCount!==1?"es":""} pending · cron fires every 15 min Mon–Fri 9am–5pm MT · batches outside hours shift to next 9am MT automatically.
</div>
)}
</div>
);
})()}
{/* Per-touch sections */}
{touches.map((touch,ti)=>{
const allActive=enrs.filter(e=>e.step===ti&&e.status==="active"&&!contactMap[e.contactId]?.optedOut);
const pending=allActive.filter(e=>contactMap[e.contactId]?.email);
const noEmail=allActive.filter(e=>!contactMap[e.contactId]?.email);
const receivedCount=enrs.filter(e=>e.step>ti||(e.step===ti&&["done","replied","interested","not_interested","unsubscribed"].includes(e.status))).length;
const campBatchSz=selCamp.batchSize||25;
const touchBatches=[];
for(let i=0;i<pending.length;i+=campBatchSz) touchBatches.push(pending.slice(i,i+campBatchSz));
const allDone=pending.length===0&&noEmail.length===0;
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
:`${pending.length} pending · ${receivedCount} already sent · ${touchBatches.length} batch${touchBatches.length!==1?"es":""}${noEmail.length?` · ${noEmail.length} no email (auto-skipped on send)`:""}`
}
</div>
</div>
{allDone&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"3px 8px",borderRadius:4,letterSpacing:.5}}>COMPLETE</span>}
</div>
{/* Batches for this touch */}
{!allDone&&(
<div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:6,borderTop:`1px solid ${B.border}`}}>
{/* ── Batch schedule panel ── */}
{touchBatches.length>0&&(()=>{
const sz=selCamp.batchSize||25;
const unsentBatches=touchBatches.map((batch,bi)=>({bk:`${selCamp.id}-${ti}-${batch[0]?.contactId||bi}`,bi})).filter(({bk})=>{const si=batchSentMap[bk];return !(si&&si.sent>0);});
const anyScheduled=unsentBatches.some(({bk})=>batchSchedules[bk]);
const hasMoreTouches=ti<touches.length-1;
let touchesQueued=anyScheduled?1:0;
for(let t=ti+1;t<touches.length;t++){
const tp=enrs.filter(e=>e.step===t&&e.status==="active"&&!contactMap[e.contactId]?.optedOut&&contactMap[e.contactId]?.email);
const firstBk=tp.length?`${selCamp.id}-${t}-${tp.slice(0,sz)[0]?.contactId||0}`:null;
if(firstBk&&batchSchedules[firstBk]) touchesQueued++;
}
const applySchedule=()=>{
const startMs=parseMTLocalStr(schedStartDt);
if(!startMs||isNaN(startMs))return;
const batchUpdates={};
const startUpdates={};
const campBatches={};
let currentMs=startMs;
let batchesThisDay=0;
const maxBpd=maxPerDay>0?Math.max(1,Math.floor(maxPerDay/sz)):Infinity;
const totalWithEmail=enrs.filter(e=>e.status==="active"&&!contactMap[e.contactId]?.optedOut&&contactMap[e.contactId]?.email).length;
for(let t=ti;t<touches.length;t++){
startUpdates[t]=new Date(currentMs).toISOString();
const tActive=enrs.filter(e=>e.step===t&&e.status==="active"&&!contactMap[e.contactId]?.optedOut);
const tPending=tActive.filter(e=>contactMap[e.contactId]?.email);
const tBatches=[];
for(let i=0;i<tPending.length;i+=sz)tBatches.push(tPending.slice(i,i+sz));
const touchStartMs=currentMs;
const unsentBatchInfos=tBatches
.map((batch,bi)=>({bk:`${selCamp.id}-${t}-${batch[0]?.contactId||bi}`,contactIds:batch.map(e=>e.contactId)}))
.filter(({bk})=>{const si=batchSentMap[bk];return !(si&&si.sent>0);});
unsentBatchInfos.forEach(({bk,contactIds})=>{
const firesAt=new Date(currentMs).toISOString();
batchUpdates[bk]=firesAt;
const batchContacts={};
contactIds.forEach(cid=>{const c=contactMap[cid];if(c?.email)batchContacts[cid]={email:c.email,fullName:c.fullName||(((c.firstName||"")+" "+(c.lastName||"")).trim()),firstName:c.firstName||"",lastName:c.lastName||"",school:typeof c.school==="string"?c.school:c.school?.name||"",sport:typeof c.sport==="string"?c.sport:c.sport?.name||""};});
campBatches[bk]={scheduledAt:firesAt,touchIdx:t,contactIds,batchContacts};
batchesThisDay++;
const tentNext=currentMs+schedDelay*60000;
const nc=getMTComp(tentNext);
const afterHours=nc.h>=17||nc.wd===0||nc.wd===6;
const hitDayCap=maxBpd<Infinity&&batchesThisDay>=maxBpd;
if(afterHours||hitDayCap){currentMs=nextMTBizStart(currentMs);batchesThisDay=0;}
else currentMs=tentNext;
});
if(t<touches.length-1){
currentMs=addBusinessDays(touchStartMs,schedTouchGap);
const gc=getMTComp(currentMs);
if(gc.h<9){for(const off of[6,7]){const c=Date.UTC(gc.y,gc.mo,gc.d,9+off,0,0);if(getMTComp(c).h===9){currentMs=c;break;}}}
batchesThisDay=0;
}
}
setBatchSchedules(s=>({...s,...batchUpdates}));
setTouchSchedStarts(prev=>({...prev,...startUpdates}));
const rescheduledKeys2=Object.keys(campBatches);
const updSentBatches2={...(selCamp.sentBatches||{})};
rescheduledKeys2.forEach(k=>delete updSentBatches2[k]);
if(rescheduledKeys2.length>0) setBatchSentMap(prev=>{const n={...prev};rescheduledKeys2.forEach(k=>delete n[k]);return n;});
const newScheduledBatches2={...(selCamp.scheduledBatches||{}),...campBatches};
dispatch("UPDATE_CAMPAIGN",{id:selCamp.id,scheduledBatches:newScheduledBatches2,sentBatches:updSentBatches2});
const _uc2=(s.campaigns||[]).map(c=>c.id===selCamp.id?{...c,scheduledBatches:newScheduledBatches2,sentBatches:updSentBatches2}:c);
const{currentUserId:_cid2,contacts:_cc2,agentHistory:_ah2,..._ts2}={...s,campaigns:_uc2};
fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:_ts2})}).catch(()=>{});
};
const handleSchedClick=()=>{setSchedStatus('applying');setTimeout(()=>{applySchedule();setSchedStatus('done');setTimeout(()=>setSchedStatus(null),2500);},120);};
const clearSchedule=()=>{
const keys=new Set(unsentBatches.map(({bk})=>bk));
setBatchSchedules(s=>{const n={...s};keys.forEach(k=>delete n[k]);return n;});
};
const inputStyle={background:B.white,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"'Lexend',sans-serif",color:B.text,outline:"none"};
const labelStyle={fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5};
return(
<div style={{marginBottom:4,padding:"12px 14px",background:anyScheduled?`${B.blue}06`:B.surface,border:`1px solid ${anyScheduled?B.blue:B.border}`,borderRadius:7}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:1,marginBottom:10}}>⏱ SCHEDULE BATCHES</div>
<div style={{display:"flex",alignItems:"flex-end",gap:10,flexWrap:"wrap"}}>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
<label style={labelStyle}>START DATE & TIME</label>
<input type="datetime-local" value={schedStartDt} min={dtLocalStr(Date.now())}
onChange={e=>setSchedStartDt(e.target.value)} style={inputStyle}/>
</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
<label style={labelStyle}>DELAY BETWEEN BATCHES</label>
<select value={schedDelay} onChange={e=>setSchedDelay(Number(e.target.value))}
style={{...inputStyle,cursor:"pointer"}}>
<option value={15}>15 minutes</option>
<option value={30}>30 minutes</option>
<option value={60}>1 hour</option>
<option value={120}>2 hours</option>
<option value={240}>4 hours</option>
<option value={480}>8 hours</option>
<option value={1440}>1 day</option>
</select>
</div>
{hasMoreTouches&&(
<div style={{display:"flex",flexDirection:"column",gap:3}}>
<label style={labelStyle}>DAYS UNTIL NEXT TOUCH</label>
<div style={{display:"flex",alignItems:"center",gap:5}}>
<input type="number" min={1} max={60} value={schedTouchGap}
onChange={e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>=1)setSchedTouchGap(v);}}
onBlur={e=>{if(!parseInt(e.target.value)||parseInt(e.target.value)<1)setSchedTouchGap(3);}}
style={{...inputStyle,width:52,textAlign:"center"}}/>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>business days</span>
</div>
</div>
)}
<button onClick={handleSchedClick} disabled={!schedStartDt||schedStatus==='applying'}
style={{background:schedStatus==='done'?B.green:schedStatus==='applying'?B.muted:anyScheduled?B.green:B.blue,color:B.white,border:"none",borderRadius:4,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:(schedStartDt&&schedStatus!=='applying')?"pointer":"not-allowed",whiteSpace:"nowrap",alignSelf:"flex-end",transition:"background .2s"}}>
{schedStatus==='applying'?"⟳ SCHEDULING…":schedStatus==='done'?"✓ SCHEDULED":anyScheduled?"✓ SCHEDULED":`SCHEDULE ${unsentBatches.length} BATCH${unsentBatches.length!==1?"ES":""}`}
</button>
{anyScheduled&&(
<button onClick={clearSchedule}
style={{background:"none",color:B.muted,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,cursor:"pointer",whiteSpace:"nowrap",alignSelf:"flex-end"}}>
CLEAR
</button>
)}
</div>
<div style={{marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:anyScheduled?B.blue:B.muted}}>
{anyScheduled
?`✓ Queued across ${touchesQueued} touch${touchesQueued!==1?"es":""} · Mon–Fri 9am–5pm MT · batches past 5pm auto-shift to next 9am`
:`Set a start time (Mountain Time), delay${hasMoreTouches?", and days between touches":""}, then click SCHEDULE · batches wrap at 5pm MT`
}
</div>
</div>
);
})()}
{/* Pre-scheduled banner for future touches that have no contacts yet */}
{touchBatches.length===0&&noEmail.length===0&&touchSchedStarts[ti]&&(
<div style={{padding:"10px 14px",background:`${B.blue}06`,border:`1px solid ${B.blue}40`,borderRadius:5,display:"flex",alignItems:"center",gap:10}}>
<span style={{fontSize:16,flexShrink:0}}>⏱</span>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.5,marginBottom:2}}>PRE-SCHEDULED</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
Queued to start <strong>{fmtSchedDt(touchSchedStarts[ti])}</strong> — batches will be auto-stamped as contacts advance from the previous touch.
</div>
</div>
</div>
)}
{/* No email contacts only — nothing to send, show skip button */}
{touchBatches.length===0&&noEmail.length>0&&(
<div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:`${B.yellow}10`,border:`1px solid ${B.yellow}60`,borderRadius:5}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,flex:1}}>{noEmail.length} contact{noEmail.length!==1?"s":""} have no email address — they can't receive this touch.</span>
<button onClick={()=>sendOneBatch([],[],noEmail)} disabled={sending}
style={{background:B.surface,color:B.muted,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
SKIP &amp; ADVANCE
</button>
</div>
)}
{touchBatches.map((batch,bi)=>{
const isFirst=bi===0;
const expKey=`${ti}-${bi}`;
const isExp=batchExpanded[expKey]??(bi===0);
const batchKey=`${selCamp.id}-${ti}-${batch[0]?.contactId||bi}`;
const sentInfo=batchSentMap[batchKey];
const wasSent=!!(sentInfo&&sentInfo.sent>0);
const scheduledDt=batchSchedules[batchKey]?new Date(batchSchedules[batchKey]):null;
const totalFailed=!!(sentInfo&&sentInfo.sent===0&&sentInfo.failed>0&&!scheduledDt);
const wasSkipped=!!(sentInfo&&sentInfo.sent===0&&sentInfo.failed===0&&!scheduledDt);
const schedMs=scheduledDt?scheduledDt.getTime()-nowTick:null;
if(!wasSent) pendingSendFnsRef.current[batchKey]=()=>sendOneBatch(batch,batchKey,bi===0?noEmail:[],wasSkipped);
return(
<div key={batchKey} style={{border:`1px solid ${totalFailed?B.red:wasSkipped?B.orange:wasSent?B.green:scheduledDt?B.blue:isFirst?B.orange:B.border}`,borderRadius:5,overflow:"hidden"}}>
<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:totalFailed?`${B.red}06`:wasSkipped?`${B.orange}06`:wasSent?`${B.green}08`:scheduledDt?`${B.blue}06`:isFirst?`${B.orange}06`:B.white,flexWrap:"wrap"}}>
<div style={{flex:1,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:totalFailed?B.red:wasSkipped?B.orange:wasSent?B.green:scheduledDt?B.blue:isFirst?B.orange:B.muted,letterSpacing:.5}}>BATCH {bi+1}</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>{batch.length} contacts</span>
{wasSent&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:`${B.green}15`,padding:"2px 7px",borderRadius:3}}>✓ SENT {sentInfo.sent}{sentInfo.failed>0?` · ${sentInfo.failed} failed`:""}</span>}
{wasSkipped&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:`${B.orange}15`,padding:"2px 7px",borderRadius:3}}>⚠ SENT 0 — contacts skipped</span>}
{totalFailed&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:`${B.red}15`,padding:"2px 7px",borderRadius:3}}>✗ {sentInfo.failed} FAILED — rescheduled to next 9am MT</span>}
{scheduledDt&&!wasSent&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>⏱ {fmtSchedDt(scheduledDt)}{schedMs>0?` · ${fmtCountdown(schedMs)}`:" · firing…"}</span>}
<button onClick={()=>setBatchExpanded(x=>({...x,[expKey]:!isExp}))} style={{background:"none",border:"none",fontSize:10,color:B.muted,cursor:"pointer",padding:0}}>{isExp?"▲ hide":"▼ show"}</button>
</div>
{totalFailed&&(
<div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
<button onClick={()=>{
setBatchSentMap(m=>{const n={...m};delete n[batchKey];return n;});
const retryMs=nextMTBizStart(Date.now());
const retryIso=new Date(retryMs).toISOString();
setBatchSchedules(s=>({...s,[batchKey]:retryIso}));
const fc=campaignsRef.current.find(c=>c.id===selCamp.id)||selCamp;
const prevInfo2=fc.scheduledBatches?.[batchKey]||{};
const ns={...(fc.scheduledBatches||{}),[batchKey]:{...prevInfo2,scheduledAt:retryIso}};
const ns2={...(fc.sentBatches||{})};delete ns2[batchKey];
dispatch("UPDATE_CAMPAIGN",{...fc,scheduledBatches:ns,sentBatches:ns2});
}} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
↺ RETRY AT 9AM MT
</button>
<button onClick={()=>sendOneBatch(batch,batchKey,bi===0?noEmail:[])} disabled={sending}
style={{background:B.surface,color:B.text,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
▶ SEND NOW
</button>
</div>
)}
{wasSkipped&&(
<div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
<button onClick={()=>{
setBatchSentMap(m=>{const n={...m};delete n[batchKey];return n;});
const retryMs=nextMTBizStart(Date.now());
const retryIso=new Date(retryMs).toISOString();
setBatchSchedules(s=>({...s,[batchKey]:retryIso}));
const fc=campaignsRef.current.find(c=>c.id===selCamp.id)||selCamp;
const prevInfo2=fc.scheduledBatches?.[batchKey]||{touchIdx:ti,contactIds:batch.map(e=>e.contactId)};
const ns={...(fc.scheduledBatches||{}),[batchKey]:{...prevInfo2,scheduledAt:retryIso,forceResend:true}};
const ns2={...(fc.sentBatches||{})};delete ns2[batchKey];
dispatch("UPDATE_CAMPAIGN",{...fc,scheduledBatches:ns,sentBatches:ns2});
const _uc=(campaignsRef.current||[]).map(c=>c.id===selCamp.id?{...c,scheduledBatches:ns,sentBatches:ns2}:c);
const{currentUserId:_cid,contacts:_cc,agentHistory:_ah,..._ts}={...s,campaigns:_uc};
fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:_ts})}).catch(()=>{});
}} style={{background:B.orange,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
↺ RESEND AT 9AM MT
</button>
<button onClick={()=>{
setBatchSentMap(m=>{const n={...m};delete n[batchKey];return n;});
const fc=campaignsRef.current.find(c=>c.id===selCamp.id)||selCamp;
const ns2={...(fc.sentBatches||{})};delete ns2[batchKey];
dispatch("UPDATE_CAMPAIGN",{...fc,sentBatches:ns2});
sendOneBatch(batch,batchKey,bi===0?noEmail:[],true);
}} disabled={sending}
style={{background:B.surface,color:B.text,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
▶ RESEND NOW
</button>
</div>
)}
{!wasSent&&!totalFailed&&!wasSkipped&&(
<div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center",flexWrap:"wrap"}}>
<button onClick={()=>sendOneBatch(batch,batchKey,bi===0?noEmail:[])} disabled={sending}
style={{background:sending?B.muted:isFirst?B.orange:B.surface,color:sending?B.white:isFirst?B.white:B.text,border:`1px solid ${isFirst?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
{sending&&isFirst?"SENDING...":"▶ SEND ("+batch.length+")"}
</button>
<button onClick={()=>markBatchSent(batch,batchKey)} disabled={sending}
title="Mark as already sent — advances contacts without sending emails"
style={{background:B.surface,color:B.green,border:`1px solid ${B.green}50`,borderRadius:4,padding:"6px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,cursor:sending?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
✓ MARK SENT
</button>
{/* Per-batch datetime schedule picker */}
<div style={{display:"flex",alignItems:"center",gap:3,background:B.surface,border:`1px solid ${scheduledDt?B.blue:B.border}`,borderRadius:4,padding:"3px 8px"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:scheduledDt?B.blue:B.muted,letterSpacing:.5}}>SCHED</span>
<input type="datetime-local" value={scheduledDt?dtLocalStr(scheduledDt):""} min={dtLocalStr(Date.now())}
onChange={e=>{
if(!e.target.value){setBatchSchedules(s=>{const n={...s};delete n[batchKey];return n;});return;}
setBatchSchedules(s=>({...s,[batchKey]:new Date(e.target.value).toISOString()}));
}}
style={{background:"transparent",border:"none",color:scheduledDt?B.blue:B.muted,fontSize:10,fontFamily:"'Lexend',sans-serif",outline:"none",cursor:"pointer",width:scheduledDt?130:100}}/>
{scheduledDt&&<button onClick={()=>setBatchSchedules(s=>{const n={...s};delete n[batchKey];return n;})} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>×</button>}
</div>
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
const matchingContacts=(s.contacts||[]).filter(c=>{
if(enrolledIds.has(c.id)) return false;
if(!q) return true;
return [c.fullName,c.firstName,c.lastName,c.title,c.school,c.email,c.state,c.city].some(v=>(v||"").toLowerCase().includes(q));
});
const enrollList=enrollListId?(s.contactLists||[]).find(l=>l.id===enrollListId):null;
const listContacts=enrollList?(enrollList.contactIds||[]).map(id=>(s.contacts||[]).find(c=>c.id===id)).filter(Boolean).filter(c=>!enrolledIds.has(c.id)):[];
const toEnroll=enrollListId?listContacts:matchingContacts;
const doEnroll=()=>{
if(!toEnroll.length){toast("No contacts to enroll","warn");return;}
const todayStr=today();
const updated={...selCamp,enrollments:[...(selCamp.enrollments||[])]};
let count=0; let noEmail=0;
toEnroll.forEach(c=>{
if(!updated.enrollments.some(e=>e.contactId===c.id)){
updated.enrollments=[...updated.enrollments,{contactId:c.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr,sentSteps:[]}];
dispatch("SCORE_CONTACT",{contactId:c.id,type:"enrolled",campaignId:selCamp.id,note:`Enrolled in ${selCamp.name}`});
count++;
if(!c.email) noEmail++;
}
});
dispatch("UPDATE_CAMPAIGN",updated);
const already=toEnroll.length-count;
const alreadyNote=already>0?` · ${already} were already enrolled`:"";
const noEmailNote=noEmail>0?` · ${noEmail} have no email (add emails to reach them)`:"";
toast(`✓ ${count} contact${count!==1?"s":""} enrolled in ${selCamp.name}${alreadyNote}${noEmailNote}`,"success");
setEnrollSearch(""); setEnrollListId("");
setExecuteFilter("all");
};
const doQuickAdd=()=>{
const email=(quickAddEmail||"").trim().toLowerCase();
if(!email||!email.includes("@")){toast("Enter a valid email address","warn");return;}
const todayStr=today();
const updated={...selCamp,enrollments:[...(selCamp.enrollments||[])]};
let contact=(s.contacts||[]).find(c=>(c.email||"").toLowerCase()===email);
let isNew=false;
if(!contact){
contact={id:mkId(),firstName:"",lastName:"",fullName:email,email,phone:"",title:"",school:"",state:"",sport:"",orgType:"school",priority:"medium",confidence:"medium",source:"manual",importedAt:Date.now()};
dispatch("ADD_CONTACTS",[contact]);
isNew=true;
}
if(updated.enrollments.some(e=>e.contactId===contact.id)){
toast(`${email} is already enrolled in this campaign`,"warn");
setQuickAddEmail(""); return;
}
updated.enrollments=[...updated.enrollments,{contactId:contact.id,step:0,status:"active",enrolledAt:todayStr,nextDate:todayStr,sentSteps:[]}];
dispatch("SCORE_CONTACT",{contactId:contact.id,type:"enrolled",campaignId:selCamp.id,note:`Enrolled in ${selCamp.name}`});
dispatch("UPDATE_CAMPAIGN",updated);
toast(`${isNew?"New contact created and enrolled":"Contact enrolled"}: ${email}`,"success");
setQuickAddEmail("");
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
{(s.contactLists||[]).map(l=>{
const total=(l.contactIds||[]).length;
const alreadyIn=(l.contactIds||[]).filter(id=>enrolledIds.has(id)).length;
const newCount=total-alreadyIn;
return <option key={l.id} value={l.id}>{l.name} — {newCount} new{alreadyIn>0?`, ${alreadyIn} already enrolled`:""}</option>;
})}
</select>
</div>
<div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
<input value={quickAddEmail} onChange={e=>setQuickAddEmail(e.target.value)}
onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();doQuickAdd();}}}
placeholder="Or type an email and press Enter to add & enroll…"
style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn sm onClick={doQuickAdd} disabled={!quickAddEmail.trim()}>ADD</OBtn>
</div>
{(q||enrollListId)&&(
<div style={{marginBottom:10}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{toEnroll.length} contact{toEnroll.length!==1?"s":""} match{toEnroll.length===1?"es":""} · not yet enrolled</div>
{toEnroll.slice(0,6).map(c=>(
<div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
<div style={{flex:1}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{c.fullName||`${c.firstName||""} ${c.lastName||""}`.trim()}</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginLeft:8}}>{typeof c.title==="string"?c.title:c.title?.name||""}{c.school?` · ${typeof c.school==="string"?c.school:c.school?.name||""}`:""}{c.state?` · ${c.state}`:""}</span>
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
<div style={{marginBottom:10}}>
<Lbl s={{marginBottom:4}}>Image (optional)</Lbl>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<input value={typeof postDraft.imageUrl==="string"&&!postDraft.imageUrl.startsWith("data:")?postDraft.imageUrl:""} onChange={e=>setPostDraft(d=>({...d,imageUrl:e.target.value}))} placeholder="https://... or upload →" style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
<label style={{background:B.surface,color:B.text,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
📎 UPLOAD
<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setPostDraft(d=>({...d,imageUrl:ev.target.result}));r.readAsDataURL(f);}}/>
</label>
</div>
{postDraft.imageUrl&&<div style={{marginTop:6,position:"relative",display:"inline-block"}}><img src={postDraft.imageUrl} alt="" style={{maxHeight:80,borderRadius:4,border:`1px solid ${B.border}`}}/><button onClick={()=>setPostDraft(d=>({...d,imageUrl:""}))} style={{position:"absolute",top:2,right:2,background:"rgba(0,0,0,.6)",color:"#fff",border:"none",borderRadius:3,padding:"1px 5px",fontSize:9,cursor:"pointer"}}>✕</button></div>}
</div>
<div style={{marginBottom:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
<div><Lbl s={{marginBottom:4}}>Schedule Date</Lbl><input type="date" value={postDraft.date} min={new Date().toISOString().slice(0,10)} onChange={e=>setPostDraft(d=>({...d,date:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
<div><Lbl s={{marginBottom:4}}>Time</Lbl><input type="time" value={postDraft.time||"09:00"} onChange={e=>setPostDraft(d=>({...d,time:e.target.value}))} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12}}/></div>
</div>
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
function SendStatusPanel(){
const [status,setStatus]=useState(null);
const [loading,setLoading]=useState(true);
const [toggling,setToggling]=useState(false);
const [expandedBatch,setExpandedBatch]=useState(null);
useEffect(()=>{
fetch("/api/cron/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status"})})
.then(r=>r.json()).then(d=>{setStatus(d);setLoading(false);}).catch(()=>setLoading(false));
},[]);
const toggle=async()=>{
if(!status||toggling)return;
setToggling(true);
const action=status.globalPause?"resume":"pause";
try{
const r=await fetch("/api/cron/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});
const d=await r.json();
if(d.ok)setStatus(s=>({...s,globalPause:d.globalPause}));
}catch(e){}
setToggling(false);
};
const fmtTime=iso=>{if(!iso)return"—";const d=new Date(iso);return d.toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true});};
const fmtTimeOnly=iso=>{if(!iso)return"—";const d=new Date(iso);return d.toLocaleString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true});};
const totalQueued=(status?.queue||[]).reduce((s,c)=>s+(c.batches||[]).length,0);
if(loading)return<div style={{padding:40,textAlign:"center",color:B.muted,fontFamily:"'Lexend',sans-serif",fontSize:13}}>Loading send status…</div>;
if(!status?.ok)return<div style={{padding:40,textAlign:"center",color:B.orange,fontFamily:"'Lexend',sans-serif",fontSize:13}}>Could not load send status — check that /api/cron/status is deployed.</div>;
const paused=status.globalPause===true;
return(
<div style={{maxWidth:860}}>
{/* Kill switch card */}
<div className="card" style={{padding:22,marginBottom:18,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,borderLeft:`5px solid ${paused?"#ef4444":"#22c55e"}`}}>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:paused?"#ef4444":"#22c55e",marginBottom:4}}>{paused?"⏸ EMAIL SENDING PAUSED":"▶ EMAIL SENDING ACTIVE"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{paused?"All batch sends are halted. Click RESUME to restart the cron sender.":"Emails are sending normally. Click PAUSE to stop all cron sends immediately."}</div>
</div>
<button onClick={toggle} disabled={toggling} style={{background:paused?"#22c55e":"#ef4444",color:"#fff",border:"none",borderRadius:6,padding:"10px 24px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:11,fontWeight:700,letterSpacing:.8,cursor:toggling?"not-allowed":"pointer",opacity:toggling?.6:1,minWidth:110}}>
{toggling?"…":paused?"RESUME":"PAUSE"}
</button>
</div>
{/* Stat row */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
{[["Emails Today",(status.todaySent||0).toString()],["Active Campaigns",(status.activeCampaigns||0).toString()],["Batches Queued",totalQueued.toString()],["Enrolled",(status.enrollSummary?.total||0).toString()]].map(([label,val])=>(
<div key={label} className="card" style={{padding:"14px 16px",textAlign:"center"}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.orange,marginBottom:3}}>{val}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.8}}>{label}</div>
</div>
))}
</div>
{/* Last cron run */}
{status.lastCronRun?(
<div className="card" style={{padding:18,marginBottom:18}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.8,marginBottom:10}}>LAST CRON RUN</div>
<div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:14}}>
{[["Timestamp",fmtTime(status.lastCronRun.timestamp)],["Emails Sent",(status.lastCronRun.emailsSent||0).toString()],["Batches Fired",(status.lastCronRun.batchesFired||0).toString()],["Stopped Reason",status.lastCronRun.stoppedReason||"—"],["Off Hours",status.lastCronRun.offHours?"Yes":"No"]].map(([k,v])=>(
<div key={k}><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:2}}>{k}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.black}}>{v}</div></div>
))}
</div>
{(status.lastCronRun.batches||[]).length>0&&(
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:8}}>BATCHES SENT THIS RUN</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
<thead>
<tr style={{borderBottom:`1px solid ${B.border}`}}>
{["Campaign","Touch","Batch Size","Sent","Failed","Time"].map(h=>(
<th key={h} style={{textAlign:"left",padding:"5px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,fontWeight:700}}>{h}</th>
))}
<th style={{width:24}}></th>
</tr>
</thead>
<tbody>
{(status.lastCronRun.batches||[]).map((b,i)=>{
const isExpanded=expandedBatch===i;
const firstSendAt=b.sends&&b.sends.length>0?fmtTime(b.sends[0].sentAt):fmtTime(status.lastCronRun.timestamp);
return(
<React.Fragment key={i}>
<tr style={{borderBottom:`1px solid ${B.border}`,background:isExpanded?"#f9f9f9":"transparent",cursor:(b.sends||[]).length>0?"pointer":"default"}} onClick={()=>{if((b.sends||[]).length>0)setExpandedBatch(isExpanded?null:i);}}>
<td style={{padding:"7px 8px",color:B.black}}>{b.campaign}</td>
<td style={{padding:"7px 8px",color:B.muted}}>Touch {(b.touchIdx||0)+1}</td>
<td style={{padding:"7px 8px",color:B.muted}}>{b.batchSize}</td>
<td style={{padding:"7px 8px",color:"#22c55e",fontWeight:700}}>{b.sent}</td>
<td style={{padding:"7px 8px",color:b.failed>0?"#ef4444":B.muted}}>{b.failed}</td>
<td style={{padding:"7px 8px",color:B.muted,whiteSpace:"nowrap"}}>{firstSendAt}</td>
<td style={{padding:"7px 8px",color:B.muted,textAlign:"center"}}>{(b.sends||[]).length>0?(isExpanded?"▲":"▼"):""}</td>
</tr>
{isExpanded&&(b.sends||[]).length>0&&(
<tr key={`${i}-sends`}>
<td colSpan={7} style={{padding:"0 8px 10px 24px"}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,margin:"8px 0 6px"}}>INDIVIDUAL SENDS</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
<thead>
<tr>
<th style={{textAlign:"left",padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.4,fontWeight:700}}>#</th>
<th style={{textAlign:"left",padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.4,fontWeight:700}}>Email</th>
<th style={{textAlign:"left",padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.4,fontWeight:700}}>Sent At (MT)</th>
<th style={{textAlign:"left",padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.4,fontWeight:700}}>Gap from prev</th>
</tr>
</thead>
<tbody>
{b.sends.map((send,si)=>{
const prev=si>0?new Date(b.sends[si-1].sentAt):null;
const cur=new Date(send.sentAt);
const gapSec=prev?Math.round((cur-prev)/1000):null;
const gapStr=gapSec===null?"—":gapSec<60?`${gapSec}s`:`${Math.floor(gapSec/60)}m ${gapSec%60}s`;
return(
<tr key={si} style={{borderTop:`1px solid ${B.border}`}}>
<td style={{padding:"4px 8px",color:B.muted}}>{si+1}</td>
<td style={{padding:"4px 8px",color:B.black}}>{send.email}</td>
<td style={{padding:"4px 8px",color:B.muted,whiteSpace:"nowrap"}}>{fmtTimeOnly(send.sentAt)}</td>
<td style={{padding:"4px 8px",color:gapSec!==null&&gapSec<25?"#ef4444":B.muted,fontWeight:gapSec!==null&&gapSec<25?700:400}}>{gapStr}</td>
</tr>
);
})}
</tbody>
</table>
</td>
</tr>
)}
</React.Fragment>
);
})}
</tbody>
</table>
</div>
)}
</div>
):(
<div className="card" style={{padding:22,marginBottom:18,textAlign:"center",color:B.muted,fontFamily:"'Lexend',sans-serif",fontSize:12}}>No cron runs recorded yet. The scheduler fires every 15 minutes on weekdays 9am–5pm MT.</div>
)}
{/* Pending queue */}
{(status.queue||[]).length>0&&(
<div className="card" style={{padding:18}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.8,marginBottom:10}}>PENDING QUEUE</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>
<thead>
<tr style={{borderBottom:`1px solid ${B.border}`}}>
{["Campaign","Touch","Contacts","Scheduled For","Status"].map(h=>(
<th key={h} style={{textAlign:"left",padding:"5px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,fontWeight:700}}>{h}</th>
))}
</tr>
</thead>
<tbody>
{(status.queue||[]).flatMap(camp=>(camp.batches||[]).map((b,bi)=>(
<tr key={`${camp.campaignId}-${bi}`} style={{borderBottom:`1px solid ${B.border}`}}>
<td style={{padding:"7px 8px",color:B.black}}>{camp.campaignName}</td>
<td style={{padding:"7px 8px",color:B.muted}}>Touch {(b.touchIdx||0)+1}</td>
<td style={{padding:"7px 8px",color:B.muted}}>{b.contactCount}</td>
<td style={{padding:"7px 8px",color:B.muted,whiteSpace:"nowrap"}}>{fmtTime(b.scheduledAt)}</td>
<td style={{padding:"7px 8px"}}>{b.overdue?<span style={{background:"#fef3c7",color:"#b45309",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.4,padding:"2px 7px",borderRadius:4}}>OVERDUE</span>:<span style={{color:"#22c55e",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:.4}}>SCHEDULED</span>}</td>
</tr>
)))}
</tbody>
</table>
</div>
)}
{(status.queue||[]).length===0&&(
<div className="card" style={{padding:22,textAlign:"center",color:B.muted,fontFamily:"'Lexend',sans-serif",fontSize:12}}>No batches currently queued.</div>
)}
</div>
);
}
// Must match api/social-post.js's platformMap keys — those are the only
// platforms Publer can actually receive a post for.
const SOCIAL_PLATFORMS = ["facebook","instagram","linkedin","twitter","tiktok"];
const PLATFORM_COLORS = { facebook:"#1877F2", instagram:"#E4405F", linkedin:"#0A66C2", twitter:"#1DA1F2", tiktok:"#000000" };
const PLATFORM_LIMITS = { facebook:63206, instagram:2200, linkedin:3000, twitter:280, tiktok:2200 };
function ModSocial() {
const {s,dispatch,toast}=useApp();
const [tab,setTab]=useState("posts");
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
const [postLength,setPostLength]=useState("medium");
const [tone,setTone]=useState("Professional");
const [topic,setTopic]=useState("");
const [product,setProduct]=useState("");
const [platformVariants,setPlatformVariants]=useState(null);
const [imgUseCase,setImgUseCase]=useState("Social Post");
const [imgMood,setImgMood]=useState("Clean");
const [imgColors,setImgColors]=useState("");
const [imgGenerating,setImgGenerating]=useState(false);
const [imgPrompt,setImgPrompt]=useState("");
const [imgError,setImgError]=useState(null);
const [showImgGen,setShowImgGen]=useState(false);
const [filterStatus,setFilterStatus]=useState("all");
const [filterPlatform,setFilterPlatform]=useState("all");
const [editingPost,setEditingPost]=useState(null);
const [syncingStats,setSyncingStats]=useState(false);
const campaigns=s.campaigns||[];
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
const TONE_GUIDE={Hype:"Energetic, exciting, exclamation points, pump-up energy.",Professional:"Professional but engaging, credible, clear value.",Educational:"Informative, adds value, teaches something useful."};
const generateCaption=async()=>{
setGenRunning(true);
const hardLimit=platforms.length?Math.min(...platforms.map(p=>PLATFORM_LIMITS[p]||3000)):3000;
const lengthTargets={short:{words:30,chars:200},medium:{words:80,chars:500},long:{words:180,chars:1200}};
const target=lengthTargets[postLength];
const effectiveChars=Math.min(target.chars,hardLimit);
const platformNote=hardLimit<500?` IMPORTANT: ${platforms.find(p=>PLATFORM_LIMITS[p]===hardLimit)} has a ${hardLimit}-character limit — stay well under it.`:"";
const lengthGuide=`around ${target.words} words / ${effectiveChars} characters max${platformNote}`;
const direction=caption.trim();
const topicCtx=topic.trim()?`Topic: ${topic.trim()}.`:"";
const productCtx=product.trim()?`Product: ${product.trim()}.`:"";
const strict=`\n\nRETURN ONLY THE FINISHED POST TEXT. No explanations, no bullet points, no character counts. Just the post.`;
const prompt=direction
?`Rewrite and improve this social media post for ST1 Sports (athletic equipment company). ${ST1}\n${topicCtx} ${productCtx}\nKeep the same core message.\nPlatforms: ${platforms.join(", ")||"general social"}.\nTone: ${tone} — ${TONE_GUIDE[tone]}\nLength: ${lengthGuide}.${strict}\n\nDraft to improve:\n${direction}`
:`Write a social media post for ST1 Sports (athletic equipment company). ${ST1}\n${topicCtx} ${productCtx}\nPlatforms: ${platforms.join(", ")||"general social"}.\nTone: ${tone} — ${TONE_GUIDE[tone]}\nLength: ${lengthGuide}.${strict}`;
const r=await aiCall(prompt,{tokens:postLength==="long"?500:postLength==="medium"?300:150});
if(r) setCaption(r);
setGenRunning(false);
};
const generatePerPlatform=async()=>{
if(!platforms.length) return;
setGenRunning(true); setPlatformVariants(null);
const topicCtx=topic.trim()||caption.trim()||"ST1 Sports athletic equipment";
const productCtx=product.trim()?`Product: ${product.trim()}.`:"";
const task=`Write optimized social media posts for ${platforms.join(", ")} about: ${topicCtx}. ${productCtx} ST1 Sports athletic equipment brand. Tone: ${tone} — ${TONE_GUIDE[tone]} Include platform-appropriate hashtags (5–10 per platform). Return JSON only: {${platforms.map(p=>`"${p.toLowerCase()}":{"caption":"...","hashtags":["#..."]}`).join(",")}}`;
const r=await aiCall(task,{tokens:900});
if(r){
try{const m=r.match(/\{[\s\S]*\}/);if(m)setPlatformVariants(JSON.parse(m[0]));}catch{}
}
setGenRunning(false);
};
const generateAiImage=async()=>{
setImgGenerating(true); setImgError(null); setImgPrompt("");
const MOOD_STYLE={Bold:"DESIGN",Clean:"REALISTIC",Energetic:"REALISTIC"};
const CASE_SIZE={"Social Post":"square","Product Promo":"square","Email Banner":"landscape","Event Flyer":"story"};
try{
const featured=product.trim()||topic.trim()||"ST1 Sports athletic equipment";
const builtPrompt=await aiCall(`Create an image generation prompt for a "${imgUseCase}" for ST1 Sports athletic equipment brand. Featured: ${featured}. Visual mood: ${imgMood}. Brand colors: orange (#F37321) and black.${imgColors.trim()?` Additional colors: ${imgColors.trim()}.`:""} Athletic sports marketing. Professional commercial quality. Return ONLY the image prompt — no preamble.`,{tokens:200});
if(!builtPrompt) throw new Error("AI prompt generation failed");
setImgPrompt(builtPrompt);
const imgRes=await fetch("/api/adengine/generate-product-image",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({prompt:builtPrompt,style:MOOD_STYLE[imgMood]||"REALISTIC",sizeKey:CASE_SIZE[imgUseCase]||"square"})});
const imgData=await imgRes.json();
if(!imgRes.ok) throw new Error(imgData.error||`Image API error ${imgRes.status}`);
setImageUrl(imgData.imageUrl);
}catch(e){setImgError(e.message);}
setImgGenerating(false);
};
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
const tzOff=new Date().getTimezoneOffset();
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
{[["posts","📋 ALL POSTS"],["new","✦ NEW POST"]].map(([id,l])=>(
<button key={id} onClick={()=>setTab(id)} style={{background:tab===id?B.orange:B.white,color:tab===id?B.white:B.muted,border:`1px solid ${tab===id?B.orange:B.border}`,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4,cursor:"pointer"}}>{l}</button>
))}
</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
{scheduledCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,background:B.blueBg,padding:"3px 9px",borderRadius:3}}>{scheduledCount} SCHEDULED</span>}
<OBtn sm onClick={()=>setTab("new")}>+ NEW POST</OBtn>
</div>
</div>
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
{/* Tone */}
<div style={{marginBottom:16}}>
<Lbl s={{marginBottom:7}}>TONE</Lbl>
<div style={{display:"flex",gap:6}}>
{["Hype","Professional","Educational"].map(t=>(
<button key={t} onClick={()=>setTone(t)} style={{background:tone===t?`${B.orange}14`:B.surface,color:tone===t?B.orange:B.muted,border:`1px solid ${tone===t?B.orange:B.border}`,borderRadius:3,padding:"5px 14px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{t}</button>
))}
</div>
</div>
{/* Topic + Product (help AI write better) */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
<div>
<Lbl s={{marginBottom:5}}>TOPIC (helps AI write)</Lbl>
<input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="New track gear, baseball season…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<div>
<Lbl s={{marginBottom:5}}>PRODUCT (optional)</Lbl>
<input value={product} onChange={e=>setProduct(e.target.value)} placeholder="Blazer blocks, Gill discus…" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}/>
</div>
</div>
{/* Caption */}
<div style={{marginBottom:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
<Lbl>CAPTION</Lbl>
<div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
{["short","medium","long"].map(l=>(
<button key={l} onClick={()=>setPostLength(l)} style={{background:postLength===l?`${B.purple}18`:B.surface,color:postLength===l?B.purple:B.muted,border:`1px solid ${postLength===l?B.purple:B.border}`,borderRadius:3,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{l.toUpperCase()}</button>
))}
<button onClick={generateCaption} disabled={genRunning} style={{background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",opacity:genRunning?0.7:1}}>
{genRunning?"✦ WRITING…":"✦ AI WRITE"}
</button>
<button onClick={generatePerPlatform} disabled={genRunning||!platforms.length} style={{background:"transparent",color:B.blue,border:`1px solid ${B.blue}`,borderRadius:4,padding:"5px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",opacity:(genRunning||!platforms.length)?0.5:1}} title="Generate separate captions per platform">
PER PLATFORM
</button>
</div>
</div>
<textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={5} placeholder="Write your caption… or let AI draft it" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:12,fontFamily:"'Lexend',sans-serif",resize:"vertical",lineHeight:1.6}}/>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:3,textAlign:"right"}}>{caption.length} chars</div>
{/* Per-platform variants */}
{platformVariants&&(
<div style={{marginTop:10}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1.5,marginBottom:7}}>PER-PLATFORM VARIANTS — click USE THIS to load into caption</div>
<div style={{display:"flex",flexDirection:"column",gap:7}}>
{platforms.map(pl=>{
const key=pl.toLowerCase();
const data=platformVariants[key];
if(!data) return null;
const col=PLATFORM_COLORS[pl]||B.blue;
const tags=Array.isArray(data.hashtags)?data.hashtags:[];
const full=data.caption+(tags.length?"\n\n"+tags.join(" "):"");
return(
<div key={pl} style={{background:B.surface,borderRadius:5,border:`1px solid ${B.border}`,borderLeft:`3px solid ${col}`,padding:"9px 11px"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:col,letterSpacing:1.5}}>{pl.toUpperCase()}</span>
<div style={{display:"flex",gap:5}}>
<button onClick={()=>navigator.clipboard?.writeText(full)} style={{background:B.white,border:`1px solid ${B.border}`,color:B.muted,borderRadius:3,padding:"2px 8px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>COPY</button>
<button onClick={()=>setCaption(full)} style={{background:col,color:"#fff",border:"none",borderRadius:3,padding:"2px 8px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>USE THIS ↑</button>
</div>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.7,marginBottom:tags.length?6:0}}>{data.caption}</div>
{tags.length>0&&(
<div style={{display:"flex",flexWrap:"wrap",gap:3}}>
{tags.map((tag,i)=><span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:col,background:`${col}12`,border:`1px solid ${col}30`,borderRadius:3,padding:"1px 6px"}}>{tag}</span>)}
</div>
)}
</div>
);
})}
</div>
</div>
)}
</div>
{/* Image — with AI generator panel */}
<div style={{marginBottom:14}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<Lbl>IMAGE (optional)</Lbl>
<button onClick={()=>setShowImgGen(v=>!v)} style={{background:showImgGen?`${B.orange}14`:"transparent",color:B.orange,border:`1px solid ${B.orange}`,borderRadius:4,padding:"3px 10px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:"pointer"}}>
{showImgGen?"HIDE GENERATOR":"⚡ AI GENERATE"}
</button>
</div>
{showImgGen&&(
<div style={{background:B.surface,borderRadius:6,border:`1px solid ${B.border}`,padding:14,marginBottom:12}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:10}}>AI IMAGE GENERATOR — uses topic + product above</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
<div>
<Lbl s={{marginBottom:4}}>USE CASE</Lbl>
<select value={imgUseCase} onChange={e=>setImgUseCase(e.target.value)} style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11}}>
{["Social Post","Product Promo","Email Banner","Event Flyer"].map(u=><option key={u}>{u}</option>)}
</select>
</div>
<div>
<Lbl s={{marginBottom:4}}>MOOD</Lbl>
<div style={{display:"flex",gap:5}}>
{["Bold","Clean","Energetic"].map(m=>(
<button key={m} onClick={()=>setImgMood(m)} style={{background:imgMood===m?`${B.orange}14`:B.white,color:imgMood===m?B.orange:B.muted,border:`1px solid ${imgMood===m?B.orange:B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>{m}</button>
))}
</div>
</div>
</div>
<div style={{marginBottom:10}}>
<Lbl s={{marginBottom:4}}>ACCENT COLORS (optional)</Lbl>
<input value={imgColors} onChange={e=>setImgColors(e.target.value)} placeholder="navy blue, gold, white…" style={{width:"100%",background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 9px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
<button onClick={generateAiImage} disabled={imgGenerating} style={{background:imgGenerating?B.border:B.orange,color:"#fff",border:"none",borderRadius:4,padding:"7px 16px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:imgGenerating?"default":"pointer"}}>
{imgGenerating?"GENERATING IMAGE…":"GENERATE IMAGE →"}
</button>
{imgError&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.red,marginTop:7}}>{imgError}</div>}
{imgPrompt&&imgGenerating&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:7,lineHeight:1.5}}>{imgPrompt}</div>}
{imageUrl&&!imgGenerating&&(
<div style={{marginTop:10}}>
<img src={imageUrl} alt="Generated" style={{width:"100%",borderRadius:6,display:"block",marginBottom:6}}/>
<button onClick={()=>{const a=document.createElement("a");a.href=imageUrl;a.download=`st1-social-${Date.now()}.jpg`;a.click();}} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"4px 10px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>↓ DOWNLOAD</button>
</div>
)}
</div>
)}
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
const COMPETE_SEED={
intel:{
"Dick's Sporting Goods":`OVERVIEW: $14.1B revenue, 850+ stores nationwide (NYSE: DKS). Largest US sporting goods retailer. Founded 1948, Coraopolis PA.\n\nTARGET MARKET: Active families (25–50yo, HHI $100k+), youth sports orgs, schools, clubs.\n\nPOSITIONING: "Every Season Starts at DICK'S" — Experiential lifestyle hub moving from retailer to community destination via House of Sport and GameChanger ecosystem.\n\nSTRENGTHS:\n• Unmatched physical footprint — 850+ stores nationwide\n• GameChanger app = direct pipeline to 6.5M+ youth team users\n• House of Sport experiential retail (batting cages, climbing walls, simulators)\n• ScoreCard loyalty in 70% of transactions\n• Deep brand portfolio: Nike, Under Armour, Adidas, DeMarini, Rawlings, Wilson\n• 40 new House of Sport + 60 Field House locations planned by 2028\n• PROLOOK custom uniforms (~2-week turnaround)\n\nWEAKNESSES:\n• Trustpilot/Yelp avg 1.7–2.6 stars — poor customer service, unhelpful staff\n• Strict no-retroactive price adjustment policy frustrates customers\n• Big box impersonal feel — not relationship-based\n• Coaches routed to call centers, not dedicated program reps\n• PROLOOK custom uniform partnership still maturing\n\nPRICING: Competitive retail with Best Price Guarantee (matches Amazon/Walmart/Nike). Private labels for budget tier.\n\nSALES MODEL: Hybrid — retail stores, e-commerce, dedicated Team Sales Reps, Team Sports HQ self-serve platform.\n\nAD INTELLIGENCE (April 2026): ~780 active Meta ads — highest volume in competitive set. Heavy video (reels) + static product shots. Vibrant brand colors, punchy urgency copy ("before they're sold out"). Celebrity/influencer-driven, aspirational Gen Z energy. "The Scouts Are Out" cinematic campaign (Jordan Brand/Wieden+Kennedy). ST1 OPPORTUNITY: Dick's is so big it has lost all human warmth — zero 'real person who knows your kid' energy.`,
"gearUP":`OVERVIEW: Hillsboro OR. Regional growing national. Nike & Under Armour authorized youth team dealer.\n\nTARGET MARKET: Youth club sports, travel teams, K-12 schools, leagues.\n\nPOSITIONING: "Remove every time-wasting hurdle to getting the best uniforms" — Premium uniform and apparel experience without administrative headache.\n\nSTRENGTHS:\n• Nike Team Dealer authorization — rare national credential\n• 24/7 always-open stores with direct-to-athlete shipping\n• Premium brand access: Nike, Under Armour, Momentec, Carhartt\n• ArmourFuse sublimation via Under Armour\n• Direct shipping removes coach logistics burden\n\nWEAKNESSES:\n• Serious BBB and Yelp CS complaints — inaccurate sizing, poor communication\n• Hard to reach support when issues arise — multiple documented complaint threads\n• Limited equipment depth — primarily apparel and uniform focused\n• Regional roots limit national credibility and service coverage\n\nPRICING: Premium positioning, quote-based.\n\nSALES MODEL: Hybrid — dedicated sales team + self-serve 24/7 store platform.`,
"Anthem Sports":`OVERVIEW: Founded 2002, Pawcatuck CT. Family-owned (Mark Ferrara). National online distributor. Wilson 2018 Dealer of the Year (NE). Newsweek Top 4 online retailer.\n\nTARGET MARKET: Coaches, Athletic Directors, schools, youth leagues, clubs, municipalities, rec teams.\n\nPOSITIONING: "Building Champions™ — Brand names you trust. The value you expect." Best customer service in industry, same-day shipping, budget-friendly.\n\nSTRENGTHS:\n• Exceptional CS — 4.8/5 on Trustpilot with 4,000+ reviews\n• Same-day shipping on in-stock items placed by 2pm EST\n• Deep equipment catalog including hard-to-find institutional equipment\n• Accepts school POs — critical for institutional purchasing\n• Wilson-authorized dealer with 20+ top-brand relationships\n• 10% coach/AD discount on orders $100+\n\nWEAKNESSES:\n• Limited custom apparel depth — mostly branded accessories, not uniforms\n• Items damaged in transit with limited recourse\n• Not a full uniform/custom gear provider — can't outfit a team head to toe\n• No exclusive product lines\n\nPRICING: Retail + quantity discounts; 10% coach/AD discount; accepts school/municipal POs.\n\nSALES MODEL: Hybrid — self-serve e-commerce + Team Sales department for bulk/custom quotes.\n\nAD INTELLIGENCE (April 2026): ~110 active Meta ads — most active advertiser per-volume in category. Almost entirely white-background product shots (benches, bleachers, bases, fencing, gloves). No lifestyle, no athletes, no energy — pure B2B equipment catalog. A/B testing taglines: "Building Champions" / "Trusted Brands" / "Top Brands" / "Free Returns". ST1 OPPORTUNITY: Anthem is invisible as a brand — 110 ads running and you still wouldn't recognize their brand.`,
"BSN Sports":`OVERVIEW: Founded 1972, Dallas TX. Subsidiary of Varsity Brands (KKR-backed private equity). ~$1B+ revenue. 3,000+ sales reps. Largest team sports dealer in the US, 38+ states.\n\nTARGET MARKET: K-12 athletic departments, coaches, ADs, league directors, youth clubs.\n\nPOSITIONING: "Be Seen. Be Heard. Belong." America's #1 team sports dealer — unmatched rep network, broadest catalog, deepest institutional relationships.\n\nSTRENGTHS:\n• Largest team sports dealer network in the US — 3,000+ sales reps\n• Broadest catalog: all sports, all categories, all price points\n• Deep institutional relationships with K-12 ADs across the country\n• Full-service capability: equipment + apparel + team stores\n• Varsity Brands ecosystem (Varsity Spirit + Herff Jones) amplifies reach\n• My Team Shop+ dashboard, Sideline Stores, SPRINT rapid fulfillment (1–2 day)\n• Club Direct division launched 2025 targeting youth clubs\n• Fundraising via Snap! Raise partnership\n\nWEAKNESSES:\n• Shipping delays of 5+ weeks — consistent complaint, uniforms arriving after season\n• Customer service rated poor: unresponsive reps, hard to escalate\n• BSN-branded apparel runs significantly smaller than standard US sizing\n• Custom items classified as non-returnable even when BSN fulfills incorrectly\n• Extremely high rep turnover — coaches lose dedicated contacts repeatedly\n• Large bureaucratic structure — schools feel like accounts, not relationships\n• KKR private equity ownership drives margin pressure and service cuts\n• Antitrust/legal issues at Varsity Brands parent level create reputational drag\n\nPRICING: Quote-based, volume-driven institutional pricing. School PO accepted. Annual contracts with ADs.\n\nSALES MODEL: Field-based B2B — local rep network is primary channel, supported by inside sales and e-commerce.\n\nAD INTELLIGENCE (April 2026): ~42 active Meta ads. #ClubDirect B2B targeting club volleyball, softball, lacrosse coaches. Standout: "NO MORE LATE UNIFORMS" — dark background, orange player, bold white text. Short punchy coach-directed copy ("Lock In Your Club's Shop"). Dark navy + white + brand partner colors. ST1 OPPORTUNITY: BSN's creative is cold and transactional. The coach sees another vendor, not a partner.`,
"Game One":`OVERVIEW: 2022 rebrand (legacy companies dating to 1970s). Formed from 8 merged regional dealers (Athletic Supply, Barcelona Sports, Bumblebee, Cardinal Sports, Team Sports, The Graphic Edge, Universal Athletic, Williams). 13,000+ customers, 38 states, 180+ field sales reps. 30%+ growth since rebrand.\n\nTARGET MARKET: High school athletic departments, youth leagues, club sports, community rec programs.\n\nPOSITIONING: "The Brand Behind Your Brand" — National scale with local roots. Claims only national dealer authorized to carry Nike, Adidas, AND Under Armour simultaneously.\n\nSTRENGTHS:\n• Local rep relationships — coaches get a person, not a 1-800 number\n• Full service: equipment + apparel + team stores\n• Only national dealer with Nike + Adidas + Under Armour simultaneously\n• Faster turnaround on quotes vs BSN bureaucracy\n• Smaller feel — programs feel like more than a revenue number\n\nWEAKNESSES:\n• Limited geographic coverage vs BSN's national footprint\n• Smaller brand portfolio and catalog depth vs major dealers\n• Less institutional buying power — pricing may not match BSN volume contracts\n• Less known brand — ADs default to BSN for familiarity\n\nPRICING: Quote-based institutional pricing. School PO accepted. Volume discounts for multi-sport programs.\n\nSALES MODEL: Field-based B2B rep model — local sales reps for school and league accounts.`,
"SquadLocker":`OVERVIEW: Founded 2013, Providence RI (Gary Goldberg). Raised $50M+. National tech-forward team store platform.\n\nTARGET MARKET: Coaches, league directors, school ADs, club managers — anyone running team stores.\n\nPOSITIONING: "The easiest way to get your team's gear" — Technology-first platform. Free team store in minutes. No inventory. No minimums. Direct-to-athlete shipping.\n\nSTRENGTHS:\n• Best-in-class team store UX — genuinely easy for coaches to set up\n• No inventory, no minimums, no money collection by coaches\n• Direct-to-athlete shipping eliminates distribution headaches\n• Wide product catalog: 70+ major brands + 16,000+ products\n• 100,000+ team shops opened in the last year alone\n\nWEAKNESSES:\n• Primarily apparel/spirit wear — limited equipment catalog\n• No custom sublimated performance uniforms at meaningful quality\n• Customer service complaints about late deliveries during peak seasons\n• No dedicated rep — tech-first means relationship is with the platform\n\nPRICING: Free store setup. Products priced at retail; SquadLocker keeps margin.\n\nSALES MODEL: Primarily self-serve digital — coaches launch stores online; customer success for larger accounts.\n\nAD INTELLIGENCE (April 2026): ~5 active Meta ads, hyper-focused enterprise team store pitch. Static hero: navy bg, bold "NO FEES. NO MINIMUMS." + green checkmarks. Video: UGC/talking head style, warehouse walkthroughs. Hook: objection crusher ("Her AAU team waited HOW LONG?"). ST1 OPPORTUNITY: SquadLocker's creative is smart but cold — it sells logistics, not a relationship.`,
"Team Sports Planet":`OVERVIEW: National e-commerce dealer. Mid-tier online dealer — institutional and consumer focus.\n\nTARGET MARKET: Schools, leagues, clubs, athletic directors, coaches, individual athletes.\n\nPOSITIONING: "Your one-stop team sports source" — Online-first, broad catalog, competitive pricing.\n\nSTRENGTHS:\n• Wide catalog across equipment and apparel categories\n• Accepts school POs — institutional procurement-friendly\n• Competitive pricing with volume breaks\n• Accessible to small programs with no minimums on most items\n\nWEAKNESSES:\n• Generic online catalog feel — no specialized expertise or consultation\n• Limited custom apparel depth vs dedicated custom dealers\n• No exclusive product lines or differentiating merchandise\n• No local rep — purely transactional online relationship\n\nPRICING: Competitive retail + volume discounts. School PO accepted. Quantity break pricing.\n\nSALES MODEL: Primarily online self-serve + phone-based sales team for institutional accounts.`,
"Boombah":`OVERVIEW: Founded 2003, Yorkville IL. 250,000 sq ft facility + factory in Dominican Republic. Vertically integrated manufacturing. Official NFCA Sponsor.\n\nTARGET MARKET: Youth leagues, travel baseball/softball, HS athletic departments, club sports, adult rec.\n\nPOSITIONING: "Be what no one else is and give what no one else will." High-quality gear at affordable prices via direct-to-consumer; own factory for speed and cost advantage.\n\nSTRENGTHS:\n• Vertically integrated = 2-week custom turnaround (industry-leading speed)\n• Direct pricing by eliminating distributor markup\n• Massive style variety — 3D online builder with hundreds of combinations\n• Strong brand recognition in travel baseball/softball community\n• NFCA and Perfect Game partnerships\n• Boombah Sports Complex #1 youth baseball complex (Newsweek 2025)\n\nWEAKNESSES:\n• PissedConsumer 1.9 stars — poor CS responsiveness, difficult returns\n• Strict return policy makes sizing errors painful and costly\n• Durability issues reported with rolling bat bags and cleats\n• Sizing inconsistencies across multiple complaint threads\n• Own-brand only equipment — no Rawlings, Marucci, Wilson, or Easton\n\nPRICING: Direct-to-consumer. 5% off $2,500+, up to 15% off $15,000+. Free ground shipping over $99.99.\n\nSALES MODEL: Hybrid — primarily self-serve e-commerce with 3D builder + CS/Sales for org-level support.\n\nINSTAGRAM INTELLIGENCE (April 2026): 46K followers, 2,852 posts. Strongest visual brand in the category. Themed novelty collection drops: Graffiti Drip, Fruit Collection, Ice Cream Turfs — treated like streetwear drops with hype launches. National team flag-colorway collabs (Colombia, Dominican Republic, Nicaragua). Speaks to the ATHLETE not the coach. Only competitor with a genuine brand personality people follow for fun. ST1 LESSON: Graphic tee drops ('I Hit Dingers', 'Oppo Taco') should be marketed EXACTLY like Boombah's novelty collections — named drops, launch posts, limited runs.`,
"Smash It Sports":`OVERVIEW: Founded 2013/2014, Rochester NY (Rick Schiffhauer, family-owned). National — flagship store + major warehouse + e-commerce. Official Uniform Provider for USA Softball Slow Pitch National Teams (2025).\n\nTARGET MARKET: Youth rec leagues, travel ball, high schools, colleges, adult slowpitch leagues, individual athletes.\n\nPOSITIONING: "Your Baseball and Softball Super Store — by players, for players." Largest online bat selection. Price match guarantee.\n\nSTRENGTHS:\n• Unrivaled bat selection — BBCOR, USSSA, USA, Senior; nation's largest softball retailer\n• 'Ridiculously fast' shipping consistently praised by reviewers\n• Strong brand relationships with exclusive limited-edition bat drops\n• USA Softball Slow Pitch National Team partnership 2025\n• Smash Cash loyalty program drives repeat purchases\n\nWEAKNESSES:\n• Customer service described as 'rude' or 'unprofessional' in disputes\n• Strict return policy — 15–20% restocking fee + no return shipping covered\n• Warranty friction — refers bat damage to manufacturer instead of resolving\n• Custom jersey color quality consistency issues\n• Primarily diamond sports only — no multi-sport capability\n\nPRICING: Competitive retail + Lowest Price Guarantee. Bats $100–$500+. Custom uniforms up to 50% off retail.\n\nSALES MODEL: Hybrid — high-volume B2C e-commerce, SIS Rep network, Team Sales dept, physical retail.`,
"Extra Innings Direct":`OVERVIEW: Founded 1996, Middleton MA. 400+ travel programs and facilities as members. $4M+ inventory on partner site.\n\nTARGET MARKET: Travel baseball/softball organizations, youth leagues, indoor training facilities, high school programs.\n\nPOSITIONING: "The Exclusive Diamond Sports Benefits Group" — Cuts out the dealer entirely. Clubs become their own dealer at wholesale pricing. No minimums, no inventory.\n\nSTRENGTHS:\n• Truly unique model — eliminates the middleman for diamond sports orgs\n• Collective buying power of 400+ programs at genuine wholesale pricing\n• No minimums — access to 40+ manufacturers without carrying inventory\n• Launch Nike/UA/Adidas stores without being an authorized dealer\n• Ancillary value: insurance and payment processing discounts for members\n\nWEAKNESSES:\n• BBB complaints about wholesale prices sometimes exceeding retail\n• Baseball/softball only — zero coverage for other sports\n• Requires membership commitment — not free to access\n• BSN dependence means BSN's shipping delays become your members' problems\n\nPRICING: Membership-based (fees not public, risk-free trial available). Members set their own retail prices.\n\nSALES MODEL: Hybrid — in-house support/design team + self-serve 24/7 live dashboard.`,
"GoBallistic Sports":`OVERVIEW: Founded 2012, East Hanover NJ (Kathy and Scott Gorski — advertising industry veterans). Regional NJ focus with national clients.\n\nTARGET MARKET: HS and middle schools, youth sports orgs (rec and travel), AAU teams, clubs.\n\nPOSITIONING: "Change YOUR Game — Go Big — no templates, no cookie-cutter graphics." Completely original custom designs. In-house production for quality control.\n\nSTRENGTHS:\n• Strong design pedigree from advertising background — truly unique custom designs\n• No templates — completely original graphics that differentiate programs\n• In-house printing and production for quality control\n• Broad sport coverage across 18+ sports\n• Turn-key online team stores eliminate manual form collection\n\nWEAKNESSES:\n• 4–5 week production times — supply chain issues acknowledged\n• Regional NJ focus limits credibility and coverage outside the area\n• Limited equipment catalog — apparel and uniform focused only\n• 25-piece minimum for sublimation limits very small teams\n\nPRICING: Quote-based. Tees $18–21, Performance Shirts $21–44, Hoodies $41–58. 50% deposit. 25-piece minimum for sublimation.`,
"Wooter Apparel":`OVERVIEW: Founded 2014, Staten Island NY (Alex Aleksandrovski, David Kleyman, Alex Kagan). 40+ countries. Clients include AAU, NFL Alumni, DoD, YMCA, MTV, JetBlue, FDNY.\n\nTARGET MARKET: AAU teams, youth leagues, schools K-12 and collegiate, rec teams, sports facilities.\n\nPOSITIONING: "The #1 Shop for Custom Team Gear — professional quality at unbeatable prices." Lowest Price Guarantee + Name Your Own Price budget tool.\n\nSTRENGTHS:\n• Competitive pricing — among the lowest for custom sublimated uniforms (basketball sets from $39.99)\n• High-quality sublimation designs praised by initial buyers\n• Global scale — 40+ countries, wide sport coverage\n• Free fan shop with 10–50% commission\n• Accepts cryptocurrency\n\nWEAKNESSES:\n• Post-payment customer service described as 'ghosting' across multiple platforms\n• Significant delivery delays causing teams to miss season starts\n• Sizing runs small — consistent complaint\n• Difficult refund process — high complaint volume on BBB and Trustpilot\n• No major brand licensing — own-brand sublimation only\n• Zero hard equipment — apparel-only\n\nPRICING: Tiered/package deals. Basketball sets from $39.99, Football from $59.99, Soccer from $27.99. Lowest Price Guarantee.\n\nAD INTELLIGENCE (April 2026): ~21 active Meta ads, all UGC talking head videos (0:12–0:54). Sponsorship program focused (wooter.com/sponsorships). Core hook: "Custom Sports Uniforms Sponsorships. Please note this is NOT free apparel." 21 variants of one concept — testing video length and presenter. ST1 OPPORTUNITY: Wooter's creative screams 'scrappy startup.' ST1 can own the premium, relationship-first alternative.`,
"Sports Gear Swag":`OVERVIEW: Founded 2018, Sugar Land TX. 140,000+ orders completed, 170,000+ athletes outfitted globally.\n\nTARGET MARKET: Youth/adult sports leagues, K-12 schools, colleges, corporate teams, non-profits.\n\nPOSITIONING: "Experts in Custom Sports Jerseys, Uniforms & Gear — Lowest Price Guaranteed." No minimums, fast rush options, free design assist.\n\nSTRENGTHS:\n• Fast rush options — Super Rush 3-day delivery available\n• No order minimums — accessible to smallest programs\n• User-friendly online design tool with quick digital proofs\n• Broad 60+ sport coverage\n• Pay-after-proof-approval option\n\nWEAKNESSES:\n• Sizing inaccuracy complaints — runs small, odd fits consistently reported\n• Non-stretchy material complaints for performance athletic use\n• Shipping delays despite paying for expedited options\n• Difficult customer service for refunds and remakes\n• No major brand licensing — own-brand templates only\n• Apparel-only at meaningful depth, no equipment\n\nPRICING: Tiered bulk discounts: 10% off 1+, up to 20% off 100+. Base jerseys ~$15.99–$25.99.`,
"Custom Ink":`OVERVIEW: Founded 2000, Fairfax VA. Major consumer brand. Very large scale — household name.\n\nTARGET MARKET: Individuals, families, friend groups, corporate teams, non-profits, schools — any group wanting custom apparel. Not sport-specific.\n\nPOSITIONING: "Bringing people together through custom apparel." Easy design tool, group order coordination, 100% quality guarantee.\n\nSTRENGTHS:\n• Extremely user-friendly design tool — accessible to anyone\n• Massive brand recognition — every parent and coach knows Custom Ink\n• 100% satisfaction guarantee with no-hassle remake/refund\n• Fast turnaround options for spirit wear and casual apparel\n• FundraisingHub for organizations\n\nWEAKNESSES:\n• Cotton/fashion apparel only — not moisture-wicking performance gear\n• No sports equipment whatsoever — fundamentally different business\n• No team store infrastructure for ongoing season-long sales\n• No sport-specific expertise in uniforms, sizing, or performance needs\n• No sublimated uniforms — printed apparel peels/cracks over seasons\n\nPRICING: Per-item pricing decreasing with volume. T-shirts start ~$16+ for small quantities. No setup fees.\n\nNOTE: Custom Ink is NOT a sports dealer — it's a t-shirt printer that coaches sometimes use for casual spirit wear. Not a real competitive threat for uniforms or equipment.`,
"Trigon Sports":`OVERVIEW: Founded 2007 (business since 2001), Memphis TN. Family-owned. National distribution. Acquired Proper Pitch Inc. (pitching mounds) November 2025.\n\nTARGET MARKET: ADs and coaches at high schools and colleges, facility managers, youth league organizers.\n\nPOSITIONING: "Make Winning Possible™" — Premier source for durable professional-grade athletic training and facility equipment.\n\nSTRENGTHS:\n• A+ BBB rating — outstanding customer service reputation\n• 98% Facebook recommendation rate — very high satisfaction\n• ProCage batting cage line highly praised for durability\n• Deep facility equipment expertise: bleachers, batting cages, field covers\n• Acquired Proper Pitch Inc. (pitching mounds) 2025 — expands product line\n• Same-day shipping on in-stock orders\n\nWEAKNESSES:\n• Virtually zero apparel capability — pure equipment play\n• No team stores, no custom uniforms — can't outfit a team\n• Niche facility/training equipment positioning limits overall breadth\n\nPRICING: Multi-tier — retail from $0.80/sq ft (netting) to $8,000+ (batting cages). Wholesale/dealer via quote.\n\nSALES MODEL: Hybrid — DTC online, national catalog, authorized dealer network (B2B).`,
"Gopher Sport":`OVERVIEW: Founded 1947, Owatonna MN. Privately held (The Prophet Corporation). $31–51M annual revenue, 150–500 employees. 75+ years in operation.\n\nTARGET MARKET: K-12 PE teachers, athletic directors, school coaches, YMCAs, recreation centers, government agencies.\n\nPOSITIONING: "Unconditional 100% Satisfaction Guarantee" — Premier PE/athletics partner for educational institutions — easiest company to work with for teachers and coaches.\n\nSTRENGTHS:\n• A+ BBB rating — 75+ years of institutional trust\n• Unconditional satisfaction guarantee — any time, any reason, no questions\n• Same-day shipping 99%+ of in-stock orders\n• Deep PE/rec equipment expertise unavailable at general retailers\n• Government contract access: GSA, DoDEA, Sourcewell, OMNIA Partners\n• 75+ year catalog covering archery, badminton, floor hockey, and more\n\nWEAKNESSES:\n• Custom apparel limited to spirit wear — no performance uniforms\n• No team store platform for individual parent/fan ordering\n• Institution-focused — limited flexibility for youth clubs and travel teams\n• Occasional complaints about guarantee requiring original receipts\n\nPRICING: Catalog-based tiered pricing. Contract pricing via Sourcewell and OMNIA Partners. $5.95 (whistles) to $1,699+ (archery packs).\n\nSALES MODEL: Multi-channel — e-commerce, direct-mail catalog, outside sales force, government cooperative purchasing contracts.`
},
battlecards:{
"Dick's Sporting Goods":{competitor:"Dick's Sporting Goods",category:"Do It All",our_strengths:["Personal relationship vs account number — we know your program and athletes by name","Direct access to a rep who responds same day — no call center routing","Exclusive ST1 graphic tee designs coaches and athletes actually want","Equipment expertise without retail commission-floor upsell pressure","When something goes wrong, you reach a human who fixes it — not a 1-800 number"],their_strengths:["Unmatched 850+ store physical footprint nationwide","GameChanger app reaches 6.5M+ youth team users directly","House of Sport experiential retail (batting cages, simulators, climbing walls)","ScoreCard loyalty in 70% of all transactions","Deep brand relationships with every major manufacturer"],key_messages:["Dick's is a mall experience. We're a team experience.","GameChanger gets them to the parents. It doesn't serve the coach.","850 stores and 1.7 stars on Trustpilot — big doesn't mean good."],objection_handlers:[{objection:"Dick's has GameChanger and every parent already shops there",response:"GameChanger is how they find parents — it's not how they serve teams. A coach who needs customized gear, accurate sizing, and someone to answer the phone gets none of that at Dick's. We give you a person, not a platform."},{objection:"Dick's has every brand",response:"So do we — and we don't make you drive to a store and hunt through aisles. We bring the right product to you and stand behind it."},{objection:"Dick's prices are hard to beat",response:"Their retail prices are competitive on commodity items. On custom gear, team stores, and equipment bundles, we compete directly — and we don't charge you for the relationship."},{objection:"They have House of Sport with batting cages and simulators",response:"A batting cage at a retail store doesn't set up your team store, source your helmets, or design your uniforms. We do all three."}],discovery_landmines:["Have you ever had a coach issue at Dick's that required a human to solve?","Do you get a dedicated rep from Dick's or do you start over every call?","Have your athletes used GameChanger — and does Dick's follow up with your program?","How long does it take to get custom uniforms through their PROLOOK program?"]},
"gearUP":{competitor:"gearUP",category:"Do It All",our_strengths:["We pick up the phone — gearUP's CS reviews are consistently brutal","Full equipment catalog alongside apparel — gearUP can't source bats and helmets","Proven track record without the CS nightmare plaguing gearUP accounts","Local-style relationship with actual accountability when orders go wrong"],their_strengths:["Nike Team Dealer authorization — rare national credential","24/7 always-open stores with direct-to-athlete shipping","Premium brand access: Nike, Under Armour, Momentec"],key_messages:["gearUP can get you Nike. We can get you Nike AND actually answer the phone.","Their stores are always open. Their support isn't.","Being authorized doesn't mean being accountable."],objection_handlers:[{objection:"gearUP is a Nike authorized dealer",response:"So is ST1 — and we actually answer the phone when your order has an issue. Check their BBB reviews before committing a full season's uniforms."},{objection:"Their stores are always open 24/7",response:"So are ours. The difference is when something goes wrong, we have a process to fix it. They have a voicemail."}],discovery_landmines:["Have you had to contact gearUP support for an issue — how was the experience?","What happens with your store when a sizing error comes in for 30 jerseys?","Do you have a direct rep or do you use a general support inbox?"]},
"Anthem Sports":{competitor:"Anthem Sports",category:"Do It All",our_strengths:["We do equipment AND full custom uniforms + team stores — Anthem can't outfit your team head to toe","Relationship-based vs pure transactional online catalog experience","Our exclusive graphic tee line gives teams identity beyond just equipment","We handle the full program — not just the gear closet"],their_strengths:["Exceptional CS — 4.8/5 on Trustpilot with 4,000+ reviews","Same-day shipping on in-stock items placed by 2pm EST","Deep equipment catalog including hard-to-find institutional items","Accepts school POs","Wilson-authorized dealer with 20+ top-brand relationships"],key_messages:["Anthem ships fast. They can't dress your team.","4.8 stars on equipment. Zero stars on custom uniforms — they don't offer them.","We're Anthem plus everything Anthem can't do."],objection_handlers:[{objection:"Anthem has everything we need for equipment",response:"For a gear closet, yes. But when the coach wants custom uniforms, team stores, and spirit wear, they're calling someone else. We handle it all so you're not juggling vendors."},{objection:"Anthem ships same-day",response:"So can we on in-stock items. And when you need something custom, you get a person who knows your sport — not a search bar."}],discovery_landmines:["Do you need custom uniforms or apparel in addition to equipment?","When something arrives damaged, how easy is it to get resolution from Anthem?","Does Anthem have a rep who knows your program, or do you start fresh every time?"]},
"BSN Sports":{competitor:"BSN Sports",category:"Do It All",our_strengths:["We don't have rep turnover — you get the same person year after year","No minimum orders — we serve small leagues and large schools equally","Your order doesn't disappear into a 3,000-rep corporate machine","We're accountable to you directly — not to a KKR earnings call","Youth-first focus: we know baseball and softball at the grassroots level"],their_strengths:["Largest team sports dealer network in the US — 3,000+ sales reps","Broadest catalog: all sports, all categories, all price points","Deep institutional relationships with K-12 ADs","Full-service capability: equipment + apparel + team stores","SPRINT service: custom gear in 1–2 days"],key_messages:["BSN has 3,000 reps. You can't reach any of them.","The largest team sports dealer has a 5-week shipping problem.","Contracts renew. Relationships don't have to."],objection_handlers:[{objection:"BSN has a rep in our area and knows our school",response:"Until that rep leaves — and BSN rep turnover is notoriously high. With ST1, the relationship is with the company, not a transient salesperson."},{objection:"BSN is the biggest — they must be the best",response:"Size creates complexity. BSN's complaints are about late shipments and reps who disappear. We're big enough to carry everything you need, small enough to actually care."},{objection:"Our AD has a BSN contract",response:"Contracts renew. When your AD is frustrated with late gear and a revolving-door rep, that's the moment to have this conversation. We're ready."},{objection:"They have Nike and Under Armour contracts we can't get",response:"True — but brand names don't score runs. Our custom sublimation and graphic tees are higher quality per dollar, and we don't disappear after the sale. Ask to see BSN's Trustpilot reviews."}],discovery_landmines:["How many different BSN reps have you had in the past 3 years?","Has a BSN order ever arrived late for a game or season opener?","Do small programs at your school get the same attention as football or basketball?","What happens when you call BSN with an urgent in-season need?","When did you last receive an order on time from your current supplier?"]},
"Game One":{competitor:"Game One",category:"Do It All",our_strengths:["ST1 is a complete sporting goods company — equipment, custom apparel, team stores, graphic tees, all in one","Our exclusive graphic tee and spirit wear line is something Game One can't offer","National brand relationships (Nike, UA, Adidas, Rawlings, Easton, Marucci, Wilson)","We serve youth through high school with no program too small or too large"],their_strengths:["Local rep relationships — coaches get a person, not a 1-800 number","Only national dealer with Nike + Adidas + Under Armour simultaneously","Full service: equipment + apparel + team stores","Smaller than BSN — programs feel valued"],key_messages:["Game One is a good local dealer. ST1 is that — plus exclusive products they can't touch.","Local relationships are our specialty too. And we bring more to the table.","They grew through mergers. We grew through coaches trusting us."],objection_handlers:[{objection:"Game One knows our community and our coaches",response:"Local relationships are valuable — and ST1 builds the same local relationship while adding equipment, custom apparel, exclusive tee designs, and team stores that Game One can't match."},{objection:"We already have a Game One rep we like",response:"Keep that relationship for what they do well. Let us show you what they can't do — our exclusive product lines, faster customs, and full-service team store platform."}],discovery_landmines:["Does your current dealer offer exclusive graphic tee and spirit wear designs unique to your school?","Can you get equipment, custom uniforms, AND team stores all from Game One?","When you need something custom, how long does turnaround take?"]},
"SquadLocker":{competitor:"SquadLocker",category:"Do It All",our_strengths:["Full equipment catalog — SquadLocker is apparel only at meaningful depth","Human relationship + technology — we provide both, not just a platform","Exclusive ST1 graphic tee line available only through our stores","Custom performance uniforms with sublimation — SquadLocker can't compete"],their_strengths:["Best-in-class team store UX — genuinely easy for coaches to set up","No inventory, no minimums, no money collection by coaches","Direct-to-athlete shipping eliminates distribution headaches","70+ major brands, 16,000+ products"],key_messages:["SquadLocker makes the admin easy. We make the whole program easy.","A platform answers tickets. We answer phones.","Coaches love not handling money. We give them that AND equipment AND uniforms."],objection_handlers:[{objection:"SquadLocker makes it so easy — coaches love it",response:"Coaches love not handling money. We give them the same freedom with our team store platform — plus equipment, custom uniforms, and exclusive designs that SquadLocker doesn't have."},{objection:"They have no minimums and free setup",response:"So do we. And when something goes wrong, you call a person who knows your program — not a chatbot."}],discovery_landmines:["Does your team need custom performance uniforms, not just spirit wear?","Do you also need equipment sourcing beyond the team store?","When something goes wrong with a SquadLocker order, who do you call?"]},
"Team Sports Planet":{competitor:"Team Sports Planet",category:"Do It All",our_strengths:["Dedicated rep who knows your program vs anonymous online catalog","Exclusive ST1 graphic tee and spirit wear line unavailable elsewhere","Custom uniform expertise with sublimation — Team Sports Planet can't deliver this","Full-service team store platform with exclusive designs and program support"],their_strengths:["Wide catalog across equipment and apparel categories","Accepts school POs","Competitive pricing with volume breaks","Accessible to small programs with no minimums"],key_messages:["An online catalog ships quickly. A partner shows up.","Team Sports Planet has everything. We have everything plus a relationship.","Anonymous vendors are fine — until something goes wrong."],objection_handlers:[{objection:"Team Sports Planet has everything and ships quickly",response:"An online catalog ships quickly. But when you need customization, a team store, or advice on what works for your sport, you need ST1. We're the difference between a vendor and a partner."}],discovery_landmines:["Do you get custom design support for uniforms or are you picking from templates?","Who is your dedicated contact when something goes wrong with an order?","Does Team Sports Planet carry any exclusive products your athletes actually want to wear?"]},
"Boombah":{competitor:"Boombah",category:"Sport Specialist",our_strengths:["We carry all major brands (Rawlings, Easton, Marucci, Wilson) — Boombah only does their own brand","Our CS is actually responsive — Boombah's 1.9-star PissedConsumer rating speaks for itself","Better accountability when orders go wrong — no stone wall on returns","We're multi-sport experts, not baseball/softball specialists who expanded","Our graphic tee drops create the same athlete identity buzz as their novelty collections — across ALL sports"],their_strengths:["Own factory = 2-week custom turnaround (industry fastest)","Direct pricing eliminates distributor markup","Massive style variety via 3D online builder","Strong brand recognition in travel baseball/softball","NFCA and Perfect Game institutional partnerships","Strongest visual brand and Instagram presence in category"],key_messages:["Two weeks means nothing if the return policy stonewalls you on wrong sizing.","They speak to the athlete. So do we — and we do it for every sport, not just baseball.","Boombah's brand playbook (collection drops, athlete identity) is exactly what ST1 does with graphic tees."],objection_handlers:[{objection:"Boombah's 2-week custom turnaround is very fast",response:"Speed matters only if the product is right. With Boombah's return policy and sizing complaints, a wrong order at 2 weeks is worse than a right order at 3. We get it right and stand behind it."},{objection:"Their direct pricing is competitive",response:"We offer team pricing that's equally competitive — and you get to choose from every major brand, not just theirs."},{objection:"They're an NFCA sponsor — gives them credibility",response:"Sponsorship buys visibility, not service. Ask coaches who've dealt with their customer service what they actually think."}],discovery_landmines:["Have you ever had to return or exchange something from Boombah — how did that go?","Do you need brand-name bats and helmets, or are you open to an unknown brand?","What happens when a cleat breaks mid-season and you need an immediate replacement?"]},
"Smash It Sports":{competitor:"Smash It Sports",category:"Sport Specialist",our_strengths:["We serve all sports — not just baseball and softball","Better customer service when things go wrong — no restocking fees, real accountability","Multi-sport team program capability Smash It simply doesn't have","Our reps know your whole program, not just your bat preferences"],their_strengths:["Unrivaled bat selection — nation's largest softball retailer","Ridiculously fast shipping consistently praised by reviewers","Strong brand relationships with exclusive limited-edition bat drops","USA Softball Slow Pitch National Team partnership 2025","Smash Cash loyalty program"],key_messages:["The best bat store in the country. Not the best team dealer.","We do everything Smash It does for diamond sports — plus everything else.","A 15–20% restocking fee is how you discover who your vendor really is."],objection_handlers:[{objection:"Smash It has the best bat selection",response:"For bats, yes. When your program also needs soccer goals, basketball uniforms, and a team store for all your sports, you need ST1. We do everything they do for diamond sports — plus everything else."},{objection:"They're the official USA Softball supplier",response:"Official partnerships are marketing. Ask their customers about returning an item — that's where the relationship actually shows."},{objection:"Their price match guarantee is compelling",response:"We match prices too. But we also match expectations on service, returns, and accountability — areas where Smash It consistently falls short."}],discovery_landmines:["Do you also need equipment and uniforms for sports beyond baseball and softball?","Have you ever tried to return something to Smash It — what was the experience?","When a bat gets damaged, who do they direct you to for resolution?"]},
"Extra Innings Direct":{competitor:"Extra Innings Direct",category:"Sport Specialist",our_strengths:["We are the dealer — no membership fee, no wholesale complexity to manage","We cover ALL sports, not just diamond sports","No dependence on BSN Sports' well-documented service problems","A real relationship with a human who knows your program — no dashboard substitute","We handle team stores, custom gear, AND equipment without making you your own purchasing department"],their_strengths:["Truly unique model — eliminates the middleman for members","Collective buying power of 400+ programs at genuine wholesale pricing","No minimums — access to 40+ manufacturers without carrying inventory","Nike/UA/Adidas stores without being an authorized dealer"],key_messages:["EID makes your club director a purchasing manager. We do that for you.","Membership in a buying group is a job. Being our customer isn't.","No BSN middleman — except that EID runs entirely through BSN."],objection_handlers:[{objection:"EID gives us wholesale pricing — cuts you out",response:"It also makes your club director a purchasing manager, inventory analyst, and vendor relationship manager. We do all of that for you, for free, with no membership fee. And we cover every sport, not just baseball."},{objection:"They have 40+ manufacturer relationships",response:"We do too — and you benefit from ours without paying a membership. Plus your orders don't go through BSN Sports, which means no 5-week shipping delays."},{objection:"The BSN Club Direct integration is powerful",response:"It is — until BSN is late on a uniform order and your team misses Opening Day. We're accountable directly to you."}],discovery_landmines:["What sports does your organization run beyond baseball and softball?","Have you calculated the true cost of EID membership vs. the actual savings?","What happens to your team stores if EID's BSN partnership changes?","How much time does your club director spend managing vendor relationships vs. coaching?"]},
"GoBallistic Sports":{competitor:"GoBallistic Sports",category:"Apparel Specialist",our_strengths:["National reach vs their regional New Jersey focus","Full equipment catalog GoBallistic doesn't carry","Faster turnaround with fewer supply chain excuses","No minimum order constraints for smaller programs and rec leagues"],their_strengths:["Strong design pedigree from advertising background — truly original custom designs","No templates — completely original graphics","In-house printing and production for quality control","Broad sport coverage across 18+ sports"],key_messages:["Original designs are great. 4–5 week timelines aren't.","GoBallistic does great creative. We do great creative AND equipment AND we're national.","25-piece minimum is a real barrier. We don't have one."],objection_handlers:[{objection:"GoBallistic does fully custom original designs",response:"So do we — and we don't have the 4–5 week backlog or the 25-piece minimums that limit smaller programs."},{objection:"They're local to us",response:"Local matters for relationships — but ST1 gives you that same relationship regardless of geography, with broader inventory and faster execution."}],discovery_landmines:["Do you need equipment alongside custom uniforms?","What's your timeline for uniforms — can you wait 4–5 weeks?","Do you have enough players to meet the 25-piece sublimation minimum every time?"]},
"Wooter Apparel":{competitor:"Wooter Apparel",category:"Apparel Specialist",our_strengths:["We don't ghost clients after payment — real accountability from order to delivery","Full equipment catalog — Wooter has zero hard equipment","Major brand options (Nike, UA, Adidas) vs Wooter's own-brand sublimation","Our fan stores carry exclusive ST1 graphic tee line that actually sells"],their_strengths:["Among the lowest prices for custom sublimated uniforms","High-quality sublimation designs praised initially","Global scale — 40+ countries","Free fan shop with 10–50% commission"],key_messages:["Cheap uniforms and no accountability is an expensive combination.","Wooter gets you in the door at $39. We keep you coming back for 10 years.","Their creative screams startup. Ours says partner."],objection_handlers:[{objection:"Wooter prices are very low",response:"You get what you pay for — and their BBB and Trustpilot reviews show what happens when something goes wrong. We stand behind our products with real accountability."},{objection:"Their fan shop earns us commission",response:"So does ours — plus our fan stores carry our exclusive graphic tee line that actually sells beyond just uniforms."}],discovery_landmines:["Do you also need equipment or are you purely looking for apparel?","Have you or another coach had issues getting responses from Wooter after ordering?","Does your team need gear from recognized major brands like Nike or Under Armour?"]},
"Sports Gear Swag":{competitor:"Sports Gear Swag",category:"Apparel Specialist",our_strengths:["Major brand access (Nike, UA, Adidas) vs SGS's no-name sublimation","Equipment alongside apparel — SGS is apparel-only at meaningful depth","Relationship and accountability vs pure online transactional model","Our graphic tee line has sport-specific original designs vs generic templates"],their_strengths:["Super Rush 3-day delivery available","No order minimums","User-friendly online design tool with quick digital proofs","Broad 60+ sport coverage"],key_messages:["3-day rush means nothing when sizing is wrong.","Generic templates for 60 sports. We do original designs for your sport.","Entry-level pricing attracts teams. Quality complaints follow."],objection_handlers:[{objection:"No minimums and 3-day rush is very appealing",response:"Rush matters — but not when sizing is wrong or material is stiff. We can turn custom orders quickly too, with better quality control and major brands behind the product."},{objection:"Their pricing is very low",response:"Entry-level pricing attracts teams, then the quality complaints follow. We're competitive on price for the quality tier that holds up a full season."}],discovery_landmines:["Do you need equipment as well as apparel for your program?","What brands do your athletes or parents expect to see on their gear?","Have you had sizing issues with ultra-cheap custom apparel before?"]},
"Custom Ink":{competitor:"Custom Ink",category:"Apparel Only",our_strengths:["We're an actual sports dealer — Custom Ink is a t-shirt printer","Performance athletic fabrics vs cotton fashion apparel that cracks and peels","Equipment + uniforms + team stores in one relationship vs apparel only","Sport-specific expertise vs generic design templates for any group"],their_strengths:["Extremely user-friendly design tool — accessible to anyone","Massive brand recognition — every parent and coach knows Custom Ink","100% satisfaction guarantee","Fast turnaround options for spirit wear and casual apparel"],key_messages:["Custom Ink is great for the school picnic. Not for game day.","We start where Custom Ink ends.","Everyone knows Custom Ink. Coaches who know the difference choose ST1."],objection_handlers:[{objection:"Custom Ink is easy and everyone knows them",response:"For custom tees with your team name — great. For performance uniforms that survive a season, catcher's gear, batting helmets, and a team store that sells all year, you need a sports dealer."},{objection:"Their guarantee is risk-free",response:"So is ours. But we start with performance fabrics and sports-specific designs that don't need to be guaranteed because they're right the first time."}],discovery_landmines:["Are you looking for cotton fashion tees or performance athletic uniforms?","Do you need equipment alongside the apparel?","Does your team need individual name/number customization on moisture-wicking fabric?"]},
"Trigon Sports":{competitor:"Trigon Sports",category:"Equipment Only",our_strengths:["We handle equipment AND apparel AND team stores — Trigon can't outfit your team","We carry major brand equipment (Rawlings, Easton, Wilson) alongside facility gear","One vendor relationship for the entire program — not a specialty equipment-only vendor"],their_strengths:["A+ BBB rating — outstanding CS reputation","98% Facebook recommendation rate","ProCage batting cage line highly praised for durability","Deep facility equipment expertise: bleachers, batting cages, field covers","Acquired Proper Pitch Inc. (pitching mounds) 2025"],key_messages:["The best batting cage vendor. Not the best team dealer.","A+ rating on equipment they specialize in. Zero capability on everything else you need.","One more specialty vendor is one more relationship to manage."],objection_handlers:[{objection:"Trigon has the batting cages and field equipment we need",response:"We can source that too — and when you need uniforms, team stores, and spirit wear, you don't need to call a second vendor. We handle everything."},{objection:"They specialize in facility equipment",response:"Specialty is valuable. But for a complete program, you need a partner who handles equipment, apparel, and team gear without multiple vendor relationships."}],discovery_landmines:["Who handles your uniform and team store needs separately from equipment?","How many vendors do you currently manage for your program?","When budget is tight, which vendor is easiest to consolidate?"]},
"Gopher Sport":{competitor:"Gopher Sport",category:"Equipment Only",our_strengths:["We offer performance custom uniforms Gopher doesn't — full sublimation program","Team store capability for individual parent ordering vs Gopher's bulk-only model","Multi-sport equipment expertise with major brands alongside institutional gear","More flexible for youth clubs and travel teams — Gopher is institution-only focused"],their_strengths:["A+ BBB rating — 75+ years of institutional trust","Unconditional satisfaction guarantee — any time, any reason","Same-day shipping 99%+ of in-stock orders","Deep PE/rec equipment expertise — archery, badminton, floor hockey","Government contract access: GSA, DoDEA, Sourcewell, OMNIA Partners"],key_messages:["The best PE equipment catalog in the business. The worst fit for a competitive team program.","Government contracts close doors. We open new ones.","Gopher has the guarantee. We have the guarantee plus everything Gopher can't do."],objection_handlers:[{objection:"We buy through Gopher because of our school's cooperative purchasing contract",response:"Many of our school clients use cooperative pricing through us too — and we combine that with full uniform programs and team stores that Gopher can't provide."},{objection:"Gopher's unconditional guarantee is great",response:"Ours matches it — and we add team stores, custom uniforms, and major brand equipment to the package."}],discovery_landmines:["Does your school need custom performance uniforms in addition to PE equipment?","Do coaches or parents want individual ordering through a team store?","Is your current equipment setup missing any gap Gopher doesn't cover?"]}
}};
function ModCompete() {
const {s,dispatch,setMod}=useApp();
const HARDCODED=["Dick's Sporting Goods","gearUP","Anthem Sports","BSN Sports","Game One","SquadLocker","Team Sports Planet","Boombah","Smash It Sports","Extra Innings Direct","GoBallistic Sports","Wooter Apparel","Sports Gear Swag","Custom Ink","Trigon Sports","Gopher Sport","VS Athletics","MF Athletic","School Specialty","Varsity Group","Anderson's","Epic Sports"];
const [sel,setSel]=useState(null);
const intel=s.competeIntel||{};
const bc=s.battlecards||{};
const [running,setRunning]=useState(null);
const [bcRunning,setBcRunning]=useState(null);
useEffect(()=>{
const missingIntel=Object.keys(COMPETE_SEED.intel).filter(k=>!intel[k]);
const missingBc=Object.keys(COMPETE_SEED.battlecards).filter(k=>!bc[k]);
if(missingIntel.length>0){
const patch={};
missingIntel.forEach(k=>{patch[k]=COMPETE_SEED.intel[k];});
dispatch("SET_COMPETE_INTEL",patch);
}
if(missingBc.length>0){
const patch={};
missingBc.forEach(k=>{patch[k]=COMPETE_SEED.battlecards[k];});
dispatch("SET_BATTLECARD",patch);
}
},[]);
const [editingIntel,setEditingIntel]=useState(null);
const [editText,setEditText]=useState("");
const withIntel=useMemo(()=>Object.keys(intel).sort(),[intel]);
const noIntel=useMemo(()=>HARDCODED.filter(c=>!intel[c]),[intel]);
useEffect(()=>{if(!sel&&withIntel.length>0)setSel(withIntel[0]);},[withIntel]);
const research=async(comp)=>{
setSel(comp);
setRunning(comp);
const t=await aiCall(`Research ${comp} as a competitor to ST1 Sports. ${ST1}. Provide: what they focus on, strengths, weaknesses vs ST1, pricing approach, strongest states, and how ST1 can counter them. Be specific and tactical.`,{search:true});
dispatch("SET_COMPETE_INTEL",{[comp]:t||""});
setRunning(null);
};
const genBc=async(comp)=>{
setBcRunning(comp);
const r=await aiCall(`Sales battlecard for ST1 Sports vs ${comp}. ${ST1}. Return JSON: {"competitor":"","our_strengths":["3 items"],"their_strengths":["2 items"],"key_messages":["3 messages"],"objection_handlers":[{"objection":"","response":""}]}`,{json:true});
dispatch("SET_BATTLECARD",{[comp]:r});
setBcRunning(null);
};
const delIntel=(comp)=>{
if(!window.confirm(`Delete all intel for ${comp}?`)) return;
dispatch("DEL_COMPETE_INTEL",comp);
if(sel===comp) setSel(withIntel.find(c=>c!==comp)||null);
};
return(
<div style={{display:"flex",height:"100%",overflow:"hidden"}}>
{/* LEFT RAIL */}
<div style={{width:220,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0,background:B.surface}}>
<div style={{padding:"14px 12px 10px",borderBottom:`1px solid ${B.border}`,flexShrink:0}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:11,color:B.text,letterSpacing:.5,marginBottom:6}}>COMPETITOR INTEL</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5}}>15 battle cards loaded from April 2026 research. Use REFRESH to update any card with live AI search.</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
{withIntel.length>0&&(
<>
<div style={{padding:"5px 12px 4px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1}}>INTEL SAVED</div>
{withIntel.map(c=>(
<div key={c} onClick={()=>setSel(c)} style={{padding:"8px 12px",cursor:"pointer",borderLeft:`3px solid ${sel===c?B.orange:"transparent"}`,background:sel===c?`${B.orange}08`:"transparent",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500,color:sel===c?B.orange:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{c}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.3,marginTop:1}}>{bc[c]?"✓ battlecard":""}</div>
</div>
<span style={{fontSize:9,color:B.green,flexShrink:0}}>✓</span>
</div>
))}
</>
)}
{noIntel.length>0&&(
<>
<div style={{padding:"8px 12px 4px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>QUICK RESEARCH</div>
{noIntel.map(c=>(
<div key={c} style={{padding:"7px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${B.border}`}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{c}</span>
<button onClick={()=>research(c)} disabled={!!running} style={{background:"none",border:`1px solid ${B.border}`,color:B.blue,borderRadius:4,padding:"2px 7px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",flexShrink:0,letterSpacing:.3,opacity:running?.6:1}}>{running===c?"...":"RESEARCH"}</button>
</div>
))}
</>
)}
{withIntel.length===0&&noIntel.length===0&&(
<div style={{padding:"20px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6}}>No competitor data yet. Ask the home chat about a competitor to save intel here automatically.</div>
)}
</div>
<div style={{padding:"10px 12px",borderTop:`1px solid ${B.border}`,flexShrink:0}}>
<button onClick={()=>setMod("home")} style={{width:"100%",background:B.orange,color:"#fff",border:"none",borderRadius:5,padding:"7px 0",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:"pointer"}}>ASK HOME CHAT →</button>
</div>
</div>
{/* MAIN AREA */}
<div style={{flex:1,overflowY:"auto",padding:"22px 26px"}}>
{!sel&&(
<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,opacity:.7}}>
<div style={{fontSize:32}}>⊗</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted,textAlign:"center",maxWidth:280,lineHeight:1.6}}>Select a competitor from the left, or ask the home chat something like "Research BSN Sports as a competitor"</div>
<button onClick={()=>setMod("home")} style={{padding:"8px 18px",background:B.orange,color:"#fff",border:"none",borderRadius:6,fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>GO TO HOME CHAT →</button>
</div>
)}
{sel&&running===sel&&(
<div style={{display:"flex",gap:10,alignItems:"center",padding:"40px 0",color:B.muted,fontFamily:"'Lexend',sans-serif",fontSize:13}}>
<Spin/>Researching {sel} with live web search...
</div>
)}
{sel&&intel[sel]&&running!==sel&&(
<div>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.text,letterSpacing:.3,marginBottom:3}}>{sel}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>COMPETITOR INTEL</div>
</div>
<div style={{display:"flex",gap:7}}>
<OBtn sm onClick={()=>research(sel)} disabled={!!running}>REFRESH</OBtn>
<OBtn sm onClick={()=>genBc(sel)} disabled={!!bcRunning}>{bcRunning===sel?"...":"GEN BATTLECARD"}</OBtn>
<button onClick={()=>{setEditText(intel[sel]);setEditingIntel(sel);}} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"3px 9px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>EDIT</button>
<button onClick={()=>delIntel(sel)} style={{background:B.redBg,color:B.red,border:"none",borderRadius:4,padding:"3px 9px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer"}}>DELETE</button>
</div>
</div>
{editingIntel===sel?(
<div style={{marginBottom:16}}>
<textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={12} style={{width:"100%",padding:"10px 12px",border:`1px solid ${B.border}`,borderRadius:6,fontSize:12,fontFamily:"'Lexend',sans-serif",lineHeight:1.7,resize:"vertical",color:B.text}}/>
<div style={{display:"flex",gap:7,marginTop:8}}>
<OBtn onClick={()=>{dispatch("SET_COMPETE_INTEL",{[sel]:editText});setEditingIntel(null);}}>SAVE</OBtn>
<GBtn onClick={()=>setEditingIntel(null)}>CANCEL</GBtn>
</div>
</div>
):(
<div className="card" style={{padding:16,marginBottom:16,whiteSpace:"pre-wrap",fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8}}>{intel[sel]}</div>
)}
{bc[sel]&&(
<div>
<Lbl c={B.orange} s={{marginBottom:12}}>BATTLECARD vs {(bc[sel].competitor||sel).toUpperCase()}</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
{[["Our Strengths ✓","our_strengths",B.green,B.greenBg],["Their Strengths","their_strengths",B.red,B.redBg]].map(([l,k,c,bg])=>(
<div key={k} style={{background:bg,borderRadius:6,padding:12}}>
<Lbl c={c} s={{marginBottom:8}}>{l}</Lbl>
{(bc[sel][k]||[]).map((x,i)=><div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.7}}>· {x}</div>)}
</div>
))}
</div>
<div style={{background:B.surface,borderRadius:6,padding:12,marginBottom:12}}>
<Lbl s={{marginBottom:8}}>Key Messages</Lbl>
{(bc[sel].key_messages||[]).map((m,i)=><div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7,marginBottom:4}}>"{m}"</div>)}
</div>
{bc[sel].category&&<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,background:B.blueBg,padding:"3px 10px",borderRadius:4,display:"inline-block",marginBottom:10}}>{bc[sel].category.toUpperCase()}</div>}
{(bc[sel].objection_handlers||[]).map((oh,i)=>(
<div key={i} style={{marginBottom:8,padding:"10px 12px",background:B.white,border:`1px solid ${B.border}`,borderRadius:6}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginBottom:4}}>OBJECTION</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:6}}>"{oh.objection}"</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:1,marginBottom:4}}>RESPONSE</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.6}}>{oh.response}</div>
</div>
))}
{(bc[sel].discovery_landmines||[]).length>0&&(
<div style={{marginTop:12,padding:"12px 14px",background:`${B.orange}06`,border:`1px solid ${B.orange}25`,borderRadius:6}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:1,marginBottom:8}}>💣 DISCOVERY LANDMINES — ask early to surface pain</div>
{(bc[sel].discovery_landmines||[]).map((q,i)=>(
<div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7,paddingLeft:10,borderLeft:`2px solid ${B.orange}40`,marginBottom:6}}>■ {q}</div>
))}
</div>
)}
</div>
)}
</div>
)}
</div>
</div>
);
}
function ModFinance() {
const {s,toast}=useApp();
const [invoices,setInvoices]=useState(null);
const [invLoading,setInvLoading]=useState(true);
const [reconcileResult,setReconcileResult]=useState(null);
const [reconciling,setReconciling]=useState(false);
const [pendingQueue,setPendingQueue]=useState([]);
const [pendingLoading,setPendingLoading]=useState(true);
const [chartAccounts,setChartAccounts]=useState([]);
const [approvingId,setApprovingId]=useState(null);
const [rowOverrides,setRowOverrides]=useState({});
const [billResult,setBillResult]=useState(null);
const [billLoading,setBillLoading]=useState(false);
const [billPreview,setBillPreview]=useState(null);
const [billFileData,setBillFileData]=useState(null);
const [billCreating,setBillCreating]=useState(false);
const [billCreated,setBillCreated]=useState(null);
const [cardAccountId,setCardAccountId]=useState("");
const [cardConfigSaving,setCardConfigSaving]=useState(false);
const [dealPick,setDealPick]=useState("");
const [manualDealName,setManualDealName]=useState("");
const [poOverride,setPoOverride]=useState("");
const [invoicePreview,setInvoicePreview]=useState(null);
const [invoiceCreated,setInvoiceCreated]=useState(null);
const [invoiceWorking,setInvoiceWorking]=useState(false);
const fileRef=useRef();
const loadPending=async()=>{
setPendingLoading(true);
try{
const r=await fetch('/api/agents/ledger/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'list-pending'})});
const d=await r.json();
setPendingQueue(d.pending||[]);
}catch{}
setPendingLoading(false);
};
useEffect(()=>{
fetch('/api/agents/ledger/payments',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({dryRun:true,lookAheadDays:7,limit:200})})
.then(r=>r.json()).then(d=>{
setInvoices(d);
if(d?.totals?.backfilled) toast(`Pulled in ${d.totals.backfilled} invoice${d.totals.backfilled!==1?"s":""} from Zoho Books`,"info");
}).catch(()=>{}).finally(()=>setInvLoading(false));
loadPending();
fetch('/api/agents/ledger/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'accounts-list'})})
.then(r=>r.json()).then(d=>setChartAccounts(d.accounts||[])).catch(()=>{});
},[]);
const runReconcile=async()=>{
setReconciling(true);setReconcileResult(null);
try{
const r=await fetch('/api/agents/ledger/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({task:'reconcile',dryRun:false,limit:50})});
const d=await r.json();
setReconcileResult(d);
loadPending();
}catch(e){toast('Reconcile error: '+e.message,'error');}
setReconciling(false);
};
const approveRow=async(dep)=>{
const override=rowOverrides[dep.id];
const accountId=override?.accountId||dep.suggestedAccountId;
if(!accountId){toast("Pick a category first","error");return;}
const label=override?.label||chartAccounts.find(a=>a.id===accountId)?.name||dep.suggestedLabel;
setApprovingId(dep.id);
try{
const r=await fetch('/api/agents/ledger/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({task:'approve',depositId:dep.id,accountId,label})});
const d=await r.json();
if(!d.ok) throw new Error(d.error||"Approve failed");
toast(`Categorized as ${label} in Zoho Books`,"success");
setPendingQueue(q=>q.filter(x=>x.id!==dep.id));
}catch(e){toast('Approve error: '+e.message,'error');}
setApprovingId(null);
};
const setRowOverride=(depId,accountId)=>{
const label=chartAccounts.find(a=>a.id===accountId)?.name||"";
setRowOverrides(o=>({...o,[depId]:{accountId,label}}));
};
const openDealsForInvoice=useMemo(()=>(s.deals||[]).filter(d=>d.stage!=="Closed Lost").sort((a,b)=>(a.name||"").localeCompare(b.name||"")),[s.deals]);
const selectedDeal=dealPick?openDealsForInvoice.find(d=>d.id===dealPick):null;
const invoiceParams=()=>({
crmDealId:selectedDeal?.zohoId||undefined,
crmDealName:selectedDeal?.name||manualDealName||undefined,
crmAccountName:selectedDeal?.school||manualDealName||undefined,
dealAmount:selectedDeal?.value||undefined,
poNumber:poOverride||undefined,
});
const previewInvoice=async()=>{
if(!selectedDeal&&!manualDealName.trim()){toast("Pick a deal or type a customer name","error");return;}
setInvoiceWorking(true);setInvoicePreview(null);setInvoiceCreated(null);
try{
const r=await fetch('/api/agents/ledger/invoice',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({action:'draft',dryRun:true,...invoiceParams()})});
const d=await r.json();
if(d.error) throw new Error(d.error);
setInvoicePreview(d);
}catch(e){toast('Invoice preview error: '+e.message,'error');}
setInvoiceWorking(false);
};
const createInvoiceNow=async()=>{
setInvoiceWorking(true);
try{
const r=await fetch('/api/agents/ledger/invoice',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({action:'draft',dryRun:false,...invoiceParams()})});
const d=await r.json();
if(d.error) throw new Error(d.error);
setInvoiceCreated(d);setInvoicePreview(null);
toast(`Invoice ${d.invoiceNumber||d.zohoInvoiceId} created as DRAFT in Zoho Books`,"success");
}catch(e){toast('Invoice create error: '+e.message,'error');}
setInvoiceWorking(false);
};
const sendInvoiceNow=async()=>{
if(!invoiceCreated?.dealInvoiceId){toast("Nothing to send","error");return;}
setInvoiceWorking(true);
try{
const r=await fetch('/api/agents/ledger/invoice',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({action:'confirm',dealInvoiceId:invoiceCreated.dealInvoiceId})});
const d=await r.json();
if(d.error) throw new Error(d.error);
setInvoiceCreated(c=>({...c,status:'SENT'}));
toast("Invoice sent to customer","success");
}catch(e){toast('Send error: '+e.message,'error');}
setInvoiceWorking(false);
};
const handleBillFile=async(file)=>{
if(!file) return;
setBillLoading(true);setBillPreview(null);setBillResult(null);setBillCreated(null);setBillFileData(null);
const reader=new FileReader();
reader.onload=async(ev)=>{
const pdfBase64=ev.target.result.split(',')[1];
setBillFileData({pdfBase64,pdfName:file.name});
try{
const r=await fetch('/api/agents/ledger/vendor-bill',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({action:'extract',pdfBase64,pdfName:file.name,dryRun:true})});
const d=await r.json();
setBillPreview(d);
}catch(e){toast('Bill upload error: '+e.message,'error');}
setBillLoading(false);
};
reader.readAsDataURL(file);
};
const createBillNow=async()=>{
if(!billFileData){toast("Upload a bill first","error");return;}
setBillCreating(true);
try{
const r=await fetch('/api/agents/ledger/vendor-bill',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({action:'create',dryRun:false,pdfBase64:billFileData.pdfBase64,pdfName:billFileData.pdfName,supplierId:billPreview?.supplierId||undefined})});
const d=await r.json();
if(!d.ok) throw new Error(d.error||"Create failed");
setBillCreated(d);setBillPreview(null);
toast(`Bill ${d.billNumber||d.zohoBillId} created in Zoho Books`,"success");
}catch(e){toast('Bill create error: '+e.message,'error');}
setBillCreating(false);
};
const saveCardAccount=async()=>{
if(!cardAccountId.trim()){toast("Enter the Zoho Books account ID","error");return;}
setCardConfigSaving(true);
try{
const r=await fetch('/api/agents/ledger/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({task:'configure-card',accountId:cardAccountId.trim()})});
const d=await r.json();
if(!d.ok) throw new Error(d.error||"Save failed");
toast("Credit card account saved — RECONCILE DEPOSITS will now include it","success");
}catch(e){toast('Save error: '+e.message,'error');}
setCardConfigSaving(false);
};
const fmtD2=(d)=>d?new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'-';
const overdue=invoices?.overdue||[];
const upcoming=invoices?.upcoming||[];
const totals=invoices?.totals||{};
return(
<div style={{padding:"22px 26px",overflowY:"auto",height:"calc(100vh - 46px)"}}>
<PH title="FINANCE" sub="Invoices · bank reconciliation · vendor bills"/>
{/* KPI row */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:11,marginBottom:20}}>
<KCard l="Checked" v={invLoading?"…":totals.checked??0} c={B.blue}/>
<KCard l="Overdue" v={invLoading?"…":overdue.length} c={B.red}/>
<KCard l="Due Soon" v={invLoading?"…":upcoming.length} c={B.yellow}/>
<KCard l="Paid Today" v={invLoading?"…":totals.paid??0} c={B.green}/>
</div>
{/* AR summary */}
{invoices?.ar&&(invoices.ar.total>0)&&(
<div className="card" style={{padding:16,marginBottom:20,borderTop:`3px solid ${B.blue}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<Lbl c={B.blue}>ACCOUNTS RECEIVABLE</Lbl>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.blue}}>{fmt$(invoices.ar.total)}</span>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
{[["Current",invoices.ar.buckets.current,B.green],["1-30d",invoices.ar.buckets.d1_30,B.yellow],["31-60d",invoices.ar.buckets.d31_60,B.orange],["61-90d",invoices.ar.buckets.d61_90,B.red],["90d+",invoices.ar.buckets.d90plus,B.red]].map(([l,v,c])=>(
<div key={l} style={{textAlign:"center",padding:"7px 6px",background:B.surface,borderRadius:5}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:c}}>{fmt$(v||0)}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginTop:2}}>{l}</div>
</div>
))}
</div>
</div>
)}
{/* Quick actions */}
<div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
<OBtn onClick={runReconcile} disabled={reconciling}>{reconciling?"RECONCILING…":"⟳ RECONCILE DEPOSITS"}</OBtn>
<input ref={fileRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={e=>{handleBillFile(e.target.files?.[0]);e.target.value="";}}/>
<button onClick={()=>fileRef.current?.click()} style={{padding:"8px 16px",background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:4,fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
{billLoading?"EXTRACTING…":"⬆ UPLOAD VENDOR BILL"}
</button>
<button onClick={async()=>{
try{
const r=await fetch('/api/agents/ledger/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dryRun:false,lookAheadDays:7,limit:200})});
const d=await r.json();setInvoices(d);toast(`Payment check done — ${d.totals?.updated||0} updated`,'success');
}catch(e){toast('Payment check error: '+e.message,'error');}
}} style={{padding:"8px 16px",background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:4,fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,cursor:"pointer"}}>
◎ RUN PAYMENT CHECK
</button>
</div>
{/* Draft invoice — engage the ledger agent directly */}
<div className="card" style={{padding:16,marginBottom:20,borderTop:`3px solid ${B.purple}`}}>
<Lbl c={B.purple} s={{marginBottom:10}}>DRAFT AN INVOICE</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 140px",gap:10,marginBottom:10}}>
<div>
<label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,display:"block",marginBottom:4}}>DEAL</label>
<select value={dealPick} onChange={e=>{setDealPick(e.target.value);setManualDealName("");}} style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 9px",fontSize:11,color:B.text,fontFamily:"'Lexend',sans-serif"}}>
<option value="">— pick an open deal or type below —</option>
{openDealsForInvoice.map(d=>(<option key={d.id} value={d.id}>{d.name}{d.school?` (${d.school})`:""} — {fmt$(d.value||0)}</option>))}
</select>
</div>
<div>
<label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,display:"block",marginBottom:4}}>OR CUSTOMER / SCHOOL NAME</label>
<input value={manualDealName} onChange={e=>{setManualDealName(e.target.value);if(e.target.value)setDealPick("");}} placeholder="Type if not in Deals yet" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 9px",fontSize:11,color:B.text,fontFamily:"'Lexend',sans-serif",boxSizing:"border-box"}}/>
</div>
<div>
<label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,display:"block",marginBottom:4}}>PO # (optional)</label>
<input value={poOverride} onChange={e=>setPoOverride(e.target.value)} placeholder="PO-1234" style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"7px 9px",fontSize:11,color:B.text,fontFamily:"'Lexend',sans-serif",boxSizing:"border-box"}}/>
</div>
</div>
<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
<OBtn onClick={previewInvoice} disabled={invoiceWorking}>{invoiceWorking?"WORKING…":"👁 PREVIEW"}</OBtn>
{invoicePreview&&!invoiceCreated&&<OBtn col={B.purple} onClick={createInvoiceNow} disabled={invoiceWorking}>✓ CREATE DRAFT IN ZOHO BOOKS</OBtn>}
{invoiceCreated&&invoiceCreated.status!=='SENT'&&<OBtn col={B.green} onClick={sendInvoiceNow} disabled={invoiceWorking}>✉ SEND TO CUSTOMER</OBtn>}
</div>
{invoicePreview&&!invoiceCreated&&(
<div style={{marginTop:12,padding:12,background:B.surface,borderRadius:6}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:6}}>Preview — nothing created yet</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:6}}>{invoicePreview.preview?.customerName}</div>
{(invoicePreview.preview?.lineItems||[]).map((li,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:11}}>
<span style={{color:B.text}}>{li.quantity}× {li.name}</span>
<span style={{color:B.muted}}>{fmt$(li.rate*li.quantity)}</span>
</div>
))}
<div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`2px solid ${B.border}`}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted}}>Due {invoicePreview.preview?.dueDate}</span>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.purple}}>{fmt$(invoicePreview.preview?.total)}</span>
</div>
</div>
)}
{invoiceCreated&&(
<div style={{marginTop:12,padding:12,background:B.greenBg,borderRadius:6,border:`1px solid ${B.green}40`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{invoiceCreated.customerName} — {invoiceCreated.invoiceNumber||invoiceCreated.zohoInvoiceId}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:invoiceCreated.status==='SENT'?B.green:B.orange,letterSpacing:.5,marginTop:2}}>{invoiceCreated.status||'DRAFT'}</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.green}}>{fmt$(invoiceCreated.total)}</span>
{invoiceCreated.reviewUrl&&<a href={invoiceCreated.reviewUrl} target="_blank" rel="noreferrer" style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue}}>VIEW IN BOOKS →</a>}
</div>
</div>
</div>
)}
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
{/* Overdue invoices */}
<div className="card" style={{padding:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<Lbl>OVERDUE INVOICES ({overdue.length})</Lbl>
</div>
{invLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Loading…</div>}
{!invLoading&&overdue.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No overdue invoices 🎉</div>}
{overdue.map((inv,i)=>(
<div key={i} style={{padding:"8px 0",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{inv.crmDealName||'—'}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Due {fmtD2(inv.dueDate)}</div>
</div>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.red}}>{fmt$(inv.amountTotal)}</div>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.white,background:B.red,padding:"2px 6px",borderRadius:3,letterSpacing:.3}}>{Math.abs(inv.daysFromNow||0)}d OVERDUE</span>
</div>
</div>
))}
</div>
{/* Upcoming invoices */}
<div className="card" style={{padding:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<Lbl>DUE SOON ({upcoming.length})</Lbl>
</div>
{invLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Loading…</div>}
{!invLoading&&upcoming.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Nothing due in the next 7 days</div>}
{upcoming.map((inv,i)=>(
<div key={i} style={{padding:"8px 0",borderBottom:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{inv.crmDealName||'—'}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Due {fmtD2(inv.dueDate)}</div>
</div>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.yellow}}>{fmt$(inv.amountTotal)}</div>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.yellow,background:B.yellowBg,padding:"2px 6px",borderRadius:3,border:`1px solid ${B.yellow}40`,letterSpacing:.3}}>{inv.daysFromNow||0}d</span>
</div>
</div>
))}
</div>
</div>
{/* Reconcile result */}
{reconcileResult&&(
<div className="card" style={{padding:16,marginTop:16}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:.5,marginBottom:10}}>LAST PULL</div>
<div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
{[["Polled",reconcileResult.totals?.polled,B.blue],["With Suggestion",reconcileResult.totals?.withSuggestion,B.green],["Pending Review",reconcileResult.totals?.pending,B.orange],["Duplicates",reconcileResult.totals?.duplicates,B.muted],["Reversals",reconcileResult.totals?.reversals,B.red]].map(([l,v,c])=>(
<div key={l} style={{textAlign:"center",padding:"8px 14px",background:B.surface,borderRadius:6,borderTop:`2px solid ${c}`}}>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:c}}>{v??0}</div>
<Lbl>{l}</Lbl>
</div>
))}
</div>
{reconcileResult.message&&(
<div style={{padding:"8px 12px",background:B.yellowBg,border:`1px solid ${B.yellow}40`,borderRadius:5,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,marginBottom:12}}>ℹ {reconcileResult.message}</div>
)}
{reconcileResult.accountsPolled&&(
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
{reconcileResult.accountsPolled.map((a,i)=>(
<span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:a.notConfigured?B.muted:B.textMid,background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"3px 8px"}}>{a.label}: {a.notConfigured?"not configured":`${a.found} found`}</span>
))}
</div>
)}
</div>
)}
{/* Credit card account config */}
<div className="card" style={{padding:16,marginTop:16}}>
<Lbl s={{marginBottom:6}}>CREDIT CARD ACCOUNT (for charge categorization)</Lbl>
<div style={{display:"flex",gap:8}}>
<input value={cardAccountId} onChange={e=>setCardAccountId(e.target.value)} placeholder="Zoho Books account ID" style={{flex:1,background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 9px",fontSize:11,color:B.text,fontFamily:"'Lexend',sans-serif"}}/>
<OBtn sm onClick={saveCardAccount} disabled={cardConfigSaving}>{cardConfigSaving?"SAVING…":"SAVE"}</OBtn>
</div>
</div>
{/* Persistent review queue — ledger's coding suggestions, awaiting approval */}
<div className="card" style={{padding:16,marginTop:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<Lbl c={B.orange}>REVIEW QUEUE ({pendingQueue.length})</Lbl>
</div>
{pendingLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Loading…</div>}
{!pendingLoading&&pendingQueue.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Nothing pending — run RECONCILE DEPOSITS to pull in uncategorized transactions.</div>}
{pendingQueue.map(dep=>{
const override=rowOverrides[dep.id];
const accountId=override?.accountId||dep.suggestedAccountId||"";
const sourceBadge={memory:["REMEMBERED",B.purple],rule:["ZOHO RULE",B.blue],teamstore:["TEAM STORE",B.green],invoice:["INVOICE",B.teal],vendorbill:["VENDOR BILL",B.orange],manual:["MANUAL",B.muted]}[dep.suggestionSource]||["NO SUGGESTION",B.red];
return(
<div key={dep.id} style={{padding:"10px 0",borderBottom:`1px solid ${B.border}`,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
<div style={{flex:1,minWidth:180}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{dep.orgNameRaw||"Unknown"}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{new Date(dep.txnDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · {dep.source}</div>
</div>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.text,minWidth:80,textAlign:"right"}}>{fmt$(dep.amount)}</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:sourceBadge[1],background:`${sourceBadge[1]}18`,padding:"2px 6px",borderRadius:3,letterSpacing:.3,flexShrink:0}}>{sourceBadge[0]}</span>
<select value={accountId} onChange={e=>setRowOverride(dep.id,e.target.value)} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:4,padding:"5px 8px",fontSize:10,color:B.text,fontFamily:"'Lexend',sans-serif",minWidth:160}}>
<option value="">— choose category —</option>
{chartAccounts.map(a=>(<option key={a.id} value={a.id}>{a.name}</option>))}
</select>
<OBtn sm onClick={()=>approveRow(dep)} disabled={approvingId===dep.id||!accountId}>{approvingId===dep.id?"…":"✓ APPROVE"}</OBtn>
</div>
);
})}
</div>
{/* Vendor bill preview */}
{billPreview&&(
<div className="card" style={{padding:16,marginTop:16}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:.5,marginBottom:10}}>VENDOR BILL PREVIEW — DRY RUN</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,marginBottom:8}}>{billPreview.bill?.supplierName||'Unknown Vendor'} · {billPreview.bill?.vendorInvoiceNo||''}</div>
<div style={{display:"flex",gap:10,marginBottom:10}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 7px",borderRadius:3}}>{billPreview.bill?.mappedCount||0} MAPPED</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:B.redBg,padding:"2px 7px",borderRadius:3}}>{billPreview.bill?.reviewCount||0} NEED REVIEW</span>
<span style={{fontFamily:"'Russo One',sans-serif",fontSize:14,color:B.orange,marginLeft:"auto"}}>{fmt$(billPreview.bill?.totalAmount||0)}</span>
</div>
{(billPreview.bill?.lineItems||[]).map((li,i)=>(
<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${B.border}`,fontFamily:"'Lexend',sans-serif",fontSize:11}}>
<span style={{flex:1,color:li.needsReview?B.red:B.text}}>{li.rawDescription}</span>
{li.matchedItemName&&<span style={{color:B.muted,fontSize:10,margin:"0 8px"}}>→ {li.matchedItemName}</span>}
<span style={{color:B.orange,fontWeight:500,flexShrink:0}}>{fmt$(li.lineTotal||li.unitCost*li.quantity||0)}</span>
</div>
))}
{!billPreview.supplierFound&&<div style={{marginTop:10,fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>Supplier "{billPreview.bill?.supplierName}" not found in price-list DB — add it first before creating the bill.</div>}
<div style={{marginTop:12}}>
<OBtn col={B.orange} onClick={createBillNow} disabled={billCreating||!billPreview.supplierFound}>{billCreating?"CREATING…":"✓ CREATE BILL IN ZOHO BOOKS"}</OBtn>
</div>
</div>
)}
{billCreated&&(
<div className="card" style={{padding:16,marginTop:16,background:B.greenBg,border:`1px solid ${B.green}40`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{billCreated.billNumber||billCreated.zohoBillId}</div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.5,marginTop:2}}>{billCreated.status||'PENDING_REVIEW'}</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:10}}>
{billCreated.reviewUrl&&<a href={billCreated.reviewUrl} target="_blank" rel="noreferrer" style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue}}>VIEW IN BOOKS →</a>}
</div>
</div>
</div>
)}
</div>
);
}
function ModActivity() {
const {s}=useApp();
return (
<div style={{padding:"22px 26px"}}>
<PH title="ACTIVITY FEED" sub="Every action across deals, invoices, and outreach"/>
{s.activity.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,textAlign:"center",padding:"60px 0"}}>Activity appears as you use the platform</div>}
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{s.activity.map(a=>{const rep=(s.reps||[]).find(x=>x.id===a.userId);const ini=rep?(rep.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase():null;return(
<div key={a.id} className="card" style={{padding:"9px 12px",display:"flex",gap:9,alignItems:"flex-start"}}>
{rep&&<div style={{width:26,height:26,borderRadius:"50%",background:B.blue,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontFamily:"'Russo One',sans-serif",fontSize:9,color:B.white}}>{ini}</span></div>}
<div style={{flex:1}}><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.4}}>{a.msg}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>{rep?.name} · {new Date(a.ts).toLocaleString()}</div></div>
</div>
);})}
</div>
</div>
);
}
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
const PHASE_OPTS = ["RAPPORT","INTRO","DISCOVERY","PAIN","SOLUTION"];
const INPUT_OPTS = ["TEXT","TEXTAREA","SELECT","BOOLEAN","NUMBER"];
const INPUT_COLORS = {TEXT:B.blue,TEXTAREA:B.teal,SELECT:B.purple,BOOLEAN:B.green,NUMBER:B.orange};
function AdminQuestions() {
const {toast}=useApp();
const [questions,setQuestions]=useState([]);
const [loading,setLoading]=useState(true);
const [phase,setPhase]=useState("ALL");
const [showAdd,setShowAdd]=useState(false);
const [editId,setEditId]=useState(null);
const [dragId,setDragId]=useState(null);
const blankForm={phase:"RAPPORT",order:1,questionText:"",helpText:"",inputType:"TEXT",selectOptions:"",isRequired:false};
const [form,setForm]=useState(blankForm);
const load=async()=>{
try{const r=await fetch("/api/admin/questions");const d=await r.json();setQuestions(d.questions||[]);}
catch(e){toast("Failed to load questions: "+e.message,"error");}
setLoading(false);
};
useEffect(()=>{load();},[]);
const filtered = phase==="ALL" ? questions : questions.filter(q=>q.phase===phase);
const handleToggleActive=async(q)=>{
try{
const r=await fetch(`/api/admin/questions/${q.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({isActive:!q.isActive})});
const d=await r.json();
if(!r.ok) throw new Error(d.error);
setQuestions(prev=>prev.map(x=>x.id===q.id?d.question:x));
toast(q.isActive?"Question deactivated":"Question activated","success");
}catch(e){toast("Error: "+e.message,"error");}
};
const resetForm=()=>{setShowAdd(false);setEditId(null);setForm(blankForm);};
const handleSave=async()=>{
if(!form.questionText.trim()){toast("Question text is required","error");return;}
const body={...form,helpText:form.helpText||null,
selectOptions:form.inputType==="SELECT"&&form.selectOptions?form.selectOptions.split(",").map(s=>s.trim()).filter(Boolean):null};
try{
let r,d;
if(editId){
r=await fetch(`/api/admin/questions/${editId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
d=await r.json();if(!r.ok) throw new Error(d.error);
setQuestions(prev=>prev.map(x=>x.id===editId?d.question:x));
toast("Question updated","success");
}else{
r=await fetch("/api/admin/questions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
d=await r.json();if(!r.ok) throw new Error(d.error);
setQuestions(prev=>[...prev,d.question]);
toast("Question added","success");
}
resetForm();
}catch(e){toast("Error: "+e.message,"error");}
};
const handleDragStart=(e,id)=>{setDragId(id);e.dataTransfer.effectAllowed="move";};
const handleDragOver=(e)=>{e.preventDefault();e.dataTransfer.dropEffect="move";};
const handleDrop=async(e,targetId)=>{
e.preventDefault();
if(!dragId||dragId===targetId){setDragId(null);return;}
const ids=filtered.map(q=>q.id);
const from=ids.indexOf(dragId),to=ids.indexOf(targetId);
if(from<0||to<0){setDragId(null);return;}
const reordered=[...ids];reordered.splice(from,1);reordered.splice(to,0,dragId);
const updates=reordered.map((id,idx)=>({id,order:idx+1}));
const orderMap={};updates.forEach(u=>{orderMap[u.id]=u.order;});
setQuestions(prev=>prev.map(q=>orderMap[q.id]!=null?{...q,order:orderMap[q.id]}:q).sort((a,b)=>a.order-b.order));
try{
const r=await fetch("/api/admin/questions/reorder",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({updates})});
if(!r.ok){const d=await r.json();throw new Error(d.error);}
}catch(e){toast("Reorder failed: "+e.message,"error");load();}
setDragId(null);
};
const inp={width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"};
return (
<div>
{/* Phase filter + add button */}
<div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
{["ALL",...PHASE_OPTS].map(p=>(
<button key={p} onClick={()=>setPhase(p)} style={{background:phase===p?B.orange:B.surface,color:phase===p?B.white:B.textMid,border:`1px solid ${phase===p?B.orange:B.border}`,borderRadius:5,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>{p}</button>
))}
<button onClick={()=>{setShowAdd(true);setEditId(null);setForm(blankForm);}} style={{marginLeft:"auto",background:B.orangeBg,color:B.orange,border:`1px solid ${B.orange}40`,borderRadius:5,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.4}}>+ ADD QUESTION</button>
</div>
{/* Add / Edit form */}
{(showAdd||editId)&&(
<div className="card" style={{padding:16,marginBottom:14,borderTop:`3px solid ${B.orange}`}}>
<Lbl c={B.orange} s={{marginBottom:10}}>{editId?"EDIT QUESTION":"ADD QUESTION"}</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:9}}>
<div><Lbl s={{marginBottom:3}}>PHASE</Lbl>
<select value={form.phase} onChange={e=>setForm(f=>({...f,phase:e.target.value}))} style={inp}>
{PHASE_OPTS.map(p=><option key={p}>{p}</option>)}
</select>
</div>
<div><Lbl s={{marginBottom:3}}>ORDER</Lbl>
<input type="number" value={form.order} min={1} onChange={e=>setForm(f=>({...f,order:parseInt(e.target.value)||1}))} style={inp}/>
</div>
<div><Lbl s={{marginBottom:3}}>INPUT TYPE</Lbl>
<select value={form.inputType} onChange={e=>setForm(f=>({...f,inputType:e.target.value}))} style={inp}>
{INPUT_OPTS.map(t=><option key={t}>{t}</option>)}
</select>
</div>
</div>
<div style={{marginBottom:9}}><Lbl s={{marginBottom:3}}>QUESTION TEXT</Lbl>
<textarea value={form.questionText} onChange={e=>setForm(f=>({...f,questionText:e.target.value}))} rows={2} style={{...inp,resize:"vertical"}}/>
</div>
<div style={{marginBottom:9}}><Lbl s={{marginBottom:3}}>HELP TEXT (OPTIONAL)</Lbl>
<input value={form.helpText||""} onChange={e=>setForm(f=>({...f,helpText:e.target.value}))} style={inp}/>
</div>
{form.inputType==="SELECT"&&(
<div style={{marginBottom:9}}><Lbl s={{marginBottom:3}}>OPTIONS (COMMA-SEPARATED)</Lbl>
<input value={form.selectOptions||""} onChange={e=>setForm(f=>({...f,selectOptions:e.target.value}))} placeholder="Option 1, Option 2, Option 3" style={inp}/>
</div>
)}
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
<input type="checkbox" id="adm-req" checked={!!form.isRequired} onChange={e=>setForm(f=>({...f,isRequired:e.target.checked}))}/>
<label htmlFor="adm-req" style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text}}>Required</label>
</div>
<div style={{display:"flex",gap:6}}>
<OBtn sm onClick={handleSave}>{editId?"SAVE CHANGES":"ADD QUESTION"}</OBtn>
<button onClick={resetForm} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"4px 12px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer"}}>CANCEL</button>
</div>
</div>
)}
{/* Question list */}
{loading ? (
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,padding:"20px 0",textAlign:"center"}}>Loading questions…</div>
) : (
<div style={{display:"flex",flexDirection:"column",gap:4}}>
{filtered.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,padding:"12px 0"}}>No questions in this phase.</div>}
{filtered.map(q=>(
<div key={q.id} draggable onDragStart={e=>handleDragStart(e,q.id)} onDragOver={handleDragOver} onDrop={e=>handleDrop(e,q.id)}
style={{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",background:q.isActive?B.white:B.surface,border:`1px solid ${dragId===q.id?B.orange:B.border}`,borderRadius:6,opacity:q.isActive?1:0.5,cursor:"grab",userSelect:"none"}}>
<span style={{color:B.muted,fontSize:13,flexShrink:0}}>⋮⋮</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,width:20,flexShrink:0,textAlign:"right"}}>{q.order}</span>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.questionText}</div>
{q.helpText&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.helpText}</div>}
</div>
<span style={{background:`${INPUT_COLORS[q.inputType]||B.blue}15`,color:INPUT_COLORS[q.inputType]||B.blue,border:`1px solid ${INPUT_COLORS[q.inputType]||B.blue}30`,borderRadius:3,padding:"1px 6px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,flexShrink:0}}>{q.inputType}</span>
<button onClick={()=>handleToggleActive(q)} style={{background:q.isActive?B.greenBg:"none",color:q.isActive?B.green:B.muted,border:`1px solid ${q.isActive?`${B.green}40`:B.border}`,borderRadius:3,padding:"2px 7px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",flexShrink:0,cursor:"pointer"}}>{q.isActive?"ACTIVE":"INACTIVE"}</button>
<button onClick={()=>{setEditId(q.id);setShowAdd(false);setForm({phase:q.phase,order:q.order,questionText:q.questionText,helpText:q.helpText||"",inputType:q.inputType,selectOptions:Array.isArray(q.selectOptions)?q.selectOptions.join(", "):q.selectOptions||"",isRequired:q.isRequired});}}
style={{background:"none",border:`1px solid ${B.border}`,borderRadius:3,padding:"2px 7px",fontSize:8,fontFamily:"'Lexend',sans-serif",color:B.muted,cursor:"pointer",flexShrink:0}}>EDIT</button>
</div>
))}
</div>
)}
</div>
);
}
function AdminSponsorshipConfig() {
const {cu,toast}=useApp();
const [cfg,setCfg]=useState(null);
const [loading,setLoading]=useState(true);
const [saving,setSaving]=useState(false);
const [preview,setPreview]=useState(null);
const debounceRef=useRef(null);
useEffect(()=>{
fetch("/api/admin/sponsorship-config").then(r=>r.json())
.then(d=>{setCfg(d.config||null);setLoading(false);})
.catch(e=>{toast("Failed to load config: "+e.message,"error");setLoading(false);});
},[]);
useEffect(()=>{
if(!cfg) return;
if(debounceRef.current) clearTimeout(debounceRef.current);
debounceRef.current=setTimeout(async()=>{
try{
const r=await fetch("/api/sponsorship/calculate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schoolClass:"4A",numSports:12,numAthletes:300,hasOnlineStore:true,hasBoosterClub:true})});
const d=await r.json();
if(r.ok) setPreview(d);
}catch{}
},800);
return()=>clearTimeout(debounceRef.current);
},[cfg]);
const save=async()=>{
setSaving(true);
try{
const r=await fetch("/api/admin/sponsorship-config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...cfg,updatedBy:cu?.name||cu?.email||"admin"})});
const d=await r.json();
if(!r.ok) throw new Error(d.error);
setCfg(d.config);toast("Config saved","success");
}catch(e){toast("Save failed: "+e.message,"error");}
setSaving(false);
};
if(loading) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,padding:"20px 0",textAlign:"center"}}>Loading config…</div>;
if(!cfg) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.red,padding:12}}>Config not found — run: <code>npx prisma db seed</code></div>;
const inp={width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"};
const FNum=({k,label,prefix="$",step=1})=>(
<div><Lbl s={{marginBottom:3}}>{label}</Lbl>
<div style={{display:"flex",alignItems:"center",gap:4}}>
{prefix&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,flexShrink:0}}>{prefix}</span>}
<input type="number" value={cfg[k]??0} step={step} min={0} onChange={e=>setCfg(c=>({...c,[k]:parseFloat(e.target.value)||0}))} style={inp}/>
</div>
</div>
);
const FPct=({k,label})=>(
<div><Lbl s={{marginBottom:3}}>{label}</Lbl>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<input type="number" value={Math.round((cfg[k]||0)*10000)/100} step={0.1} min={0} max={100} onChange={e=>setCfg(c=>({...c,[k]:(parseFloat(e.target.value)||0)/100}))} style={inp}/>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,flexShrink:0}}>%</span>
</div>
</div>
);
const SC=cfg.schoolClassConfidence||{};
return (
<div>
<div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
<Lbl c={B.orange} s={{marginBottom:12}}>REVENUE ASSUMPTIONS</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:9}}>
<FNum k="avgOrderValuePerAthlete" label="AVG ORDER VALUE / ATHLETE"/>
<FNum k="avgEquipmentOrderPerSport" label="AVG EQUIPMENT ORDER / SPORT"/>
<FNum k="teamStoreRevenuePerAthlete" label="TEAM STORE REVENUE / ATHLETE"/>
<FNum k="purchaseFrequencyPerYear" label="PURCHASE FREQUENCY / YEAR" prefix="" step={0.1}/>
<FNum k="boosterMultiplier" label="BOOSTER CLUB MULTIPLIER" prefix="" step={0.01}/>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
<FPct k="netMarginPct" label="ST1 NET MARGIN"/>
<FPct k="givebackPct" label="GIVEBACK % OF NET PROFIT"/>
</div>
</div>
<div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.blue}`}}>
<Lbl c={B.blue} s={{marginBottom:6}}>SCHOOL CLASS CONFIDENCE</Lbl>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,lineHeight:1.5}}>How confident are we that a school of this size becomes a full customer? Scales the guaranteed minimum.</div>
{["1A","2A","3A","4A","5A","6A"].map(cls=>{
const val=SC[cls]??0;const pct=Math.round(val*100);
return(
<div key={cls} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.text,width:24,flexShrink:0}}>{cls}</span>
<input type="range" min={0} max={100} step={1} value={pct} onChange={e=>setCfg(c=>({...c,schoolClassConfidence:{...SC,[cls]:parseInt(e.target.value)/100}}))} style={{flex:1,accentColor:B.orange}}/>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,width:38,textAlign:"right",flexShrink:0}}>{pct}%</span>
</div>
);
})}
</div>
<div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.green}`}}>
<Lbl c={B.green} s={{marginBottom:8}}>LIVE PREVIEW — 4A school · 300 athletes · 12 sports · store + booster</Lbl>
{preview ? (
<div style={{display:"flex",gap:28,alignItems:"flex-end"}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>GUARANTEED MIN</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:B.green}}>${(preview.guaranteedMin||0).toLocaleString()}</div>
</div>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:4}}>UPSIDE MAX</div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:B.orange}}>${(preview.upsideMax||0).toLocaleString()}</div>
</div>
{preview.breakdown&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.7}}>
Projected revenue: ${Math.round(preview.breakdown.projectedRevenue).toLocaleString()}<br/>
Net profit: ${Math.round(preview.breakdown.netProfit).toLocaleString()}<br/>
Giveback pool: ${Math.round(preview.breakdown.givebackPool).toLocaleString()}
</div>}
</div>
) : (
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Calculating preview…</div>
)}
</div>
<div style={{display:"flex",alignItems:"center",gap:14}}>
<OBtn onClick={save} disabled={saving}>{saving?"SAVING…":"SAVE CONFIGURATION"}</OBtn>
{cfg.lastUpdatedBy&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Last updated by {cfg.lastUpdatedBy} on {new Date(cfg.updatedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>}
</div>
</div>
);
}
function ModAdmin() {
const {cu}=useApp();
const [tab,setTab]=useState("questions");
const TABS=[{id:"questions",label:"Talk Track Questions"},{id:"config",label:"Sponsorship Config"}];
if(!cu?.isAdmin) return(
<div style={{padding:48,textAlign:"center",fontFamily:"'Lexend',sans-serif",color:B.muted,fontSize:13}}>
Admin access required.<br/>
<span style={{fontSize:11}}>Ask an existing admin to toggle the ◐ MAKE ADMIN button in Settings → Sales Reps.</span>
</div>
);
return(
<div style={{padding:"22px 26px",maxWidth:920}}>
<PH title="ADMIN PANEL" sub="Talk Track question bank and sponsorship calculation config"/>
<div style={{display:"flex",gap:0,marginBottom:22,borderBottom:`1px solid ${B.border}`}}>
{TABS.map(t=>(
<button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${B.orange}`:"2px solid transparent",padding:"9px 20px",fontSize:12,fontFamily:"'Lexend',sans-serif",fontWeight:tab===t.id?600:400,color:tab===t.id?B.orange:B.muted,cursor:"pointer",marginBottom:-1}}>
{t.label}
</button>
))}
</div>
{tab==="questions"&&<AdminQuestions/>}
{tab==="config"&&<AdminSponsorshipConfig/>}
</div>
);
}
const MARGIN_TARGET=20,MARGIN_WARN=15,MARGIN_CRITICAL=10;
function getMarginStatus(cost,price){
const m=cost&&price?((price-cost)/price*100):0;
if(m<MARGIN_CRITICAL) return{color:"#C0392B",bg:"#FDECEA",label:"Critical"};
if(m<MARGIN_WARN)     return{color:"#C77800",bg:"#FFF8E6",label:"Low"};
if(m>=MARGIN_TARGET)  return{color:"#1E8F4E",bg:"#EAF7EE",label:"Good"};
return                      {color:"#1A5FA8",bg:"#E8F0FA",label:"OK"};
}
function ModPriceLists() {
const {s,dispatch,toast}=useApp();
const [selId,setSelId]=useState(null);
const [tab,setTab]=useState("own");
const [showUpload,setShowUpload]=useState(false);
const [editItem,setEditItem]=useState(null);
const [searchQ,setSearchQ]=useState("");
const [dbSaving,setDbSaving]=useState(false);
const [dbSaveMsg,setDbSaveMsg]=useState(null);
const [dbSnapshot,setDbSnapshot]=useState(null);
const [dbSnapshotLoading,setDbSnapshotLoading]=useState(false);
// Ground truth of what's actually in the database right now — independent
// of local sync-status flags, which only reflect what THIS browser last
// pushed and could drift if the DB was changed some other way.
const fetchDbSnapshot=useCallback(async()=>{
setDbSnapshotLoading(true);
try{
const r=await fetch("/api/pricelists");
const d=await r.json();
if(d.ok) setDbSnapshot({
suppliers:(d.suppliers||[]).map(sup=>({id:sup.id,name:sup.name,items:sup.products.length,lastUpdated:sup.lastUpdated})),
competitors:(d.competitors||[]).map(sup=>({id:sup.id,name:sup.competitorName,items:sup.items.length,lastUpdated:sup.lastUpdated})),
fetchedAt:Date.now(),
});
}catch{}
setDbSnapshotLoading(false);
},[]);
useEffect(()=>{fetchDbSnapshot();},[fetchDbSnapshot]);
// A list is "dirty" — needs saving — if it's never been synced, or its
// item count has changed since the last successful sync. This is what lets
// SAVE TO DB skip lists that are already up to date instead of re-writing
// everything on every click.
const isDirty=(pl)=>!pl.dbSyncedAt||pl.dbItemCount!==(pl.items||[]).length;
const saveToDB=async()=>{
  const own=(s.priceLists||[]).filter(pl=>pl.type==="own"&&isDirty(pl));
  const comp=(s.priceLists||[]).filter(pl=>pl.type==="competitor"&&isDirty(pl));
  const skipped=(s.priceLists||[]).length-own.length-comp.length;
  if(!own.length&&!comp.length){toast(skipped?"Everything is already up to date in the database":"No price lists to save","info");return;}
  setDbSaving(true);setDbSaveMsg(null);
  let totalItems=0;
  const CHUNK=500;
  const postJSON=(url,body)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try{
    // ── Own supplier lists ──────────────────────────────────────────────
    for(const pl of own){
      await postJSON("/api/pricelists/supplier",{id:pl.id,name:pl.name,
        category:pl.supplierName||pl.name,rep:pl.repName||null,
        repEmail:pl.repEmail||null,repPhone:pl.repPhone||null,
        notes:pl.notes||null,
        lastUpdated:pl.uploadedAt?new Date(pl.uploadedAt).toISOString().slice(0,10):null});
      const products=(pl.items||[]).map((it,i)=>({
        id:`${pl.id}_${i}`,sku:it.sku||null,name:it.name||"Item",
        category:it.category||null,unit:it.unit||"each",
        cost:it.cost||null,ourPrice:it.price||null,map:it.map||null,
      }));
      for(let j=0;j<products.length;j+=CHUNK)
        await postJSON("/api/pricelists/items",{supplierId:pl.id,products:products.slice(j,j+CHUNK)});
      totalItems+=products.length;
      dispatch("UPDATE_PRICE_LIST",{id:pl.id,dbSupplierId:pl.id,dbSyncedAt:Date.now(),dbItemCount:products.length});
    }
    // ── Competitor price lists ──────────────────────────────────────────
    // Stored in same tables, tagged with __COMPETITOR__: prefix in category
    for(const pl of comp){
      const sid=`comp_${pl.id}`;
      const cname=pl.competitorName||pl.name;
      await postJSON("/api/pricelists/supplier",{id:sid,name:cname,
        category:`__COMPETITOR__:${cname}`,rep:null,repEmail:null,repPhone:null,
        notes:pl.notes||pl.source||null,
        lastUpdated:pl.uploadedAt?new Date(pl.uploadedAt).toISOString().slice(0,10):null});
      const products=(pl.items||[]).map((it,i)=>({
        id:`${sid}_${i}`,sku:it.sku||null,name:it.name||"Item",
        category:it.category||null,unit:it.unit||"each",
        cost:it.cost||null,ourPrice:null,map:it.map||null,
      }));
      for(let j=0;j<products.length;j+=CHUNK)
        await postJSON("/api/pricelists/items",{supplierId:sid,products:products.slice(j,j+CHUNK)});
      totalItems+=products.length;
      dispatch("UPDATE_PRICE_LIST",{id:pl.id,dbSupplierId:sid,dbSyncedAt:Date.now(),dbItemCount:products.length});
    }
    const msg=`✓ ${own.length} supplier${own.length!==1?"s":""}${comp.length?` · ${comp.length} competitor${comp.length!==1?"s":""}`:"" } · ${totalItems} items saved${skipped?` · ${skipped} already up to date`:""}`;
    setDbSaveMsg(msg);
    setTimeout(()=>setDbSaveMsg(null),6000);
    toast("Price lists saved — Edgar can now use both supplier costs and competitor pricing","success");
    fetchDbSnapshot();
  }catch(e){
    setDbSaveMsg(`Save failed: ${e.message}`);
    toast("DB save failed","error");
  }
  setDbSaving(false);
};
const allLists=s.priceLists||[];
const ownLists=useMemo(()=>allLists.filter(pl=>pl.type==="own"),[allLists]);
const compLists=useMemo(()=>allLists.filter(pl=>pl.type==="competitor"),[allLists]);
const lists=tab==="own"?ownLists:compLists;
const selected=useMemo(()=>selId?allLists.find(pl=>pl.id===selId):null,[allLists,selId]);
const totalProducts=useMemo(()=>allLists.reduce((a,pl)=>a+(pl.items||[]).length,0),[allLists]);
const anyDirty=useMemo(()=>allLists.some(isDirty),[allLists]);
const {avgMargin,lowCount}=useMemo(()=>{
let sum=0,cnt=0,low=0;
ownLists.forEach(pl=>(pl.items||[]).forEach(it=>{
if(it.cost>0&&it.price>0){
const m=(it.price-it.cost)/it.price*100;
sum+=m;cnt++;
if(m<MARGIN_WARN) low++;
}
}));
return{avgMargin:cnt?Math.round(sum/cnt):0,lowCount:low};
},[ownLists]);
useEffect(()=>{
const first=(tab==="own"?ownLists:compLists)[0];
setSelId(first?.id||null);
setSearchQ("");
},[tab]);
const filteredItems=useMemo(()=>{
const items=selected?.items||[];
if(!searchQ.trim()) return items;
const q=searchQ.toLowerCase();
return items.filter(it=>(it.name||"").toLowerCase().includes(q)||(it.sku||"").toLowerCase().includes(q)||(it.category||"").toLowerCase().includes(q));
},[selected,searchQ]);
const hasMAP=useMemo(()=>(selected?.items||[]).some(it=>it.map>0),[selected]);
const delList=(id)=>{
if(!window.confirm("Delete this price list?")) return;
dispatch("DEL_PRICE_LIST",id);
setSelId(null);
toast("Price list deleted","success");
};
const th={padding:"7px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.8,borderBottom:`1px solid ${B.border}`,whiteSpace:"nowrap"};
return(
<div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
{/* TOP STATS BAR */}
<div style={{padding:"8px 16px",borderBottom:`1px solid ${B.border}`,background:B.surface,display:"flex",alignItems:"center",gap:16,flexShrink:0,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>{ownLists.length} SUPPLIERS</span>
<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>{totalProducts} PRODUCTS</span>
{ownLists.length>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5}}>{avgMargin}% AVG MARGIN</span>}
{lowCount>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:"#C77800",letterSpacing:.5,background:"#FFF8E6",borderRadius:3,padding:"1px 5px"}}>{lowCount} LOW MARGIN</span>}
{compLists.length>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.5}}>{compLists.length} COMPETITOR SOURCES</span>}
{dbSnapshot&&<span title={`Last checked ${new Date(dbSnapshot.fetchedAt).toLocaleTimeString()}`} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,letterSpacing:.5,background:B.greenBg,borderRadius:3,padding:"1px 5px"}}>DB HAS: {dbSnapshot.suppliers.length} SUPPLIERS · {dbSnapshot.suppliers.reduce((a,s)=>a+s.items,0)+dbSnapshot.competitors.reduce((a,s)=>a+s.items,0)} ITEMS</span>}
<button onClick={fetchDbSnapshot} disabled={dbSnapshotLoading} title="Re-check what's actually saved in the database" style={{background:"none",border:"none",color:B.muted,fontSize:11,cursor:dbSnapshotLoading?"default":"pointer",padding:0}}>{dbSnapshotLoading?"⟳":"↻"}</button>
<div style={{flex:1}}/>
{dbSaveMsg&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:dbSaveMsg.startsWith("✓")?B.green:B.red}}>{dbSaveMsg}</span>}
<button onClick={saveToDB} disabled={dbSaving||!anyDirty} title={anyDirty?"":"Every list already matches what's in the database"} style={{padding:"6px 14px",background:dbSaving?"#aaa":anyDirty?B.green:B.border,color:anyDirty?"#fff":B.muted,border:"none",borderRadius:5,fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:(dbSaving||!anyDirty)?"not-allowed":"pointer",opacity:dbSaving?.7:1}}>
  {dbSaving?"SAVING…":anyDirty?"SAVE TO DB":"✓ ALL SYNCED"}
</button>
<button onClick={()=>setShowUpload(true)} style={{padding:"6px 14px",background:B.orange,color:"#fff",border:"none",borderRadius:5,fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:"pointer"}}>+ UPLOAD LIST</button>
</div>
<div style={{display:"flex",flex:1,overflow:"hidden"}}>
{/* LEFT RAIL */}
<div style={{width:220,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0,background:B.surface}}>
<div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
{/* OUR SUPPLIERS section */}
<div style={{padding:"8px 12px 4px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:.8}}>OUR SUPPLIERS</div>
{ownLists.length===0&&(
<div style={{padding:"6px 12px 10px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>No supplier lists yet</div>
)}
{ownLists.map(pl=>{
const lowItems=(pl.items||[]).filter(it=>it.cost>0&&it.price>0&&(it.price-it.cost)/it.price*100<MARGIN_WARN).length;
return(
<div key={pl.id} onClick={()=>{setSelId(pl.id);setTab("own");setSearchQ("");}} style={{padding:"7px 12px",cursor:"pointer",borderLeft:`3px solid ${selId===pl.id?B.orange:"transparent"}`,background:selId===pl.id?`${B.orange}08`:"transparent",borderBottom:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pl.supplierName||pl.name}</div>
<div style={{display:"flex",gap:6,alignItems:"center",marginTop:2,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{(pl.items||[]).length} items</span>
{lowItems>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:"#C77800",background:"#FFF8E6",borderRadius:2,padding:"0 4px",letterSpacing:.3}}>{lowItems} LOW</span>}
<DbSyncBadge pl={pl} sm/>
</div>
</div>
);
})}
{/* COMPETITOR PRICING section */}
<div style={{padding:"12px 12px 4px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:.8}}>COMPETITOR PRICING</div>
{compLists.length===0&&(
<div style={{padding:"6px 12px 10px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>No competitor data yet</div>
)}
{compLists.map(pl=>(
<div key={pl.id} onClick={()=>{setSelId(pl.id);setTab("competitor");setSearchQ("");}} style={{padding:"7px 12px",cursor:"pointer",borderLeft:`3px solid ${selId===pl.id?B.blue:"transparent"}`,background:selId===pl.id?`${B.blue}08`:"transparent",borderBottom:`1px solid ${B.border}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:500,color:B.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pl.competitorName||pl.name}</div>
<div style={{display:"flex",gap:6,alignItems:"center",marginTop:2,flexWrap:"wrap"}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{(pl.items||[]).length} items</span>
{pl.source&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.3}}>{pl.source.slice(0,10).toUpperCase()}</span>}
<DbSyncBadge pl={pl} sm/>
</div>
</div>
))}
</div>
<div style={{padding:"10px 12px",borderTop:`1px solid ${B.border}`}}>
<button onClick={()=>setShowUpload(true)} style={{width:"100%",padding:"7px 0",background:"transparent",color:B.orange,border:`1px solid ${B.orange}`,borderRadius:5,fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,cursor:"pointer"}}>+ UPLOAD</button>
</div>
</div>
{/* MAIN AREA */}
<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
{!selected&&(
<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
<div style={{fontSize:32,opacity:.3}}>$</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted}}>Select a price list or upload one to get started</div>
<button onClick={()=>setShowUpload(true)} style={{padding:"8px 18px",background:B.orange,color:"#fff",border:"none",borderRadius:6,fontSize:11,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>UPLOAD PRICE LIST</button>
</div>
)}
{selected&&(
<>
{/* HEADER */}
<div style={{padding:"12px 18px 10px",borderBottom:`1px solid ${B.border}`,flexShrink:0}}>
<div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:6}}>
<div style={{flex:1}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:14,fontWeight:500,color:B.text,marginBottom:3}}>{selected.name}</div>
<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
{selected.source&&<Pill v={selected.source} sc={B.blue} bc={B.blue}/>}
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{(selected.items||[]).length} items · {new Date(selected.uploadedAt).toLocaleDateString()}</span>
<DbSyncBadge pl={selected}/>
</div>
</div>
<button onClick={()=>delList(selected.id)} style={{background:B.redBg,color:B.red,border:"none",borderRadius:5,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif",cursor:"pointer",flexShrink:0}}>DELETE</button>
</div>
{/* Rep info for own lists */}
{selected.type==="own"&&(selected.supplierName||selected.repName||selected.repEmail||selected.repPhone)&&(
<div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
{selected.supplierName&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.text,fontWeight:500}}>{selected.supplierName}</span>}
{selected.repName&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Rep: {selected.repName}</span>}
{selected.repEmail&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>{selected.repEmail}</span>}
{selected.repPhone&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{selected.repPhone}</span>}
</div>
)}
{selected.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4,fontStyle:"italic"}}>{selected.notes}</div>}
</div>
{/* SEARCH */}
<div style={{padding:"8px 18px",borderBottom:`1px solid ${B.border}`,flexShrink:0}}>
<input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search items by name, SKU, or category..." style={{width:"100%",padding:"6px 10px",border:`1px solid ${B.border}`,borderRadius:5,fontSize:11,fontFamily:"'Lexend',sans-serif",color:B.text,background:B.surface}}/>
</div>
{/* ITEMS TABLE */}
<div style={{flex:1,overflowY:"auto"}}>
<table style={{width:"100%",borderCollapse:"collapse"}}>
<thead>
<tr style={{background:B.surface,position:"sticky",top:0,zIndex:1}}>
<th style={{...th,textAlign:"left"}}>ITEM</th>
<th style={{...th,textAlign:"left"}}>SKU</th>
<th style={{...th,textAlign:"left"}}>CATEGORY</th>
<th style={{...th,textAlign:"left"}}>UNIT</th>
{selected.type==="own"?(
<>
<th style={{...th,textAlign:"right"}}>OUR COST</th>
<th style={{...th,textAlign:"right"}}>OUR PRICE</th>
<th style={{...th,textAlign:"center"}}>MARGIN</th>
{hasMAP&&<th style={{...th,textAlign:"right"}}>MAP</th>}
</>
):(
<>
<th style={{...th,textAlign:"right"}}>THEIR PRICE</th>
<th style={{...th,textAlign:"left"}}>NOTES</th>
</>
)}
<th style={{...th}}/>
</tr>
</thead>
<tbody>
{filteredItems.map((it,i)=>{
const ms=selected.type==="own"?getMarginStatus(it.cost,it.price):null;
return(
<tr key={it.id||i} style={{borderBottom:`1px solid ${B.border}`,background:i%2===0?"transparent":B.surface}}>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,maxWidth:220}}>
<div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
{it.notes&&selected.type!=="own"&&<div style={{fontSize:9,color:B.muted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.notes}</div>}
</td>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{it.sku||"—"}</td>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{it.category||"—"}</td>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{it.unit||"—"}</td>
{selected.type==="own"?(
<>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"right"}}>{it.cost>0?`$${Number(it.cost).toFixed(2)}`:"—"}</td>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",fontWeight:500}}>{it.price>0?`$${Number(it.price).toFixed(2)}`:"—"}</td>
<td style={{padding:"7px 12px",textAlign:"center"}}>
{ms&&it.cost>0&&it.price>0?<span style={{background:ms.bg,color:ms.color,borderRadius:4,padding:"2px 6px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3}}>{ms.label}</span>:"—"}
</td>
{hasMAP&&<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"right"}}>{it.map>0?`$${Number(it.map).toFixed(2)}`:"—"}</td>}
</>
):(
<>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,textAlign:"right",fontWeight:500}}>{it.price>0?`$${Number(it.price).toFixed(2)}`:"—"}</td>
<td style={{padding:"7px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{it.notes||"—"}</td>
</>
)}
<td style={{padding:"7px 8px",textAlign:"right"}}>
<button onClick={()=>setEditItem({listId:selected.id,item:{...it},listType:selected.type})} style={{background:"none",border:"none",color:B.blue,fontSize:10,cursor:"pointer",padding:"2px 4px"}}>✎</button>
</td>
</tr>
);
})}
</tbody>
</table>
{filteredItems.length===0&&searchQ&&(
<div style={{padding:"28px",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>No items match "{searchQ}"</div>
)}
{filteredItems.length===0&&!searchQ&&selected&&(
<div style={{padding:"28px",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>This list has no items.</div>
)}
</div>
</>
)}
</div>
</div>
{/* UPLOAD MODAL */}
{showUpload&&<PLUploadModal onClose={()=>setShowUpload(false)} onSave={(pl)=>{dispatch("ADD_PRICE_LIST",pl);setSelId(pl.id);setTab(pl.type);setShowUpload(false);toast(`"${pl.name}" saved — ${pl.items.length} items`,"success");}} existingLists={allLists}/>}
{/* EDIT ITEM MODAL */}
{editItem&&<PLEditItemModal listType={editItem.listType} item={editItem.item} onSave={(updates)=>{dispatch("UPDATE_PRICE_LIST_ITEM",{listId:editItem.listId,itemId:editItem.item.id,updates});setEditItem(null);toast("Item updated","success");}} onClose={()=>setEditItem(null)}/>}
</div>
);
}
function PLEditItemModal({listType, item, onSave, onClose}) {
const [form,setForm]=useState({...item});
const f=(k,v)=>setForm(p=>({...p,[k]:v}));
const commonFields=[["name","Item Name","text"],["sku","SKU","text"],["category","Category","text"],["unit","Unit","text"]];
const ownFields=[["cost","Our Cost (what we pay)","number"],["price","Our Price (what we charge)","number"],["map","MAP Price","number"]];
const compFields=[["price","Their Price","number"],["notes","Notes","text"]];
const fields=[...commonFields,...(listType==="own"?ownFields:compFields)];
return(
<div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
<div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:10,boxShadow:"0 20px 60px rgba(0,0,0,.2)",width:440,padding:20}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,letterSpacing:.5,color:B.text,marginBottom:14}}>EDIT ITEM</div>
{fields.map(([k,lbl,type])=>(
<div key={k} style={{marginBottom:9}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:3}}>{lbl.toUpperCase()}</div>
<input type={type} value={form[k]||""} onChange={e=>f(k,type==="number"?parseFloat(e.target.value)||0:e.target.value)} style={{width:"100%",padding:"6px 9px",border:`1px solid ${B.border}`,borderRadius:5,fontSize:11,fontFamily:"'Lexend',sans-serif"}}/>
</div>
))}
<div style={{display:"flex",gap:8,marginTop:14}}>
<OBtn onClick={()=>onSave(form)}>SAVE</OBtn>
<GBtn onClick={onClose}>CANCEL</GBtn>
</div>
</div>
</div>
);
}
function PLUploadModal({onClose, onSave, existingLists}) {
const [step,setStep]=useState(1);
const [name,setName]=useState("");
const [type,setType]=useState("own");
const [supplierName,setSupplierName]=useState("");
const [repName,setRepName]=useState("");
const [repEmail,setRepEmail]=useState("");
const [repPhone,setRepPhone]=useState("");
const [competitorName,setCompetitorName]=useState("");
const [source,setSource]=useState("Catalog");
const [notes,setNotes]=useState("");
const [rawRows,setRawRows]=useState(null);
const [headers,setHeaders]=useState([]);
const [mapping,setMapping]=useState({});
const [loading,setLoading]=useState(false);
const [loadMsg,setLoadMsg]=useState("");
const [error,setError]=useState("");
const [manualMode,setManualMode]=useState(false);
const fileRef=useRef(null);
const FIELDS=useMemo(()=>[
{key:"name",    label:"Item Name",   required:true},
{key:"sku",     label:"SKU",         required:false},
{key:"category",label:"Category",    required:false},
{key:"unit",    label:"Unit",        required:false},
{key:"cost",    label:type==="own"?"Our Cost (dealer price)":"(skip)",  required:false},
{key:"price",   label:type==="own"?"Our Price (sell price)":"Their Price", required:false},
{key:"map",     label:"MAP Price",   required:false},
{key:"notes",   label:"Notes",       required:false},
],[type]);
const autoDetect=(hdrs)=>{
const m={};
const lc=hdrs.map(h=>(h||"").toLowerCase());
const guess=(terms)=>lc.findIndex(h=>terms.some(t=>h.includes(t)));
m.name     = guess(["item name","name","product","description","item"]);
m.sku      = guess(["sku","item code","code","part"]);
m.category = guess(["category","cat","type","group"]);
m.unit     = guess(["unit","uom","each","qty"]);
m.cost     = guess(["cost","dealer","wholesale","our cost"]);
m.price    = guess(["price","sell","our price","rate","unit price","competitor"]);
m.map      = guess(["map","minimum advertised"]);
m.notes    = guess(["note","comment","remark"]);
return m;
};
const parseCSVRows=(text)=>{
return text.split(/\r?\n/).filter(l=>l.trim()).map(l=>{
const res=[];let cur="",inQ=false;
for(let ci=0;ci<l.length;ci++){
const ch=l[ci];
if(ch==='"'){inQ=!inQ;}
else if(ch===","&&!inQ){res.push(cur.trim());cur="";}
else{cur+=ch;}
}
res.push(cur.trim());
return res;
});
};
// Shared AI-extraction path for PDFs (always) and CSV/XLSX (unless the user
// picks "map manually instead") — one supplier list this often spans several
// messy tabs with the real header row buried a few lines down, which is
// exactly the kind of thing worth handing to the model instead of asking a
// human to fix a column-mapping dropdown by hand.
const runAiExtraction=async(contentBlocks)=>{
setLoadMsg("Extracting data with AI...");
const resp=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
model:"claude-sonnet-4-6",max_tokens:16000,stream:true,
system:"Return ONLY valid JSON, no markdown, no code fences.",
messages:[{role:"user",content:contentBlocks}]
})});
if(!resp.ok){
let e=`HTTP ${resp.status}`;
try{const j=await resp.json();e=j.error||j.message||e;}
catch{try{const t=await resp.text();e=`HTTP ${resp.status}: ${t.slice(0,200)}`;}catch{}}
throw new Error(e);
}
setLoadMsg("Extracting data with AI (this may take a minute for large files)...");
const reader=resp.body.getReader();const decoder=new TextDecoder();
let accumulated="";let buf="";
while(true){
const{done,value}=await reader.read();
if(done) break;
buf+=decoder.decode(value,{stream:true});
const lines=buf.split("\n");
buf=lines.pop()||"";
for(const line of lines){
if(!line.startsWith("data: ")) continue;
const raw=line.slice(6).trim();
if(!raw||raw==="[DONE]") continue;
try{
const ev=JSON.parse(raw);
if(ev.type==="content_block_delta"&&ev.delta?.type==="text_delta") accumulated+=ev.delta.text;
else if(ev.type==="error") throw new Error(ev.error?.message||ev.error?.type||"Anthropic stream error");
}catch(parseErr){if(!(parseErr instanceof SyntaxError)) throw parseErr;}
}
}
let txt=accumulated.trim();
if(!txt) throw new Error("AI returned empty response — the file may be too large or unsupported");
txt=txt.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
let parsed;
try{
parsed=JSON.parse(txt);
}catch{
const lastBrace=txt.lastIndexOf("}");
if(lastBrace>0) txt=txt.slice(0,lastBrace+1);
txt=txt.replace(/,(\s*[}\]])/g,"$1");
const openBrackets=(txt.match(/\[/g)||[]).length-(txt.match(/\]/g)||[]).length;
const openBraces=(txt.match(/\{/g)||[]).length-(txt.match(/\}/g)||[]).length;
txt+="]".repeat(Math.max(0,openBrackets))+"}".repeat(Math.max(0,openBraces));
parsed=JSON.parse(txt);
}
if(!name&&parsed.supplierName) setName(parsed.supplierName);
if(!supplierName&&parsed.supplierName) setSupplierName(parsed.supplierName);
if(!repName&&parsed.repName) setRepName(parsed.repName||"");
if(!repEmail&&parsed.repEmail) setRepEmail(parsed.repEmail||"");
if(!repPhone&&parsed.repPhone) setRepPhone(parsed.repPhone||"");
const items=(parsed.products||[]).map(p=>({
id:mkId(),name:p.name||"",sku:p.sku||"",category:p.category||"",unit:p.unit||"each",
cost:parseFloat(p.cost)||0,price:parseFloat(p.price)||0,map:parseFloat(p.map)||0,notes:p.notes||""
}));
if(!items.length) throw new Error("AI couldn't find any products in this file — try \"map columns manually instead\" below");
setRawRows(items.map(it=>[it.name,it.sku,it.category,it.unit,it.cost,it.price,it.map,it.notes]));
const syntheticHdrs=["name","sku","category","unit","cost","price","map","notes"];
setHeaders(syntheticHdrs);
setMapping({name:0,sku:1,category:2,unit:3,cost:4,price:5,map:6,notes:7});
setStep(3);
};
const handleFile=async(f)=>{
if(!f) return;
setLoading(true);setError("");setLoadMsg("");
const isPdf=f.name.toLowerCase().endsWith(".pdf");
const isCsv=f.name.toLowerCase().endsWith(".csv");
try{
if(isPdf){
setLoadMsg("Reading PDF...");
const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
await runAiExtraction([
{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},
{type:"text",text:"Extract this supplier price list. Return JSON: {\"supplierName\":\"\",\"repName\":null,\"repEmail\":null,\"repPhone\":null,\"products\":[{\"sku\":\"\",\"name\":\"\",\"cost\":0,\"price\":null,\"map\":null,\"category\":\"\",\"unit\":\"each\",\"notes\":\"\"}]} cost=dealer/wholesale price. price=suggested sell price or null. map=MAP price or null. Return ONLY the raw JSON object. No markdown. No explanation."}
]);
}else if(!manualMode){
let sheetsText;
if(isCsv){
setLoadMsg("Reading CSV...");
sheetsText=`=== ${f.name} ===\n${await f.text()}`;
}else{
setLoadMsg("Reading spreadsheet...");
const XLSX=await import("xlsx");
const buf=await toBuffer(f);
const wb=XLSX.read(new Uint8Array(buf),{type:"array"});
sheetsText=wb.SheetNames.map(sn=>`=== Sheet: ${sn} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`).join("\n\n");
}
const MAX_CHARS=180000;
if(sheetsText.length>MAX_CHARS) sheetsText=sheetsText.slice(0,MAX_CHARS)+"\n\n[...truncated, file was larger than could be fully processed]";
if(!name) setName(f.name.replace(/\.[^.]+$/,""));
await runAiExtraction([
{type:"text",text:sheetsText},
{type:"text",text:"This is a raw export of one or more tabs from a supplier price list spreadsheet. Treat it as messy: the real header row may not be the first line (there can be title/note rows above it), columns can be in any order or use inconsistent names, and there may be multiple tabs that all need combining into one product list — if a tab's name looks like a category (e.g. a sport or product line) and there's no explicit category column, use the tab name as that item's category. Skip rows that clearly aren't products (titles, subtotals, blank separators). Extract a clean, consolidated list. Return JSON: {\"supplierName\":\"\",\"repName\":null,\"repEmail\":null,\"repPhone\":null,\"products\":[{\"sku\":\"\",\"name\":\"\",\"cost\":0,\"price\":null,\"map\":null,\"category\":\"\",\"unit\":\"each\",\"notes\":\"\"}]} cost=dealer/wholesale price. price=suggested sell price or null. map=MAP price or null. Return ONLY the raw JSON object. No markdown. No explanation."}
]);
}else{
let rows;
if(isCsv){
rows=parseCSVRows(await f.text());
}else{
const XLSX=await import("xlsx");
const buf=await toBuffer(f);
const wb=XLSX.read(new Uint8Array(buf),{type:"array"});
const ws=wb.Sheets[wb.SheetNames[0]];
rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
}
if(!rows||rows.length<2){setError("File appears empty or unreadable");setLoading(false);return;}
const hdrs=(rows[0]||[]).map(h=>String(h||"").trim());
setHeaders(hdrs);
setRawRows(rows.slice(1));
setMapping(autoDetect(hdrs));
if(!name) setName(f.name.replace(/\.[^.]+$/,""));
setStep(2);
}
}catch(err){setError("Could not parse file: "+err.message);}
setLoading(false);setLoadMsg("");
};
const handleDrop=async(e)=>{
e.preventDefault();
const f=e.dataTransfer.files?.[0];
if(f) await handleFile(f);
};
const buildItems=useCallback(()=>{
if(!rawRows) return[];
if(headers[0]==="name"&&headers[1]==="sku"&&headers[3]==="unit"){
return rawRows.filter(r=>r[0]).map((r,i)=>({
id:mkId(),name:String(r[0]||`Item ${i+1}`),sku:String(r[1]||""),category:String(r[2]||""),
unit:String(r[3]||"each"),cost:parseFloat(r[4])||0,price:parseFloat(r[5])||0,
map:parseFloat(r[6])||0,notes:String(r[7]||""),
}));
}
return rawRows.filter(row=>row.some(c=>String(c||"").trim())).map((row,i)=>{
const g=(k)=>{const idx=mapping[k];return(idx!=null&&idx>=0)?String(row[idx]||"").trim():"";}
return{id:mkId(),name:g("name")||`Item ${i+1}`,sku:g("sku"),category:g("category"),
unit:g("unit")||"each",cost:parseFloat(g("cost"))||0,price:parseFloat(g("price"))||0,
map:parseFloat(g("map"))||0,notes:g("notes")};
}).filter(it=>it.name);
},[rawRows,mapping,headers]);
const previewItems=useMemo(()=>buildItems().slice(0,5),[buildItems]);
const handleSave=()=>{
if(!name.trim()){setError("Please enter a list name.");return;}
if(type==="competitor"&&!competitorName.trim()){setError("Please enter the competitor name.");return;}
const items=buildItems();
if(items.length===0){setError("No items could be parsed.");return;}
// A name match against an existing list is treated as updating that same
// list in place (same id, and the same DB record once saved) rather than
// creating a second, disconnected entry with the same name — re-uploading
// a newer version of a supplier's catalog should never leave two copies
// behind, one stale in the database.
const dup=(existingLists||[]).find(pl=>pl.name.toLowerCase()===name.toLowerCase()&&pl.type===type);
if(dup&&!window.confirm(`"${name}" already exists (${(dup.items||[]).length} items). This will UPDATE that existing list — including its database record once saved — with the ${items.length} items from this file, not create a second copy. Continue?`)) return;
onSave({id:dup?.id||mkId(),name:name.trim(),type,
supplierName:type==="own"?supplierName.trim():"",
repName:type==="own"?repName.trim():"",
repEmail:type==="own"?repEmail.trim():"",
repPhone:type==="own"?repPhone.trim():"",
competitorName:type==="competitor"?competitorName.trim():"",
source:source.trim()||"Upload",notes:notes.trim(),
// Carry the DB link forward so the next save updates the same row, but
// drop the sync bookkeeping — this content hasn't been saved yet, so it
// should show as out of sync until the user saves again.
dbSupplierId:dup?.dbSupplierId||null,dbSyncedAt:null,dbItemCount:null,
uploadedAt:Date.now(),items});
};
const inp={width:"100%",padding:"7px 10px",border:`1px solid ${B.border}`,borderRadius:5,fontSize:11,fontFamily:"'Lexend',sans-serif"};
const lbl={fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:.5,marginBottom:4,display:"block"};
return(
<div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
<div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,boxShadow:"0 24px 80px rgba(0,0,0,.25)",width:"100%",maxWidth:620,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
{/* Header */}
<div style={{padding:"16px 20px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:11,letterSpacing:.5}}>UPLOAD PRICE LIST</div>
<div style={{display:"flex",gap:0,marginTop:6}}>
{["1 Info","2 File","3 Preview"].map((lbtext,idx)=>{
const sn=idx+1;
return(<span key={sn} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:.3,padding:"2px 8px",borderRadius:3,background:step===sn?B.orange:"transparent",color:step===sn?"#fff":B.muted,marginRight:2}}>{lbtext}</span>);
})}
</div>
</div>
<button onClick={onClose} style={{background:"none",border:"none",color:B.muted,fontSize:16,cursor:"pointer"}}>✕</button>
</div>
<div style={{flex:1,overflowY:"auto",padding:20}}>
{error&&<div style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}30`,borderRadius:5,padding:"8px 12px",marginBottom:12,fontFamily:"'Lexend',sans-serif",fontSize:11}}>{error}</div>}
{/* STEP 1: INFO */}
{step===1&&(
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
<div style={{gridColumn:"1/-1"}}>
<label style={lbl}>LIST NAME *</label>
<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Blazer Athletic 2025 Catalog" style={inp}/>
</div>
<div>
<label style={lbl}>TYPE *</label>
<select value={type} onChange={e=>setType(e.target.value)} style={{...inp,background:"#fff"}}>
<option value="own">Our Prices (supplier)</option>
<option value="competitor">Competitor Pricing</option>
</select>
</div>
<div>
<label style={lbl}>SOURCE</label>
<select value={source} onChange={e=>setSource(e.target.value)} style={{...inp,background:"#fff"}}>
<option>Catalog</option>
<option>PDF Catalog</option>
<option>RFP Result</option>
<option>Quote</option>
<option>Website</option>
<option>Sales Rep</option>
<option>CSV Upload</option>
<option>Manual</option>
<option>Other</option>
</select>
</div>
{type==="own"&&(
<>
<div>
<label style={lbl}>SUPPLIER NAME</label>
<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="e.g. Blazer Athletic" style={inp}/>
</div>
<div>
<label style={lbl}>REP NAME</label>
<input value={repName} onChange={e=>setRepName(e.target.value)} placeholder="e.g. John Smith" style={inp}/>
</div>
<div>
<label style={lbl}>REP EMAIL</label>
<input value={repEmail} onChange={e=>setRepEmail(e.target.value)} placeholder="rep@supplier.com" style={inp}/>
</div>
<div>
<label style={lbl}>REP PHONE</label>
<input value={repPhone} onChange={e=>setRepPhone(e.target.value)} placeholder="555-000-0000" style={inp}/>
</div>
</>
)}
{type==="competitor"&&(
<div style={{gridColumn:"1/-1"}}>
<label style={lbl}>COMPETITOR NAME *</label>
<input value={competitorName} onChange={e=>setCompetitorName(e.target.value)} placeholder="e.g. Track Supply Co" style={inp}/>
</div>
)}
<div style={{gridColumn:"1/-1"}}>
<label style={lbl}>NOTES (optional)</label>
<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Date range, discount terms, RFP context..." rows={2} style={{...inp,resize:"vertical"}}/>
</div>
</div>
)}
{/* STEP 2: FILE + MAPPING */}
{step===2&&(
<div>
<div
onDragOver={e=>e.preventDefault()}
onDrop={handleDrop}
onClick={()=>fileRef.current?.click()}
style={{border:`2px dashed ${B.border}`,borderRadius:8,padding:"24px",textAlign:"center",marginBottom:14,cursor:"pointer",background:B.surface}}
>
<input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={e=>handleFile(e.target.files?.[0])} style={{display:"none"}}/>
{loading?(
<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
<Spin/>
{loadMsg&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{loadMsg}</div>}
</div>
):(
<>
<div style={{fontSize:24,marginBottom:6,opacity:.5}}>📄</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,marginBottom:4}}>Drop file here or click to browse</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>.pdf · .csv · .xlsx · .xls — {manualMode?"you'll map columns yourself below":"AI reads it and figures out the columns, even messy multi-tab sheets"}</div>
{rawRows&&manualMode&&<div style={{marginTop:8,fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green,letterSpacing:.5}}>✓ {rawRows.length} ROWS LOADED — ADJUST MAPPING BELOW</div>}
</>
)}
</div>
<div style={{marginBottom:14,textAlign:"right"}}>
<button onClick={()=>{setManualMode(m=>!m);setRawRows(null);setHeaders([]);setError("");}} style={{background:"none",border:"none",color:B.muted,fontSize:10,fontFamily:"'Lexend',sans-serif",textDecoration:"underline",cursor:"pointer",padding:0}}>
{manualMode?"← Let AI extract it instead":"Trouble with AI extraction? Map columns manually instead"}
</button>
</div>
{manualMode&&rawRows&&headers.length>0&&(
<>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:8}}>COLUMN MAPPING</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
{FIELDS.filter(fl=>!(type==="competitor"&&fl.key==="cost")&&!(type==="competitor"&&fl.key==="map")).map(fl=>(
<div key={fl.key}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,marginBottom:3}}>{fl.label.toUpperCase()}{fl.required?" *":""}</div>
<select value={mapping[fl.key]??-1} onChange={e=>setMapping(p=>({...p,[fl.key]:parseInt(e.target.value)}))} style={{width:"100%",padding:"5px 8px",border:`1px solid ${B.border}`,borderRadius:4,fontSize:10,fontFamily:"'Lexend',sans-serif",background:"#fff"}}>
<option value={-1}>— not mapped —</option>
{headers.map((h,i)=><option key={i} value={i}>{h||`Col ${i+1}`}</option>)}
</select>
</div>
))}
</div>
{previewItems.length>0&&(
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:6}}>PREVIEW ({previewItems.length} of {buildItems().length} items)</div>
<div style={{overflowX:"auto"}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
<thead>
<tr style={{background:B.surface}}>
{["Name","SKU","Category",type==="own"?"Cost":"","Price","Notes"].filter(Boolean).map(h=><th key={h} style={{padding:"4px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,textAlign:"left",borderBottom:`1px solid ${B.border}`}}>{h}</th>)}
</tr>
</thead>
<tbody>
{previewItems.map((it,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}`}}>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.text,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.sku||"—"}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.category||"—"}</td>
{type==="own"&&<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.cost>0?`$${it.cost.toFixed(2)}`:"—"}</td>}
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.text}}>{it.price>0?`$${it.price.toFixed(2)}`:"—"}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.notes||"—"}</td>
</tr>
))}
</tbody>
</table>
</div>
</div>
)}
</>
)}
</div>
)}
{/* STEP 3: PREVIEW / CONFIRM */}
{step===3&&(
<div>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.text,letterSpacing:.5,marginBottom:8}}>PREVIEW — {buildItems().length} ITEMS READY TO SAVE</div>
<div style={{overflowX:"auto",marginBottom:14}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
<thead>
<tr style={{background:B.surface}}>
{["Name","SKU","Category",type==="own"?"Cost":"","Price","Notes"].filter(Boolean).map(h=><th key={h} style={{padding:"4px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:.5,textAlign:"left",borderBottom:`1px solid ${B.border}`}}>{h}</th>)}
</tr>
</thead>
<tbody>
{buildItems().slice(0,5).map((it,i)=>(
<tr key={i} style={{borderBottom:`1px solid ${B.border}`}}>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.text,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.sku||"—"}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.category||"—"}</td>
{type==="own"&&<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.cost>0?`$${it.cost.toFixed(2)}`:"—"}</td>}
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.text}}>{it.price>0?`$${it.price.toFixed(2)}`:"—"}</td>
<td style={{padding:"4px 8px",fontFamily:"'Lexend',sans-serif",color:B.muted}}>{it.notes||"—"}</td>
</tr>
))}
</tbody>
</table>
</div>
{buildItems().length>5&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>...and {buildItems().length-5} more items</div>}
</div>
)}
</div>
{/* Footer */}
<div style={{padding:"12px 20px",borderTop:`1px solid ${B.border}`,display:"flex",gap:8,flexShrink:0}}>
{step===1&&(
<>
<OBtn onClick={()=>{setError("");setStep(2);}}>NEXT: ADD FILE</OBtn>
<GBtn onClick={onClose}>CANCEL</GBtn>
</>
)}
{step===2&&(
<>
{rawRows&&buildItems().length>0&&<OBtn onClick={()=>{setError("");setStep(3);}}>REVIEW {buildItems().length} ITEMS</OBtn>}
<GBtn onClick={()=>setStep(1)}>BACK</GBtn>
<GBtn onClick={onClose}>CANCEL</GBtn>
</>
)}
{step===3&&(
<>
<OBtn onClick={handleSave}>SAVE {buildItems().length} ITEMS</OBtn>
<GBtn onClick={()=>setStep(2)}>BACK</GBtn>
<GBtn onClick={onClose}>CANCEL</GBtn>
</>
)}
</div>
</div>
</div>
);
}
function RepGmailConnector({repKey, email, name}) {
const {toast} = useApp();
const [info, setInfo] = React.useState(null);
const [checking, setChecking] = React.useState(false);
const check = React.useCallback(async()=>{
setChecking(true); setInfo(null);
try {
const d = await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"debug",repEnvKey:repKey})}).then(r=>r.json());
setInfo(d);
} catch(e){ setInfo({found:false,error:e.message}); }
setChecking(false);
},[repKey]);
React.useEffect(()=>{check();},[check]);
const setupUrl = `/api/gmail-setup?repKey=${repKey}${email?`&hint=${encodeURIComponent(email)}`:""}`;
if (checking) return <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Checking…</div>;
if (!info) return null;
if (info.found && info.email) return (
<div style={{background:`${B.green}08`,border:`1px solid ${B.green}30`,borderRadius:5,padding:"10px 14px"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.green,fontWeight:600}}>✓ Connected as {info.email}</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:4}}>Campaign emails assigned to you will send from this account.</div>
<a href={setupUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:8,fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue}}>Reconnect →</a>
</div>
);
return (
<div style={{background:`${B.red}08`,border:`1px solid ${B.red}30`,borderRadius:5,padding:"10px 14px"}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.red,fontWeight:600,marginBottom:6}}>Your Gmail is not connected yet.</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:10,lineHeight:1.5}}>Click the button below to connect your Google account. <strong>Open it on your own device</strong> and sign in as yourself — not a shared or admin account.</div>
<a href={setupUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",background:B.orange,color:B.white,borderRadius:5,padding:"9px 18px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:11,fontWeight:700,textDecoration:"none",letterSpacing:.3}}>Connect My Gmail →</a>
<button onClick={check} style={{marginLeft:10,background:"none",border:`1px solid ${B.border}`,borderRadius:4,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,cursor:"pointer"}}>↻ Recheck</button>
</div>
);
}
function ModEdgar() {
const {s,dispatch,toast,setMod}=useApp();
const [task,setTask]=useState("");
const [customer,setCustomer]=useState("");
const [loading,setLoading]=useState(false);
const [result,setResult]=useState(null);
const [summary,setSummary]=useState("");
const [sendingZoho,setSendingZoho]=useState(false);
const [matches,setMatches]=useState([]);
const [matchLoading,setMatchLoading]=useState(false);
const [matchedContact,setMatchedContact]=useState(null);
const inputRef=useRef(null);
const matchDebounceRef=useRef(null);
useEffect(()=>{
if(s.edgarDraft){setTask(s.edgarDraft);dispatch("SET_EDGAR_DRAFT","");setTimeout(()=>inputRef.current?.focus(),80);}
},[s.edgarDraft]);
useEffect(()=>{
if(matchedContact){setMatches([]);return;}
const term=customer.trim();
if(term.length<3){setMatches([]);return;}
if(matchDebounceRef.current) clearTimeout(matchDebounceRef.current);
matchDebounceRef.current=setTimeout(async()=>{
setMatchLoading(true);
const [crmResults,bradContacts]=await Promise.all([
fetch(`/api/crm/search?q=${encodeURIComponent(term)}`).then(r=>r.json()).catch(()=>[]),
fetch(`/api/contacts?search=${encodeURIComponent(term)}&limit=5`).then(r=>r.json()).then(d=>d.contacts||[]).catch(()=>[]),
]);
const crm=(Array.isArray(crmResults)?crmResults:[]).slice(0,4).map(r=>({
source:"crm",id:r.id,
name:r.fullName||`${r.firstName||""} ${r.lastName||""}`.trim(),
title:"",school:r.school||"",email:r.email||"",
score:null,pushedToZoho:true,module:r.module||"Contact",
}));
const brad=bradContacts.map(c=>({
source:"brad",id:c.id,
name:`${c.firstName||""} ${c.lastName||""}`.trim()||c.email,
title:c.title||"",school:c.companyName||"",email:c.email||"",
score:c.score||0,pushedToZoho:!!c.pushedToZoho,
}));
const seen=new Set(crm.map(m=>m.email).filter(Boolean));
const merged=[...crm,...brad.filter(m=>!m.email||!seen.has(m.email))].slice(0,6);
setMatches(merged);
setMatchLoading(false);
},400);
return()=>clearTimeout(matchDebounceRef.current);
},[customer,matchedContact]);
const selectMatch=(m)=>{setMatchedContact(m);setCustomer(m.school?`${m.name} — ${m.school}`:m.name);setMatches([]);};
const clearMatch=()=>setMatchedContact(null);
const run=async()=>{
const t=(task||"").trim();
if(!t||loading) return;
setLoading(true);setResult(null);setSummary("");
try{
const r=await fetch("/api/agents/edgar",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({task:customer?`${t} — Customer: ${customer}`:t,input:{
...(customer?{customer}:{}),
...(matchedContact?{contactId:matchedContact.id,contactEmail:matchedContact.email||null}:{}),
}})});
const d=await r.json();
if(d.error) throw new Error(d.error);
setResult(d.metadata?.quote||null);
setSummary(d.output||"");
}catch(e){toast("Edgar error: "+e.message,"error");}
setLoading(false);
};
const q=result||{};
const lineItems=q.lineItems||[];
const fmtM=v=>v==null?"—":fmt$(v);
const gmColor=v=>v==null?"#9ca3af":v<0.3?"#ef4444":v<0.4?"#f59e0b":"#10b981";
const disabled=loading||!task.trim();
const ownLists=(s.priceLists||[]).filter(pl=>pl.type==="own");
const newestUpload=ownLists.reduce((mx,pl)=>Math.max(mx,pl.uploadedAt||0),0);
const staleDays=newestUpload?Math.floor((Date.now()-newestUpload)/86400000):null;
const createInZoho=async()=>{
setSendingZoho("edgar_main");
// Only auto-promote a Brad's-List prospect into Zoho CRM once they've shown
// real intent (score>=50, i.e. a reply) — building a quote for them isn't
// itself a CRM-worthy signal. The quote still gets built either way.
const hasIntent=(matchedContact?.score||0)>=CONTACT_INTENT_SCORE;
if(matchedContact?.source==="brad"&&!matchedContact.pushedToZoho&&hasIntent){
try{
await fetch("/api/contacts/promote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:matchedContact.id,createAsContact:true})});
toast(`Linked ${matchedContact.name} into Zoho CRM`,"success");
}catch{}
}else if(matchedContact?.source==="brad"&&!matchedContact.pushedToZoho){
toast(`Quote built — ${matchedContact.name} stays local (no reply yet, not pushed to Zoho)`,"info");
}
const linkNote=matchedContact?`Linked to existing contact: ${matchedContact.name}${matchedContact.email?` (${matchedContact.email})`:""} — ${matchedContact.source==="brad"?"from Brad's prospect list":"already in CRM"}`:"";
return sharedCreateQuoteNow({
customer_name:q.customer||customer||"Customer",
contact_person:matchedContact?.name||"",
email:matchedContact?.email||"",
line_items:(q.lineItems||[]).filter(li=>!li.notFound).map(li=>({name:li.name,description:li.notes||"",quantity:Number(li.qty)||1,rate:Number(li.quotedPrice)||0,cost:Number(li.cost)||0})),
notes:[...(q.warnings||[]),linkNote].filter(Boolean).join("\n"),
send_email:false,
},"edgar_main",setSendingZoho);
};
return(
<div style={{padding:"26px 34px",maxWidth:1280,margin:"0 auto"}}>
<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22}}>
<div style={{width:42,height:42,background:`${B.teal}26`,border:`1px solid ${B.teal}66`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,color:B.teal,flexShrink:0}}>▤</div>
<div>
<div style={{fontFamily:"'Russo One',sans-serif",fontSize:19,color:B.black,letterSpacing:.3}}>Edgar — Quote Engine</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid}}>GM-aware quoting · MAP guardrails · live price data</div>
</div>
</div>
<div className="card" style={{padding:18,marginBottom:18,borderTop:`3px solid ${B.teal}`}}>
<div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14,marginBottom:10}}>
<div>
<label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:12,fontWeight:700,color:B.teal,letterSpacing:.6,display:"block",marginBottom:7}}>WHAT DO YOU NEED?</label>
<textarea ref={inputRef} value={task} onChange={e=>setTask(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey) run();}} placeholder="e.g. Build a quote for 12 hurdles, 2 starting blocks, and a shot put for Valley High School (Iowa)" rows={4} style={{width:"100%",background:B.surface,border:`2px solid ${B.borderD}`,color:B.text,borderRadius:5,padding:"11px 13px",fontSize:14,fontFamily:"'Lexend',sans-serif",lineHeight:1.65,resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
</div>
<div>
<label style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:12,fontWeight:700,color:B.textMid,letterSpacing:.6,display:"block",marginBottom:7}}>CUSTOMER (optional)</label>
<input value={customer} onChange={e=>{setCustomer(e.target.value);if(matchedContact)setMatchedContact(null);}} placeholder="Name or school" style={{width:"100%",background:B.surface,border:`2px solid ${B.borderD}`,color:B.text,borderRadius:5,padding:"11px 13px",fontSize:14,fontFamily:"'Lexend',sans-serif",outline:"none",boxSizing:"border-box"}}/>
{matchLoading&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginTop:5}}>Searching CRM &amp; Brad's prospect list…</div>}
{!matchedContact&&matches.length>0&&(
<div style={{marginTop:6,background:B.white,border:`2px solid ${B.borderD}`,borderRadius:5,maxHeight:200,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,.12)"}}>
{matches.map(m=>(
<button key={`${m.source}_${m.id}`} onClick={()=>selectMatch(m)} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 11px",background:"none",border:"none",borderBottom:`1px solid ${B.border}`,cursor:"pointer"}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:600}}>{m.name}</span>
<span style={{marginLeft:"auto",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:m.source==="crm"?B.green:B.blue,background:m.source==="crm"?B.greenBg:B.blueBg,padding:"2px 6px",borderRadius:3,letterSpacing:.3,flexShrink:0,fontWeight:700}}>{m.source==="crm"?`ZOHO ${(m.module||"CONTACT").toUpperCase()}`:m.pushedToZoho?"BRAD · IN ZOHO":"BRAD'S LIST"}</span>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,lineHeight:1.4,marginTop:2}}>{[m.title,m.school].filter(Boolean).join(" · ")||"—"}</div>
</button>
))}
</div>
)}
{matchedContact&&(
<div style={{marginTop:6,display:"flex",alignItems:"center",gap:7,background:B.greenBg,border:`1.5px solid ${B.green}`,borderRadius:4,padding:"6px 10px"}}>
<span style={{fontSize:13,color:B.green}}>✓</span>
<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Tied to {matchedContact.name}{matchedContact.email?` (${matchedContact.email})`:""}</span>
<button onClick={clearMatch} style={{background:"none",border:"none",color:B.textMid,fontSize:13,cursor:"pointer",padding:0,flexShrink:0}}>✕</button>
</div>
)}
</div>
</div>
{staleDays===null&&<div style={{marginBottom:9,padding:"7px 12px",background:`${B.yellow}18`,border:`1.5px solid ${B.yellow}`,borderRadius:4,fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.yellow}}>⚠ No price lists uploaded — go to Price Lists to add supplier costs before quoting.</div>}
{staleDays!==null&&staleDays>30&&<div style={{marginBottom:9,padding:"7px 12px",background:`${B.yellow}18`,border:`1.5px solid ${B.yellow}`,borderRadius:4,fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.yellow}}>⚠ Price lists last updated {staleDays}d ago — consider refreshing before quoting.</div>}
<button onClick={run} disabled={disabled} style={{background:disabled?B.surface:B.teal,color:disabled?B.textMid:B.white,border:disabled?`2px solid ${B.borderD}`:"none",borderRadius:5,padding:"10px 26px",fontSize:12,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.5,fontWeight:700,cursor:disabled?"not-allowed":"pointer"}}>{loading?"EDGAR IS THINKING…":"▤ BUILD QUOTE"}</button>
</div>
{summary&&<div className="card" style={{padding:12,marginBottom:14,background:B.tealBg,borderLeft:`3px solid ${B.teal}`}}>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{summary}</div>
</div>}
{result&&(
<div className="card" style={{padding:20,borderTop:`3px solid ${B.teal}`}}>
{q.customer&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,marginBottom:14}}>Customer: <strong style={{color:B.text}}>{q.customer}</strong></div>}
<table style={{width:"100%",borderCollapse:"collapse",marginBottom:16}}>
<thead>
<tr style={{borderBottom:`2px solid ${B.borderD}`}}>
{["ITEM","QTY","COST","PRICE","GM%","NOTES"].map(h=>(
<th key={h} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.textMid,letterSpacing:.4,textAlign:h==="ITEM"?"left":"right",padding:"7px 10px 7px 0",fontWeight:700}}>{h}</th>
))}
</tr>
</thead>
<tbody>
{lineItems.map((li,i)=>{
const gm=li.quotedPrice&&li.cost?(li.quotedPrice-li.cost)/li.quotedPrice:null;
return(
<tr key={i} style={{borderBottom:`1px solid ${B.border}`,opacity:li.notFound?.7:1}}>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:li.notFound?B.muted:B.text,padding:"9px 10px 9px 0"}}>{li.name}{li.notFound&&<span style={{fontSize:10,color:B.red,marginLeft:5}}>NOT FOUND</span>}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.textMid,textAlign:"right",padding:"9px 10px 9px 0"}}>{li.qty||1}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.textMid,textAlign:"right",padding:"9px 10px 9px 0"}}>{fmtM(li.cost)}</td>
<td style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.teal,textAlign:"right",padding:"9px 10px 9px 0"}}>{fmtM(li.quotedPrice)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:gmColor(gm),textAlign:"right",padding:"9px 10px 9px 0"}}>{fmtPct(gm)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,textAlign:"right",padding:"9px 0",maxWidth:200}}>{li.notes||""}</td>
</tr>
);
})}
</tbody>
<tfoot>
<tr style={{borderTop:`2px solid ${B.border}`}}>
<td colSpan={2} style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.muted,padding:"9px 0",letterSpacing:.3}}>TOTALS</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:14,color:B.textMid,textAlign:"right",padding:"9px 10px 9px 0",fontWeight:600}}>{fmtM(q.totalCost)}</td>
<td style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.teal,textAlign:"right",padding:"9px 10px 9px 0"}}>{fmtM(q.totalRevenue)}</td>
<td style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:gmColor(q.overallGmPct??null),textAlign:"right",padding:"9px 10px 9px 0",fontWeight:600}}>{fmtPct(q.overallGmPct??null)}</td>
<td/>
</tr>
</tfoot>
</table>
{(q.warnings||[]).length>0&&(
<div style={{background:B.yellowBg,border:`1px solid ${B.yellow}80`,borderRadius:5,padding:"9px 13px",marginTop:4}}>
<div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.yellow,letterSpacing:.5,marginBottom:6}}>WARNINGS</div>
{q.warnings.map((w,i)=><div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.55}}>⚠ {w}</div>)}
</div>
)}
{(()=>{const approved=approvedQuotes.edgar_main;const draft=quoteEmailDrafts.edgar_main;return(
<>
<div style={{marginTop:14,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
{approved
?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,color:B.green,background:B.greenBg,padding:"6px 14px",borderRadius:4,letterSpacing:.3}}>✓ APPROVED — {approved.quoteNumber}</span>
:<button onClick={createInZoho} disabled={sendingZoho} style={{background:sendingZoho?B.surface:B.teal,color:sendingZoho?B.muted:B.white,border:"none",borderRadius:4,padding:"7px 16px",fontSize:11,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,cursor:sendingZoho?"not-allowed":"pointer",fontWeight:700}}>{sendingZoho?"APPROVING…":"✓ APPROVE"}</button>}
<button onClick={()=>setMod("deals")} style={{background:B.surface,border:`1px solid ${B.border}`,color:B.textMid,borderRadius:4,padding:"7px 16px",fontSize:11,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,cursor:"pointer"}}>→ DEALS</button>
<button onClick={()=>{setResult(null);setSummary("");setTask("");setCustomer("");setSendingZoho(false);setMatchedContact(null);setMatches([]);}} style={{background:"none",border:`1px solid ${B.border}`,color:B.muted,borderRadius:4,padding:"7px 16px",fontSize:11,fontFamily:"'Lexend Zetta',sans-serif",letterSpacing:.3,cursor:"pointer"}}>CLEAR</button>
</div>
{approved&&(
<div style={{marginTop:10,padding:"10px 13px",background:B.surface,border:`1px solid ${B.border}`,borderRadius:5}}>
<div style={{display:"flex",gap:8,marginBottom:draft?.sent?0:8}}>
<button onClick={()=>downloadQuotePdf("edgar_main")} style={{background:"none",border:`1px solid ${B.teal}50`,color:B.teal,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3}}>⬇ DOWNLOAD PDF</button>
{approved.reviewUrl&&<a href={approved.reviewUrl} target="_blank" rel="noreferrer" style={{background:"none",border:`1px solid ${B.teal}50`,color:B.teal,borderRadius:4,padding:"5px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,textDecoration:"none",letterSpacing:.3}}>OPEN IN ZOHO →</a>}
</div>
{draft?.sent
?<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.green}}>✓ Emailed to {draft.to}</div>
:draft&&(
<div style={{display:"flex",flexDirection:"column",gap:6}}>
<input value={draft.to} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,edgar_main:{...prev.edgar_main,to:e.target.value}}))} placeholder="To" style={{fontFamily:"'Lexend',sans-serif",fontSize:12,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 9px",color:B.text}}/>
<input value={draft.subject} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,edgar_main:{...prev.edgar_main,subject:e.target.value}}))} placeholder="Subject" style={{fontFamily:"'Lexend',sans-serif",fontSize:12,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 9px",color:B.text}}/>
<textarea rows={4} value={draft.body} onChange={e=>setQuoteEmailDrafts(prev=>({...prev,edgar_main:{...prev.edgar_main,body:e.target.value}}))} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,border:`1px solid ${B.border}`,borderRadius:4,padding:"6px 9px",color:B.text,resize:"vertical"}}/>
<button onClick={()=>sendQuoteEmail("edgar_main")} disabled={sendingQuoteEmail==="edgar_main"||!draft.to} style={{alignSelf:"flex-start",background:B.green,border:"none",color:B.white,borderRadius:4,padding:"6px 14px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:.3,opacity:sendingQuoteEmail==="edgar_main"?.6:1}}>{sendingQuoteEmail==="edgar_main"?"SENDING...":"📧 SEND EMAIL"}</button>
</div>
)}
</div>
)}
</>
);})()}
</div>
)}
</div>
);
}
function ModSettings() {
const {s,dispatch,toast,setMod,cu}=useApp();
const [ints,setInts]=useState({...(s.integrations||{})});
const [co,setCo]=useState({...SEED.company,...(s.company||{})});
const [repForm,setRepForm]=useState(null);
const [pinForm,setPinForm]=useState(null);
const [pinVal,setPinVal]=useState("");
const [gmailStatus,setGmailStatus]=useState(null);
const testRepEmail=async(rep)=>{
const fromLabel = rep.gmailEnvKey ? `${rep.gmailEnvKey}'s Gmail` : "shared Gmail";
if(rep.gmailEnvKey){
try{
const dbg=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"debug",repEnvKey:rep.gmailEnvKey})}).then(r=>r.json());
if(!dbg.found){toast(`No Gmail connected for ${rep.name} — have them visit /api/gmail-setup?repKey=${rep.gmailEnvKey} from their own browser to connect`,"error");return;}
if(dbg.email&&dbg.email!==rep.email){
toast(`Wrong account: ${rep.gmailEnvKey} is connected as ${dbg.email}, not ${rep.email}. Have ${rep.name} redo the OAuth at /api/gmail-setup?repKey=${rep.gmailEnvKey} from their own browser`,"error");
return;
}
}catch{}
}
toast(`Sending test to ${rep.email} via ${fromLabel}…`,"info");
try {
const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
action:"send", to_email:rep.email, to_name:rep.name,
subject:`ST1 RevOps — email test for ${rep.name}`,
body:`Hi ${(rep.name||"there").split(" ")[0]},\n\nThis is a test email confirming your address is connected to ST1 RevOps. If you received this, outbound email is working correctly for your account.\n\n— ST1 RevOps`,
...(rep.gmailEnvKey ? {repEnvKey:rep.gmailEnvKey} : {}),
...(rep.email ? {from_email:rep.email, from_name:rep.name, reply_to:rep.email} : {}),
})}).then(r=>r.json());
if(d.sent) toast(`Test sent to ${rep.email} via ${fromLabel} ✓`,"success");
else toast("Send failed: "+(d.error||JSON.stringify(d)),"error");
} catch(e){ toast("Error: "+e.message,"error"); }
};
const savePin=()=>{
if(pinVal.length!==4||!/^\d{4}$/.test(pinVal)){toast("PIN must be exactly 4 digits","error");return;}
const existingAu=(s.appUsers||[]).find(u=>u.repId===pinForm)||{};
dispatch("SET_APP_USER",{...existingAu,repId:pinForm,pin:pinVal});
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
if (cu && !cu.isAdmin) {
const myRep = (s.reps||[]).find(r=>r.id===cu?.id) || cu;
const myKey = cu?.gmailEnvKey || "";
const setupUrl = myKey ? `/api/gmail-setup?repKey=${myKey}${cu?.email?`&hint=${encodeURIComponent(cu.email)}`:""}` : "";
return (
<div style={{padding:"22px 26px",maxWidth:600}}>
<PH title="MY ACCOUNT" sub={`Logged in as ${cu?.name||"you"}`}/>
<div className="card" style={{padding:16,marginBottom:13,borderTop:`3px solid ${B.orange}`}}>
<Lbl c={B.orange} s={{marginBottom:12}}>My Profile</Lbl>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
{[["Name","name"],["Email","email"],["Title","title"],["Phone","phone"]].map(([l,k])=>(
<div key={k}><Lbl s={{marginBottom:3}}>{l}</Lbl>
<div style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}>{myRep?.[k]||<span style={{color:B.muted}}>—</span>}</div>
</div>
))}
</div>
</div>
<div className="card" style={{padding:16,borderTop:`3px solid ${B.green}`}}>
<Lbl c={B.green} s={{marginBottom:12}}>My Gmail</Lbl>
{!myKey ? (
<div style={{background:`${B.yellow}18`,border:`1px solid ${B.yellow}`,borderRadius:5,padding:"10px 14px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
No Gmail key assigned to your account. Ask an admin to set your Gmail Key in Settings → Reps, then come back here to connect.
</div>
) : (
<RepGmailConnector repKey={myKey} email={cu?.email||""} name={cu?.name||""} />
)}
</div>
</div>
);
}
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
style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 9px",fontSize:12,fontFamily:"monospace"}}/>
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
const [gmailInfo,setGmailInfo]=useState(null);
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
const repGmailKey = (cu && !cu.isAdmin && cu?.gmailEnvKey) ? cu.gmailEnvKey : "";
const checkGmail=async()=>{
setGmailChecking(true);setGmailInfo(null);
try{
const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"profile",...(repGmailKey?{repEnvKey:repGmailKey}:{})})}).then(r=>r.json());
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
{!repGmailKey&&<button onClick={async()=>{
const d=await fetch("/api/gmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",to_email:s.company?.email||"test@example.com",to_name:"ST1 Test",subject:"ST1 RevOps — Gmail test",body:"If you receive this, Gmail sending is working correctly."})}).then(r=>r.json());
if(d.sent) toast("Test email sent — check your inbox","success");
else toast("Send failed: "+(d.error||JSON.stringify(d)),"error");
}} style={{background:B.purple,color:B.white,border:"none",borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",cursor:"pointer"}}>✉ Send Test</button>}
{repGmailKey&&<a href={`/api/gmail-setup?repKey=${repGmailKey}${cu?.email?`&hint=${encodeURIComponent(cu.email)}`:""}`} target="_blank" rel="noreferrer" style={{background:B.orange,color:B.white,border:"none",borderRadius:3,padding:"2px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",textDecoration:"none"}}>Connect Gmail →</a>}
</div>
</div>
{/* Rep (non-admin) with no gmailEnvKey set */}
{cu && !cu.isAdmin && !cu?.gmailEnvKey && (
<div style={{background:`${B.yellow}18`,border:`1px solid ${B.yellow}`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>
No Gmail key assigned. Ask an admin to set your Gmail Key in Settings → Reps, then come back here to connect.
</div>
)}
{gmailInfo&&(
gmailInfo.error
?<div style={{background:`${B.red}08`,border:`1px solid ${B.red}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.red}}>
✕ {repGmailKey ? "Your Gmail is not connected yet." : `Not connected — ${gmailInfo.error}`}
{repGmailKey
?<div style={{marginTop:6,fontSize:10,color:B.muted}}>Click <strong>Connect Gmail →</strong> above to link your Google account. Open it on <strong>your own device</strong> and sign in with your own Google account.</div>
:<div style={{marginTop:4,fontSize:10,color:B.muted}}>Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Vercel env vars. Visit <strong>/api/gmail-setup</strong> to generate tokens.</div>
}
</div>
:<div style={{background:`${B.green}08`,border:`1px solid ${B.green}30`,borderRadius:5,padding:"8px 12px",fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>
✓ Connected as <strong>{gmailInfo.email}</strong>
<div style={{marginTop:4,fontSize:10,color:B.muted}}>{repGmailKey?"Campaign emails assigned to you will send from this account.":"All campaign emails send FROM this account. Rep name & email appear in the signature — replies go back to this inbox."}</div>
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
{repForm.gmailEnvKey
?<a href={`/api/gmail-setup?repKey=${repForm.gmailEnvKey}`} target="_blank" rel="noreferrer"
style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,textDecoration:"underline",whiteSpace:"nowrap"}}>Gmail setup link →</a>
:<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Type a key above, then click the setup link</span>}
{repForm.gmailEnvKey&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,whiteSpace:"nowrap"}}>Save, then have the rep open this link on their own computer. Token saves automatically.</span>}
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
const repAu = (s.appUsers||[]).find(u=>u.repId===rep.id);
const isRepAdmin = repAu?.isAdmin||false;
const toggleRepAdmin=()=>{
if(!repAu){toast("Set a PIN first before granting admin access","error");return;}
dispatch("SET_APP_USER",{...repAu,isAdmin:!isRepAdmin});
toast(!isRepAdmin?`${rep.name} granted admin access`:`${rep.name} admin access removed`,"success");
};
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
{hasOwnGmail&&<a href={`/api/gmail-setup?repKey=${rep.gmailEnvKey}${rep.email?`&hint=${encodeURIComponent(rep.email)}`:""}`} target="_blank" rel="noreferrer" style={{background:"none",border:`1px solid ${B.blue}40`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:B.blue,cursor:"pointer",textDecoration:"none"}}>GMAIL SETUP →</a>}
<button onClick={()=>{if(pinForm===rep.id){setPinForm(null);setPinVal("");}else{setPinForm(rep.id);setPinVal("");}}} style={{background:hasAccess?`${B.green}15`:"none",border:`1px solid ${hasAccess?B.green:B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend',sans-serif",color:hasAccess?B.green:B.muted,cursor:"pointer"}} title={hasAccess?"Change or revoke PIN":"Set login PIN for this rep"}>{hasAccess?"🔑 CHANGE PIN":"🔑 SET PIN"}</button>
{hasAccess&&<button onClick={toggleRepAdmin} style={{background:isRepAdmin?B.purpleBg:"none",border:`1px solid ${isRepAdmin?`${B.purple}40`:B.border}`,borderRadius:4,padding:"3px 8px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",color:isRepAdmin?B.purple:B.muted,cursor:"pointer"}} title={isRepAdmin?"Remove admin access":"Grant admin access to this rep"}>◐ {isRepAdmin?"ADMIN":"MAKE ADMIN"}</button>}
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
<button onClick={()=>{setMod("social");}} style={{background:B.purpleBg,color:B.purple,border:"none",borderRadius:3,padding:"3px 6px",fontSize:8,fontFamily:"'Lexend Zetta',sans-serif",cursor:"pointer",letterSpacing:.3}}>USE IN POST →</button>
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
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.7,marginBottom:11}}>Data syncs to the database automatically and is cached in your browser for instant loading. Export a backup before clearing.</div>
<div style={{display:"flex",gap:7}}>
<GBtn onClick={()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(s)],{type:"application/json"}));a.download=`st1_backup_${today()}.json`;a.click();toast("Backup exported","success");}}>↓ EXPORT BACKUP</GBtn>
<button onClick={()=>{if(window.confirm("Reset all data to demo state? Cannot be undone.")){dispatch("RESET");toast("Reset to demo","success");}}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>RESET TO DEMO</button>
<button onClick={()=>{
const staleContacts=(s.contacts||[]).filter(c=>/^zoho_[cl]_/.test(c.id));
const staleDeals=(s.deals||[]).filter(d=>/^zoho_d_/.test(d.id));
if(!staleContacts.length&&!staleDeals.length){toast("No Zoho-synced contacts/deals cached here","info");return;}
if(!window.confirm(`Remove ${staleContacts.length} Zoho-synced contact(s) and ${staleDeals.length} Zoho-synced deal(s) cached in RevOps? This only clears this app's local cache — nothing in Zoho itself is touched. Use this after wiping/reseeding Zoho CRM so old records don't linger alongside the fresh ones.`))return;
dispatch("SET_CONTACTS",(s.contacts||[]).filter(c=>!/^zoho_[cl]_/.test(c.id)));
dispatch("SET_DEALS",(s.deals||[]).filter(d=>!/^zoho_d_/.test(d.id)));
toast(`Cleared ${staleContacts.length} contact(s), ${staleDeals.length} deal(s) — use SYNC ZOHO CRM in Prospecting → Contact DB to pull the fresh data`,"success");
}} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:5,padding:"7px 13px",fontSize:11,fontFamily:"'Lexend',sans-serif"}}>CLEAR ZOHO CACHE</button>
</div>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:8,lineHeight:1.5}}>CLEAR ZOHO CACHE removes only records synced from Zoho CRM (contacts/leads/deals) — anything created manually in RevOps stays untouched. Since syncing only adds/updates and never removes, this is the way to drop old records after a Zoho-side wipe and reseed.</div>
</div>
{/* AI Tools → Integrations tab */}
<div className="card" style={{padding:16,marginTop:13,borderTop:`3px solid ${B.muted}`}}>
<Lbl s={{marginBottom:6}}>AI Tools & Connections</Lbl>
<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:11,lineHeight:1.5}}>All API connections, AI plugin toggles, and integration settings live in one place.</div>
<OBtn onClick={()=>setMod("integrations")}>OPEN INTEGRATIONS →</OBtn>
</div>
</div>
);
}
