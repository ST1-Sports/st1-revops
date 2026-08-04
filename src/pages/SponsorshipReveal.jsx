/**
 * Standalone, full-page sponsorship "reveal" — its own route so it can be
 * opened in a second tab/window (and dragged to a second monitor/TV at an
 * event) while the rep keeps working from the Quick Sponsorship Estimate
 * modal in the original tab. All inputs come in via the URL query string so
 * no app state needs to cross the tab boundary.
 *
 * URL: /sponsorship-reveal?school=...&provider=...&class=...&sports=...&athletes=...&min=...&max=...
 */
import React from 'react'
import { useSearchParams } from 'react-router-dom'

const B = { orange: "#F37321", gray1: "#424242", black: "#0A0A0A", white: "#FFFFFF" }

function fmt$(n) {
  return '$' + Math.round(n || 0).toLocaleString('en-US')
}

const WHAT_WE_DO = [
  { t: "Real Sponsorship Dollars", d: "Direct revenue back to your program — not just a discount on gear." },
  { t: "Not Just Spirit Wear", d: "Equipment and gear run through your store too, alongside apparel — every category adds to your program's cut." },
  { t: "One Rep, Every Order", d: "K-12 specialists. Tax-exempt PO friendly. A real person answers the phone." },
]

const BRANDS = ["Wilson", "DeMarini", "Louisville Slugger", "EvoShield", "Warstic", "Diamond", "All-Star", "Molten", "Gill Athletics", "Blazer", "FinishLynx", "Spalding", "Dudley"]

const EXAMPLE_STORES = [
  { name: "Norwalk HS Cross Country", url: "https://store.st1sports.com/norwalk-hs-xc" },
  { name: "Nodaway Valley Volleyball", url: "https://store.st1sports.com/nodaway-valley-volleyball" },
  { name: "ADM Cross Country", url: "https://store.st1sports.com/admxc" },
  { name: "Rampart Athletics", url: "https://store.st1sports.com/rampart-athletics" },
]

export default function SponsorshipReveal() {
  const [params] = useSearchParams()
  const schoolName = params.get('school') || ''
  const currentProvider = params.get('provider') || ''
  const schoolClass = params.get('class') || ''
  const numSports = params.get('sports') || ''
  const numAthletes = params.get('athletes') || ''
  const guaranteedMin = Number(params.get('min') || 0)
  const upsideMax = Number(params.get('max') || 0)

  return (
    <div style={{ position: "fixed", inset: 0, background: `linear-gradient(160deg, ${B.black} 0%, ${B.gray1} 100%)`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "26px 40px", flexShrink: 0 }}>
        <img src="/assets/st1-logo.png" alt="ST1 Sports" style={{ height: 100, filter: "drop-shadow(0 6px 24px rgba(243,115,33,.45))" }} />
        <button onClick={() => window.close()} style={{ background: "none", border: "1px solid rgba(255,255,255,.25)", color: "rgba(255,255,255,.6)", borderRadius: 6, padding: "6px 14px", fontFamily: "'Lexend',sans-serif", fontSize: 11, cursor: "pointer" }}>✕ Close</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 24px 32px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 12, color: B.orange, letterSpacing: 3, marginBottom: 10 }}>SPONSORSHIP OPPORTUNITY</div>
        {schoolName && <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 28, color: B.white, marginBottom: 8 }}>{schoolName}</div>}
        {(schoolClass || numAthletes || numSports || currentProvider) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginBottom: 36, fontFamily: "'Lexend',sans-serif", fontSize: 13, color: "rgba(255,255,255,.55)" }}>
            {schoolClass && <span>Class {schoolClass}</span>}
            {numAthletes && <span>· {numAthletes} athletes</span>}
            {numSports && <span>· {numSports} sports</span>}
            {currentProvider && <span>· Currently with {currentProvider}</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: "18px 44px", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 14, color: "rgba(255,255,255,.5)", letterSpacing: 2, marginBottom: 10 }}>GUARANTEED</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: "clamp(52px,10vw,124px)", color: B.white, lineHeight: 1 }}>{fmt$(guaranteedMin)}</div>
          </div>
          <div style={{ background: "rgba(243,115,33,.12)", border: `2px solid ${B.orange}`, borderRadius: 16, padding: "18px 36px", boxShadow: "0 0 50px rgba(243,115,33,.35)" }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 14, color: B.orange, letterSpacing: 2, marginBottom: 10 }}>UPSIDE POTENTIAL</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: "clamp(66px,13vw,160px)", color: B.orange, lineHeight: 1 }}>{fmt$(upsideMax)}</div>
          </div>
        </div>
        <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 14, color: "rgba(255,255,255,.45)", marginBottom: 48 }}>Estimated annual sponsorship value — real revenue back to your program.</div>

        <div style={{ width: "100%", maxWidth: 1300, marginBottom: 40 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 13, color: "rgba(255,255,255,.5)", letterSpacing: 2, marginBottom: 16 }}>20+ BRANDS YOUR ATHLETES ALREADY WEAR</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
            {BRANDS.map(b => (
              <div key={b} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 22, padding: "9px 20px", fontFamily: "'Lexend Zetta',sans-serif", fontSize: 14, color: "rgba(255,255,255,.9)" }}>{b}</div>
            ))}
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 1300, marginBottom: 40 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: "rgba(255,255,255,.45)", letterSpacing: 2, marginBottom: 14 }}>REAL TEAM STORES, LIVE RIGHT NOW</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            {EXAMPLE_STORES.map(store => (
              <div key={store.url} style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.35)", textAlign: "left" }}>
                <div style={{ background: "#e8e8e8", padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e", display: "inline-block" }} />
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
                  </div>
                  <div style={{ flex: 1, background: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 10, color: "#666", fontFamily: "monospace", marginLeft: 8, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{store.url.replace("https://", "")}</div>
                </div>
                <div
                  onClick={() => window.open(store.url, "_blank", "noopener,noreferrer")}
                  style={{ height: 220, overflow: "hidden", position: "relative", background: "#fafafa", cursor: "pointer" }}
                >
                  <iframe
                    src={store.url}
                    title={store.name}
                    loading="lazy"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    style={{ width: 1280, height: 880, border: "none", transform: "scale(0.25)", transformOrigin: "top left", pointerEvents: "none" }}
                  />
                </div>
                <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #eee" }}>
                  <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.gray1, fontWeight: 600 }}>{store.name}</div>
                  <a href={store.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 9, color: B.orange, textDecoration: "none", letterSpacing: .3 }}>VIEW LIVE ↗</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 900, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          {WHAT_WE_DO.map(card => (
            <div key={card.t} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "16px", textAlign: "left" }}>
              <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: B.orange, letterSpacing: .3, marginBottom: 6 }}>{card.t}</div>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: "rgba(255,255,255,.6)", lineHeight: 1.5 }}>{card.d}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ textAlign: "center", padding: "18px 24px 28px", fontFamily: "'Lexend',sans-serif", fontSize: 12, color: "rgba(255,255,255,.5)", flexShrink: 0 }}>
        Let's make it official — <span style={{ color: B.orange }}>matt@st1sports.com</span> · 719-256-0275 · st1sports.com
      </div>
    </div>
  )
}
