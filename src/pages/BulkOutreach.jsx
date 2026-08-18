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
 *   3. Skips anything explicitly suppressed/do-not-work. Only rows with
 *      Channel=Email + a valid address + a written subject/body become an
 *      actual scheduled send — everything else still gets imported as a
 *      contact (so nothing from the sheet disappears) but is shown
 *      separately as "needs a different channel."
 *   4. Lets the rep add a 2nd/3rd follow-up email per lead (typed or
 *      AI-drafted) before anything is scheduled.
 *   5. On approval, builds one Campaign with a per-contact content
 *      override baked directly into each scheduledBatch (rather than one
 *      shared template) — nothing is generic, every send uses the exact
 *      subject/body written for that org — and schedules it via the same
 *      MT-business-hours-aware batching the Campaigns tab uses. Actual
 *      sending stays on the existing api/cron/send-batches.js cron; this
 *      page only ever writes a schedule, it never sends anything itself.
 */
import { useState, useMemo, useRef } from "react";

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
    const atThisTouch = sendable.filter(l => l.touches.length > t);
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

function Lbl({ children, c, s: sty }) { return <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: c || B.muted, letterSpacing: 1, ...sty }}>{children}</div>; }
function OBtn({ children, onClick, disabled, style: sty }) { return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? B.border : B.orange, color: disabled ? B.muted : B.white, border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .4, cursor: disabled ? "not-allowed" : "pointer", ...sty }}>{children}</button>; }
function GBtn({ children, onClick, disabled, style: sty }) { return <button onClick={onClick} disabled={disabled} style={{ background: B.white, color: B.textMid, border: `1px solid ${B.borderD}`, borderRadius: 5, padding: "7px 13px", fontSize: 11, fontFamily: "'Lexend',sans-serif", cursor: disabled ? "default" : "pointer", opacity: disabled ? .6 : 1, ...sty }}>{children}</button>; }

const CHANNEL_COLOR = { email: B.green, "contact form": B.blue, "social dm": B.purple, phone: B.yellow, "research needed": B.muted, suppressed: B.red };

