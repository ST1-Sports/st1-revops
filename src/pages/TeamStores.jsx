import { useState, useEffect, useCallback } from "react";
import { postReport } from "../lib/reportFetch.js";

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
  teal:"#0C7B6A", tealBg:"#E6F5F2",
  slate:"#334155", slateBg:"#F1F5F9",
};

const fmt$ = n => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = n => Number(n || 0).toLocaleString("en-US");

const DAYS_OPTIONS = [
  { label: "7 days",  value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "1 year",  value: 365 },
  { label: "All time", value: 0 },
];

// Open on 90 days rather than all-time. All-time means Stripe pages through
// every charge the account has ever taken, which is what pushed this endpoint
// past its timeout as order volume grew — the range is still one click away.
const DEFAULT_DAYS = 90;

function Card({ label, value, sub, color = B.text }) {
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "18px 22px", flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: B.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: B.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SortIcon({ col, sortCol, sortDir }) {
  if (col !== sortCol) return <span style={{ color: B.gray2, marginLeft: 4 }}>⇅</span>;
  return <span style={{ color: B.blue, marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
}

// One failing source shouldn't hide the ones that worked — each section says
// what went wrong where the data would have been.
function SectionError({ children, tone = "red" }) {
  const bg = tone === "red" ? B.redBg : B.yellowBg;
  const fg = tone === "red" ? B.red : B.yellow;
  return (
    <div style={{ background: bg, border: `1px solid ${fg}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: fg, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

export default function TeamStores() {
  const [days, setDays]             = useState(DEFAULT_DAYS);
  const [loading, setLoading]       = useState(false);
  const [configured, setConfigured] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [stores, setStores]         = useState([]);
  const [sellers, setSellers]       = useState([]);
  const [recent, setRecent]         = useState([]);
  const [summary, setSummary]       = useState(null);
  const [adminStores, setAdminStores] = useState([]);
  const [sellersMeta, setSellersMeta] = useState(null);
  const [rawSample, setRawSample]   = useState(null);
  const [rawSampling, setRawSampling] = useState(false);
  // One error slot per source — a failure in any one of them leaves the other
  // three reports on screen instead of replacing the whole tab.
  const [error, setError]           = useState(null);
  const [recentError, setRecentError] = useState(null);
  const [sellersError, setSellersError] = useState(null);
  const [adminError, setAdminError] = useState(null);
  const [sortCol, setSortCol]       = useState("revenue");
  const [sortDir, setSortDir]       = useState("desc");
  const [tab, setTab]               = useState("stores");

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null); setRecentError(null); setSellersError(null); setAdminError(null);

    // Applied as each request lands, so the fast sources paint immediately
    // instead of waiting on the slowest one.
    const jobs = [
      postReport("/api/stripe", { action: "stores", days: d }).then(r => {
        if (r.ok) { setStores(r.data.stores || []); setSummary(r.data.summary || null); }
        else { setStores([]); setSummary(null); setError(r.error); }
      }),
      postReport("/api/stripe", { action: "recent", days: d, limit: 20 }).then(r => {
        if (r.ok) setRecent(r.data.recent || []);
        else { setRecent([]); setRecentError(r.error); }
      }),
      postReport("/api/admin-stores", { action: "stores" }).then(r => {
        if (r.ok) setAdminStores(r.data.stores || []);
        else { setAdminStores([]); setAdminError(r.error); }
      }),
      postReport("/api/admin-stores", { action: "top-sellers" }).then(r => {
        if (r.ok) {
          setSellers(r.data.sellers || []);
          setSellersMeta({
            rawOrderCount:   r.data.rawOrderCount,
            ordersWithDetail: r.data.ordersWithDetail,
            partial:         r.data.partial,
            partialReason:   r.data.partialReason,
          });
        } else {
          setSellers([]); setSellersMeta(null); setSellersError(r.error);
        }
      }),
    ];

    await Promise.all(jobs);
    setLoading(false);
  }, []);

  const checkStatus = useCallback(async () => {
    setStatusError(null);
    const r = await postReport("/api/stripe", { action: "status" });
    if (!r.ok) {
      // A failed status check is not the same thing as "no key configured" —
      // saying so sent people off editing env vars that were already correct.
      setConfigured(null);
      setStatusError(r.error);
      return;
    }
    setConfigured(r.data.configured);
    if (r.data.configured) load(days);
    else if (r.data.error) setStatusError(r.data.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, load]);

  useEffect(() => { checkStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function matchAdminStore(stripeName) {
    if (!adminStores.length) return null;
    const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const n = norm(stripeName);
    return adminStores.find(a => {
      const aName = norm(a.name || a.store_name || a.title || "");
      const aSlug = norm(a.slug || a.url_slug || a.store_slug || "");
      return aName === n || aSlug === n || n.includes(aName) || aName.includes(n);
    }) || null;
  }

  function handleDays(d) { setDays(d); load(d); }
  function handleSort(col) {
    if (col === sortCol) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const sortedStores = [...stores].sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const thStyle = (col) => ({
    padding: "10px 14px", textAlign: col === "storeName" ? "left" : "right",
    fontSize: 11, fontWeight: 700, color: B.muted, textTransform: "uppercase",
    letterSpacing: "0.05em", cursor: "pointer", whiteSpace: "nowrap",
    userSelect: "none", borderBottom: `2px solid ${B.border}`, background: B.surface,
  });
  const tdStyle = (align = "right") => ({
    padding: "11px 14px", fontSize: 13, color: B.text,
    borderBottom: `1px solid ${B.border}`, textAlign: align,
  });

  const retryBtn = (label = "↻ Try again") => (
    <button onClick={checkStatus} style={{
      marginTop: 12, padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${B.borderD}`, background: B.white, color: B.textMid,
    }}>{label}</button>
  );

  // Only shown when the server actually reports no key — a status call that
  // itself failed falls through to the dashboard with an error banner instead.
  if (configured === false) {
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: B.text, marginBottom: 12 }}>Team Store Reporting</div>
        <div style={{ background: B.yellowBg, border: `1px solid ${B.yellow}`, borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontWeight: 700, color: B.yellow, marginBottom: 8 }}>Stripe Not Configured</div>
          <div style={{ fontSize: 13, color: B.textMid, lineHeight: 1.7 }}>Add <code style={{ background: B.border, padding: "1px 5px", borderRadius: 3 }}>STRIPE_SECRET_KEY</code> to your Vercel environment variables.</div>
          {statusError && <div style={{ fontSize: 12, color: B.red, marginTop: 10, lineHeight: 1.6 }}>Stripe rejected the current key: {statusError}</div>}
          {retryBtn("↻ Re-check")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: B.text }}>Team Store Reporting</div>
          <div style={{ fontSize: 13, color: B.muted, marginTop: 3 }}>Stripe sales data grouped by store</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {DAYS_OPTIONS.map(o => (
            <button key={o.value} onClick={() => handleDays(o.value)} style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${days === o.value ? B.blue : B.border}`,
              background: days === o.value ? B.blueBg : B.white,
              color: days === o.value ? B.blue : B.muted,
            }}>{o.label}</button>
          ))}
          <button onClick={() => load(days)} disabled={loading} style={{
            padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: loading ? "default" : "pointer",
            border: `1px solid ${B.border}`, background: B.white, color: B.muted,
          }}>{loading ? "Loading…" : "↻ Refresh"}</button>
        </div>
      </div>

      {statusError && configured === null && (
        <SectionError>
          Couldn't confirm the Stripe connection: {statusError}
          <div>{retryBtn()}</div>
        </SectionError>
      )}

      {error && (
        <SectionError>
          Stripe sales couldn't be loaded: {error}
        </SectionError>
      )}

      {adminError && (
        <SectionError tone="yellow">
          Store status and links from admin.st1sports.com are unavailable: {adminError} Revenue figures below are unaffected.
        </SectionError>
      )}

      {summary?.truncated && (
        <div style={{ background: B.yellowBg, border: `1px solid ${B.yellow}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: B.yellow }}>
          {summary.truncatedReason === "time"
            ? `Stopped after scanning ${fmtN(summary.totalChargesScanned)} charges to stay inside the request time limit — totals may be incomplete. Pick a shorter date range for exact numbers.`
            : `Showing the first ${fmtN(summary.totalChargesScanned)} charges — totals may be incomplete. Pick a shorter date range for exact numbers.`}
        </div>
      )}

      {summary && (
        <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
          <Card label="Total Revenue" value={fmt$(summary.totalRevenue)} sub={summary.days === "all-time" ? "All time" : `Last ${summary.days} days`} color={B.green} />
          <Card label="Total Orders"  value={fmtN(summary.totalOrders)} sub={`${fmtN(summary.totalChargesScanned)} charges scanned`} />
          <Card label="Active Stores" value={fmtN(summary.activeStores)} sub="With store metadata" />
          <Card label="Avg Order Value" value={summary.totalOrders > 0 ? fmt$(summary.totalRevenue / summary.totalOrders) : "$0.00"} />
        </div>
      )}

      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${B.border}`, marginBottom: 20 }}>
        {[["stores", "Stores"], ["sellers", "Top Sellers"], ["recent", "Recent Orders"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            border: "none", background: "none",
            color: tab === id ? B.blue : B.muted,
            borderBottom: `2px solid ${tab === id ? B.blue : "transparent"}`,
            marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {tab === "stores" && (
        loading && !stores.length ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>Loading store data…</div>
        ) : error && !stores.length ? null : stores.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>No charges found for this period.{days === 0 ? "" : " Try expanding the date range."}</div>
        ) : (
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  {[["storeName","Store","left"],["revenue","Revenue","right"],["orders","Orders","right"],["avgOrder","Avg Order","right"],["lastSale","Last Sale","right"]].map(([col, label, align]) => (
                    <th key={col} style={{ ...thStyle(col), textAlign: align }} onClick={() => handleSort(col)}>{label}<SortIcon col={col} sortCol={sortCol} sortDir={sortDir} /></th>
                  ))}
                  {adminStores.length > 0 && <th style={{ ...thStyle("status"), textAlign: "left" }}>Status</th>}
                  {adminStores.length > 0 && <th style={{ ...thStyle("link"), textAlign: "left" }}>Store</th>}
                </tr></thead>
                <tbody>
                  {sortedStores.map((store, i) => {
                    const adminMatch = matchAdminStore(store.storeName);
                    const status = adminMatch?.status || adminMatch?.state || adminMatch?.published;
                    const slug = adminMatch?.slug || adminMatch?.url_slug || adminMatch?.store_slug;
                    const isOpen = status === true || ["active", "open", "published", "Active"].includes(status);
                    const isClosed = status === false || ["inactive", "closed", "draft", "deactivated", "Deactivated"].includes(status);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? B.white : B.surface }}>
                        <td style={tdStyle("left")}><div style={{ fontWeight: 600, color: store.storeName === "Unattributed" ? B.muted : B.text }}>{store.storeName}</div></td>
                        <td style={{ ...tdStyle(), fontWeight: 700, color: B.green }}>{fmt$(store.revenue)}</td>
                        <td style={tdStyle()}>{fmtN(store.orders)}</td>
                        <td style={tdStyle()}>{fmt$(store.avgOrder)}</td>
                        <td style={{ ...tdStyle(), color: B.muted, fontSize: 12 }}>{store.lastSale || "—"}</td>
                        {adminStores.length > 0 && (
                          <td style={tdStyle("left")}>
                            {adminMatch ? (
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: isOpen ? B.greenBg : isClosed ? B.redBg : B.yellowBg, color: isOpen ? B.green : isClosed ? B.red : B.yellow }}>
                                {String(status ?? "unknown").toUpperCase()}
                              </span>
                            ) : <span style={{ color: B.gray2, fontSize: 12 }}>—</span>}
                          </td>
                        )}
                        {adminStores.length > 0 && (
                          <td style={tdStyle("left")}>
                            {slug ? <a href={`https://store.st1sports.com/${slug}`} target="_blank" rel="noopener noreferrer" style={{ color: B.blue, fontSize: 12, textDecoration: "none" }}>/{slug} ↗</a>
                              : <span style={{ color: B.gray2, fontSize: 12 }}>—</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 16px", fontSize: 12, color: B.muted, borderTop: `1px solid ${B.border}` }}>
              {stores.length} store{stores.length !== 1 ? "s" : ""} · Revenue from succeeded, non-refunded Stripe charges
            </div>
          </div>
        )
      )}

      {tab === "sellers" && sellersError && (
        <SectionError>
          Top sellers couldn't be loaded: {sellersError}
        </SectionError>
      )}

      {tab === "sellers" && sellersMeta?.partial && (
        <SectionError tone="yellow">
          Ranked from the first {fmtN(sellersMeta.rawOrderCount ?? 0)} orders only —
          {sellersMeta.partialReason === "time"
            ? " the store admin ran out of request time before every order was read."
            : " the order scan hit its page limit."}
          {" "}Units and revenue below are therefore a floor, not a total.
        </SectionError>
      )}

      {tab === "sellers" && (
        loading && !sellers.length ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>Loading…</div>
        ) : sellersError && !sellers.length ? null : sellers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>
            <div style={{ marginBottom: 16 }}>No product data found.</div>
            {sellersMeta && (
              <div style={{ fontSize: 12, marginBottom: 16 }}>
                {sellersMeta.rawOrderCount ?? 0} orders fetched · {sellersMeta.ordersWithDetail ?? 0} with line item detail returned
              </div>
            )}
            <button
              onClick={async () => {
                setRawSampling(true);
                const r = await postReport("/api/admin-stores", { action: "raw-sample" });
                setRawSample(r.ok ? r.data : { error: r.error });
                setRawSampling(false);
              }}
              disabled={rawSampling}
              style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: rawSampling ? "default" : "pointer", border: `1px solid ${B.slate}`, borderRadius: 6, background: B.slateBg, color: B.slate }}
            >
              {rawSampling ? "Loading…" : "Inspect Order Structure"}
            </button>
            {rawSample && (
              <div style={{ marginTop: 20, textAlign: "left", background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 16 }}>
                {rawSample.error && <div style={{ color: B.red, fontSize: 12, marginBottom: 8 }}>{rawSample.error}</div>}
                {rawSample.firstOrderId && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: B.slate, marginBottom: 4 }}>
                      team_store_order/{rawSample.firstOrderId} → HTTP {rawSample.orderDetailStatus ?? "N/A"}
                    </div>
                    {rawSample.orderDetailError && <div style={{ color: B.red, fontSize: 11, marginBottom: 4 }}>{rawSample.orderDetailError}</div>}
                    {rawSample.orderDetail && (
                      <>
                        <div style={{ fontSize: 10, color: B.muted, marginBottom: 4 }}>Fields: {Object.keys(rawSample.orderDetail).join(", ")}</div>
                        <pre style={{ fontSize: 10, background: B.slateBg, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 260, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(rawSample.orderDetail, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                )}
                {rawSample.firstCartId && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: B.teal, marginBottom: 4 }}>
                      cart/{rawSample.firstCartId} → HTTP {rawSample.cartDetailStatus ?? "N/A"}
                    </div>
                    {rawSample.cartDetailError && <div style={{ color: B.red, fontSize: 11, marginBottom: 4 }}>{rawSample.cartDetailError}</div>}
                    {rawSample.cartDetail && (
                      <>
                        <div style={{ fontSize: 10, color: B.muted, marginBottom: 4 }}>Fields: {Object.keys(rawSample.cartDetail).join(", ")}</div>
                        <pre style={{ fontSize: 10, background: B.tealBg, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 260, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(rawSample.cartDetail, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                )}
                {rawSample.sample?.map((order, i) => (
                  <div key={i} style={{ marginTop: 12, borderTop: `1px solid ${B.border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: B.muted, marginBottom: 4 }}>Bulk order {i + 1} fields: {Object.keys(order).join(", ")}</div>
                    <pre style={{ fontSize: 10, background: B.surface, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 180, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {JSON.stringify(order, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...thStyle("name"), textAlign: "left" }}>#</th>
                  <th style={{ ...thStyle("name"), textAlign: "left" }}>Product</th>
                  <th style={thStyle("quantity")}>Units Sold</th>
                  <th style={thStyle("revenue")}>Revenue</th>
                  <th style={thStyle("orders")}>Orders</th>
                  <th style={thStyle("stores")}>Stores</th>
                </tr></thead>
                <tbody>
                  {sellers.map((s, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? B.white : B.surface }}>
                      <td style={{ ...tdStyle("left"), color: B.muted, width: 40 }}>{i + 1}</td>
                      <td style={{ ...tdStyle("left"), fontWeight: 600 }}>{s.name}</td>
                      <td style={{ ...tdStyle(), fontWeight: 700 }}>{fmtN(s.quantity || 0)}</td>
                      <td style={{ ...tdStyle(), fontWeight: 700, color: B.green }}>{s.revenue > 0 ? fmt$(s.revenue) : "—"}</td>
                      <td style={tdStyle()}>{fmtN(s.orders)}</td>
                      <td style={{ ...tdStyle(), color: B.muted }}>{s.stores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === "recent" && recentError && (
        <SectionError>
          Recent orders couldn't be loaded: {recentError}
        </SectionError>
      )}

      {tab === "recent" && (
        loading && !recent.length ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>Loading…</div>
        ) : recentError && !recent.length ? null : recent.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>No recent orders found.</div>
        ) : (
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ ...thStyle("date"), textAlign: "left" }}>Date</th>
                  <th style={{ ...thStyle("store"), textAlign: "left" }}>Store</th>
                  <th style={{ ...thStyle("orderNumber"), textAlign: "left" }}>Order #</th>
                  <th style={{ ...thStyle("customer"), textAlign: "left" }}>Customer</th>
                  <th style={thStyle("amount")}>Amount</th>
                  <th style={thStyle("receipt")}></th>
                </tr></thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? B.white : B.surface }}>
                      <td style={{ ...tdStyle("left"), color: B.muted, fontSize: 12, whiteSpace: "nowrap" }}>{r.date}</td>
                      <td style={{ ...tdStyle("left"), fontWeight: 600, fontSize: 13 }}>{r.store}</td>
                      <td style={{ ...tdStyle("left"), color: B.muted, fontSize: 12, whiteSpace: "nowrap" }}>{r.orderNumber || "—"}</td>
                      <td style={{ ...tdStyle("left"), color: B.muted, fontSize: 12 }}>{r.customer || "—"}</td>
                      <td style={{ ...tdStyle(), fontWeight: 700, color: B.green, whiteSpace: "nowrap" }}>{fmt$(r.amount)}</td>
                      <td style={{ ...tdStyle(), width: 40 }}>{r.receiptUrl && <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ color: B.blue, fontSize: 12, textDecoration: "none" }}>↗</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
