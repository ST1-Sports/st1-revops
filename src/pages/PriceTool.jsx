import { useState, useRef, useCallback, useEffect } from "react";

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
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_SUPPLIERS = [
  {
    id:"blazer", name:"Blazer Athletic", category:"Track & Field", lastUpdated:"2026-02-15",
    rep:"Dave Schiller", repEmail:"dschiller@blazersports.com", repPhone:"800-555-0141",
    notes:"Annual price list — typically increases 3-5% each fall",
    products:[
      {id:"b1",  sku:"BL-39AL",  name:"Aluminum Hurdle 39\"",         cost:224.00, map:null,  ourPrice:280.00, category:"Hurdles",         unit:"each",  lastCost:210.00, updatedAt:"2026-02-15"},
      {id:"b2",  sku:"BL-30AL",  name:"Aluminum Hurdle 30\"",         cost:212.00, map:null,  ourPrice:265.00, category:"Hurdles",         unit:"each",  lastCost:199.00, updatedAt:"2026-02-15"},
      {id:"b3",  sku:"BL-SB",    name:"Starting Blocks Aluminum",     cost:156.00, map:null,  ourPrice:195.00, category:"Sprint",          unit:"each",  lastCost:148.00, updatedAt:"2026-02-15"},
      {id:"b4",  sku:"BL-HH39",  name:"Steel Hurdle 39\" High Boy",   cost:248.00, map:null,  ourPrice:315.00, category:"Hurdles",         unit:"each",  lastCost:235.00, updatedAt:"2026-02-15"},
      {id:"b5",  sku:"BL-DISC",  name:"Discus 1.6kg Men",             cost:67.20,  map:null,  ourPrice:88.00,  category:"Throws",          unit:"each",  lastCost:63.00,  updatedAt:"2026-02-15"},
      {id:"b6",  sku:"BL-SP36",  name:"Sprint Spikes Youth",          cost:26.40,  map:null,  ourPrice:34.00,  category:"Spikes",          unit:"each",  lastCost:24.50,  updatedAt:"2026-02-15"},
      {id:"b7",  sku:"BL-SP38",  name:"Sprint Spikes Collegiate",     cost:25.20,  map:null,  ourPrice:32.00,  category:"Spikes",          unit:"each",  lastCost:23.50,  updatedAt:"2026-02-15"},
      {id:"b8",  sku:"BL-PVS",   name:"Pole Vault Standards",         cost:1480.00,map:null,  ourPrice:1850.00,category:"Pole Vault",      unit:"set",   lastCost:1380.00,updatedAt:"2026-02-15"},
      {id:"b9",  sku:"BL-MT50",  name:"Measuring Tape 50m",           cost:241.00, map:null,  ourPrice:301.00, category:"Accessories",     unit:"each",  lastCost:226.00, updatedAt:"2026-02-15"},
      {id:"b10", sku:"BL-TC",    name:"Throwing Circle",              cost:435.00, map:null,  ourPrice:544.00, category:"Throws",          unit:"each",  lastCost:408.00, updatedAt:"2026-02-15"},
    ]
  },
  {
    id:"gill", name:"Gill Athletics", category:"Track & Field", lastUpdated:"2026-01-20",
    rep:"Sarah Watts", repEmail:"swatts@gillathletics.com", repPhone:"800-555-0162",
    notes:"Dealer pricing — 25% off list. Price list updates semi-annually.",
    products:[
      {id:"g1",  sku:"GA-SP8",   name:"Soft Shot Put 8lb Girls",      cost:112.00, map:null,  ourPrice:154.00, category:"Throws",          unit:"each",  lastCost:104.00, updatedAt:"2026-01-20"},
      {id:"g2",  sku:"GA-SP12",  name:"Soft Shot Put 12lb Boys",      cost:118.00, map:null,  ourPrice:154.00, category:"Throws",          unit:"each",  lastCost:110.00, updatedAt:"2026-01-20"},
      {id:"g3",  sku:"GA-SP4K",  name:"Soft Shot Put 4kg Women",      cost:118.00, map:null,  ourPrice:154.00, category:"Throws",          unit:"each",  lastCost:110.00, updatedAt:"2026-01-20"},
      {id:"g4",  sku:"GA-SP16",  name:"Soft Shot Put 16lb College",   cost:148.00, map:null,  ourPrice:198.00, category:"Throws",          unit:"each",  lastCost:138.00, updatedAt:"2026-01-20"},
      {id:"g5",  sku:"GA-DM16",  name:"Discus 1.6kg HS Men",          cost:70.40,  map:null,  ourPrice:88.00,  category:"Throws",          unit:"each",  lastCost:65.00,  updatedAt:"2026-01-20"},
      {id:"g6",  sku:"GA-DM1K",  name:"Discus 1.0kg Girls",           cost:58.40,  map:null,  ourPrice:73.00,  category:"Throws",          unit:"each",  lastCost:54.00,  updatedAt:"2026-01-20"},
      {id:"g7",  sku:"GA-HM726", name:"Hammer 7.26kg",                cost:118.40, map:null,  ourPrice:148.00, category:"Throws",          unit:"each",  lastCost:110.00, updatedAt:"2026-01-20"},
      {id:"g8",  sku:"GA-JV800", name:"Javelin 800g Men",             cost:119.20, map:null,  ourPrice:149.00, category:"Throws",          unit:"each",  lastCost:110.00, updatedAt:"2026-01-20"},
      {id:"g9",  sku:"GA-ROB6",  name:"Robic SC-606W Timer 6-pack",   cost:222.00, map:null,  ourPrice:299.00, category:"Timing",          unit:"set",   lastCost:207.00, updatedAt:"2026-01-20"},
    ]
  },
  {
    id:"diamond", name:"Diamond Baseballs", category:"Baseball/Softball", lastUpdated:"2026-03-01",
    rep:"Tom Brady Jr.", repEmail:"tbradyjr@diamondsports.com", repPhone:"800-555-0183",
    notes:"Volume discounts available at 12+ dozen. Price list updates annually in March.",
    products:[
      {id:"d1",  sku:"DIA-DOL1", name:"DOL-1 Official Game Ball",     cost:52.00,  map:null,  ourPrice:72.00,  category:"Game Balls",      unit:"dozen", lastCost:48.00,  updatedAt:"2026-03-01"},
      {id:"d2",  sku:"DIA-D1",   name:"D1 Pro Game Ball",             cost:66.00,  map:null,  ourPrice:88.00,  category:"Game Balls",      unit:"dozen", lastCost:61.00,  updatedAt:"2026-03-01"},
      {id:"d3",  sku:"DIA-OB",   name:"D1-OB Official Baseball",      cost:58.00,  map:null,  ourPrice:78.00,  category:"Game Balls",      unit:"dozen", lastCost:53.00,  updatedAt:"2026-03-01"},
      {id:"d4",  sku:"DIA-BP",   name:"DBX-1 BP Ball",                cost:24.00,  map:null,  ourPrice:34.00,  category:"Practice Balls",  unit:"dozen", lastCost:22.00,  updatedAt:"2026-03-01"},
      {id:"d5",  sku:"DIA-SB",   name:"DSB-1 Softball 12\"",          cost:44.00,  map:null,  ourPrice:60.00,  category:"Softballs",       unit:"dozen", lastCost:41.00,  updatedAt:"2026-03-01"},
      {id:"d6",  sku:"DIA-HEL",  name:"DBX-1 Batter Helmet",         cost:98.00,  map:null,  ourPrice:125.00, category:"Helmets",         unit:"each",  lastCost:90.00,  updatedAt:"2026-03-01"},
    ]
  },
  {
    id:"molten", name:"Molten Volleyballs", category:"Volleyball", lastUpdated:"2025-11-10",
    rep:"Lisa Chen", repEmail:"lchen@moltenusa.com", repPhone:"800-555-0204",
    notes:"MAP pricing strictly enforced. Annual price increase typically 4-6%.",
    products:[
      {id:"m1",  sku:"MOL-V5M5", name:"V5M5000 Game Ball",            cost:52.00,  map:68.00, ourPrice:68.00,  category:"Game Balls",      unit:"each",  lastCost:49.00,  updatedAt:"2025-11-10"},
      {id:"m2",  sku:"MOL-V5M4", name:"V5M4500 Practice Ball",        cost:38.00,  map:49.00, ourPrice:49.00,  category:"Practice Balls",  unit:"each",  lastCost:36.00,  updatedAt:"2025-11-10"},
      {id:"m3",  sku:"MOL-V5B5", name:"V5B5000 Beach Ball",           cost:44.00,  map:58.00, ourPrice:58.00,  category:"Beach",           unit:"each",  lastCost:41.00,  updatedAt:"2025-11-10"},
      {id:"m4",  sku:"MOL-V4M",  name:"V4M4000 Men Game Ball",        cost:56.00,  map:74.00, ourPrice:74.00,  category:"Game Balls",      unit:"each",  lastCost:53.00,  updatedAt:"2025-11-10"},
    ]
  },
  {
    id:"wilson", name:"Wilson / DeMarini", category:"Baseball/Softball", lastUpdated:"2026-01-08",
    rep:"Chris Park", repEmail:"cpark@wilson.com", repPhone:"800-555-0227",
    notes:"MAP strictly enforced. Dealer cost typically 40-45% off MSRP. BBCOR/USA/USSSA bats.",
    products:[
      {id:"w1",  sku:"WIL-A2000","name":"A2000 1786 11.5\" Glove",    cost:169.00, map:282.00,ourPrice:282.00, category:"Gloves",          unit:"each",  lastCost:162.00, updatedAt:"2026-01-08"},
      {id:"w2",  sku:"WIL-A2PIT","name":"A2000 Pitcher Glove 12\"",  cost:169.00, map:282.00,ourPrice:282.00, category:"Gloves",          unit:"each",  lastCost:162.00, updatedAt:"2026-01-08"},
      {id:"w3",  sku:"DEM-VOO1", name:"DeMarini Voodoo One BBCOR",   cost:179.00, map:299.00,ourPrice:299.00, category:"Bats BBCOR",      unit:"each",  lastCost:171.00, updatedAt:"2026-01-08"},
      {id:"w4",  sku:"DEM-CFX",  name:"DeMarini CF -10 Fastpitch",   cost:209.00, map:349.00,ourPrice:349.00, category:"Bats Fastpitch",  unit:"each",  lastCost:199.00, updatedAt:"2026-01-08"},
      {id:"w5",  sku:"WIL-A1K",  name:"Wilson A1K DP15 Glove",       cost:107.00, map:179.00,ourPrice:179.00, category:"Gloves",          unit:"each",  lastCost:102.00, updatedAt:"2026-01-08"},
    ]
  },
  {
    id:"finishlynx", name:"FinishLynx / Lynx", category:"Timing Systems", lastUpdated:"2025-10-01",
    rep:"Mark Johnson", repEmail:"mjohnson@finishlynx.com", repPhone:"519-555-0188",
    notes:"Technology products — pricing stable but upgrades frequent. Bundle discounts available.",
    products:[
      {id:"f1",  sku:"FL-1A205U", name:"Capture Button + USB Cord",   cost:398.00, map:null,  ourPrice:498.00, category:"Hardware",        unit:"each",  lastCost:385.00, updatedAt:"2025-10-01"},
      {id:"f2",  sku:"FL-EV",    name:"EtherLynx Vision Camera",      cost:3200.00,map:null,  ourPrice:3995.00,category:"Cameras",         unit:"each",  lastCost:3100.00,updatedAt:"2025-10-01"},
      {id:"f3",  sku:"FL-REF",   name:"FinishLynx RefSync Module",    cost:890.00, map:null,  ourPrice:1095.00,category:"Hardware",        unit:"each",  lastCost:850.00, updatedAt:"2025-10-01"},
    ]
  },
];

