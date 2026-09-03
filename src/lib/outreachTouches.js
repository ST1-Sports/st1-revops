/**
 * Shared touch resolution for Bulk Outreach — template-first Email 1 for
 * large Prospecting lists (thousands of leads with touches: []).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isPlaceholderCopy = text => /^\s*\(?personalized per organization\)?\s*$/i.test(String(text || ''));

export const touchHasCopy = t => !!(t && String(t.subject || '').trim() && String(t.body || '').trim() && !isPlaceholderCopy(t.body));

export function mergeLeadTags(text, lead) {
  return (text || '')
    .replace(/\{\{\s*(orgName|organization|company|school)\s*\}\}/gi, lead.orgName || 'your organization')
    .replace(/\{\{\s*firstName\s*\}\}/gi, (lead.contactName && lead.contactName !== '-') ? (lead.firstName || lead.contactName.split(' ')[0]) : 'there')
    .replace(/\{\{\s*lastName\s*\}\}/gi, lead.lastName || '')
    .replace(/\{\{\s*contactName\s*\}\}/gi, (lead.contactName && lead.contactName !== '-') ? lead.contactName : 'there')
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email || '')
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || '')
    .replace(/\{\{\s*state\s*\}\}/gi, lead.state || '')
    .replace(/\{\{\s*sport\s*\}\}/gi, lead.sport || 'sports');
}

export function stepTemplateKey(stepIdx) {
  return `step${stepIdx}`;
}

/** Inline touch wins when it has copy; otherwise fall back to batch template. */
export function effectiveTouch(lead, touchIdx, templates = {}) {
  const inline = lead.touches?.[touchIdx];
  if (inline && touchHasCopy(inline)) {
    return inline;
  }
  const tmpl = templates[stepTemplateKey(touchIdx)];
  if (!tmpl || !touchHasCopy(tmpl)) {
    return inline || null;
  }
  return {
    subject: mergeLeadTags(tmpl.subject, lead).trim(),
    body: mergeLeadTags(tmpl.body, lead).trim(),
    sentAt: inline?.sentAt,
  };
}

export function leadHasPendingTouch(lead, touchIdx, templates = {}) {
  const t = effectiveTouch(lead, touchIdx, templates);
  return !!(t && touchHasCopy(t) && !t.sentAt);
}

export function isProspectingList(fileName) {
  return String(fileName || '').startsWith('Prospecting:');
}

export function needsEmail1Composer(leads, templates = {}, fileName = '') {
  const sendable = (leads || []).filter(l => l.sendable && l.email && EMAIL_RE.test(l.email));
  if (!sendable.length) return false;
  const hasInline = sendable.some(l => touchHasCopy(l.touches?.[0]));
  const hasTemplate = touchHasCopy(templates.step0);
  if (hasInline || hasTemplate) return false;
  return isProspectingList(fileName) || sendable.every(l => !(l.touches || []).length);
}

export function stepIndicesFor(leads, templates = {}) {
  const fromLeads = leads.reduce((a, l) => Math.max(a, (l.touches?.length || 0) - 1), -1);
  const fromTemplates = Object.keys(templates || {})
    .filter(k => /^step\d+$/.test(k) && touchHasCopy(templates[k]))
    .map(k => parseInt(k.replace('step', ''), 10));
  const maxIdx = Math.max(fromLeads, ...fromTemplates, -1);
  return maxIdx < 0 ? [] : Array.from({ length: maxIdx + 1 }, (_, i) => i);
}

export function countPendingTouches(leads, templates = {}, { stopped = () => false } = {}) {
  const eligible = (leads || []).filter(l => l.sendable && l.email && !l.bounced && !l.heldForEarlier && !stopped(l));
  const maxSteps = Math.max(
    1,
    stepIndicesFor(eligible, templates).length,
    ...eligible.map(l => l.touches?.length || 0),
  );
  let n = 0;
  for (const lead of eligible) {
    for (let i = 0; i < maxSteps; i++) {
      const t = effectiveTouch(lead, i, templates);
      if (t && touchHasCopy(t) && !t.sentAt) n += 1;
    }
  }
  return n;
}

export function batchScheduleSummary(sendableCount, batchSize, { touchSteps = 1 } = {}) {
  const n = Math.max(0, Number(sendableCount) || 0);
  const perDay = Math.max(1, Number(batchSize) || 25);
  const daysPerTouch = Math.ceil(n / perDay) || 0;
  const totalDays = daysPerTouch * Math.max(1, touchSteps);
  return { sendableCount: n, perDay, daysPerTouch, totalDays, touchSteps: Math.max(1, touchSteps) };
}

