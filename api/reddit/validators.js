/**
 * Output validators for the Reddit engagement module.
 *
 * Each function accepts a parsed JSON object and returns:
 *   { valid: boolean, errors: string[] }
 *
 * Validators are pure functions with no I/O — they can be called in tests
 * without mocking anything. They mirror and replace the ad-hoc checks that
 * previously lived inline in evaluate.js and reply-gen.js.
 *
 * Usage:
 *   const { valid, errors } = validateEvaluatorResult(parsed);
 *   if (!valid) throw new Error(`Bad eval output: ${errors.join('; ')}`);
 */

// ─── enums ────────────────────────────────────────────────────────────────────

const EVAL_DECISIONS    = ['REPLY', 'MONITOR', 'SKIP'];
const INTENT_TYPES      = ['buying_now', 'researching', 'general_discussion', 'support_request', 'off_topic'];
const AUDIENCE_TYPES    = ['coach', 'parent', 'athlete', 'admin', 'unknown'];
const GUARDRAIL_DECISIONS = ['APPROVE', 'BLOCK', 'EDIT_REQUIRED'];

const MAX_REASONING_WORDS    = 70;
const MAX_VALUE_ANGLE_WORDS  = 40;
const MAX_SUMMARY_WORDS      = 40;
const MAX_WHY_IT_WORKS_WORDS = 60;
const MAX_RISK_NOTES_WORDS   = 50;
const SIMILARITY_THRESHOLD   = 0.72; // Jaccard word overlap — replies above this are too similar

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the output of the thread evaluator (eval.md → Claude → parsed JSON).
 *
 * Checks every field against the schema defined in the prompt:
 *   decision, fit_score, promo_risk, confidence (all integers 1–10),
 *   intent_type, audience_type (enums), reasoning_summary (≤70 words),
 *   value_angle (≤40 words), do_not_reply_reason (string).
 *
 * @param   {any} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEvaluatorResult(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Result is not an object'] };
  }

  // decision
  if (!EVAL_DECISIONS.includes(obj.decision)) {
    errors.push(`decision must be one of ${EVAL_DECISIONS.join(' | ')}, got: ${JSON.stringify(obj.decision)}`);
  }

  // integer scores 1–10
  for (const field of ['fit_score', 'promo_risk', 'confidence']) {
    const v = obj[field];
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      errors.push(`${field} must be an integer 1–10, got: ${JSON.stringify(v)}`);
    }
  }

  // intent_type
  if (!INTENT_TYPES.includes(obj.intent_type)) {
    errors.push(`intent_type must be one of ${INTENT_TYPES.join(' | ')}, got: ${JSON.stringify(obj.intent_type)}`);
  }

  // audience_type
  if (!AUDIENCE_TYPES.includes(obj.audience_type)) {
    errors.push(`audience_type must be one of ${AUDIENCE_TYPES.join(' | ')}, got: ${JSON.stringify(obj.audience_type)}`);
  }

  // reasoning_summary word count
  const reasoningWords = _wordCount(obj.reasoning_summary);
  if (typeof obj.reasoning_summary !== 'string' || obj.reasoning_summary.length === 0) {
    errors.push('reasoning_summary must be a non-empty string');
  } else if (reasoningWords > MAX_REASONING_WORDS) {
    errors.push(`reasoning_summary exceeds ${MAX_REASONING_WORDS} words (got ${reasoningWords})`);
  }

  // value_angle word count
  const valueWords = _wordCount(obj.value_angle);
  if (typeof obj.value_angle !== 'string') {
    errors.push('value_angle must be a string');
  } else if (valueWords > MAX_VALUE_ANGLE_WORDS) {
    errors.push(`value_angle exceeds ${MAX_VALUE_ANGLE_WORDS} words (got ${valueWords})`);
  }

  // do_not_reply_reason must be a string (may be empty)
  if (typeof obj.do_not_reply_reason !== 'string') {
    errors.push('do_not_reply_reason must be a string (may be empty)');
  }

  // Consistency: SKIP/MONITOR should have a non-empty do_not_reply_reason
  if (['SKIP', 'MONITOR'].includes(obj.decision) && typeof obj.do_not_reply_reason === 'string' && obj.do_not_reply_reason.trim() === '') {
    errors.push('do_not_reply_reason should be non-empty when decision is SKIP or MONITOR');
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a raw Claude response is a SKIP signal rather than JSON.
 * The reply prompt instructs Claude to return the literal string "SKIP" when
 * there is no credible value-add for the thread.
 *
 * @param   {string} raw - Raw text from the Claude response
 * @returns {boolean}
 */
function isSkipResponse(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  // Exact match or wrapped in quotes/backticks
  if (/^["'`]?SKIP["'`]?$/i.test(trimmed)) return true;
  // SKIP with no JSON object present — model declined with explanation
  if (/\bSKIP\b/i.test(trimmed) && !trimmed.includes('{')) return true;
  return false;
}

/**
 * Validate the output of the reply generator (reply.md → Claude → parsed JSON).
 *
 * Schema (matches reply.md exactly):
 *   primary_reply  — strongest useful answer (string)
 *   safer_reply    — less promotional alternative (string)
 *   why_it_works   — reviewer context, max 60 words (string)
 *   risk_notes     — reviewer risk flags, max 50 words (string)
 *   cta_present    — whether the model detected a CTA (boolean; true = hard error)
 *
 * Also checks:
 *   - No URLs in either reply (unless allow_links was true — not enforced here,
 *     caller is responsible for that flag; we always flag URLs as a safety net)
 *   - Jaccard similarity between primary and safer replies (must differ in angle)
 *   - cta_present=true is treated as a validation error (reply is unusable)
 *
 * @param   {any} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateGeneratedReplySet(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Result is not an object — expected reply schema or SKIP'] };
  }

  // primary_reply
  if (typeof obj.primary_reply !== 'string' || obj.primary_reply.trim().length === 0) {
    errors.push('primary_reply must be a non-empty string');
  } else if (/https?:\/\//i.test(obj.primary_reply)) {
    errors.push('primary_reply contains a URL — not allowed by default');
  }

  // safer_reply
  if (typeof obj.safer_reply !== 'string' || obj.safer_reply.trim().length === 0) {
    errors.push('safer_reply must be a non-empty string');
  } else if (/https?:\/\//i.test(obj.safer_reply)) {
    errors.push('safer_reply contains a URL — not allowed by default');
  }

  // why_it_works
  const whyWords = _wordCount(obj.why_it_works);
  if (typeof obj.why_it_works !== 'string' || obj.why_it_works.trim().length === 0) {
    errors.push('why_it_works must be a non-empty string');
  } else if (whyWords > MAX_WHY_IT_WORKS_WORDS) {
    errors.push(`why_it_works exceeds ${MAX_WHY_IT_WORKS_WORDS} words (got ${whyWords})`);
  }

  // risk_notes
  const riskWords = _wordCount(obj.risk_notes);
  if (typeof obj.risk_notes !== 'string' || obj.risk_notes.trim().length === 0) {
    errors.push('risk_notes must be a non-empty string');
  } else if (riskWords > MAX_RISK_NOTES_WORDS) {
    errors.push(`risk_notes exceeds ${MAX_RISK_NOTES_WORDS} words (got ${riskWords})`);
  }

  // cta_present — model self-reports whether a CTA slipped through; treat as hard error
  if (typeof obj.cta_present !== 'boolean') {
    errors.push('cta_present must be a boolean');
  } else if (obj.cta_present === true) {
    errors.push('cta_present=true — reply contains a call to action; discard or rewrite before using');
  }

  // Similarity check — primary and safer must differ in angle
  if (
    typeof obj.primary_reply === 'string' && obj.primary_reply.length > 0 &&
    typeof obj.safer_reply   === 'string' && obj.safer_reply.length > 0
  ) {
    const similarity = _jaccardWords(obj.primary_reply, obj.safer_reply);
    if (similarity > SIMILARITY_THRESHOLD) {
      errors.push(
        `primary_reply and safer_reply are too similar (${(similarity * 100).toFixed(0)}% word overlap)` +
        ` — they must differ in angle, not just phrasing`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the output of the posting guardrail (guardrail.md → Claude → parsed JSON).
 *
 * Checks:
 *   safe (boolean), decision (enum), failures and warnings (arrays),
 *   char_count (non-negative integer), summary (string ≤40 words).
 *   Also checks internal consistency (safe=false ↔ failures non-empty,
 *   APPROVE ↔ safe=true).
 *
 * @param   {any} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateGuardrailResult(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Result is not an object'] };
  }

  // safe
  if (typeof obj.safe !== 'boolean') {
    errors.push('safe must be a boolean');
  }

  // decision
  if (!GUARDRAIL_DECISIONS.includes(obj.decision)) {
    errors.push(`decision must be one of ${GUARDRAIL_DECISIONS.join(' | ')}, got: ${JSON.stringify(obj.decision)}`);
  }

  // failures
  if (!Array.isArray(obj.failures)) {
    errors.push('failures must be an array');
  }

  // warnings
  if (!Array.isArray(obj.warnings)) {
    errors.push('warnings must be an array');
  }

  // char_count
  if (!Number.isInteger(obj.char_count) || obj.char_count < 0) {
    errors.push('char_count must be a non-negative integer');
  }

  // summary
  const summaryWords = _wordCount(obj.summary);
  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) {
    errors.push('summary must be a non-empty string');
  } else if (summaryWords > MAX_SUMMARY_WORDS) {
    errors.push(`summary exceeds ${MAX_SUMMARY_WORDS} words (got ${summaryWords})`);
  }

  // Consistency checks
  const hasFailures = Array.isArray(obj.failures) && obj.failures.length > 0;

  if (obj.safe === true && hasFailures) {
    errors.push('safe=true but failures is non-empty — inconsistent');
  }
  if (obj.safe === false && !hasFailures) {
    errors.push('safe=false but failures is empty — must describe what failed');
  }
  if (obj.decision === 'APPROVE' && obj.safe !== true) {
    errors.push('decision=APPROVE requires safe=true');
  }
  if (obj.decision === 'BLOCK' && obj.safe !== false) {
    errors.push('decision=BLOCK requires safe=false');
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract JSON from a raw Claude response that may include markdown fences.
 * Returns the parsed object, or throws with a descriptive error.
 *
 * @param   {string} raw          - Raw text from Claude response
 * @param   {string} contextLabel - Used in the error message for traceability
 * @returns {any}
 */
function parseJson(raw, contextLabel = 'unknown') {
  // Try to extract a JSON block from markdown fences first
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : raw;

  // Fall back to scanning for the first { ... } block
  const objMatch = jsonStr.match(/(\{[\s\S]*\})/);
  const candidate = objMatch ? objMatch[1] : jsonStr;

  try {
    return JSON.parse(candidate.trim());
  } catch (e) {
    throw new Error(
      `[reddit/validators] Failed to parse JSON for "${contextLabel}": ${e.message}` +
      `\nRaw (first 300 chars): ${raw.slice(0, 300)}`
    );
  }
}

/** Count whitespace-delimited words in a string. */
function _wordCount(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Jaccard similarity on word sets.
 * Returns 0–1; higher means more similar.
 */
function _jaccardWords(a, b) {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

module.exports = {
  validateEvaluatorResult,
  validateGeneratedReplySet,
  validateGuardrailResult,
  parseJson,
  isSkipResponse,
  // Exported for testing
  _wordCount,
  _jaccardWords,
  // Enums exported so callers can reference without reimporting
  EVAL_DECISIONS,
  INTENT_TYPES,
  AUDIENCE_TYPES,
  GUARDRAIL_DECISIONS,
};
