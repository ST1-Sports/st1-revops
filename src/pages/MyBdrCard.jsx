import { useCallback, useEffect, useState } from "react";

const B = {
  white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", border: "#E0E0E0", blue: "#1A5FA8",
  text: "#1A1A1A", muted: "#7A7A7A",
  green: "#1E8F4E", yellow: "#C77800", red: "#C0392B",
};

const ERRORS = {
  wrong_account: (q) => `Google signed in as ${q.get("got") || "a different account"}, not ${q.get("want") || "the BDR mailbox"}. Click Connect again and pick the BDR’s account in Google’s account chooser (use “Use another account” if it isn’t listed).`,
  missing_permissions: () => "Google didn’t grant all the Gmail permissions. Click Connect again and tick every box on Google’s consent screen.",
  no_refresh_token: () => "Google didn’t return a long-lived token. Click Connect again.",
  changed: () => "Your BDR changed while you were connecting. Click Connect again.",
  expired: () => "That connect link expired. Click Connect again.",
  google_cancelled: () => "Connecting was cancelled.",
  google_failed: () => "Google sign-in failed. Try Connect again.",
};

// Result of Google's "Connect BDR mailbox" step, read once from the URL it returns to.
function messageFromUrl() {
  const q = new URLSearchParams(window.location.search);
  if (q.get("bdr") === "connected") return { text: "BDR mailbox connected.", tone: "green" };
  const err = q.get("bdr_error");
  return err ? { text: (ERRORS[err] || ERRORS.google_failed)(q), tone: "red" } : null;
}

const input = { width: "100%", background: B.surface, border: `1px solid ${B.border}`, color: B.text, borderRadius: 4, padding: "7px 9px", fontSize: 12, fontFamily: "'Lexend',sans-serif" };
const btn = (bg, fg = "#fff", border = "none") => ({ background: bg, color: fg, border, borderRadius: 4, padding: "7px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Lexend',sans-serif" });

export default function MyBdrCard({ isAdmin = false }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null); // { name, email } while editing
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(messageFromUrl); // { text, tone }

  const load = useCallback(() => {
    fetch("/api/bdr").then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      setInfo(d);
    }).catch(e => setMsg({ text: e.message, tone: "red" }));
  }, []);

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    if (q.has("bdr") || q.has("bdr_error")) {
      ["bdr", "bdr_error", "got", "want"].forEach(k => q.delete(k));
      const rest = q.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, [load]);

  const post = async (action, extra = {}) => {
    setBusy(action);
    setMsg(null);
    try {
      const r = await fetch("/api/bdr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
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

  const save = async () => {
    const d = await post("save", form);
    if (d) { setForm(null); setMsg({ text: "BDR saved. Now connect its mailbox.", tone: "green" }); load(); }
  };
  const connect = async () => {
    const d = await post("connect");
    if (d?.url) window.location.href = d.url;
  };
  const test = async () => {
    const d = await post("test");
    if (d) setMsg(d.ok ? { text: `Working — reading and sending as ${d.email}.`, tone: "green" } : { text: d.error || "Not working", tone: "red" });
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect this BDR mailbox? Nothing will send from it until you connect it again.")) return;
    if (await post("disconnect")) load();
  };

  const bdr = info?.bdr;
  const conn = info?.connection;
  const editing = !!form;

  return (
    <div id="my-bdr" className="card" style={{ padding: 16, marginBottom: 13, borderTop: `3px solid ${B.blue}`, scrollMarginTop: 16 }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, color: B.blue, letterSpacing: 2.5, marginBottom: 10 }}>MY BDR</div>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, marginBottom: 12, lineHeight: 1.5 }}>
        Your own outreach persona with its own mailbox. Bulk Outreach and Brad-style campaigns you send go out from it, and
        positive replies to it come to you.
      </div>

      {!info && !msg && <div style={{ fontSize: 11, color: B.muted }}>Loading…</div>}

      {info && !bdr && !editing && (
        <button onClick={() => setForm({ name: "", email: "" })} style={btn(B.orange)}>Set up my BDR</button>
      )}

      {info && editing && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 9, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: B.muted, marginBottom: 3 }}>BDR name (what prospects see)</div>
              <input style={input} placeholder="Brad Hofer" value={form?.name ?? ""} onChange={e => setForm(f => ({ ...(f || {}), name: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: B.muted, marginBottom: 3 }}>BDR mailbox</div>
              <input style={input} type="email" placeholder="brad@shopst1sports.com" value={form?.email ?? ""} onChange={e => setForm(f => ({ ...(f || {}), email: e.target.value }))} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: B.muted, marginBottom: 10, lineHeight: 1.5 }}>
            The mailbox must be a real Google Workspace account just for this BDR (for example on shopst1sports.com), not your own address.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={!!busy} onClick={save} style={btn(B.orange)}>{busy === "save" ? "Saving…" : "Save BDR"}</button>
            <button disabled={!!busy} onClick={() => setForm(null)} style={btn(B.white, B.text, `1px solid ${B.border}`)}>Cancel</button>
          </div>
        </div>
      )}

      {bdr && !editing && (
        <div>
          <div style={{ fontSize: 13, color: B.text, marginBottom: 6 }}>
            <strong>{bdr.name}</strong> <span style={{ color: B.muted }}>&lt;{bdr.email}&gt;</span>
          </div>
          {conn ? (
            <div style={{ fontSize: 12, color: B.green, marginBottom: 10 }}>
              ✓ Mailbox connected{conn.connectedAt ? ` · ${new Date(conn.connectedAt).toLocaleDateString()}` : ""}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: B.red, marginBottom: 10, lineHeight: 1.5 }}>
              ✕ Mailbox not connected. Click <strong>Connect mailbox</strong>, then in Google choose <strong>{bdr.email}</strong>
              {" "}(“Use another account” if it isn’t listed) and sign in with that mailbox’s password.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy} onClick={connect} style={btn(B.orange)}>{busy === "connect" ? "Opening Google…" : conn ? "Reconnect mailbox" : "Connect mailbox"}</button>
            {conn && <button disabled={!!busy} onClick={test} style={btn(B.white, B.text, `1px solid ${B.border}`)}>{busy === "test" ? "Testing…" : "Test"}</button>}
            <button disabled={!!busy} onClick={() => setForm({ name: bdr.name, email: bdr.email })} style={btn(B.white, B.text, `1px solid ${B.border}`)}>Edit</button>
            {conn && <button disabled={!!busy} onClick={disconnect} style={btn(B.white, B.red, `1px solid ${B.red}`)}>Disconnect</button>}
          </div>
          {info?.sendingEnabled === false && (
            <div style={{ fontSize: 10, color: B.yellow, marginTop: 10 }}>
              BDR sending is switched off on the server (BRAD_SENDING_ENABLED). Reading replies works; nothing will send until it’s on.
            </div>
          )}
        </div>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 11, color: B[msg.tone] || B.muted, lineHeight: 1.5 }}>{msg.text}</div>}

      {isAdmin && Array.isArray(info?.team) && info.team.length > 0 && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${B.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: B.muted, marginBottom: 6 }}>Team BDRs</div>
          {info.team.map(t => (
            <div key={t.repId} style={{ fontSize: 11, color: B.text, marginBottom: 3 }}>
              {t.repName} → {t.name} &lt;{t.email}&gt; · <span style={{ color: t.connected ? B.green : B.red }}>{t.connected ? "connected" : "not connected"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
