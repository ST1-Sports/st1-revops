/**
 * Hard filters for Follow-Up Radar. Run BEFORE any LLM call.
 *
 * A thread is excluded when:
 *  - every other participant is @st1sports.com (internal)
 *  - the external party never sent a message (one-way blast)
 *  - the same subject went to 10+ recipients within 48h and they never replied
 *  - any external domain is a known vendor
 *  - noreply / support / order-confirmation / receipt patterns
 *  - email warmup tags or warmup Gmail labels
 */

export const HOME_DOMAIN = 'st1sports.com';

export const SEED_VENDOR_DOMAINS = [
  'pmpprinting.com',
  'gillathletics.com',
  'blazerathletic.com',
  'fotlinc.com',
  'champrosports.com',
  'champro.com',
  'wilson.com',
  'newbalance.com',
  'mizunousa.com',
  'mizuno.com',
  'baden.com',
  'baden-sports.com',
  'demarini.com',
  'all-starsports.com',
  'allstarsports.com',
  'evoshield.com',
  'diamond-sports.com',
  'moltenusa.com',
  'molten.com',
  'rawlings.com',
  'easton.com',
  'underarmour.com',
  'nike.com',
  'adidas.com',
  'asics.com',
  'spalding.com',
  'bsnsports.com',
  'varsity.com',
  'riddell.com',
  'schutt-sports.com',
  'xenith.com',
  'smarthockey.com',
  'hockeymonkey.com',
  'teamathletics.com',
];

export const WARMUP_BODY_RE = /\bT3RD[A-Z0-9]+\b|\{\s*warmup\s*\}|email[\s-]?warmup|warmup[\s-]?email|instantly\.ai|smartlead|lemlist|woodpecker/i;
export const WARMUP_LABEL_RE = /warmup|warm[\s-]?up|instantly|smartlead|lemlist|woodpecker/i;
export const NOREPLY_LOCAL_RE = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|orders?|receipts?|invoices?|billing|support|helpdesk|bounces?|noreply[-.].+)$/i;
export const NOREPLY_SUBJECT_RE = /\b(order\s*confirmation|your\s+receipt|payment\s+received|shipping\s+confirmation|do\s+not\s+reply|unsubscribe)\b/i;

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'proton.me', 'protonmail.com', 'comcast.net', 'sbcglobal.net',
]);

export function parseEmail(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/<([^>]+)>/);
  const email = (m ? m[1] : s.split(',')[0] || '').trim().toLowerCase();
  const name = m ? s.replace(m[0], '').replace(/"/g, '').trim() : '';
  if (!email || !email.includes('@')) return { name: name || '', email: '' };
  return { name, email };
}

export function emailsFromHeader(raw) {
  return String(raw || '')
    .split(',')
    .map(parseEmail)
    .filter(p => p.email);
}

export function domainOf(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : '';
}

export function isPublicEmailDomain(domain) {
  return PUBLIC_DOMAINS.has(String(domain || '').toLowerCase());
}

export function isInternalEmail(email, homeDomain = HOME_DOMAIN) {
  return domainOf(email) === homeDomain;
}

export function isNoreplyAddress(email) {
  const local = String(email || '').split('@')[0] || '';
  if (NOREPLY_LOCAL_RE.test(local)) return true;
  if (/no-?reply/i.test(local)) return true;
  if (/^support[-._]/i.test(local)) return true;
  return false;
}

export function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^(re|fwd|fw)\s*:\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function allParticipants(thread) {
  const seen = new Set();
  const out = [];
  for (const m of thread.messages || []) {
    const pack = [
      parseEmail(m.from),
      ...(m.to || []).map(t => (typeof t === 'string' ? parseEmail(t) : t)),
      ...(m.cc || []).map(t => (typeof t === 'string' ? parseEmail(t) : t)),
    ];
    for (const p of pack) {
      if (!p.email || seen.has(p.email)) continue;
      seen.add(p.email);
      out.push(p);
    }
  }
  return out;
}

