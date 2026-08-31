/**
 * Pick a Zoho Account record when the typed name is a short form of the
 * CRM name ("Hudson" → "Hudson High School"). Shared by findOrCreate so
 * the same rule can be unit-tested without hitting Zoho.
 */

function norm(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').replace(/[.,]+$/g, '').toLowerCase();
}

export function pickBestZohoAccount(matches, query, state) {
  if (!matches?.length) return null;
  let pool = matches;
  if (state && matches.length > 1) {
    const st = matches.filter(m => (m.Billing_State || '').toLowerCase() === String(state).toLowerCase());
    if (st.length) pool = st;
  }
  const q = norm(query);
  if (!q) return pool[0] || null;

  const scored = pool.map(m => {
    const n = norm(m.Account_Name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q) || q.startsWith(n)) score = 80;
    else if (q.length > 4 && n.length > 4 && (n.includes(q) || q.includes(n))) score = 60;
    return { m, score, len: n.length };
  }).filter(x => x.score > 0);

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.len - a.len);
  const top = scored[0];
  const ties = scored.filter(x => x.score === top.score);
  if (ties.length === 1 || top.score === 100) return top.m;

  const prefix = ties.filter(x => norm(x.m.Account_Name).startsWith(q));
  if (prefix.length === 1) return prefix[0].m;
  if (prefix.length > 1) return prefix.sort((a, b) => b.len - a.len)[0].m;
  return top.m;
}

export function zohoAccountSearchWord(name) {
  const word = String(name || '').trim().split(/\s+/)[0] || '';
  return word.length >= 4 ? word : '';
}
