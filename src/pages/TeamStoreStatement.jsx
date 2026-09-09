import { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { statementForPayee } from "../lib/teamStoreSettlement.js";

const B = {
  pageBg: "#F4F4F4", white: "#FFFFFF", surface: "#F8F8F8",
  orange: "#F37321", orangeL: "#FF9942", orangeBg: "#FEF3EC",
  black: "#000000", gray1: "#424242", gray2: "#B2B9C1",
  border: "#E0E0E0", borderD: "#C8C8C8",
  text: "#1A1A1A", textMid: "#424242", muted: "#7A7A7A",
  green: "#1E8F4E", greenBg: "#EAF7EE",
  yellow: "#C77800", yellowBg: "#FFF8E6",
  red: "#C0392B", redBg: "#FDECEA",
};

const fmt$ = n => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = n => Number(n || 0).toLocaleString("en-US");
const fmtPct = n => (n == null ? "—" : `${(Number(n) * 100).toFixed(2)}%`);
const fmtAge = n => (n == null ? "—" : `${n}d`);

function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function previousMonthStr(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed; the previous calendar month from "now"
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 12 : m;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "payee";
}

function sheetOf(rows, emptyLabel) {
  return XLSX.utils.json_to_sheet(rows && rows.length ? rows : [{ Note: emptyLabel }]);
}

function OBtn({ children, onClick, disabled, style: sty }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? B.border : B.orange, color: disabled ? B.muted : B.white, border: "none",
      borderRadius: 5, padding: "8px 16px", fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700,
      letterSpacing: 0.4, cursor: disabled ? "not-allowed" : "pointer", ...sty,
    }}>{children}</button>
  );
}

function GBtn({ children, onClick, disabled, style: sty }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: B.white, color: B.textMid, border: `1px solid ${B.borderD}`, borderRadius: 5,
      padding: "7px 13px", fontSize: 11, fontFamily: "'Lexend',sans-serif", cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.6 : 1, ...sty,
    }}>{children}</button>
  );
}

const thStyle = (align = "right") => ({
  padding: "9px 12px", textAlign: align, fontSize: 10, fontWeight: 700, color: B.muted, textTransform: "uppercase",
  letterSpacing: "0.05em", whiteSpace: "nowrap", borderBottom: `2px solid ${B.border}`, background: B.surface,
  fontFamily: "'Lexend Zetta',sans-serif",
});
const tdStyle = (align = "right") => ({
  padding: "9px 12px", fontSize: 12.5, color: B.text, borderBottom: `1px solid ${B.border}`, textAlign: align,
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
});

function SectionTitle({ children }) {
  return <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 15, color: B.gray1, margin: "22px 0 10px" }}>{children}</div>;
}

function Card({ children }) {
  return <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>{children}</div>;
}

