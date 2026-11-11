import { useEffect, useState } from "react";
import { radarFetch } from "../lib/session.js";

const B = {
  white: "#FFFFFF", surface: "#F8F8F8", orange: "#F37321", border: "#E0E0E0",
  text: "#1A1A1A", muted: "#7A7A7A", green: "#1E8F4E", red: "#C0392B", redBg: "#FDECEA",
  yellow: "#C77800", yellowBg: "#FFF8E6",
};
const PLACEHOLDER = /\[([A-Z][A-Z0-9 _/-]{1,40})\]/;

/** Same rules the server enforces before sending (api/_lib/followups/repDraft.js). */
function blockerFor(body) {
  const text = String(body || "").trim();
  if (!text) return "The message is empty.";
  if (/\[REVIEW\b/i.test(text)) return "Remove the [REVIEW …] note after checking the flagged details.";
  const m = PLACEHOLDER.exec(text);
  if (m) return `Fill in ${m[0]} before sending.`;
  return null;
}

/**
 * Review a follow-up draft and send it from the rep's own Gmail, in the original thread.
 * Nothing is sent unless the rep clicks Send here.
 */
export default function ReviewSendModal({ item, onClose, onSent }) {
  const [draft, setDraft] = useState(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    radarFetch(`/api/followups/draft?itemId=${encodeURIComponent(item.id)}`)
      .then(async r => {
        const d = await r.json();
        if (!live) return;
        if (!r.ok) { setErr(d.error || "Could not load the draft."); return; }
        setDraft(d);
        setBody(d.body || "");
      })
      .catch(() => live && setErr("Could not load the draft."));
    return () => { live = false; };
  }, [item.id]);

  const blocker = draft ? blockerFor(body) : null;

  const send = async () => {
    if (blocker || sending) return;
    setSending(true);
    setErr("");
    try {
      const r = await radarFetch("/api/followups/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Send failed");
      onSent?.();
    } catch (e) {
      setErr(e.message);
      setSending(false);
    }
  };

  const field = { fontSize: 11, color: B.text, padding: "4px 0", borderBottom: `1px solid ${B.border}` };
  return (
    <div role="dialog" aria-modal="true" aria-label="Review and send follow-up"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && !sending && onClose()}>
      <div style={{ background: B.white, borderRadius: 8, width: "min(680px, 100%)", maxHeight: "90vh", overflow: "auto", padding: 18, fontFamily: "'Lexend',sans-serif" }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2.5, marginBottom: 8 }}>REVIEW &amp; SEND</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{item.contactName || item.contactEmail}</div>
        {!draft && !err && <div style={{ fontSize: 12, color: B.muted }}>Loading draft from your Gmail…</div>}
        {draft && (
          <>
            <div style={field}><span style={{ color: B.muted }}>To:</span> {draft.to}</div>
            {draft.cc && <div style={field}><span style={{ color: B.muted }}>Cc:</span> {draft.cc}</div>}
            <div style={{ ...field, marginBottom: 10 }}><span style={{ color: B.muted }}>Subject:</span> {draft.subject}</div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={14} aria-label="Message"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${B.border}`, borderRadius: 4, padding: 10, fontSize: 13, lineHeight: 1.5, fontFamily: "'Lexend',sans-serif" }} />
            {blocker && <div style={{ background: B.yellowBg, color: B.yellow, padding: "6px 10px", borderRadius: 4, fontSize: 11, marginTop: 8 }}>{blocker}</div>}
          </>
        )}
        {err && <div style={{ background: B.redBg, color: B.red, padding: "6px 10px", borderRadius: 4, fontSize: 11, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} disabled={sending}
            style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 4, padding: "8px 14px", fontSize: 12, color: B.text }}>Close</button>
          <button onClick={send} disabled={!draft || !!blocker || sending}
            style={{ background: !draft || blocker ? B.border : B.orange, color: !draft || blocker ? B.muted : "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 12, fontWeight: 600 }}>
            {sending ? "Sending…" : "Send from my Gmail"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: B.muted, marginTop: 8 }}>Sends in the same Gmail thread. Your edits are saved to the draft first.</div>
      </div>
    </div>
  );
}