export default function BulkOutreach({ s, dispatch, toast, cu }) {
  const [phase, setPhase] = useState("upload"); // upload | parsing | review | done
  const [fileName, setFileName] = useState("");
  const [leads, setLeads] = useState([]); // sendable + non-sendable, suppressed excluded
  const [campaignName, setCampaignName] = useState(`Bulk Outreach — ${today()}`);
  const [startDt, setStartDt] = useState(() => { const c = getMTComp(nextMTBizStart(Date.now())); return `${c.y}-${String(c.mo+1).padStart(2,"0")}-${String(c.d).padStart(2,"0")}T09:00`; });
  const [batchSize, setBatchSize] = useState(25);
  const [touchGapDays, setTouchGapDays] = useState(5);
  const [expandedId, setExpandedId] = useState(null);
  const [followupDraft, setFollowupDraft] = useState(null); // {leadId, subject, body}
  const [drafting, setDrafting] = useState(null); // leadId currently AI-drafting
  const [showSkipped, setShowSkipped] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef(null);

  const sendableLeads = useMemo(() => leads.filter(l => l.sendable && l.email), [leads]);
  const skippedLeads = useMemo(() => leads.filter(l => !(l.sendable && l.email)), [leads]);

  const startMs = useMemo(() => { try { return parseMTLocalStr(startDt); } catch { return nextMTBizStart(Date.now()); } }, [startDt]);
  const campIdRef = useRef(mkId());
  const preview = useMemo(
    () => buildOutreachSchedule(campIdRef.current, sendableLeads, { startMs, batchSize: Math.max(1, Number(batchSize) || 25), touchGapDays: Math.max(1, Number(touchGapDays) || 5) }),
    [sendableLeads, startMs, batchSize, touchGapDays]
  );

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
      setLeads(parsed);
      setPhase("review");
    } catch (err) {
      toast(`Import error: ${err.message}`, "error");
      setPhase("upload");
    }
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

  const approveAndSchedule = async () => {
    if (!sendableLeads.length) { toast("Nothing ready to schedule", "error"); return; }
    const totalTouches = sendableLeads.reduce((a, l) => a + l.touches.length, 0);
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
    // can't go through this table (it dedupes by email) and aren't
    // persisted anywhere past this session — they're still shown in the
    // "needs another channel" list below so nothing is silently lost while
    // reviewing, just not carried forward automatically.
    const emailLeads = leads.filter(l => l.email);
    const IMPORT_BATCH = 500;
    let importErr = null;
    for (let i = 0; i < emailLeads.length; i += IMPORT_BATCH) {
      const batch = emailLeads.slice(i, i + IMPORT_BATCH).map(l => ({
        email: l.email, firstName: l.firstName, lastName: l.lastName,
        school: l.orgName, sport: l.sport || "General", city: l.city,
        source: "brad", notes: l.whyNow || "", score: l.sendable ? 40 : 20,
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
    const enrollments = sendableLeads.map(l => ({ contactId: l.id, step: 0, status: "active", enrolledAt: nowStr, nextDate: nowStr, sentSteps: [] }));

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

    setCommitting(false);
    setPhase("done");
    toast(`Scheduled — ${sendableLeads.length} orgs, ${totalTouches} email(s)`, "success");
  };

  return (
    <div style={{ padding: "26px 34px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: B.text }}>Bulk Outreach — for Brad</div>
        <div style={{ fontSize: 12, color: B.muted, marginTop: 2 }}>Upload a cold-outreach spreadsheet, review the schedule, approve — Brad sends it from here.</div>
      </div>

      {phase === "upload" && (
        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: B.textMid, marginBottom: 18, lineHeight: 1.6 }}>
            Upload a research sheet like <b>ST1 Colorado Youth Sports Outreach</b> — one row per organization, with a written subject/message already drafted.<br/>
            Rows with a confirmed email get scheduled automatically. Anything needing a call, DM, or contact form is still imported as a contact but left for a human. Anything marked suppressed/do-not-work is skipped entirely.
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
          <OBtn onClick={() => fileRef.current?.click()} style={{ padding: "12px 28px", fontSize: 12 }}>⬆ UPLOAD SPREADSHEET</OBtn>
        </div>
      )}

      {phase === "parsing" && (
        <div style={{ textAlign: "center", padding: "60px 0", color: B.muted, fontSize: 13 }}>Reading {fileName}…</div>
      )}

      {(phase === "review" || phase === "done") && (
        <>
          {phase === "done" ? (
            <div style={{ background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 10, padding: "28px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: B.green, marginBottom: 8 }}>✓ Scheduled</div>
              <div style={{ fontSize: 13, color: B.textMid, marginBottom: 16 }}>"{campaignName}" is live in Campaigns — sends will go out automatically starting {fmtWhen(new Date(startMs).toISOString())}.</div>
              <GBtn onClick={() => { setPhase("upload"); setLeads([]); setFileName(""); campIdRef.current = mkId(); setExpandedId(null); }}>Upload another sheet</GBtn>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
                <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
                  <Lbl>READY TO EMAIL</Lbl>
                  <div style={{ fontSize: 24, fontWeight: 700, color: B.green, marginTop: 4 }}>{sendableLeads.length}</div>
                  <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>{sendableLeads.reduce((a, l) => a + l.touches.length, 0)} email(s) total</div>
                </div>
                <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
                  <Lbl>NEEDS ANOTHER CHANNEL</Lbl>
                  <div style={{ fontSize: 24, fontWeight: 700, color: B.yellow, marginTop: 4 }}>{skippedLeads.length}</div>
                  <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>imported as contacts, not auto-sent</div>
                </div>
                <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 220 }}>
                  <Lbl s={{ marginBottom: 5 }}>CAMPAIGN NAME</Lbl>
                  <input value={campaignName} onChange={e => setCampaignName(e.target.value)} style={{ width: "100%", background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 12, boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18, background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px" }}>
                <div>
                  <Lbl s={{ marginBottom: 4 }}>START (MOUNTAIN TIME)</Lbl>
                  <input type="datetime-local" value={startDt} onChange={e => setStartDt(e.target.value)} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
                </div>
                <div>
                  <Lbl s={{ marginBottom: 4 }}>MAX PER DAY</Lbl>
                  <input type="number" min={1} value={batchSize} onChange={e => setBatchSize(e.target.value)} style={{ width: 70, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
                </div>
                <div>
                  <Lbl s={{ marginBottom: 4 }}>DAYS BETWEEN FOLLOW-UPS</Lbl>
                  <input type="number" min={1} value={touchGapDays} onChange={e => setTouchGapDays(e.target.value)} style={{ width: 70, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11 }} />
                </div>
                <div style={{ fontSize: 11, color: B.muted, flex: 1, minWidth: 200 }}>Business hours only (Mon–Fri, 9am–5pm MT) — anything landing after hours rolls to the next morning automatically.</div>
              </div>

              <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
                {sendableLeads.map(lead => {
                  const isOpen = expandedId === lead.id;
                  const dates = preview.perLeadDates[lead.id] || [];
                  const canAddMore = lead.touches.length < 3;
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
                          <span style={{ fontSize: 10, color: B.textMid, fontWeight: 600 }}>{lead.touches.length} email{lead.touches.length !== 1 ? "s" : ""}</span>
                          <span style={{ color: B.muted, fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
                        </div>
                      </div>
                      {isOpen && (
                        <div style={{ padding: "4px 16px 16px" }}>
                          {lead.whyNow && <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>Why now: {lead.whyNow}</div>}
                          {lead.touches.map((t, i) => (
                            <div key={i} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                <span style={{ fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", color: B.orange, letterSpacing: .5 }}>EMAIL {i + 1}</span>
                                <span style={{ fontSize: 10, color: B.blue, fontWeight: 600 }}>Anticipated: {fmtWhen(dates[i])}</span>
                              </div>
                              <input value={t.subject} onChange={e => { const v = e.target.value; setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, touches: l.touches.map((tt, ti) => ti === i ? { ...tt, subject: v } : tt) } : l)); }}
                                style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontWeight: 600, marginBottom: 5, boxSizing: "border-box" }} />
                              <textarea value={t.body} onChange={e => { const v = e.target.value; setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, touches: l.touches.map((tt, ti) => ti === i ? { ...tt, body: v } : tt) } : l)); }}
                                rows={4} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 11, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }} />
                            </div>
                          ))}
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

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <GBtn onClick={() => { setPhase("upload"); setLeads([]); setFileName(""); }}>Cancel</GBtn>
                <OBtn onClick={approveAndSchedule} disabled={committing || !sendableLeads.length} style={{ padding: "10px 22px", fontSize: 12 }}>
                  {committing ? "SCHEDULING…" : "✓ APPROVE & SCHEDULE"}
                </OBtn>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
