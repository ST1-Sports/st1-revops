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

  // Keep court/ball sizes (28.5, 29.5) — stripping the dot used to turn
  // them into "28" / "5" and drop them, so TF-1000 28.5 lost to a random AC ball.
  for (const size of lower.match(/\d+\.\d+/g) || []) {
    push(size, distinctive);
    push(size.replace('.', ''), distinctive);
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

export function itemHasModelHit(item, tokens) {
  if (!tokens?.models?.length) return true;
  const hay = `${normalizePriceText(item?.name)} ${normalizePriceText(item?.sku)}`;
  return tokens.models.some(m => m && hay.includes(m));
}

export function dealerCostOf(item) {
  const n = Number(item?.cost ?? item?.lastCost);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function productMatchKey(item) {
  const sku = normalizePriceText(item?.sku);
  if (sku) return `sku:${sku}`;
  const name = normalizePriceText(item?.name);
  const model = (name.match(/[a-z]{1,8}[-/][a-z0-9][-a-z0-9/]*/) || name.match(/[a-z]{1,6}\d{2,}[a-z0-9]*/))?.[0];
  return model ? `model:${model}` : `name:${name.slice(0, 48)}`;
}

/**
 * Among rows that are the same product, put the lowest dealer cost first.
 * Relevance still wins across different products.
 */
export function pickBestRate(ranked) {
  if (!Array.isArray(ranked) || ranked.length < 2) return ranked || [];
  const topScore = ranked[0].score;
  const relevant = ranked.filter(r => r.score >= topScore * 0.8 || r.score >= topScore - 50);
  const winnerKey = productMatchKey(ranked[0].item);
  const same = relevant.filter(r => productMatchKey(r.item) === winnerKey);
  const pool = same.length ? same : relevant;
  const priced = [...pool].sort((a, b) => {
    const ca = dealerCostOf(a.item);
    const cb = dealerCostOf(b.item);
    if (ca != null && cb != null && ca !== cb) return ca - cb;
    if (ca != null && cb == null) return -1;
    if (ca == null && cb != null) return 1;
    return b.score - a.score;
  });
  const best = priced[0];
  if (!best) return ranked;
  const rest = ranked.filter(r => (r.item.id || r.item) !== (best.item.id || best.item));
  return [best, ...rest];
}

export function rankPriceItems(items, query, { sku } = {}) {
  const tokens = tokenizePriceQuery([query, sku].filter(Boolean).join(' '));
  let ranked = [...(items || [])]
    .map(item => ({ item, score: scorePriceItem(item, tokens, sku) }))
    .filter(row => row.score > 0);
  if (tokens.models.length) {
    const hits = ranked.filter(row => itemHasModelHit(row.item, tokens));
    if (hits.length) ranked = hits;
  }
  ranked.sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || '')));
  return pickBestRate(ranked);
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