function StatCard({ label, value, tone }) {
  const toneBg = tone === "green" ? B.greenBg : tone === "yellow" ? B.yellowBg : tone === "red" ? B.redBg : B.orangeBg;
  const toneFg = tone === "green" ? B.green : tone === "yellow" ? B.yellow : tone === "red" ? B.red : B.orange;
  return (
    <div style={{ flex: 1, minWidth: 140, background: toneBg, border: `1px solid ${B.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 19, color: toneFg, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function MoneyInOut({ m }) {
  if (!m) return null;
  return (
    <div className="statement-section">
      <SectionTitle>Money In / Money Out</SectionTitle>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Merchandise" value={fmt$(m.merchandise)} />
            <Row label="Tax" value={fmt$(m.tax)} />
            <Row label="Shipping" value={fmt$(m.shippingCost)} />
            <Row label="Discounts" value={m.discount ? `(${fmt$(m.discount)})` : fmt$(0)} tone={m.discount ? B.red : undefined} />
            <Row label="Gross collected" value={fmt$(m.grossCollected)} bold />
            <Row label="Owed to partners" value={`(${fmt$(m.thirdPartyPayout)})`} tone={B.red} />
            <Row label="ST1 cash retained" value={fmt$(m.st1CashRetained)} bold />
            <Row label="ST1-supplied cost (memo)" value={fmt$(m.st1SuppliedCost)} tone={B.muted} />
            <Row label="ST1 gross profit" value={fmt$(m.st1GrossProfit)} bold tone={B.orange} />
          </tbody>
        </table>
      </Card>
      <div style={{ fontSize: 11, color: B.muted, marginTop: 6 }}>{fmtN(m.orderCount)} orders · {fmtN(m.unitCount)} units</div>
    </div>
  );
}

function Row({ label, value, bold, tone }) {
  return (
    <tr>
      <td style={{ ...tdStyle("left"), fontWeight: bold ? 700 : 400 }}>{label}</td>
      <td style={{ ...tdStyle("right"), fontWeight: bold ? 700 : 400, color: tone || B.text }}>{value}</td>
    </tr>
  );
}

function OwedByPayee({ byPayeeStatus }) {
  const rows = Object.entries(byPayeeStatus || {}).sort((a, b) => b[1].outstanding - a[1].outstanding);
  return (
    <div className="statement-section">
      <SectionTitle>Owed by Payee</SectionTitle>
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle("left")}>Payee</th>
              <th style={thStyle("left")}>Role</th>
              <th style={thStyle()}>Items</th>
              <th style={thStyle()}>Billed</th>
              <th style={thStyle()}>Paid</th>
              <th style={thStyle()}>Outstanding</th>
              <th style={thStyle()}>Oldest</th>
            </tr></thead>
            <tbody>
              {rows.map(([payee, v], i) => (
                <tr key={payee} style={{ background: i % 2 ? B.surface : B.white }}>
                  <td style={tdStyle("left")}>{payee}</td>
                  <td style={{ ...tdStyle("left"), color: B.muted, fontSize: 11 }}>{v.role}</td>
                  <td style={tdStyle()}>{fmtN(v.items)}</td>
                  <td style={tdStyle()}>{fmt$(v.billed)}</td>
                  <td style={{ ...tdStyle(), color: B.green }}>{fmt$(v.paid)}</td>
                  <td style={{ ...tdStyle(), color: v.outstanding ? B.red : B.muted, fontWeight: v.outstanding ? 700 : 400 }}>{fmt$(v.outstanding)}</td>
                  <td style={{ ...tdStyle(), color: v.oldestAgeDays > 45 ? B.red : B.text }}>{fmtAge(v.oldestAgeDays)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td style={tdStyle("left")} colSpan={7}>No payables this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function BySchool({ byStore }) {
  const rows = Object.entries(byStore || {}).sort((a, b) => b[1].grossCollected - a[1].grossCollected);
  return (
    <div className="statement-section">
      <SectionTitle>By School</SectionTitle>
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle("left")}>School</th>
              <th style={thStyle()}>Orders</th>
              <th style={thStyle()}>Units</th>
              <th style={thStyle()}>Merch</th>
              <th style={thStyle()}>Tax</th>
              <th style={thStyle()}>Shipping</th>
              <th style={thStyle()}>Gross</th>
              <th style={thStyle()}>Payouts</th>
              <th style={thStyle()}>Retained</th>
            </tr></thead>
            <tbody>
              {rows.map(([school, v], i) => (
                <tr key={school} style={{ background: i % 2 ? B.surface : B.white }}>
                  <td style={tdStyle("left")}>{school}</td>
                  <td style={tdStyle()}>{fmtN(v.orderCount)}</td>
                  <td style={tdStyle()}>{fmtN(v.unitCount)}</td>
                  <td style={tdStyle()}>{fmt$(v.merchandise)}</td>
                  <td style={tdStyle()}>{fmt$(v.tax)}</td>
                  <td style={tdStyle()}>{fmt$(v.shippingCost)}</td>
                  <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmt$(v.grossCollected)}</td>
                  <td style={{ ...tdStyle(), color: B.red }}>{fmt$(v.thirdPartyPayout)}</td>
                  <td style={{ ...tdStyle(), color: v.st1CashRetained < 0 ? B.red : B.green, fontWeight: 700 }}>{fmt$(v.st1CashRetained)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td style={tdStyle("left")} colSpan={9}>No orders this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SchoolPayeeMatrix({ byStorePayee }) {
  const stores = Object.keys(byStorePayee || {}).sort();
  return (
    <div className="statement-section">
      <SectionTitle>School &times; Payee</SectionTitle>
      {!stores.length && <Card><div style={{ padding: 14, fontSize: 12.5, color: B.muted }}>No payables this month.</div></Card>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {stores.map(store => {
          const payees = Object.entries(byStorePayee[store]).sort((a, b) => b[1].amount - a[1].amount);
          return (
            <Card key={store}>
              <div style={{ padding: "8px 12px", fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10.5, letterSpacing: 0.4, color: B.gray1, background: B.surface, borderBottom: `1px solid ${B.border}` }}>{store}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {payees.map(([payee, v], i) => (
                    <tr key={payee} style={{ background: i % 2 ? B.surface : B.white }}>
                      <td style={tdStyle("left")}>{payee}</td>
                      <td style={tdStyle()}>{fmt$(v.amount)}</td>
                      <td style={{ ...tdStyle(), color: B.muted, fontSize: 11 }}>{v.paidCount}/{v.count} paid (upstream)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function FeeAudit({ f }) {
  if (!f) return null;
  return (
    <div className="statement-section">
      <SectionTitle>Delta-Share Fee Audit</SectionTitle>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Delta-share orders" value={fmtN(f.orderCount)} />
            <Row label="Unlimited Sports Apparel merchandise" value={fmt$(f.usaMerch)} />
            <Row label="Units" value={fmtN(f.usaUnits)} />
            <Row label="Product supplier cut" value={fmt$(f.productSupplierCut)} />
            <Row label="USA cut" value={fmt$(f.usaCut)} />
            <Row label="Fee actually taken (blended)" value={fmt$(f.feeTaken)} bold />
            <Row label="Blended rate applied" value={fmtPct(f.rateApplied)} />
            <Row label="Configured terms" value={`${(f.configuredFeeRate * 100).toFixed(2)}% + ${fmt$(f.configuredFeePerItem)}/item`} tone={B.muted} />
            <Row label="Fee at configured terms" value={fmt$(f.feeAtConfiguredTerms)} />
            <Row label="Variance vs. configured terms" value={f.variance >= 0 ? fmt$(f.variance) : `(${fmt$(Math.abs(f.variance))})`} tone={Math.abs(f.variance) > 1 ? B.red : B.green} bold />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Exceptions({ list }) {
  return (
    <div className="statement-section">
      <SectionTitle>Exceptions ({fmtN((list || []).length)})</SectionTitle>
      {!list?.length && <Card><div style={{ padding: 14, fontSize: 12.5, color: B.green }}>No exceptions flagged this month.</div></Card>}
      {!!list?.length && (
        <Card>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle("left")}>Order</th>
                <th style={thStyle("left")}>Type</th>
                <th style={thStyle("left")}>Detail</th>
              </tr></thead>
              <tbody>
                {list.map((f, i) => (
                  <tr key={i} style={{ background: i % 2 ? B.surface : B.white }}>
                    <td style={tdStyle("left")}>{f.referenceNumber || "—"}</td>
                    <td style={{ ...tdStyle("left"), color: B.red, fontWeight: 700, fontSize: 11 }}>{f.type}</td>
                    <td style={{ ...tdStyle("left"), whiteSpace: "normal", fontSize: 12 }}>{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function PerOrder({ rows, open, setOpen }) {
  return (
    <div className="statement-section no-print-collapsed">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 10px" }}>
        <SectionTitle>Order Detail ({fmtN((rows || []).length)})</SectionTitle>
        <button className="no-print" onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", color: B.orange, fontSize: 11, fontFamily: "'Lexend Zetta',sans-serif", cursor: "pointer" }}>
          {open ? "HIDE" : "SHOW"}
        </button>
      </div>
      {open && (
        <Card>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle("left")}>Order</th>
                <th style={thStyle()}>Gross</th>
                <th style={thStyle()}>Merch</th>
                <th style={thStyle()}>Discount</th>
                <th style={thStyle()}>Payout</th>
                <th style={thStyle()}>Retained</th>
              </tr></thead>
              <tbody>
                {(rows || []).map((o, i) => (
                  <tr key={o.referenceNumber} style={{ background: i % 2 ? B.surface : B.white }}>
                    <td style={tdStyle("left")}>{o.referenceNumber}</td>
                    <td style={tdStyle()}>{fmt$(o.grossCollected)}</td>
                    <td style={tdStyle()}>{fmt$(o.merchandise)}</td>
                    <td style={{ ...tdStyle(), color: o.discount ? B.red : B.muted }}>{fmt$(o.discount)}</td>
                    <td style={tdStyle()}>{fmt$(o.thirdPartyPayout)}</td>
                    <td style={{ ...tdStyle(), color: o.st1CashRetained < 0 ? B.red : B.text }}>{fmt$(o.st1CashRetained)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function PayeeView({ slice, month }) {
  const rows = Object.entries(slice.byStore || {}).sort((a, b) => b[1].amount - a[1].amount);
  return (
    <div className="statement-page">
      <div className="statement-section">
        <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 22, color: B.gray1 }}>{slice.payeeLabel}</div>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 10, color: B.muted, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 }}>
          {slice.role} &middot; {monthLabel(month)} statement
        </div>
      </div>
      <div className="statement-section" style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <StatCard label="Billed" value={fmt$(slice.billed)} />
        <StatCard label="Paid" value={fmt$(slice.paid)} tone="green" />
        <StatCard label="Outstanding" value={fmt$(slice.outstanding)} tone={slice.outstanding ? "yellow" : "green"} />
      </div>
      <div className="statement-section">
        <SectionTitle>By School</SectionTitle>
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle("left")}>School</th>
              <th style={thStyle()}>Amount</th>
              <th style={thStyle()}>Items</th>
            </tr></thead>
            <tbody>
              {rows.map(([store, v], i) => (
                <tr key={store} style={{ background: i % 2 ? B.surface : B.white }}>
                  <td style={tdStyle("left")}>{store}</td>
                  <td style={tdStyle()}>{fmt$(v.amount)}</td>
                  <td style={tdStyle()}>{v.count}</td>
                </tr>
              ))}
              {!rows.length && <tr><td style={tdStyle("left")} colSpan={3}>No activity this month.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="no-print" style={{ marginTop: 18, fontSize: 11, color: B.muted }}>
        This statement reflects ST1's synced copy of the admin app's records and is informational only — it does not write back to the admin app.
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media print {
  .no-print, .no-print-collapsed > button { display: none !important; }
  .statement-page { padding: 0 !important; max-width: 100% !important; }
  .statement-section { break-inside: avoid; page-break-inside: avoid; }
  table { font-size: 10pt; }
}
`;

export default function TeamStoreStatement({ s, dispatch, toast, cu, setMod }) {
  const [month, setMonth] = useState(() => previousMonthStr());
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewPayee, setViewPayee] = useState("");
  const [ordersOpen, setOrdersOpen] = useState(false);

  const load = useCallback(async m => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/team-store/statement?month=${encodeURIComponent(m)}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Failed to load statement");
      setStatement(data.statement);
    } catch (e) {
      setError(e.message);
      if (toast) toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(month); }, [month, load]);

  const payeeList = useMemo(() => {
    if (!statement) return [];
    return Object.entries(statement.byPayeeStatus || {})
      .sort((a, b) => b[1].outstanding - a[1].outstanding)
      .map(([label]) => label);
  }, [statement]);

  const payeeSlice = useMemo(
    () => (statement && viewPayee ? statementForPayee(statement, viewPayee) : null),
    [statement, viewPayee],
  );

  const exportXlsx = () => {
    if (!statement) return;
    const wb = XLSX.utils.book_new();
    const kv = obj => Object.entries(obj || {}).map(([Field, Value]) => ({ Field, Value }));

    if (viewPayee && payeeSlice) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kv({
        Payee: payeeSlice.payeeLabel, Role: payeeSlice.role, Billed: payeeSlice.billed, Paid: payeeSlice.paid, Outstanding: payeeSlice.outstanding,
      })), "Summary");
      const rows = Object.entries(payeeSlice.byStore || {}).map(([School, v]) => ({ School, Amount: v.amount, Items: v.count, PaidItemsUpstream: v.paidCount }));
      XLSX.utils.book_append_sheet(wb, sheetOf(rows, "No activity this month"), "By School");
      XLSX.writeFile(wb, `${slugify(viewPayee)}-statement-${month}.xlsx`);
      return;
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kv(statement.moneyInOut)), "Money In-Out");
    XLSX.utils.book_append_sheet(wb, sheetOf(
      Object.entries(statement.byStore || {}).map(([School, v]) => ({ School, ...v })), "No orders this month",
    ), "By School");
    const spRows = [];
    for (const [School, payees] of Object.entries(statement.byStorePayee || {})) {
      for (const [Payee, v] of Object.entries(payees)) spRows.push({ School, Payee, ...v });
    }
    XLSX.utils.book_append_sheet(wb, sheetOf(spRows, "No payables this month"), "School x Payee");
    XLSX.utils.book_append_sheet(wb, sheetOf(
      Object.entries(statement.byPayeeStatus || {}).map(([Payee, v]) => ({ Payee, ...v })), "No payables this month",
    ), "Owed by Payee");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kv(statement.feeAudit)), "Fee Audit");
    XLSX.utils.book_append_sheet(wb, sheetOf(statement.exceptions, "No exceptions this month"), "Exceptions");
    XLSX.utils.book_append_sheet(wb, sheetOf(statement.perOrder, "No orders this month"), "Per Order");
    XLSX.writeFile(wb, `team-store-statement-${month}.xlsx`);
  };

  return (
    <div className="statement-page" style={{ padding: "24px 28px", maxWidth: 1200, fontFamily: "'Lexend',sans-serif", color: B.text, background: B.pageBg }}>
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: B.gray1, marginRight: "auto" }}>
          Team Store Settlement Statement
        </div>
        <input
          type="month"
          value={month}
          onChange={e => e.target.value && setMonth(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 5, border: `1px solid ${B.borderD}`, fontFamily: "'Lexend',sans-serif", fontSize: 12.5 }}
        />
        <select
          value={viewPayee}
          onChange={e => setViewPayee(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 5, border: `1px solid ${B.borderD}`, fontFamily: "'Lexend',sans-serif", fontSize: 12.5, maxWidth: 220 }}
        >
          <option value="">Full statement</option>
          {payeeList.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <GBtn onClick={() => window.print()}>PRINT</GBtn>
        <OBtn onClick={exportXlsx} disabled={!statement}>EXPORT XLSX</OBtn>
      </div>

      <div className="no-print" style={{ fontSize: 11, color: B.muted, marginBottom: 16 }}>
        {monthLabel(month)} &middot; reflects RevOps' synced copy of the ST1 admin app — one-way sync, this screen does not write back to it.
      </div>

      {loading && <div style={{ padding: 20, color: B.muted }}>Loading statement…</div>}
      {error && <div style={{ background: B.redBg, color: B.red, border: `1px solid ${B.red}33`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12.5 }}>{error}</div>}

      {statement && !viewPayee && (
        <>
          <MoneyInOut m={statement.moneyInOut} />
          <OwedByPayee byPayeeStatus={statement.byPayeeStatus} />
          <BySchool byStore={statement.byStore} />
          <SchoolPayeeMatrix byStorePayee={statement.byStorePayee} />
          <FeeAudit f={statement.feeAudit} />
          <Exceptions list={statement.exceptions} />
          <PerOrder rows={statement.perOrder} open={ordersOpen} setOpen={setOrdersOpen} />
        </>
      )}

      {statement && viewPayee && payeeSlice && <PayeeView slice={payeeSlice} month={month} />}
    </div>
  );
}
