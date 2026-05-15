import { useState, useRef } from "react";

// ─── ST1 BRAND ────────────────────────────────────────────────────────────────
const B = {
  pageBg:"#F4F4F4", white:"#FFFFFF", surface:"#F8F8F8",
  orange:"#F37321", orangeL:"#FF9942", orangeBg:"#FEF3EC",
  black:"#000000", gray1:"#424242", gray2:"#B2B9C1",
  border:"#E0E0E0", borderD:"#C8C8C8",
  text:"#1A1A1A", textMid:"#424242", muted:"#7A7A7A",
  green:"#1E8F4E", greenBg:"#EAF7EE",
  yellow:"#C77800", yellowBg:"#FFF8E6",
  red:"#C0392B", redBg:"#FDECEA",
  blue:"#1A5FA8", blueBg:"#E8F0FA",
  purple:"#6B3FA0", purpleBg:"#F3EEFB",
  teal:"#0C7B6A", tealBg:"#E6F5F2",
};

const ST1 = `ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa.
Owner: Matt Stone · matt@st1sports.com · 719-256-0275
Brands: Blazer, Gill Athletics, Diamond, All-Star, Molten, Wilson, DeMarini, Louisville Slugger, FinishLynx, Pro-Nine, Ultrak, Seiko.
Current markets: Iowa (primary), Colorado (active), Minnesota, North Dakota.
Typical customers: K-12 school districts, athletic directors, head coaches, procurement managers.
Revenue drivers: T&F equipment, competition spikes, baseball/softball gear, timing systems, custom team stores.
Average deal size: $800–$12,000. Bid deals: $10,000–$100,000+.`;

const EXPANSION_STATES = [
  { abbr:"WI", name:"Wisconsin",     region:"Midwest",      highSchools:503,  bwtf:false },
  { abbr:"NE", name:"Nebraska",      region:"Great Plains", highSchools:275,  bwtf:false },
  { abbr:"SD", name:"South Dakota",  region:"Great Plains", highSchools:184,  bwtf:false },
  { abbr:"KS", name:"Kansas",        region:"Midwest",      highSchools:365,  bwtf:false },
  { abbr:"MO", name:"Missouri",      region:"Midwest",      highSchools:565,  bwtf:false },
  { abbr:"IL", name:"Illinois",      region:"Midwest",      highSchools:839,  bwtf:false },
  { abbr:"MN", name:"Minnesota",     region:"Midwest",      highSchools:527,  bwtf:true  },
  { abbr:"ND", name:"North Dakota",  region:"Great Plains", highSchools:196,  bwtf:true  },
  { abbr:"MT", name:"Montana",       region:"Northwest",    highSchools:177,  bwtf:false },
  { abbr:"WY", name:"Wyoming",       region:"Mountain",     highSchools:97,   bwtf:false },
  { abbr:"UT", name:"Utah",          region:"Mountain",     highSchools:133,  bwtf:false },
  { abbr:"ID", name:"Idaho",         region:"Northwest",    highSchools:185,  bwtf:false },
];

const SPORTS_FOCUS = ["Track & Field","Baseball","Softball","Volleyball","Cross Country","Football","Basketball"];
const PRIORITIES = ["Track & Field first — core competency","All sports simultaneously","Baseball/Softball only","Follow largest bid opportunities"];

const uid  = () => Math.random().toString(36).slice(2,9);
const sleep= ms => new Promise(r=>setTimeout(r,ms));

async function aiSearch(prompt) {
  const r = await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-6", max_tokens:1600,
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}]
    })
  });
  const d = await r.json();
  return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
}

async function aiJSON(prompt) {
  const r = await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-6", max_tokens:1800,
      system:"Return ONLY valid JSON. No markdown fences, no explanation, no extra text.",
      messages:[{role:"user",content:prompt}]
    })
  });
  const d = await r.json();
  const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  try{const m=text.match(/[\[{][\s\S]*[\]}]/s);return m?JSON.parse(m[0]):null;}catch{return null;}
}

async function aiJSONSearch(prompt) {
  const r = await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-6", max_tokens:1800,
      system:"Return ONLY valid JSON. No markdown fences, no explanation.",
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}]
    })
  });
  const d = await r.json();
  const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  try{const m=text.match(/[\[{][\s\S]*[\]}]/s);return m?JSON.parse(m[0]):null;}catch{return null;}
}

// ─── BACKGROUND GENERATION — survives component unmount ───────────────────────
const ACTIVE_GENS = new Map(); // stateAbbr -> true

