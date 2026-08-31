/**
 * RFC 2047 encode MIME header values. Raw UTF-8 in Subject/From is what
 * turned "—" into "Ã¢Â€Â”" in Gmail. ASCII stays as-is.
 */

export function encodeMimeWord(value) {
  const s = String(value ?? '');
  if (!s) return '';
  if (/^[\x20-\x7E]*$/.test(s) && !/^\s|\s$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

export function encodeMailbox(name, email) {
  const addr = String(email || '').trim();
  const display = String(name || '').trim();
  if (!display) return addr;
  if (/^[\x20-\x7E]*$/.test(display) && !/[\\"]/.test(display)) {
    return /[(),:;<>@[\]]/.test(display) ? `"${display}" <${addr}>` : `${display} <${addr}>`;
  }
  return `${encodeMimeWord(display)} <${addr}>`;
}

export function encodeFilename(name) {
  const s = String(name || 'attachment').replace(/[\r\n"]/g, '');
  if (/^[\x20-\x7E]*$/.test(s)) return `"${s}"`;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}
