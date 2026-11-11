/**
 * Per-user voice profile from ~30 recent sent emails.
 */

function mode(arr) {
  const counts = new Map();
  for (const x of arr) {
    const k = String(x || '').trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [k, c] of counts) {
    if (c > n) { best = k; n = c; }
  }
  return best;
}

export function buildStyleProfile(messages = []) {
  const greetings = [];
  const signoffs = [];
  let words = 0;
  let count = 0;
  for (const m of messages) {
    const body = String(m.body || '').replace(/^>.*$/gm, '').trim();
    if (!body) continue;
    const lines = body.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    count++;
    words += body.split(/\s+/).length;
    const first = lines[0];
    if (/^(hey|hi|hello|good\s+(morning|afternoon)|coach)\b/i.test(first) && first.length < 60) {
      greetings.push(first.replace(/,.*/, '').trim());
    }
    const last = [...lines].reverse().find(l => l.length < 40 && !/@/.test(l) && !/^sent from/i.test(l));
    if (last) signoffs.push(last);
  }
  return {
    greeting: mode(greetings) || 'Hi',
    signOff: mode(signoffs) || 'Thanks',
    avgWords: count ? Math.round(words / count) : 60,
    sampleCount: count,
    updatedAt: new Date().toISOString(),
  };
}

export function stylePrompt(profile) {
  if (!profile) return 'Write like a concise ST1 Sports sales rep. Sign off with first name or initials.';
  return [
    `Voice: greeting typically "${profile.greeting}", sign-off typically "${profile.signOff}".`,
    `Keep it around ${profile.avgWords || 60} words. Short, direct, in-thread reply. No HTML.`,
  ].join(' ');
}