async function runGeneration(stratId, sd, config, crmCtx, dispatch) {
  const up = (fields) => dispatch("UPDATE_STRATEGY", { id: stratId, ...fields });
  const localLog = [];
  const log = (msg, type="info") => {
    localLog.push({ msg, type, ts: Date.now() });
    up({ currentStep: msg });
  };

  try {
    up({ status:"running", progress:0 });

    log(`Building expansion playbook for ${sd.name}...`);

    // ── 1. Market Intelligence ─────────────────────────────────────────────
    log("Step 1/6 — Researching market size and competitive landscape...");
    const marketIntel = await aiJSONSearch(
`Research the athletic equipment market in ${sd.name} for ST1 Sports.
${ST1}
Focus sports: ${config.sports.join(", ")}
${crmCtx}

Use web search to find real data. Return JSON:
{
  "stateOverview": "2-3 sentence summary of the athletic market in ${sd.name}",
  "highSchoolCount": ${sd.highSchools},
  "estimatedDistricts": estimated number of school districts as number,
  "annualAthleteCount": estimated high school athletes as number,
  "estimatedMarketSize": estimated annual athletic equipment spend in state in dollars as number,
  "st1AddressableMarket": estimated portion ST1 could realistically capture in year 1 as number,
  "keyLargestDistricts": ["5 largest school districts by enrollment"],
  "stateAthletic Association": "name of state high school athletic association",
  "athleticAssociationWebsite": "website URL",
  "keyCompetitors": [{"name":"competitor name","strength":"what they're known for","weakness":"where they're weak"}],
  "marketOpportunity": "specific opportunity for ST1 in this state",
  "entryDifficulty": "easy|medium|hard",
  "entryDifficultyReason": "why",
  "seasonalPattern": "when districts typically buy athletic equipment"
}`);
    up({ progress: 18 });
    log("✓ Market intelligence gathered", "success");

    // ── 2. Key Contacts ────────────────────────────────────────────────────
    log("Step 2/6 — Finding key contacts and decision makers...");
    const contacts = await aiJSONSearch(
`Find key athletic director and purchasing contacts at major school districts in ${sd.name}.
Focus on districts that would buy: ${config.sports.join(", ")} equipment.
${ST1}
${crmCtx}

Search for real contacts at these types of organizations:
- Top 10 largest school districts in ${sd.name}
- State athletic association
- Regional athletic directors associations
- Any purchasing cooperatives or consortiums used by schools in ${sd.name}

Return JSON array of 15-20 contacts:
[{
  "name": "person name or role title",
  "title": "Athletic Director|Procurement|Coach|etc",
  "organization": "school/district/org name",
  "city": "city",
  "website": "org website",
  "email": "email if found publicly, empty string if not",
  "phone": "phone if found publicly",
  "type": "district|association|cooperative|school",
  "priority": "high|medium|low",
  "notes": "why this contact matters for ST1",
  "sport": "relevant sport or General"
}]`);
    up({ progress: 36 });
    log(`✓ ${Array.isArray(contacts)?contacts.length:0} contacts identified`, "success");

    // ── 3. Bid Calendar ────────────────────────────────────────────────────
    log("Step 3/6 — Building bid calendar and procurement schedule...");
    const bidCalendar = await aiJSONSearch(
`Research the K-12 school purchasing and bid calendar for ${sd.name}.
Find real information about:
- When school districts in ${sd.name} typically issue RFPs for athletic equipment
- State purchasing cooperatives or bid consortiums
- Any active or upcoming athletic equipment bids in ${sd.name}
- NFHS or state association purchasing programs
- Typical budget cycle for schools in ${sd.name}

${ST1}
Return JSON:
{
  "fiscalYearStart": "month schools typically start their fiscal year",
  "budgetApprovalMonths": ["months when budgets are typically approved"],
  "peakBuyingMonths": ["months with highest purchasing activity"],
  "rfpSeasonMonths": ["months when RFPs are most commonly issued"],
  "purchasingCoops": [{"name":"coop name","description":"what it covers","website":"url","relevance":"how ST1 could use it"}],
  "knownActiveBids": [{"title":"bid title if found","issuer":"who issued it","estimatedValue":"estimated value","deadline":"when"}],
  "stateContractVehicles": ["any state contract vehicles for schools to buy off"],
  "bidRegistrationRequired": true or false,
  "bidRegistrationSteps": ["steps to register as vendor in ${sd.name}"],
  "monthlyCalendar": [
    {"month":"January","action":"what ST1 should be doing","priority":"high|medium|low"},
    {"month":"February","action":"...","priority":"..."},
    {"month":"March","action":"...","priority":"..."},
    {"month":"April","action":"...","priority":"..."},
    {"month":"May","action":"...","priority":"..."},
    {"month":"June","action":"...","priority":"..."},
    {"month":"July","action":"...","priority":"..."},
    {"month":"August","action":"...","priority":"..."},
    {"month":"September","action":"...","priority":"..."},
    {"month":"October","action":"...","priority":"..."},
    {"month":"November","action":"...","priority":"..."},
    {"month":"December","action":"...","priority":"..."}
  ]
}`);
    up({ progress: 54 });
    log("✓ Bid calendar and procurement schedule built", "success");

    // ── 4. 90-Day Plan ────────────────────────────────────────────────────
    log("Step 4/6 — Building 90-day execution plan...");
    const plan90 = await aiJSON(
`Create a detailed 90-day go-to-market plan for ST1 Sports entering ${sd.name}.
${ST1}
Configuration:
- Focus sports: ${config.sports.join(", ")}
- Priority: ${config.priority}
- Team: ${config.teamSize}
- Budget: ${config.budget}
${config.note ? `- Additional context: ${config.note}` : ""}

Return JSON:
{
  "phase1": {
    "label": "Days 1–30: Foundation",
    "theme": "one sentence theme",
    "tasks": [
      {"week":"Week 1","day":"Day 1-3","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"critical|high|medium"},
      {"week":"Week 1","day":"Day 4-7","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."},
      {"week":"Week 2","day":"Day 8-14","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."},
      {"week":"Week 3","day":"Day 15-21","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."},
      {"week":"Week 4","day":"Day 22-30","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."}
    ],
    "milestone": "what success looks like at day 30",
    "kpis": ["3-4 specific measurable KPIs"]
  },
  "phase2": {
    "label": "Days 31–60: Activation",
    "theme": "one sentence theme",
    "tasks": [
      {"week":"Week 5-6","day":"Day 31-45","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."},
      {"week":"Week 7-8","day":"Day 46-60","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."}
    ],
    "milestone": "what success looks like at day 60",
    "kpis": ["3-4 specific measurable KPIs"]
  },
  "phase3": {
    "label": "Days 61–90: Revenue",
    "theme": "one sentence theme",
    "tasks": [
      {"week":"Week 9-10","day":"Day 61-75","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."},
      {"week":"Week 11-13","day":"Day 76-90","task":"specific task","owner":"Matt or Rep","effort":"hours","priority":"..."}
    ],
    "milestone": "what success looks like at day 90",
    "kpis": ["3-4 specific measurable KPIs"]
  },
  "quickWins": ["5 things that could generate revenue in first 30 days"],
  "biggestRisks": ["3 biggest risks and how to mitigate each"],
  "revenueTarget90Days": estimated revenue target for first 90 days as number,
  "revenueTargetYear1": estimated year 1 revenue target as number
}`);
    up({ progress: 72 });
    log("✓ 90-day execution plan built", "success");

    // ── 5. Email Sequences ───────────────────────────────────────────────
    log("Step 5/6 — Writing outreach email sequences...");
    const sequences = await aiJSON(
`Write outreach email sequences for ST1 Sports entering ${sd.name}.
${ST1}
Focus: ${config.sports.join(", ")}

Create 2 sequences. Return JSON:
{
  "sequences": [
    {
      "name": "sequence name",
      "target": "who this is for",
      "touches": [
        {"touchNum":1,"day":0,"subject":"email subject line","body":"full email body under 100 words, use {{firstName}} and {{orgName}}"},
        {"touchNum":2,"day":4,"subject":"...","body":"..."},
        {"touchNum":3,"day":10,"subject":"...","body":"..."}
      ]
    },
    {
      "name": "sequence 2 name",
      "target": "different target",
      "touches": [
        {"touchNum":1,"day":0,"subject":"...","body":"..."},
        {"touchNum":2,"day":5,"subject":"...","body":"..."}
      ]
    }
  ]
}`);
    up({ progress: 88 });
    log("✓ Email sequences written", "success");

    // ── 6. Summary + Positioning ──────────────────────────────────────────
    log("Step 6/6 — Building positioning and summary...");
    const positioning = await aiJSON(
`Create the positioning strategy for ST1 Sports entering ${sd.name}.
${ST1}
Focus sports: ${config.sports.join(", ")}
Market data: ${sd.highSchools} high schools, ${sd.region} region.

Return JSON:
{
  "headline": "one punchy sentence positioning ST1 in ${sd.name}",
  "valueProps": [
    {"prop":"value proposition 1","detail":"explanation"},
    {"prop":"value proposition 2","detail":"explanation"},
    {"prop":"value proposition 3","detail":"explanation"}
  ],
  "competitiveDifferentiators": ["3 things ST1 does better than current suppliers in ${sd.name}"],
  "pricingStrategy": "recommended pricing approach for ${sd.name}",
  "partnershipOpportunities": ["organizations or events to partner with in ${sd.name}"],
  "messagingByAudience": {
    "athleticDirectors": "key message for ADs",
    "coaches": "key message for coaches",
    "procurement": "key message for procurement"
  },
  "estimatedTotalMarket": market estimate for ST1's sports in ${sd.name} in dollars,
  "year1RealisticCapture": realistic % of market ST1 could capture year 1 as number
}`);
    up({ progress: 100 });

    const pb = {
      state: sd, config,
      marketIntel: marketIntel||{},
      contacts: Array.isArray(contacts)?contacts:[],
      bidCalendar: bidCalendar||{},
      plan90: plan90||{},
      sequences: sequences?.sequences||[],
      positioning: positioning||{},
      generatedAt: new Date().toISOString(),
    };
    up({ status:"done", progress:100, playbook:pb, log:localLog, currentStep:"Complete", generatedAt: new Date().toISOString() });
    dispatch("LOG", { msg:`Expansion playbook completed: ${sd.name}` });
    ACTIVE_GENS.delete(sd.abbr);
  } catch(err) {
    up({ status:"error", currentStep: err.message, log:localLog });
    ACTIVE_GENS.delete(sd.abbr);
  }
}

