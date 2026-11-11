import { useCallback, useEffect, useMemo, useState } from "react";
import RadarInboxCard from "./RadarInboxCard.jsx";
import ReviewSendModal from "./ReviewSendModal.jsx";
import { radarFetch } from "../lib/session.js";

const B = {
  pageBg: "#F4F4F4", white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", orangeBg: "#FEF3EC",
  black: "#000000", border: "#E0E0E0",
  text: "#1A1A1A", muted: "#7A7A7A",
  green: "#1E8F4E", greenBg: "#EAF7EE",
  yellow: "#C77800", yellowBg: "#FFF8E6",
  red: "#C0392B", redBg: "#FDECEA",
  blue: "#1A5FA8", blueBg: "#E8F0FA",
};

function draftBadge(status) {
  if (status === "drafted") return { label: "Draft ready", bg: B.greenBg, c: B.green };
  if (status === "needs_input") return { label: "Needs input", bg: B.yellowBg, c: B.yellow };
  if (status === "sent") return { label: "Sent", bg: B.blueBg, c: B.blue };
  return { label: "No draft", bg: B.surface, c: B.muted };
}

export default function FollowUpRadarPage({ s, cu }) {
  const userId = cu?.id || s?.currentUserId || "";
  const isAdmin = !!cu?.isAdmin;
  const [tab, setTab] = useState("owes_reply");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ owesReply: 0, awaiting: 0 });
  const [team, setTeam] = useState(null);
  const [teamDetails, setTeamDetails] = useState(false);
  const [deals, setDeals] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [linkFor, setLinkFor] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [activity, setActivity] = useState([]);
  const [reviewing, setReviewing] = useState(null);

  // Identity and admin status come from the signed session on the server.

  const loadCounts = useCallback(() => {
    if (!userId) return;
    const roll = isAdmin ? `&rollup=1${teamDetails ? "&details=1" : ""}` : "";
    radarFetch(`/api/radar/items?counts=1&deals=1${roll}`)
      .then(async r => {
        const d = await r.json();
        if (r.status === 401) setErr(d.error || "Sign in again to use Follow-Up Radar.");
        return d;
      })
      .then(d => {
        setCounts({ owesReply: d.owesReply || 0, awaiting: d.awaiting || 0 });
        setTeam(d.team || null);
        setDeals(d.deals || []);
      })
      .catch(() => {});
  }, [userId, isAdmin, teamDetails]);

  const loadItems = useCallback(() => {
    if (!userId) return;
    if (tab === "activity") {
      radarFetch("/api/radar/items?activity=1")
        .then(r => r.json())
        .then(d => setActivity(d.threads || []))
        .catch(e => setErr(e.message));
      return;
    }
    radarFetch(`/api/radar/items?bucket=${tab}`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(e => setErr(e.message));
  }, [userId, tab]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadItems(); }, [loadItems]);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => (b.intentScore - a.intentScore) || ((b.daysSinceLastTouch || 0) - (a.daysSinceLastTouch || 0)));
  }, [items]);

  const patch = async (id, action, extra = {}) => {
    setBusy(id + action);
    try {
      const r = await radarFetch("/api/radar/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "update failed");
      loadItems();
      loadCounts();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const draftRows = async (ids, regenerate = false) => {
    if (!ids.length) return;
    setBusy("draft");
    setErr("");
    try {
      const r = await radarFetch("/api/radar/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: regenerate ? "regenerate" : "create", skipRecentCheck: regenerate }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "draft failed");
      const failed = (d.results || []).filter(x => !x.ok && !x.skipped);
      if (failed.length) setErr(failed.map(f => f.error).join("; "));
      loadItems();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const writeAndReview = async (row) => {
    setBusy("draft");
    setErr("");
    try {
      const r = await radarFetch("/api/radar/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [row.id], action: "create", skipRecentCheck: true }),
      });
      const d = await r.json();
      const result = (d.results || [])[0];
      if (!r.ok || !result?.ok) throw new Error(result?.error || d.error || "Could not write the draft");
      setReviewing(row);
      loadItems();
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const toggle = (id) => setSel(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div style={{ padding: "22px 26px", maxWidth: 1100 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: B.black }}>MY FOLLOW-UPS</div>
        <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.muted, marginTop: 4 }}>
          Who you owe a reply, who is waiting on you, and your recent email, all from your own Gmail. Drafts are written for you;
          nothing is sent until you review it and click Send.
        </div>
        <div style={{ width: 30, height: 3, background: B.orange, marginTop: 8, borderRadius: 2 }} />
      </div>

      <RadarInboxCard userId={userId} isAdmin={isAdmin} hideAdminHint />

      {isAdmin && (
        <div className="card" style={{ padding: 14, marginBottom: 13, borderTop: `3px solid ${B.blue}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.blue, letterSpacing: 2 }}>TEAM ROLLUP</div>
            <button onClick={() => setTeamDetails(v => !v)} style={{ background: "none", border: `1px solid ${B.border}`, borderRadius: 4, padding: "4px 8px", fontSize: 10, color: B.text }}>
              {teamDetails ? "Counts only" : "Show details"}
            </button>
          </div>
          {!team?.length && <div style={{ fontSize: 12, color: B.muted }}>No connected team inboxes with open radar items.</div>}
          {(team || []).map(t => (
            <div key={t.userId} style={{ display: "flex", gap: 16, fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${B.border}` }}>
              <span style={{ minWidth: 160, color: B.text }}>{t.userId}</span>
              <span style={{ color: B.orange }}>{t.owesReply} owe a reply</span>
              <span style={{ color: B.muted }}>{t.awaiting} waiting</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {[
          { id: "owes_reply", label: "You owe a reply", n: counts.owesReply },
          { id: "awaiting_them", label: "Waiting on them", n: counts.awaiting },
          { id: "activity", label: "Recent activity", n: null },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSel(new Set()); }}
            style={{ background: tab === t.id ? B.orange : B.white, color: tab === t.id ? "#fff" : B.text, border: `1px solid ${tab === t.id ? B.orange : B.border}`, borderRadius: 16, padding: "6px 12px", fontSize: 12 }}>
            {t.label} {t.n != null && <strong>{t.n}</strong>}
          </button>
        ))}
        {tab !== "activity" && <button disabled={!sel.size || busy === "draft"} onClick={() => draftRows([...sel])}
          style={{ marginLeft: "auto", background: B.green, color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 11, opacity: sel.size ? 1 : 0.5 }}>
          Draft all ({sel.size})
        </button>}
      </div>

      {err && <div style={{ background: B.redBg, color: B.red, padding: "8px 12px", borderRadius: 4, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: B.greenBg, color: B.green, padding: "8px 12px", borderRadius: 4, fontSize: 12, marginBottom: 10 }}>{note}</div>}

      {reviewing && (
        <ReviewSendModal
          item={reviewing}
          onClose={() => setReviewing(null)}
          onSent={() => {
            setNote(`Sent to ${reviewing.contactName || reviewing.contactEmail}. It moved to Waiting on them.`);
            setReviewing(null);
            loadItems();
            loadCounts();
          }}
        />
      )}

      {tab === "activity" && (
        <div className="card" style={{ overflow: "hidden" }}>
          {!activity.length && <div style={{ padding: 24, color: B.muted, textAlign: "center", fontSize: 12 }}>No email activity in the last 14 days yet. It appears after your first sync.</div>}
          {activity.map(t => (
            <a key={t.threadId} href={t.gmailUrl} target="_blank" rel="noreferrer"
              style={{ display: "flex", gap: 12, padding: "9px 12px", borderTop: `1px solid ${B.border}`, textDecoration: "none", color: B.text, fontSize: 12, alignItems: "baseline" }}>
              <span style={{ minWidth: 86, color: B.muted, fontSize: 11 }}>{t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleDateString() : ""}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{t.subject}</span>
              <span style={{ color: B.muted, fontSize: 11 }}>{t.participants.join(", ")}</span>
              {t.followUp && <span style={{ background: B.orangeBg, color: B.orange, borderRadius: 8, padding: "1px 7px", fontSize: 10 }}>{t.followUp === "owes_reply" ? "You owe a reply" : t.followUp === "awaiting_them" ? "Waiting on them" : t.followUp.replace("_", " ")}</span>}
            </a>
          ))}
        </div>
      )}

      {tab !== "activity" && <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Lexend',sans-serif" }}>
          <thead>
            <tr style={{ background: B.surface, textAlign: "left", fontSize: 9, color: B.muted, letterSpacing: 0.6 }}>
              <th style={{ padding: 8, width: 28 }} />
              <th style={{ padding: 8 }}>Contact</th>
              <th style={{ padding: 8 }}>Deal</th>
              <th style={{ padding: 8 }}>Last touch</th>
              <th style={{ padding: 8 }}>Idle</th>
              <th style={{ padding: 8 }}>Commitments</th>
              <th style={{ padding: 8 }}>Draft</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {!sorted.length && (
              <tr><td colSpan={8} style={{ padding: 24, color: B.muted, textAlign: "center" }}>Nothing in this tab. Connect Gmail and re-sync, or you're caught up.</td></tr>
            )}
            {sorted.map(row => {
              const badge = draftBadge(row.draftStatus);
              const gmail = row.gmailPermalink || (row.threadId && !row.threadId.startsWith("brad:") ? `https://mail.google.com/mail/u/0/#inbox/${row.threadId}` : null);
              return (
                <tr key={row.id} style={{ borderTop: `1px solid ${B.border}`, verticalAlign: "top" }}>
                  <td style={{ padding: 8 }}>
                    <input type="checkbox" checked={sel.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{row.contactName || row.contactEmail || "—"}</div>
                    <div style={{ color: B.muted, fontSize: 11 }}>{row.contactEmail}</div>
                    <div style={{ color: B.text, fontSize: 11 }}>{row.organization}{row.orgType ? ` · ${row.orgType.replace("_", " ")}` : ""}</div>
                    {row.source === "brad" && <div style={{ color: B.orange, fontSize: 10, marginTop: 2 }}>Brad positive reply</div>}
                  </td>
                  <td style={{ padding: 8, maxWidth: 240 }}>
                    <div>{row.dealContext || "—"}</div>
                    {row.dealStage && <div style={{ marginTop: 4, display: "inline-block", background: B.blueBg, color: B.blue, borderRadius: 8, padding: "1px 6px", fontSize: 10 }}>{row.dealStage}</div>}
                    <div style={{ color: B.muted, fontSize: 10, marginTop: 4 }}>Intent {row.intentScore}</div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <div>{row.lastTouchBy === "us" ? "Us" : "Them"}</div>
                    <div style={{ color: B.muted, fontSize: 10 }}>{row.lastTouchAt ? new Date(row.lastTouchAt).toLocaleDateString() : "—"}</div>
                  </td>
                  <td style={{ padding: 8 }}>{row.daysSinceLastTouch ?? "—"}d</td>
                  <td style={{ padding: 8, maxWidth: 180 }}>
                    {(row.openCommitments || []).length
                      ? row.openCommitments.map((c, i) => <div key={i} style={{ fontSize: 11 }}>• {c}</div>)
                      : <span style={{ color: B.muted }}>—</span>}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ background: badge.bg, color: badge.c, borderRadius: 8, padding: "2px 7px", fontSize: 10 }}>{badge.label}</span>
                  </td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      {row.draftStatus === "drafted" || row.draftStatus === "needs_input" ? (
                        <>
                          <button onClick={() => setReviewing(row)}
                            style={{ background: B.orange, color: "#fff", border: "none", borderRadius: 3, padding: "5px 10px", fontSize: 11, fontWeight: 600 }}>
                            Review &amp; send
                          </button>
                          <button disabled={busy === "draft"} onClick={() => draftRows([row.id], true)}
                            style={{ background: "none", border: "none", color: B.muted, fontSize: 10, padding: 0 }}>
                            Rewrite draft
                          </button>
                        </>
                      ) : (
                        <button disabled={busy === "draft" || row.threadId?.startsWith("brad:")} onClick={() => writeAndReview(row)}
                          title={row.threadId?.startsWith("brad:") ? "Brad replies are answered from the original Brad thread" : ""}
                          style={{ background: B.orange, color: "#fff", border: "none", borderRadius: 3, padding: "5px 10px", fontSize: 11, fontWeight: 600 }}>
                          {busy === "draft" ? "Writing…" : "Write follow-up"}
                        </button>
                      )}
                      {gmail && <a href={gmail} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: B.blue }}>Open in Gmail</a>}
                      <div style={{ display: "flex", gap: 4 }}>
                        {[3, 7, 14].map(d => (
                          <button key={d} onClick={() => patch(row.id, "snooze", { days: d })} style={{ background: "none", border: `1px solid ${B.border}`, borderRadius: 3, padding: "2px 5px", fontSize: 9, color: B.muted }}>Snooze {d}d</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => patch(row.id, "closed_won")} style={{ background: "none", border: "none", color: B.green, fontSize: 10 }}>Won</button>
                        <button onClick={() => patch(row.id, "closed_lost")} style={{ background: "none", border: "none", color: B.red, fontSize: 10 }}>Lost</button>
                        <button onClick={() => setLinkFor(row.id)} style={{ background: "none", border: "none", color: B.blue, fontSize: 10 }}>Link deal</button>
                      </div>
                      {linkFor === row.id && (
                        <select defaultValue={row.dealId || ""} onChange={e => {
                          const deal = deals.find(d => d.id === e.target.value);
                          patch(row.id, "link", { dealId: e.target.value || null, dealStage: deal?.stage || "" });
                          setLinkFor(null);
                        }} style={{ fontSize: 10, maxWidth: 160 }}>
                          <option value="">— none —</option>
                          {deals.map(d => <option key={d.id} value={d.id}>{d.name} {d.stage ? `(${d.stage})` : ""}</option>)}
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
