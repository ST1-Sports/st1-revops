import React, { useId, useMemo, useState } from 'react';
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
                <li key={j} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 13, lineHeight: 1.55, color, overflowWrap: 'anywhere' }}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} style={{ fontFamily: "'Lexend',sans-serif", fontSize: 13, lineHeight: 1.55, color, overflowWrap: 'anywhere' }}>
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
      <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.1, color: B.textMid, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, color: valueColor, marginTop: 4, letterSpacing: 0.2 }}>{value}</div>
      {hint ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

function Field({ B, label, value, onChange, placeholder, required, type = 'text', list, autoComplete }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1, color: B.muted, fontWeight: 700 }}>
        {label}{required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        list={list}
        autoComplete={autoComplete || 'off'}
        style={{
          fontFamily: "'Lexend',sans-serif",
          fontSize: 12,
          border: `1px solid ${B.border}`,
          borderRadius: 5,
          padding: '7px 9px',
          color: B.text,
          background: B.white,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

export function ZohoQuoteForm({ B, defaults = {}, contacts = [], showQty = true, submitting, onSubmit, onCancel }) {
  const [school, setSchool] = useState(defaults.school || '');
  const [contact, setContact] = useState(defaults.contact || '');
  const [email, setEmail] = useState(defaults.email || '');
  const [city, setCity] = useState(defaults.city || '');
  const [state, setState] = useState(defaults.state || '');
  const [qty, setQty] = useState(String(defaults.qty || 1));
  const [notes, setNotes] = useState(defaults.notes || '');
  const [err, setErr] = useState('');
  const formId = useId();
  const schoolListId = `${formId}-schools`;
  const peopleListId = `${formId}-people`;

  const schools = useMemo(() => {
    const seen = new Set();
    return (contacts || []).reduce((acc, c) => {
      const name = (c.school || '').trim();
      if (!name) return acc;
      const key = name.toLowerCase();
      if (seen.has(key)) return acc;
      seen.add(key);
      acc.push(name);
      return acc;
    }, []).slice(0, 80);
  }, [contacts]);

  const people = useMemo(() => (contacts || []).filter(c => c.fullName || c.email).slice(0, 80), [contacts]);

  const fillFromContact = (name) => {
    setContact(name);
    const hit = people.find(c => (c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim()) === name);
    if (!hit) return;
    if (hit.email && !email) setEmail(hit.email);
    if (hit.school && !school) setSchool(hit.school);
    if (hit.city && !city) setCity(hit.city);
    if (hit.state && !state) setState(hit.state);
  };

  const fillFromSchool = (name) => {
    setSchool(name);
    const hit = people.find(c => (c.school || '').toLowerCase() === name.toLowerCase());
    if (!hit) return;
    if (hit.fullName && !contact) setContact(hit.fullName);
    if (hit.email && !email) setEmail(hit.email);
    if (hit.city && !city) setCity(hit.city);
    if (hit.state && !state) setState(hit.state);
  };

  const submit = (e) => {
    e?.preventDefault?.();
    const schoolName = school.trim();
    if (!schoolName) {
      setErr('School or account name is required.');
      return;
    }
    const qtyNum = Number(qty);
    onSubmit({
      school: schoolName,
      contact: contact.trim(),
      email: email.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      qty: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
      notes: notes.trim(),
    });
  };

  return (
    <form onSubmit={submit} style={{ padding: '12px', borderTop: `1px solid ${B.border}`, background: B.surface, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 12, color: B.text }}>
        Who is this quote for? Zoho needs a real school or account — not a product name.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field B={B} label="SCHOOL / ACCOUNT" value={school} onChange={fillFromSchool} placeholder="Lincoln High School" required list={schoolListId} />
        </div>
        <Field B={B} label="CONTACT" value={contact} onChange={fillFromContact} placeholder="Coach Smith" list={peopleListId} />
        <Field B={B} label="EMAIL" value={email} onChange={setEmail} placeholder="coach@school.edu" type="email" />
        <Field B={B} label="CITY" value={city} onChange={setCity} placeholder="Des Moines" />
        <Field B={B} label="STATE" value={state} onChange={v => setState(v.toUpperCase())} placeholder="IA" />
        {showQty ? <Field B={B} label="QTY" value={qty} onChange={setQty} type="number" /> : null}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field B={B} label="NOTES" value={notes} onChange={setNotes} placeholder="Optional — bid, season, delivery" />
        </div>
      </div>
      {err ? <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.red }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel ? (
          <button type="button" onClick={onCancel} style={{ background: 'none', border: `1px solid ${B.border}`, color: B.muted, borderRadius: 5, padding: '7px 10px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4 }}>
            CANCEL
          </button>
        ) : null}
        <button type="submit" disabled={submitting} style={{ background: B.teal, border: 'none', color: B.white, borderRadius: 5, padding: '7px 12px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'CREATING...' : 'CREATE QUOTE IN ZOHO'}
        </button>
      </div>
      <datalist id={schoolListId}>
        {schools.map(name => <option key={name} value={name} />)}
      </datalist>
      <datalist id={peopleListId}>
        {people.map(c => {
          const name = c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
          return name ? <option key={c.id || name} value={name} /> : null;
        })}
      </datalist>
    </form>
  );
}

function QuoteCreateButton({ B, label, creating, open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={creating}
      style={{ background: open ? B.white : B.teal, border: open ? `1px solid ${B.teal}` : 'none', color: open ? B.teal : B.white, borderRadius: 5, padding: '7px 10px', fontSize: 8, fontFamily: "'Lexend Zetta',sans-serif", fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4, opacity: creating ? 0.6 : 1, flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {creating ? 'CREATING...' : open ? 'CANCEL' : label}
    </button>
  );
}

export function EdgarQuoteCard({ action, B, onCreate, creating, contacts }) {
  const [formOpen, setFormOpen] = useState(false);
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
  const schoolGuess = (q.customer && q.customer !== 'Customer' && !/^quote\s*[—-]/i.test(q.customer)) ? q.customer : '';

  return (
    <div style={{ background: B.white, border: `1px solid ${B.teal}45`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 0 rgba(12,123,106,0.06)' }}>
      <div style={{ padding: '12px 14px 10px', background: B.tealBg, borderBottom: `1px solid ${B.teal}22`, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.4, color: B.teal, fontWeight: 700 }}>EDGAR · QUOTE</div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 16, color: B.black, marginTop: 5, lineHeight: 1.25 }}>{title}</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, marginTop: 4 }}>
            {sku ? <span>SKU {sku}</span> : null}
            {sku && qty > 1 ? <span> · </span> : null}
            {qty > 1 ? <span>Qty {qty}</span> : null}
            {!sku && items.length > 1 ? <span>{items.length} line items</span> : null}
          </div>
        </div>
        {onCreate ? (
          <QuoteCreateButton B={B} label="CREATE IN ZOHO" creating={creating} open={formOpen} onToggle={() => setFormOpen(o => !o)} />
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

      {formOpen && onCreate ? (
        <ZohoQuoteForm
          B={B}
          contacts={contacts}
          showQty={!!single}
          submitting={creating}
          defaults={{ school: schoolGuess, qty: qty || 1 }}
          onCancel={() => setFormOpen(false)}
          onSubmit={fields => onCreate(fields)}
        />
      ) : null}
    </div>
  );
}

export function ScoutPriceCard({ action, B, onQuote, creating, contacts }) {
  const [formOpen, setFormOpen] = useState(false);
  const item = action.item || {};
  const matches = (action.matches || []).filter(m => m.sku && m.sku !== item.sku).slice(0, 3);
  const cost = item.cost != null ? Number(item.cost) : null;
  const list = item.list != null ? Number(item.list) : null;
  const gm = item.marginPct != null ? item.marginPct : (cost != null && list > 0 ? Math.round(((list - cost) / list) * 100) : null);
  const map = item.map != null ? Number(item.map) : null;

  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px 10px', background: B.surface, borderBottom: `1px solid ${B.border}`, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Lexend Zetta',sans-serif", fontSize: 8, letterSpacing: 1.4, color: B.muted, fontWeight: 700 }}>SCOUT · PRICE LOOKUP</div>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 16, color: B.black, marginTop: 5, lineHeight: 1.25 }}>{item.name || 'Dealer list item'}</div>
          <div style={{ fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted, marginTop: 4 }}>
            {item.sku ? <span>SKU {item.sku}</span> : null}
            {item.sku && item.supplier ? <span> · </span> : null}
            {item.supplier ? <span>{item.supplier}</span> : null}
            {!item.sku && !item.supplier && item.source ? <span>{item.source}</span> : null}
          </div>
        </div>
        {onQuote ? (
          <QuoteCreateButton B={B} label="QUOTE THIS" creating={creating} open={formOpen} onToggle={() => setFormOpen(o => !o)} />
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: 12 }}>
        <Stat B={B} label="YOUR COST" value={money(cost) || '—'} />
        <Stat B={B} label="LIST PRICE" value={money(list) || '—'} />
        <Stat
          B={B}
          label="GROSS MARGIN"
          value={gm != null ? `${gm}%` : '—'}
          hint={gm != null && gm >= 20 ? 'Above GM floor' : gm != null ? 'Check GM floor' : null}
          tone={gm == null ? null : gm >= 20 ? 'good' : 'warn'}
        />
      </div>

      <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {map > 0 ? (
          <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.yellow, background: B.yellowBg, borderRadius: 99, padding: '3px 8px' }}>MAP {money(map)}</span>
        ) : (
          <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, background: B.surface, borderRadius: 99, padding: '3px 8px' }}>No MAP on file</span>
        )}
        <span style={{ fontFamily: "'Lexend',sans-serif", fontSize: 10, color: B.muted, background: B.surface, borderRadius: 99, padding: '3px 8px' }}>
          Info only — quote when you have a school
        </span>
      </div>

      {matches.length > 0 ? (
        <div style={{ padding: '0 12px 12px', fontFamily: "'Lexend',sans-serif", fontSize: 11, color: B.muted }}>
          Close matches: {matches.map(m => m.sku || m.name).join(' · ')}
        </div>
      ) : null}

      {formOpen && onQuote ? (
        <ZohoQuoteForm
          B={B}
          contacts={contacts}
          showQty
          submitting={creating}
          defaults={{ qty: 1 }}
          onCancel={() => setFormOpen(false)}
          onSubmit={fields => onQuote(fields)}
        />
      ) : null}
    </div>
  );
}

export function assistantBubbleText(content, actions) {
  const hasQuoteCard = (actions || []).some(a => a.type === 'edgar_quote' && a.quote);
  const hasPriceCard = (actions || []).some(a => a.type === 'st1_price' && a.item);
  return chatFollowUp(content, { hasQuoteCard, hasPriceCard });
}
