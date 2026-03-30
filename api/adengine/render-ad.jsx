import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SIZES = {
  square:    { width: 1080, height: 1080 },
  landscape: { width: 1200, height: 628 },
  story:     { width: 1080, height: 1920 },
};

// ── TEMPLATE: BOLD ────────────────────────────────────────────────────────────
// Dark background, large headline left, product image right, orange CTA
function BoldAd({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo }) {
  const pad = Math.round(h * 0.055);
  return (
    <div style={{ display:'flex', flexDirection:'column', background:bg, width:'100%', height:'100%', padding:pad, fontFamily:'sans-serif' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:Math.round(h*0.042) }}>
        {logo && (
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:6, height:34, background:ac, borderRadius:2 }}/>
            <div style={{ fontSize:19, fontWeight:900, color:ac, letterSpacing:3 }}>ST1 SPORTS</div>
          </div>
        )}
        {badge && (
          <div style={{ background:ac, color:'#fff', padding:'7px 18px', borderRadius:4, fontSize:16, fontWeight:800, letterSpacing:1 }}>
            {badge.toUpperCase()}
          </div>
        )}
      </div>

      <div style={{ display:'flex', flex:1, alignItems:'center', gap:Math.round(w*0.05) }}>
        <div style={{ display:'flex', flexDirection:'column', flex: img ? 1.1 : 1, gap:20 }}>
          <div style={{ fontSize:Math.round(h*0.076), fontWeight:900, color:tc, lineHeight:1.05, letterSpacing:-1 }}>
            {headline}
          </div>
          {sub && (
            <div style={{ fontSize:Math.round(h*0.028), color:tc+'BB', lineHeight:1.5 }}>{sub}</div>
          )}
          {cta && (
            <div style={{ display:'flex', alignSelf:'flex-start', background:ac, color:'#fff', padding:`${Math.round(h*0.021)}px ${Math.round(h*0.042)}px`, borderRadius:7, fontSize:Math.round(h*0.028), fontWeight:800, letterSpacing:0.5, marginTop:10 }}>
              {cta}
            </div>
          )}
        </div>
        {img && (
          <div style={{ display:'flex', flex:0.9, justifyContent:'center', alignItems:'center' }}>
            <img src={img} width={Math.round(w*0.38)} height={Math.round(h*0.57)} style={{ objectFit:'contain', borderRadius:16 }}/>
          </div>
        )}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:18 }}>
        <div style={{ fontSize:13, color:tc+'44', letterSpacing:3 }}>ST1SPORTS.COM</div>
      </div>
    </div>
  );
}

// ── TEMPLATE: CLEAN ───────────────────────────────────────────────────────────
// Light/white centered layout — product image top, copy below, minimal
function CleanAd({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo }) {
  const pad = Math.round(h * 0.06);
  return (
    <div style={{ display:'flex', flexDirection:'column', background:bg, width:'100%', height:'100%', padding:pad, fontFamily:'sans-serif', alignItems:'center', justifyContent:'center' }}>
      {logo && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:Math.round(h*0.035) }}>
          <div style={{ width:5, height:24, background:ac, borderRadius:2 }}/>
          <div style={{ fontSize:16, fontWeight:900, color:ac, letterSpacing:3 }}>ST1 SPORTS</div>
        </div>
      )}
      {img && (
        <img src={img} width={Math.round(w*0.52)} height={Math.round(h*0.44)} style={{ objectFit:'contain', borderRadius:14, marginBottom:Math.round(h*0.038) }}/>
      )}
      {badge && (
        <div style={{ display:'flex', background:ac, color:'#fff', padding:'6px 16px', borderRadius:4, fontSize:14, fontWeight:800, letterSpacing:1, marginBottom:16 }}>
          {badge.toUpperCase()}
        </div>
      )}
      <div style={{ fontSize:Math.round(h*0.066), fontWeight:900, color:tc, lineHeight:1.08, letterSpacing:-0.5, textAlign:'center', marginBottom:16 }}>
        {headline}
      </div>
      {sub && (
        <div style={{ fontSize:Math.round(h*0.025), color:tc+'99', lineHeight:1.55, textAlign:'center', maxWidth:Math.round(w*0.76), marginBottom:22 }}>
          {sub}
        </div>
      )}
      {cta && (
        <div style={{ display:'flex', background:ac, color:'#fff', padding:`${Math.round(h*0.021)}px ${Math.round(h*0.052)}px`, borderRadius:7, fontSize:Math.round(h*0.026), fontWeight:800, letterSpacing:0.5 }}>
          {cta}
        </div>
      )}
      <div style={{ fontSize:12, color:tc+'44', letterSpacing:3, marginTop:Math.round(h*0.045) }}>ST1SPORTS.COM</div>
    </div>
  );
}

