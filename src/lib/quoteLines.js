/**
 * Quote / deal line items — the same shape the CRM quote block, Analytics
 * modal, and Zoho CRM Quoted_Items / Product_Details all share.
 */

const LINE_RE = /^[•\-\*]?\s*(.+?)\s+[×x]\s+([\d.]+)\s+@\s+\$?\s*([\d,]+(?:\.\d+)?)/;

export function emptyQuoteLine(id) {
  return {
    id: id || `li_${Math.random().toString(36).slice(2, 9)}`,
    name: '',
    qty: 1,
    rate: 0,
    cost: 0,
    description: '',
  };
}

export function normalizeQuoteLine(raw, id) {
  if (!raw || typeof raw !== 'object') return null;
  const product = raw.product && typeof raw.product === 'object' ? raw.product : null;
  const name = String(
    raw.name
    || raw.Product_Name
    || product?.name
    || raw.item_name
    || raw.product_name
    || ''
  ).trim();
  const qty = Number(raw.qty ?? raw.quantity ?? raw.Quantity ?? 1);
  const rate = Number(
    raw.rate
    ?? raw.List_Price
    ?? raw.list_price
    ?? raw.Unit_Price
    ?? raw.unit_price
    ?? raw.quotedPrice
    ?? 0
  );
  const cost = Number(raw.cost ?? 0) || 0;
  const description = String(raw.description || raw.Description || raw.notes || '').trim();
  const lineId = raw.id || raw.line_item_id || id || null;
  if (!name && !rate) return null;
  return {
    id: lineId,
    name: name || 'Item',
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    rate: Number.isFinite(rate) ? rate : 0,
    cost,
    description,
  };
}

export function normalizeQuoteLines(list) {
  return (Array.isArray(list) ? list : [])
    .map((raw, i) => normalizeQuoteLine(raw, `li_${i}`))
    .filter(Boolean);
}

export function quoteLinesTotal(items) {
  return normalizeQuoteLines(items).reduce((sum, i) => sum + i.qty * i.rate, 0);
}

export function filledQuoteLines(items) {
  return normalizeQuoteLines(items).filter(i => (i.name || '').trim());
}

export function parseQuoteLinesFromDescription(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^subtotal\b/i.test(trimmed)) continue;
    const m = trimmed.match(LINE_RE);
    if (!m) continue;
    const name = m[1].trim();
    if (!name || /^subtotal\b/i.test(name)) continue;
    out.push({
      id: `li_${out.length}`,
      name,
      qty: Number(m[2]) || 1,
      rate: Number(String(m[3]).replace(/,/g, '')) || 0,
      cost: 0,
      description: '',
    });
  }
  return out;
}

export function quoteLinesFromZohoRecord(record) {
  const structured = normalizeQuoteLines(record?.Product_Details || record?.Quoted_Items || []);
  if (structured.length) return structured;
  return parseQuoteLinesFromDescription(record?.Description || '');
}

/** Strip the bullet/subtotal block we write so freeform notes stay editable. */
export function quoteNotesFromDescription(text) {
  const kept = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (/^subtotal\b/i.test(trimmed)) continue;
    if (LINE_RE.test(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function quoteLinesForDeal(deal) {
  const local = filledQuoteLines(deal?.quoteItems);
  if (local.length) return local;
  return parseQuoteLinesFromDescription(deal?.notes || deal?.quoteNotes || '');
}

export function quoteLinesSummary(items, limit = 2) {
  const lines = filledQuoteLines(items);
  if (!lines.length) return '';
  const shown = lines.slice(0, limit).map(i => `${i.name} × ${i.qty}`);
  const extra = lines.length > limit ? ` +${lines.length - limit}` : '';
  return shown.join(' · ') + extra;
}

export function quoteFieldsFromZohoRecord(record) {
  const items = quoteLinesFromZohoRecord(record);
  return {
    quoteItems: items,
    quoteAmount: items.length ? quoteLinesTotal(items) : Number(record?.Amount) || 0,
    quoteNotes: quoteNotesFromDescription(record?.Description || ''),
  };
}

export function quoteLinesDescription(items, notes) {
  const lines = filledQuoteLines(items);
  const block = lines
    .map(i => `• ${i.name || 'Item'} × ${i.qty} @ $${Number(i.rate || 0).toFixed(2)} = $${(i.qty * i.rate).toFixed(2)}`)
    .join('\n');
  const total = quoteLinesTotal(lines);
  return [notes, block, lines.length ? `Subtotal: $${total.toFixed(2)}` : '']
    .filter(Boolean)
    .join('\n\n');
}

export function quoteLinesToZohoQuotedItems(items) {
  return filledQuoteLines(items).map(li => ({
    Product_Name: li.name || 'Item',
    Quantity: li.qty,
    List_Price: li.rate,
  }));
}

export function quoteLinesToZohoProductDetails(items) {
  return filledQuoteLines(items).map(li => ({
    product: { name: li.name || 'Item' },
    quantity: li.qty,
    list_price: li.rate,
    Quantity: li.qty,
    List_Price: li.rate,
    Product_Name: li.name || 'Item',
  }));
}
