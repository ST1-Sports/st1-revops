import { useEffect, useState } from "react";

const B = {
  white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", border: "#E0E0E0",
  text: "#1A1A1A", muted: "#7A7A7A",
  green: "#1E8F4E", yellow: "#C77800", red: "#C0392B",
};

export default function RadarInboxCard({ userId, isAdmin = false, hideAdminHint = false }) {
  const [conn, setConn] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => {
    if (!userId) return;
    fetch(`/api/radar/connection?userId=${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(d => setConn(d.connection || null))
      .catch(() => {});
  };

  useEffect(() => { load(); }, [userId]);

  const act = async (method, body) => {
    setBusy(method);
    setMsg("");
    try {
      const r = await fetch("/api/radar/connection", {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ userId, ...body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      setConn(d.connection || null);
      if (d.stats) setMsg(`Synced ${d.stats.fetched || 0} threads · ${d.stats.radar || 0} on radar`);
      if (d.disconnected) { setConn(null); setMsg("Disconnected"); }
    } catch (e) {
      setMsg(e.message);
    }
    setBusy("");
    load();
  };

  const connected = conn && conn.status !== "disconnected" && conn.hasToken;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 13, borderTop: `3px solid ${B.orange}` }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.orange, letterSpacing: 2.5, marginBottom: 10 }}>FOLLOW-UP RADAR INBOX</div>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, marginBottom: 10, lineHeight: 1.5 }}>
        Connect <strong>your</strong> Gmail. Radar reads sent mail and creates unsent threaded drafts — it never sends.
        Scopes: gmail.readonly + gmail.compose. Configure the Google OAuth app as Internal to st1sports.com.
      </div>
      {connected ? (
        <div>
          <div style={{ fontSize: 12, color: B.green, marginBottom: 8 }}>Connected as {conn.email} · {conn.status}{conn.lastSyncAt ? ` · last sync ${new Date(conn.lastSyncAt).toLocaleString()}` : ""}</div>
          {conn.lastError && <div style={{ fontSize: 11, color: B.red, marginBottom: 8 }}>{conn.lastError}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy} onClick={() => act("POST", { action: "resync" })}
              style={{ background: B.orange, color: "#fff", border: "none", borderRadius: 4, padding: "7px 12px", fontSize: 11 }}>{busy === "POST" ? "Syncing…" : "Re-sync"}</button>
            <button disabled={!!busy} onClick={() => act("DELETE")}
              style={{ background: B.white, color: B.red, border: `1px solid ${B.red}`, borderRadius: 4, padding: "7px 12px", fontSize: 11 }}>Disconnect</button>
          </div>
        </div>
      ) : (
        <a href={`/api/radar/oauth?userId=${encodeURIComponent(userId || "")}`}
          style={{ display: "inline-block", background: B.orange, color: "#fff", textDecoration: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 600 }}>
          Connect Gmail
        </a>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 11, color: B.muted }}>{msg}</div>}
      {isAdmin && !hideAdminHint && (
        <div style={{ marginTop: 10, fontSize: 10, color: B.muted }}>Admin: team rollup (counts) lives on the Follow-Up Radar page.</div>
      )}
    </div>
  );
}
