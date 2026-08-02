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
  purple:"#7C3AED", purpleBg:"#F3EEFF",
  teal:"#0C7B6A", tealBg:"#E6F5F2",
};

const fmt$ = n => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtN = n => Number(n || 0).toLocaleString("en-US");
const pct  = (n, of) => of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—";

const DAYS_OPTIONS = [
  { label: "7 days",  value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function Card({ label, value, sub, color = B.text }) {
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: B.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: B.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, accent, children, note }) {
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 280 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: accent || B.text }}>{title}</div>
        {note && <div style={{ fontSize: 11, color: B.muted }}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

function BarRow({ label, value, max, color }) {
  const w = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: B.text, marginBottom: 3 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{label}</span>
        <span style={{ color: B.muted, fontWeight: 600 }}>{fmtN(value)}</span>
      </div>
      <div style={{ background: B.surface, borderRadius: 3, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function NotConfigured({ what, envVars }) {
  return (
    <div style={{ fontSize: 12, color: B.muted, lineHeight: 1.6 }}>
      {what} isn't connected yet. Add {envVars.map((v, i) => (
        <span key={v}>{i > 0 ? ", " : ""}<code style={{ background: B.surface, border: `1px solid ${B.border}`, padding: "1px 5px", borderRadius: 3 }}>{v}</code></span>
      ))} to Vercel's environment variables.
    </div>
  );
}

export default function FlagshipStore() {
  const [days, setDays]       = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [data, setData]       = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/analytics/store-overview?days=${d}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      setData(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleDays = (d) => { setDays(d); load(d); };

  const shopify = data?.shopify;
  const ga4     = data?.ga4;
  const klaviyo = data?.klaviyo;

  const maxSource   = Math.max(1, ...((ga4?.topSources || []).map(s => s.sessions)));
  const maxProduct  = Math.max(1, ...((shopify?.topProducts || []).map(p => p.qty)));
  const maxCartItem = Math.max(1, ...((ga4?.addToCartProducts || []).map(p => p.adds)));

  return (
    <div style={{ padding: "26px 34px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: B.text }}>Flagship Store</div>
          <div style={{ fontSize: 12, color: B.muted, marginTop: 2 }}>Shopify + Google Analytics + Klaviyo, in one view</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {DAYS_OPTIONS.map(o => (
            <button key={o.value} onClick={() => handleDays(o.value)}
              style={{ padding: "6px 14px", background: days === o.value ? B.orange : B.white, color: days === o.value ? B.white : B.muted, border: `1px solid ${days === o.value ? B.orange : B.border}`, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: B.muted, padding: "40px 0", textAlign: "center" }}>Loading store performance…</div>}
      {error && <div style={{ background: B.redBg, border: `1px solid ${B.red}`, borderRadius: 8, padding: "14px 18px", color: B.red, fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {!loading && !error && data && (
        <>
          {/* ── TOP-LINE CARDS ── */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Card label="Revenue" value={shopify?.configured ? fmt$(shopify.revenue) : "—"} sub={shopify?.configured ? `${fmtN(shopify.orders)} orders` : null} color={B.green} />
            <Card label="Avg Order Value" value={shopify?.configured ? fmt$(shopify.avgOrderValue) : "—"} color={B.text} />
            <Card label="Sessions" value={ga4?.configured ? fmtN(ga4.sessions) : "—"} sub={ga4?.configured ? `${fmtN(ga4.activeUsers)} users` : null} color={B.blue} />
            <Card label="Cart → Order Rate" value={shopify?.configured ? pct(shopify.orders, shopify.orders + shopify.checkoutsAbandoned) : "—"}
              sub={shopify?.configured ? `${fmtN(shopify.checkoutsAbandoned)} abandoned` : null} color={B.orange} />
            <Card label="Klaviyo Form Signups" value={klaviyo?.configured ? fmtN(klaviyo.formSubmissions) : "—"}
              sub={klaviyo?.metricUsed ? `via "${klaviyo.metricUsed}"` : null} color={B.purple} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {/* ── TOP TRAFFIC SOURCES (GA4) ── */}
            <Panel title="TOP TRAFFIC SOURCES" accent={B.blue}>
              {!ga4?.configured ? <NotConfigured what="Google Analytics" envVars={["GA4_PROPERTY_ID", "GOOGLE_ANALYTICS_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_SECRET", "GOOGLE_ANALYTICS_REFRESH_TOKEN"]} /> :
                ga4.error ? <div style={{ fontSize: 12, color: B.red }}>{ga4.error}</div> :
                (ga4.topSources || []).length === 0 ? <div style={{ fontSize: 12, color: B.muted }}>No sessions in this range.</div> :
                ga4.topSources.map(s => <BarRow key={s.source} label={s.source} value={s.sessions} max={maxSource} color={B.blue} />)}
            </Panel>

            {/* ── TOP PRODUCTS SOLD (Shopify) ── */}
            <Panel title="TOP PRODUCTS SOLD" accent={B.green}>
              {!shopify?.configured ? <NotConfigured what="Shopify" envVars={["SHOPIFY_STORE_URL", "SHOPIFY_ACCESS_TOKEN"]} /> :
                shopify.error ? <div style={{ fontSize: 12, color: B.red }}>{shopify.error}</div> :
                (shopify.topProducts || []).length === 0 ? <div style={{ fontSize: 12, color: B.muted }}>No orders in this range.</div> :
                shopify.topProducts.map(p => <BarRow key={p.name} label={p.name} value={p.qty} max={maxProduct} color={B.green} />)}
            </Panel>

            {/* ── TOP ADD-TO-CART PRODUCTS (GA4 ecommerce) ── */}
            <Panel title="MOST ADDED TO CART" accent={B.orange} note="from GA4 ecommerce events">
              {!ga4?.configured ? <NotConfigured what="Google Analytics" envVars={["GA4_PROPERTY_ID"]} /> :
                ga4.error ? <div style={{ fontSize: 12, color: B.red }}>{ga4.error}</div> :
                (ga4.addToCartProducts || []).length === 0 ? <div style={{ fontSize: 12, color: B.muted }}>No add-to-cart events tracked in this range — check that Shopify's GA4 ecommerce tracking is enabled.</div> :
                ga4.addToCartProducts.map(p => <BarRow key={p.item} label={p.item} value={p.adds} max={maxCartItem} color={B.orange} />)}
            </Panel>
          </div>

          {(shopify?.error || ga4?.error || klaviyo?.error) && (
            <div style={{ marginTop: 16, background: B.yellowBg, border: `1px solid ${B.yellow}`, borderRadius: 8, padding: "12px 16px", fontSize: 12, color: B.textMid, lineHeight: 1.7 }}>
              {shopify?.error && <div>Shopify: {shopify.error}</div>}
              {ga4?.error && <div>Google Analytics: {ga4.error}</div>}
              {klaviyo?.error && <div>Klaviyo: {klaviyo.error}</div>}
            </div>
          )}
          {klaviyo?.note && <div style={{ marginTop: 12, fontSize: 11, color: B.muted }}>{klaviyo.note}</div>}
        </>
      )}
    </div>
  );
}
