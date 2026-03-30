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
  teal:"#0C7B6A", tealBg:"#E6F5F2",
};

const ST1 = `ST1 Sports (st1sports.com) — track & field and athletic equipment supplier, Ames Iowa.
K-12 school districts, ADs, coaches, procurement managers.
Markets: Iowa, Colorado, Minnesota, North Dakota.
Brands: Blazer, Gill Athletics, Diamond, All-Star, Molten, Wilson, DeMarini, Louisville Slugger, EvoShield, FinishLynx, Pro-Nine, Ultrak, Seiko.
Owner: Matt Stone · matt@st1sports.com · 719-256-0275 · st1sports.com`;

const PRICING = `ST1 Sports pricing:
- Blazer T&F: dealer cost + 18-25% margin; school pricing from catalog
- Gill Athletics: dealer + 18-22% margin
- Diamond baseballs: ~$52-58/doz dealer → bid $64-74/doz
- Molten volleyballs: ~$45-65 dealer → bid $58-85
- Wilson/DeMarini: at MAP or just above
- FinishLynx timing: dealer + 15-20%
- Pro-Nine: dealer + 20-25%
- Default margin: 20% if unknown
- Freight small items (UPS): $8-18/unit
- Freight medium (UPS): $25-45/unit
- Freight large/LTL: $75-200/shipment spread across items
- Always note: "Prices include freight prepaid to destination" when shipping is included`;

const uid   = () => Math.random().toString(36).slice(2,9);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt$  = n  => n != null && n !== "" ? `$${Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : "—";
const pct   = n  => n != null && n !== "" ? `${Number(n).toFixed(1)}%` : "—";

const toBase64 = file => new Promise((res,rej)=>{
  const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file);
});
const toArrayBuffer = file => new Promise((res,rej)=>{
  const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file);
});

// Extract plain text from a PDF using pdfjs-dist (browser build)
async function extractPdfText(arrayBuffer) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url
  ).href;
  // Uint8Array view: worker copies the data instead of transferring (prevents detached buffer)
  const pdf = await pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)}).promise;
  const parts = [];
  for(let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item=>item.str).join(" ");
    parts.push(`--- PAGE ${i} ---\n${pageText}`);
  }
  return parts.join("\n\n");
}

const CLAUDE_MODEL      = "claude-sonnet-4-6";
const CLAUDE_FAST_MODEL = "claude-haiku-4-5-20251001"; // steps 1-4: extraction (fast + cheap)
const CLAUDE_TIMEOUT = 110000; // 110s client timeout (vercel fn is 120s)
const MAX_B64_BYTES = 3 * 1024 * 1024; // 3 MB base64 threshold (~4 MB raw PDF)

async function claudeCall(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), CLAUDE_TIMEOUT);
  try {
    const r = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.error||`HTTP ${r.status}`); }
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  } catch(e) {
    clearTimeout(timer);
    if(e.name==="AbortError") throw new Error("Request timed out — PDF may be too large or Claude API is slow. Try again.");
    throw e;
  }
}

// Claude API — PDF doc (falls back to text extraction if PDFs are too large)
const MAX_TEXT_CHARS = 140000; // ~35k tokens — covers full athletic supply bid doc

// Robust JSON extraction — tries multiple strategies
function extractJSON(raw) {
  if(!raw) return null;
  const text = raw.trim();
  // 1. Direct parse
  try { return JSON.parse(text); } catch {}
  // 2. Markdown code fence ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  // 3. First { ... last }
  const b0 = text.indexOf('{'), b1 = text.lastIndexOf('}');
  if(b0 !== -1 && b1 > b0) try { return JSON.parse(text.slice(b0, b1+1)); } catch {}
  // 4. First [ ... last ]
  const a0 = text.indexOf('['), a1 = text.lastIndexOf(']');
  if(a0 !== -1 && a1 > a0) try { return JSON.parse(text.slice(a0, a1+1)); } catch {}
  return null;
}

async function claudePDF(pdfFiles, prompt, sys="", json=false, _logFn=null, textOverride=null, model=CLAUDE_FAST_MODEL) {
  // If pre-extracted text is provided, skip PDF processing
  if(textOverride !== null) {
    const tp = `[PDF content — ${textOverride.length.toLocaleString()} chars]\n\n${textOverride}\n\n---\n\n${prompt}`;
    return await claudeText(tp, sys, json, model);
  }
  const totalB64Bytes = pdfFiles.reduce((a,f)=>(f.b64?.length||0)+a, 0);
  let text;
  if(totalB64Bytes > MAX_B64_BYTES) {
    const extractedParts = await Promise.all(pdfFiles.map(async(f,i)=>{
      const raw = f.arrayBuffer || await toArrayBuffer(f.file);
      const buf = raw.slice(0); // copy so pdfjs worker doesn't detach the stored original
      const t = await extractPdfText(buf);
      if(_logFn) _logFn(`  Extracted ${t.length.toLocaleString()} chars from ${f.name}`);
      return pdfFiles.length>1 ? `=== DOCUMENT ${i+1} ===\n${t}` : t;
    }));
    const fullText = extractedParts.join("\n\n").slice(0, MAX_TEXT_CHARS);
    const textPrompt = `[PDF text extracted — ${fullText.length} chars]\n\n${fullText}\n\n---\n\n${prompt}`;
    // claudeText already handles JSON parsing — return directly
    return await claudeText(textPrompt, sys, json, model);
  } else {
    const content = [
      ...pdfFiles.map(f=>({ type:"document", source:{type:"base64",media_type:"application/pdf",data:f.b64} })),
      { type:"text", text: json ? prompt+"\n\nReturn ONLY valid JSON. No markdown fences." : prompt }
    ];
    const body = { model, max_tokens:2000, messages:[{role:"user",content}] };
    if(sys) body.system = sys;
    text = await claudeCall(body);
  }
  if(!json) return text;
  const parsed = extractJSON(text);
  if(!parsed && _logFn) _logFn(`  Claude response (first 300): ${(text||"").slice(0,300)}`,"warn");
  return parsed;
}

// Claude API — text only
async function claudeText(prompt, sys="", json=false, model=CLAUDE_FAST_MODEL) {
  const body = { model, max_tokens:3000,
    system: sys + (json?"\n\nReturn ONLY valid JSON. No markdown fences.":""),
    messages:[{role:"user",content:prompt}] };
  const text = await claudeCall(body);
  if(!json) return text;
  return extractJSON(text);
}

// Write pricing back into uploaded CSV/spreadsheet text
function buildOutputCSV(originalCsvText, items) {
  if(!originalCsvText || !items.length) return null;
  const lines = originalCsvText.split("\n");
  if(lines.length < 2) return null;
  const header = lines[0];
  const hdrs   = header.split(",").map(h=>h.replace(/"/g,"").trim().toLowerCase());

  // Try to map our items back by line number / description matching
  const out = [header];
  for(let i=1; i<lines.length; i++){
    const line = lines[i];
    if(!line.trim()) { out.push(line); continue; }
    const cols = line.split(",");

    // Find matching item
    const match = items.find(item=>{
      const lineNumCol = hdrs.findIndex(h=>h.includes("line")||h.includes("#")||h.includes("item"));
      const descCol    = hdrs.findIndex(h=>h.includes("desc")||h.includes("product")||h.includes("name"));
      const lineMatch  = lineNumCol>=0 && cols[lineNumCol]?.replace(/"/g,"").trim() === String(item.lineNum||item.idx);
      const descMatch  = descCol>=0 && item.description && cols[descCol]?.toLowerCase().includes(item.description.slice(0,15).toLowerCase());
      return lineMatch || descMatch;
    });

    if(match && match.approved && match.finalPrice) {
      // Find price column and fill it
      const priceCol = hdrs.findIndex(h=>h.includes("price")||h.includes("unit")||h.includes("bid")||h.includes("cost"));
      if(priceCol>=0) {
        while(cols.length<=priceCol) cols.push("");
        cols[priceCol] = match.finalPrice.toFixed(2);
      }
      // Fill total if exists
      const totalCol = hdrs.findIndex(h=>h.includes("total")||h.includes("ext"));
      if(totalCol>=0 && match.qtyRequested) {
        while(cols.length<=totalCol) cols.push("");
        cols[totalCol] = (match.finalPrice * match.qtyRequested).toFixed(2);
      }
    }
    out.push(cols.join(","));
  }
  return out.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
export default function RFPAutomation() {
  // Files
  const [pdfFiles,   setPdfFiles]   = useState([]); // [{name,size,b64}]
  const [xlsxFile,   setXlsxFile]   = useState(null);
  const [xlsxText,   setXlsxText]   = useState(null);
  const [xlsxIsBinary, setXlsxIsBinary] = useState(false);

  // State machine
  const [phase, setPhase] = useState("upload"); // upload|analyzing|review|done

  // Parsed RFP data
  const [rfpMeta,    setRfpMeta]    = useState(null);
  const [shippingRule, setShippingRule] = useState(null); // {included,separate,language,notes}
  const [items,      setItems]      = useState([]);
  const [coverLetter,setCoverLetter]= useState("");
  const [complianceFlags, setComplianceFlags] = useState([]);

  // UI
  const [log,        setLog]        = useState([]);
  const [progress,   setProgress]   = useState(0);
  const [filter,     setFilter]     = useState("all"); // all|bid|nobid|pending
  const [sortBy,     setSortBy]     = useState("line");
  const [editCell,   setEditCell]   = useState(null); // {itemId, field}
  const [approved,   setApproved]   = useState(false);
  const [generating, setGenerating] = useState(false);

  const pdfInputRef = useRef();
  const xlsxInputRef = useRef();
  const abortRef    = useRef(false);

  const addLog = (msg,type="info") => setLog(l=>[{id:uid(),msg,type,ts:Date.now()},...l.slice(0,149)]);

  // ── FILE HANDLERS ─────────────────────────────────────────────────────────
  const handlePDFs = async e => {
    const files = Array.from(e.target.files);
    addLog(`Loading ${files.length} PDF${files.length>1?"s":""}...`);
    const loaded = await Promise.all(files.map(async f => {
      const [b64, arrayBuffer] = await Promise.all([toBase64(f), toArrayBuffer(f)]);
      return { name:f.name, size:f.size, b64, arrayBuffer, file:f };
    }));
    setPdfFiles(prev=>[...prev,...loaded]);
    loaded.forEach(f=>addLog(`✓ ${f.name} (${(f.size/1024).toFixed(0)}KB)`,"success"));
  };

  const handleXLSX = async e => {
    const f = e.target.files[0];
    if(!f) return;
    setXlsxFile(f);
    if(f.name.endsWith(".csv")) {
      const txt = await toText(f);
      setXlsxText(txt);
      setXlsxIsBinary(false);
      addLog(`✓ ${f.name} — ${txt.split("\n").length} rows`,"success");
    } else {
      // xlsx/xls — can't parse binary in browser, note it
      setXlsxText(null);
      setXlsxIsBinary(true);
      addLog(`✓ ${f.name} — Excel file loaded (pricing columns will be identified from spec)`,"success");
    }
  };

  const removePdf = idx => setPdfFiles(prev=>prev.filter((_,i)=>i!==idx));

  // ── MAIN ANALYSIS ─────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    if(!pdfFiles.length) { addLog("Upload at least one RFP PDF first","warn"); return; }
    setPhase("analyzing"); setProgress(5); setItems([]); setLog([]);
    abortRef.current = false;

    const totalSizeMB = pdfFiles.reduce((a,f)=>a+f.size/1024/1024,0);
    const totalB64Bytes = pdfFiles.reduce((a,f)=>(f.b64?.length||0)+a,0);
    const willExtract = totalB64Bytes > MAX_B64_BYTES;
    addLog(`Analyzing ${pdfFiles.length} PDF document${pdfFiles.length>1?"s":""} (${totalSizeMB.toFixed(1)} MB)...`);
    if(willExtract) addLog("PDF is large — extracting text client-side to avoid upload limits","info");
    else if(totalSizeMB>2) addLog("⚠ Large PDF — each step may take 30-50 seconds","warn");

    try {

    // ── PRE-EXTRACT: Extract PDF text once for large PDFs ─────────────────
    let extractedText = null;
    if(willExtract) {
      addLog("Extracting PDF text (one-time)...");
      const parts = await Promise.all(pdfFiles.map(async(f,i)=>{
        const raw = f.arrayBuffer || await toArrayBuffer(f.file);
        const buf = raw.slice(0);
        const t = await extractPdfText(buf);
        addLog(`  Extracted ${t.length.toLocaleString()} chars from ${f.name}`);
        return pdfFiles.length>1 ? `=== DOCUMENT ${i+1} ===\n${t}` : t;
      }));
      extractedText = parts.join("\n\n");
      addLog(`  Full document: ${extractedText.length.toLocaleString()} chars`);
    }
    // For metadata/shipping/compliance: first 50k (cover page, terms)
    // For line items: last 110k (products are at end of bid docs)
    const earlyText  = extractedText ? extractedText.slice(0, 50000) : null;
    const itemsText  = extractedText ? extractedText.slice(-110000) : null;

    // ── STEP 1: Extract RFP metadata ─────────────────────────────────────
    addLog("Step 1/5 — Parsing bid requirements and metadata...");
    const meta = await claudePDF(pdfFiles,
`You are analyzing ${pdfFiles.length > 1 ? `${pdfFiles.length} documents` : "a bid document"} for ST1 Sports athletic equipment supplier.
${ST1}

