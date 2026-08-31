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
  return productFamilyKey(item);
}

function digitCount(token) {
  return (String(token || '').match(/\d/g) || []).length;
}

/** Model token from a name (TF-1000), not a vendor SKU prefix (AC-1457055). */
export function extractModelToken(text) {
  const n = normalizePriceText(text);
  const hyphen = (n.match(/[a-z]{1,8}[-/][a-z0-9][-a-z0-9/]*/g) || [])
    .find(m => /\d/.test(m) && digitCount(m) < 6);
  if (hyphen) return hyphen.replace(/[-/]/g, '');
  const glued = (n.match(/[a-z]{1,6}\d{2,5}[a-z0-9]*/g) || [])
    .find(m => digitCount(m) < 6);
  if (glued) return glued;
  const spaced = n.match(/\b([a-z]{2,8})\s+(\d{3,5})\b/);
  if (spaced && !PRICE_SEARCH_GENERIC.has(spaced[1])) return `${spaced[1]}${spaced[2]}`;
  return '';
}

export function extractSizeToken(text) {
  const n = normalizePriceText(text);
  const dec = n.match(/\b(2[789]\.5)\b/);
  if (dec) return dec[1];
  const sz = n.match(/\bsz\s*(\d)\b/) || n.match(/\bsize\s*(\d)\b/);
  if (sz) return `sz${sz[1]}`;
  return '';
}

function genderToken(text) {
  const n = normalizePriceText(text);
  if (/\b(28\.5|girl|girls|women|womens|lady|ladies)\b/.test(n)) return 'w';
  if (/\b(29\.5|boy|boys|men|mens)\b/.test(n)) return 'm';
  return '';
}

export function extractSeriesToken(text) {
  const n = normalizePriceText(text);
  const series = n.match(/\b(legacy|precision|classic|replica)\b/);
  return series ? series[1] : '';
}

export function extractCertToken(text) {
  const n = normalizePriceText(text);
  if (/\bnfhs\b/.test(n)) return 'nfhs';
  if (/\bncaa\b/.test(n)) return 'ncaa';
  if (/\bnaia\b/.test(n)) return 'naia';
  if (/\bnjcaa\b/.test(n)) return 'njcaa';
  return '';
}

/**
 * Same manufacturer product across vendor catalogs. Athletic Connection,
 * Spalding, and a Frazier-style list of the Legacy TF-1000 NFHS 28.5 share
 * a key even when their SKUs differ. Precision vs Legacy, NFHS vs NAIA,
 * and 28.5 vs 29.5 stay apart.
 */
export function productFamilyKey(item) {
  const hay = `${item?.name || ''} ${item?.brand || ''}`;
  const model = extractModelToken(hay);
  const size = extractSizeToken(`${hay} ${item?.sku || ''}`);
  const series = extractSeriesToken(hay);
  const cert = extractCertToken(hay);
  const gender = size ? '' : genderToken(hay);
  if (model) {
    return ['fam', model, series, size, cert, gender].filter(Boolean).join(':');
  }
  const sku = normalizePriceText(item?.sku);
  if (sku) return `sku:${sku}`;
  return `name:${normalizePriceText(item?.name).slice(0, 48)}`;
}

/** Competing dealer rows for the same product, cheapest first. */
export function vendorRatesFor(items, winner) {
  if (!winner || !Array.isArray(items)) return [];
  const key = productFamilyKey(winner);
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    if (!item || productFamilyKey(item) !== key) continue;
    const supplier = item.supplier?.name || (typeof item.supplier === 'string' ? item.supplier : null) || 'Unknown list';
    const cost = dealerCostOf(item);
    const dedupe = `${normalizePriceText(supplier)}|${normalizePriceText(item.sku)}|${cost ?? ''}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    rows.push({
      name: item.name || null,
      sku: item.sku || null,
      brand: item.brand || null,
      supplier,
      cost,
      ourPrice: Number.isFinite(Number(item.ourPrice)) ? Number(item.ourPrice) : null,
      map: Number.isFinite(Number(item.map)) ? Number(item.map) : null,
    });
  }
  rows.sort((a, b) => {
    if (a.cost != null && b.cost != null && a.cost !== b.cost) return a.cost - b.cost;
    if (a.cost != null && b.cost == null) return -1;
    if (a.cost == null && b.cost != null) return 1;
    return String(a.supplier).localeCompare(String(b.supplier));
  });
  const bySupplier = [];
  const seenSupplier = new Set();
  for (const row of rows) {
    const key = normalizePriceText(row.supplier);
    if (seenSupplier.has(key)) continue;
    seenSupplier.add(key);
    bySupplier.push(row);
  }
  return bySupplier.map((row, i) => ({ ...row, best: i === 0 && row.cost != null }));
}

/**
 * Among rows that are the same product, put the lowest dealer cost first.
 * Relevance still wins across different products.
 */
export function pickBestRate(ranked) {
  if (!Array.isArray(ranked) || ranked.length < 2) return ranked || [];
  const winnerKey = productFamilyKey(ranked[0].item);
  const same = winnerKey ? ranked.filter(r => productFamilyKey(r.item) === winnerKey) : [];
  const topScore = ranked[0].score;
  const relevant = ranked.filter(r => r.score >= topScore * 0.8 || r.score >= topScore - 50);
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

/**
 * Quote-time order: named supplier wins when Matt asked for it; otherwise
 * the winning product family is cheapest-first so Frazier / AC / Spalding
 * overlap picks the lowest dealer cost.
 */
export function orderQuotePriceRows(items, { preferredSupplier } = {}) {
  if (!items?.length) return items || [];
  const out = [...items];
  if (preferredSupplier) {
    const n = String(preferredSupplier).toLowerCase();
    const rank = it => {
      const brand = String(it.brand || '').toLowerCase();
      const sup = String(it.supplier?.name || it.supplier || '').toLowerCase();
      if (sup.includes(n)) return 0;
      if (brand.includes(n)) return 1;
      return 2;
    };
    out.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const ca = dealerCostOf(a);
      const cb = dealerCostOf(b);
      if (ca != null && cb != null && ca !== cb) return ca - cb;
      if (ca != null && cb == null) return -1;
      if (ca == null && cb != null) return 1;
      return 0;
    });
    return out;
  }
  const topKey = productFamilyKey(out[0]);
  out.sort((a, b) => {
    const ka = productFamilyKey(a) === topKey ? 0 : 1;
    const kb = productFamilyKey(b) === topKey ? 0 : 1;
    if (ka !== kb) return ka - kb;
    const ca = dealerCostOf(a);
    const cb = dealerCostOf(b);
    if (ca != null && cb != null && ca !== cb) return ca - cb;
    if (ca != null && cb == null) return -1;
    if (ca == null && cb != null) return 1;
    return 0;
  });
  return out;
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
