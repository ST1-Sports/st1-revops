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
  { t: "One Rep, Every Order", d: "K-12 specialists. Tax-exempt PO friendly. A real person answers the phone." },
]

const BRANDS = ["Wilson", "DeMarini", "Louisville Slugger", "EvoShield", "Warstic", "Diamond", "All-Star", "Molten", "Gill Athletics", "Blazer", "FinishLynx", "Spalding", "Dudley", "BWTF"]

const EXAMPLE_STORES = [
  { name: "Norwalk HS Cross Country", url: "https://store.st1sports.com/norwalk-hs-xc" },
  { name: "Nodaway Valley Volleyball", url: "https://store.st1sports.com/nodaway-valley-volleyball" },
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 32px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: B.orange, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontFamily: "'Russo One',sans-serif", fontSize: 13, color: B.white, letterSpacing: -1 }}>ST1</span>
          </div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: B.white, letterSpacing: .5 }}>ST1 SPORTS</div>
        </div>
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
        <div style={{ display: "flex", gap: "10px 44px", flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 13, color: "rgba(255,255,255,.5)", letterSpacing: 2, marginBottom: 8 }}>GUARANTEED</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: "clamp(46px,9vw,110px)", color: B.white, lineHeight: 1 }}>{fmt$(guaranteedMin)}</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 13, color: B.orange, letterSpacing: 2, marginBottom: 8 }}>UPSIDE</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: "clamp(46px,9vw,110px)", color: B.orange, lineHeight: 1 }}>{fmt$(upsideMax)}</div>
          </div>
        </div>
        <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 13, color: "rgba(255,255,255,.45)", marginBottom: 44 }}>Estimated annual sponsorship value — real revenue back to your program.</div>

        <div style={{ width: "100%", maxWidth: 700, marginBottom: 40 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: "rgba(255,255,255,.45)", letterSpacing: 2, marginBottom: 14 }}>REAL TEAM STORES, LIVE RIGHT NOW</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
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

        <div style={{ width: "100%", maxWidth: 820, marginBottom: 40 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: "rgba(255,255,255,.45)", letterSpacing: 2, marginBottom: 14 }}>20+ BRANDS YOUR ATHLETES ALREADY WEAR</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {BRANDS.map(b => (
              <div key={b} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 20, padding: "7px 16px", fontFamily: "'Lexend',sans-serif", fontSize: 12, color: "rgba(255,255,255,.8)" }}>{b}</div>
            ))}
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 600, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
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
