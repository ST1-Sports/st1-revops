import { useState, useEffect, useCallback } from "react";

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
  purple:"#6B3FA0", purpleBg:"#F3EEFB",
  teal:"#0C7B6A", tealBg:"#E6F5F2",
  indigo:"#3730A3", indigoBg:"#EEF2FF",
  rose:"#9D174D", roseBg:"#FFF1F2",
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

export default function TeamStores() {
  const [days, setDays]           = useState(0);
  const [loading, setLoading]     = useState(false);
  const [configured, setConfigured] = useState(null);
  const [stores, setStores]       = useState([]);
  const [sellers, setSellers]     = useState([]);
  const [recent, setRecent]       = useState([]);
  const [summary, setSummary]     = useState(null);
  const [adminStores, setAdminStores] = useState([]);
  const [permProbe, setPermProbe] = useState(null);
  const [permProbing, setPermProbing] = useState(false);
  const [extProbe, setExtProbe] = useState(null);
  const [extProbing, setExtProbing] = useState(false);
  const [storeScan, setStoreScan] = useState(null);
  const [storeScanning, setStoreScanning] = useState(false);
  const [profileProbe, setProfileProbe] = useState(null);
  const [profileProbing, setProfileProbing] = useState(false);
  const [ordersProbe, setOrdersProbe] = useState(null);
  const [ordersProbing, setOrdersProbing] = useState(false);
  const [rawSample, setRawSample] = useState(null);
  const [rawSampling, setRawSampling] = useState(false);
  const [sellersMeta, setSellersMeta] = useState(null);
  const [error, setError]         = useState(null);
  const [sortCol, setSortCol]     = useState("revenue");
  const [sortDir, setSortDir]     = useState("desc");
  const [tab, setTab]             = useState("stores");

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const [storesRes, recentRes, adminStoresRes, adminSellersRes] = await Promise.all([
        fetch("/api/stripe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stores", days: d }) }),
        fetch("/api/stripe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recent", days: d, limit: 20 }) }),
        fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stores" }) }),
        fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "top-sellers" }) }),
      ]);
      const [sd, rd, ad, asd] = await Promise.all([storesRes.json(), recentRes.json(), adminStoresRes.json(), adminSellersRes.json()]);
      if (!sd.ok) throw new Error(sd.error);
      setStores(sd.stores || []);
      setSummary(sd.summary || null);
      setRecent(rd.recent || []);
      if (ad.ok) setAdminStores(ad.stores || []);
      if (asd.ok) {
        setSellers(asd.sellers || []);
        setSellersMeta({ rawOrderCount: asd.rawOrderCount, ordersWithDetail: asd.ordersWithDetail });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/stripe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) })
      .then(r => r.json())
      .then(d => { setConfigured(d.configured); if (d.configured) load(days); })
      .catch(() => setConfigured(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (configured === false) {
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: B.text, marginBottom: 12 }}>Team Store Reporting</div>
        <div style={{ background: B.yellowBg, border: `1px solid ${B.yellow}`, borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontWeight: 700, color: B.yellow, marginBottom: 8 }}>Stripe Not Configured</div>
          <div style={{ fontSize: 13, color: B.textMid, lineHeight: 1.7 }}>Add <code style={{ background: B.border, padding: "1px 5px", borderRadius: 3 }}>STRIPE_SECRET_KEY</code> to your Vercel environment variables.</div>
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

      {error && <div style={{ background: B.redBg, border: `1px solid ${B.red}`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: B.red }}>{error}</div>}

      {summary?.truncated && (
        <div style={{ background: B.yellowBg, border: `1px solid ${B.yellow}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: B.yellow }}>
          Showing first 5,000 charges — results may be incomplete.
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
        ) : stores.length === 0 ? (
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

      {tab === "sellers" && (
        loading && !sellers.length ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>Loading…</div>
        ) : sellers.length === 0 ? (
          <div style={{ padding: 24 }}>
            <div style={{ textAlign: "center", color: B.muted, marginBottom: 20 }}>
            No product data — run <strong>Raw Sample</strong> to inspect the order field structure.
            {sellersMeta && (
              <span style={{ display: "block", fontSize: 11, color: B.muted, marginTop: 6 }}>
                Last attempt: {sellersMeta.rawOrderCount ?? 0} orders fetched, {sellersMeta.ordersWithDetail ?? 0} with detail returned.
              </span>
            )}
          </div>
            <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: B.muted, textTransform: "uppercase" }}>Admin Credential Check</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={async () => { setRawSampling(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "raw-sample" }) }); setRawSample(await r.json()); } finally { setRawSampling(false); } }} disabled={rawSampling}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: rawSampling ? "default" : "pointer", border: `1px solid ${B.slate}`, borderRadius: 6, background: B.slateBg, color: B.slate }}>
                    {rawSampling ? "Loading…" : "Raw Sample"}</button>
                  <button onClick={async () => { setPermProbing(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "probe-permissions" }) }); setPermProbe(await r.json()); } finally { setPermProbing(false); } }} disabled={permProbing}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: permProbing ? "default" : "pointer", border: "1px solid #4A235A", borderRadius: 6, background: "#F5EFF9", color: "#4A235A" }}>
                    {permProbing ? "Probing…" : "Probe Permissions"}</button>
                  <button onClick={async () => { setExtProbing(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "probe-extended" }) }); setExtProbe(await r.json()); } finally { setExtProbing(false); } }} disabled={extProbing}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: extProbing ? "default" : "pointer", border: "1px solid #4A4A00", borderRadius: 6, background: "#FAFAE8", color: "#4A4A00" }}>
                    {extProbing ? "Probing…" : "Extended Probe"}</button>
                  <button onClick={async () => { setStoreScanning(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan-store-orders" }) }); setStoreScan(await r.json()); } finally { setStoreScanning(false); } }} disabled={storeScanning}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: storeScanning ? "default" : "pointer", border: `1px solid ${B.teal}`, borderRadius: 6, background: B.tealBg, color: B.teal }}>
                    {storeScanning ? "Scanning…" : "Find Store Orders API"}</button>
                  <button onClick={async () => { setProfileProbing(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get-profile" }) }); setProfileProbe(await r.json()); } finally { setProfileProbing(false); } }} disabled={profileProbing}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: profileProbing ? "default" : "pointer", border: `1px solid ${B.indigo}`, borderRadius: 6, background: B.indigoBg, color: B.indigo }}>
                    {profileProbing ? "Loading…" : "Get Profile"}</button>
                  <button onClick={async () => { setOrdersProbing(true); try { const r = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "probe-orders" }) }); setOrdersProbe(await r.json()); } finally { setOrdersProbing(false); } }} disabled={ordersProbing}
                    style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: ordersProbing ? "default" : "pointer", border: `1px solid ${B.rose}`, borderRadius: 6, background: B.roseBg, color: B.rose }}>
                    {ordersProbing ? "Probing…" : "Probe Orders"}</button>
                </div>
              </div>

              {rawSample && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: `1px solid ${B.slate}`, borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: B.slate, marginBottom: 8 }}>
                    Raw order sample ({rawSample.totalFetched} fetched):
                  </div>
                  {rawSample.error && <div style={{ color: B.red, fontSize: 12 }}>{rawSample.error}</div>}
                  {rawSample.sample?.map((order, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: B.slate, marginBottom: 3 }}>Bulk order {i + 1} — fields: {Object.keys(order).join(", ")}</div>
                      <pre style={{ fontSize: 10, background: B.slateBg, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 200, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {JSON.stringify(order, null, 2)}
                      </pre>
                    </div>
                  ))}
                  {!rawSample.sample?.length && !rawSample.error && <div style={{ fontSize: 12, color: B.muted }}>No orders returned.</div>}
                  {rawSample.firstOrderId && (
                    <div style={{ marginTop: 10, borderTop: `1px solid ${B.border}`, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: B.slate, marginBottom: 3 }}>
                        Individual order detail — GET team_store_order/{rawSample.firstOrderId} → HTTP {rawSample.orderDetailStatus ?? "N/A"}
                      </div>
                      {rawSample.orderDetailError && <div style={{ color: B.red, fontSize: 11, marginBottom: 4 }}>Error: {rawSample.orderDetailError}</div>}
                      {rawSample.orderDetail && (
                        <>
                          <div style={{ fontSize: 10, color: B.slate, marginBottom: 3 }}>Fields: {Object.keys(rawSample.orderDetail).join(", ")}</div>
                          <pre style={{ fontSize: 10, background: B.slateBg, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 240, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            {JSON.stringify(rawSample.orderDetail, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                  {rawSample.firstCartId && (
                    <div style={{ marginTop: 10, borderTop: `1px solid ${B.border}`, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: B.teal, marginBottom: 3 }}>
                        Cart detail — GET cart/{rawSample.firstCartId} → HTTP {rawSample.cartDetailStatus ?? "N/A"}
                      </div>
                      {rawSample.cartDetailError && <div style={{ color: B.red, fontSize: 11, marginBottom: 4 }}>Error: {rawSample.cartDetailError}</div>}
                      {rawSample.cartDetail && (
                        <>
                          <div style={{ fontSize: 10, color: B.teal, marginBottom: 3 }}>Fields: {Object.keys(rawSample.cartDetail).join(", ")}</div>
                          <pre style={{ fontSize: 10, background: B.tealBg, border: `1px solid ${B.border}`, borderRadius: 4, padding: "6px 8px", overflow: "auto", maxHeight: 240, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            {JSON.stringify(rawSample.cartDetail, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {ordersProbe && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: `1px solid ${B.rose}`, borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: B.rose, marginBottom: 8 }}>Orders probe — suppliers: [{ordersProbe.supplierIds?.length || 0}]:</div>
                  {ordersProbe.error && <div style={{ color: B.red, fontSize: 12 }}>{ordersProbe.error}</div>}
                  {ordersProbe.working?.length > 0 && (
                    <div style={{ marginBottom: 8, padding: "6px 10px", background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: B.green, marginBottom: 4 }}>Working ({ordersProbe.working.length}):</div>
                      {ordersProbe.working.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: B.green, marginBottom: 2 }}>
                          <code>{r.path}</code> → {r.status}{r.count != null ? ` (${r.count} items)` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                  {ordersProbe.results?.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: r.error ? B.muted : r.status === 200 ? B.green : B.muted, marginBottom: 2, fontWeight: r.status === 200 ? 700 : 400 }}>
                      <code style={{ wordBreak: "break-all" }}>{r.path}</code> → {r.error || r.status}{r.count != null ? ` (${r.count})` : ""}
                    </div>
                  ))}
                </div>
              )}

              {profileProbe && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: `1px solid ${B.indigo}`, borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: B.indigo, marginBottom: 8 }}>
                    Account Profile — auth: {profileProbe.authType || "?"}{profileProbe.hasCookies ? " + cookies" : " (no cookies)"}
                  </div>
                  {profileProbe.profile ? (
                    <pre style={{ fontSize: 10, background: B.indigoBg, border: `1px solid ${B.indigo}`, borderRadius: 4, padding: "8px 10px", overflow: "auto", maxHeight: 200, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {JSON.stringify(profileProbe.profile.data, null, 2)}
                    </pre>
                  ) : (
                    <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic" }}>No profile endpoint returned 200.</div>
                  )}
                </div>
              )}

              {permProbe && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: "1px solid #4A235A", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#4A235A", marginBottom: 8 }}>
                    Permissions — auth: {permProbe.authType || "?"}{permProbe.hasCookies ? " + cookies" : ""}
                  </div>
                  {permProbe.error && <div style={{ color: B.red, fontSize: 12 }}>{permProbe.error}</div>}
                  {permProbe.accessible?.length > 0 && (
                    <div style={{ marginBottom: 8, padding: "6px 10px", background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: B.green, marginBottom: 4 }}>Accessible ({permProbe.accessible.length}):</div>
                      {permProbe.accessible.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: B.green, marginBottom: 2 }}><code>{r.path}</code> → {r.status}: {r.snippet?.slice(0, 160)}</div>
                      ))}
                    </div>
                  )}
                  {permProbe.sweepResults?.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: r.error ? B.muted : r.status < 400 ? B.green : B.muted, marginBottom: 2, fontWeight: r.status && r.status < 400 ? 700 : 400 }}>
                      <code>{r.path}</code> → {r.error || r.status}{r.snippet && r.status < 400 ? `: ${r.snippet.slice(0, 150)}` : ""}
                    </div>
                  ))}
                </div>
              )}

              {extProbe && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: "1px solid #4A4A00", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#4A4A00", marginBottom: 8 }}>Extended probe</div>
                  {extProbe.allAccessible?.length > 0 ? (
                    <div style={{ padding: "6px 10px", background: B.greenBg, border: `1px solid ${B.green}`, borderRadius: 4 }}>
                      {extProbe.allAccessible.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: B.green, marginBottom: 2 }}><code>{r.path}</code> → {r.status}: {r.snippet?.slice(0, 160)}</div>
                      ))}
                    </div>
                  ) : <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic" }}>No additional accessible endpoints found.</div>}
                </div>
              )}

              {storeScan && (
                <div style={{ marginBottom: 10, padding: "10px 12px", background: B.white, border: `1px solid ${B.teal}`, borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: B.teal, marginBottom: 8 }}>Store orders API scan ({storeScan.totalChunks} chunks):</div>
                  {storeScan.hits?.map((h, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 3 }}>{h.chunk} ({h.sizeKB}KB)</div>
                      {h.orderPaths?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>{h.orderPaths.map((p, j) => <code key={j} style={{ fontSize: 10, background: B.tealBg, border: `1px solid ${B.teal}`, padding: "1px 5px", borderRadius: 3, color: B.teal }}>{p}</code>)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      {tab === "recent" && (
        loading && !recent.length ? (
          <div style={{ textAlign: "center", padding: 60, color: B.muted }}>Loading…</div>
        ) : recent.length === 0 ? (
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
