import { useState, useEffect, useCallback } from "react";

const B = {
  pageBg: "#F4F4F4", white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", orangeL: "#FF9942", orangeBg: "#FEF3EC",
  gray1: "#424242", gray2: "#B2B9C1",
  border: "#E0E0E0", borderD: "#C8C8C8",
  text: "#1A1A1A", textMid: "#424242", muted: "#7A7A7A",
  green: "#1E8F4E", greenBg: "#EAF7EE",
  yellow: "#C77800", yellowBg: "#FFF8E6",
  red: "#C0392B", redBg: "#FDECEA",
};

const fmt$ = n => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = iso => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

function isoDate(d) { return d.toISOString().slice(0, 10); }
function defaultSince() { return isoDate(new Date(Date.now() - 60 * 86_400_000)); }
function defaultUntil() { return isoDate(new Date()); }

function OBtn({ children, onClick, disabled, style: sty }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? B.border : B.orange, color: disabled ? B.muted : B.white, border: "none",
      borderRadius: 5, padding: "6px 12px", fontSize: 10.5, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700,
      letterSpacing: 0.4, cursor: disabled ? "not-allowed" : "pointer", ...sty,
    }}>{children}</button>
  );
}

function GBtn({ children, onClick, disabled, style: sty }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: B.white, color: B.textMid, border: `1px solid ${B.borderD}`, borderRadius: 5,
      padding: "6px 11px", fontSize: 10.5, fontFamily: "'Lexend',sans-serif", cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.6 : 1, ...sty,
    }}>{children}</button>
  );
}

function ConfidenceBadge({ confidence, label }) {
  const tone = label === "high" ? B.green : label === "medium" ? B.yellow : B.red;
  const bg = label === "high" ? B.greenBg : label === "medium" ? B.yellowBg : B.redBg;
  return (
    <span style={{ background: bg, color: tone, fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>
      {Math.round((confidence || 0) * 100)}% {label}
    </span>
  );
}

function SourceBadge({ type }) {
  const label = type === "stripe_charge" ? "STRIPE CHARGE" : type === "stripe_payout" ? "STRIPE PAYOUT" : "BANK FEED";
  return <span style={{ background: B.surface, color: B.gray1, fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: `1px solid ${B.border}` }}>{label}</span>;
}

function Card({ children }) {
  return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>{children}</div>;
}

function SectionTitle({ children }) {
  return <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: B.gray1, margin: "18px 0 8px" }}>{children}</div>;
}

function StatCard({ label, value, tone }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: B.orangeBg, border: `1px solid ${B.border}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8.5, color: B.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 16, color: tone || B.orange }}>{value}</div>
    </div>
  );
}

function MoneyInRow({ m, onApprove, onReject, busy }) {
  const order = m.order || {};
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${B.border}`, flexWrap: "wrap" }}>
      <div style={{ minWidth: 140 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{order.referenceNumber || m.targetId}</div>
        <div style={{ fontSize: 10.5, color: B.muted }}>{order.storeName} · {fmtD(order.paidAt)} · {fmt$(order.totalAmount)}</div>
      </div>
      <div style={{ fontSize: 16, color: B.muted }}>&harr;</div>
      <div style={{ minWidth: 160 }}>
        <div style={{ fontSize: 12.5 }}>{fmt$(m.sourceAmount)} {m.feeAmount ? <span style={{ color: B.muted, fontSize: 10.5 }}>(fee {fmt$(m.feeAmount)})</span> : null}</div>
        <div style={{ fontSize: 10.5, color: B.muted }}>{fmtD(m.sourceDate)} · <SourceBadge type={m.sourceType} /></div>
      </div>
      <ConfidenceBadge confidence={m.matchConfidence} label={m.confidenceLabel} />
      {m.suggestionBasis === "reference" && <span style={{ fontSize: 9.5, color: B.green, fontWeight: 700 }}>REF MATCH</span>}
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <OBtn onClick={() => onApprove(m.id)} disabled={busy}>CONFIRM</OBtn>
        <GBtn onClick={() => onReject(m.id)} disabled={busy}>DISMISS</GBtn>
      </div>
    </div>
  );
}

