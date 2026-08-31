/** Format Scout chat copy so markdown tables do not render as raw pipes. */

export function money(n) {
  if (n == null || n === '') return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function stripMarkdownTables(text) {
  return String(text || '')
    .replace(/(?:^[ \t]*\|.*\|[ \t]*\n?)+/gm, '\n')
    .replace(/^[ \t]*(?:[-*_]){3,}[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * When an Edgar card is on screen, drop the SKU/cost dump Scout often repeats.
 * Keep the spoken follow-up (notes that are not already on the card, questions).
 */
export function chatFollowUp(text, { hasQuoteCard } = {}) {
  let t = stripMarkdownTables(text);
  t = t.replace(/^#{1,6}\s+/gm, '');
  if (!hasQuoteCard) return t.trim();

  t = t.replace(/^here'?s what (?:edgar|i) pulled:?\s*/gim, '');
  t = t.replace(/^\s*(?:\*\*)?key notes:?\s*(?:\*\*)?\s*$/gim, '');

  const lines = t.split('\n').map(line => line.trim());
  const kept = [];
  for (const line of lines) {
    if (!line) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    const plain = line.replace(/\*\*/g, '');
    if (/^(your cost|list price|gross margin|per unit)\b/i.test(plain)) continue;
    if (/^sku\s*:/i.test(plain)) continue;
    if (/^[-*]\s*(gm floor is|no map|[\d.]+%\s*gm)\b/i.test(plain)) continue;
    if (/^[-*]\s*.+\s+—\s+you'?re well above/i.test(plain)) continue;
    if (/\(\s*SKU:\s*[^)]+\)/i.test(plain)) continue;
    if (/^\*\*.+\*\*$/.test(line) && line.length < 90 && /sku|tf-|ball|soccer/i.test(plain)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitChatBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    const body = para.join(' ').trim();
    para = [];
    if (body) blocks.push({ type: 'p', text: body });
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (/^\|/.test(line) || /^(?:[-*_]){3,}$/.test(line)) continue;
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      flushPara();
      if (!list) list = [];
      list.push(bullet[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

export function splitInlineMarks(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    return bold ? { t: bold[1], bold: true } : { t: part, bold: false };
  });
}