Extract all bid metadata from these documents. Return JSON:
{
  "title": "full bid title",
  "bidId": "bid number/ID",
  "issuer": "issuing organization",
  "district": "school district if applicable",
  "state": "state",
  "dueDate": "due date as written",
  "contactName": "bid contact",
  "contactEmail": "",
  "contactPhone": "",
  "submissionMethod": "how to submit",
  "submissionAddress": "where to submit",
  "evaluationCriteria": ["criteria list"],
  "paymentTerms": "e.g. Net 30",
  "deliveryTerms": "delivery requirements",
  "bondRequired": false,
  "insuranceRequired": false,
  "referencesRequired": "",
  "requiredDocuments": ["W-9","signed bid form","etc"],
  "estimatedValue": 0,
  "documentCount": ${pdfFiles.length},
  "documentDescriptions": ["what each document covers"],
  "specialRequirements": ["any special requirements"],
  "notes": "other important details"
}`, "You are a procurement specialist for an athletic equipment supplier.", true, addLog, earlyText);

    if(!meta) { addLog("Could not parse RFP metadata — check PDFs and retry","error"); setPhase("upload"); return; }
    setRfpMeta(meta);
    setProgress(15);
    addLog(`✓ ${meta.title||"RFP"} — ${meta.issuer||""} ${meta.state||""}`,"success");
    if(meta.dueDate) addLog(`  Due: ${meta.dueDate} · Submit via: ${meta.submissionMethod||"see spec"}`);

    // ── STEP 2: SHIPPING DETECTION ───────────────────────────────────────
    addLog("Step 2/5 — Detecting shipping / freight rules...");
    const shipping = await claudePDF(pdfFiles,
`CRITICAL: Analyze these bid documents carefully for shipping/freight pricing rules.
Look for language like:
- "prices shall include all transportation"
- "delivery included in price"
- "freight prepaid"
- "FOB destination"
- "shipping charged separately"
- "freight additional"
- "add freight to invoice"
- Any statements about whether shipping/delivery costs are IN the unit price or billed separately