function MoneyOutRow({ m, onApprove, onReject, busy }) {
  const payment = m.payment || {};
  const payable = payment.payable || {};
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${B.border}`, flexWrap: "wrap" }}>
      <div style={{ minWidth: 160 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{payable.payeeLabel || m.targetId}</div>
        <div style={{ fontSize: 10.5, color: B.muted }}>{payable.referenceNumber} · {fmtD(payment.paidOn)} · {fmt$(payment.amountPaid)} · {payment.method}</div>
      </div>
      <div style={{ fontSize: 16, color: B.muted }}>&harr;</div>
      <div style={{ minWidth: 160 }}>
        <div style={{ fontSize: 12.5 }}>{fmt$(m.sourceAmount)}</div>
        <div style={{ fontSize: 10.5, color: B.muted }}>{fmtD(m.sourceDate)} · <SourceBadge type={m.sourceType} /> {m.counterparty ? `· ${m.counterparty}` : ""}</div>
      </div>
      <ConfidenceBadge confidence={m.matchConfidence} label={m.confidenceLabel} />
      {m.suggestionBasis === "reference" && <span style={{ fontSize: 9.5, color: B.green, fontWeight: 700 }}>REF MATCH</span>}
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <OBtn onClick={() => onApprove(m.id)} disabled={busy}>CONFIRM</OBtn>
        <GBtn onClick={() => onReject(m.id)} disabled={busy}>DISMISS</GBtn>
      </div>
    </div>
  );
}

export default function TeamStoreReconcile({ s, dispatch, toast, cu, setMod }) {
  const [tab, setTab] = useState("in");
  const [since, setSince] = useState(defaultSince());
  const [until, setUntil] = useState(defaultUntil());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (direction, sinceV, untilV) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ direction, since: sinceV, until: untilV });
      const r = await fetch(`/api/team-store/reconcile?${q}`);
      const body = await r.json();
      if (!body.ok) throw new Error(body.error || "Failed to load reconciliation");
      setData(body);
    } catch (e) {
      setError(e.message);
      if (toast) toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(tab, since, until); }, [tab, since, until, load]);

  const act = async (task, matchId) => {
    setBusyId(matchId);
    try {
      const r = await fetch("/api/team-store/reconcile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, matchId, approvedById: cu?.id || cu?.name || null }),
      });
      const body = await r.json();
      if (!body.ok) throw new Error(body.error || "Failed");
      if (toast) toast(task === "approve" ? "Match confirmed" : "Match dismissed", "success");
      load(tab, since, until);
    } catch (e) {
      if (toast) toast(e.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const proposed = data?.proposed || [];
  const confirmed = data?.confirmed || [];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1200, fontFamily: "'Lexend',sans-serif", color: B.text, background: B.pageBg }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: B.gray1, marginRight: "auto" }}>
          Team Store Reconciliation
        </div>
        <div style={{ display: "flex", border: `1px solid ${B.borderD}`, borderRadius: 6, overflow: "hidden" }}>
          {["in", "out"].map(d => (
            <button key={d} onClick={() => setTab(d)} style={{
              background: tab === d ? B.orange : B.white, color: tab === d ? B.white : B.textMid, border: "none",
              padding: "7px 14px", fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, cursor: "pointer",
            }}>{d === "in" ? "MONEY IN" : "MONEY OUT"}</button>
          ))}
        </div>
        <input type="date" value={since} onChange={e => setSince(e.target.value)} style={{ padding: "6px 9px", borderRadius: 5, border: `1px solid ${B.borderD}`, fontSize: 12 }} />
        <span style={{ color: B.muted, fontSize: 12 }}>to</span>
        <input type="date" value={until} onChange={e => setUntil(e.target.value)} style={{ padding: "6px 9px", borderRadius: 5, border: `1px solid ${B.borderD}`, fontSize: 12 }} />
      </div>

      <div style={{ fontSize: 11, color: B.muted, marginBottom: 14 }}>
        {tab === "in"
          ? "Matches TeamStoreOrder rows to Stripe charges by amount, date, and (when present) the order reference on the charge."
          : "Matches recorded PayablePayment rows to Stripe payouts and the ST1 Operating Account's Zoho Books bank feed. Fuzzy matches are proposed, never auto-applied — confirm the ones that are actually right."}
      </div>

      {loading && <div style={{ padding: 16, color: B.muted }}>Loading…</div>}
      {error && <div style={{ background: B.redBg, color: B.red, border: `1px solid ${B.red}33`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12.5 }}>{error}</div>}

      {tab === "in" && data?.summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <StatCard label="Matched" value={data.summary.matchedCount} />
          <StatCard label="Gross Collected" value={fmt$(data.summary.grossCollected)} />
          <StatCard label="Stripe Fees" value={fmt$(data.summary.totalFees)} tone={B.red} />
          <StatCard label="Net Retained" value={fmt$(data.summary.netRetained)} tone={B.green} />
        </div>
      )}

      {data && (
        <>
          <SectionTitle>Proposed Matches ({proposed.length})</SectionTitle>
          <Card>
            {!proposed.length && <div style={{ padding: 14, fontSize: 12.5, color: B.muted }}>Nothing pending review.</div>}
            {proposed.map(m => tab === "in"
              ? <MoneyInRow key={m.id} m={m} onApprove={id => act("approve", id)} onReject={id => act("reject", id)} busy={busyId === m.id} />
              : <MoneyOutRow key={m.id} m={m} onApprove={id => act("approve", id)} onReject={id => act("reject", id)} busy={busyId === m.id} />)}
          </Card>

          <SectionTitle>Confirmed ({confirmed.length})</SectionTitle>
          <Card>
            {!confirmed.length && <div style={{ padding: 14, fontSize: 12.5, color: B.muted }}>None confirmed in this window yet.</div>}
            {confirmed.map(m => tab === "in"
              ? <MoneyInRow key={m.id} m={m} onApprove={() => {}} onReject={() => {}} busy />
              : <MoneyOutRow key={m.id} m={m} onApprove={() => {}} onReject={() => {}} busy />)}
          </Card>

          {tab === "in" && (
            <>
              <SectionTitle>Orders With No Matching Charge ({(data.unmatchedOrders || []).length})</SectionTitle>
              <Card>
                {!data.unmatchedOrders?.length && <div style={{ padding: 14, fontSize: 12.5, color: B.green }}>Every order in this window has a candidate charge.</div>}
                {(data.unmatchedOrders || []).map(o => (
                  <div key={o.id} style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, fontSize: 12.5, display: "flex", justifyContent: "space-between" }}>
                    <span>{o.referenceNumber} — {o.storeName}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt$(o.totalAmount)} · {fmtD(o.paidAt)}</span>
                  </div>
                ))}
              </Card>

              <SectionTitle>Charges With No Matching Order ({(data.unmatchedCharges || []).length})</SectionTitle>
              <Card>
                {!data.unmatchedCharges?.length && <div style={{ padding: 14, fontSize: 12.5, color: B.green }}>Every charge in this window matched an order.</div>}
                {(data.unmatchedCharges || []).map(c => (
                  <div key={c.id} style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, fontSize: 12.5, display: "flex", justifyContent: "space-between" }}>
                    <span>{c.id} — {c.description || "no description"}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt$(c.amount)} · {fmtD(c.date)}</span>
                  </div>
                ))}
              </Card>
            </>
          )}

          {tab === "out" && (
            <>
              <SectionTitle>Payments With No Matching Transaction ({(data.unmatchedPayments || []).length})</SectionTitle>
              <Card>
                {!data.unmatchedPayments?.length && <div style={{ padding: 14, fontSize: 12.5, color: B.green }}>Every recorded payment in this window has a candidate.</div>}
                {(data.unmatchedPayments || []).map(p => (
                  <div key={p.payableKey} style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, fontSize: 12.5, display: "flex", justifyContent: "space-between" }}>
                    <span>{p.payable?.payeeLabel || p.payableKey} — {p.method}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt$(p.amountPaid)} · {fmtD(p.paidOn)}</span>
                  </div>
                ))}
              </Card>

              <SectionTitle>Transactions With No Matching Payment ({(data.unmatchedTransactions || []).length})</SectionTitle>
              <Card>
                {!data.unmatchedTransactions?.length && <div style={{ padding: 14, fontSize: 12.5, color: B.green }}>Every settled debit in this window matched a payment.</div>}
                {(data.unmatchedTransactions || []).map(t => (
                  <div key={t.id} style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, fontSize: 12.5, display: "flex", justifyContent: "space-between" }}>
                    <span><SourceBadge type={t.source} /> {t.counterparty || t.id}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt$(t.amount)} · {fmtD(t.date)}</span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <div style={{ fontSize: 10.5, color: B.muted, marginTop: 18 }}>
        A confirmed match only records which source verified the money moved — it never edits the order, the payable, or the recorded payment itself.
      </div>
    </div>
  );
}
