/**
 * Ranked dealer-list search shared by Scout (get_st1_pricing) and Edgar.
 *
 * Naive Prisma OR + alphabetical take() treats "ball" as a match and returns
 * the first 5–60 Athletic Connection rows — never TF-5000. This tokenizer
 * keeps model numbers (TF-5000 / tf5000), searches name + SKU, and scores
 * distinctive tokens above generic sport words.
 */

export const PRICE_SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'at', 'by', 'with',
  'quote', 'price', 'cost', 'need', 'want', 'get', 'us', 'me', 'our', 'their',
  'how', 'much', 'many', 'set', 'sets', 'some', 'please', 'can', 'we', 'you',
  'what', 'whats', "what's", 'item', 'items', 'product', 'products', 'from',
  'list', 'dealer', 'st1', 'would', 'could', 'should', 'this', 'that', 'live',
  'exact', 'pull', 'look', 'lookup', 'find', 'show', 'tell', 'about', 'info',
  'information', 'number', 'qty', 'quantity', 'each', 'on', 'is', 'are',
  'give', 'send', 'check', 'have', 'has',
]);

export const PRICE_SEARCH_GENERIC = new Set([
  'ball', 'balls', 'soccer', 'basketball', 'football', 'baseball', 'softball',
  'volleyball', 'lacrosse', 'tennis', 'golf', 'hockey', 'track', 'field',
  'youth', 'adult', 'size', 'official', 'game', 'practice', 'training',
  'equipment', 'gear', 'athletic', 'sports', 'sport', 'team', 'school',
  'indoor', 'outdoor', 'mens', 'womens', 'boys', 'girls', 'junior',
  'composite', 'leather', 'rubber', 'nfhs', 'ncaa', 'fifa',
]);

export function normalizePriceText(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {string} query
 * @returns {{
 *   raw: string,
 *   lower: string,
 *   models: string[],
 *   distinctive: string[],
 *   generic: string[],
 *   searchNeedles: string[],
 * }}
 */
export function tokenizePriceQuery(query) {
  const raw = String(query || '').trim();
  const lower = raw.toLowerCase();
  const models = [];
  const distinctive = [];
  const generic = [];
  const seen = new Set();

  const push = (token, bucket) => {
    const t = normalizePriceText(token);
    if (!t || seen.has(t) || PRICE_SEARCH_STOPWORDS.has(t)) return;
    seen.add(t);
    bucket.push(t);
  };

  // Keep hyphenated / slashed model codes as wholes (TF-5000, AC-12345).
  for (const m of lower.match(/[a-z]{1,8}[-/][a-z0-9][-a-z0-9/]*/g) || []) {
    if (/\d/.test(m) || m.length >= 5) {
      push(m, models);
      push(m.replace(/[-/]/g, ''), models);
      push(m.replace(/[-/]/g, ' '), models);
    }
  }

  // Glued models: TF5000, WTH9000, AC12345
  for (const m of lower.match(/[a-z]{1,6}\d{2,}[a-z0-9]*/g) || []) {
    push(m, models);
  }

  const words = lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    if (PRICE_SEARCH_STOPWORDS.has(word)) continue;
    const isModel = /[a-z]/.test(word) && /\d/.test(word);
    if (PRICE_SEARCH_GENERIC.has(word) && !isModel) {
      push(word, generic);
      continue;
    }
    if (word.length <= 2 && !/\d/.test(word)) continue;
    if (isModel || word.length >= 3) push(word, distinctive);
    if (word.includes('-')) {
      for (const part of word.split('-')) {
        if (part.length <= 2 && !/\d/.test(part)) continue;
        if (PRICE_SEARCH_GENERIC.has(part)) push(part, generic);
        else if (part.length >= 3 || /\d/.test(part)) push(part, distinctive);
      }
    }
  }

  // Models are the strongest needles; do not OR-search generic words when
  // we have a model/SKU or another distinctive token — that is what floods
  // results with unrelated "ball" rows.
  const searchNeedles = models.length
    ? models
    : distinctive.length
      ? distinctive
      : generic;

  return { raw, lower, models, distinctive, generic, searchNeedles };
}

export function scorePriceItem(item, tokens, skuHint) {
  const name = normalizePriceText(item?.name);
  const sku = normalizePriceText(item?.sku);
  const brand = normalizePriceText(item?.brand);
  const hay = `${name} ${sku} ${brand}`;
  const hint = normalizePriceText(skuHint);
  let score = 0;

  if (hint && sku === hint) score += 1000;
  if (tokens.lower && sku && sku === tokens.lower) score += 800;
  if (tokens.lower && name && name === tokens.lower) score += 700;
  if (tokens.lower.length >= 6 && name.includes(tokens.lower)) score += 400;

  for (const model of tokens.models) {
    if (sku === model || name === model) score += 500;
    else if (sku.includes(model)) score += 320;
    else if (name.includes(model)) score += 280;
  }

  for (const token of tokens.distinctive) {
    if (sku.includes(token)) score += 220;
    else if (name.includes(token)) score += 160;
    else if (brand.includes(token)) score += 40;
  }

  const must = [...tokens.models, ...tokens.distinctive];
  if (must.length) {
    const hit = must.filter(t => hay.includes(t)).length;
    if (hit === must.length) score += 180;
    if (hit === 0) score -= 80;
  }

  const genericHits = tokens.generic.filter(t => hay.includes(t)).length;
  score += genericHits * 8;
  if (tokens.generic.length >= 2 && genericHits === tokens.generic.length) score += 40;
  if (tokens.generic.length >= 2 && genericHits === 1) score -= 4;

  return score;
}

export function rankPriceItems(items, query, { sku } = {}) {
  const tokens = tokenizePriceQuery([query, sku].filter(Boolean).join(' '));
  return [...(items || [])]
    .map(item => ({ item, score: scorePriceItem(item, tokens, sku) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || '')));
}

export function minAcceptableScore(tokens) {
  if (tokens.models.length) return 200;
  if (tokens.distinctive.length) return 140;
  return 8;
}

export function prismaContainsOr(needles, sku) {
  const or = [];
  if (sku) {
    or.push({ sku: { equals: sku, mode: 'insensitive' } });
    or.push({ sku: { contains: sku, mode: 'insensitive' } });
  }
  for (const needle of needles || []) {
    if (!needle || needle.length < 2) continue;
    or.push({ name: { contains: needle, mode: 'insensitive' } });
    or.push({ sku: { contains: needle, mode: 'insensitive' } });
    if (needle.length >= 3 && !/\d/.test(needle)) {
      or.push({ brand: { contains: needle, mode: 'insensitive' } });
    }
  }
  return or;
}

/** Each token must appear in name or SKU (avoids "ball" matching Baseball). */
export function prismaGenericAnd(tokens) {
  return (tokens || []).filter(t => t && t.length >= 2).map(token => ({
    OR: [
      { name: { contains: token, mode: 'insensitive' } },
      { sku: { contains: token, mode: 'insensitive' } },
    ],
  }));
}