Return JSON:
{
  "shippingIncluded": true or false (true = must include shipping IN the unit price; false = can charge separately),
  "certainty": "high|medium|low",
  "exactLanguage": "copy the exact sentence(s) from the document that state the rule",
  "pageReference": "page number or section if found",
  "freightRule": "brief summary of the rule in plain English",
  "separateFreightAllowed": true or false,
  "notes": "any caveats or conditions"
}

If you cannot find any explicit shipping language, set certainty to low and make your best inference.`,
    "", true, null, earlyText);

    setShippingRule(shipping);
    setProgress(28);
    if(shipping) {
      addLog(
        shipping.shippingIncluded
          ? `✓ SHIPPING INCLUDED IN PRICE — must embed freight costs in unit prices`
          : `✓ SHIPPING SEPARATE — can charge freight independently`,
        "success"
      );
      if(shipping.exactLanguage) addLog(`  Spec says: "${shipping.exactLanguage.slice(0,100)}"`);
    } else {
      addLog("⚠ Could not determine shipping rule — defaulting to INCLUDED","warn");
      setShippingRule({ shippingIncluded:true, certainty:"low", freightRule:"Could not determine — assumed included", notes:"Review spec manually" });
    }

    // ── STEP 3: COMPLIANCE FLAGS ─────────────────────────────────────────
    addLog("Step 3/5 — Checking compliance requirements...");
    const rawFlags = await claudePDF(pdfFiles,
`Analyze this bid document for compliance requirements that could affect ST1 Sports — a Colorado-based LLC bidding in ${meta?.state||"another state"}.

Look for ALL of the following:
1. State business registration — must vendor be registered in ${meta?.state||"the issuing state"}?
2. Foreign corporation registration — out-of-state business filing requirement?
3. Notarized signatures — any signatures require notarization?
4. Bid bond — dollar amount or percentage required?
5. Performance bond or payment bond?
6. State-specific business licenses or contractor licenses?
7. Prevailing wage requirements?
8. Immigration/employment affidavit (NJ, others require this)?
9. In-state preference — do in-state vendors get scoring advantage?
10. Minority/Women/Disadvantaged Business Enterprise (MBE/WBE/DBE) requirements?
11. Any requirement that explicitly excludes or disadvantages out-of-state businesses?
12. Insurance requirements (COI, general liability, workers comp minimums)?

Return JSON array — one object per flag found (include ALL found, even if ST1 likely qualifies):
[{
  "type": "state_registration|foreign_corp|notary|bid_bond|performance_bond|license|prevailing_wage|immigration|in_state_preference|mbe_wbe|insurance|other",
  "severity": "blocker|warning|info",
  "title": "short descriptive title",
  "requirement": "what is specifically required",
  "exactLanguage": "exact quote from spec (50-150 chars)",
  "st1Impact": "how this affects a Colorado LLC bidding here",
  "canBid": true,
  "action": "what ST1 needs to do (e.g. register as foreign LLC, get notary, etc.)"
}]

If none found, return empty array [].`,
    "You are a compliance specialist for a small business bidding on government contracts.", true, null, earlyText);

    const flags = Array.isArray(rawFlags) ? rawFlags : [];
    setComplianceFlags(flags);
    setProgress(42);
    const blockers = flags.filter(f=>f.severity==="blocker");
    const warnings = flags.filter(f=>f.severity==="warning");
    if(flags.length===0) addLog("✓ No major compliance flags found","success");
    else addLog(`✓ Compliance: ${blockers.length} blocker${blockers.length!==1?"s":""}, ${warnings.length} warning${warnings.length!==1?"s":""}${blockers.length>0?" — review before bidding":""}`, blockers.length>0?"warn":"success");

    // ── STEP 4: Extract all line items ───────────────────────────────────
    addLog("Step 4/5 — Extracting all line items and product specifications...");
    const rawItems = await claudePDF(pdfFiles,
`Extract EVERY product line item from these bid documents for ST1 Sports.
Include ALL items even if we might not carry them — mark canBid:false for those.

ST1 Sports carries: track & field equipment (Blazer/Gill Athletics), baseballs/softballs (Diamond/Pro-Nine), footballs/basketballs/volleyballs/soccer (Wilson/Molten), batting helmets/catcher gear/protective equipment (All-Star/EvoShield), bats (DeMarini/Louisville Slugger/Rawlings), timing systems (FinishLynx/Ultrak/Seiko), athletic apparel, field maintenance equipment. We do NOT carry: gymnasium flooring, weight room equipment, swim equipment, wrestling mats, uniforms/clothing printing.

Return a JSON array — include EVERY line item, numbered sequentially:
[{
  "lineNum": "line number or ID as shown in document",
  "category": "product category (e.g. Baseball, Football, Track & Field, Volleyball)",
  "description": "full product description exactly as written",
  "brand": "specified brand if any (null if not specified)",
  "partNumber": "part number or catalog number if given",
  "unit": "each|pair|set|dozen|case|etc",
  "qtyRequested": quantity as number or 0 if not specified,
  "specifications": "key technical specs",
  "substituteAllowed": true or false,
  "canBid": true or false based on ST1 product list above,
  "st1Brand": "our brand that would supply this (e.g. Diamond, Blazer, Wilson)",
  "noBidReason": "reason if canBid is false, null otherwise"
}]

IMPORTANT: Extract from the PRODUCT LISTING section of the document. There may be 50-200+ line items. Get them ALL.`,
    "Return ONLY valid JSON array.", true, null, itemsText);

    const itemList = Array.isArray(rawItems) ? rawItems : [];
    const withState = itemList.map((item,i) => ({
      ...item, id:uid(), idx:i+1,
      dealerCost:null, ourPrice:null, freight:null, finalPrice:null,
      margin:20, totalLine:null,
      confidence:null, priceNotes:"", approved:false, declined:false,
      substituteDesc:"",
    }));
    setItems(withState);
    setProgress(58);
    addLog(`✓ ${withState.length} line items extracted (${withState.filter(i=>i.canBid!==false).length} biddable)`,"success");

    // ── STEP 5: Auto-price all biddable items ────────────────────────────
    addLog("Step 5/5 — Auto-pricing biddable items...");
    const biddable = withState.filter(i=>i.canBid!==false);
    const shippingIn = shipping?.shippingIncluded !== false; // default to included
    let updated = [...withState];

    const batchSize = 8;
    for(let i=0; i<biddable.length; i+=batchSize) {
      if(abortRef.current) { addLog("⏹ Stopped"); break; }
      const batch = biddable.slice(i, i+batchSize);
      addLog(`  Pricing ${i+1}–${Math.min(i+batchSize,biddable.length)} of ${biddable.length}...`);

      const result = await claudeText(
`Price these bid line items for ST1 Sports.
${ST1}
${PRICING}
Shipping rule: ${shippingIn ? "SHIPPING MUST BE INCLUDED IN UNIT PRICE — add freight cost to unit price, do not list separately" : "SHIPPING CAN BE CHARGED SEPARATELY — show freight as a separate line, keep unit price clean"}

