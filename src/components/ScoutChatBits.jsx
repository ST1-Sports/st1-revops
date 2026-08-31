import React from 'react';
import { chatFollowUp, money, splitChatBlocks, splitInlineMarks } from '../lib/chatDisplay.js';

function Inline({ text }) {
  return splitInlineMarks(text).map((part, i) => (
    part.bold
      ? <strong key={i} style={{ fontWeight: 600 }}>{part.t}</strong>
      : <span key={i}>{part.t}</span>
  ));
}

export function ChatProse({ text, color }) {
  const blocks = splitChatBlocks(text);
  if (!blocks.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {block.items.map((item, j) => (
                <li key={j} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 13, lineHeight: 1.55, color }}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 13, lineHeight: 1.55, color }}>
            <Inline text={block.text} />
          </div>
        );
      })}
    </div>
  );
}

function Stat({ B, label, value, hint, tone }) {
  const valueColor = tone === 'good' ? B.green : tone === 'warn' ? B.yellow : B.black;
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 7, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 7, letterSpacing: 1.1, color: B.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: valueColor, marginTop: 4, letterSpacing: 0.2 }}>{value}</div>
      {hint ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

export function EdgarQuoteCard({ action, B, onCreate, creating }) {
  const q = action.quote || {};
  const items = q.lineItems || [];
  const warns = action.warnings || q.warnings || [];
  const revenue = q.totalRevenue || items.reduce((s, i) => s + (Number(i.quotedPrice) || 0) * (Number(i.qty) || 1), 0);
  const costTotal = q.totalCost || items.reduce((s, i) => s + (Number(i.cost) || 0) * (Number(i.qty) || 1), 0);
  const gm = q.overallGmPct != null ? q.overallGmPct : null;
  const single = items.length === 1 ? items[0] : null;
  const qty = single ? Number(single.qty) || 1 : null;
  const title = single?.name || q.customer || action.customer || 'Dealer list quote';
  const sku = single?.sku || null;
  const list = single ? Number(single.quotedPrice ?? single.ourPrice) : null;
  const cost = single ? Number(single.cost) : null;
  const itemGm = single?.gmPct != null ? single.gmPct : gm;
  const map = single?.map != null ? Number(single.map) : null;

  return (
    <div style={{ background: B.white, border: `1px solid ${B.teal}45`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 0 rgba(12,123,106,0.06)' }}>
      <div style={{ padding: '12px 14px 10px', background: B.tealBg, borderBottom: `1px solid ${B.teal}22`, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.4, color: B.teal, fontWeight: 700 }}>EDGAR · DEALER LIST</div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 16, color: B.black, marginTop: 5, lineHeight: 1.25 }}>{title}</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, marginTop: 4 }}>
            {sku ? <span>SKU {sku}</span> : null}
            {sku && qty > 1 ? <span> · </span> : null}
            {qty > 1 ? <span>Qty {qty}</span> : null}
            {!sku && items.length > 1 ? <span>{items.length} line items</span> : null}
          </div>
        </div>
        {onCreate ? (
          <button
            onClick={onCreate}
            disabled={creating}
            style={{ background: B.teal, border: 'none', color: B.white, borderRadius: 5, padding: '7px 10px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4, opacity: creating ? 0.6 : 1, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {creating ? 'CREATING...' : 'CREATE IN ZOHO'}
          </button>
        ) : null}
      </div>

      {single ? (
        <div style={{ display: 'grid', gridTemplateColumns: qty > 1 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8, padding: 12 }}>
          <Stat B={B} label="YOUR COST" value={money(cost) || '—'} hint={qty > 1 && cost != null ? `${money(cost * qty)} for ${qty}` : null} />
          <Stat B={B} label="LIST / QUOTE" value={money(list) || '—'} hint={qty > 1 && list != null ? `${money(list * qty)} for ${qty}` : null} />
          <Stat
            B={B}
            label="GROSS MARGIN"
            value={itemGm != null ? `${itemGm}%` : '—'}
            hint={itemGm != null && itemGm >= 20 ? 'Above GM floor' : itemGm != null ? 'Check GM floor' : null}
            tone={itemGm == null ? null : itemGm >= 20 ? 'good' : 'warn'}
          />
        </div>
      ) : (
        <div style={{ padding: '8px 12px 12px' }}>
          {items.map((li, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: `1px solid ${B.border}`, opacity: li.notFound ? 0.5 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text, fontWeight: 500 }}>{li.name}</div>
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, marginTop: 2 }}>
                  {li.sku ? `SKU ${li.sku} · ` : ''}Qty {li.qty || 1}
                  {li.notFound ? ' · Not on list' : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 13, color: B.teal }}>{li.notFound ? '—' : money(li.quotedPrice)}</div>
                <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted }}>{li.cost != null ? `cost ${money(li.cost)}` : ''}{li.gmPct != null ? ` · ${li.gmPct}% GM` : ''}</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10 }}>
            <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1, color: B.muted, fontWeight: 700 }}>QUOTE TOTAL</div>
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 18, color: B.teal }}>{money(revenue)}</div>
          </div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, textAlign: 'right', marginTop: 2 }}>
            {costTotal ? `Cost ${money(costTotal)}` : ''}{gm != null ? ` · ${gm}% GM` : ''}
          </div>
        </div>
      )}

      {(map > 0 || warns.length > 0 || single?.mapFlag) && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {map > 0 ? (
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.yellow, background: B.yellowBg, borderRadius: 99, padding: '3px 8px' }}>
              MAP {money(map)}{single?.mapFlag ? ' · at floor' : ''}
            </span>
          ) : (
            <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, background: B.surface, borderRadius: 99, padding: '3px 8px' }}>No MAP on file</span>
          )}
          {warns.map((w, i) => (
            <span key={i} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.yellow, background: B.yellowBg, borderRadius: 99, padding: '3px 8px' }}>⚠ {w}</span>
          ))}
        </div>
      )}
      {!map && !warns.length && single && !single.mapFlag ? (
        <div style={{ padding: '0 12px 12px' }}>
          <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, background: B.surface, borderRadius: 99, padding: '3px 8px' }}>No MAP restriction</span>
        </div>
      ) : null}
    </div>
  );
}

export function assistantBubbleText(content, actions) {
  const hasQuoteCard = (actions || []).some(a => a.type === 'edgar_quote' && a.quote);
  return chatFollowUp(content, { hasQuoteCard });
}
