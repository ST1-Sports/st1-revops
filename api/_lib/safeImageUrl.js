// Only public https images (or inline data images): the renderer fetches `img` server-side,
// so internal hosts, plain http and other schemes are dropped.
export function safeImageUrl(raw) {
  if (!raw) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':')
  )
    return '';
  return url.toString();
}
