/**
 * Normalize a quote PDF extraction so the account upload form always
 * gets a stable shape (quote number, total, line items).
 */

export function parseJsonObject(text) {
  const raw = String(text || '');
  const m = raw.match(/\{[\s\S]*\}/s);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeExtractedQuote(raw = {}) {
  const items = Array.isArray(raw.lineItems || raw.items || raw.products)
    ? (raw.lineItems || raw.items || raw.products)
    : [];
  const lineItems = items.map(it => {
    const qty = num(it.qty ?? it.quantity) || 1;
    const rate = num(it.rate ?? it.unitPrice ?? it.price);
    return {
      name: String(it.name || it.description || it.item || '').trim() || 'Item',
      qty,
      rate,
    };
  }).filter(it => it.name);
  const itemTotal = lineItems.reduce((s, i) => s + i.qty * i.rate, 0);
  const total = num(raw.total ?? raw.grandTotal ?? raw.amount) || itemTotal;
  return {
    quoteNumber: String(raw.quoteNumber || raw.number || raw.quoteNo || '').trim(),
    customerName: String(raw.customerName || raw.accountName || raw.school || '').trim(),
    contactName: String(raw.contactName || raw.contact || '').trim(),
    total,
    notes: String(raw.notes || raw.terms || '').trim(),
    lineItems,
  };
}
