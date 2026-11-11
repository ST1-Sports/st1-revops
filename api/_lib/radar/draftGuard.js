/**
 * Draft safety: never invent prices, dates, stock ETAs, or quantities.
 * Facts not present in the thread must be [BRACKETED PLACEHOLDERS].
 */

const PLACEHOLDER_RE = /\[([A-Z][A-Z0-9 _/-]{1,40})\]/g;
const QTY_RE = /\b(\d{1,5})\s*(pcs?|pieces?|units?|sets?|dozens?|pairs?|cases?|each|ea)\b/gi;
const DATE_RE = /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi;
const ETA_RE = /\b(?:eta|in stock|ships?|lead time)\b[^.\n]{0,40}?\b(\d{1,3})\s*(?:day|week|business)\b/gi;

function stripPlaceholders(text) {
  return String(text || '').replace(PLACEHOLDER_RE, ' ');
}

function normalizeHaystack(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[$,]/g, '')
    .replace(/\s+/g, ' ');
}

function moneyValues(text) {
  const out = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push(m[1].replace(/,/g, ''));
  }
  return out;
}

function dateTokens(text) {
  const out = [];
  const src = String(text || '');
  let m;
  const re = new RegExp(DATE_RE.source, 'gi');
  while ((m = re.exec(src))) out.push(m[0].toLowerCase().replace(/\s+/g, ' ').trim());
  return out;
}

export function extractPlaceholders(draft) {
  const found = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let m;
  while ((m = re.exec(String(draft || '')))) found.push(m[0]);
  return found;
}

export function draftNeedsInput(draft) {
  return extractPlaceholders(draft).length > 0;
}

/**
 * Returns { ok, needsInput, fabricated: string[], placeholders: string[] }
 * `threadText` should be the concatenated bodies + subject of the full thread.
 */
export function assertNoFabricatedFacts(draft, threadText) {
  const placeholders = extractPlaceholders(draft);
  const needsInput = placeholders.length > 0;
  const visible = stripPlaceholders(draft);
  const hay = normalizeHaystack(threadText);
  const fabricated = [];

  const threadMoney = new Set(moneyValues(threadText));
  for (const tok of moneyValues(visible)) {
    if (!threadMoney.has(tok)) fabricated.push(`$${tok}`);
  }

  const qtyRe = new RegExp(QTY_RE.source, 'gi');
  let m;
  while ((m = qtyRe.exec(visible))) {
    const n = m[1];
    if (n === '1') continue;
    if (!hay.includes(n)) fabricated.push(`${m[1]} ${m[2]}`);
  }

  for (const d of dateTokens(visible)) {
    const compact = d.replace(/[/,.\s]/g, '');
    const hayCompact = hay.replace(/[/,.\s]/g, '');
    if (!hay.toLowerCase().includes(d) && !hayCompact.includes(compact)) {
      fabricated.push(d);
    }
  }

  const etaRe = new RegExp(ETA_RE.source, 'gi');
  while ((m = etaRe.exec(visible))) {
    if (!hay.includes(m[1])) fabricated.push(`ETA ${m[1]}`);
  }

  return {
    ok: fabricated.length === 0,
    needsInput,
    fabricated,
    placeholders,
  };
}

export function flagNeedsInput(draft, threadText) {
  const result = assertNoFabricatedFacts(draft, threadText);
  return { ...result, needsInput: result.needsInput || !result.ok };
}