export function isWarmupThread(thread) {
  const labels = [...(thread.labelIds || []), ...(thread.labelNames || [])];
  if (labels.some(l => WARMUP_LABEL_RE.test(String(l)))) return true;
  if (WARMUP_BODY_RE.test(thread.subject || '')) return true;
  for (const m of thread.messages || []) {
    if (WARMUP_BODY_RE.test(m.subject || '') || WARMUP_BODY_RE.test(m.body || '')) return true;
  }
  return false;
}

/**
 * sentEvents: [{ subject, recipients: string[], at: Date|number }]
 * Returns a Set of normalized subjects that look like mass campaigns.
 */
export function campaignSubjectKeys(sentEvents, { minRecipients = 10, windowMs = 48 * 3600 * 1000 } = {}) {
  const groups = new Map();
  for (const ev of sentEvents || []) {
    const key = normalizeSubject(ev.subject);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      at: new Date(ev.at).getTime(),
      recipients: (ev.recipients || []).map(e => String(e).toLowerCase()),
    });
  }
  const campaign = new Set();
  for (const [key, events] of groups) {
    events.sort((a, b) => a.at - b.at);
    let i = 0;
    for (let j = 0; j < events.length; j++) {
      while (i < j && events[j].at - events[i].at > windowMs) {
        i++;
      }
      const unique = new Set();
      for (let k = i; k <= j; k++) {
        for (const r of events[k].recipients) unique.add(r);
      }
      if (unique.size >= minRecipients) {
        campaign.add(key);
        break;
      }
    }
  }
  return campaign;
}

function externalSentAMessage(thread, ownerEmail, homeDomain) {
  const owner = String(ownerEmail || '').toLowerCase();
  for (const m of thread.messages || []) {
    const from = parseEmail(m.from).email;
    if (!from) continue;
    if (from === owner) continue;
    if (isInternalEmail(from, homeDomain)) continue;
    return true;
  }
  return false;
}

function otherParticipants(thread, ownerEmail) {
  const owner = String(ownerEmail || '').toLowerCase();
  return allParticipants(thread).filter(p => p.email && p.email !== owner);
}

/**
 * @returns {{ exclude: true, reason: string } | { exclude: false, reason: null }}
 */
export function hardFilter(thread, {
  ownerEmail,
  vendorDomains = new Set(),
  campaignSubjects = new Set(),
  homeDomain = HOME_DOMAIN,
} = {}) {
  if (isWarmupThread(thread)) {
    return { exclude: true, reason: 'warmup' };
  }

  if (NOREPLY_SUBJECT_RE.test(thread.subject || '')) {
    return { exclude: true, reason: 'noreply_subject' };
  }

  const others = otherParticipants(thread, ownerEmail);
  if (!others.length) {
    return { exclude: true, reason: 'internal' };
  }

  if (others.every(p => isInternalEmail(p.email, homeDomain))) {
    return { exclude: true, reason: 'internal' };
  }

  const externals = others.filter(p => !isInternalEmail(p.email, homeDomain));

  const vendors = vendorDomains instanceof Set
    ? vendorDomains
    : new Set([...(vendorDomains || [])].map(d => String(d).toLowerCase()));
  if (externals.some(p => vendors.has(domainOf(p.email)))) {
    return { exclude: true, reason: 'vendor' };
  }

  if (externals.some(p => isNoreplyAddress(p.email))) {
    return { exclude: true, reason: 'noreply' };
  }

  if (!externalSentAMessage(thread, ownerEmail, homeDomain)) {
    const subj = normalizeSubject(thread.subject);
    if (campaignSubjects.has(subj)) {
      return { exclude: true, reason: 'campaign' };
    }
    return { exclude: true, reason: 'one_way' };
  }

  const subj = normalizeSubject(thread.subject);
  if (campaignSubjects.has(subj) && !externalSentAMessage(thread, ownerEmail, homeDomain)) {
    return { exclude: true, reason: 'campaign' };
  }

  return { exclude: false, reason: null };
}

export function businessDaysBetween(from, to = new Date()) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const start = a < b ? a : b;
  const end = a < b ? b : a;
  let days = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cur < last) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

export function emailedWithinBusinessDays(lastTouchAt, lastTouchBy, days = 3) {
  if (lastTouchBy !== 'us' || !lastTouchAt) return false;
  return businessDaysBetween(lastTouchAt, new Date()) < days;
}
