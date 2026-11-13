import { useCallback, useEffect, useState } from "react";

const B = {
  white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", border: "#E0E0E0", blue: "#1A5FA8",
  text: "#1A1A1A", muted: "#7A7A7A",
  green: "#1E8F4E", yellow: "#C77800", red: "#C0392B",
};

const COMPANY_ERRORS = {
  missing_permissions: "Google didn’t grant all the Gmail permissions. Connect again and tick every box.",
  no_refresh_token: "Google didn’t return a long-lived token. Connect again.",
  expired: "That connect link expired. Connect again.",
  google_cancelled: "Connecting the company mailbox was cancelled.",
  google_failed: "Google sign-in failed. Connect again.",
};

function messageFromUrl() {
  const q = new URLSearchParams(window.location.search);
  if (q.get("company") === "connected") return { text: "Company mailbox connected.", tone: "green" };
  const err = q.get("company_error");
  return err ? { text: COMPANY_ERRORS[err] || COMPANY_ERRORS.google_failed, tone: "red" } : null;
}

const btn = (bg, fg = "#fff", border = "none") => ({ background: bg, color: fg, border, borderRadius: 4, padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Lexend',sans-serif", textDecoration: "none", whiteSpace: "nowrap" });

function Row({ title, purpose, status, children }) {
  const ok = status?.connected;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "11px 0", borderTop: `1px solid ${B.border}`, flexWrap: "wrap" }}>
      <div style={{ minWidth: 220, flex: 1 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.text, letterSpacing: .5, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 10, color: B.muted, marginBottom: 5, lineHeight: 1.4 }}>{purpose}</div>
        {!status ? (
          <div style={{ fontSize: 11, color: B.muted }}>Checking…</div>
        ) : ok ? (
          <div style={{ fontSize: 12, color: B.green }}>✓ Connected as <strong>{status.email}</strong></div>
        ) : (
          <div style={{ fontSize: 12, color: B.red, lineHeight: 1.4 }}>✕ {status.error || "Not connected."}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
    </div>
  );
}

/**
 * Settings → Email Status: every mailbox this rep relies on, checked live — their own Gmail,
 * their BDR (for Bulk Outreach) and the company sender — with a connect button for each.
 */
export default function EmailStatusCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(messageFromUrl);

  const load = useCallback(() => {
    fetch("/api/mailboxes").then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      setData(d);
    }).catch(e => { setData({ failed: true }); setMsg({ text: e.message, tone: "red" }); });
  }, []);

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    if (q.has("company") || q.has("company_error")) {
      ["company", "company_error"].forEach(k => q.delete(k));
      const rest = q.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, [load]);

  const post = async (url, body) => {
    setBusy(body.action);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      return d;
    } catch (e) {
      setMsg({ text: e.message, tone: "red" });
      return null;
    } finally {
      setBusy("");
    }
  };

  const goTo = async (url, body) => {
    const d = await post(url, body);
    if (d?.url) window.location.href = d.url;
  };

  const sendTest = async () => {
    setBusy("send-test");
    setMsg(null);
    try {
      const to = data?.mine?.expected || data?.company?.email;
      const d = await fetch("/api/gmail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", to_email: to, to_name: "ST1 Test", subject: "ST1 RevOps — company mailbox test", body: "If you receive this, the company mailbox is sending correctly." }),
      }).then(r => r.json());
      setMsg(d.sent ? { text: `Test email sent to ${to}.`, tone: "green" } : { text: `Send failed: ${d.error || "unknown error"}`, tone: "red" });
    } catch (e) {
      setMsg({ text: e.message, tone: "red" });
    }
    setBusy("");
  };

  const scrollToBdr = () => document.getElementById("my-bdr")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const loading = !data;
  const mine = loading ? null : data.mine;
  const bdr = loading ? null : data.bdr;
  const company = loading ? null : data.company;
  const outline = btn(B.white, B.text, `1px solid ${B.border}`);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 13, borderTop: `3px solid ${B.green}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.green, letterSpacing: 2.5 }}>EMAIL STATUS</div>
        <button onClick={() => { setData(null); load(); }} disabled={loading} style={outline}>{loading ? "Checking…" : "↻ Check again"}</button>
      </div>

      {data?.failed ? null : (
        <>
          <Row title="YOUR GMAIL" status={mine}
            purpose="Your own inbox. Follow-Up Radar, replies and campaigns assigned to you use it.">
            {mine && <a href="/api/auth/google?consent=1" style={mine.connected ? outline : btn(B.orange)}>{mine.connected ? "Reconnect" : "Connect Gmail →"}</a>}
          </Row>

          <Row title="YOUR BDR — BULK OUTREACH" purpose={bdr ? `${bdr.name} <${bdr.expected}>. Bulk Outreach sends from and checks this mailbox.` : "Your outreach persona’s own mailbox. Bulk Outreach sends from it."}
            status={loading ? null : bdr || { connected: false, error: "No BDR set up yet." }}>
            {!loading && !bdr && <button onClick={scrollToBdr} style={btn(B.orange)}>Set up my BDR ↓</button>}
            {bdr && <button disabled={!!busy} onClick={() => goTo("/api/bdr", { action: "connect" })} style={bdr.connected ? outline : btn(B.orange)}>
              {busy === "connect" ? "Opening Google…" : bdr.connected ? "Reconnect" : "Connect mailbox →"}
            </button>}
            {bdr && <button onClick={scrollToBdr} style={outline}>Edit ↓</button>}
          </Row>
          {bdr?.connected && data?.sendingEnabled === false && (
            <div style={{ fontSize: 10, color: B.yellow, marginTop: -4, marginBottom: 8 }}>BDR sending is switched off on the server (BRAD_SENDING_ENABLED), so Bulk Outreach can read but not send.</div>
          )}

          <Row title="COMPANY MAILBOX" status={company}
            purpose={`Sends login codes, reply alerts and campaigns with no rep assigned.${company?.source === "vercel" ? " Currently from the old Vercel setting — connect here to replace it." : ""}`}>
            {company && data?.isAdmin && (
              <button disabled={!!busy} onClick={() => goTo("/api/mailboxes", { action: "connect-company" })} style={company.connected ? outline : btn(B.orange)}>
                {busy === "connect-company" ? "Opening Google…" : company.connected && company.source === "settings" ? "Reconnect" : "Connect company mailbox →"}
              </button>
            )}
            {company?.connected && data?.isAdmin && <button disabled={!!busy} onClick={sendTest} style={outline}>{busy === "send-test" ? "Sending…" : "✉ Send test"}</button>}
            {company && !company.connected && !data?.isAdmin && <span style={{ fontSize: 10, color: B.muted }}>An admin connects this.</span>}
          </Row>
          {data?.isAdmin && company && !(company.connected && company.source === "settings") && (
            <div style={{ fontSize: 10, color: B.muted, lineHeight: 1.5 }}>
              In Google, choose the account the company should send from (e.g. your own, or a shared address like info@) and allow every permission.
            </div>
          )}
        </>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 11, color: B[msg.tone] || B.muted, lineHeight: 1.5 }}>{msg.text}</div>}
    </div>
  );
}
