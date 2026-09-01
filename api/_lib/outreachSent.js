/** Sent Brad bulk-outreach rows, for a dedupe CSV. */

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function sentRowsFromBatches(batches) {
  const rows = [];
  for (const batch of batches || []) {
    for (const lead of batch.leads || []) {
      for (const [i, touch] of (lead.touches || []).entries()) {
        if (!touch?.sentAt) continue;
        rows.push({
          email: String(lead.email || '').trim(),
          email_key: String(lead.email || '').trim().toLowerCase(),
          org: lead.orgName || '',
          contact: lead.contactName || [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim(),
          sport: lead.sport || '',
          city: lead.city || '',
          state: lead.state || '',
          touch: i + 1,
          sent_at: touch.sentAt,
          subject: String(touch.subject || '').replace(/\s+/g, ' ').trim(),
          bounced: lead.bounced ? 'yes' : '',
          batch: batch.name || '',
          batch_status: batch.status || '',
        });
      }
    }
  }
  rows.sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at))
    || a.email_key.localeCompare(b.email_key)
    || a.touch - b.touch);
  return rows;
}

/** One row per email — last send wins. Use this sheet to skip already-touched addresses. */
export function uniqueSentByEmail(rows) {
  const byEmail = new Map();
  for (const row of rows) {
    if (!row.email_key) continue;
    const prev = byEmail.get(row.email_key);
    if (!prev) {
      byEmail.set(row.email_key, {
        email: row.email,
        org: row.org,
        contact: row.contact,
        sport: row.sport,
        city: row.city,
        state: row.state,
        last_sent_at: row.sent_at,
        last_touch: row.touch,
        send_count: 1,
        last_subject: row.subject,
        bounced: row.bounced,
        batches: row.batch,
      });
      continue;
    }
    prev.send_count += 1;
    const batchNames = new Set([...(prev.batches ? prev.batches.split(' | ') : []), row.batch].filter(Boolean));
    prev.batches = [...batchNames].join(' | ');
    if (String(row.sent_at) >= String(prev.last_sent_at)) {
      prev.email = row.email;
      prev.org = row.org || prev.org;
      prev.contact = row.contact || prev.contact;
      prev.sport = row.sport || prev.sport;
      prev.city = row.city || prev.city;
      prev.state = row.state || prev.state;
      prev.last_sent_at = row.sent_at;
      prev.last_touch = row.touch;
      prev.last_subject = row.subject;
      prev.bounced = row.bounced || prev.bounced;
    }
  }
  return [...byEmail.values()].sort((a, b) => String(b.last_sent_at).localeCompare(String(a.last_sent_at))
    || a.email.localeCompare(b.email));
}

export const SENT_ALL_HEADERS = [
  'email', 'org', 'contact', 'sport', 'city', 'state',
  'touch', 'sent_at', 'subject', 'bounced', 'batch', 'batch_status',
];

export const SENT_UNIQUE_HEADERS = [
  'email', 'org', 'contact', 'sport', 'city', 'state',
  'last_sent_at', 'last_touch', 'send_count', 'last_subject', 'bounced', 'batches',
];
