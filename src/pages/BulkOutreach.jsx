/**
 * Bulk Outreach Upload — for Brad.
 *
 * Upload a cold-outreach spreadsheet (one row per organization, with a
 * pre-written subject/body already drafted per row, e.g. from a research
 * pass like "ST1 Colorado Youth Sports Outreach"). This page:
 *   1. Parses the sheet and finds the real header row (skipping title rows).
 *   2. Maps columns to fields — organization, sport, city, contact, email,
 *      channel, subject, body, why-now, priority, angle, action — via
 *      generous header-name matching, falling back to a cheap AI column-map
 *      call (same pattern as the contact-list importer) if that's not
 *      confident enough.
 *   3. Persists the upload as a durable OutreachBatch (api/outreach/batches)
 *      the moment it's parsed, and autosaves every edit — it's a real record
 *      you can leave and come back to, not client-only state that vanishes
 *      on reload. The landing view lists every past/current batch.
 *   4. Skips anything explicitly suppressed/do-not-work. Only rows with
 *      Channel=Email + a valid address + a written subject/body become an
 *      actual scheduled send — everything else still gets imported as a
 *      contact (so nothing from the sheet disappears) but is shown
 *      separately as "needs a different channel."
 *   5. Lets the rep add a 2nd/3rd follow-up email per lead (typed or
 *      AI-drafted) before anything is scheduled.
 *   5b. Every touch also gets its own "SEND NOW" button, right next to its
 *      editable subject/body — the rep can trigger any single email exactly
 *      when they want, from Brad's inbox, without ever leaving this page or
 *      touching the Campaigns tab. Sent touches are marked so they're never
 *      re-sent, whether the schedule below has been approved yet or not —
 *      approving afterward simply skips whatever's already gone out.
 *   6. On approval, builds one real Campaign with a per-contact content
 *      override baked directly into each scheduledBatch (rather than one
 *      shared template) — nothing is generic, every send uses the exact
 *      subject/body written for that org — and schedules it via the same
 *      MT-business-hours-aware batching the Campaigns tab uses, so it shows
 *      up there for tracking like any other campaign. Actual sending stays
 *      on the existing api/cron/send-batches.js cron; this page only ever
 *      writes a schedule, it never sends anything itself. The batch record
 *      is marked approved + linked to the campaign and kept around as history.
 */
import { useState, useEffect, useMemo, useRef } from "react";

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
  purple:"#7C3AED", purpleBg:"#F3EEFF",
  teal:"#0C7B6A", tealBg:"#E6F5F2",
};

const mkId = () => Math.random().toString(36).slice(2, 9);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

// ── MT-timezone business-hours helpers — same logic as the Campaigns tab's
// batch scheduler and api/cron/send-batches.js, kept local since this is a
// standalone page with no access to RevOps.jsx's module scope. ──
const addBusinessDays = (startMs, days) => { const dt = new Date(startMs); let added = 0; while (added < days) { dt.setDate(dt.getDate()+1); const wd = dt.getDay(); if (wd !== 0 && wd !== 6) added++; } return dt.getTime(); };
const getMTComp = (ms) => { const p = {}; new Intl.DateTimeFormat("en-US",{timeZone:"America/Denver",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(new Date(ms)).forEach(x=>{if(x.type!=="literal")p[x.type]=x.value;}); return { h:parseInt(p.hour)%24, wd:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(p.weekday), y:parseInt(p.year), mo:parseInt(p.month)-1, d:parseInt(p.day) }; };
const nextMTBizStart = (ms) => { for (let i=0;i<=7;i++){ const probe=ms+i*86400000; const {y,mo,d}=getMTComp(probe); for (const off of [6,7]) { const c=Date.UTC(y,mo,d,9+off,0,0); const ck=getMTComp(c); if (ck.h!==9||c<=ms) continue; if (ck.wd>=1&&ck.wd<=5) return c; } } return ms+86400000; };
const parseMTLocalStr = (localStr) => { const [dp,tp]=localStr.split("T"); const [yr,mo,da]=dp.split("-").map(Number); const [hr,mi]=(tp||"09:00").split(":").map(Number); for (const off of [6,7]) { const c=Date.UTC(yr,mo-1,da,hr+off,mi,0); if (getMTComp(c).h===hr) return c; } return Date.UTC(yr,mo-1,da,hr+6,mi,0); };

// ── Column detection ──
const FIELD_SYNONYMS = {
  orgName:     ["club / organization","club/organization","organization","club","account name","company"],
  sport:       ["sport"],
  city:        ["city / region","city/region","city","region"],
  contactName: ["contact name","contact","name"],
  email:       ["send to / contact","send to/contact","email","email address","contact email"],
  channel:     ["channel"],
  subject:     ["subject"],
  body:        ["message - copy & send","message","message body","email body","body"],
  whyNow:      ["why now (evidence)","why now","evidence","notes"],
  priority:    ["priority"],
  angle:       ["angle"],
  action:      ["action","status"],
};
const normHeader = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALL_SYNONYMS_NORM = new Set(Object.values(FIELD_SYNONYMS).flat().map(normHeader));

function detectColumns(headers) {
  const map = {};
  for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
    const normSyns = syns.map(normHeader);
    const hit = headers.find(h => normSyns.includes(normHeader(h)));
    if (hit) map[field] = hit;
  }
  return map;
}
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = aoa[i] || [];
    const hits = row.filter(c => ALL_SYNONYMS_NORM.has(normHeader(c))).length;
    if (hits >= 4) return i;
  }
  return -1;
}

const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
// Same guard as api/cron/send-batches.js — belt-and-suspenders against ever
// firing the literal unfilled-in placeholder copy as a real send.
const isPlaceholderCopy = text => /^\s*\(?personalized per organization\)?\s*$/i.test(String(text || ""));

