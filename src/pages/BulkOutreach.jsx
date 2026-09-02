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
 *   5c. An EMAIL STEPS panel at the top (Email 1/2/3) lets the rep edit one
 *      step's copy once and push it to every organization still pending at
 *      that step in one click — a deliberate mass overwrite, not a
 *      fill-the-gaps template, so it also covers already-personalized or
 *      hand-edited copy. "CHECK BRAD'S INBOX" cross-checks Brad's real
 *      Gmail: recovers sends this page doesn't already know about, and
 *      scans for bounce notifications — a bounced lead is flagged, opted
 *      out (mirrored into the shared contacts table + Zoho), and pulled
 *      from every future send until its email is fixed.
 *   6. On approval, builds one real Campaign with a per-contact content
 *      override baked directly into each scheduledBatch (rather than one
 *      shared template) — nothing is generic, every send uses the exact
 *      subject/body written for that org — and schedules it via the same
 *      MT-business-hours-aware batching the Campaigns tab uses, so it shows
 *      up there for tracking like any other campaign. GO on this page can
 *      fire remaining Day 1 emails now (or one every 15 seconds) via
 *      api/agents/brad-send; later touches still use the cron. The batch
 *      record is marked approved + linked to the campaign and kept as history.
 *   7. First Active/Approved upload owns each email. Later lists mark those
 *      people heldForEarlier and drop them from Ready so they are not sent twice.
 *   8. A person can be marked Positive Intent (they engaged — no Email 2/3)
 *      or Manual Follow-up (we know them / will handle it). Both stay on the
 *      list as history but drop off GO, Send now, and the cron.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { applyLeadOutcome, leadStoppedAuto } from "../../api/_lib/outreachSent.js";

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
// Some sheets carry all three emails per row instead of one — separate
// numbered columns like "Email 1 Subject"/"Email 1 Body", "Email 2
// Subject"/"Email 2 Body", "Email 3 Subject"/"Email 3 Body" (also matches
// "Subject 1"/"Body 1", "Touch 2 Subject", "Follow-up 3 Body", etc., after
// header normalization strips spaces/punctuation). Returns up to 3
// {subject, body} header-name pairs in order, stopping at the first gap —
// when found, these take over from the single bare subject/body columns
// FIELD_SYNONYMS looks for, since a full 3-touch sequence is already
// written into the sheet rather than needing to be authored afterward.
// bareSubject/bareBody (from the plain FIELD_SYNONYMS match, if any) cover
// a very common mixed style: the first email sits in an unnumbered
// "Subject"/"Body" pair (it's the one that was actually researched) while
// only the follow-ups get numbered headers — without this, a sheet like
// that would only ever match starting at "2", find no "1", and return
// nothing at all.
function detectTouchColumns(headers, bareSubject, bareBody) {
  const normed = headers.map(h => ({ raw: h, n: normHeader(h) }));
  const find = patterns => normed.find(h => patterns.includes(h.n))?.raw;
  const touches = [];
  for (let i = 1; i <= 3; i++) {
    let subject = find([`email${i}subject`, `subject${i}`, `${i}subject`, `touch${i}subject`, `followup${i}subject`, `email${i}subjectline`]);
    let body = find([`email${i}body`, `body${i}`, `${i}body`, `touch${i}body`, `followup${i}body`, `email${i}message`, `message${i}`, `${i}message`]);
    if (i === 1) { subject = subject || bareSubject; body = body || bareBody; }
    if (!subject || !body) break;
    touches.push({ subject, body });
  }
  return touches;
}
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = aoa[i] || [];
    const hits = row.filter(c => ALL_SYNONYMS_NORM.has(normHeader(c))).length;
    if (hits >= 4) return i;
  }
  return -1;
}

const GO_DRIP_MS = 15000;
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
// Same guard as api/cron/send-batches.js — belt-and-suspenders against ever
// firing the literal unfilled-in placeholder copy as a real send.
const isPlaceholderCopy = text => /^\s*\(?personalized per organization\)?\s*$/i.test(String(text || ""));
const touchHasCopy = t => !!(t && String(t.subject || "").trim() && String(t.body || "").trim() && !isPlaceholderCopy(t.body));
const isDay1Pending = (lead, isTouchSent) => !!(lead.sendable && lead.email && !lead.bounced && !leadStoppedAuto(lead) && touchHasCopy(lead.touches?.[0]) && !isTouchSent(lead, 0));
async function sleepAbortable(ms, aborted, onTick) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (aborted()) return false;
    onTick?.(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    await new Promise(r => setTimeout(r, 250));
  }
  return !aborted();
}

// Resolves {{orgName}}/{{firstName}}/{{sport}} against one lead's fields —
// used wherever a mass-applied draft (a bulk-added follow-up, or an EMAIL
// STEPS overwrite) gets pushed into individual leads, so what lands in each
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
  const sendable = leads.filter(l => l.sendable && l.email && !leadStoppedAuto(l));
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
function Day1GoPanel({ readyCount, pace, setPace, run, onGo, onStop, canGo }) {
  const dripMins = Math.max(1, Math.ceil((readyCount * GO_DRIP_MS) / 60000));
  return (
    <div style={{ background: B.orangeBg, border: `2px solid ${B.orange}`, borderRadius: 10, padding: "16px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Lbl c={B.orange}>SEND DAY 1 FROM BRAD</Lbl>
          <div style={{ fontSize: 13, fontWeight: 600, color: B.text, marginTop: 6 }}>
            {readyCount} Email 1{readyCount !== 1 ? "s" : ""} ready
          </div>
          <div style={{ fontSize: 11, color: B.textMid, marginTop: 3, maxWidth: 520, lineHeight: 1.5 }}>
            Sends the first email for each organization still pending, from brad@shopst1sports.com. Already-sent, bounced, or empty Day 1s are skipped.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: B.text, cursor: run ? "default" : "pointer" }}>
            <input type="radio" name="go-pace" checked={pace === "now"} disabled={!!run} onChange={() => setPace("now")} />
            Send all Day 1 now
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: B.text, cursor: run ? "default" : "pointer" }}>
            <input type="radio" name="go-pace" checked={pace === "drip"} disabled={!!run} onChange={() => setPace("drip")} />
            1 every 15 seconds{readyCount > 1 ? ` (~${dripMins} min)` : ""}
          </label>
          <div style={{ marginTop: 2 }}>
            {run
              ? <GBtn onClick={onStop} style={{ color: B.red, borderColor: `${B.red}60`, fontWeight: 700 }}>■ STOP</GBtn>
              : <OBtn onClick={onGo} disabled={!canGo} style={{ padding: "10px 28px", fontSize: 13 }}>▶ GO</OBtn>}
          </div>
        </div>
      </div>
      {run && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${B.orange}40` }}>
          <div style={{ fontSize: 12, color: B.text, fontWeight: 600 }}>
            {run.done} of {run.total} sent
            {run.current ? ` — ${run.current}` : ""}
            {run.failed ? ` · ${run.failed} failed` : ""}
            {run.mode === "drip" && run.nextIn > 0 ? ` · next in ${run.nextIn}s` : ""}
          </div>
          <div style={{ height: 6, background: `${B.orange}30`, borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((run.done / Math.max(1, run.total)) * 100)}%`, height: "100%", background: B.orange, borderRadius: 99 }} />
          </div>
          <div style={{ fontSize: 10, color: B.muted, marginTop: 6 }}>Keep this page open — leaving Bulk Outreach stops the send.</div>
        </div>
      )}
    </div>
  );
}

const CHANNEL_COLOR = { email: B.green, "contact form": B.blue, "social dm": B.purple, phone: B.yellow, "research needed": B.muted, suppressed: B.red };
// Ways to clear a bounce alert without a replacement email — each moves the
// lead into the "needs a different channel" bucket (same as a non-email row
// from the original sheet) instead of leaving it stuck flagged forever.
const BOUNCE_RESOLUTIONS = {
  no_email:     { channel: "Research Needed", action: "No email found",              label: "No email found" },
  contact_form: { channel: "Contact Form",    action: "Handled via contact form",     label: "Used contact form" },
  no_action:    { channel: "Unknown",         action: "No further action possible",  label: "Couldn't do anything" },
};

// Shared by the top bounce banner and each row's expanded view — a
// suggested replacement email (if the CRM lookup found one), a plain field
// to type a corrected one, and a way to clear the alert with no email at
// all when there just isn't a good address to use.
function BounceFixBox({ suggestedEmail, draftEmail, onDraftChange, onFix, onResolve }) {
  return (
    <>
      {suggestedEmail && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11, color: B.textMid, background: B.greenBg, border: `1px solid ${B.green}30`, borderRadius: 4, padding: "6px 9px" }}>
          ✓ Found a different email on file: <b>{suggestedEmail}</b>
          <OBtn onClick={() => onFix(suggestedEmail)} style={{ fontSize: 9, padding: "5px 10px", marginLeft: "auto" }}>USE THIS</OBtn>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input value={draftEmail ?? ""} onChange={e => onDraftChange(e.target.value)}
          placeholder="Corrected email address" style={{ flex: 1, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 9px", fontSize: 11, boxSizing: "border-box" }} />
        <GBtn onClick={() => onFix(draftEmail)} disabled={!draftEmail?.trim()} style={{ fontSize: 9, padding: "6px 12px" }}>FIX & RE-ACTIVATE</GBtn>
      </div>
      <div style={{ fontSize: 10, color: B.muted, marginBottom: 4 }}>Or clear this alert without an email:</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <GBtn onClick={() => onResolve("no_email")} style={{ fontSize: 9, padding: "5px 10px" }}>CAN'T FIND EMAIL</GBtn>
        <GBtn onClick={() => onResolve("contact_form")} style={{ fontSize: 9, padding: "5px 10px" }}>USED CONTACT FORM</GBtn>
        <GBtn onClick={() => onResolve("no_action")} style={{ fontSize: 9, padding: "5px 10px" }}>COULDN'T DO ANYTHING</GBtn>
      </div>
    </>
  );
}

// Above this many distinct versions at one step, listing each one out stops
// being useful — the panel falls back to a summary + a single "write one
// new version" override instead.
const EMAIL_VARIANT_CAP = 25;

// One subject/body editor, seeded from real content (a detected variant's
// actual text, or blank for the "too many versions" override) rather than
// starting empty — `templates[draftKey]` takes over once the rep actually
// types something, same lazy-seed pattern as the rest of this file's
// editors (never a render-time write to state).
function StepEditor({ draftKey, seed, templates, updateTemplateField, onApply, applyLabel, hint }) {
  const draft = templates[draftKey] || seed;
  return (
    <>
      {hint && <div style={{ fontSize: 10, color: B.muted, marginBottom: 8 }}>{hint}</div>}
      <input value={draft.subject} onChange={e => updateTemplateField(draftKey, "subject", e.target.value, draft)} placeholder="Subject"
        style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "7px 10px", fontSize: 13, fontWeight: 600, marginBottom: 6, boxSizing: "border-box" }} />
      <textarea value={draft.body} onChange={e => updateTemplateField(draftKey, "body", e.target.value, draft)} placeholder="Body" rows={8}
        style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />
      <OBtn onClick={() => onApply(draft.subject, draft.body)} style={{ fontSize: 9, padding: "7px 16px" }}>{applyLabel}</OBtn>
    </>
  );
}
const STATUS_BADGE = {
  draft:    { bg: B.yellowBg, c: B.yellow,  label: "DRAFT" },
  active:   { bg: B.orangeBg, c: B.orange,  label: "ACTIVE" },
  approved: { bg: B.greenBg,  c: B.green,   label: "APPROVED" },
};