// Open deals that use these products
const SEED_DEALS = [
  {id:"deal1", name:"Ankeny CSD — T&F Spring", school:"Ankeny CSD", stage:"Follow-Up 1", value:4200, assignee:"Matt",
   items:[
     {productId:"b1", sku:"BL-39AL", qty:6,  quotedPrice:280.00},
     {productId:"b3", sku:"BL-SB",   qty:4,  quotedPrice:195.00},
     {productId:"b5", sku:"BL-DISC", qty:4,  quotedPrice:88.00},
     {productId:"g2", sku:"GA-SP12", qty:8,  quotedPrice:154.00},
   ]},
  {id:"deal2", name:"Denver Public Schools — Baseball", school:"Denver Public Schools", stage:"Negotiating", value:11800, assignee:"Matt",
   items:[
     {productId:"d1", sku:"DIA-DOL1",qty:24, quotedPrice:72.00},
     {productId:"d6", sku:"DIA-HEL", qty:16, quotedPrice:125.00},
     {productId:"w3", sku:"DEM-VOO1",qty:12, quotedPrice:299.00},
     {productId:"w1", sku:"WIL-A2000",qty:6, quotedPrice:282.00},
   ]},
  {id:"deal3", name:"Fargo South — Full T&F", school:"Fargo South HS", stage:"Quoted", value:6700, assignee:"Matt",
   items:[
     {productId:"b4", sku:"BL-HH39", qty:8,  quotedPrice:315.00},
     {productId:"g5", sku:"GA-DM16", qty:6,  quotedPrice:88.00},
     {productId:"g7", sku:"GA-HM726",qty:4,  quotedPrice:148.00},
     {productId:"b8", sku:"BL-PVS",  qty:1,  quotedPrice:1850.00},
   ]},
  {id:"deal4", name:"Iowa IGHSAU Bid — Volleyballs", school:"Iowa IGHSAU", stage:"Pricing", value:9200, assignee:"Matt",
   items:[
     {productId:"m1", sku:"MOL-V5M5",qty:48, quotedPrice:68.00},
     {productId:"m2", sku:"MOL-V5M4",qty:60, quotedPrice:49.00},
   ]},
  {id:"deal5", name:"Moorhead HS — Shot Puts", school:"Moorhead HS", stage:"Engaged", value:1900, assignee:"Rep 2",
   items:[
     {productId:"g1", sku:"GA-SP8",  qty:8,  quotedPrice:154.00},
     {productId:"g2", sku:"GA-SP12", qty:8,  quotedPrice:154.00},
   ]},
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid    = () => Math.random().toString(36).slice(2,9);
const fmt$   = n  => `$${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const pct    = n  => `${Number(n||0).toFixed(1)}%`;
const fmtDate= d  => new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const marginPct = (cost,price) => cost && price ? ((price-cost)/price*100) : 0;
const costIncreasePct = (oldCost,newCost) => oldCost ? ((newCost-oldCost)/oldCost*100) : 0;

const MARGIN_TARGET   = 20;  // target margin %
const MARGIN_WARN     = 15;  // warn below this
const MARGIN_CRITICAL = 10;  // critical below this

function getMarginStatus(cost, price) {
  const m = marginPct(cost, price);
  if (m < MARGIN_CRITICAL) return { level:"critical", color:B.red,    bg:B.redBg,    label:"Critical" };
  if (m < MARGIN_WARN)     return { level:"warn",     color:B.yellow, bg:B.yellowBg, label:"Low" };
  if (m >= MARGIN_TARGET)  return { level:"good",     color:B.green,  bg:B.greenBg,  label:"Good" };
  return                          { level:"ok",       color:B.blue,   bg:B.blueBg,   label:"OK" };
}

function getSuggestedPrice(cost, targetMargin=MARGIN_TARGET) {
  return cost / (1 - targetMargin/100);
}

// Find all open deals affected by a product price change
function getAffectedDeals(productId, newCost, deals, allProducts) {
  return deals.map(deal => {
    const affectedItems = deal.items.filter(i => i.productId === productId);
    if (!affectedItems.length) return null;
    return affectedItems.map(item => {
      const newMargin = marginPct(newCost, item.quotedPrice);
      const oldProduct = allProducts[productId];
      const oldMargin  = oldProduct ? marginPct(oldProduct.cost, item.quotedPrice) : 0;
      const marginDrop = oldMargin - newMargin;
      return { deal, item, newMargin, oldMargin, marginDrop,
        compressed: newMargin < MARGIN_WARN,
        suggestedPrice: getSuggestedPrice(newCost) };
    });
  }).flat().filter(Boolean);
}

async function callClaude(prompt, sys="") {
  const r = await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:900,
      system:sys+"\n\nReturn ONLY valid JSON, no markdown.",
      messages:[{role:"user",content:prompt}]})
  });
  const d = await r.json();
  const t = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  try{const m=t.match(/[\[{][\s\S]*[\]}]/s);return m?JSON.parse(m[0]):null;}catch{return null;}
}

const toText = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(f);});

// ════════════════════════════════════════════════════════════════════════════
export default function PriceListManager() {
  const [suppliers, setSuppliers] = useState(SEED_SUPPLIERS);
  const [deals,     setDeals]     = useState(SEED_DEALS);
  const [tab,       setTab]       = useState("dashboard");
  const [selSupplier, setSelSupplier] = useState(null);
  const [selProduct,  setSelProduct]  = useState(null);
  const [alerts,    setAlerts]    = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState({});
  const [gettingSuggestions, setGettingSuggestions] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState([]);
  const [editingPrice, setEditingPrice] = useState(null); // {productId, field}
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");
  const fileInputRef = useRef();

  // Build flat product map
  const productMap = {};
  suppliers.forEach(s => s.products.forEach(p => { productMap[p.id] = {...p, supplierName:s.name, supplierId:s.id}; }));

  // Compute all margin alerts from current data
  const computeAlerts = useCallback((supplierList, dealList) => {
    const newAlerts = [];
    const pMap = {};
    supplierList.forEach(s => s.products.forEach(p => { pMap[p.id] = {...p, supplierName:s.name}; }));

    dealList.forEach(deal => {
      if(["Closed Won","Closed Lost"].includes(deal.stage)) return;
      deal.items.forEach(item => {
        const prod = pMap[item.productId];
        if(!prod) return;
        const margin = marginPct(prod.cost, item.quotedPrice);
        const costInc = costIncreasePct(prod.lastCost, prod.cost);
        if(margin < MARGIN_WARN) {
          newAlerts.push({
            id: uid(),
            type: margin < MARGIN_CRITICAL ? "critical" : "warn",
            dealId: deal.id, dealName: deal.name,
            productId: item.productId, productName: prod.name,
            supplierName: prod.supplierName,
            currentMargin: margin, costIncrease: costInc,
            quotedPrice: item.quotedPrice, currentCost: prod.cost,
            suggestedPrice: getSuggestedPrice(prod.cost),
            qty: item.qty,
            marginLoss: (item.quotedPrice - getSuggestedPrice(prod.cost)) * item.qty,
          });
        }
      });
    });
    return newAlerts;
  }, []);

  useEffect(() => {
    setAlerts(computeAlerts(suppliers, deals));
  }, [suppliers, deals, computeAlerts]);

  // Update a product's cost (simulates price list update)
  const updateProductCost = (supplierId, productId, newCost, newOurPrice=null) => {
    setSuppliers(prev => prev.map(s => {
      if(s.id !== supplierId) return s;
      return { ...s, products: s.products.map(p => {
        if(p.id !== productId) return p;
        return { ...p,
          lastCost: p.cost,
          cost: parseFloat(newCost),
          ourPrice: newOurPrice ? parseFloat(newOurPrice) : p.ourPrice,
          updatedAt: new Date().toISOString().slice(0,10),
        };
      })};
    }));
    setEditingPrice(null);
  };

  const updateOurPrice = (supplierId, productId, newPrice) => {
    setSuppliers(prev => prev.map(s => {
      if(s.id !== supplierId) return s;
      return { ...s, products: s.products.map(p =>
        p.id === productId ? {...p, ourPrice: parseFloat(newPrice)} : p
      )};
    }));
    setEditingPrice(null);
  };

  // Accept suggested price into deal
  const acceptSuggestedPrice = (dealId, productId, newPrice) => {
    setDeals(prev => prev.map(d => {
      if(d.id !== dealId) return d;
      return {...d, items: d.items.map(i =>
        i.productId === productId ? {...i, quotedPrice: parseFloat(newPrice)} : i
      ), value: d.items.reduce((s,i)=>s+(i.productId===productId?newPrice:i.quotedPrice)*i.qty,0)};
    }));
  };

  // Import price list from CSV
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setImporting(true); setImportLog([]);
    const text = await toText(file);
    const lines = text.split("\n").filter(l=>l.trim());
    const header = lines[0].split(",").map(h=>h.replace(/"/g,"").trim().toLowerCase());

    const addLog = (msg,type="info") => setImportLog(l=>[...l,{id:uid(),msg,type,ts:Date.now()}]);
    addLog(`Parsing ${file.name} — ${lines.length-1} rows...`);

    // Use Claude to map columns
    const sample = lines.slice(0,4).join("\n");
    const mapping = await callClaude(
`Given this CSV header and sample rows from a supplier price list, map the columns.
Header: ${header.join(",")}
Sample rows:
${sample}
Return JSON: {"skuCol":"column name for SKU/item number","nameCol":"column name for product name","costCol":"column name for dealer/cost price","mapCol":"column name for MAP price or null","categoryCol":"column name for category or null"}`);

    if(!mapping) { addLog("Could not parse column mapping","error"); setImporting(false); return; }
    addLog(`Mapped: SKU=${mapping.skuCol}, Name=${mapping.nameCol}, Cost=${mapping.costCol}`,"success");

    const skuIdx  = header.indexOf(mapping.skuCol?.toLowerCase()?.trim());
    const nameIdx = header.indexOf(mapping.nameCol?.toLowerCase()?.trim());
    const costIdx = header.indexOf(mapping.costCol?.toLowerCase()?.trim());
    const mapIdx  = mapping.mapCol ? header.indexOf(mapping.mapCol?.toLowerCase()?.trim()) : -1;

    if(skuIdx<0 || costIdx<0) { addLog("Could not find SKU or cost columns","error"); setImporting(false); return; }

    let updated=0, added=0, unchanged=0;
    const updates = [];

    lines.slice(1).forEach(line => {
      const cols = line.split(",").map(c=>c.replace(/^"|"$/g,"").trim());
      const sku  = cols[skuIdx];
      const name = nameIdx>=0 ? cols[nameIdx] : sku;
      const cost = parseFloat(cols[costIdx]);
      const map  = mapIdx>=0 ? parseFloat(cols[mapIdx]) : null;
      if(!sku || isNaN(cost)) return;
      updates.push({sku, name, cost, map});
    });

    // Match against existing products and update
    setSuppliers(prev => prev.map(s => {
      // Try to match this file to a supplier by looking at SKU prefixes
      const matchedProducts = updates.filter(u =>
        s.products.some(p => p.sku === u.sku || p.name.toLowerCase() === u.name?.toLowerCase())
      );
      if(!matchedProducts.length) return s;

      return { ...s, lastUpdated: new Date().toISOString().slice(0,10),
        products: s.products.map(p => {
          const match = updates.find(u => u.sku === p.sku || u.name?.toLowerCase() === p.name.toLowerCase());
          if(!match) return p;
          if(match.cost === p.cost) { unchanged++; return p; }
          const direction = match.cost > p.cost ? "↑" : "↓";
          addLog(`${direction} ${p.name}: ${fmt$(p.cost)} → ${fmt$(match.cost)} (${costIncreasePct(p.cost,match.cost)>0?"+":""}${costIncreasePct(p.cost,match.cost).toFixed(1)}%)`,
            match.cost > p.cost ? "warn" : "success");
          updated++;
          return {...p, lastCost:p.cost, cost:match.cost,
            map:match.map||p.map, updatedAt:new Date().toISOString().slice(0,10)};
        })
      };
    }));

    addLog(`Import complete — ${updated} updated, ${added} new, ${unchanged} unchanged`,updated>0?"warn":"success");
    setImporting(false);
    e.target.value="";
  };

  // Get AI suggestions for a deal with compressed margins
  const getAiSuggestions = async (alertGroup) => {
    const dealId = alertGroup[0].dealId;
    setGettingSuggestions(dealId);
    const deal = deals.find(d=>d.id===dealId);
    const items = alertGroup.map(a=>({
      product: a.productName, sku: productMap[a.productId]?.sku,
      currentCost: a.currentCost, quotedPrice: a.quotedPrice,
      currentMargin: a.currentMargin.toFixed(1)+"%",
      suggestedPrice: a.suggestedPrice.toFixed(2), qty: a.qty,
    }));
    const result = await callClaude(
`You are a pricing advisor for ST1 Sports, an athletic equipment supplier.
This deal has margin compression after a supplier price increase.
Deal: ${deal?.name} (${deal?.stage}, total ${fmt$(deal?.value)})

Compressed items:
${JSON.stringify(items, null, 2)}

Provide strategic pricing advice. Return JSON:
{
  "summary": "1-2 sentence overall assessment",
  "strategy": "recommend|hold|partial — whether to raise prices, hold, or adjust some items",
  "strategyReason": "why",
  "itemRecommendations": [
    {
      "productName": "product name",
      "action": "raise|hold|substitute",
      "recommendedPrice": suggested price as number,
      "reasoning": "brief reasoning",
      "negotiationTip": "how to present this change to the customer"
    }
  ],
  "talkingPoints": ["2-3 talking points to justify price increases to the AD/coach"],
  "alternativeProducts": "any lower-cost substitutes ST1 could offer",
  "urgency": "high|medium|low — how urgent is it to address this"
}`);
    setAiSuggestions(s=>({...s,[dealId]:result}));
    setGettingSuggestions(null);
  };

  // ─── DERIVED STATS ─────────────────────────────────────────────────────────
  const totalProducts = suppliers.reduce((s,sup)=>s+sup.products.length, 0);
  const criticalAlerts = alerts.filter(a=>a.type==="critical");
  const warnAlerts     = alerts.filter(a=>a.type==="warn");
  const recentUpdates  = suppliers
    .flatMap(s => s.products.filter(p=>p.lastCost && p.lastCost !== p.cost).map(p=>({...p,supplierName:s.name,supplierId:s.id})))
    .sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,10);

  // Group alerts by deal
  const alertsByDeal = {};
  alerts.forEach(a => {
    if(!alertsByDeal[a.dealId]) alertsByDeal[a.dealId] = [];
    alertsByDeal[a.dealId].push(a);
  });

  // All products flat for margin view
  const allProducts = suppliers.flatMap(s =>
    s.products.map(p => ({...p, supplierName:s.name, supplierId:s.id,
      marginStatus: getMarginStatus(p.cost, p.ourPrice),
      costChange: costIncreasePct(p.lastCost, p.cost),
    }))
  ).filter(p => {
    if(filterSupplier !== "all" && p.supplierId !== filterSupplier) return false;
    if(filterStatus === "critical" && p.marginStatus.level !== "critical") return false;
    if(filterStatus === "warn" && !["critical","warn"].includes(p.marginStatus.level)) return false;
    if(filterStatus === "changed" && (!p.lastCost || p.lastCost === p.cost)) return false;
    return true;
  });

  // ─── INLINE EDIT CELL ──────────────────────────────────────────────────────
  const EditCell = ({value, onSave, prefix="$", small=false}) => {
    const [v,setV] = useState(value);
    return (
      <input type="number" value={v} onChange={e=>setV(e.target.value)}
        onBlur={()=>onSave(v)} onKeyDown={e=>{if(e.key==="Enter")onSave(v);if(e.key==="Escape")setV(value);}}
        autoFocus
        style={{width:80,background:B.white,border:`2px solid ${B.orange}`,borderRadius:3,
          padding:"3px 5px",fontSize:small?10:12,textAlign:"right",color:B.text}}/>
    );
  };

  const NAV = [
    {id:"dashboard",  label:"Dashboard",    badge:criticalAlerts.length+warnAlerts.length},
    {id:"alerts",     label:"Margin Alerts",badge:criticalAlerts.length},
    {id:"products",   label:"All Products"},
    {id:"suppliers",  label:"Suppliers"},
    {id:"upload",     label:"Upload Price List"},
  ];

  return (
    <div style={{minHeight:"100vh",background:B.pageBg,fontFamily:"'Lexend',sans-serif",color:B.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px}
        button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s} button:hover{opacity:.82} button:active{transform:scale(.97)}
        input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
        .fu{animation:fadeUp .2s ease} .blink{animation:blink 1.5s infinite}
        .card{background:${B.white};border:1px solid ${B.border};border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        table{width:100%;border-collapse:collapse}
        th{background:${B.surface};padding:7px 9px;text-align:left;font-family:'Lexend Zetta',sans-serif;font-size:8px;color:${B.muted};letter-spacing:1.5px;border-bottom:2px solid ${B.border};white-space:nowrap;position:sticky;top:0;z-index:1}
        td{padding:7px 9px;border-bottom:1px solid ${B.border};font-size:11px;vertical-align:middle}
        tr:hover td{background:${B.surface}}
      `}</style>
      {/* ← Back to RevOps */}
      <div style={{background:"#fff",borderBottom:"1px solid #E2E0DB",padding:"6px 20px",display:"flex",alignItems:"center",gap:8}}>
        <a href="/" style={{display:"flex",alignItems:"center",gap:6,textDecoration:"none",color:"#7A7872",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
          <span style={{fontSize:13}}>←</span> Back to RevOps
        </a>
      </div>

      {/* HEADER */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3}}>PRICE LIST MANAGER</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>SUPPLIER COSTS · MARGIN TRACKING · BID ALERTS</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,alignItems:"center"}}>
          {[
            [`${suppliers.length}`, "suppliers",   B.text],
            [totalProducts,         "products",    B.blue],
            [criticalAlerts.length, "critical",    B.red],
            [warnAlerts.length,     "warnings",    B.yellow],
          ].map(([v,l,c])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:c}}>{v}</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{l}</div>
            </div>
          ))}
          <button onClick={()=>fileInputRef.current?.click()}
            style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"8px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>
            ↑ UPLOAD PRICE LIST
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{display:"none"}}/>
        </div>
      </div>

      {/* NAV */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"0 28px",display:"flex",gap:2}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)} style={{
            background:"none",border:"none",borderBottom:`2px solid ${tab===n.id?B.orange:"transparent"}`,
            color:tab===n.id?B.orange:B.muted,padding:"10px 14px",
            fontFamily:"'Lexend',sans-serif",fontSize:11,fontWeight:tab===n.id?500:400,
            display:"flex",alignItems:"center",gap:6,
          }}>
            {n.label}
            {n.badge>0&&<span style={{background:n.id==="alerts"?B.red:B.orange,color:B.white,borderRadius:10,padding:"1px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700}}>{n.badge}</span>}
          </button>
        ))}
      </div>

      <div style={{padding:"24px 28px"}}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard"&&(
          <div className="fu">
            {/* KPI row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:20}}>
              {[
                {l:"Suppliers",     v:suppliers.length,                              c:B.text},
                {l:"Total Products",v:totalProducts,                                 c:B.blue},
                {l:"Critical Alerts",v:criticalAlerts.length,                        c:B.red},
                {l:"Margin Warnings",v:warnAlerts.length,                            c:B.yellow},
                {l:"Recent Updates", v:recentUpdates.length,                         c:B.orange},
              ].map(k=>(
                <div key={k.l} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:7,padding:"14px",borderTop:`3px solid ${k.c}`,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
                  <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:k.c}}>{k.v}</div>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginTop:4}}>{k.l.toUpperCase()}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:18}}>
              {/* Critical alerts */}
              <div className="card" style={{borderTop:`3px solid ${B.red}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.red,letterSpacing:2,marginBottom:12}}>
                  ⚠ CRITICAL MARGIN ALERTS — {criticalAlerts.length} ITEMS
                </div>
                {criticalAlerts.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,padding:"12px 0"}}>No critical alerts ✓</div>}
                {criticalAlerts.slice(0,5).map(a=>(
                  <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:B.redBg,borderRadius:5,marginBottom:6,borderLeft:`3px solid ${B.red}`}}>
                    <div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{a.productName}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{a.dealName} · {a.supplierName}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.red,marginTop:1}}>Margin: {pct(a.currentMargin)} · Quoted: {fmt$(a.quotedPrice)} · Cost: {fmt$(a.currentCost)}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.green}}>Suggest: {fmt$(a.suggestedPrice)}</div>
                      <button onClick={()=>{setTab("alerts");}} style={{marginTop:4,background:B.red,color:B.white,border:"none",borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700}}>VIEW →</button>
                    </div>
                  </div>
                ))}
                {criticalAlerts.length>5&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",marginTop:4}}>{criticalAlerts.length-5} more alerts</div>}
              </div>

              {/* Recent cost changes */}
              <div className="card" style={{borderTop:`3px solid ${B.orange}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginBottom:12}}>RECENT COST CHANGES</div>
                {recentUpdates.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,padding:"12px 0"}}>No recent changes</div>}
                {recentUpdates.map((p,i)=>{
                  const chg = costIncreasePct(p.lastCost, p.cost);
                  const dir = chg > 0;
                  return (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${B.border}`}}>
                      <div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{p.name}</div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{p.supplierName} · {fmtDate(p.updatedAt)}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:dir?B.red:B.green,fontWeight:500}}>
                          {dir?"↑":"↓"} {Math.abs(chg).toFixed(1)}%
                        </div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>{fmt$(p.lastCost)} → {fmt$(p.cost)}</div>
                      </div>
                    </div>
                  );
                })}
                {recentUpdates.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Upload a new price list to see changes here</div>}
              </div>
            </div>

            {/* Supplier health */}
            <div className="card">
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:14}}>SUPPLIER MARGIN HEALTH</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                {suppliers.map(s=>{
                  const margins = s.products.map(p=>marginPct(p.cost,p.ourPrice)).filter(m=>m>0);
                  const avgM = margins.length ? margins.reduce((a,b)=>a+b,0)/margins.length : 0;
                  const critical = s.products.filter(p=>marginPct(p.cost,p.ourPrice)<MARGIN_CRITICAL).length;
                  const warn = s.products.filter(p=>{const m=marginPct(p.cost,p.ourPrice);return m>=MARGIN_CRITICAL&&m<MARGIN_WARN;}).length;
                  const status = critical>0?{color:B.red,bg:B.redBg}:warn>0?{color:B.yellow,bg:B.yellowBg}:{color:B.green,bg:B.greenBg};
                  return (
                    <div key={s.id} onClick={()=>{setTab("suppliers");setSelSupplier(s.id);}}
                      style={{background:status.bg,borderRadius:6,padding:"12px",border:`1px solid ${status.color}25`,borderTop:`2px solid ${status.color}`,cursor:"pointer"}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:3}}>{s.name}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:6}}>{s.category} · {s.products.length} products</div>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:status.color}}>{pct(avgM)}</div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>AVG MARGIN</div>
                      {(critical+warn)>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:status.color,marginTop:4}}>{critical} critical · {warn} warn</div>}
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted,marginTop:2}}>Updated {fmtDate(s.lastUpdated)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── MARGIN ALERTS ── */}
        {tab==="alerts"&&(
          <div className="fu">
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,letterSpacing:.3,marginBottom:16}}>MARGIN ALERTS — OPEN DEALS</div>
            {alerts.length===0&&(
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.border,marginBottom:8}}>ALL CLEAR</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>All open deal margins are healthy. Upload a new price list to check for compression.</div>
              </div>
            )}
            {Object.entries(alertsByDeal).map(([dealId,dealAlerts])=>{
              const deal = deals.find(d=>d.id===dealId);
              const hasCritical = dealAlerts.some(a=>a.type==="critical");
              const sugg = aiSuggestions[dealId];
              return (
                <div key={dealId} className="card fu" style={{marginBottom:16,borderTop:`3px solid ${hasCritical?B.red:B.yellow}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <span style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3}}>{deal?.name}</span>
                        <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:hasCritical?B.red:B.yellow,background:hasCritical?B.redBg:B.yellowBg,padding:"2px 7px",borderRadius:3,letterSpacing:.5}}>
                          {hasCritical?"CRITICAL":"WARNING"}
                        </span>
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{deal?.stage} · {dealAlerts.length} product{dealAlerts.length!==1?"s":""} with margin issues</div>
                    </div>
                    <button onClick={()=>getAiSuggestions(dealAlerts)} disabled={gettingSuggestions===dealId}
                      style={{background:B.orange,color:B.white,border:"none",borderRadius:5,padding:"7px 16px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5,flexShrink:0}}>
                      {gettingSuggestions===dealId?"ANALYZING...":sugg?"✓ RE-ANALYZE":"✦ GET AI ADVICE"}
                    </button>
                  </div>

                  {/* Alert items */}
                  <div style={{overflowX:"auto",marginBottom:sugg?14:0}}>
                    <table>
                      <thead><tr>
                        {["Product","Supplier","Quoted Price","Dealer Cost","Current Margin","Suggested Price","Δ Per Unit","Qty","Margin Impact","Action"].map(h=><th key={h}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {dealAlerts.map(a=>{
                          const delta = a.suggestedPrice - a.quotedPrice;
                          const ms = getMarginStatus(a.currentCost, a.quotedPrice);
                          return (
                            <tr key={a.id} style={{background:a.type==="critical"?B.redBg:B.yellowBg}}>
                              <td style={{fontWeight:500,color:B.text}}>{a.productName}</td>
                              <td style={{color:B.muted}}>{a.supplierName}</td>
                              <td style={{textAlign:"right",fontWeight:500}}>{fmt$(a.quotedPrice)}</td>
                              <td style={{textAlign:"right",color:B.muted}}>{fmt$(a.currentCost)}</td>
                              <td style={{textAlign:"right"}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:ms.color,background:ms.bg,padding:"2px 6px",borderRadius:3}}>{pct(a.currentMargin)}</span>
                              </td>
                              <td style={{textAlign:"right",color:B.green,fontWeight:500}}>{fmt$(a.suggestedPrice)}</td>
                              <td style={{textAlign:"right",color:delta>0?B.red:B.green}}>
                                {delta>0?"+":""}{fmt$(delta)}
                              </td>
                              <td style={{textAlign:"right",color:B.muted}}>{a.qty}</td>
                              <td style={{textAlign:"right",color:B.red}}>{fmt$(a.marginLoss)}</td>
                              <td>
                                <button onClick={()=>acceptSuggestedPrice(dealId,a.productId,a.suggestedPrice)}
                                  style={{background:B.green,color:B.white,border:"none",borderRadius:3,padding:"4px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,letterSpacing:.3,whiteSpace:"nowrap"}}>
                                  UPDATE PRICE
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* AI suggestions */}
                  {sugg&&(
                    <div style={{background:B.blueBg,borderRadius:6,padding:"14px",border:`1px solid ${B.blue}30`}}>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:2,marginBottom:10}}>AI PRICING ADVICE</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                        <div>
                          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,lineHeight:1.7,marginBottom:8}}>{sugg.summary}</div>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                            <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:{recommend:B.orange,hold:B.green,partial:B.yellow}[sugg.strategy]||B.muted,background:{recommend:B.orangeBg,hold:B.greenBg,partial:B.yellowBg}[sugg.strategy]||B.surface,padding:"3px 8px",borderRadius:3,letterSpacing:1}}>
                              {sugg.strategy?.toUpperCase()}
                            </span>
                            <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid}}>{sugg.strategyReason}</span>
                          </div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:6}}>TALKING POINTS</div>
                          {(sugg.talkingPoints||[]).map((tp,i)=>(
                            <div key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,padding:"4px 0",borderBottom:`1px solid ${B.border}`,lineHeight:1.6,display:"flex",gap:6}}>
                              <span style={{color:B.orange,flexShrink:0,fontWeight:500}}>{i+1}.</span>{tp}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1.5,marginBottom:8}}>PER-ITEM RECOMMENDATIONS</div>
                          {(sugg.itemRecommendations||[]).map((rec,i)=>(
                            <div key={i} style={{background:B.white,borderRadius:5,padding:"9px 11px",marginBottom:7,borderLeft:`2px solid ${rec.action==="raise"?B.orange:rec.action==="hold"?B.green:B.yellow}`}}>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{rec.productName}</div>
                              <div style={{display:"flex",gap:8,marginBottom:3}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:rec.action==="raise"?B.orange:rec.action==="hold"?B.green:B.yellow,letterSpacing:.5,textTransform:"uppercase"}}>{rec.action}</span>
                                {rec.recommendedPrice&&<span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text}}>→ {fmt$(rec.recommendedPrice)}</span>}
                              </div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:2}}>{rec.reasoning}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,fontStyle:"italic"}}>"{rec.negotiationTip}"</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── ALL PRODUCTS ── */}
        {tab==="products"&&(
          <div className="fu">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,letterSpacing:.3}}>ALL PRODUCTS ({allProducts.length})</div>
              <div style={{display:"flex",gap:8}}>
                <select value={filterSupplier} onChange={e=>setFilterSupplier(e.target.value)}
                  style={{background:B.white,border:`1px solid ${B.border}`,color:B.text,borderRadius:4,padding:"6px 10px",fontSize:11}}>
                  <option value="all">All Suppliers</option>
                  {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {[["all","All"],["critical","Critical"],["warn","Warnings"],["changed","Changed"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setFilterStatus(v)} style={{background:filterStatus===v?B.orange:B.white,color:filterStatus===v?B.white:B.muted,border:`1px solid ${filterStatus===v?B.orange:B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{overflowX:"auto",borderRadius:8,border:`1px solid ${B.border}`,boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
              <table>
                <thead><tr>
                  {["Supplier","SKU","Product","Category","Prev Cost","Current Cost","Δ","Our Price","Margin","MAP","Status",""].map(h=><th key={h} style={{textAlign:["Prev Cost","Current Cost","Δ","Our Price","Margin"].includes(h)?"right":"left"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {allProducts.map(p=>{
                    const chg = p.lastCost && p.lastCost!==p.cost ? costIncreasePct(p.lastCost,p.cost) : null;
                    const isEditingCost  = editingPrice?.productId===p.id&&editingPrice?.field==="cost";
                    const isEditingPrice = editingPrice?.productId===p.id&&editingPrice?.field==="ourPrice";
                    return (
                      <tr key={p.id} style={{background:p.marginStatus.level==="critical"?B.redBg:p.marginStatus.level==="warn"?B.yellowBg:B.white}}>
                        <td style={{color:B.muted,fontSize:10}}>{p.supplierName}</td>
                        <td style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:.5}}>{p.sku}</td>
                        <td style={{fontWeight:500,color:B.text}}>{p.name}</td>
                        <td style={{color:B.muted,fontSize:10}}>{p.category}</td>
                        <td style={{textAlign:"right",color:B.muted}}>{p.lastCost&&p.lastCost!==p.cost?fmt$(p.lastCost):"—"}</td>
                        <td style={{textAlign:"right"}}>
                          {isEditingCost
                            ? <EditCell value={p.cost} onSave={v=>updateProductCost(p.supplierId,p.id,v)} small/>
                            : <span onClick={()=>setEditingPrice({productId:p.id,field:"cost"})}
                                style={{cursor:"pointer",color:B.blue,borderBottom:`1px dashed ${B.blue}80`}}>{fmt$(p.cost)}</span>}
                        </td>
                        <td style={{textAlign:"right",color:chg===null?B.muted:chg>0?B.red:B.green,fontSize:10,fontWeight:500}}>
                          {chg!==null?`${chg>0?"+":""}${chg.toFixed(1)}%`:"—"}
                        </td>
                        <td style={{textAlign:"right"}}>
                          {isEditingPrice
                            ? <EditCell value={p.ourPrice} onSave={v=>updateOurPrice(p.supplierId,p.id,v)} small/>
                            : <span onClick={()=>setEditingPrice({productId:p.id,field:"ourPrice"})}
                                style={{cursor:"pointer",color:B.blue,borderBottom:`1px dashed ${B.blue}80`}}>{fmt$(p.ourPrice)}</span>}
                        </td>
                        <td style={{textAlign:"right"}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:p.marginStatus.color,background:p.marginStatus.bg,padding:"2px 6px",borderRadius:3,letterSpacing:.3}}>
                            {pct(marginPct(p.cost,p.ourPrice))}
                          </span>
                        </td>
                        <td style={{textAlign:"right",color:B.muted}}>{p.map?fmt$(p.map):"—"}</td>
                        <td>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:p.marginStatus.color,letterSpacing:.5}}>{p.marginStatus.label}</span>
                        </td>
                        <td>
                          {p.marginStatus.level==="critical"&&(
                            <button onClick={()=>updateOurPrice(p.supplierId,p.id,getSuggestedPrice(p.cost))}
                              style={{background:B.orange,color:B.white,border:"none",borderRadius:3,padding:"3px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,fontWeight:700,whiteSpace:"nowrap"}}>
                              FIX PRICE
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{padding:"6px 10px",fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,background:B.surface}}>
                💡 Click any blue underlined cost or price to edit directly
              </div>
            </div>
          </div>
        )}

        {/* ── SUPPLIERS ── */}
        {tab==="suppliers"&&(
          <div className="fu">
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,letterSpacing:.3,marginBottom:16}}>SUPPLIER PRICE LISTS</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {suppliers.map(s=>{
                const isOpen = selSupplier===s.id;
                const avgM = s.products.reduce((sum,p)=>sum+marginPct(p.cost,p.ourPrice),0)/s.products.length;
                const critical = s.products.filter(p=>marginPct(p.cost,p.ourPrice)<MARGIN_CRITICAL).length;
                const warn     = s.products.filter(p=>{const m=marginPct(p.cost,p.ourPrice);return m>=MARGIN_CRITICAL&&m<MARGIN_WARN;}).length;
                return (
                  <div key={s.id} className="card" style={{borderTop:`3px solid ${critical>0?B.red:warn>0?B.yellow:B.green}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setSelSupplier(isOpen?null:s.id)}>
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
                          <span style={{fontFamily:"'Russo One',sans-serif",fontSize:16,color:B.black,letterSpacing:.3}}>{s.name}</span>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,background:B.surface,padding:"2px 7px",borderRadius:3}}>{s.category}</span>
                          {critical>0&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:B.redBg,padding:"2px 7px",borderRadius:3}}>⚠ {critical} CRITICAL</span>}
                        </div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>
                          {s.rep} · {s.repEmail} · Updated {fmtDate(s.lastUpdated)}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:20,alignItems:"center"}}>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:critical>0?B.red:warn>0?B.yellow:B.green}}>{pct(avgM)}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>AVG MARGIN</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.blue}}>{s.products.length}</div>
                          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.muted,letterSpacing:1}}>PRODUCTS</div>
                        </div>
                        <div style={{fontFamily:"'Lexend',sans-serif",fontSize:16,color:B.muted}}>{isOpen?"▲":"▼"}</div>
                      </div>
                    </div>

                    {isOpen&&(
                      <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${B.border}`}}>
                        {s.notes&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:12,padding:"8px 10px",background:B.blueBg,borderRadius:4,fontStyle:"italic"}}>{s.notes}</div>}
                        <div style={{overflowX:"auto"}}>
                          <table>
                            <thead><tr>
                              {["SKU","Product","Category","Unit","Prev Cost","Dealer Cost","Our Price","Margin","MAP"].map(h=>(
                                <th key={h} style={{textAlign:["Prev Cost","Dealer Cost","Our Price","Margin","MAP"].includes(h)?"right":"left"}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {s.products.map(p=>{
                                const ms = getMarginStatus(p.cost, p.ourPrice);
                                const chg= p.lastCost&&p.lastCost!==p.cost ? costIncreasePct(p.lastCost,p.cost) : null;
                                const isEditC = editingPrice?.productId===p.id&&editingPrice?.field==="cost";
                                const isEditP = editingPrice?.productId===p.id&&editingPrice?.field==="ourPrice";
                                return (
                                  <tr key={p.id} style={{background:ms.level==="critical"?B.redBg:ms.level==="warn"?B.yellowBg:B.white}}>
                                    <td style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted}}>{p.sku}</td>
                                    <td style={{fontWeight:500,color:B.text}}>{p.name}</td>
                                    <td style={{color:B.muted,fontSize:10}}>{p.category}</td>
                                    <td style={{color:B.muted}}>{p.unit}</td>
                                    <td style={{textAlign:"right",color:B.muted}}>
                                      {chg!==null?<span style={{color:chg>0?B.red:B.green,fontSize:10}}>{fmt$(p.lastCost)} ({chg>0?"+":""}{chg.toFixed(1)}%)</span>:"—"}
                                    </td>
                                    <td style={{textAlign:"right"}}>
                                      {isEditC
                                        ?<EditCell value={p.cost} onSave={v=>updateProductCost(s.id,p.id,v)} small/>
                                        :<span onClick={()=>setEditingPrice({productId:p.id,field:"cost"})} style={{cursor:"pointer",color:B.blue,borderBottom:`1px dashed ${B.blue}80`}}>{fmt$(p.cost)}</span>}
                                    </td>
                                    <td style={{textAlign:"right"}}>
                                      {isEditP
                                        ?<EditCell value={p.ourPrice} onSave={v=>updateOurPrice(s.id,p.id,v)} small/>
                                        :<span onClick={()=>setEditingPrice({productId:p.id,field:"ourPrice"})} style={{cursor:"pointer",color:B.blue,borderBottom:`1px dashed ${B.blue}80`}}>{fmt$(p.ourPrice)}</span>}
                                    </td>
                                    <td style={{textAlign:"right"}}>
                                      <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:ms.color,background:ms.bg,padding:"2px 6px",borderRadius:3,letterSpacing:.3}}>
                                        {pct(marginPct(p.cost,p.ourPrice))}
                                      </span>
                                    </td>
                                    <td style={{textAlign:"right",color:B.muted}}>{p.map?fmt$(p.map):"—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── UPLOAD ── */}
        {tab==="upload"&&(
          <div className="fu" style={{maxWidth:680}}>
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:B.black,letterSpacing:.3}}>UPLOAD PRICE LIST</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginTop:3}}>Upload a CSV from any supplier — AI maps the columns and updates costs automatically</div>
              <div style={{width:36,height:3,background:B.orange,marginTop:8,borderRadius:2}}/>
            </div>

            <div className="card" style={{marginBottom:16,borderTop:`3px solid ${B.orange}`}}>
              <div onClick={()=>fileInputRef.current?.click()}
                style={{border:`2px dashed ${B.borderD}`,borderRadius:6,padding:"32px 24px",textAlign:"center",cursor:"pointer",background:B.surface}}>
                <div style={{fontSize:32,marginBottom:8}}>📄</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.muted,fontWeight:500}}>Click to upload supplier price list</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginTop:4}}>CSV format · Blazer, Gill, Diamond, Wilson, Molten, FinishLynx</div>
              </div>
              {importing&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.yellow,marginTop:10,display:"flex",alignItems:"center",gap:8}}><span className="blink">●</span>Processing...</div>}
              {importLog.length>0&&(
                <div style={{marginTop:12,background:B.surface,borderRadius:5,padding:12,maxHeight:200,overflowY:"auto"}}>
                  {importLog.map(l=>(
                    <div key={l.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:{success:B.green,warn:B.yellow,error:B.red,info:B.muted}[l.type]||B.muted,lineHeight:1.9}}>
                      {l.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:2,marginBottom:12}}>HOW IT WORKS</div>
              {[
                ["Upload any CSV","Export from your supplier portal, email, or catalog — any format works"],
                ["AI maps the columns","Automatically identifies SKU, product name, dealer cost, MAP, and category columns"],
                ["Costs update instantly","Matching products update with new dealer costs. Old cost saved as 'previous'"],
                ["Margin alerts fire","Any open deal where margins drop below 15% immediately shows in Margin Alerts"],
                ["AI suggests price fixes","Get AI-powered recommendations on whether to raise prices, hold, or substitute products"],
              ].map(([t,d])=>(
                <div key={t} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:`1px solid ${B.border}`}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:B.orange,marginTop:5,flexShrink:0}}/>
                  <div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500}}>{t}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,lineHeight:1.5}}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}