// Resolves {{orgName}}/{{firstName}}/{{sport}} against one lead's fields —
// used only for a bulk-applied follow-up template, so what lands in each
// lead's touches is already the real, personalized text (same as every
// other touch in this tool), not a token that resolves later.
const mergeLeadTags = (text, lead) => (text || "")
  .replace(/\{\{\s*(orgName|organization|company|school)\s*\}\}/gi, lead.orgName || "your organization")
  .replace(/\{\{\s*firstName\s*\}\}/gi, (lead.contactName && lead.contactName !== "-") ? (lead.firstName || lead.contactName.split(" ")[0]) : "there")
  .replace(/\{\{\s*lastName\s*\}\}/gi, lead.lastName || "")
  .replace(/\{\{\s*contactName\s*\}\}/gi, (lead.contactName && lead.contactName !== "-") ? lead.contactName : "there")
  .replace(/\{\{\s*email\s*\}\}/gi, lead.email || "")
  .replace(/\{\{\s*city\s*\}\}/gi, lead.city || "")
  .replace(/\{\{\s*state\s*\}\}/gi, lead.state || "")
  .replace(/\{\{\s*sport\s*\}\}/gi, lead.sport || "sports");

async function aiCall(prompt, opts = {}) {
  const r = await fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: opts.model || "claude-haiku-4-5-20251001", max_tokens: opts.tokens || 500, messages: [{ role: "user", content: prompt }] }) });
  if (!r.ok) throw new Error(`AI error ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  if (opts.json) { try { const m = text.match(/[\[{][\s\S]*[\]}]/s); return m ? JSON.parse(m[0]) : null; } catch { return null; } }
  return text;
}

// Pure — same output given the same inputs, so the review screen's
// "anticipated send" preview and the actual commit both call this and
// always agree. Chunks each touch's eligible leads into batchSize-sized
// groups, one group per business day; touch N+1 starts touchGapDays business
// days after touch N started. Only leads that actually have content
// authored for touch index t are included at that step — a lead with only
// one email written simply never appears in touch 1/2's batches.
function buildOutreachSchedule(campId, leads, { startMs, batchSize, touchGapDays }) {
  const sendable = leads.filter(l => l.sendable && l.email);
  const maxTouches = Math.max(1, ...sendable.map(l => l.touches.length));
  const scheduledBatches = {};
  const perLeadDates = {};
  let currentMs = startMs;
  for (let t = 0; t < maxTouches; t++) {
    // A touch already fired via the per-lead "SEND NOW" button (l.touches[t].sentAt)
    // is excluded here so approving afterward never schedules a duplicate send.
    const atThisTouch = sendable.filter(l => l.touches.length > t && !l.touches[t].sentAt);
    if (!atThisTouch.length) continue;
    const touchStartMs = currentMs;
    for (let i = 0; i < atThisTouch.length; i += batchSize) {
      const chunk = atThisTouch.slice(i, i + batchSize);
      const bk = `${campId}-${t}-${chunk[0].id}`;
      const batchContacts = {};
      chunk.forEach(l => {
        const touch = l.touches[t];
        batchContacts[l.id] = {
          email: l.email,
          fullName: (l.contactName && l.contactName !== "-") ? l.contactName : l.orgName,
          firstName: l.firstName || "", lastName: l.lastName || "",
          school: l.orgName, sport: l.sport || "",
          // Per-contact content override — send-batches.js prefers these
          // over the campaign's shared touch template when present.
          __subject: touch.subject, __body: touch.body,
        };
        perLeadDates[l.id] = perLeadDates[l.id] || [];
        perLeadDates[l.id][t] = new Date(currentMs).toISOString();
      });
      scheduledBatches[bk] = { scheduledAt: new Date(currentMs).toISOString(), touchIdx: t, contactIds: chunk.map(l => l.id), batchContacts };
      currentMs = nextMTBizStart(currentMs);
    }
    if (t < maxTouches - 1) {
      currentMs = addBusinessDays(touchStartMs, touchGapDays);
      const gc = getMTComp(currentMs);
      if (gc.h < 9) { for (const off of [6, 7]) { const c = Date.UTC(gc.y, gc.mo, gc.d, 9 + off, 0, 0); if (getMTComp(c).h === 9) { currentMs = c; break; } } }
    }
  }
  return { scheduledBatches, perLeadDates };
}

function fmtWhen(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " MT";
}
function fmtDT(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Lbl({ children, c, s: sty }) { return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: c || B.muted, letterSpacing: 1, ...sty }}>{children}</div>; }
function OBtn({ children, onClick, disabled, style: sty }) { return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? B.border : B.orange, color: disabled ? B.muted : B.white, border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .4, cursor: disabled ? "not-allowed" : "pointer", ...sty }}>{children}</button>; }
function GBtn({ children, onClick, disabled, style: sty }) { return <button onClick={onClick} disabled={disabled} style={{ background: B.white, color: B.textMid, border: `1px solid ${B.borderD}`, borderRadius: 5, padding: "7px 13px", fontSize: 11, fontFamily: "'Lexend',sans-serif", cursor: disabled ? "default" : "pointer", opacity: disabled ? .6 : 1, ...sty }}>{children}</button>; }

const CHANNEL_COLOR = { email: B.green, "contact form": B.blue, "social dm": B.purple, phone: B.yellow, "research needed": B.muted, suppressed: B.red };
const STATUS_BADGE = {
  draft:    { bg: B.yellowBg, c: B.yellow, label: "DRAFT" },
  approved: { bg: B.greenBg,  c: B.green,  label: "APPROVED" },
};

export default function BulkOutreach({ s, dispatch, toast, cu, setMod }) {
  const [screen, setScreen] = useState("list"); // list | review
  const [batches, setBatches] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  const [batchId, setBatchId] = useState(null);
  const [linkedCampaignId, setLinkedCampaignId] = useState(null);
  const [batchStatus, setBatchStatus] = useState("draft");
  const [phase, setPhase] = useState("upload"); // upload | parsing | ready
  const [fileName, setFileName] = useState("");
  const [leads, setLeads] = useState([]); // sendable + non-sendable, suppressed excluded
  const [campaignName, setCampaignName] = useState(`Bulk Outreach — ${today()}`);
  const [startDt, setStartDt] = useState(() => { const c = getMTComp(nextMTBizStart(Date.now())); return `${c.y}-${String(c.mo+1).padStart(2,"0")}-${String(c.d).padStart(2,"0")}T09:00`; });
  const [batchSize, setBatchSize] = useState(25);
  const [touchGapDays, setTouchGapDays] = useState(5);
  const [expandedId, setExpandedId] = useState(null);
  const [followupDraft, setFollowupDraft] = useState(null); // {leadId, subject, body}
  const [drafting, setDrafting] = useState(null); // leadId currently AI-drafting
  const [bulkDraft, setBulkDraft] = useState(null); // {subject, body} — template applied to every eligible lead at once
  const [bulkDrafting, setBulkDrafting] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const [sendingKey, setSendingKey] = useState(null); // `${leadId}-${touchIdx}` currently sending
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  const skipNextSave = useRef(false);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/outreach/batches");
      const d = await r.json();
      setBatches(d.batches || []);
    } catch (e) { toast(`Couldn't load outreach batches: ${e.message}`, "error"); }
    setLoadingList(false);
  };
  useEffect(() => { loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const sendableLeads = useMemo(() => leads.filter(l => l.sendable && l.email), [leads]);
  const skippedLeads = useMemo(() => leads.filter(l => !(l.sendable && l.email)), [leads]);
  const bulkEligible = useMemo(() => sendableLeads.filter(l => l.touches.length < 3), [sendableLeads]);

  const startMs = useMemo(() => { try { return parseMTLocalStr(startDt); } catch { return nextMTBizStart(Date.now()); } }, [startDt]);
  const campIdRef = useRef(mkId());
  const preview = useMemo(
    () => buildOutreachSchedule(campIdRef.current, sendableLeads, { startMs, batchSize: Math.max(1, Number(batchSize) || 25), touchGapDays: Math.max(1, Number(touchGapDays) || 5) }),
    [sendableLeads, startMs, batchSize, touchGapDays]
  );

  // Autosave — any edit to leads or the schedule settings PATCHes the
  // durable batch record after a short pause, so nothing is lost on
  // navigation/reload and the mapping/edits are there next time this batch
  // is opened. Skipped for approved batches (their schedule is already
  // built and locked in) and right after loading/creating a batch (so
  // populating state from the server doesn't immediately re-save it).
  useEffect(() => {
    if (screen !== "review" || !batchId || batchStatus === "approved") return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: batchId, name: campaignName, leads, startDt, batchSize: Number(batchSize) || 25, touchGapDays: Number(touchGapDays) || 5 }) });
        setSaveStatus("saved");
      } catch (e) { setSaveStatus(null); toast(`Autosave failed: ${e.message}`, "error"); }
    }, 900);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, campaignName, startDt, batchSize, touchGapDays]);

  const openBatch = async (id) => {
    try {
      const r = await fetch(`/api/outreach/batches?id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!d.ok) { toast(d.error || "Couldn't load that batch", "error"); return; }
      const b = d.batch;
      skipNextSave.current = true;
      setBatchId(b.id);
      setBatchStatus(b.status);
      setLinkedCampaignId(b.campaignId || null);
      setCampaignName(b.name);
      setFileName(b.fileName || "");
      setLeads(b.leads || []);
      setStartDt(b.startDt || startDt);
      setBatchSize(b.batchSize || 25);
      setTouchGapDays(b.touchGapDays || 5);
      setPhase("ready");
      setExpandedId(null);
      setScreen("review");
    } catch (e) { toast(`Couldn't load batch: ${e.message}`, "error"); }
  };

  const startNewUpload = () => {
    setBatchId(null); setBatchStatus("draft"); setLinkedCampaignId(null); setLeads([]); setFileName("");
    setCampaignName(`Bulk Outreach — ${today()}`);
    campIdRef.current = mkId();
    setPhase("upload");
    setScreen("review");
  };

  const backToList = () => { setScreen("list"); loadList(); };

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    setFileName(file.name);
    setPhase("parsing");
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const preferredNames = ["work queue", "send now", "master"];
      const sheetName = wb.SheetNames.find(n => preferredNames.some(p => n.toLowerCase().includes(p))) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const headerRowIdx = findHeaderRow(aoa);
      if (headerRowIdx < 0) { toast("Could not find a header row (looking for columns like Organization, Email, Subject, Message) — check the file", "error"); setPhase("upload"); return; }
      const headers = (aoa[headerRowIdx] || []).map(h => String(h || "").trim());
      let colMap = detectColumns(headers);

      // Heuristic mapping missed something required — fall back to a cheap
      // AI header-map call rather than fail outright.
      if (!colMap.orgName || !colMap.email || !colMap.subject || !colMap.body) {
        try {
          const sampleRow = aoa[headerRowIdx + 1] || [];
          const sample = Object.fromEntries(headers.map((h, i) => [h, sampleRow[i]]));
          const ai = await aiCall(
`Map these spreadsheet column headers to fields for a cold-outreach import. Return ONLY JSON.
Headers: ${headers.join(" | ")}
Sample row: ${JSON.stringify(sample).slice(0, 1500)}
Map each header to one of: orgName, sport, city, contactName, email, channel, subject, body, whyNow, priority, angle, action
Return JSON: {"fieldName":"Exact Header As Written"}`,
            { json: true, tokens: 400 }
          );
          if (ai && typeof ai === "object") colMap = { ...ai, ...colMap };
        } catch {}
      }
      if (!colMap.orgName || !colMap.email) { toast("Couldn't find organization/email columns in this file", "error"); setPhase("upload"); return; }

      const idxOf = f => headers.indexOf(colMap[f]);
      const rows = aoa.slice(headerRowIdx + 1).filter(r => r.some(c => String(c || "").trim()));
      const get = (r, f) => { const i = idxOf(f); return i >= 0 ? String(r[i] ?? "").trim() : ""; };

      const parsed = rows.map(r => {
        const orgName = get(r, "orgName");
        if (!orgName) return null;
        const action = get(r, "action");
        const priority = get(r, "priority");
        if (/suppress/i.test(action) || /^skip$/i.test(priority)) return null; // Do Not Work — excluded entirely
        const channel = get(r, "channel") || "Unknown";
        const email = get(r, "email");
        const subject = get(r, "subject");
        const body = get(r, "body");
        const contactName = get(r, "contactName");
        const [firstName, ...lastParts] = (contactName && contactName !== "-") ? contactName.split(" ") : [""];
        const sendable = /email/i.test(channel) && isValidEmail(email) && !!subject.trim() && !!body.trim();
        return {
          id: mkId(), orgName, sport: get(r, "sport"), city: get(r, "city"),
          contactName, firstName: firstName || "", lastName: lastParts.join(" "),
          email: isValidEmail(email) ? email : "", channel, angle: get(r, "angle"), priority,
          action, whyNow: get(r, "whyNow"),
          touches: sendable ? [{ subject, body }] : [],
          sendable,
        };
      }).filter(Boolean);

      if (!parsed.length) { toast("No usable rows found in this file", "error"); setPhase("upload"); return; }

      const autoName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const nm = autoName || `Bulk Outreach — ${today()}`;
      const createRes = await fetch("/api/outreach/batches", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, fileName: file.name, columnMap: colMap, leads: parsed, startDt, batchSize, touchGapDays, createdBy: cu?.name || "" }) });
      const created = await createRes.json();
      if (!created.ok) { toast(created.error || "Couldn't save this upload", "error"); setPhase("upload"); return; }

      skipNextSave.current = true;
      setBatchId(created.batch.id);
      setBatchStatus("draft");
      setCampaignName(nm);
      setLeads(parsed);
      setPhase("ready");
    } catch (err) {
      toast(`Import error: ${err.message}`, "error");
      setPhase("upload");
    }
  };

  // Whether touch i for this lead has already gone out — either manually
  // (touch.sentAt, set right below) or automatically once this batch is
  // approved and the send-batches cron has claimed it (enroll.sentSteps).
  // Checked before showing SEND NOW so a touch the cron already fired can
  // never be double-sent from here.
  const touchSentInfo = (lead, i) => {
    if (lead.touches[i]?.sentAt) return { sent: true, when: lead.touches[i].sentAt };
    if (linkedCampaignId) {
      const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
      const enroll = camp?.enrollments?.find(e => e.contactId === lead.id);
      if (enroll?.sentSteps?.includes(i)) return { sent: true, when: null };
    }
    return { sent: false };
  };

  // Sends this exact touch right now, from Brad's inbox, bypassing the
  // scheduled batch entirely — for when the rep wants to trigger a specific
  // email themselves rather than wait on the cron. Goes through the same
  // api/agents/brad-send endpoint (and its own BRAD_SENDING_ENABLED gate) as
  // every other Brad send, so there's exactly one code path that can put an
  // email in Brad's outbox as Brad.
  const sendTouchNow = async (lead, touchIdx) => {
    const touch = lead.touches[touchIdx];
    if (!touch || touchSentInfo(lead, touchIdx).sent) return;
    if (!lead.email) { toast("No email address for this contact", "error"); return; }
    if (!touch.subject.trim() || !touch.body.trim() || isPlaceholderCopy(touch.body)) {
      toast("Write a real subject and body for this email first", "error"); return;
    }
    if (!window.confirm(`Send this exact email now, from brad@shopst1sports.com?\n\nTo: ${lead.email}\nSubject: ${touch.subject}\n\n${touch.body}`)) return;

    const key = `${lead.id}-${touchIdx}`;
    setSendingKey(key);
    try {
      const r = await fetch("/api/agents/brad-send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactEmail: lead.email,
          contactName: (lead.contactName && lead.contactName !== "-") ? lead.contactName : lead.orgName,
          subject: touch.subject, body: touch.body, contactId: lead.id,
        }),
      });
      const d = await r.json();
      if (!d.ok || !d.sent) { toast(d.error || "Send failed", "error"); setSendingKey(null); return; }

      const sentAt = new Date().toISOString();
      const updatedLeads = leads.map(l => l.id === lead.id ? { ...l, touches: l.touches.map((t, i) => i === touchIdx ? { ...t, sentAt } : t) } : l);
      setLeads(updatedLeads);

      // Persist the sentAt marker to the durable batch record right away —
      // the debounced autosave effect above deliberately skips approved
      // batches (their schedule is locked), so without this explicit PATCH
      // a manual send after approval would only mark "sent" in this one
      // browser's local state and vanish on reload or from another device.
      try {
        await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: batchId, leads: updatedLeads }) });
      } catch (e) { toast(`Sent, but couldn't save the sent status: ${e.message}`, "info"); }

      // If this batch is already approved, the campaign this touch belongs
      // to already exists with its own enrollment/scheduledBatches — advance
      // that enrollment the same way the cron would have, so its next tick
      // sees this step as done and skips it instead of sending it again.
      if (linkedCampaignId) {
        const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
        if (camp) {
          const nextStep = touchIdx + 1;
          const doneAllTouches = nextStep >= (camp.touches || []).length;
          const dateStr = sentAt.slice(0, 10);
          dispatch("UPDATE_CAMPAIGN", {
            id: camp.id,
            enrollments: (camp.enrollments || []).map(en => {
              if (en.contactId !== lead.id) return en;
              const sentSteps = [...new Set([...(en.sentSteps || []), touchIdx])];
              return en.step === touchIdx
                ? { ...en, sentSteps, step: nextStep, status: doneAllTouches ? "done" : en.status, lastContacted: dateStr, lastSentAt: dateStr }
                : { ...en, sentSteps };
            }),
          });
        }
      }

      toast(`Sent to ${lead.email}`, "success");
    } catch (e) {
      toast(`Send failed: ${e.message}`, "error");
    }
    setSendingKey(null);
  };

  const addFollowup = (leadId, subject, body) => {
    if (!subject.trim() || !body.trim()) { toast("Write a subject and body first", "error"); return; }
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, touches: [...l.touches, { subject: subject.trim(), body: body.trim() }] } : l));
    setFollowupDraft(null);
    toast("Follow-up added", "success");
  };

  const draftFollowupWithAI = async (lead) => {
    setDrafting(lead.id);
    try {
      const prevTouch = lead.touches[lead.touches.length - 1];
      const text = await aiCall(
`Write follow-up email #${lead.touches.length + 1} from Brad at ST1 Sports to ${lead.contactName && lead.contactName !== "-" ? lead.contactName : "the team"} at ${lead.orgName} (${lead.sport || "youth sports"}). This follows an earlier email that got no reply — reference it briefly, don't repeat it, and add one new, specific reason to reply.
Evidence/context: ${lead.whyNow || "none given"}
Earlier email:
${prevTouch.body}

Under 70 words. Brand voice: direct, warm, athlete-aware, no "just checking in" filler. Reply as exactly:
Subject: <subject line>

<body>`,
        { tokens: 400 }
      );
      const lines = text.split("\n");
      const subjLine = lines.find(l => /^subject:/i.test(l)) || "";
      const subject = subjLine.replace(/^subject:\s*/i, "").trim();
      const body = lines.slice(lines.indexOf(subjLine) + 1).join("\n").replace(/^\s+/, "").trim();
      setFollowupDraft({ leadId: lead.id, subject: subject || `Following up — ${lead.orgName}`, body: body || text.trim() });
    } catch (e) {
      toast(`AI draft failed: ${e.message}`, "error");
      setFollowupDraft({ leadId: lead.id, subject: "", body: "" });
    }
    setDrafting(null);
  };

  // Adds the same follow-up (with {{orgName}}/{{firstName}}/{{sport}}
  // resolved per lead) to every sendable lead that has room for one more —
  // one click instead of opening all 67 leads one by one. Leads already at
  // the 3-email cap are skipped; everyone else gets it as their next touch,
  // so this works even if some leads already have a 2nd email and others
  // don't.
  const applyBulkFollowup = (subject, body) => {
    if (!subject.trim() || !body.trim()) { toast("Write a subject and body first", "error"); return; }
    // Count from bulkEligible (already known) rather than inside the
    // setLeads updater — that callback runs during React's next render,
    // not synchronously here, so a counter incremented inside it would
    // still read 0 by the time the toast below fires.
    const applied = bulkEligible.length;
    setLeads(prev => prev.map(l => {
      if (!(l.sendable && l.email) || l.touches.length >= 3) return l;
      return { ...l, touches: [...l.touches, { subject: mergeLeadTags(subject, l).trim(), body: mergeLeadTags(body, l).trim() }] };
    }));
    setBulkDraft(null);
    toast(`Follow-up added to ${applied} organization${applied !== 1 ? "s" : ""}`, "success");
  };

  const draftBulkFollowupWithAI = async () => {
    setBulkDrafting(true);
    try {
      const text = await aiCall(
`Write a follow-up email template for email #2 (or later) in a cold outreach sequence from Brad at ST1 Sports, pitching branded team stores to youth sports clubs. This follows an earlier, unanswered first email — reference that briefly without repeating it, and give one new, general reason to reply (not tied to one specific club).
Use the literal token {{orgName}} wherever the organization's name belongs, and {{firstName}} for the contact's name if there's a natural spot for it — leave both exactly as written, they get filled in per-recipient after this is applied.
Under 60 words. Brand voice: direct, warm, athlete-aware, no "just checking in" filler. Reply as exactly:
Subject: <subject line, may include {{orgName}}>

<body>`,
        { tokens: 350 }
      );
      const lines = text.split("\n");
      const subjLine = lines.find(l => /^subject:/i.test(l)) || "";
      const subject = subjLine.replace(/^subject:\s*/i, "").trim();
      const body = lines.slice(lines.indexOf(subjLine) + 1).join("\n").replace(/^\s+/, "").trim();
      setBulkDraft({ subject: subject || "Following up — {{orgName}}", body: body || text.trim() });
    } catch (e) {
      toast(`AI draft failed: ${e.message}`, "error");
      setBulkDraft({ subject: "", body: "" });
    }
    setBulkDrafting(false);
  };

  const approveAndSchedule = async () => {
    if (!sendableLeads.length) { toast("Nothing ready to schedule", "error"); return; }
    // Excludes touches already fired via SEND NOW — those aren't being
    // scheduled again, so they shouldn't count toward what this confirms.
    const totalTouches = sendableLeads.reduce((a, l) => a + l.touches.filter(t => !t.sentAt).length, 0);
    if (!totalTouches) { toast("Everything here has already been sent manually — nothing left to schedule", "error"); return; }
    if (!window.confirm(`Schedule ${totalTouches} email(s) across ${sendableLeads.length} organization(s), starting ${fmtWhen(new Date(startMs).toISOString())}?\n\nSends happen automatically from here via the existing send-batches cron — nothing further to do once approved.`)) return;

    setCommitting(true);
    const campId = campIdRef.current;
    const nowStr = today();

    // Contacts go through the same durable cold-prospect import used by
    // Prospecting's list uploads (POST /api/contacts/import → Prisma
    // salesContact, deduped by email) — NOT dispatch("ADD_CONTACTS", ...).
    // The app's own dispatch wrapper deliberately strips `contacts` out of
    // every state autosave it triggers (contacts are meant to live in that
    // table, not the app_state JSON blob), so anything added only via
    // dispatch would be silently wiped by the very next unrelated action.
    // Leads with no usable email at all (pure contact-form/DM/call rows)
    // can't go through this table (it dedupes by email) — they're durable
    // in this batch record either way (that's the whole point of storing
    // it), they just don't get a Prospecting contact created for them.
    const emailLeads = leads.filter(l => l.email);
    const IMPORT_BATCH = 500;
    let importErr = null;
    for (let i = 0; i < emailLeads.length; i += IMPORT_BATCH) {
      const batch = emailLeads.slice(i, i + IMPORT_BATCH).map(l => ({
        email: l.email, firstName: l.firstName, lastName: l.lastName,
        school: l.orgName, sport: l.sport || "General", city: l.city,
        source: "brad", notes: l.whyNow || "", score: l.sendable ? 40 : 20,
        channel: l.channel, priority: l.priority, angle: l.angle, action: l.action,
        whyNow: l.whyNow, campaignName,
        bradSubject: l.touches?.[0]?.subject || "",
        bradBody: l.touches?.[0]?.body || "",
        allTouches: l.touches || [],
      }));
      try {
        await fetch("/api/contacts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: batch }) });
      } catch (e) { importErr = e.message; }
    }
    if (importErr) toast(`Contacts saved partially — import error: ${importErr}`, "info");

    const { scheduledBatches } = buildOutreachSchedule(campId, sendableLeads, { startMs, batchSize: Math.max(1, Number(batchSize) || 25), touchGapDays: Math.max(1, Number(touchGapDays) || 5) });
    const maxTouches = Math.max(1, ...sendableLeads.map(l => l.touches.length));
    const touches = Array.from({ length: maxTouches }, (_, i) => ({ id: mkId(), step: i, dayOffset: i * (Number(touchGapDays) || 5), subject: "(personalized per organization)", body: "(personalized per organization)", channel: "email" }));
    // Enrollments/batches are fully self-contained (batchContacts embeds
    // every field the cron needs, including __subject/__body) — they don't
    // depend on state.contacts at all, so this works whether or not the
    // /api/contacts/import call above succeeded.
    // A lead may already have one or more touches sent manually via SEND NOW
    // before approval — start its enrollment past those steps (and record
    // them in sentSteps) so the cron never re-sends what already went out.
    const enrollments = sendableLeads.map(l => {
      const sentSteps = l.touches.map((t, i) => t.sentAt ? i : -1).filter(i => i >= 0);
      const firstUnsent = l.touches.findIndex(t => !t.sentAt);
      const allSent = firstUnsent === -1;
      return { contactId: l.id, step: allSent ? l.touches.length : firstUnsent, status: allSent ? "done" : "active", enrolledAt: nowStr, nextDate: nowStr, sentSteps };
    });

    const campaign = {
      id: campId, name: campaignName.trim() || `Bulk Outreach — ${nowStr}`,
      product: "Team Stores", audience: "Bulk import", source: "bulk-import",
      fromBrad: true, // send-batches.js sends as brad@shopst1sports.com when set
      repId: "", startDate: nowStr, touches, enrollments,
      scheduledBatches, sentBatches: {},
      batchSize: Math.max(1, Number(batchSize) || 25),
      status: "running", createdAt: nowStr,
      leadMeta: Object.fromEntries(sendableLeads.map(l => [l.id, { orgName: l.orgName, angle: l.angle, priority: l.priority, whyNow: l.whyNow }])),
    };
    dispatch("ADD_CAMPAIGN", campaign);
    dispatch("LOG", { msg: `${cu?.name || "Someone"} scheduled bulk outreach "${campaign.name}" — ${sendableLeads.length} orgs, ${totalTouches} email(s) total` });

    // Lock the batch record in as approved and link it to the campaign, so
    // it shows up as history rather than an editable draft from here on.
    try {
      await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: batchId, status: "approved", campaignId: campId, leads, name: campaignName, startDt, batchSize: Number(batchSize) || 25, touchGapDays: Number(touchGapDays) || 5 }) });
    } catch (e) { toast(`Scheduled, but couldn't mark the batch approved: ${e.message}`, "info"); }

    setBatchStatus("approved");
    setLinkedCampaignId(campId);
    setCommitting(false);
    toast(`Scheduled — ${sendableLeads.length} orgs, ${totalTouches} email(s)`, "success");
  };

  // Lands on the exact campaign's Execute tab in Prospecting > Campaigns,
  // not just the Prospecting tab in general — ModMarketing (the Campaigns
  // view) is a separate component with its own local selCampId/campSubTab
  // state, so getting there means going through the same global nav-signal
  // pattern the rest of the app already uses for this (SET_PROSPECTING_NAV
  // to switch ModProspecting's own view to "campaigns", SET_CAMPAIGN_NAV so
  // ModMarketing picks the right campaign once it mounts).
  const goToCampaigns = () => {
    if (!setMod) return;
    if (linkedCampaignId) dispatch("SET_CAMPAIGN_NAV", linkedCampaignId);
    dispatch("SET_PROSPECTING_NAV", "campaigns");
    setMod("prospecting");
  };

  const isApproved = batchStatus === "approved";

  return (
    <div style={{ padding: "26px 34px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: B.text }}>Bulk Outreach — for Brad</div>
          <div style={{ fontSize: 12, color: B.muted, marginTop: 2 }}>Upload a cold-outreach spreadsheet, review the schedule, approve — Brad sends it from here.</div>
        </div>
        {screen === "review" && <GBtn onClick={backToList}>← Back to all uploads</GBtn>}
      </div>

      {screen === "list" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <OBtn onClick={startNewUpload} style={{ padding: "10px 20px", fontSize: 12 }}>⬆ UPLOAD NEW SHEET</OBtn>
          </div>
          {loadingList ? (
            <div style={{ textAlign: "center", padding: "50px 0", color: B.muted, fontSize: 13 }}>Loading…</div>
          ) : batches.length === 0 ? (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: B.textMid, lineHeight: 1.6 }}>No uploads yet. Upload a research sheet like <b>ST1 Colorado Youth Sports Outreach</b> — one row per organization, with a written subject/message already drafted — and Brad takes it from there.</div>
            </div>
          ) : (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden" }}>
              {batches.map(b => {
                const badge = STATUS_BADGE[b.status] || STATUS_BADGE.draft;
                return (
                  <div key={b.id} onClick={() => openBatch(b.id)} style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: `1px solid ${B.border}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{b.name}</span>
                        <span style={{ fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", color: badge.c, background: badge.bg, padding: "2px 7px", borderRadius: 8, letterSpacing: .5 }}>{badge.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>{b.sendableCount} ready · {b.touchCount} email(s) · {b.totalCount} total rows · updated {fmtDT(b.updatedAt)}</div>
                    </div>
                    <span style={{ color: B.muted, fontSize: 13, flexShrink: 0 }}>→</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {screen === "review" && phase === "upload" && (
        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: B.textMid, marginBottom: 18, lineHeight: 1.6 }}>
            Upload a research sheet like <b>ST1 Colorado Youth Sports Outreach</b> — one row per organization, with a written subject/message already drafted.<br/>
            Rows with a confirmed email get scheduled automatically. Anything needing a call, DM, or contact form is still saved but left for a human. Anything marked suppressed/do-not-work is skipped entirely.
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
          <OBtn onClick={() => fileRef.current?.click()} style={{ padding: "12px 28px", fontSize: 12 }}>⬆ UPLOAD SPREADSHEET</OBtn>
        </div>
      )}

      {screen === "review" && phase === "parsing" && (
        <div style={{ textAlign: "center", padding: "60px 0", color: B.muted, fontSize: 13 }}>Reading {fileName}…</div>
      )}

      {screen === "review" && phase === "ready" && (
        <>
          {isApproved && (
            <div style={{ background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 12, color: B.textMid }}><b style={{ color: B.green }}>✓ Approved</b> — this schedule is locked in and running. Editing here won't change what's already scheduled.</div>
              {setMod && <GBtn onClick={goToCampaigns} style={{ fontSize: 10 }}>View in Campaigns →</GBtn>}
            </div>
          )}

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl>READY TO EMAIL</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.green, marginTop: 4 }}>{sendableLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>{sendableLeads.reduce((a, l) => a + l.touches.length, 0)} email(s) total</div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl>NEEDS ANOTHER CHANNEL</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.yellow, marginTop: 4 }}>{skippedLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>saved here, not auto-sent</div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <Lbl>CAMPAIGN NAME</Lbl>
                {!isApproved && saveStatus && <span style={{ fontSize: 9, color: saveStatus === "saving" ? B.muted : B.green, fontFamily: "'Lexend',sans-serif" }}>{saveStatus === "saving" ? "Saving…" : "✓ Saved"}</span>}
              </div>
              <input value={campaignName} onChange={e => setCampaignName(e.target.value)} disabled={isApproved} style={{ width: "100%", background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 12, boxSizing: "border-box" }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18, background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px" }}>
            <div>
              <Lbl s={{ marginBottom: 4 }}>START (MOUNTAIN TIME)</Lbl>
              <input type="datetime-local" value={startDt} onChange={e => setStartDt(e.target.value)} disabled={isApproved} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
            </div>
            <div>
              <Lbl s={{ marginBottom: 4 }}>MAX PER DAY</Lbl>
              <input type="number" min={1} value={batchSize} onChange={e => setBatchSize(e.target.value)} disabled={isApproved} style={{ width: 70, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
            </div>
            <div>
              <Lbl s={{ marginBottom: 4 }}>DAYS BETWEEN FOLLOW-UPS</Lbl>
              <input type="number" min={1} value={touchGapDays} onChange={e => setTouchGapDays(e.target.value)} disabled={isApproved} style={{ width: 70, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
            </div>
            <div style={{ fontSize: 11, color: B.muted, flex: 1, minWidth: 200 }}>Business hours only (Mon–Fri, 9am–5pm MT) — anything landing after hours rolls to the next morning automatically.</div>
          </div>

          {!isApproved && bulkEligible.length > 0 && (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              {bulkDraft ? (
                <div style={{ background: B.orangeBg, border: `1px solid ${B.orange}30`, borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", color: B.orange, letterSpacing: .5, marginBottom: 6 }}>FOLLOW-UP FOR ALL {bulkEligible.length} ELIGIBLE ORGANIZATIONS</div>
                  <div style={{ fontSize: 10, color: B.muted, marginBottom: 6 }}>Use <code>{"{{orgName}}"}</code>, <code>{"{{firstName}}"}</code>, <code>{"{{sport}}"}</code> — each gets filled in per organization before it's added.</div>
                  <input value={bulkDraft.subject} onChange={e => setBulkDraft(d => ({ ...d, subject: e.target.value }))} placeholder="Subject" style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontWeight: 600, marginBottom: 5, boxSizing: "border-box" }} />
                  <textarea value={bulkDraft.body} onChange={e => setBulkDraft(d => ({ ...d, body: e.target.value }))} placeholder="Body" rows={4} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11, lineHeight: 1.6, resize: "vertical", marginBottom: 6, boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <OBtn onClick={() => applyBulkFollowup(bulkDraft.subject, bulkDraft.body)} style={{ fontSize: 9, padding: "6px 12px" }}>ADD TO ALL {bulkEligible.length}</OBtn>
                    <GBtn onClick={() => setBulkDraft(null)} style={{ fontSize: 9, padding: "6px 12px" }}>CANCEL</GBtn>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontSize: 11, color: B.textMid }}>Add one follow-up email to all {bulkEligible.length} organization{bulkEligible.length !== 1 ? "s" : ""} at once, instead of one by one.</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <GBtn onClick={() => setBulkDraft({ subject: "", body: "" })} style={{ fontSize: 9, padding: "6px 12px" }}>+ ADD FOLLOW-UP TO ALL</GBtn>
                    <GBtn onClick={draftBulkFollowupWithAI} disabled={bulkDrafting} style={{ fontSize: 9, padding: "6px 12px" }}>{bulkDrafting ? "DRAFTING…" : "✦ AI DRAFT FOR ALL"}</GBtn>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
            {sendableLeads.map(lead => {
              const isOpen = expandedId === lead.id;
              const dates = preview.perLeadDates[lead.id] || [];
              const canAddMore = lead.touches.length < 3 && !isApproved;
              const draftHere = followupDraft?.leadId === lead.id;
              return (
                <div key={lead.id} style={{ borderBottom: `1px solid ${B.border}` }}>
                  <div onClick={() => setExpandedId(isOpen ? null : lead.id)} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: isOpen ? B.surface : B.white }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{lead.orgName}</div>
                      <div style={{ fontSize: 11, color: B.muted, marginTop: 1 }}>{lead.contactName && lead.contactName !== "-" ? lead.contactName + " · " : ""}{lead.email}{lead.sport ? ` · ${lead.sport}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {lead.angle && <span style={{ fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", color: B.purple, background: B.purpleBg, padding: "3px 8px", borderRadius: 10 }}>{lead.angle}</span>}
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }} onClick={e => e.stopPropagation()}>
                        {lead.touches.map((t, i) => {
                          const sentInfo = touchSentInfo(lead, i);
                          const sendKey = `${lead.id}-${i}`;
                          if (sentInfo.sent) return <span key={i} title={sentInfo.when ? `Sent ${fmtWhen(sentInfo.when)}` : "Sent"} style={{ fontSize: 9, color: B.green, fontWeight: 700 }}>✓{i + 1}</span>;
                          return (
                            <button key={i} onClick={() => sendTouchNow(lead, i)} disabled={sendingKey === sendKey || !t.subject.trim() || !t.body.trim()}
                              title={`Send email ${i + 1} now, from Brad`}
                              style={{ background: sendingKey === sendKey ? B.border : B.orangeBg, color: sendingKey === sendKey ? B.muted : B.orange, border: `1px solid ${B.orange}30`, borderRadius: 4, padding: "3px 8px", fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .3, cursor: sendingKey === sendKey ? "wait" : "pointer" }}>
                              {sendingKey === sendKey ? "…" : `SEND ${i + 1}`}
                            </button>
                          );
                        })}
                      </div>
                      <span style={{ fontSize: 10, color: B.textMid, fontWeight: 600 }}>{lead.touches.length} email{lead.touches.length !== 1 ? "s" : ""}</span>
                      <span style={{ color: B.muted, fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "4px 16px 16px" }}>
                      {lead.whyNow && <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>Why now: {lead.whyNow}</div>}
                      {lead.touches.map((t, i) => {
                        const sentInfo = touchSentInfo(lead, i);
                        const sendKey = `${lead.id}-${i}`;
                        return (
                        <div key={i} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", color: B.orange, letterSpacing: .5 }}>EMAIL {i + 1}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 10, color: B.blue, fontWeight: 600 }}>Anticipated: {fmtWhen(dates[i])}</span>
                              {i > 0 && !isApproved && !sentInfo.sent && (
                                <button onClick={() => setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, touches: l.touches.filter((_, ti) => ti !== i) } : l))}
                                  title="Remove this email" style={{ background: "none", border: "none", color: B.red, fontSize: 11, cursor: "pointer", padding: 0 }}>✕</button>
                              )}
                            </div>
                          </div>
                          <input value={t.subject} disabled={isApproved || sentInfo.sent} onChange={e => { const v = e.target.value; setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, touches: l.touches.map((tt, ti) => ti === i ? { ...tt, subject: v } : tt) } : l)); }}
                            style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontWeight: 600, marginBottom: 5, boxSizing: "border-box" }} />
                          <textarea value={t.body} disabled={isApproved || sentInfo.sent} onChange={e => { const v = e.target.value; setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, touches: l.touches.map((tt, ti) => ti === i ? { ...tt, body: v } : tt) } : l)); }}
                            rows={4} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }} />
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 7 }}>
                            {sentInfo.sent ? (
                              <span style={{ fontSize: 10, color: B.green, fontWeight: 600 }}>✓ Sent{sentInfo.when ? ` ${fmtWhen(sentInfo.when)}` : ""}</span>
                            ) : (
                              <OBtn onClick={() => sendTouchNow(lead, i)} disabled={sendingKey === sendKey || !t.subject.trim() || !t.body.trim()} style={{ fontSize: 9, padding: "6px 12px" }}>
                                {sendingKey === sendKey ? "SENDING…" : "✉ SEND NOW — FROM BRAD"}
                              </OBtn>
                            )}
                          </div>
                        </div>
                        );
                      })}
                      {draftHere ? (
                        <div style={{ background: B.orangeBg, border: `1px solid ${B.orange}30`, borderRadius: 6, padding: 10 }}>
                          <div style={{ fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", color: B.orange, letterSpacing: .5, marginBottom: 6 }}>NEW FOLLOW-UP — EMAIL {lead.touches.length + 1}</div>
                          <input value={followupDraft.subject} onChange={e => setFollowupDraft(d => ({ ...d, subject: e.target.value }))} placeholder="Subject" style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontWeight: 600, marginBottom: 5, boxSizing: "border-box" }} />
                          <textarea value={followupDraft.body} onChange={e => setFollowupDraft(d => ({ ...d, body: e.target.value }))} placeholder="Body" rows={4} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11, lineHeight: 1.6, resize: "vertical", marginBottom: 6, boxSizing: "border-box" }} />
                          <div style={{ display: "flex", gap: 6 }}>
                            <OBtn onClick={() => addFollowup(lead.id, followupDraft.subject, followupDraft.body)} style={{ fontSize: 9, padding: "6px 12px" }}>ADD</OBtn>
                            <GBtn onClick={() => setFollowupDraft(null)} style={{ fontSize: 9, padding: "6px 12px" }}>CANCEL</GBtn>
                          </div>
                        </div>
                      ) : canAddMore && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <GBtn onClick={() => setFollowupDraft({ leadId: lead.id, subject: "", body: "" })} style={{ fontSize: 9, padding: "6px 12px" }}>+ ADD FOLLOW-UP EMAIL</GBtn>
                          <GBtn onClick={() => draftFollowupWithAI(lead)} disabled={drafting === lead.id} style={{ fontSize: 9, padding: "6px 12px" }}>{drafting === lead.id ? "DRAFTING…" : "✦ AI DRAFT FOLLOW-UP"}</GBtn>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {skippedLeads.length > 0 && (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 18 }}>
              <button onClick={() => setShowSkipped(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: B.textMid, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                {skippedLeads.length} organization{skippedLeads.length !== 1 ? "s" : ""} need a different channel — {showSkipped ? "hide" : "show"}
              </button>
              {showSkipped && (
                <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
                  {skippedLeads.map(l => (
                    <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${B.border}` }}>
                      <div style={{ fontSize: 11, color: B.text }}>{l.orgName}</div>
                      <span style={{ fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", color: CHANNEL_COLOR[l.channel?.toLowerCase()] || B.muted }}>{l.action || l.channel}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isApproved && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <GBtn onClick={backToList}>Save for later</GBtn>
              <OBtn onClick={approveAndSchedule} disabled={committing || !sendableLeads.length} style={{ padding: "10px 22px", fontSize: 12 }}>
                {committing ? "SCHEDULING…" : "✓ APPROVE & SCHEDULE"}
              </OBtn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