export default function BulkOutreach({ s, dispatch, toast, cu, setMod }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlBatch = searchParams.get("batch") || "";
  const urlNew = searchParams.has("new");
  const [screen, setScreen] = useState(urlBatch || urlNew ? "review" : "list"); // list | review
  const [batches, setBatches] = useState([]);
  const [uniqueSentCount, setUniqueSentCount] = useState(0);
  const [loadingList, setLoadingList] = useState(true);

  const [batchId, setBatchId] = useState(null);
  const [linkedCampaignId, setLinkedCampaignId] = useState(null);
  const [batchStatus, setBatchStatus] = useState("draft");
  const [phase, setPhase] = useState("upload"); // upload | parsing | ready
  const [fileName, setFileName] = useState("");
  const [leads, setLeads] = useState([]); // sendable + non-sendable, suppressed excluded
  const [templates, setTemplates] = useState({}); // { [stepKey]: {subject,body,label} } — stepKey is "step0"/"step1"/"step2" (Email 1/2/3)
  const [expandedStepKey, setExpandedStepKey] = useState(null);
  const [expandedVariantKey, setExpandedVariantKey] = useState(null);
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
  const [showHeld, setShowHeld] = useState(false);
  const [showIntent, setShowIntent] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [suggestedEmails, setSuggestedEmails] = useState({}); // { [leadId]: alternateEmail } — from mark-bounced's CRM lookup
  const [emailFixDraft, setEmailFixDraft] = useState({}); // { [leadId]: string } — in-progress typed correction
  const [committing, setCommitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const [sendingKey, setSendingKey] = useState(null); // `${leadId}-${touchIdx}` currently sending
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [goPace, setGoPace] = useState("now"); // now | drip
  const [goRun, setGoRun] = useState(null); // {mode,total,done,failed,current,nextIn} while GO is live
  const [exportingSent, setExportingSent] = useState(false);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  const skipNextSave = useRef(false);
  const leadsRef = useRef(leads);
  const goAbortRef = useRef(false);
  useEffect(() => { leadsRef.current = leads; }, [leads]);
  useEffect(() => () => { goAbortRef.current = true; }, []);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/outreach/batches");
      const d = await r.json();
      setBatches(d.batches || []);
      if (Number.isFinite(Number(d.uniqueSentCount))) setUniqueSentCount(Number(d.uniqueSentCount));
    } catch (e) { toast(`Couldn't load outreach batches: ${e.message}`, "error"); }
    setLoadingList(false);
  };
  useEffect(() => { loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const emailedLeads = useMemo(
    () => leads.filter(l => (l.touches || []).some(t => t?.sentAt && !Number.isNaN(Date.parse(t.sentAt)))),
    [leads]
  );

  const exportSentCsv = async (unique = true, onlyBatchId = null) => {
    setExportingSent(true);
    try {
      const q = new URLSearchParams({ unique: unique ? "1" : "0" });
      if (onlyBatchId) q.set("batchId", onlyBatchId);
      const r = await fetch(`/api/outreach/sent-export?${q}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(d.error || "Couldn't export the sent list", "error");
        return;
      }
      const blob = await r.blob();
      const n = r.headers.get("X-Sent-Count");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = onlyBatchId
        ? (unique ? "brad-batch-sent-unique.csv" : "brad-batch-sent-all.csv")
        : (unique ? "brad-bulk-sent-unique.csv" : "brad-bulk-sent-all.csv");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(unique
        ? `Downloaded ${n || "0"} emails that already got mail${onlyBatchId ? " from this list" : ""}`
        : `Downloaded ${n || "0"} sent emails`, "success");
    } catch (e) {
      toast(`Couldn't export the sent list: ${e.message}`, "error");
    }
    setExportingSent(false);
  };

  // Removes a bad upload entirely — refused server-side once approved
  // (that upload is now a real running campaign; nothing here to fix by
  // deleting the batch record). Confirmed up front since there's no undo.
  const deleteBatch = async (batch, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete the upload "${batch.name}"? This can't be undone.`)) return;
    try {
      const r = await fetch(`/api/outreach/batches?id=${encodeURIComponent(batch.id)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok || !d.ok) { toast(d.error || "Couldn't delete this upload", "error"); return; }
      setBatches(prev => prev.filter(b => b.id !== batch.id));
      toast("Upload deleted", "success");
    } catch (err) { toast(`Couldn't delete this upload: ${err.message}`, "error"); }
  };

  // Same delete, reachable from inside a batch already open (in case it's
  // only obvious it's bad once reviewing it) rather than only from the list.
  const deleteCurrentBatch = async () => {
    if (!batchId) return;
    if (!window.confirm(`Delete the upload "${campaignName}"? This can't be undone.`)) return;
    try {
      const r = await fetch(`/api/outreach/batches?id=${encodeURIComponent(batchId)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok || !d.ok) { toast(d.error || "Couldn't delete this upload", "error"); return; }
      toast("Upload deleted", "success");
      backToList();
    } catch (err) { toast(`Couldn't delete this upload: ${err.message}`, "error"); }
  };

  // Bounced leads are excluded from sendableLeads entirely — same
  // treatment as "needs a different channel" leads — so a bounced address
  // can never be picked up again by a bulk template apply, a manual SEND
  // NOW, or a future approve-and-schedule pass.
  const sendableLeads = useMemo(() => leads.filter(l => l.sendable && l.email && !l.bounced && !l.heldForEarlier && !leadStoppedAuto(l)), [leads]);
  const heldLeads = useMemo(() => leads.filter(l => l.heldForEarlier), [leads]);
  const intentLeads = useMemo(() => leads.filter(l => l.positiveIntent), [leads]);
  const manualLeads = useMemo(() => leads.filter(l => l.manualFollowUp), [leads]);
  const skippedLeads = useMemo(() => leads.filter(l => !l.bounced && !l.heldForEarlier && !leadStoppedAuto(l) && !(l.sendable && l.email)), [leads]);
  // A skipped lead still has a real, valid email whenever the sheet had one
  // (the parser always keeps it if valid, regardless of sendable) — this is
  // the recovery path for a batch parsed before sendable stopped requiring
  // an explicit "Email" channel + pre-written subject/body: an
  // already-uploaded plain contact list stuck here can be reclassified
  // without re-uploading. Only a blank/"Unknown" channel qualifies — a row
  // that explicitly said Phone/Contact Form/etc. was correctly routed
  // there by the sheet itself and shouldn't be swept into email regardless
  // of whether a fallback address happens to be on file.
  const canReclassifyToEmail = l => isValidEmail(l.email) && !l.heldForEarlier && (!l.channel || l.channel.toLowerCase() === "unknown");
  const reclassifiableSkipped = useMemo(() => skippedLeads.filter(canReclassifyToEmail), [skippedLeads]);
  const bouncedLeads = useMemo(() => leads.filter(l => l.bounced), [leads]);
  const bulkEligible = useMemo(() => sendableLeads.filter(l => l.touches.length < 3), [sendableLeads]);
  // Bounced leads still show in the main org list below (so the record
  // reflects every org that was ever in play, not just the currently-active
  // ones) — every bounced lead already satisfies sendable+email by
  // construction (that's the only kind of lead that can bounce), so this is
  // sendableLeads plus bounced ones, in one pass.
  const visibleLeads = useMemo(() => leads.filter(l => l.sendable && l.email), [leads]);
  const filteredVisibleLeads = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    if (!q) return visibleLeads;
    return visibleLeads.filter(l => [l.orgName, l.contactName, l.email, l.city, l.sport, l.state]
      .some(v => String(v || "").toLowerCase().includes(q)));
  }, [visibleLeads, leadQuery]);
  // Every touch position that exists across sendableLeads right now — [0],
  // [0,1], or [0,1,2] — drives the EMAIL STEPS panel below (EMAIL 1/2/3).
  const stepIndices = useMemo(() => {
    const maxIdx = sendableLeads.reduce((a, l) => Math.max(a, l.touches.length - 1), -1);
    return maxIdx < 0 ? [] : Array.from({ length: maxIdx + 1 }, (_, i) => i);
  }, [sendableLeads]);

  const startMs = useMemo(() => { try { return parseMTLocalStr(startDt); } catch { return nextMTBizStart(Date.now()); } }, [startDt]);
  const campIdRef = useRef(mkId());
  const preview = useMemo(
    () => buildOutreachSchedule(campIdRef.current, sendableLeads, { startMs, batchSize: Math.max(1, Number(batchSize) || 25), touchGapDays: Math.max(1, Number(touchGapDays) || 5) }),
    [sendableLeads, startMs, batchSize, touchGapDays]
  );

  // Autosave — any edit PATCHes the durable batch record after a short
  // pause, so nothing is lost on navigation/reload and the edits are there
  // next time this batch is opened. Once approved, the schedule itself
  // (start time/batch size/gap/name) is locked and no longer saved here —
  // but touch copy (and sentAt markers) keeps saving regardless of approval,
  // since the rep can still edit language and manually send after approval.
  // Skipped right after loading/creating a batch (so populating state from
  // the server doesn't immediately re-save it).
  useEffect(() => {
    if (screen !== "review" || !batchId) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = batchStatus === "approved"
          ? { id: batchId, leads, templates }
          : { id: batchId, name: campaignName, leads, templates, startDt, batchSize: Number(batchSize) || 25, touchGapDays: Number(touchGapDays) || 5 };
        await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        setSaveStatus("saved");
      } catch (e) { setSaveStatus(null); toast(`Autosave failed: ${e.message}`, "error"); }
    }, 900);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, templates, campaignName, startDt, batchSize, touchGapDays, batchStatus]);

  const openBatch = async (id) => {
    if (!id) return;
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
      setTemplates(b.templates || {});
      setStartDt(b.startDt || startDt);
      setBatchSize(b.batchSize || 25);
      setTouchGapDays(b.touchGapDays || 5);
      setPhase("ready");
      setExpandedId(null);
      setExpandedStepKey(null);
      setScreen("review");
    } catch (e) { toast(`Couldn't load batch: ${e.message}`, "error"); }
  };

  const startNewUpload = () => {
    setBatchId(null); setBatchStatus("draft"); setLinkedCampaignId(null); setLeads([]); setTemplates({}); setFileName("");
    setCampaignName(`Bulk Outreach — ${today()}`);
    campIdRef.current = mkId();
    setPhase("upload");
    setScreen("review");
  };

  const backToList = () => {
    setSearchParams({});
    setScreen("list");
    setBatchId(null);
    setLinkedCampaignId(null);
    setLeads([]);
    setPhase("upload");
    loadList();
  };

  useEffect(() => {
    if (urlBatch) {
      if (batchId === urlBatch && screen === "review") return;
      openBatch(urlBatch);
      return;
    }
    if (urlNew) {
      if (screen === "review" && !batchId) return;
      startNewUpload();
      return;
    }
    if (screen !== "list" || batchId) {
      setScreen("list");
      setBatchId(null);
      setLinkedCampaignId(null);
      setLeads([]);
      setPhase("upload");
      loadList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlBatch, urlNew]);

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
      let touchCols = detectTouchColumns(headers, colMap.subject, colMap.body);

      // Heuristic mapping missed something required, or the sheet still has
      // subject/body-looking headers the heuristic didn't claim (unusual
      // naming it doesn't recognize) — fall back to a cheap AI pass rather
      // than silently importing only some of the pre-written emails.
      const claimedHeaders = new Set([colMap.subject, colMap.body, ...touchCols.flatMap(t => [t.subject, t.body])].filter(Boolean));
      const mightHaveMoreTouches = touchCols.length < 3 && headers.some(h => !claimedHeaders.has(h) && /subject|body|message/i.test(h));
      if (!colMap.orgName || !colMap.email || (!touchCols.length && (!colMap.subject || !colMap.body)) || mightHaveMoreTouches) {
        try {
          const sampleRow = aoa[headerRowIdx + 1] || [];
          const sample = Object.fromEntries(headers.map((h, i) => [h, sampleRow[i]]));
          const ai = await aiCall(
`Map these spreadsheet column headers for a cold-outreach import. Return ONLY JSON.
Headers: ${headers.join(" | ")}
Sample row: ${JSON.stringify(sample).slice(0, 1500)}

Map single-value fields to one of: orgName, sport, city, contactName, email, channel, whyNow, priority, angle, action — using the EXACT header text as written. Omit any you can't find.

Separately, list every subject/body column PAIR that holds pre-written outreach email copy, in send order — there may be 1, 2, or 3 (e.g. a first email in plain "Subject"/"Body" columns plus numbered follow-ups like "Email 2 Subject"/"Email 2 Body", or all three numbered from the start). Use the EXACT header text.

Return JSON exactly as:
{"orgName":"Exact Header","email":"Exact Header","touches":[{"subject":"Exact Header","body":"Exact Header"}]}`,
            { json: true, tokens: 500 }
          );
          if (ai && typeof ai === "object") {
            const { touches: aiTouches, ...aiFields } = ai;
            colMap = { ...aiFields, ...colMap };
            if (Array.isArray(aiTouches)) {
              const validAiTouches = aiTouches.filter(t => t?.subject && t?.body && headers.includes(t.subject) && headers.includes(t.body));
              if (validAiTouches.length > touchCols.length) touchCols = validAiTouches;
            }
          }
        } catch {}
      }
      if (!colMap.orgName || !colMap.email) { toast("Couldn't find organization/email columns in this file", "error"); setPhase("upload"); return; }

      const idxOf = f => headers.indexOf(colMap[f]);
      const rows = aoa.slice(headerRowIdx + 1).filter(r => r.some(c => String(c || "").trim()));
      const get = (r, f) => { const i = idxOf(f); return i >= 0 ? String(r[i] ?? "").trim() : ""; };
      const touchColIdxs = touchCols.map(tc => ({ subjectIdx: headers.indexOf(tc.subject), bodyIdx: headers.indexOf(tc.body) }));
      const getAt = (r, idx) => idx >= 0 ? String(r[idx] ?? "").trim() : "";

      const parsed = rows.map(r => {
        const orgName = get(r, "orgName");
        if (!orgName) return null;
        const action = get(r, "action");
        const priority = get(r, "priority");
        if (/suppress/i.test(action) || /^skip$/i.test(priority)) return null; // Do Not Work — excluded entirely
        const explicitChannel = get(r, "channel");
        const email = get(r, "email");
        const subject = get(r, "subject");
        const body = get(r, "body");
        const contactName = get(r, "contactName");
        const [firstName, ...lastParts] = (contactName && contactName !== "-") ? contactName.split(" ") : [""];
        const hasValidEmail = isValidEmail(email);
        // A row is sendable via email whenever there's a valid address and
        // nothing on the sheet explicitly routes it elsewhere (Phone,
        // Contact Form, etc.) — a blank Channel column defaults to email,
        // it doesn't fall back to "needs another channel". Pre-written
        // subject/body are no longer required either: a plain contact list
        // (already-known contacts, just org + email, no drafted copy) is a
        // normal case now, not just a research sheet with a message
        // written per row — content can always be authored for the whole
        // batch afterward via "+ ADD FOLLOW-UP TO ALL" or the EMAIL STEPS
        // panel, so an empty touches[] here just means "write it there".
        const sendable = hasValidEmail && (!explicitChannel || /email/i.test(explicitChannel));
        const channel = explicitChannel || (hasValidEmail ? "Email" : "Unknown");
        // Numbered per-touch columns (Email 1/2/3 Subject/Body) take over
        // from the single bare subject/body pair when the sheet has them —
        // a full sequence written per org, not just a first email.
        const rowTouches = sendable
          ? (touchColIdxs.length
              ? touchColIdxs
                  .map(({ subjectIdx, bodyIdx }) => ({ subject: getAt(r, subjectIdx), body: getAt(r, bodyIdx) }))
                  .filter(t => t.subject.trim() && t.body.trim())
              : (subject.trim() && body.trim() ? [{ subject, body }] : []))
          : [];
        return {
          id: mkId(), orgName, sport: get(r, "sport"), city: get(r, "city"),
          contactName, firstName: firstName || "", lastName: lastParts.join(" "),
          email: hasValidEmail ? email : "", channel, angle: get(r, "angle"), priority,
          action, whyNow: get(r, "whyNow"),
          touches: rowTouches,
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
      setLeads(created.batch.leads || parsed);
      setPhase("ready");
      setSearchParams({ batch: created.batch.id });
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

  // Marks one or more touches sent (pairs: [{leadId, touchIdx, sentAt}]) and
  // makes that durable everywhere it matters: the leads array (local state +
  // an immediate PATCH, independent of the approval-gated autosave below),
  // and — if this batch is already approved and running — the linked
  // campaign's enrollments, advanced exactly the way the cron would so a
  // touch confirmed sent here is never re-sent automatically. Shared by a
  // single manual SEND NOW and by the bulk Gmail reconciliation below.
  const markTouchesSent = async (pairs) => {
    if (!pairs.length) return;
    const byLead = new Map();
    for (const p of pairs) (byLead.get(p.leadId) || byLead.set(p.leadId, new Map()).get(p.leadId)).set(p.touchIdx, p.sentAt);
    const updatedLeads = leadsRef.current.map(l => {
      const touchMap = byLead.get(l.id);
      if (!touchMap) return l;
      return { ...l, touches: l.touches.map((t, i) => touchMap.has(i) ? { ...t, sentAt: touchMap.get(i) } : t) };
    });
    leadsRef.current = updatedLeads;
    setLeads(updatedLeads);

    try {
      await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: batchId, leads: updatedLeads }) });
      setBatchStatus(prev => prev === "approved" ? prev : "active");
    } catch (e) { toast(`Sent, but couldn't save the sent status: ${e.message}`, "info"); }

    if (linkedCampaignId) {
      const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
      if (camp) {
        const byContact = new Map();
        for (const p of pairs) (byContact.get(p.leadId) || byContact.set(p.leadId, []).get(p.leadId)).push(p);
        dispatch("UPDATE_CAMPAIGN", {
          id: camp.id,
          enrollments: (camp.enrollments || []).map(en => {
            const mine = byContact.get(en.contactId);
            if (!mine) return en;
            const touchIdxs = mine.map(p => p.touchIdx);
            const sentSteps = [...new Set([...(en.sentSteps || []), ...touchIdxs])];
            const maxIdx = Math.max(...touchIdxs);
            const latest = mine.reduce((a, p) => p.sentAt > a ? p.sentAt : a, mine[0].sentAt).slice(0, 10);
            if (en.step > maxIdx) return { ...en, sentSteps, lastContacted: latest, lastSentAt: latest };
            const nextStep = maxIdx + 1;
            const doneAllTouches = nextStep >= (camp.touches || []).length;
            return { ...en, sentSteps, step: nextStep, status: doneAllTouches ? "done" : en.status, lastContacted: latest, lastSentAt: latest };
          }),
        });
      }
    }
  };

  const markLeadOutcome = (leadId, outcome) => {
    const updated = leadsRef.current.map(l => l.id === leadId ? applyLeadOutcome(l, outcome) : l);
    leadsRef.current = updated;
    setLeads(updated);
    const live = updated.find(l => l.id === leadId);
    if (linkedCampaignId) {
      const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
      if (camp) {
        const status = outcome === "intent" ? "interested" : outcome === "manual" ? "manual" : "active";
        dispatch("UPDATE_CAMPAIGN", {
          id: camp.id,
          enrollments: (camp.enrollments || []).map(en => en.contactId === leadId ? { ...en, status } : en),
        });
      }
    }
    if (batchId) {
      fetch("/api/outreach/batches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: batchId, leads: updated }),
      }).catch(() => {});
    }
    const who = live?.orgName || live?.email || "Contact";
    if (outcome === "intent") toast(`${who} — positive intent, no more automated emails`, "success");
    else if (outcome === "manual") toast(`${who} — manual follow-up, pulled off the send queue`, "success");
    else toast(`${who} back on the automated list`, "info");
  };

  const fireBradSend = async (lead, touchIdx) => {
    const live = leadsRef.current.find(l => l.id === lead.id) || lead;
    const touch = live.touches[touchIdx];
    if (!touch || touchSentInfo(live, touchIdx).sent || live.bounced || live.heldForEarlier || leadStoppedAuto(live) || !live.email || !touchHasCopy(touch)) {
      return { skipped: true, outcome: live.positiveIntent ? "intent" : live.manualFollowUp ? "manual" : undefined };
    }
    try {
      const r = await fetch("/api/agents/brad-send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactEmail: live.email,
          contactName: (live.contactName && live.contactName !== "-") ? live.contactName : live.orgName,
          subject: touch.subject, body: touch.body, contactId: live.id, batchId,
        }),
      });
      const d = await r.json();
      if (d.held || d.skipped) {
        if (d.held) {
          const updated = leadsRef.current.map(l => l.id === live.id
            ? { ...l, sendable: false, heldForEarlier: true, heldByBatch: d.error || "earlier list" }
            : l);
          leadsRef.current = updated;
          setLeads(updated);
          if (batchId) {
            fetch("/api/outreach/batches", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: batchId, leads: updated }),
            }).catch(() => {});
          }
        }
        return { skipped: true, held: !!d.held, outcome: d.outcome };
      }
      if (!d.ok || !d.sent) return { ok: false, error: d.error || "Send failed" };
      await markTouchesSent([{ leadId: live.id, touchIdx, sentAt: new Date().toISOString() }]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const sendTouchNow = async (lead, touchIdx) => {
    if (goRun) { toast("Stop the Day 1 send first", "info"); return; }
    const touch = lead.touches[touchIdx];
    if (!touch || touchSentInfo(lead, touchIdx).sent) return;
    if (lead.bounced) { toast("This address bounced — fix the email before sending", "error"); return; }
    if (lead.positiveIntent) { toast("Positive intent — they are off the automated follow-ups", "info"); return; }
    if (lead.manualFollowUp) { toast("Manual follow-up — they will not get another automated email", "info"); return; }
    if (!lead.email) { toast("No email address for this contact", "error"); return; }
    if (!touchHasCopy(touch)) { toast("Write a real subject and body for this email first", "error"); return; }
    if (!window.confirm(`Send this exact email now, from brad@shopst1sports.com?\n\nTo: ${lead.email}\nSubject: ${touch.subject}\n\n${touch.body}`)) return;
    setSendingKey(`${lead.id}-${touchIdx}`);
    const result = await fireBradSend(lead, touchIdx);
    if (result.ok) toast(`Sent to ${lead.email}`, "success");
    else if (result.held) toast("Already on an earlier list — pulled off this send", "info");
    else if (!result.skipped) toast(result.error || "Send failed", "error");
    setSendingKey(null);
  };

  const day1Ready = useMemo(
    () => sendableLeads.filter(l => isDay1Pending(l, (lead, i) => touchSentInfo(lead, i).sent)),
    [sendableLeads, linkedCampaignId, s?.campaigns]
  );

  const startDay1Go = async () => {
    if (goRun || !day1Ready.length) {
      if (!day1Ready.length) toast("No Day 1 emails left to send", "info");
      return;
    }
    const queue = day1Ready;
    const drip = goPace === "drip";
    const mins = Math.ceil((queue.length * GO_DRIP_MS) / 60000);
    if (!window.confirm(drip
      ? `Send ${queue.length} Day 1 email(s) from brad@shopst1sports.com, one every 15 seconds (about ${mins} minute${mins !== 1 ? "s" : ""})?\n\nKeep this page open until it finishes.`
      : `Send all ${queue.length} Day 1 email(s) from brad@shopst1sports.com now?`)) return;

    goAbortRef.current = false;
    setGoRun({ mode: drip ? "drip" : "now", total: queue.length, done: 0, failed: 0, current: null, nextIn: 0 });
    let done = 0, failed = 0, streak = 0;
    for (let i = 0; i < queue.length; i++) {
      if (goAbortRef.current) break;
      const lead = queue[i];
      setGoRun(r => r && { ...r, current: lead.orgName || lead.email, nextIn: 0 });
      const result = await fireBradSend(lead, 0);
      if (goAbortRef.current) break;
      if (result.ok) { done += 1; streak = 0; }
      else if (!result.skipped) {
        failed += 1;
        streak += 1;
        toast(`${lead.email}: ${result.error || "Send failed"}`, "error");
        if (streak >= 3) { toast("Stopped — three sends in a row failed", "error"); break; }
      }
      setGoRun(r => r && { ...r, done, failed, current: lead.orgName || lead.email });
      if (drip && i < queue.length - 1) {
        await sleepAbortable(GO_DRIP_MS, () => goAbortRef.current, sec => setGoRun(r => r && { ...r, nextIn: sec }));
      }
    }
    setGoRun(null);
    const summary = `${done} sent${failed ? `, ${failed} failed` : ""}`;
    if (goAbortRef.current) toast(`Stopped — ${summary}`, "info");
    else if (done || failed) toast(`Day 1 done — ${summary}`, failed && !done ? "error" : "success");
  };

  // Flags a batch of bounced leads everywhere it matters: this batch's
  // leads (bounced:true — excluded from sendableLeads from then on),
  // anything still pending for them in a linked/approved campaign's
  // scheduledBatches (removed outright, so the cron can't fire a bounced
  // address's next touch), the enrollment status (for visibility in
  // Campaigns), and — server-side, since Zoho creds live there — the
  // shared SalesContact record + its mirrored Zoho Email_Opt_Out, plus a
  // lookup for a different, still-good email on file for the same company.
  // bounces: [{leadId, email, snippet}].
  const markLeadsBounced = async (bounces) => {
    if (!bounces.length) return;
    const bouncedAt = new Date().toISOString();
    const byLeadId = new Map(bounces.map(b => [b.leadId, b]));
    const updatedLeads = leads.map(l => {
      const b = byLeadId.get(l.id);
      if (!b) return l;
      return { ...l, bounced: true, bouncedAt, bounceNote: (b.snippet || "").slice(0, 200) };
    });
    setLeads(updatedLeads);
    try {
      await fetch("/api/outreach/batches", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: batchId, leads: updatedLeads }) });
    } catch (e) { toast(`Bounces flagged, but couldn't save it: ${e.message}`, "info"); }

    if (linkedCampaignId) {
      const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
      if (camp?.scheduledBatches) {
        let changed = false;
        const nextSched = { ...camp.scheduledBatches };
        for (const [bk, info] of Object.entries(nextSched)) {
          if (!info.contactIds?.some(id => byLeadId.has(id))) continue;
          const batchContacts = { ...info.batchContacts };
          info.contactIds.forEach(id => { if (byLeadId.has(id)) delete batchContacts[id]; });
          nextSched[bk] = { ...info, contactIds: info.contactIds.filter(id => !byLeadId.has(id)), batchContacts };
          changed = true;
        }
        const enrollments = (camp.enrollments || []).map(en => byLeadId.has(en.contactId) ? { ...en, status: "bounced" } : en);
        if (changed) dispatch("UPDATE_CAMPAIGN", { id: camp.id, scheduledBatches: nextSched, enrollments });
        else dispatch("UPDATE_CAMPAIGN", { id: camp.id, enrollments });
      }
    }

    const results = await Promise.all(bounces.map(async b => {
      try {
        const r = await fetch("/api/contacts/mark-bounced", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: b.email }) });
        return await r.json();
      } catch { return null; }
    }));
    const suggestions = {};
    bounces.forEach((b, i) => { if (results[i]?.suggestedEmail) suggestions[b.leadId] = results[i].suggestedEmail; });
    if (Object.keys(suggestions).length) setSuggestedEmails(prev => ({ ...prev, ...suggestions }));
  };

  // Replaces a bounced lead's email and un-bounces it, putting it back into
  // the active list — used both for a rep-typed correction and for
  // accepting the CRM-suggested alternate email from markLeadsBounced.
  const fixLeadEmail = (leadId, newEmail) => {
    const trimmed = String(newEmail || "").trim();
    if (!isValidEmail(trimmed)) { toast("Enter a valid email address", "error"); return; }
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, email: trimmed, bounced: false, bouncedAt: null, bounceNote: null } : l));
    setSuggestedEmails(prev => { const { [leadId]: _drop, ...rest } = prev; return rest; });
    setEmailFixDraft(prev => { const { [leadId]: _drop, ...rest } = prev; return rest; });
    toast("Email updated — back in the active list", "success");
  };

  // Clears a bounce alert with no replacement email in hand — the org isn't
  // reactivated for email (sendable:false, since there's still no working
  // address), it just moves into "needs a different channel" like any other
  // non-email row from the original sheet, so it stops showing as an open
  // alert but isn't lost or silently re-emailed later either.
  const resolveBounce = (leadId, reason) => {
    const res = BOUNCE_RESOLUTIONS[reason];
    if (!res) return;
    setLeads(prev => prev.map(l => l.id === leadId
      ? { ...l, bounced: false, bouncedAt: null, bounceNote: null, sendable: false, channel: res.channel, action: res.action }
      : l));
    setSuggestedEmails(prev => { const { [leadId]: _drop, ...rest } = prev; return rest; });
    setEmailFixDraft(prev => { const { [leadId]: _drop, ...rest } = prev; return rest; });
    toast(`Cleared — ${res.label}`, "success");
  };

  // Recovers a batch that was parsed before sendable stopped requiring an
  // explicit "Email" channel + pre-written subject/body — moves every
  // skipped lead that already has a real, valid email into the active
  // list. Content (if the sheet didn't have it, or it wasn't captured the
  // first time) can be authored for everyone at once afterward via "+ ADD
  // FOLLOW-UP TO ALL" or the EMAIL STEPS panel.
  const reclassifyAsEmail = () => {
    if (!reclassifiableSkipped.length) { toast("None of the skipped organizations have a usable email address", "error"); return; }
    if (!window.confirm(`Move ${reclassifiableSkipped.length} organization(s) with a usable email address into the active email list?`)) return;
    const ids = new Set(reclassifiableSkipped.map(l => l.id));
    setLeads(prev => prev.map(l => ids.has(l.id) ? { ...l, sendable: true, channel: "Email" } : l));
    toast(`Moved ${reclassifiableSkipped.length} organization${reclassifiableSkipped.length !== 1 ? "s" : ""} into the active email list`, "success");
  };

  // Cross-checks Brad's actual Gmail against what this page knows in two
  // directions: (1) sent mail it doesn't already have a sentAt for — see
  // markTouchesSent's approved-batch autosave gap, anything sent before
  // that fix looks unsent here even though it went out — matched by
  // recipient + exact subject; (2) bounce/delivery-failure notifications
  // sitting in Brad's inbox, matched by whether the bounce message mentions
  // one of this batch's own email addresses. A "ton of bounces" landing in
  // Brad's inbox with nothing here reflecting it was the actual complaint.
  const syncWithBradInbox = async () => {
    setSyncingGmail(true);
    let sentFound = 0, bouncesFound = 0;
    try {
      const targets = [];
      for (const l of sendableLeads) {
        l.touches.forEach((t, i) => { if (!touchSentInfo(l, i).sent && t.subject?.trim()) targets.push({ lead: l, touchIdx: i }); });
      }
      if (targets.length) {
        const emails = [...new Set(targets.map(t => t.lead.email))];
        const CHUNK = 20;
        const found = [];
        for (let i = 0; i < emails.length; i += CHUNK) {
          const chunk = emails.slice(i, i + CHUNK);
          const query = `in:sent to:(${chunk.map(e => `"${e}"`).join(" OR ")})`;
          const r = await fetch("/api/gmail", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list", repEnvKey: "BRAD", query, maxResults: 100 }) });
          const d = await r.json();
          if (!r.ok || d.error) continue;
          for (const msg of d.messages || []) {
            const toEmail = (String(msg.to || "").match(/[^<\s,]+@[^>\s,]+/) || [])[0]?.toLowerCase();
            if (!toEmail) continue;
            const match = targets.find(t => t.lead.email.toLowerCase() === toEmail
              && t.lead.touches[t.touchIdx].subject.trim().toLowerCase() === String(msg.subject || "").trim().toLowerCase());
            if (match) found.push({ leadId: match.lead.id, touchIdx: match.touchIdx, sentAt: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString() });
          }
        }
        const dedup = Array.from(new Map(found.map(f => [`${f.leadId}-${f.touchIdx}`, f])).values());
        if (dedup.length) { await markTouchesSent(dedup); sentFound = dedup.length; }
      }

      // Every currently-active email on this batch (not just unsent ones —
      // a bounce can arrive for a touch already sent from either this page
      // or the cron) is a candidate the bounce scan checks for.
      const activeLeads = sendableLeads.filter(l => l.email);
      if (activeLeads.length) {
        const byEmail = new Map(activeLeads.map(l => [l.email.toLowerCase(), l]));
        const bounceQuery = 'in:inbox (from:mailer-daemon OR from:postmaster OR subject:"Delivery Status Notification" OR subject:"Undelivered Mail" OR subject:"Mail delivery failed" OR subject:"failure notice" OR subject:"Returned mail")';
        const r = await fetch("/api/gmail", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", repEnvKey: "BRAD", query: bounceQuery, maxResults: 200 }) });
        const d = await r.json();
        const bounceMsgs = (!r.ok || d.error) ? [] : (d.messages || []);
        const newlyBounced = [];
        let getCallsUsed = 0;
        const GET_CAP = 40; // bounds the full-body fallback fetches below
        for (const msg of bounceMsgs) {
          const haystack = `${msg.subject || ""} ${msg.snippet || ""}`.toLowerCase();
          let matched = [...byEmail.entries()].find(([email]) => haystack.includes(email))?.[1];
          if (!matched && getCallsUsed < GET_CAP) {
            getCallsUsed++;
            try {
              const gr = await fetch("/api/gmail", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "get", repEnvKey: "BRAD", messageId: msg.id }) });
              const gd = await gr.json();
              const fullText = `${gd.subject || ""} ${gd.body || ""}`.toLowerCase();
              matched = [...byEmail.entries()].find(([email]) => fullText.includes(email))?.[1];
            } catch { /* best-effort — snippet-only match still covers most bounces */ }
          }
          if (matched) newlyBounced.push({ leadId: matched.id, email: matched.email, snippet: msg.snippet || "" });
        }
        const dedupBounced = Array.from(new Map(newlyBounced.map(b => [b.leadId, b])).values());
        if (dedupBounced.length) { await markLeadsBounced(dedupBounced); bouncesFound = dedupBounced.length; }
      }

      if (sentFound || bouncesFound) {
        const parts = [];
        if (sentFound) parts.push(`${sentFound} already-sent email(s) recovered`);
        if (bouncesFound) parts.push(`${bouncesFound} bounce(s) flagged and removed from future sends`);
        toast(parts.join(" · "), "success");
      } else {
        toast("Nothing new found in Brad's inbox — everything shown here is accurate", "info");
      }
    } catch (e) {
      toast(`Couldn't check Brad's inbox: ${e.message}`, "error");
    }
    setSyncingGmail(false);
  };

  // Keeps the campaign's frozen per-contact copy (scheduledBatches[...].
  // batchContacts[...].{__subject,__body}) in sync with edits made here
  // after approval — the cron sends whatever's embedded there, a separate
  // copy from this page's own leads, so an edit (single or bulk-templated)
  // has to land there too or a still-pending automatic send goes out with
  // stale wording. pairs: [{leadId, touchIdx, subject, body}]. Computes one
  // combined scheduledBatches update and dispatches it once — looping
  // dispatch() calls per-pair would each read the same stale campaign from
  // this render's closure and clobber each other's updates.
  const syncScheduledContent = (pairs) => {
    if (!linkedCampaignId || !pairs.length) return;
    const camp = (s?.campaigns || []).find(c => c.id === linkedCampaignId);
    if (!camp?.scheduledBatches) return;
    const byKey = new Map(pairs.map(p => [`${p.leadId}-${p.touchIdx}`, p]));
    let changed = false;
    const nextSched = { ...camp.scheduledBatches };
    for (const [bk, info] of Object.entries(nextSched)) {
      let infoChanged = false;
      const nextContacts = { ...info.batchContacts };
      for (const contactId of info.contactIds || []) {
        const p = byKey.get(`${contactId}-${info.touchIdx}`);
        if (!p || !nextContacts[contactId]) continue;
        nextContacts[contactId] = { ...nextContacts[contactId], __subject: p.subject, __body: p.body };
        infoChanged = true;
      }
      if (infoChanged) { nextSched[bk] = { ...info, batchContacts: nextContacts }; changed = true; }
    }
    if (changed) dispatch("UPDATE_CAMPAIGN", { id: camp.id, scheduledBatches: nextSched });
  };

  // Edits a single touch's subject/body by hand.
  const updateTouchField = (leadId, touchIdx, field, value) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const updatedTouches = lead.touches.map((tt, ti) => ti === touchIdx ? { ...tt, [field]: value } : tt);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, touches: updatedTouches } : l));
    const nt = updatedTouches[touchIdx];
    syncScheduledContent([{ leadId, touchIdx, subject: nt.subject, body: nt.body }]);
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

  // Draft text for the "EMAIL STEPS" panel below — keyed by position
  // ("step0"/"step1"/"step2", or "step{i}-v{n}" per detected variant) — not
  // by who created it, so it covers every email in the sequence uniformly,
  // including Email 1 (which otherwise only ever comes from the
  // spreadsheet's per-org text). Stored in the same `templates` batch field
  // (autosaves the same way). `base` must be the caller's already-resolved
  // draft (real seed content merged with any prior edit) — falling back to
  // prev[stepKey] alone would drop whichever field hadn't been typed into
  // yet the first time either field is edited (e.g. editing body only,
  // before subject was ever touched, would leave subject undefined).
  const updateTemplateField = (stepKey, field, value, base) => setTemplates(prev => ({ ...prev, [stepKey]: { ...(base || prev[stepKey]), [field]: value } }));

  // Overwrites Email {stepIdx+1} for a set of not-yet-sent organizations at
  // that position — deliberately unconditional (not scoped to "only ones
  // still on some earlier shared draft"): this is a mass update, so it
  // replaces whatever's currently there, including anything already
  // personalized or hand-edited. onlyLeadIds narrows the target to one
  // detected variant group (see the EMAIL STEPS panel below); omitted, it
  // targets every pending lead at that step. subject/body are passed in
  // directly rather than read back from `templates` state, since
  // setTemplates wouldn't be visible yet if this were called in the same
  // tick. saveKey is where the draft persists (a whole-step key normally,
  // or a per-variant key when editing one detected version).
  const applyStepToAll = (stepIdx, subject, body, onlyLeadIds, saveKey) => {
    if (!subject?.trim() || !body?.trim()) { toast("Write a subject and body first", "error"); return; }
    const pool = onlyLeadIds ? new Set(onlyLeadIds) : null;
    const targets = sendableLeads.filter(l => l.touches[stepIdx] && !l.touches[stepIdx].sentAt && (!pool || pool.has(l.id)));
    if (!targets.length) { toast(`No organizations left to update for Email ${stepIdx + 1}`, "error"); return; }
    if (!window.confirm(`Overwrite Email ${stepIdx + 1} for ${targets.length} organization(s) with this text?\n\nThis replaces whatever's currently written for each one.`)) return;

    const targetIds = new Set(targets.map(l => l.id));
    const updatedLeads = leads.map(l => {
      if (!targetIds.has(l.id)) return l;
      return { ...l, touches: l.touches.map((tt, ti) => ti === stepIdx ? { ...tt, subject: mergeLeadTags(subject, l).trim(), body: mergeLeadTags(body, l).trim() } : tt) };
    });
    setLeads(updatedLeads);
    setTemplates(prev => ({ ...prev, [saveKey || `step${stepIdx}`]: { subject: subject.trim(), body: body.trim(), label: `Email ${stepIdx + 1}` } }));

    const syncPairs = targets.map(l => {
      const tt = updatedLeads.find(x => x.id === l.id).touches[stepIdx];
      return { leadId: l.id, touchIdx: stepIdx, subject: tt.subject, body: tt.body };
    });
    syncScheduledContent(syncPairs);

    toast(`Updated Email ${stepIdx + 1} for ${targets.length} organization${targets.length !== 1 ? "s" : ""}`, "success");
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
    const enrollOne = (l, status) => {
      const sentSteps = l.touches.map((t, i) => t.sentAt ? i : -1).filter(i => i >= 0);
      const firstUnsent = l.touches.findIndex(t => !t.sentAt);
      const allSent = firstUnsent === -1;
      return { contactId: l.id, step: allSent ? l.touches.length : firstUnsent, status: status || (allSent ? "done" : "active"), enrolledAt: nowStr, nextDate: nowStr, sentSteps };
    };
    const enrollments = [
      ...sendableLeads.map(l => enrollOne(l)),
      ...intentLeads.map(l => enrollOne(l, "interested")),
      ...manualLeads.map(l => enrollOne(l, "manual")),
    ];

    const campaign = {
      id: campId, name: campaignName.trim() || `Bulk Outreach — ${nowStr}`,
      product: "Team Stores", audience: "Bulk import", source: "bulk-import",
      fromBrad: true, // send-batches.js sends as brad@shopst1sports.com when set
      repId: "", startDate: nowStr, touches, enrollments,
      scheduledBatches, sentBatches: {},
      batchSize: Math.max(1, Number(batchSize) || 25),
      status: "running", createdAt: nowStr,
      leadMeta: Object.fromEntries([...sendableLeads, ...intentLeads, ...manualLeads].map(l => [l.id, { orgName: l.orgName, angle: l.angle, priority: l.priority, whyNow: l.whyNow }])),
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
  const sentTouchCount = sendableLeads.reduce((a, l) => a + l.touches.filter((t, i) => touchSentInfo(l, i).sent).length, 0);
  const totalTouchCount = sendableLeads.reduce((a, l) => a + l.touches.length, 0);
  const isActive = batchStatus === "active" || sentTouchCount > 0;
  const canDelete = batchId && !isApproved && !isActive;

  return (
    <div style={{ padding: "26px 34px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: B.text }}>Bulk Outreach — for Brad</div>
          <div style={{ fontSize: 12, color: B.muted, marginTop: 2 }}>Upload a cold-outreach spreadsheet, review the schedule, approve — Brad sends it from here.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {screen === "list" && (
            <>
              <OBtn onClick={() => exportSentCsv(true)} disabled={exportingSent || uniqueSentCount === 0} style={{ padding: "10px 16px", fontSize: 11 }}>
                {exportingSent ? "DOWNLOADING…" : `⬇ ${uniqueSentCount || ""} ALREADY EMAILED`}
              </OBtn>
              <GBtn onClick={() => exportSentCsv(false)} disabled={exportingSent || uniqueSentCount === 0}>Every send</GBtn>
            </>
          )}
          {screen === "review" && phase === "ready" && emailedLeads.length > 0 && (
            <OBtn onClick={() => exportSentCsv(true, batchId)} disabled={exportingSent} style={{ padding: "10px 16px", fontSize: 11 }}>
              {exportingSent ? "DOWNLOADING…" : `⬇ ${emailedLeads.length} ALREADY EMAILED`}
            </OBtn>
          )}
          {screen === "review" && phase === "ready" && canDelete && (
            <GBtn onClick={deleteCurrentBatch} style={{ color: B.red, borderColor: `${B.red}60` }}>DELETE THIS UPLOAD</GBtn>
          )}
        </div>
      </div>

      {screen === "review" && (
        <button onClick={backToList} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: B.orange, cursor: "pointer" }}>
          ← Back to Bulk Outreach
        </button>
      )}

      {screen === "list" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <OBtn onClick={() => setSearchParams({ new: "1" })} style={{ padding: "10px 20px", fontSize: 12 }}>⬆ UPLOAD NEW SHEET</OBtn>
          </div>
          <div style={{ fontSize: 12, color: B.muted, marginBottom: 14, maxWidth: 720, lineHeight: 1.5 }}>
            <b>Already emailed</b> in the top right is only people Brad actually sent — not the rest of the sheet. Use that list to clean the next upload. A batch turns <b>Active</b> as soon as the first email goes out. The first Active or Approved upload keeps each address; later lists pull those people off Ready so they are not emailed twice.
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
                const sent = Number(b.sentCount) || 0;
                const locked = b.status === "approved" || b.status === "active" || sent > 0;
                return (
                  <div key={b.id} onClick={() => setSearchParams({ batch: b.id })} style={{ padding: "13px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: `1px solid ${B.border}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{b.name}</span>
                        <span style={{ fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", color: badge.c, background: badge.bg, padding: "2px 7px", borderRadius: 8, letterSpacing: .5 }}>{badge.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>
                        {sent > 0 ? <span style={{ color: B.orange, fontWeight: 600 }}>{sent} sent · </span> : null}
                        {Number(b.heldCount) > 0 ? <span style={{ color: B.purple, fontWeight: 600 }}>{b.heldCount} on earlier list · </span> : null}
                        {Number(b.intentCount) > 0 ? <span style={{ color: B.teal, fontWeight: 600 }}>{b.intentCount} intent · </span> : null}
                        {Number(b.manualCount) > 0 ? <span style={{ color: B.blue, fontWeight: 600 }}>{b.manualCount} manual · </span> : null}
                        {b.sendableCount} ready · {b.touchCount} email(s) · {b.totalCount} total rows · updated {fmtDT(b.updatedAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      {!locked && (
                        <button onClick={e => deleteBatch(b, e)} title="Delete this upload"
                          style={{ background: "none", border: "none", color: B.red, fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", cursor: "pointer", padding: "4px 6px" }}>
                          DELETE
                        </button>
                      )}
                      <span style={{ color: B.muted, fontSize: 13 }}>→</span>
                    </div>
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
          {bouncedLeads.length > 0 && (
            <div style={{ background: B.redBg, border: `2px solid ${B.red}`, borderLeft: `6px solid ${B.red}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: B.red, marginBottom: 2 }}>
                ⚠ {bouncedLeads.length} EMAIL{bouncedLeads.length !== 1 ? "S" : ""} BOUNCED
              </div>
              <div style={{ fontSize: 11, color: B.textMid, marginBottom: 10 }}>
                Opted out and removed from every future send — fix the address below to bring one back.
              </div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {bouncedLeads.map(l => (
                  <div key={l.id} style={{ background: B.white, border: `1px solid ${B.red}40`, borderRadius: 6, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{l.orgName}</div>
                      <span style={{ fontSize: 10, fontFamily: "'Lexend Zetta',sans-serif", color: B.white, background: B.red, padding: "2px 8px", borderRadius: 8, letterSpacing: .5 }}>BOUNCED</span>
                    </div>
                    <div style={{ fontSize: 11, color: B.red, marginTop: 4, marginBottom: 8 }}>
                      <span style={{ textDecoration: "line-through" }}>{l.email}</span> — no longer sendable
                    </div>
                    <BounceFixBox
                      suggestedEmail={suggestedEmails[l.id]}
                      draftEmail={emailFixDraft[l.id]}
                      onDraftChange={v => setEmailFixDraft(prev => ({ ...prev, [l.id]: v }))}
                      onFix={email => fixLeadEmail(l.id, email)}
                      onResolve={reason => resolveBounce(l.id, reason)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isApproved && (
            <div style={{ background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 12, color: B.textMid }}><b style={{ color: B.green }}>✓ Approved</b> — start time/batch size are locked in, but you can still edit copy below and send any email manually; edits sync to whatever's still queued.</div>
              {setMod && <GBtn onClick={goToCampaigns} style={{ fontSize: 10 }}>View in Campaigns →</GBtn>}
            </div>
          )}
          {!isApproved && isActive && (
            <div style={{ background: B.orangeBg, border: `1px solid ${B.orange}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: B.textMid }}>
                <b style={{ color: B.orange }}>● Active</b> — Brad has sent {sentTouchCount} email{sentTouchCount !== 1 ? "s" : ""} from this list. It stays Active until you approve a schedule. Use <b>Download sent list</b> or <b>This batch</b> to export who already got mail.
              </div>
            </div>
          )}

          {heldLeads.length > 0 && (
            <div style={{ background: B.purpleBg, border: `1px solid ${B.purple}`, borderLeft: `6px solid ${B.purple}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: B.purple, marginBottom: 2 }}>
                {heldLeads.length} ALREADY ON AN EARLIER LIST
              </div>
              <div style={{ fontSize: 11, color: B.textMid, marginBottom: 10 }}>
                First upload keeps these addresses. They are off Ready and will not get another send from this list.
              </div>
              <button onClick={() => setShowHeld(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: B.purple, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                {showHeld ? "Hide names" : "Show names"}
              </button>
              {showHeld && (
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {heldLeads.map(l => (
                    <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${B.border}`, gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: B.text }}>{l.orgName || l.contactName || l.email}</div>
                        <div style={{ fontSize: 11, color: B.muted }}>{l.email}</div>
                      </div>
                      <div style={{ fontSize: 10, color: B.purple, textAlign: "right", flexShrink: 0 }}>
                        {l.heldByBatch ? `Kept by ${l.heldByBatch}` : "Kept by earlier list"}
                        {l.touches?.some(t => t?.sentAt) ? <div style={{ color: B.muted, marginTop: 2 }}>already emailed here — no more touches</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {intentLeads.length > 0 && (
            <div style={{ background: B.tealBg, border: `1px solid ${B.teal}`, borderLeft: `6px solid ${B.teal}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: B.teal, marginBottom: 2 }}>
                {intentLeads.length} POSITIVE INTENT
              </div>
              <div style={{ fontSize: 11, color: B.textMid, marginBottom: 10 }}>
                They engaged. Email 2/3 will not send. They stay on this list so you can still see them.
              </div>
              <button onClick={() => setShowIntent(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: B.teal, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                {showIntent ? "Hide names" : "Show names"}
              </button>
              {showIntent && (
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {intentLeads.map(l => (
                    <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${B.border}`, gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: B.text }}>{l.orgName || l.contactName || l.email}</div>
                        <div style={{ fontSize: 11, color: B.muted }}>{l.email}</div>
                      </div>
                      <button onClick={() => markLeadOutcome(l.id, null)} style={{ background: "none", border: "none", color: B.teal, fontSize: 10, cursor: "pointer", padding: 0, textDecoration: "underline" }}>Put back on sends</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {manualLeads.length > 0 && (
            <div style={{ background: B.blueBg, border: `1px solid ${B.blue}`, borderLeft: `6px solid ${B.blue}`, borderRadius: 10, padding: "14px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: B.blue, marginBottom: 2 }}>
                {manualLeads.length} MANUAL FOLLOW-UP
              </div>
              <div style={{ fontSize: 11, color: B.textMid, marginBottom: 10 }}>
                Someone here knows them or will handle this by hand. No more automated emails.
              </div>
              <button onClick={() => setShowManual(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: B.blue, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                {showManual ? "Hide names" : "Show names"}
              </button>
              {showManual && (
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {manualLeads.map(l => (
                    <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${B.border}`, gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: B.text }}>{l.orgName || l.contactName || l.email}</div>
                        <div style={{ fontSize: 11, color: B.muted }}>{l.email}{l.manualFollowUpNote ? ` · ${l.manualFollowUpNote}` : ""}</div>
                      </div>
                      <button onClick={() => markLeadOutcome(l.id, null)} style={{ background: "none", border: "none", color: B.blue, fontSize: 10, cursor: "pointer", padding: 0, textDecoration: "underline" }}>Put back on sends</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {stepIndices.length > 0 && (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${B.border}`, fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", color: B.muted, letterSpacing: 1 }}>
                EMAIL STEPS — shows what's already there; edit and push to everyone on that version
              </div>
              {stepIndices.map(i => {
                const stepKey = `step${i}`;
                const atStep = sendableLeads.filter(l => l.touches[i]);
                const pendingAtStep = atStep.filter(l => !l.touches[i].sentAt);
                const stepOpen = expandedStepKey === stepKey;

                // Groups pending touches by exact subject+body — reveals
                // whether this step is one shared email (everyone matches,
                // pre-fill it) or several distinct versions (e.g. per
                // segment), so editing doesn't mean guessing which of 300
                // rows is representative or touching each one by hand.
                // Already-sent touches are immutable, so they're not grouped.
                const groups = new Map();
                pendingAtStep.forEach(l => {
                  const t = l.touches[i];
                  const key = `${t.subject} ${t.body}`;
                  if (!groups.has(key)) groups.set(key, { subject: t.subject, body: t.body, leadIds: [], orgNames: [] });
                  const g = groups.get(key);
                  g.leadIds.push(l.id);
                  g.orgNames.push(l.orgName);
                });
                const variants = [...groups.values()].sort((a, b) => b.leadIds.length - a.leadIds.length);

                return (
                  <div key={stepKey} style={{ borderBottom: `1px solid ${B.border}` }}>
                    <div onClick={() => setExpandedStepKey(stepOpen ? null : stepKey)} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: stepOpen ? B.surface : B.white }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: B.text }}>EMAIL {i + 1}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 10, color: B.textMid, fontWeight: 600 }}>
                          {atStep.length} organization{atStep.length !== 1 ? "s" : ""}
                          {pendingAtStep.length < atStep.length ? ` · ${pendingAtStep.length} pending` : ""}
                          {variants.length > 1 ? ` · ${variants.length} versions` : ""}
                        </span>
                        <span style={{ color: B.muted, fontSize: 11 }}>{stepOpen ? "▾" : "▸"}</span>
                      </div>
                    </div>
                    {stepOpen && (
                      <div style={{ padding: "4px 16px 16px" }}>
                        {pendingAtStep.length === 0 ? (
                          <div style={{ fontSize: 11, color: B.muted, padding: "8px 0" }}>Every organization at this step has already been sent — nothing left to edit.</div>
                        ) : variants.length === 1 ? (
                          <>
                            <div style={{ fontSize: 10, color: B.green, marginBottom: 8 }}>
                              ✓ Same email for all {variants[0].leadIds.length} organization{variants[0].leadIds.length !== 1 ? "s" : ""} pending at this step.
                            </div>
                            <StepEditor
                              draftKey={stepKey} seed={variants[0]} templates={templates} updateTemplateField={updateTemplateField}
                              onApply={(subject, body) => applyStepToAll(i, subject, body, variants[0].leadIds, stepKey)}
                              applyLabel={`APPLY TO ALL ${variants[0].leadIds.length}`}
                              hint={<>Use <code>{"{{orgName}}"}</code>, <code>{"{{firstName}}"}</code>, <code>{"{{sport}}"}</code> — resolved per organization when applied.</>}
                            />
                          </>
                        ) : variants.length <= EMAIL_VARIANT_CAP ? (
                          <>
                            <div style={{ fontSize: 10, color: B.orange, marginBottom: 10 }}>
                              {variants.length} different versions found across {pendingAtStep.length} organizations — edit and apply each one separately below.
                            </div>
                            {variants.map((v, vi) => {
                              const variantKey = `${stepKey}-v${vi}`;
                              const variantOpen = expandedVariantKey === variantKey;
                              return (
                                <div key={variantKey} style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 6, marginBottom: 8, overflow: "hidden" }}>
                                  <div onClick={() => setExpandedVariantKey(variantOpen ? null : variantKey)} style={{ padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", gap: 10 }}>
                                    <div style={{ fontSize: 11, color: B.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{v.subject}</div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                      <span style={{ fontSize: 9, color: B.muted }}>{v.leadIds.length} org{v.leadIds.length !== 1 ? "s" : ""}</span>
                                      <span style={{ color: B.muted, fontSize: 10 }}>{variantOpen ? "▾" : "▸"}</span>
                                    </div>
                                  </div>
                                  {variantOpen && (
                                    <div style={{ padding: "0 12px 12px" }}>
                                      <div style={{ fontSize: 9, color: B.muted, marginBottom: 8 }}>
                                        {v.orgNames.slice(0, 8).join(", ")}{v.orgNames.length > 8 ? ` +${v.orgNames.length - 8} more` : ""}
                                      </div>
                                      <StepEditor
                                        draftKey={variantKey} seed={v} templates={templates} updateTemplateField={updateTemplateField}
                                        onApply={(subject, body) => applyStepToAll(i, subject, body, v.leadIds, variantKey)}
                                        applyLabel={`APPLY TO THESE ${v.leadIds.length}`}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 10, color: B.muted, marginBottom: 10 }}>
                              {variants.length} different versions found across {pendingAtStep.length} organizations — too many to show individually. Edit each organization's copy directly below, or write one new version to replace all of them.
                            </div>
                            <StepEditor
                              draftKey={stepKey} seed={{ subject: "", body: "" }} templates={templates} updateTemplateField={updateTemplateField}
                              onApply={(subject, body) => applyStepToAll(i, subject, body, null, stepKey)}
                              applyLabel={`REPLACE ALL ${pendingAtStep.length} WITH ONE NEW VERSION`}
                              hint={<>Use <code>{"{{orgName}}"}</code>, <code>{"{{firstName}}"}</code>, <code>{"{{sport}}"}</code> — resolved per organization when applied.</>}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(day1Ready.length > 0 || goRun) && (
            <Day1GoPanel
              readyCount={day1Ready.length}
              pace={goPace}
              setPace={setGoPace}
              run={goRun}
              onGo={startDay1Go}
              onStop={() => { goAbortRef.current = true; }}
              canGo={!!batchId}
            />
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 11, color: B.muted }}>{sentTouchCount} of {totalTouchCount} email{totalTouchCount !== 1 ? "s" : ""} sent so far.</div>
            <GBtn onClick={syncWithBradInbox} disabled={syncingGmail || !!goRun} style={{ fontSize: 10 }}>
              {syncingGmail ? "CHECKING BRAD'S INBOX…" : "🔄 CHECK BRAD'S INBOX (sent + bounces)"}
            </GBtn>
          </div>

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
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl c={B.purple}>ON EARLIER LIST</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.purple, marginTop: 4 }}>{heldLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>first upload keeps them</div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl c={B.red}>BOUNCED</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.red, marginTop: 4 }}>{bouncedLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>flagged, opted out, removed from sends</div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl c={B.teal}>POSITIVE INTENT</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.teal, marginTop: 4 }}>{intentLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>engaged — no Email 2/3</div>
            </div>
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 160 }}>
              <Lbl c={B.blue}>MANUAL FOLLOW-UP</Lbl>
              <div style={{ fontSize: 24, fontWeight: 700, color: B.blue, marginTop: 4 }}>{manualLeads.length}</div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>we know them — handle by hand</div>
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
                  <input value={bulkDraft.subject} onChange={e => setBulkDraft(d => ({ ...d, subject: e.target.value }))} placeholder="Subject" style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "7px 10px", fontSize: 13, fontWeight: 600, marginBottom: 6, boxSizing: "border-box" }} />
                  <textarea value={bulkDraft.body} onChange={e => setBulkDraft(d => ({ ...d, body: e.target.value }))} placeholder="Body" rows={10} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, resize: "vertical", marginBottom: 6, boxSizing: "border-box" }} />
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
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${B.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: B.textMid }}>
                Find someone and mark <b style={{ color: B.teal }}>Positive intent</b> or <b style={{ color: B.blue }}>Manual follow-up</b> so they do not get the next email.
              </div>
              <input value={leadQuery} onChange={e => setLeadQuery(e.target.value)} placeholder="Search school, name, or email"
                style={{ width: 260, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 12, boxSizing: "border-box" }} />
            </div>
            {filteredVisibleLeads.length === 0 && (
              <div style={{ padding: "16px", fontSize: 12, color: B.muted }}>{leadQuery.trim() ? "No organizations match that search." : "No organizations on this list."}</div>
            )}
            {filteredVisibleLeads.map(lead => {
              const isOpen = expandedId === lead.id;
              const dates = preview.perLeadDates[lead.id] || [];
              const canAddMore = lead.touches.length < 3 && !isApproved && !leadStoppedAuto(lead);
              const draftHere = followupDraft?.leadId === lead.id;
              const stopped = leadStoppedAuto(lead);
              return (
                <div key={lead.id} style={{ borderBottom: `1px solid ${B.border}`, background: lead.bounced ? B.redBg : lead.positiveIntent ? B.tealBg : lead.manualFollowUp ? B.blueBg : "transparent" }}>
                  <div onClick={() => setExpandedId(isOpen ? null : lead.id)} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: isOpen ? B.surface : (lead.bounced ? B.redBg : lead.positiveIntent ? B.tealBg : lead.manualFollowUp ? B.blueBg : B.white) }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: B.text }}>{lead.orgName}</div>
                      <div style={{ fontSize: 11, color: lead.bounced ? B.red : B.muted, marginTop: 1 }}>
                        {lead.contactName && lead.contactName !== "-" ? lead.contactName + " · " : ""}
                        <span style={lead.bounced ? { textDecoration: "line-through" } : undefined}>{lead.email}</span>
                        {lead.sport ? ` · ${lead.sport}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {lead.angle && <span style={{ fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", color: B.purple, background: B.purpleBg, padding: "3px 8px", borderRadius: 10 }}>{lead.angle}</span>}
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }} onClick={e => e.stopPropagation()}>
                        {!lead.bounced && !lead.heldForEarlier && (
                          <>
                            <button onClick={() => markLeadOutcome(lead.id, lead.positiveIntent ? null : "intent")}
                              title="They engaged — stop Email 2/3"
                              style={{ background: lead.positiveIntent ? B.teal : B.tealBg, color: lead.positiveIntent ? B.white : B.teal, border: `1px solid ${B.teal}50`, borderRadius: 4, padding: "3px 8px", fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .3, cursor: "pointer" }}>
                              INTENT
                            </button>
                            <button onClick={() => markLeadOutcome(lead.id, lead.manualFollowUp ? null : "manual")}
                              title="We know them — handle this by hand"
                              style={{ background: lead.manualFollowUp ? B.blue : B.blueBg, color: lead.manualFollowUp ? B.white : B.blue, border: `1px solid ${B.blue}50`, borderRadius: 4, padding: "3px 8px", fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .3, cursor: "pointer" }}>
                              MANUAL
                            </button>
                          </>
                        )}
                        {lead.bounced ? (
                          <button onClick={() => setExpandedId(isOpen ? null : lead.id)}
                            style={{ background: B.red, color: B.white, border: "none", borderRadius: 4, padding: "4px 9px", fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, letterSpacing: .3, cursor: "pointer" }}>
                            ⚠ BAD EMAIL — UPDATE
                          </button>
                        ) : stopped ? (
                          <span style={{ fontSize: 9, fontWeight: 700, color: lead.positiveIntent ? B.teal : B.blue }}>
                            {lead.positiveIntent ? "INTENT — no more emails" : "MANUAL — handle by hand"}
                          </span>
                        ) : lead.touches.map((t, i) => {
                          const sentInfo = touchSentInfo(lead, i);
                          const sendKey = `${lead.id}-${i}`;
                          if (sentInfo.sent) return <span key={i} title={sentInfo.when ? `Sent ${fmtWhen(sentInfo.when)}` : "Sent"} style={{ fontSize: 9, color: B.green, fontWeight: 700 }}>✓{i + 1}</span>;
                          return (
                            <button key={i} onClick={() => sendTouchNow(lead, i)} disabled={!!goRun || sendingKey === sendKey || !touchHasCopy(t)}
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
                      {lead.positiveIntent && (
                        <div style={{ background: B.white, border: `1px solid ${B.teal}40`, borderRadius: 6, padding: 10, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div style={{ fontSize: 11, color: B.teal, fontWeight: 600 }}>Positive intent — they will not get Email 2 or 3 from this list.</div>
                          <GBtn onClick={() => markLeadOutcome(lead.id, null)} style={{ fontSize: 9, padding: "5px 10px" }}>PUT BACK ON SENDS</GBtn>
                        </div>
                      )}
                      {lead.manualFollowUp && (
                        <div style={{ background: B.white, border: `1px solid ${B.blue}40`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: B.blue, fontWeight: 600 }}>Manual follow-up — someone here knows them or will handle this. No automated emails.</div>
                            <GBtn onClick={() => markLeadOutcome(lead.id, null)} style={{ fontSize: 9, padding: "5px 10px" }}>PUT BACK ON SENDS</GBtn>
                          </div>
                          <input value={lead.manualFollowUpNote || ""} placeholder="Optional note — why we know them"
                            onChange={e => {
                              const note = e.target.value;
                              setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, manualFollowUpNote: note } : l));
                            }}
                            style={{ width: "100%", background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 12, boxSizing: "border-box" }} />
                        </div>
                      )}
                      {lead.bounced && (
                        <div style={{ background: B.white, border: `1px solid ${B.red}40`, borderRadius: 6, padding: 10, marginBottom: 10 }}>
                          <div style={{ fontSize: 11, color: B.red, fontWeight: 600, marginBottom: 6 }}>
                            ⚠ This address bounced: <span style={{ textDecoration: "line-through" }}>{lead.email}</span> — opted out and removed from sends until fixed.
                          </div>
                          <BounceFixBox
                            suggestedEmail={suggestedEmails[lead.id]}
                            draftEmail={emailFixDraft[lead.id]}
                            onDraftChange={v => setEmailFixDraft(prev => ({ ...prev, [lead.id]: v }))}
                            onFix={email => fixLeadEmail(lead.id, email)}
                            onResolve={reason => resolveBounce(lead.id, reason)}
                          />
                        </div>
                      )}
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
                          <input value={t.subject} disabled={sentInfo.sent} onChange={e => updateTouchField(lead.id, i, "subject", e.target.value)}
                            style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "7px 10px", fontSize: 13, fontWeight: 600, marginBottom: 6, boxSizing: "border-box" }} />
                          <textarea value={t.body} disabled={sentInfo.sent} onChange={e => updateTouchField(lead.id, i, "body", e.target.value)}
                            rows={10} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, resize: "vertical", boxSizing: "border-box" }} />
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 7 }}>
                            {sentInfo.sent ? (
                              <span style={{ fontSize: 10, color: B.green, fontWeight: 600 }}>✓ Sent{sentInfo.when ? ` ${fmtWhen(sentInfo.when)}` : ""}</span>
                            ) : lead.bounced ? (
                              <span style={{ fontSize: 10, color: B.red, fontWeight: 600 }}>⚠ Bad email — fix it above before sending</span>
                            ) : stopped ? (
                              <span style={{ fontSize: 10, color: lead.positiveIntent ? B.teal : B.blue, fontWeight: 600 }}>
                                {lead.positiveIntent ? "Positive intent — not sending" : "Manual follow-up — not sending"}
                              </span>
                            ) : (
                              <OBtn onClick={() => sendTouchNow(lead, i)} disabled={!!goRun || sendingKey === sendKey || !touchHasCopy(t)} style={{ fontSize: 9, padding: "6px 12px" }}>
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
                          <input value={followupDraft.subject} onChange={e => setFollowupDraft(d => ({ ...d, subject: e.target.value }))} placeholder="Subject" style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "7px 10px", fontSize: 13, fontWeight: 600, marginBottom: 6, boxSizing: "border-box" }} />
                          <textarea value={followupDraft.body} onChange={e => setFollowupDraft(d => ({ ...d, body: e.target.value }))} placeholder="Body" rows={10} style={{ width: "100%", background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, resize: "vertical", marginBottom: 6, boxSizing: "border-box" }} />
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setShowSkipped(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: B.textMid, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                  {skippedLeads.length} organization{skippedLeads.length !== 1 ? "s" : ""} need a different channel — {showSkipped ? "hide" : "show"}
                </button>
                {reclassifiableSkipped.length > 0 && (
                  <GBtn onClick={reclassifyAsEmail} style={{ fontSize: 9, padding: "5px 12px" }}>
                    → MOVE {reclassifiableSkipped.length} WITH A VALID EMAIL TO ACTIVE LIST
                  </GBtn>
                )}
              </div>
              {showSkipped && (
                <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
                  {skippedLeads.map(l => {
                    const canReclassify = canReclassifyToEmail(l);
                    return (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${B.border}`, gap: 8 }}>
                        <div style={{ fontSize: 11, color: B.text, minWidth: 0 }}>
                          {l.orgName}{canReclassify && <span style={{ color: B.muted, marginLeft: 6 }}>{l.email}</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{ fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", color: CHANNEL_COLOR[l.channel?.toLowerCase()] || B.muted }}>{l.action || l.channel}</span>
                          {canReclassify && (
                            <button onClick={() => setLeads(prev => prev.map(x => x.id === l.id ? { ...x, sendable: true, channel: "Email" } : x))}
                              style={{ background: "none", border: "none", color: B.blue, fontSize: 9, fontFamily: "'Lexend Zetta',sans-serif", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                              → EMAIL
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <GBtn onClick={backToList}>← Back to Bulk Outreach</GBtn>
            {!isApproved && (
              <OBtn onClick={approveAndSchedule} disabled={committing || !sendableLeads.length} style={{ padding: "10px 22px", fontSize: 12 }}>
                {committing ? "SCHEDULING…" : "✓ APPROVE & SCHEDULE"}
              </OBtn>
            )}
          </div>
        </>
      )}
    </div>
  );
}
