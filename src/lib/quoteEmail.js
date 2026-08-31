/**
 * Customer-facing quote email. Two things made the last send look like spam:
 * an em dash in the subject that arrived as "Ã¢Â€Â”", and a signature of
 * "Thanks, Admin" while Gmail showed Matt Stone as the From name.
 */

const GENERIC_SIGNER = new Set(['admin', 'owner', 'administrator', 'ad']);

export function asciiHeaderText(raw) {
  return String(raw || '')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\t\n\r\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteEmailSigner(cu, company = {}) {
  const rawName = String(cu?.name || '').trim();
  const generic = !rawName || GENERIC_SIGNER.has(rawName.toLowerCase());
  return {
    name: generic ? (company.ownerName || 'Matt Stone') : rawName,
    email: String(cu?.email || '').trim() || company.email || 'matt@st1sports.com',
    phone: String(cu?.phone || '').trim() || company.phone || '719-256-0275',
    companyName: company.name || 'ST1 Sports',
  };
}

export function buildQuoteEmailDraft({ quoteNumber, contactName, school, cu, company } = {}) {
  const signer = quoteEmailSigner(cu, company);
  const first = String(contactName || '').trim().split(/\s+/)[0] || 'there';
  const qn = String(quoteNumber || '').trim() || 'your quote';
  const schoolBit = school ? ` for ${school}` : '';
  const sig = [signer.name, signer.companyName, signer.email, signer.phone].filter(Boolean).join('\n');
  return {
    subject: asciiHeaderText(`Your quote from ST1 Sports - ${qn}`),
    body: `Hi ${first},\n\nAttached is quote ${qn}${schoolBit}. Take a look and tell me if you want any changes on quantities or items.\n\nHappy to walk through it if that's easier.\n\nThanks,\n${sig}`,
    signer,
  };
}

/** Last-chance cleanup so a leftover Admin draft / em dash never leaves the building. */
export function sanitizeOutgoingQuoteEmail(draft = {}, cu, company) {
  const built = buildQuoteEmailDraft({
    quoteNumber: draft.quoteNumber,
    contactName: draft.contactName,
    school: draft.school,
    cu,
    company,
  });
  const signer = built.signer;
  let subject = asciiHeaderText(draft.subject || built.subject);
  if (!subject) subject = built.subject;
  let body = String(draft.body || '').replace(/[\u2013\u2014\u2015]/g, '-');
  body = body.replace(
    /(^|\n)(Thanks,?\s*\n)(Admin|Owner|Administrator)\s*$/i,
    `$1$2${[signer.name, signer.companyName, signer.email, signer.phone].filter(Boolean).join('\n')}`
  );
  if (!body.trim()) body = built.body;
  return { subject, body, signer };
}
