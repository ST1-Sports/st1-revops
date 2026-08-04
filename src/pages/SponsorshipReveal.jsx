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

const STORE_ITEMS = [
  { icon: "🎽", name: "Team Jersey", price: "$48" },
  { icon: "🧢", name: "Booster Cap", price: "$22" },
  { icon: "👕", name: "Fan Hoodie", price: "$55" },
]

function slugify(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

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

        <div style={{ width: "100%", maxWidth: 640, marginBottom: 40 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: "rgba(255,255,255,.45)", letterSpacing: 2, marginBottom: 14 }}>YOUR OWN TEAM STORE — LIVE IN DAYS</div>
          <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.35)", textAlign: "left" }}>
            <div style={{ background: "#e8e8e8", padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e", display: "inline-block" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
              </div>
              <div style={{ flex: 1, background: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 10, color: "#666", fontFamily: "monospace", marginLeft: 8 }}>shop.st1sports.com/{slugify(schoolName) || "your-school"}</div>
            </div>
            <div style={{ padding: "18px 20px", background: "#fafafa" }}>
              <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 15, color: B.gray1, marginBottom: 2 }}>{schoolName ? `${schoolName} FAN STORE` : "YOUR SCHOOL FAN STORE"}</div>
              <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: "#888", marginBottom: 14 }}>Every purchase gives back to the program</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {STORE_ITEMS.map(item => (
                  <div key={item.name} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, marginBottom: 6 }}>{item.icon}</div>
                    <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.gray1, fontWeight: 600, marginBottom: 2 }}>{item.name}</div>
                    <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 11, color: B.orange }}>{item.price}</div>
                  </div>
                ))}
              </div>
            </div>
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
