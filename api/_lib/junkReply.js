/**
 * Drop out-of-office and email-warmup mail before Brad treats a message
 * as a positive reply. The LLM classifier already says PASS for OOO, but
 * warmup tools (Instantly, Mailwarm, Folderly, …) send short friendly
 * notes that look like interest — those must not hit the queue, Slack,
 * or +50 "replied" scoring.
 *
 * Sports copy like "warm up before the game" is not a match: every warmup
 * pattern is tied to email/deliverability wording or a known warmup host.
 *
 * A false positive silently drops a real buyer reply (no Slack, no queue, no
 * score), so every rule needs strong evidence: a header, a known warmup host,
 * explicit warmup wording, or an out-of-office phrase together with a return
 * or absence cue. Bare tool names ("instantly") and subject tags are not used.
 */

const OOO_SUBJECT = [
  /\bout\s+of\s+(the\s+)?office\b/i,
  /\bautomatic(?:ally)?\s+reply\b/i,
  /\bauto[- ]?reply\b/i,
  /\bauto[- ]?response\b/i,
  /\baway\s+from\s+(the\s+)?office\b/i,
  /\bon\s+vacation\b/i,
  /\booo\b/i,
  /\bautoreply\b/i,
]

// Unambiguous autoresponder wording: enough on its own.
const OOO_BODY_STRONG = [
  /\bthis\s+is\s+an\s+automatic(?:ally\s+generated)?\s+(reply|response)\b/i,
  /\bmailbox\s+is\s+unattended\b/i,
  /\blimited\s+access\s+to\s+(e-?mail|my\s+inbox)\b/i,
]
// Absence wording that a person might also write in a real reply ("I'll be away next week but
// yes, send pricing"). Counts only together with an autoresponder cue below.
const OOO_BODY_ABSENCE = [
  /\bi(?:'m| am)\s+(currently\s+)?out\s+of\s+(the\s+)?office\b/i,
  /\bi(?:'m| am)\s+currently\s+away\b/i,
  /\bi(?:'ll| will)\s+be\s+(out\s+of\s+(the\s+)?office|away)\b/i,
  /\bi(?:'m| am)\s+(not\s+in|away\s+from)\s+(the\s+)?(office|email|desk)\b/i,
  /\bi(?:'m| am)\s+on\s+(annual\s+|parental\s+|maternity\s+|medical\s+)?leave\b/i,
  /\bi(?:'m| am)\s+unavailable\s+until\b/i,
]
const DAY = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\\d)'
const OOO_AUTORESPONDER_CUE = [
  /\b(will|shall)\s+(respond|reply|get\s+back)\s+(to\s+(you|your\s+(e-?mail|message))\s+)?(upon|when|after|as\s+soon\s+as)\b/i,
  /\bupon\s+my\s+return\b/i,
  /\b(urgent|immediate)\s+(matters?|requests?|needs?|assistance|issues?|questions?)\b[^.\n]{0,40}\b(contact|e-?mail|call|reach)\b/i,
  new RegExp(`\\bwill\\s+(be\\s+)?(back|return(ing)?)\\s+(to\\s+the\\s+office\\s+|in\\s+the\\s+office\\s+)?(on\\s+|by\\s+)?${DAY}`, 'i'),
  new RegExp(`\\breturning\\s+(to\\s+the\\s+office\\s+)?(on\\s+)?${DAY}`, 'i'),
]
// A reply that asks to buy is a reply, whatever else it says about being away.
const BUYING_INTENT = /\b(send|need|want|get)\s+(me\s+|us\s+)?(a\s+|the\s+)?(pricing|price|quote|estimate)|\binterested\b|\bplace\s+(an?\s+)?order\b|\bpurchase\s+order\b/i

const WARMUP_HOSTS = [
  'mailwarm.com',
  'warmupinbox.com',
  'warmbox.io',
  'folderly.com',
  'mailreach.co',
  'mailreach.com',
  'warmy.io',
  'inboxally.com',
  'trulyinbox.com',
  'lemwarm.com',
  'glockapps.com',
  'warmup.instantly.ai',
  'instantlywarming.com',
]

const WARMUP_TEXT = [
  /\bemail\s+warm[- ]?up\b/i,
  /\bwarm[- ]?up\s+(email|inbox|network|pool|tool|campaign|filter|tag)\b/i,
  /\bmailbox\s+warm(?:ing|[- ]?up)\b/i,
  /\bdeliverability\s+network\b/i,
  /\bthis\s+(message|email)\s+is\s+(part\s+of\s+)?(an?\s+)?(automated\s+)?warm[- ]?up\b/i,
  /\bsent\s+(via|by|from)\s+(an?\s+)?(instantly|mailwarm|folderly|mailreach|warmy|lemwarm|warmup inbox|smartlead)\b/i,
  /\binstantly\.ai\s+warm[- ]?up\b/i,
]

function headerValue(headers, name) {
  if (!headers) return ''
  if (typeof headers === 'string') return ''
  const want = String(name).toLowerCase()
  if (headers[name] != null) return String(headers[name])
  if (headers[want] != null) return String(headers[want])
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return String(v ?? '')
  }
  return ''
}

function hostOf(email) {
  return String(email || '').split('@')[1]?.trim().toLowerCase() || ''
}

function fromWarmupHost(email) {
  const host = hostOf(email)
  if (!host) return false
  return WARMUP_HOSTS.some(d => host === d || host.endsWith(`.${d}`))
}

/** @returns {'ooo' | 'warmup' | null} */
export function junkReplyReason({ subject = '', body = '', fromEmail = '', headers = {} } = {}) {
  const auto = headerValue(headers, 'auto-submitted')
  if (auto && !/^no$/i.test(auto.trim())) return 'ooo'

  const xAuto = headerValue(headers, 'x-autoreply') || headerValue(headers, 'x-autorespond')
  if (xAuto && !/^(false|no|0)$/i.test(xAuto.trim())) return 'ooo'

  if (fromWarmupHost(fromEmail)) return 'warmup'

  const hay = `${subject}\n${body}`
  if (WARMUP_TEXT.some(re => re.test(hay))) return 'warmup'
  if (OOO_SUBJECT.some(re => re.test(subject))) return 'ooo'
  if (OOO_BODY_STRONG.some(re => re.test(body))) return 'ooo'
  if (
    OOO_BODY_ABSENCE.some(re => re.test(body)) &&
    OOO_AUTORESPONDER_CUE.some(re => re.test(body)) &&
    !BUYING_INTENT.test(body)
  )
    return 'ooo'
  return null
}

/** Pending Brad row that should appear in Prospecting → needs follow-up. */
export function isBradFollowUpReply(row) {
  if (!row || row.outcome !== 'pending') return false
  return !junkReplyFromStored(row)
}

export function isJunkInboundReply(input) {
  return !!junkReplyReason(input)
}

export function junkReplyFromStored(row) {
  const inp = row?.input || {}
  return junkReplyReason({
    subject: inp.subject || '',
    body: inp.snippet || inp.bodyText || '',
    fromEmail: inp.fromEmail || '',
  })
}