Items to price:
${JSON.stringify(batch.map(({lineNum,category,description,brand,unit,qtyRequested,st1Brand,partNumber})=>({lineNum,category,description,brand,unit,qty:qtyRequested,st1Brand,partNumber})),null,1)}

Return JSON array — one object per item in the same order:
[{
  "lineNum": "same as input",
  "dealerCost": dealer cost per unit as number,
  "ourPrice": our price before freight as number,
  "freight": freight cost per unit as number (0 if shipping included in ourPrice or if can be billed separately),
  "finalPrice": ${shippingIn ? "ourPrice + freight (all-in unit price to bid)" : "ourPrice only (freight billed separately)"},
  "margin": margin percentage as number,
  "totalLine": finalPrice * qty as number,
  "confidence": "high|medium|low",
  "priceNotes": "brief source/rationale",
  "substituteDesc": "if substituting, describe our product"
}]`,
      "", true, CLAUDE_MODEL); // use Sonnet for pricing — needs stronger reasoning

      if(Array.isArray(result)) {
        result.forEach(p => {
          const idx = updated.findIndex(x=>String(x.lineNum)===String(p.lineNum));
          if(idx>=0) updated[idx] = { ...updated[idx], ...p };
        });
        setItems([...updated]);
      }
      setProgress(55 + Math.round(((i+batchSize)/biddable.length)*35));
      await sleep(200);
    }

    // Generate cover letter
    addLog("Building cover letter...");
    const totalBid = updated.filter(i=>i.canBid!==false).reduce((s,i)=>(i.finalPrice||0)*(i.qtyRequested||1)+s,0);
    const letter = await claudeText(
`Write a professional bid cover letter from Matt Stone at ST1 Sports.
RFP: ${meta?.title} | Bid ID: ${meta?.bidId} | Issuer: ${meta?.issuer}, ${meta?.state}
Due: ${meta?.dueDate} | Bidding ${updated.filter(i=>i.canBid!==false).length} of ${updated.length} items | Est. value: $${totalBid.toLocaleString()}
${ST1}
3-4 paragraphs. Professional. Mention delivery capability, references available, competitive pricing. End with Matt Stone | matt@st1sports.com | 719-256-0275 | st1sports.com`);
    setCoverLetter(letter);

    setProgress(100);
    setPhase("review");
    addLog(`━━ COMPLETE ━━ Ready for your review and approval`,"success");
    addLog(`  Bid items: ${updated.filter(i=>i.canBid!==false).length} · No-bid: ${updated.filter(i=>i.canBid===false).length}`,"success");

    } catch(err) {
      addLog(`✗ Analysis failed: ${err.message}`,"error");
      addLog("Check your ANTHROPIC_KEY env var and try again. If the PDF is very large, try splitting it.","warn");
      setPhase("upload");
    }
  };

  // ── ITEM EDITING ──────────────────────────────────────────────────────────
  const updateItem = useCallback((id, field, value) => {
    setItems(prev=>prev.map(item=>{
      if(item.id!==id) return item;
      const updated = { ...item, [field]: value };
      // Recalculate derived fields
      if(["ourPrice","freight","qtyRequested","margin"].includes(field)) {
        const op  = parseFloat(field==="ourPrice"?value:updated.ourPrice)||0;
        const fr  = parseFloat(field==="freight"?value:updated.freight)||0;
        const qty = parseFloat(field==="qtyRequested"?value:updated.qtyRequested)||1;
        updated.finalPrice = op + fr;
        updated.totalLine  = updated.finalPrice * qty;
        if(updated.dealerCost && op>0) {
          updated.margin = ((op - updated.dealerCost) / op * 100);
        }
      }
      if(field==="dealerCost") {
        const dc  = parseFloat(value)||0;
        const fp  = parseFloat(updated.finalPrice)||0;
        if(dc>0&&fp>0) updated.margin = ((fp-dc)/fp*100);
      }
      return updated;
    }));
  }, []);

  const approveAll = () => {
    setItems(prev=>prev.map(i=>i.canBid!==false&&!i.declined?{...i,approved:true}:i));
  };

  const toggleApprove = id => {
    setItems(prev=>prev.map(i=>i.id===id?{...i,approved:!i.approved,declined:false}:i));
  };

  const toggleDecline = id => {
    setItems(prev=>prev.map(i=>i.id===id?{...i,declined:!i.declined,approved:false}:i));
  };

  // ── EXPORT BACK TO THEIR SPREADSHEET ─────────────────────────────────────
  const handleFinalExport = async () => {
    setGenerating(true);
    const approvedItems = items.filter(i=>i.approved);
    addLog(`Exporting ${approvedItems.length} approved items...`);

    // If CSV was uploaded, write back to it
    if(xlsxText && !xlsxIsBinary) {
      const outputCsv = buildOutputCSV(xlsxText, approvedItems);
      if(outputCsv) {
        const a=document.createElement("a");
        a.href=URL.createObjectURL(new Blob([outputCsv],{type:"text/csv"}));
        a.download=`${xlsxFile?.name?.replace(/\.csv$/i,"")}_ST1_Pricing.csv`;
        a.click();
        addLog(`✓ Pricing written back to ${xlsxFile?.name}`,"success");
      }
    }

    // Always export our complete pricing sheet
    const hdrs = ["Line #","Category","Description","Specified Brand","Our Brand/SKU","Unit","Qty","Dealer Cost","Our Price","Freight/Unit","Final Unit Price","Margin %","Line Total","Shipping Included","Confidence","Price Notes","Substitute Description","Status"];
    const rows = items.map(i=>[
      i.lineNum||i.idx,
      i.category||"",
      `"${(i.description||"").replace(/"/g,'""')}"`,
      `"${(i.brand||"").replace(/"/g,'""')}"`,
      `"${(i.st1Brand||"").replace(/"/g,'""')}"`,
      i.unit||"each",
      i.qtyRequested||1,
      i.dealerCost!=null?i.dealerCost.toFixed(2):"",
      i.ourPrice!=null?i.ourPrice.toFixed(2):"",
      i.freight!=null?i.freight.toFixed(2):"0.00",
      i.finalPrice!=null?i.finalPrice.toFixed(2):"",
      i.margin!=null?i.margin.toFixed(1):"",
      i.totalLine!=null?i.totalLine.toFixed(2):"",
      shippingRule?.shippingIncluded?"YES":"NO",
      i.confidence||"",
      `"${(i.priceNotes||"").replace(/"/g,'""')}"`,
      `"${(i.substituteDesc||"").replace(/"/g,'""')}"`,
      i.approved?"APPROVED":i.declined?"NO BID":i.canBid===false?"NO BID (NO STOCK)":"PENDING",
    ]);
    const csv=[hdrs.join(","),...rows.map(r=>r.join(","))].join("\n");
    const a2=document.createElement("a");
    a2.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a2.download=`ST1_BidPricing_${rfpMeta?.bidId||"RFP"}_${new Date().toISOString().slice(0,10)}.csv`;
    a2.click();
    addLog(`✓ Full pricing sheet exported`,"success");

    setApproved(true);
    setGenerating(false);
  };

  // ── DERIVED STATS ─────────────────────────────────────────────────────────
  const biddable   = items.filter(i=>i.canBid!==false&&!i.declined);
  const totalBid   = biddable.filter(i=>i.finalPrice).reduce((s,i)=>(i.finalPrice||0)*(i.qtyRequested||1)+s,0);
  const totalFreight= items.reduce((s,i)=>(i.freight||0)*(i.qtyRequested||1)+s,0);
  const avgMargin  = biddable.filter(i=>i.margin).length>0 ? biddable.filter(i=>i.margin).reduce((s,i)=>s+(i.margin||0),0)/biddable.filter(i=>i.margin).length : 0;
  const approvedItems= items.filter(i=>i.approved);
  const pendingItems = biddable.filter(i=>!i.approved&&!i.declined);

  const filteredItems = items
    .filter(i=>{
      if(filter==="bid")     return i.canBid!==false&&!i.declined;
      if(filter==="nobid")   return i.canBid===false||i.declined;
      if(filter==="approved")return i.approved;
      if(filter==="pending") return i.canBid!==false&&!i.approved&&!i.declined;
      return true;
    })
    .sort((a,b)=>sortBy==="value"?(b.totalLine||0)-(a.totalLine||0):sortBy==="margin"?(b.margin||0)-(a.margin||0):(a.idx||0)-(b.idx||0));

  const logColor = {success:B.green,warn:B.yellow,error:B.red,info:B.muted};

  // Editable cell component
  const EditableCell = ({item,field,type="number",prefix=""}) => {
    const isEditing = editCell?.itemId===item.id&&editCell?.field===field;
    const val = item[field];
    const display = type==="number"&&val!=null ? (prefix+Number(val).toFixed(field==="margin"?1:2)) : (val||"—");

    return isEditing ? (
      <input type="number" defaultValue={val||""} autoFocus
        onBlur={e=>{updateItem(item.id,field,parseFloat(e.target.value)||0);setEditCell(null);}}
        onKeyDown={e=>{if(e.key==="Enter"){updateItem(item.id,field,parseFloat(e.target.value)||0);setEditCell(null);}if(e.key==="Escape")setEditCell(null);}}
        style={{width:70,background:B.white,border:`2px solid ${B.orange}`,borderRadius:3,padding:"3px 5px",fontSize:11,textAlign:"right"}}/>
    ) : (
      <span onClick={()=>setEditCell({itemId:item.id,field})}
        style={{cursor:"pointer",color:val!=null?B.blue:B.muted,borderBottom:`1px dashed ${val!=null?B.blue+"80":B.border}`,paddingBottom:1}}>
        {display}
      </span>
    );
  };

  return (
    <div style={{minHeight:"100vh",background:B.pageBg,fontFamily:"'Lexend',sans-serif",color:B.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&family=Lexend+Zetta:wght@700;900&family=Lexend:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${B.orange};border-radius:2px} ::-webkit-scrollbar-track{background:${B.surface}}
        button{cursor:pointer;font-family:'Lexend',sans-serif;transition:all .12s} button:hover{opacity:.82} button:active{transform:scale(.97)}
        input,textarea,select{font-family:'Lexend',sans-serif;outline:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .fu{animation:fadeUp .2s ease} .blink{animation:blink 1.5s infinite}
        .card{background:${B.white};border:1px solid ${B.border};border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        table{width:100%;border-collapse:collapse}
        th{background:${B.surface};padding:7px 8px;text-align:left;font-family:'Lexend Zetta',sans-serif;font-size:8px;color:${B.muted};letter-spacing:1.5px;white-space:nowrap;border-bottom:2px solid ${B.border};position:sticky;top:0;z-index:2}
        td{padding:7px 8px;border-bottom:1px solid ${B.border};font-size:11px;vertical-align:middle}
        tr:hover td{background:${B.surface}}
      `}</style>
      {/* ← Back to RevOps */}
      <div style={{background:"#fff",borderBottom:"1px solid #E2E0DB",padding:"6px 20px",display:"flex",alignItems:"center",gap:8}}>
        <a href="/" style={{display:"flex",alignItems:"center",gap:6,textDecoration:"none",color:"#7A7872",fontFamily:"'Lexend',sans-serif",fontSize:11}}>
          <span style={{fontSize:13}}>←</span> Back to RevOps
        </a>
      </div>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{background:B.white,borderBottom:`1px solid ${B.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,background:B.orange,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.white,letterSpacing:-1}}>ST1</span>
          </div>
          <div>
            <div style={{fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.black,letterSpacing:.3}}>RFP AUTOMATION</div>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:7,color:B.orange,letterSpacing:2.5}}>BID RESPONSE ENGINE</div>
          </div>
        </div>

        {/* Phases */}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {[
            {p:"upload",  n:1, label:"Upload"},
            {p:"analyzing",n:2,label:"Analyze"},
            {p:"review",  n:3, label:"Review & Price"},
            {p:"done",    n:4, label:"Export"},
          ].map((step,i,arr)=>{
            const phases=["upload","analyzing","review","done"];
            const cur=phases.indexOf(phase);
            const si =phases.indexOf(step.p);
            const done=cur>si; const active=cur===si;
            return (
              <div key={step.p} style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:22,height:22,borderRadius:"50%",background:done?B.green:active?B.orange:B.border,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {done?<span style={{color:B.white,fontSize:11}}>✓</span>:<span style={{fontFamily:"'Russo One',sans-serif",fontSize:10,color:active?B.white:B.muted}}>{step.n}</span>}
                  </div>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:active?B.text:done?B.green:B.muted,fontWeight:active?500:400}}>{step.label}</span>
                </div>
                {i<arr.length-1&&<div style={{width:24,height:1,background:done?B.green:B.border,margin:"0 2px"}}/>}
              </div>
            );
          })}
        </div>

        {rfpMeta&&<div style={{textAlign:"right"}}>
          <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.text,fontWeight:500}}>{rfpMeta.issuer}</div>
          <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>Due {rfpMeta.dueDate}</div>
        </div>}
      </div>

      {/* Progress */}
      {phase!=="upload"&&<div style={{height:3,background:B.border}}><div style={{height:"100%",width:`${progress}%`,background:B.orange,transition:"width .5s"}}/></div>}

      {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:0,minHeight:"calc(100vh - 73px)"}}>

        {/* LEFT — main content */}
        <div style={{padding:"24px 28px",overflowY:"auto"}}>

          {/* ── UPLOAD ── */}
          {phase==="upload"&&(
            <div className="fu">
              <div style={{marginBottom:22}}>
                <div style={{fontFamily:"'Russo One',sans-serif",fontSize:22,color:B.black,letterSpacing:.3}}>UPLOAD RFP DOCUMENTS</div>
                <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginTop:3}}>Upload all PDFs (spec, addenda, requirements) plus the pricing spreadsheet if provided</div>
                <div style={{width:36,height:3,background:B.orange,marginTop:8,borderRadius:2}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
                {/* PDF upload */}
                <div className="card" style={{borderTop:`3px solid ${B.orange}`}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.orange,letterSpacing:2,marginBottom:10}}>BID DOCUMENTS — PDF (REQUIRED)</div>
                  <div onClick={()=>pdfInputRef.current?.click()}
                    style={{border:`2px dashed ${pdfFiles.length?B.green:B.borderD}`,borderRadius:6,padding:"20px",textAlign:"center",cursor:"pointer",background:pdfFiles.length?B.greenBg:B.surface}}>
                    <div style={{fontSize:28,marginBottom:6}}>📋</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Click to upload PDFs</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>Multiple files supported — spec, addenda, amendments</div>
                    <input ref={pdfInputRef} type="file" accept=".pdf" multiple onChange={handlePDFs} style={{display:"none"}}/>
                  </div>
                  {pdfFiles.length>0&&(
                    <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                      {pdfFiles.map((f,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",background:B.greenBg,borderRadius:4,border:`1px solid ${B.green}40`}}>
                          <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.green}}>✓ {f.name} <span style={{color:B.muted}}>({(f.size/1024).toFixed(0)}KB)</span></span>
                          <button onClick={()=>removePdf(i)} style={{background:"none",border:"none",color:B.red,fontSize:13,lineHeight:1}}>×</button>
                        </div>
                      ))}
                      <button onClick={()=>pdfInputRef.current?.click()} style={{background:"none",border:`1px dashed ${B.orange}`,color:B.orange,borderRadius:4,padding:"5px",fontSize:10,fontFamily:"'Lexend',sans-serif",marginTop:2}}>+ Add more PDFs</button>
                    </div>
                  )}
                </div>

                {/* Spreadsheet upload */}
                <div className="card" style={{borderTop:`3px solid ${B.blue}`}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.blue,letterSpacing:2,marginBottom:10}}>PRICING SPREADSHEET (OPTIONAL)</div>
                  <div onClick={()=>xlsxInputRef.current?.click()}
                    style={{border:`2px dashed ${xlsxFile?B.green:B.borderD}`,borderRadius:6,padding:"20px",textAlign:"center",cursor:"pointer",background:xlsxFile?B.greenBg:B.surface}}>
                    <div style={{fontSize:28,marginBottom:6}}>📊</div>
                    {xlsxFile
                      ?<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.green,fontWeight:500}}>{xlsxFile.name}</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:1}}>{(xlsxFile.size/1024).toFixed(0)}KB · Click to replace</div></div>
                      :<div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>Upload their pricing template</div><div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>Excel or CSV — we'll fill in our prices</div></div>
                    }
                    <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleXLSX} style={{display:"none"}}/>
                  </div>
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:8,lineHeight:1.6}}>
                    {xlsxFile&&xlsxIsBinary&&<div style={{color:B.yellow}}>⚠ Excel file — pricing will be exported as CSV to fill in manually</div>}
                    {xlsxFile&&!xlsxIsBinary&&<div style={{color:B.green}}>✓ CSV format — prices will be written directly back to this file</div>}
                    {!xlsxFile&&"If no spreadsheet, we'll generate our own pricing sheet to submit"}
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="card" style={{marginBottom:20,borderLeft:`3px solid ${B.orange}`}}>
                <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.orange,letterSpacing:2,marginBottom:12}}>WHAT THIS TOOL DOES</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                  {[
                    ["📋 Parse All Docs","Reads every PDF simultaneously — specs, addenda, requirements"],
                    ["📦 Detect Shipping","Finds exact language about whether freight is in the price or separate"],
                    ["💰 Price Every Item","Uses ST1 margins and price lists to bid every line competitively"],
                    ["📤 Export to Spreadsheet","Fills their template with your prices, ready to submit"],
                  ].map(([t,d])=>(
                    <div key={t} style={{padding:"10px 12px",background:B.surface,borderRadius:5}}>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,fontWeight:500,color:B.text,marginBottom:3}}>{t}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,lineHeight:1.6}}>{d}</div>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={runAnalysis} disabled={!pdfFiles.length}
                style={{background:pdfFiles.length?B.orange:B.border,color:pdfFiles.length?B.white:B.muted,border:"none",borderRadius:6,padding:"13px 32px",fontFamily:"'Russo One',sans-serif",fontSize:14,letterSpacing:1,cursor:pdfFiles.length?"pointer":"not-allowed"}}>
                {pdfFiles.length?`⊕ ANALYZE ${pdfFiles.length} DOCUMENT${pdfFiles.length>1?"S":""} & BUILD RESPONSE`:"UPLOAD AT LEAST ONE PDF TO CONTINUE"}
              </button>
            </div>
          )}

          {/* ── ANALYZING ── */}
          {phase==="analyzing"&&(
            <div style={{textAlign:"center",padding:"60px 0"}} className="fu">
              <div style={{width:56,height:56,border:`4px solid ${B.border}`,borderTop:`4px solid ${B.orange}`,borderRadius:"50%",margin:"0 auto 18px",animation:"spin 1s linear infinite"}}/>
              <div style={{fontFamily:"'Russo One',sans-serif",fontSize:20,color:B.black,letterSpacing:.3,marginBottom:6}}>ANALYZING YOUR BID DOCUMENTS</div>
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted,marginBottom:20}}>Parsing {pdfFiles.length} PDF{pdfFiles.length>1?"s":""} · detecting shipping rules · extracting and pricing all line items...</div>
              <div style={{maxWidth:440,margin:"0 auto",textAlign:"left"}}>
                {log.slice(0,8).map(l=>(
                  <div key={l.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:logColor[l.type]||B.muted,padding:"3px 0",lineHeight:1.6}}>{l.msg}</div>
                ))}
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {(phase==="review"||phase==="done")&&rfpMeta&&(
            <div className="fu">
              {/* Shipping banner — prominent */}
              {shippingRule&&(
                <div style={{marginBottom:16,padding:"12px 16px",borderRadius:7,
                  background:shippingRule.shippingIncluded?B.blueBg:B.tealBg,
                  border:`1px solid ${shippingRule.shippingIncluded?B.blue+"60":B.teal+"60"}`,
                  borderLeft:`4px solid ${shippingRule.shippingIncluded?B.blue:B.teal}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:shippingRule.shippingIncluded?B.blue:B.teal,letterSpacing:1.5,marginBottom:4}}>
                        📦 SHIPPING RULE — {shippingRule.certainty?.toUpperCase()} CONFIDENCE
                      </div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:13,color:B.text,fontWeight:500,marginBottom:3}}>
                        {shippingRule.shippingIncluded
                          ? "✓ Shipping MUST be included in unit prices — freight is embedded in your bid prices"
                          : "✓ Shipping can be charged SEPARATELY — unit prices are clean, freight billed on invoice"}
                      </div>
                      {shippingRule.exactLanguage&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,fontStyle:"italic"}}>Spec says: "{shippingRule.exactLanguage.slice(0,150)}{shippingRule.exactLanguage.length>150?"...":""}"</div>}
                    </div>
                    <div style={{flexShrink:0,marginLeft:16,textAlign:"center"}}>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:11,color:shippingRule.shippingIncluded?B.blue:B.teal,letterSpacing:.5}}>EST. FREIGHT</div>
                      <div style={{fontFamily:"'Russo One',sans-serif",fontSize:18,color:shippingRule.shippingIncluded?B.blue:B.teal}}>{fmt$(totalFreight)}</div>
                      <div style={{fontFamily:"'Lexend',sans-serif",fontSize:9,color:B.muted}}>{shippingRule.shippingIncluded?"embedded":"separate"}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Compliance flags */}
              {complianceFlags.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>COMPLIANCE FLAGS ({complianceFlags.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {complianceFlags.map((f,i)=>{
                      const col = f.severity==="blocker"?B.red:f.severity==="warning"?B.yellow:B.blue;
                      const bg  = f.severity==="blocker"?B.redBg:f.severity==="warning"?B.yellowBg:B.blueBg;
                      return(
                        <div key={i} style={{padding:"10px 14px",borderRadius:6,background:bg,borderLeft:`4px solid ${col}`,border:`1px solid ${col}40`,borderLeftWidth:4}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                                <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:col,letterSpacing:1}}>
                                  {f.severity==="blocker"?"🚫 BLOCKER":f.severity==="warning"?"⚠ WARNING":"ℹ INFO"} · {(f.type||"").replace(/_/g," ").toUpperCase()}
                                </span>
                              </div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.text,fontWeight:500,marginBottom:2}}>{f.title}</div>
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.textMid,marginBottom:3}}>{f.requirement}</div>
                              {f.exactLanguage&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,fontStyle:"italic",marginBottom:3}}>"{f.exactLanguage.slice(0,200)}"</div>}
                              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:col,fontWeight:500}}>→ {f.action}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RFP summary */}
              <div className="card" style={{marginBottom:14,borderTop:`3px solid ${B.orange}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:17,color:B.black,letterSpacing:.3,marginBottom:3}}>{rfpMeta.title}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted,marginBottom:6}}>{rfpMeta.bidId} · {rfpMeta.issuer} · {rfpMeta.state}</div>
                    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                      {[["Due",rfpMeta.dueDate],["Submit",rfpMeta.submissionMethod||"See spec"],["Payment",rfpMeta.paymentTerms||"—"],["Contact",rfpMeta.contactEmail||rfpMeta.contactName||"—"]].map(([l,v])=>(
                        <div key={l} style={{fontFamily:"'Lexend',sans-serif",fontSize:11}}>
                          <span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1,marginRight:4}}>{l}:</span>
                          <span style={{color:B.text}}>{v}</span>
                        </div>
                      ))}
                    </div>
                    {rfpMeta.documentDescriptions?.length>0&&(
                      <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {rfpMeta.documentDescriptions.map((d,i)=>(
                          <span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.blue,background:B.blueBg,padding:"2px 7px",borderRadius:3}}>Doc {i+1}: {d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:16}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:1}}>TOTAL BID</div>
                    <div style={{fontFamily:"'Russo One',sans-serif",fontSize:24,color:B.orange}}>{fmt$(totalBid)}</div>
                    <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginTop:2}}>avg margin {pct(avgMargin)}</div>
                  </div>
                </div>
                {rfpMeta.requiredDocuments?.length>0&&(
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.border}`}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:6}}>REQUIRED DOCUMENTS</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {rfpMeta.requiredDocuments.map((d,i)=>(
                        <span key={i} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.textMid,background:B.surface,border:`1px solid ${B.border}`,padding:"3px 8px",borderRadius:3}}>☐ {d}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Controls row */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[["all","All Items",items.length],["bid","Biddable",biddable.length],["pending","Pending Review",pendingItems.length],["approved","Approved",approvedItems.length],["nobid","No Bid",items.filter(i=>i.canBid===false||i.declined).length]].map(([v,l,n])=>(
                    <button key={v} onClick={()=>setFilter(v)} style={{background:filter===v?B.orange:B.white,color:filter===v?B.white:B.muted,border:`1px solid ${filter===v?B.orange:B.border}`,borderRadius:4,padding:"5px 10px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>
                      {l} ({n})
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted}}>Sort:</span>
                  {[["line","Line #"],["value","Value"],["margin","Margin"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setSortBy(v)} style={{background:sortBy===v?B.surface:B.white,color:sortBy===v?B.text:B.muted,border:`1px solid ${B.border}`,borderRadius:3,padding:"4px 8px",fontSize:10,fontFamily:"'Lexend',sans-serif"}}>{l}</button>
                  ))}
                  <div style={{width:1,height:18,background:B.border,margin:"0 4px"}}/>
                  <button onClick={approveAll} style={{background:B.green,color:B.white,border:"none",borderRadius:4,padding:"6px 12px",fontSize:10,fontFamily:"'Lexend Zetta',sans-serif",fontWeight:700,letterSpacing:.5}}>
                    ✓ APPROVE ALL BIDDABLE
                  </button>
                </div>
              </div>

              {/* Hint */}
              <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,marginBottom:8}}>
                💡 Click any <span style={{color:B.blue,borderBottom:`1px dashed ${B.blue}`}}>blue underlined value</span> to edit directly · Changes recalculate automatically
              </div>

              {/* LINE ITEMS TABLE */}
              <div style={{overflowX:"auto",borderRadius:8,border:`1px solid ${B.border}`,boxShadow:"0 1px 3px rgba(0,0,0,.05)",marginBottom:16}}>
                <table>
                  <thead>
                    <tr>
                      <th style={{width:28}}>☐</th>
                      <th>#</th>
                      <th style={{minWidth:200}}>Description</th>
                      <th>Brand / Our SKU</th>
                      <th>Unit</th>
                      <th style={{textAlign:"right"}}>Qty</th>
                      <th style={{textAlign:"right"}}>Dealer Cost</th>
                      <th style={{textAlign:"right"}}>Our Price</th>
                      <th style={{textAlign:"right"}}>{shippingRule?.shippingIncluded?"Freight (in price)":"Freight (separate)"}</th>
                      <th style={{textAlign:"right",background:B.orangeBg}}>Final Unit $</th>
                      <th style={{textAlign:"right"}}>Margin</th>
                      <th style={{textAlign:"right"}}>Line Total</th>
                      <th>Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item=>{
                      const noBid = item.canBid===false||item.declined;
                      const rowBg = item.approved?B.greenBg:noBid?B.redBg:B.white;
                      return (
                        <tr key={item.id} style={{background:rowBg,opacity:noBid?.6:1}}>
                          <td style={{textAlign:"center"}}>
                            {item.canBid!==false&&(
                              <input type="checkbox" checked={!!item.approved} onChange={()=>toggleApprove(item.id)}
                                style={{accentColor:B.orange,width:14,height:14,cursor:"pointer"}}/>
                            )}
                          </td>
                          <td style={{color:B.muted,fontWeight:500}}>{item.lineNum||item.idx}</td>
                          <td>
                            <div style={{fontWeight:500,color:B.text,lineHeight:1.3}}>{item.description?.slice(0,55)}{item.description?.length>55?"...":""}</div>
                            {item.substituteDesc&&<div style={{fontSize:10,color:B.orange,marginTop:1}}>↳ {item.substituteDesc}</div>}
                            {item.canBid===false&&<div style={{fontSize:10,color:B.red,marginTop:1}}>No stock: {item.noBidReason?.slice(0,40)||"not carried"}</div>}
                          </td>
                          <td style={{color:B.muted}}>
                            <div>{item.brand||"—"}</div>
                            {item.st1Brand&&<div style={{fontSize:10,color:B.orange}}>{item.st1Brand}</div>}
                          </td>
                          <td style={{color:B.muted}}>{item.unit||"each"}</td>
                          <td style={{textAlign:"right"}}>
                            {item.canBid!==false&&<EditableCell item={item} field="qtyRequested" type="number"/>}
                          </td>
                          <td style={{textAlign:"right"}}>
                            {item.canBid!==false&&<EditableCell item={item} field="dealerCost" type="number" prefix="$"/>}
                          </td>
                          <td style={{textAlign:"right"}}>
                            {item.canBid!==false&&<EditableCell item={item} field="ourPrice" type="number" prefix="$"/>}
                          </td>
                          <td style={{textAlign:"right"}}>
                            {item.canBid!==false&&<EditableCell item={item} field="freight" type="number" prefix="$"/>}
                          </td>
                          <td style={{textAlign:"right",background:item.approved?B.greenBg:B.orangeBg,fontWeight:600}}>
                            {item.canBid!==false&&<EditableCell item={item} field="finalPrice" type="number" prefix="$"/>}
                          </td>
                          <td style={{textAlign:"right",color:item.margin>25?B.green:item.margin<15?B.red:B.yellow}}>
                            {item.canBid!==false&&<EditableCell item={item} field="margin" type="number" prefix=""/>}
                          </td>
                          <td style={{textAlign:"right",fontWeight:500,color:B.text}}>
                            {item.totalLine!=null?fmt$(item.totalLine):"—"}
                          </td>
                          <td>
                            {item.confidence&&<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:{high:B.green,medium:B.yellow,low:B.red}[item.confidence]||B.muted,background:{high:B.greenBg,medium:B.yellowBg,low:B.redBg}[item.confidence]||B.surface,padding:"2px 5px",borderRadius:3,letterSpacing:.5}}>{item.confidence.toUpperCase()}</span>}
                          </td>
                          <td>
                            {item.canBid===false
                              ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:B.redBg,padding:"2px 6px",borderRadius:3}}>NO STOCK</span>
                              :item.approved
                              ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.green,background:B.greenBg,padding:"2px 6px",borderRadius:3}}>✓ APPROVED</span>
                              :item.declined
                              ?<span style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.red,background:B.redBg,padding:"2px 6px",borderRadius:3}}>NO BID</span>
                              :<div style={{display:"flex",gap:4}}>
                                <button onClick={()=>toggleApprove(item.id)} style={{background:B.greenBg,color:B.green,border:`1px solid ${B.green}40`,borderRadius:3,padding:"3px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif"}}>BID</button>
                                <button onClick={()=>toggleDecline(item.id)} style={{background:B.redBg,color:B.red,border:`1px solid ${B.red}40`,borderRadius:3,padding:"3px 6px",fontSize:9,fontFamily:"'Lexend Zetta',sans-serif"}}>SKIP</button>
                              </div>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {items.length>0&&(
                    <tfoot>
                      <tr style={{background:B.surface,borderTop:`2px solid ${B.borderD}`}}>
                        <td colSpan={9} style={{padding:"9px 8px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted,letterSpacing:1}}>
                          {approvedItems.length} APPROVED · {pendingItems.length} PENDING · {fmt$(totalFreight)} TOTAL FREIGHT ({shippingRule?.shippingIncluded?"embedded":"separate"})
                        </td>
                        <td style={{padding:"9px 8px",textAlign:"right",fontFamily:"'Russo One',sans-serif",fontSize:15,color:B.orange,background:B.orangeBg}}>{fmt$(totalBid)}</td>
                        <td style={{padding:"9px 8px",textAlign:"right",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.muted}}>{pct(avgMargin)}</td>
                        <td style={{padding:"9px 8px",textAlign:"right",fontFamily:"'Russo One',sans-serif",fontSize:13,color:B.text}}>{fmt$(approvedItems.reduce((s,i)=>(i.totalLine||0)+s,0))}</td>
                        <td colSpan={2}/>
                      </tr>
                    </tfoot>
                  )}
                </table>
                {filteredItems.length===0&&<div style={{padding:"40px 0",textAlign:"center",fontFamily:"'Lexend',sans-serif",fontSize:12,color:B.muted}}>No items in this filter</div>}
              </div>

              {/* Cover letter */}
              {coverLetter&&(
                <div className="card" style={{marginBottom:16,borderTop:`3px solid ${B.blue}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,color:B.blue,letterSpacing:2}}>COVER LETTER</div>
                    <button onClick={()=>navigator.clipboard?.writeText(coverLetter)} style={{background:B.blue,color:B.white,border:"none",borderRadius:4,padding:"5px 12px",fontFamily:"'Lexend Zetta',sans-serif",fontSize:9,fontWeight:700,letterSpacing:.5}}>COPY</button>
                  </div>
                  <textarea value={coverLetter} onChange={e=>setCoverLetter(e.target.value)} rows={10}
                    style={{width:"100%",background:B.surface,border:`1px solid ${B.border}`,color:B.text,borderRadius:5,padding:"11px 13px",fontSize:12,lineHeight:1.7,resize:"vertical"}}/>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────────────── */}
        <div style={{background:B.white,borderLeft:`1px solid ${B.border}`,display:"flex",flexDirection:"column",minHeight:"calc(100vh - 73px)"}}>

          {/* Stats */}
          {phase==="review"&&(
            <div style={{padding:"16px",borderBottom:`1px solid ${B.border}`}}>
              <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:10}}>BID SUMMARY</div>
              {[
                ["Total Items",   items.length,                                          B.text],
                ["Biddable",      biddable.length,                                       B.green],
                ["No Bid",        items.filter(i=>i.canBid===false||i.declined).length,  B.red],
                ["Approved",      approvedItems.length,                                  B.green],
                ["Pending Review",pendingItems.length,                                   B.yellow],
                ["Bid Value",     fmt$(totalBid),                                        B.orange],
                ["Avg Margin",    pct(avgMargin),                                        avgMargin>20?B.green:B.yellow],
                ["Total Freight", fmt$(totalFreight),                                    B.blue],
              ].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${B.border}`}}>
                  <span style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.muted}}>{l}</span>
                  <span style={{fontFamily:"'Russo One',sans-serif",fontSize:13,color:c,letterSpacing:.3}}>{v}</span>
                </div>
              ))}

              {/* Export button */}
              <div style={{marginTop:14}}>
                {pendingItems.length>0&&(
                  <div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.yellow,background:B.yellowBg,padding:"7px 10px",borderRadius:4,marginBottom:8,border:`1px solid ${B.yellow}40`}}>
                    ⚠ {pendingItems.length} items still need a BID / SKIP decision
                  </div>
                )}
                <button onClick={handleFinalExport} disabled={generating||approvedItems.length===0}
                  style={{width:"100%",background:approvedItems.length>0?B.orange:B.border,color:approvedItems.length>0?B.white:B.muted,border:"none",borderRadius:5,padding:"11px",fontFamily:"'Russo One',sans-serif",fontSize:13,letterSpacing:.5,cursor:approvedItems.length>0?"pointer":"not-allowed"}}>
                  {generating?"EXPORTING...":`⊕ APPROVE & EXPORT`}
                </button>
                {approvedItems.length>0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,textAlign:"center",marginTop:4}}>{approvedItems.length} items · {fmt$(approvedItems.reduce((s,i)=>(i.totalLine||0)+s,0))}</div>}

                <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
                  {[
                    xlsxFile&&!xlsxIsBinary&&`↓ Pricing → ${xlsxFile.name}`,
                    "↓ Full ST1 Pricing Sheet (CSV)",
                  ].filter(Boolean).map(l=>(
                    <div key={l} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:B.muted,background:B.surface,padding:"4px 8px",borderRadius:3}}>Will export: {l}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* New RFP */}
          {phase!=="upload"&&phase!=="analyzing"&&(
            <div style={{padding:"10px 14px",borderBottom:`1px solid ${B.border}`}}>
              <button onClick={()=>{setPhase("upload");setPdfFiles([]);setXlsxFile(null);setXlsxText(null);setRfpMeta(null);setShippingRule(null);setItems([]);setCoverLetter("");setLog([]);setProgress(0);setApproved(false);}}
                style={{width:"100%",background:"none",border:`1px solid ${B.borderD}`,color:B.muted,borderRadius:4,padding:"7px",fontFamily:"'Lexend',sans-serif",fontSize:10}}>
                ↺ Start New RFP
              </button>
            </div>
          )}

          {/* Log */}
          <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
            <div style={{fontFamily:"'Lexend Zetta',sans-serif",fontSize:8,color:B.muted,letterSpacing:2,marginBottom:8}}>ACTIVITY LOG</div>
            {log.length===0&&<div style={{fontFamily:"'Lexend',sans-serif",fontSize:11,color:B.border}}>Log will appear here...</div>}
            {log.map(l=>(
              <div key={l.id} style={{fontFamily:"'Lexend',sans-serif",fontSize:10,color:logColor[l.type]||B.muted,lineHeight:1.9,borderBottom:`1px solid ${B.border}22`,padding:"1px 0"}}>
                <span style={{color:B.gray2,marginRight:4}}>{new Date(l.ts).toLocaleTimeString()}</span>{l.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}