// ════════════════════════════════════════════════════════════════════════════
export default function ExpansionPlaybook({ s={}, dispatch=()=>{}, toast=()=>{} }) {
  const [selectedState, setSelectedState] = useState("WI");
  const [config, setConfig] = useState({
    state:"WI", sports:["Track & Field"], priority:PRIORITIES[0],
    teamSize:"Matt only", budget:"$2,000–$5,000 first 90 days", note:""
  });
  const [activeSection, setActiveSection] = useState("overview");
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const tog=(arr,v)=>arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];

  // Find the strategy entry for a given state abbreviation
  const getStrat = (abbr) => (s.strategies||[]).find(x=>x.type==="expansion_playbook"&&x.stateAbbr===abbr)||null;
  const currentStrat = getStrat(selectedState);
  const sd = EXPANSION_STATES.find(x=>x.abbr===selectedState)||EXPANSION_STATES[0];

  // CRM context for selected state
  const stateContacts = (s.contacts||[]).filter(c => c.state === sd.abbr);
  const stateDeals = (s.deals||[]).filter(d =>
    d.state === sd.abbr ||
    (d.school||"").toLowerCase().includes(sd.name.toLowerCase())
  );

  let crmCtx = "";
  if (stateContacts.length > 0) {
    crmCtx += `\n\nEXISTING ST1 CONTACTS IN ${sd.name} (${stateContacts.length} total):\n`;
    crmCtx += stateContacts.slice(0,25).map(c =>
      `- ${c.fullName||[c.firstName,c.lastName].filter(Boolean).join(' ')} | ${c.title||''} | ${typeof c.school==='string'?c.school:c.school?.name||''} | ${c.email||'no email'} | Score: ${c.score||0}`
    ).join('\n');
    crmCtx += '\nBuild on these existing relationships. Focus new contact research on gaps.';
  }
  if (stateDeals.length > 0) {
    crmCtx += `\n\nOPEN DEALS IN ${sd.name} (${stateDeals.length}):\n`;
    crmCtx += stateDeals.slice(0,10).map(d =>
      `- ${d.name} | ${d.school||''} | ${d.stage} | $${d.value||0}`
    ).join('\n');
    crmCtx += '\nWe are already selling here. Prioritize expanding these accounts.';
  }

  // ─── GENERATE PLAYBOOK ────────────────────────────────────────────────────
  const handleGenerate = (forceRegen=false) => {
    const strat = getStrat(selectedState);

    // If already done and not forcing regen, show confirm
    if (strat?.status==="done" && !forceRegen) {
      setShowRegenConfirm(true);
      return;
    }

    // If already running, do nothing
    if (ACTIVE_GENS.has(selectedState)) return;

    setShowRegenConfirm(false);

    const cfgToUse = { ...config, state: selectedState };
    const stratId = uid();

    // Create or update strategy record
    if (strat) {
      dispatch("UPDATE_STRATEGY", {
        id: strat.id,
        status:"running", progress:0, currentStep:"Starting...",
        playbook: null, log: [], config: cfgToUse
      });
      ACTIVE_GENS.set(selectedState, true);
      runGeneration(strat.id, sd, cfgToUse, crmCtx, dispatch);
    } else {
      const newStrat = {
        id: stratId,
        type: "expansion_playbook",
        stateAbbr: sd.abbr,
        stateName: sd.name,
        status: "running",
        progress: 0,
        currentStep: "Starting...",
        config: cfgToUse,
        playbook: null,
        log: [],
        generatedAt: null,
      };
      dispatch("ADD_STRATEGY", newStrat);
      ACTIVE_GENS.set(selectedState, true);
      runGeneration(stratId, sd, cfgToUse, crmCtx, dispatch);
    }
  };

  // "Run All Remaining" — runs all states that have no done playbook
  const handleRunAll = () => {
    const remaining = EXPANSION_STATES.filter(st => {
      const strat = getStrat(st.abbr);
      return !strat || (strat.status !== "done" && strat.status !== "running");
    });
    remaining.forEach((st, idx) => {
      // stagger slightly to avoid hammering the API simultaneously
      setTimeout(() => {
        if (ACTIVE_GENS.has(st.abbr)) return;
        const existingStrat = getStrat(st.abbr);
        const cfgToUse = { state: st.abbr, sports:["Track & Field"], priority:PRIORITIES[0], teamSize:"Matt only", budget:"$2,000–$5,000 first 90 days", note:"" };
        const stratId = uid();
        if (existingStrat) {
          dispatch("UPDATE_STRATEGY", { id: existingStrat.id, status:"running", progress:0, currentStep:"Starting...", playbook:null, log:[], config:cfgToUse });
          ACTIVE_GENS.set(st.abbr, true);
          runGeneration(existingStrat.id, st, cfgToUse, "", dispatch);
        } else {
          const newS = { id:stratId, type:"expansion_playbook", stateAbbr:st.abbr, stateName:st.name, status:"running", progress:0, currentStep:"Starting...", config:cfgToUse, playbook:null, log:[], generatedAt:null };
          dispatch("ADD_STRATEGY", newS);
          ACTIVE_GENS.set(st.abbr, true);
          runGeneration(stratId, st, cfgToUse, "", dispatch);
        }
      }, idx * 2000);
    });
    if (remaining.length > 0) {
      toast(`Queued ${remaining.length} states for background generation`, "info");
    } else {
      toast("All states already have playbooks", "info");
    }
  };

  // ─── EXPORT ──────────────────────────────────────────────────────────────
  const exportPlaybook = (playbook) => {
    if(!playbook) return;
    const psd = playbook.state;
    const lines = [
      `ST1 SPORTS — ${psd.name.toUpperCase()} EXPANSION PLAYBOOK`,
      `Generated: ${new Date(playbook.generatedAt).toLocaleDateString()}`,
      `Focus: ${playbook.config.sports.join(", ")}`,
      "",
      "═══ MARKET OVERVIEW ═══",
      playbook.marketIntel.stateOverview||"",
      `High Schools: ${psd.highSchools}`,
      `Est. Market Size: $${(playbook.marketIntel.estimatedMarketSize||0).toLocaleString()}`,
      `Entry Difficulty: ${playbook.marketIntel.entryDifficulty||""}`,
      "",
      "═══ KEY CONTACTS ═══",
      ...(playbook.contacts||[]).map(c=>`${c.name||c.title} | ${c.organization} | ${c.city} | ${c.email||""} | ${c.phone||""} | Priority: ${c.priority}`),
      "",
      "═══ 90-DAY PLAN ═══",
      ...["phase1","phase2","phase3"].flatMap(ph=>{
        const p = playbook.plan90[ph]||{};
        return [`\n${p.label||ph}`,`Theme: ${p.theme||""}`,...(p.tasks||[]).map(t=>`  ${t.day}: ${t.task} [${t.owner}] [${t.priority}]`),`Milestone: ${p.milestone||""}`];
      }),
      "",
      "═══ BID CALENDAR ═══",
      `Fiscal Year Start: ${playbook.bidCalendar.fiscalYearStart||""}`,
      `Peak Buying: ${(playbook.bidCalendar.peakBuyingMonths||[]).join(", ")}`,
      ...(playbook.bidCalendar.purchasingCoops||[]).map(c=>`Coop: ${c.name} — ${c.description}`),
      "",
      "═══ EMAIL SEQUENCES ═══",
      ...(playbook.sequences||[]).flatMap(seq=>[
        `\n${seq.name} (${seq.target})`,
        ...(seq.touches||[]).flatMap(t=>[`\nTouch ${t.touchNum} — Day ${t.day}`,`Subject: ${t.subject}`,t.body])
      ]),
    ];
    const blob = new Blob([lines.join("\n")],{type:"text/plain"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ST1_${psd.abbr}_Expansion_Playbook_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
  };

  const exportContacts = (playbook) => {
    if(!playbook?.contacts?.length) return;
    const hdrs=["Name/Title","Organization","City","Type","Email","Phone","Priority","Sport","Notes"];
    const rows=playbook.contacts.map(c=>[
      `"${(c.name||c.title||"").replace(/"/g,'""')}"`,
      `"${(c.organization||"").replace(/"/g,'""')}"`,
      c.city||"",c.type||"",c.email||"",c.phone||"",c.priority||"",c.sport||"",
      `"${(c.notes||"").replace(/"/g,'""')}"`
    ].join(","));
    const csv=[hdrs.join(","),...rows].join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download=`ST1_${playbook.state.abbr}_Contacts.csv`;
    a.click();
  };

  // ─── UI HELPERS ───────────────────────────────────────────────────────────
  const Lbl=({children,color,style={}})=><div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:color||B.muted,letterSpacing:2.5,textTransform:"uppercase",...style}}>{children}</div>;

  const SectionBtn=({id,label,badge})=>(
    <button onClick={()=>setActiveSection(id)} style={{
      background:activeSection===id?B.orange:"transparent",
      color:activeSection===id?B.white:B.muted,
      border:`1px solid ${activeSection===id?B.orange:B.border}`,
      borderRadius:5,padding:"7px 14px",fontSize:10,
      fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.5,
      display:"flex",alignItems:"center",gap:6,
    }}>
      {label}
      {badge>0&&<span style={{background:activeSection===id?"rgba(255,255,255,.3)":B.orange,color:activeSection===id?B.white:B.white,borderRadius:10,padding:"1px 6px",fontSize:9}}>{badge}</span>}
    </button>
  );

  const PriorityDot=({p})=>{
    const c={high:B.orange,medium:B.yellow,low:B.green,critical:B.red}[p]||B.muted;
    const bg={high:B.orangeBg,medium:B.yellowBg,low:B.greenBg,critical:B.redBg}[p]||B.surface;
    return <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:c,background:bg,padding:"2px 6px",borderRadius:3,letterSpacing:.5}}>{(p||"").toUpperCase()}</span>;
  };

  // Status icon for left rail
  const StatusIcon = ({ strat }) => {
    if (!strat) return <span style={{color:B.gray2,fontSize:12}}>○</span>;
    if (strat.status==="running") return <span className="spin" style={{display:"inline-block",color:B.orange,fontSize:12}}>⟳</span>;
    if (strat.status==="done")    return <span style={{color:B.green,fontSize:12}}>✓</span>;
    if (strat.status==="error")   return <span style={{color:B.red,fontSize:12}}>✗</span>;
    return <span style={{color:B.gray2,fontSize:12}}>○</span>;
  };

  const playbook = currentStrat?.playbook || null;
  const isRunning = currentStrat?.status==="running";
  const isDone    = currentStrat?.status==="done";
  const isError   = currentStrat?.status==="error";
  const logC={success:B.green,warn:B.yellow,error:B.red,info:B.muted};

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{minHeight:"100vh",background:B.pageBg,fontFamily:"'Lexend',sans-serif",color:B.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px}
        button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s} button:hover{opacity:.82} button:active{transform:scale(.97)}
        input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .fu{animation:fadeUp .25s ease}
        .spin{animation:spin 1s linear infinite}
        .pulse{animation:pulse 1.5s infinite}
        .card{background:${B.white};border:1px solid ${B.border};border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
      `}</style>

      {/* HEADER */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3}}>STATE EXPANSION PLAYBOOK</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>GO-TO-MARKET ENGINE</div>
          </div>
        </div>
        {isDone&&playbook&&(
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>exportContacts(playbook)} style={{background:B.white,color:B.blue,border:`1px solid ${B.blue}`,borderRadius:5,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>↓ CONTACTS CSV</button>
            <button onClick={()=>exportPlaybook(playbook)} style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"7px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>↓ FULL PLAYBOOK</button>
            <button onClick={()=>handleGenerate(true)} style={{background:B.white,color:B.muted,border:`1px solid ${B.border}`,borderRadius:5,padding:"7px 12px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>⟳ REGENERATE</button>
          </div>
        )}
      </div>

      {/* PROGRESS BAR (global top) */}
      {isRunning&&<div style={{height:3,background:B.border}}><div style={{height:"100%",width:`${currentStrat?.progress||0}%`,background:B.orange,transition:"width .6s"}}/></div>}

      {/* REGEN CONFIRM MODAL */}
      {showRegenConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:B.white,borderRadius:10,padding:28,maxWidth:400,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,marginBottom:12}}>REGENERATE PLAYBOOK?</div>
            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:20,lineHeight:1.7}}>
              A playbook for {sd.name} already exists. Regenerating will replace it with a fresh AI-generated plan. The old playbook will be lost.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>handleGenerate(true)} style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"9px 20px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:10,fontWeight:700,letterSpacing:.5}}>YES, REGENERATE</button>
              <button onClick={()=>setShowRegenConfirm(false)} style={{background:B.white,color:B.muted,border:`1px solid ${B.border}`,borderRadius:5,padding:"9px 20px",fontSize:12,fontFamily:"'Lexend',sans-serif"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* LAYOUT: Left Rail + Main */}
      <div style={{display:"flex",minHeight:"calc(100vh - 64px)"}}>

        {/* ── LEFT RAIL ── */}
        <div style={{width:220,flexShrink:0,background:B.white,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",padding:"16px 0"}}>
          <div style={{padding:"0 14px 10px",borderBottom:`1px solid ${B.border}`,marginBottom:8}}>
            <Lbl style={{fontSize:7,letterSpacing:2,color:B.orange}}>Expansion States</Lbl>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {EXPANSION_STATES.map(st=>{
              const strat = getStrat(st.abbr);
              const isActive = selectedState===st.abbr;
              const isDoneS = strat?.status==="done";
              const isRunS  = strat?.status==="running";
              const isErrS  = strat?.status==="error";
              return (
                <button key={st.abbr} onClick={()=>{setSelectedState(st.abbr);setActiveSection("overview");}}
                  style={{
                    width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 14px",
                    background:isActive?(isDoneS?B.greenBg:isRunS?B.orangeBg:B.blueBg):"transparent",
                    border:"none",borderLeft:isActive?`3px solid ${isDoneS?B.green:isRunS?B.orange:B.blue}`:"3px solid transparent",
                    textAlign:"left",transition:"all .12s",
                  }}>
                  <span style={{flexShrink:0,width:16,textAlign:"center"}}>
                    {isRunS
                      ? <span className="spin" style={{display:"inline-block",color:B.orange,fontSize:13}}>⟳</span>
                      : isDoneS
                        ? <span style={{color:B.green,fontSize:13}}>✓</span>
                        : isErrS
                          ? <span style={{color:B.red,fontSize:13}}>✗</span>
                          : <span style={{color:B.gray2,fontSize:13}}>○</span>
                    }
                  </span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,color:isActive?(isDoneS?B.green:isRunS?B.orange:B.blue):B.textMid,letterSpacing:.5}}>
                      {st.abbr} {st.name}
                    </div>
                    {isRunS&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.orange,marginTop:1}}>{strat.progress||0}%</div>}
                    {isDoneS&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.green,marginTop:1}}>Done</div>}
                    {isErrS&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.red,marginTop:1}}>Error</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{padding:"12px 14px",borderTop:`1px solid ${B.border}`}}>
            <button onClick={handleRunAll}
              style={{width:"100%",background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"9px 10px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,textAlign:"center"}}>
              ⊕ RUN ALL REMAINING
            </button>
          </div>
        </div>

        {/* ── MAIN AREA ── */}
        <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>

          {/* ── CONFIG / NOT STARTED ── */}
          {!isRunning && !isDone && (
            <div className="fu">
              <div style={{marginBottom:24}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:B.black,letterSpacing:.3}}>BUILD YOUR EXPANSION PLAYBOOK</div>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginTop:2}}>{sd.name.toUpperCase()} · {sd.highSchools} HIGH SCHOOLS · {sd.region.toUpperCase()}</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginTop:6}}>Configure your strategy — AI will generate a complete go-to-market plan with real contacts, bid calendar, and 90-day execution plan</div>
                <div style={{width:40,height:3,background:B.orange,marginTop:10,borderRadius:2}}/>
              </div>

              {/* Error banner */}
              {isError&&(
                <div style={{marginBottom:16,padding:"12px 16px",background:B.redBg,border:`1px solid ${B.red}30`,borderRadius:6,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{color:B.red,fontSize:16}}>✗</span>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.red,fontWeight:500}}>Previous generation failed</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{currentStrat?.currentStep}</div>
                  </div>
                </div>
              )}

              {/* CRM Awareness Panel */}
              {(stateContacts.length > 0 || stateDeals.length > 0) && (
                <div style={{marginBottom:20,padding:"12px 16px",background:B.greenBg,border:`1px solid ${B.green}30`,borderRadius:6,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{color:B.green,fontSize:16}}>✓</span>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.6}}>
                    We have <strong style={{color:B.green}}>{stateContacts.length} contact{stateContacts.length!==1?"s":""}</strong> and <strong style={{color:B.green}}>{stateDeals.length} open deal{stateDeals.length!==1?"s":""}</strong> in {sd.name} — this data will be included in the playbook generation.
                  </div>
                </div>
              )}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,maxWidth:900}}>
                {/* Sports focus */}
                <div className="card">
                  <Lbl style={{marginBottom:10}}>Sports Focus</Lbl>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {SPORTS_FOCUS.map(sp=>(
                      <button key={sp} onClick={()=>setConfig(c=>({...c,sports:tog(c.sports,sp)}))}
                        style={{background:config.sports.includes(sp)?`${B.orange}18`:B.white,color:config.sports.includes(sp)?B.orange:B.muted,border:`1px solid ${config.sports.includes(sp)?B.orange:B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Strategy */}
                <div className="card">
                  <Lbl style={{marginBottom:10}}>Entry Priority</Lbl>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {PRIORITIES.map(p=>(
                      <label key={p} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"5px 0"}}>
                        <input type="radio" checked={config.priority===p} onChange={()=>setConfig(c=>({...c,priority:p}))} style={{accentColor:B.orange}}/>
                        <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:config.priority===p?B.text:B.muted}}>{p}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Team & Budget */}
                <div className="card">
                  <Lbl style={{marginBottom:10}}>Team & Resources</Lbl>
                  <div style={{marginBottom:10}}>
                    <Lbl style={{marginBottom:4,fontSize:7}}>Team Size</Lbl>
                    <select value={config.teamSize} onChange={e=>setConfig(c=>({...c,teamSize:e.target.value}))}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}>
                      {["Matt only","Matt + 1 rep","Matt + 2 reps","Full team (3+)"].map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl style={{marginBottom:4,fontSize:7}}>First 90 Days Budget</Lbl>
                    <select value={config.budget} onChange={e=>setConfig(c=>({...c,budget:e.target.value}))}
                      style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"7px 10px",fontSize:12}}>
                      {["Under $1,000","$1,000–$2,500","$2,000–$5,000","$5,000–$10,000","$10,000+"].map(b=><option key={b}>{b}</option>)}
                    </select>
                  </div>
                </div>

                {/* Additional context */}
                <div className="card">
                  <Lbl style={{marginBottom:8}}>Additional Context (Optional)</Lbl>
                  <textarea value={config.note} onChange={e=>setConfig(c=>({...c,note:e.target.value}))} rows={3}
                    placeholder="e.g. We have a contact at the state association, we're strong on T&F timing systems, we want to focus on suburban districts..."
                    style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"8px 10px",fontSize:12,resize:"vertical"}}/>
                </div>

                {/* What we build */}
                <div className="card" style={{borderLeft:`3px solid ${B.orange}`}}>
                  <Lbl style={{marginBottom:10,color:B.orange}}>What Gets Generated</Lbl>
                  {[
                    ["Market Intelligence","Market size, competitor analysis, entry difficulty, seasonal patterns"],
                    ["15-20 Key Contacts","ADs, coaches, procurement, associations — with emails/phones where public"],
                    ["Bid Calendar","Monthly action calendar, purchasing coops, active RFPs, registration steps"],
                    ["90-Day Plan","Week-by-week tasks, milestones, KPIs, revenue targets"],
                    ["Email Sequences","2 ready-to-send outreach sequences for Instantly/Zoho"],
                    ["Positioning Strategy","Value props, competitive differentiators, messaging by audience"],
                  ].map(([t,d])=>(
                    <div key={t} style={{display:"flex",gap:8,marginBottom:8}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:B.orange,marginTop:5,flexShrink:0}}/>
                      <div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{t}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.5}}>{d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={()=>handleGenerate(false)} disabled={!config.sports.length}
                style={{marginTop:24,background:config.sports.length?B.orange:B.border,color:config.sports.length?B.white:B.muted,border:"none",borderRadius:6,padding:"13px 36px",fontFamily:"'Russo One',sans-serif",fontSize:15,letterSpacing:.5,display:"flex",alignItems:"center",gap:10}}>
                ⊕ GENERATE {sd.name.toUpperCase()} PLAYBOOK
              </button>
            </div>
          )}

          {/* ── GENERATING ── */}
          {isRunning&&(
            <div style={{textAlign:"center",padding:"60px 0"}} className="fu">
              <div style={{width:60,height:60,border:`4px solid ${B.border}`,borderTop:`4px solid ${B.orange}`,borderRadius:"50%",margin:"0 auto 20px",animation:"spin 1s linear infinite"}}/>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.black,letterSpacing:.3,marginBottom:8}}>
                BUILDING {sd.name.toUpperCase()} PLAYBOOK
              </div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:6}}>
                {currentStrat?.progress||0}% complete — researching market, finding contacts, building your 90-day plan...
              </div>
              <div style={{maxWidth:460,margin:"20px auto",textAlign:"left",background:B.white,borderRadius:8,padding:16,border:`1px solid ${B.border}`}}>
                {currentStrat?.currentStep&&(
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.orange,padding:"3px 0",lineHeight:1.7,display:"flex",gap:6,alignItems:"center"}}>
                    <span className="pulse" style={{color:B.orange,fontSize:12}}>●</span>
                    {currentStrat.currentStep}
                  </div>
                )}
                {(currentStrat?.log||[]).slice(-5).reverse().map((l,i)=>(
                  <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:logC[l.type]||B.muted,padding:"3px 0",lineHeight:1.7,display:"flex",gap:6,alignItems:"center"}}>
                    {l.type==="success"?<span style={{color:B.green,fontSize:12}}>✓</span>:<span style={{color:B.muted,fontSize:12}}>·</span>}
                    {l.msg}
                  </div>
                ))}
              </div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
                You can navigate away — generation continues in the background
              </div>
            </div>
          )}

          {/* ── PLAYBOOK VIEW ── */}
          {isDone&&playbook&&(
            <div className="fu">
              {/* Header bar */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                <div>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:26,color:B.black,letterSpacing:.3}}>{playbook.state.name.toUpperCase()} EXPANSION PLAYBOOK</div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:3}}>
                    Focus: {playbook.config.sports.join(", ")} · {playbook.state.highSchools} high schools · Generated {new Date(playbook.generatedAt).toLocaleDateString()}
                  </div>
                  <div style={{width:40,height:3,background:B.orange,marginTop:8,borderRadius:2}}/>
                </div>
              </div>

              {/* Revenue targets */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                {[
                  ["Market Size",`$${((playbook.marketIntel.estimatedMarketSize||0)/1000000).toFixed(1)}M`,B.orange,"Annual athletic equipment spend"],
                  ["Year 1 Target",`$${((playbook.plan90?.revenueTargetYear1||0)/1000).toFixed(0)}K`,B.green,"Realistic first year revenue"],
                  ["90-Day Target",`$${((playbook.plan90?.revenueTarget90Days||0)/1000).toFixed(0)}K`,B.blue,"First 90 days goal"],
                  ["Key Contacts",playbook.contacts.length,B.purple,"Identified decision makers"],
                ].map(([l,v,c,sub])=>(
                  <div key={l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"14px",borderTop:`3px solid ${c}`,textAlign:"center"}}>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:c}}>{v}</div>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginTop:4}}>{l.toUpperCase()}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Section nav */}
              <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
                <SectionBtn id="overview"   label="Overview"/>
                <SectionBtn id="contacts"   label="Contacts"   badge={playbook.contacts.length}/>
                <SectionBtn id="plan"       label="90-Day Plan"/>
                <SectionBtn id="calendar"   label="Bid Calendar"/>
                <SectionBtn id="sequences"  label="Email Sequences"/>
                <SectionBtn id="positioning"label="Positioning"/>
              </div>

              {/* ── OVERVIEW ── */}
              {activeSection==="overview"&&(
                <div className="fu">
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                    <div className="card" style={{borderTop:`3px solid ${B.orange}`}}>
                      <Lbl style={{marginBottom:10}}>Market Intelligence</Lbl>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.8,marginBottom:12}}>{playbook.marketIntel.stateOverview}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {[
                          ["High Schools",playbook.state.highSchools],
                          ["School Districts",playbook.marketIntel.estimatedDistricts||"—"],
                          ["State Association",playbook.marketIntel["stateAthletic Association"]||"—"],
                          ["Entry Difficulty",playbook.marketIntel.entryDifficulty||"—"],
                        ].map(([l,v])=>(
                          <div key={l} style={{background:B.surface,borderRadius:4,padding:"8px 10px"}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:3}}>{l.toUpperCase()}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {playbook.marketIntel.marketOpportunity&&(
                        <div style={{marginTop:12,padding:"10px 12px",background:B.greenBg,borderRadius:5,border:`1px solid ${B.green}30`}}>
                          <Lbl style={{color:B.green,marginBottom:4}}>Key Opportunity</Lbl>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,lineHeight:1.6}}>{playbook.marketIntel.marketOpportunity}</div>
                        </div>
                      )}
                    </div>

                    <div className="card" style={{borderTop:`3px solid ${B.red}`}}>
                      <Lbl style={{marginBottom:10}}>Competitive Landscape</Lbl>
                      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
                        {(playbook.marketIntel.keyCompetitors||[]).map((c,i)=>(
                          <div key={i} style={{background:B.surface,borderRadius:5,padding:"9px 11px",borderLeft:`2px solid ${B.red}`}}>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{c.name}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:1}}>Strength: {c.strength}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.green}}>Gap: {c.weakness}</div>
                          </div>
                        ))}
                      </div>
                      <Lbl style={{marginBottom:8}}>Quick Wins — First 30 Days</Lbl>
                      {(playbook.plan90?.quickWins||[]).map((w,i)=>(
                        <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,padding:"5px 0",borderBottom:`1px solid ${B.border}`,display:"flex",gap:7}}>
                          <span style={{color:B.green,fontWeight:500,flexShrink:0}}>{i+1}.</span>{w}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Positioning headline */}
                  {playbook.positioning.headline&&(
                    <div style={{background:B.orange,borderRadius:8,padding:"20px 24px",marginBottom:16,textAlign:"center"}}>
                      <Lbl style={{color:"rgba(255,255,255,.7)",marginBottom:8}}>ST1 Positioning in {playbook.state.name}</Lbl>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.white,letterSpacing:.3,lineHeight:1.4}}>{playbook.positioning.headline}</div>
                    </div>
                  )}

                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                    {(playbook.positioning.valueProps||[]).map((vp,i)=>(
                      <div key={i} className="card" style={{borderTop:`2px solid ${[B.orange,B.blue,B.green][i]||B.muted}`}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:5}}>{vp.prop}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.6}}>{vp.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── CONTACTS ── */}
              {activeSection==="contacts"&&(
                <div className="fu">
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,alignItems:"center"}}>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>{playbook.contacts.length} identified contacts · sorted by priority</div>
                    <button onClick={()=>exportContacts(playbook)} style={{background:B.blue,color:B.white,border:"none",borderRadius:4,padding:"6px 14px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>↓ EXPORT CSV</button>
                  </div>
                  {["high","medium","low"].map(priority=>{
                    const group=playbook.contacts.filter(c=>c.priority===priority);
                    if(!group.length) return null;
                    const color={high:B.orange,medium:B.yellow,low:B.green}[priority];
                    return (
                      <div key={priority} style={{marginBottom:20}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                          <div style={{width:8,height:8,borderRadius:2,background:color}}/>
                          <Lbl style={{color}}>{priority.toUpperCase()} PRIORITY ({group.length})</Lbl>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:8}}>
                          {group.map((c,i)=>(
                            <div key={i} className="card" style={{borderLeft:`3px solid ${color}`,padding:"11px 13px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                <div style={{flex:1}}>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{c.name||c.title}</div>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:1}}>{c.title} · {c.organization}</div>
                                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.city} · {c.type}</div>
                                  {c.email&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.blue,marginTop:3}}>{c.email}</div>}
                                  {c.phone&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{c.phone}</div>}
                                  {c.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.textMid,marginTop:4,lineHeight:1.5,fontStyle:"italic"}}>{c.notes}</div>}
                                </div>
                                {c.sport&&c.sport!=="General"&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,background:B.orangeBg,padding:"2px 5px",borderRadius:3,marginLeft:8,flexShrink:0}}>{c.sport}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── 90-DAY PLAN ── */}
              {activeSection==="plan"&&(
                <div className="fu">
                  {["phase1","phase2","phase3"].map((ph,pi)=>{
                    const phase=playbook.plan90[ph]||{};
                    const colors=[B.orange,B.blue,B.green];
                    const c=colors[pi];
                    return (
                      <div key={ph} style={{marginBottom:20}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,padding:"12px 16px",background:`${c}15`,borderRadius:7,border:`1px solid ${c}30`,borderLeft:`4px solid ${c}`}}>
                          <div>
                            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:c,letterSpacing:.3}}>{phase.label}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginTop:2}}>{phase.theme}</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:3}}>MILESTONE</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,maxWidth:240,textAlign:"right"}}>{phase.milestone}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                          {(phase.tasks||[]).map((t,i)=>(
                            <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"9px 12px",background:B.white,borderRadius:5,border:`1px solid ${B.border}`}}>
                              <div style={{flexShrink:0,textAlign:"center",minWidth:70}}>
                                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>{t.day}</div>
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{t.task}</div>
                                <div style={{display:"flex",gap:8}}>
                                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>👤 {t.owner}</span>
                                  {t.effort&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>⏱ {t.effort}</span>}
                                </div>
                              </div>
                              <PriorityDot p={t.priority}/>
                            </div>
                          ))}
                        </div>
                        {phase.kpis?.length>0&&(
                          <div style={{padding:"10px 14px",background:B.surface,borderRadius:5,border:`1px solid ${B.border}`}}>
                            <Lbl style={{marginBottom:6}}>KPIs for This Phase</Lbl>
                            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                              {phase.kpis.map((k,i)=><span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:c,background:`${c}12`,padding:"3px 10px",borderRadius:4}}>{k}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {playbook.plan90.biggestRisks?.length>0&&(
                    <div className="card" style={{borderTop:`3px solid ${B.red}`}}>
                      <Lbl style={{color:B.red,marginBottom:10}}>Biggest Risks & Mitigations</Lbl>
                      {playbook.plan90.biggestRisks.map((r,i)=>(
                        <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.textMid,padding:"7px 0",borderBottom:`1px solid ${B.border}`,lineHeight:1.6,display:"flex",gap:8}}>
                          <span style={{color:B.red,flexShrink:0,fontWeight:500}}>{i+1}.</span>{r}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── BID CALENDAR ── */}
              {activeSection==="calendar"&&(
                <div className="fu">
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                    <div className="card" style={{borderTop:`3px solid ${B.blue}`}}>
                      <Lbl style={{marginBottom:10}}>Purchasing Cycle</Lbl>
                      {[
                        ["Fiscal Year Start",playbook.bidCalendar.fiscalYearStart],
                        ["Budget Approval",  (playbook.bidCalendar.budgetApprovalMonths||[]).join(", ")],
                        ["Peak Buying",      (playbook.bidCalendar.peakBuyingMonths||[]).join(", ")],
                        ["RFP Season",       (playbook.bidCalendar.rfpSeasonMonths||[]).join(", ")],
                      ].map(([l,v])=>v&&(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{l}</span>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{v}</span>
                        </div>
                      ))}
                    </div>

                    <div className="card" style={{borderTop:`3px solid ${B.green}`}}>
                      <Lbl style={{marginBottom:10}}>Vendor Registration</Lbl>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:playbook.bidCalendar.bidRegistrationRequired?B.yellow:B.green,fontWeight:500,marginBottom:8}}>
                        {playbook.bidCalendar.bidRegistrationRequired?"Registration required to bid":"No special registration required"}
                      </div>
                      {(playbook.bidCalendar.bidRegistrationSteps||[]).map((step,i)=>(
                        <div key={i} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                          <span style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:B.orange,minWidth:18}}>{i+1}</span>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.5}}>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Purchasing coops */}
                  {(playbook.bidCalendar.purchasingCoops||[]).length>0&&(
                    <div className="card" style={{marginBottom:16,borderTop:`3px solid ${B.purple}`}}>
                      <Lbl style={{marginBottom:12,color:B.purple}}>Purchasing Cooperatives — Get On These Lists</Lbl>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                        {playbook.bidCalendar.purchasingCoops.map((c,i)=>(
                          <div key={i} style={{background:B.purpleBg,borderRadius:5,padding:"10px 12px",border:`1px solid ${B.purple}25`}}>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:3}}>{c.name}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:4}}>{c.description}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.purple}}>{c.relevance}</div>
                            {c.website&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,marginTop:3}}>{c.website}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Monthly calendar */}
                  <div className="card">
                    <Lbl style={{marginBottom:12}}>Monthly Action Calendar</Lbl>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                      {(playbook.bidCalendar.monthlyCalendar||[]).map((m,i)=>{
                        const pc={high:B.orange,medium:B.blue,low:B.muted}[m.priority]||B.muted;
                        const pbg={high:B.orangeBg,medium:B.blueBg,low:B.surface}[m.priority]||B.surface;
                        return (
                          <div key={i} style={{background:pbg,borderRadius:5,padding:"10px 12px",border:`1px solid ${pc}25`,borderTop:`2px solid ${pc}`}}>
                            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:pc,marginBottom:5}}>{m.month}</div>
                            <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,lineHeight:1.6}}>{m.action}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── EMAIL SEQUENCES ── */}
              {activeSection==="sequences"&&(
                <div className="fu">
                  {(playbook.sequences||[]).map((seq,si)=>(
                    <div key={si} style={{marginBottom:24}}>
                      <div style={{padding:"11px 14px",background:B.surface,borderRadius:6,border:`1px solid ${B.border}`,borderLeft:`3px solid ${B.purple}`,marginBottom:12}}>
                        <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3,marginBottom:2}}>{seq.name}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>Target: {seq.target} · {seq.touches?.length} touches</div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        {(seq.touches||[]).map((t,i)=>(
                          <div key={i} className="card" style={{borderLeft:`3px solid ${B.purple}`}}>
                            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                              <span style={{background:B.purple,color:B.white,borderRadius:3,padding:"2px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,letterSpacing:1,flexShrink:0}}>TOUCH {t.touchNum} · DAY {t.day}</span>
                              <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{t.subject}</span>
                            </div>
                            <div style={{background:B.surface,borderRadius:4,padding:"10px 12px",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.75,whiteSpace:"pre-wrap",marginBottom:8}}>{t.body}</div>
                            <button onClick={()=>navigator.clipboard?.writeText(`Subject: ${t.subject}\n\n${t.body}`)}
                              style={{background:B.white,color:B.muted,border:`1px solid ${B.border}`,borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>COPY</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>navigator.clipboard?.writeText((seq.touches||[]).map(t=>`--- TOUCH ${t.touchNum} (Day ${t.day}) ---\nSUBJECT: ${t.subject}\n\n${t.body}`).join("\n\n"))}
                        style={{marginTop:8,background:B.purple,color:B.white,border:"none",borderRadius:4,padding:"7px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>
                        COPY FULL SEQUENCE
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── POSITIONING ── */}
              {activeSection==="positioning"&&(
                <div className="fu">
                  {playbook.positioning.headline&&(
                    <div style={{background:B.orange,borderRadius:8,padding:"20px 24px",marginBottom:16,textAlign:"center"}}>
                      <Lbl style={{color:"rgba(255,255,255,.7)",marginBottom:8}}>Core Positioning Statement</Lbl>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.white,letterSpacing:.3,lineHeight:1.5}}>{playbook.positioning.headline}</div>
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                    <div className="card" style={{borderTop:`3px solid ${B.green}`}}>
                      <Lbl style={{marginBottom:10}}>Competitive Differentiators</Lbl>
                      {(playbook.positioning.competitiveDifferentiators||[]).map((d,i)=>(
                        <div key={i} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:`1px solid ${B.border}`}}>
                          <span style={{color:B.green,flexShrink:0,fontWeight:500,fontSize:14}}>✓</span>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.6}}>{d}</span>
                        </div>
                      ))}
                    </div>
                    <div className="card" style={{borderTop:`3px solid ${B.blue}`}}>
                      <Lbl style={{marginBottom:10}}>Pricing Strategy</Lbl>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7,marginBottom:12}}>{playbook.positioning.pricingStrategy}</div>
                      <Lbl style={{marginBottom:8}}>Partnership Opportunities</Lbl>
                      {(playbook.positioning.partnershipOpportunities||[]).map((p,i)=>(
                        <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,padding:"4px 0",borderBottom:`1px solid ${B.border}`}}>· {p}</div>
                      ))}
                    </div>
                  </div>
                  <div className="card" style={{borderTop:`3px solid ${B.purple}`}}>
                    <Lbl style={{marginBottom:12,color:B.purple}}>Messaging by Audience</Lbl>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                      {Object.entries(playbook.positioning.messagingByAudience||{}).map(([audience,msg])=>(
                        <div key={audience} style={{background:B.purpleBg,borderRadius:5,padding:"12px 14px",border:`1px solid ${B.purple}20`}}>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.purple,letterSpacing:1.5,marginBottom:6}}>{audience.replace(/([A-Z])/g," $1").trim().toUpperCase()}</div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,lineHeight:1.7}}>{msg}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
