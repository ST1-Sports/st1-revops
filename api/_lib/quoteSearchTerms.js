/**
 * Turn an Edgar quote request into a bounded list of per-item search terms.
 *
 * The PIM (and the price-list fallback) rank one product query at a time, so
 * "quote Cheyenne Mtn HS for 12 discus and a set of hurdles" has to become
 * ["discus", "hurdles"] rather than one whole-sentence search.
 *
 * Structured items (Scout's parsed `input.items`, plus any held lines from an
 * open quote) are used as-is when present. Otherwise the task text is split
 * on commas / "and" / "plus" with quantities and lead-ins stripped. Never
 * more than MAX_QUOTE_SEARCH_TERMS terms.
 */

export const MAX_QUOTE_SEARCH_TERMS = 8;

const LEAD_IN = /^\s*(?:hey\s+edgar[,:]?\s*)?(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:(?:build|make|create|update|draft|send|get|give)\s+(?:me\s+)?(?:a|an|the)?\s*)?(?:quote|quoting|price\s+out|pricing|price)\b\s*(?:me\s+)?/i;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "hurdles" → "hurdle", "boxes" → "box". Only trims a suffix, so the result
 * is always a prefix of the original word: substring searches (PIM, Prisma
 * contains, the price ranker) can only match more, never less. Words with
 * digits, short words and -ss/-us/-is endings (discus, brass) are left alone.
 */
export function singularizeTerm(term) {
  return String(term || '').split(' ').map(word => {
    if (!/^[A-Za-z]{4,}$/.test(word)) return word;
    if (/(?:ss|us|is)$/i.test(word)) return word;
    if (/(?:ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
    if (/s$/i.test(word)) return word.slice(0, -1);
    return word;
  }).join(' ');
}

function cleanSegment(segment) {
  let t = String(segment || '');
  t = t.replace(/\$\s*\d[\d,]*(?:\.\d+)?/g, ' ');               // "$81.95"
  t = t.replace(/\b(?:at|@)\s*(?=\s|$)/gi, ' ');                 // dangling "at"
  t = t.replace(/\s+/g, ' ').trim().replace(/^[\s:;.\-–—]+/, '');
  // Leading quantity / packaging words, repeated: "12x", "qty 12", "a set of", "2 pairs of".
  let prev;
  do {
    prev = t;
    t = t
      .replace(/^(?:qty|quantity)\s*:?\s*\d+\s*/i, '')
      .replace(/^\d+\s*(?:x|×|pcs?|pieces?|ea|units?)?\b\s*/i, '')
      .replace(/^(?:a|an|the|some|one|two|three|four|five|six|ten|twelve|dozen)\s+/i, '')
      .replace(/^(?:sets?|pairs?|cases?|boxes?|packs?|dozen)\s+of\s+/i, '')
      .replace(/^of\s+/i, '')
      .trim();
  } while (t !== prev);
  t = t.replace(/\s+(?:each|ea)\.?$/i, '').trim();
  return singularizeTerm(t);
}

/** Split free text like "12 discus, 4 hurdles and a shot put" into item phrases. */
export function splitTaskIntoItems(task, { customer } = {}) {
  let text = String(task || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  if (customer && String(customer).trim().length >= 2) {
    text = text.replace(new RegExp(escapeRegExp(String(customer).trim()), 'ig'), ' ').replace(/\s+/g, ' ').trim();
  }
  text = text.replace(LEAD_IN, '');
  // "Cheyenne Mtn HS for 12 discus …" — a digit-free lead-in before "for"
  // is the customer, not an item.
  const forMatch = text.match(/^([^\d,;]*?)\bfor\s+(\S[\s\S]*)$/i);
  if (forMatch && forMatch[2].trim()) text = forMatch[2];

  const parts = text.split(/\s*(?:,|;|\n|&|\+|\band\b|\bplus\b)\s*/i);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const cleaned = cleanSegment(part);
    if (cleaned.length < 2) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_QUOTE_SEARCH_TERMS) break;
  }
  return out;
}

/**
 * Search terms for an Edgar request. Structured items win; otherwise the
 * task text is split. Falls back to the raw task (trimmed) so there is
 * always at least one term when a task was given.
 */
export function quoteSearchTerms(task, { items = [], lockedItems = [], customer } = {}) {
  const structured = [...(Array.isArray(items) ? items : []), ...(Array.isArray(lockedItems) ? lockedItems : [])]
    .map(i => (i?.sku ? String(i.sku).trim() : singularizeTerm(String(i?.name || '').trim())))
    .filter(t => t.length >= 2);
  const terms = [];
  const seen = new Set();
  const source = structured.length ? structured : splitTaskIntoItems(task, { customer });
  for (const term of source) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term.slice(0, 160));
    if (terms.length >= MAX_QUOTE_SEARCH_TERMS) break;
  }
  if (!terms.length && String(task || '').trim()) terms.push(String(task).trim().slice(0, 160));
  return terms;
}