// ── TEMPLATE: SPLIT ───────────────────────────────────────────────────────────
// Two equal columns — copy on left, product on right (accent border divider)
function SplitAd({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo }) {
  const pad = Math.round(h * 0.06);
  return (
    <div style={{ display:'flex', background:bg, width:'100%', height:'100%', fontFamily:'sans-serif' }}>
      <div style={{ display:'flex', flexDirection:'column', flex:1, padding:pad, justifyContent:'center', gap:18 }}>
        {logo && (
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            <div style={{ width:5, height:22, background:ac, borderRadius:2 }}/>
            <div style={{ fontSize:15, fontWeight:900, color:ac, letterSpacing:3 }}>ST1 SPORTS</div>
          </div>
        )}
        {badge && (
          <div style={{ display:'flex', alignSelf:'flex-start', background:ac, color:'#fff', padding:'6px 14px', borderRadius:4, fontSize:13, fontWeight:800, letterSpacing:1 }}>
            {badge.toUpperCase()}
          </div>
        )}
        <div style={{ fontSize:Math.round(h*0.074), fontWeight:900, color:tc, lineHeight:1.06, letterSpacing:-1 }}>
          {headline}
        </div>
        {sub && (
          <div style={{ fontSize:Math.round(h*0.026), color:tc+'AA', lineHeight:1.5 }}>{sub}</div>
        )}
        {cta && (
          <div style={{ display:'flex', alignSelf:'flex-start', background:ac, color:'#fff', padding:`${Math.round(h*0.021)}px ${Math.round(h*0.04)}px`, borderRadius:7, fontSize:Math.round(h*0.026), fontWeight:800, letterSpacing:0.5, marginTop:8 }}>
            {cta}
          </div>
        )}
        <div style={{ fontSize:12, color:tc+'44', letterSpacing:3, marginTop:'auto' }}>ST1SPORTS.COM</div>
      </div>

      <div style={{ display:'flex', flex:1, justifyContent:'center', alignItems:'center', background:`${ac}0F`, borderLeft:`4px solid ${ac}` }}>
        {img
          ? <img src={img} width={Math.round(w*0.41)} height={Math.round(h*0.66)} style={{ objectFit:'contain', borderRadius:10 }}/>
          : <div style={{ fontSize:18, color:tc+'33', fontWeight:700, letterSpacing:2 }}>PRODUCT IMAGE</div>
        }
      </div>
    </div>
  );
}

// ── TEMPLATE: OVERLAY ─────────────────────────────────────────────────────────
// Full-bleed product image as background, gradient + copy at bottom
function OverlayAd({ headline, sub, cta, badge, img, bg, tc, ac, w, h, logo }) {
  const px = Math.round(w * 0.05);
  const py = Math.round(h * 0.045);
  return (
    <div style={{ display:'flex', position:'relative', background:bg, width:'100%', height:'100%', fontFamily:'sans-serif' }}>
      {img && (
        <img src={img} width={w} height={h} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover' }}/>
      )}
      {/* Gradient overlay — bottom 58% */}
      <div style={{ display:'flex', position:'absolute', bottom:0, left:0, right:0, height:'58%', background:'linear-gradient(to top, rgba(0,0,0,0.93) 0%, rgba(0,0,0,0) 100%)' }}/>

      {logo && (
        <div style={{ display:'flex', position:'absolute', top:py, left:px, alignItems:'center', gap:8 }}>
          <div style={{ width:5, height:22, background:ac, borderRadius:2 }}/>
          <div style={{ fontSize:15, fontWeight:900, color:'#FFFFFF', letterSpacing:3 }}>ST1 SPORTS</div>
        </div>
      )}
      {badge && (
        <div style={{ display:'flex', position:'absolute', top:py, right:px, background:ac, color:'#fff', padding:'7px 17px', borderRadius:4, fontSize:14, fontWeight:800, letterSpacing:1 }}>
          {badge.toUpperCase()}
        </div>
      )}

      <div style={{ display:'flex', position:'absolute', bottom:0, left:0, right:0, padding:`${Math.round(h*0.05)}px ${px}px`, flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:Math.round(h*0.072), fontWeight:900, color:'#FFFFFF', lineHeight:1.05, letterSpacing:-1 }}>
          {headline}
        </div>
        {sub && (
          <div style={{ fontSize:Math.round(h*0.024), color:'#FFFFFFCC', lineHeight:1.45 }}>{sub}</div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
          {cta
            ? <div style={{ display:'flex', background:ac, color:'#fff', padding:`${Math.round(h*0.019)}px ${Math.round(h*0.037)}px`, borderRadius:7, fontSize:Math.round(h*0.025), fontWeight:800, letterSpacing:0.5 }}>{cta}</div>
            : <div/>
          }
          <div style={{ fontSize:12, color:'#FFFFFF66', letterSpacing:3 }}>ST1SPORTS.COM</div>
        </div>
      </div>
    </div>
  );
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  const { searchParams: q } = new URL(req.url);

  const headline = q.get('headline') || 'YOUR HEADLINE';
  const sub      = q.get('sub')      || '';
  const cta      = q.get('cta')      || '';
  const badge    = q.get('badge')    || '';
  const img      = q.get('img')      || '';
  const bg       = decodeURIComponent(q.get('bg') || '%230A0A0A');
  const tc       = decodeURIComponent(q.get('tc') || '%23FFFFFF');
  const ac       = decodeURIComponent(q.get('ac') || '%23F37321');
  const tpl      = q.get('tpl')      || 'bold';
  const sz       = q.get('sz')       || 'square';
  const logo     = q.get('logo')     !== 'false';

  const { width: w, height: h } = SIZES[sz] || SIZES.square;
  const props = { headline, sub, cta, badge, img, bg, tc, ac, w, h, logo };

  let element;
  if      (tpl === 'clean')   element = <CleanAd   {...props}/>;
  else if (tpl === 'split')   element = <SplitAd   {...props}/>;
  else if (tpl === 'overlay') element = <OverlayAd {...props}/>;
  else                         element = <BoldAd    {...props}/>;

  return new ImageResponse(element, { width: w, height: h });
}