export function materializeLeadsFromTemplates(leads, templates = {}) {
  const templateSteps = Object.keys(templates || {})
    .filter(k => /^step\d+$/.test(k) && touchHasCopy(templates[k]))
    .map(k => parseInt(k.replace('step', ''), 10));
  const maxFromLeads = leads.reduce((a, l) => Math.max(a, (l.touches?.length || 0) - 1), -1);
  const maxStep = Math.max(maxFromLeads, ...templateSteps, -1);
  if (maxStep < 0) return leads;

  return leads.map(lead => {
    const touches = [...(lead.touches || [])];
    for (let i = 0; i <= maxStep; i++) {
      const eff = effectiveTouch(lead, i, templates);
      if (!eff || !touchHasCopy(eff)) continue;
      const existing = touches[i];
      if (existing?.sentAt) {
        touches[i] = { ...existing, subject: existing.subject || eff.subject, body: existing.body || eff.body };
      } else if (!existing || !touchHasCopy(existing)) {
        touches[i] = { subject: eff.subject, body: eff.body, ...(existing?.sentAt ? { sentAt: existing.sentAt } : {}) };
      }
    }
    return { ...lead, touches };
  });
}

// MT-timezone business-hours helpers — mirror BulkOutreach / send-batches cron.
const addBusinessDays = (startMs, days) => {
  const dt = new Date(startMs);
  let added = 0;
  while (added < days) {
    dt.setDate(dt.getDate() + 1);
    const wd = dt.getDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return dt.getTime();
};

const getMTComp = ms => {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  return {
    h: parseInt(p.hour, 10) % 24,
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    y: parseInt(p.year, 10),
    mo: parseInt(p.month, 10) - 1,
    d: parseInt(p.day, 10),
  };
};

const nextMTBizStart = ms => {
  for (let i = 0; i <= 7; i++) {
    const probe = ms + i * 86400000;
    const { y, mo, d } = getMTComp(probe);
    for (const off of [6, 7]) {
      const c = Date.UTC(y, mo, d, 9 + off, 0, 0);
      const ck = getMTComp(c);
      if (ck.h !== 9 || c <= ms) continue;
      if (ck.wd >= 1 && ck.wd <= 5) return c;
    }
  }
  return ms + 86400000;
};

export function buildOutreachSchedule(campId, leads, { startMs, batchSize, touchGapDays, templates = {} }, { stopped = () => false } = {}) {
  const sendable = leads.filter(l => l.sendable && l.email && !stopped(l));
  const stepIndices = stepIndicesFor(sendable, templates);
  const maxTouches = Math.max(1, stepIndices.length, ...sendable.map(l => l.touches?.length || 0));
  const scheduledBatches = {};
  const perLeadDates = {};
  let currentMs = startMs;

  for (let t = 0; t < maxTouches; t++) {
    const atThisTouch = sendable.filter(l => {
      const touch = effectiveTouch(l, t, templates);
      return touch && touchHasCopy(touch) && !touch.sentAt;
    });
    if (!atThisTouch.length) continue;

    const touchStartMs = currentMs;
    const size = Math.max(1, Number(batchSize) || 25);
    for (let i = 0; i < atThisTouch.length; i += size) {
      const chunk = atThisTouch.slice(i, i + size);
      const bk = `${campId}-${t}-${chunk[0].id}`;
      const batchContacts = {};
      chunk.forEach(l => {
        const touch = effectiveTouch(l, t, templates);
        batchContacts[l.id] = {
          email: l.email,
          fullName: (l.contactName && l.contactName !== '-') ? l.contactName : l.orgName,
          firstName: l.firstName || '',
          lastName: l.lastName || '',
          school: l.orgName,
          sport: l.sport || '',
          __subject: touch.subject,
          __body: touch.body,
        };
        perLeadDates[l.id] = perLeadDates[l.id] || [];
        perLeadDates[l.id][t] = new Date(currentMs).toISOString();
      });
      scheduledBatches[bk] = {
        scheduledAt: new Date(currentMs).toISOString(),
        touchIdx: t,
        contactIds: chunk.map(l => l.id),
        batchContacts,
      };
      currentMs = nextMTBizStart(currentMs);
    }

    if (t < maxTouches - 1) {
      currentMs = addBusinessDays(touchStartMs, Math.max(1, Number(touchGapDays) || 5));
      const gc = getMTComp(currentMs);
      if (gc.h < 9) {
        for (const off of [6, 7]) {
          const c = Date.UTC(gc.y, gc.mo, gc.d, 9 + off, 0, 0);
          if (getMTComp(c).h === 9) {
            currentMs = c;
            break;
          }
        }
      }
    }
  }

  return { scheduledBatches, perLeadDates };
}
