/**
 * Prompt template loader for the Reddit engagement module.
 *
 * Reads .md files from the ./prompts directory, splits them on the SYSTEM/USER
 * section markers, substitutes {{VARIABLE}} placeholders, and returns the
 * two-part object that Claude's messages.create expects:
 *
 *   { system: string, user: string }
 *
 * Template format:
 *
 *   SYSTEM
 *
 *   [system instructions — persona, rules, output schema]
 *
 *   USER
 *
 *   [user message — dynamic data with {{PLACEHOLDERS}}]
 *
 * Files without a USER marker are treated as user-only (system = '').
 * Files without a SYSTEM marker are also treated as user-only.
 *
 * Caching: file contents are cached in a module-level Map after the first read
 * so cold-start I/O is paid once per Vercel function instance.
 *
 * Variable validation: missing variables produce a console.warn and leave the
 * {{PLACEHOLDER}} in the output rather than silently substituting undefined.
 * This makes misconfigured calls visible in logs without crashing.
 */

const fs   = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

/** Module-level cache — survives within a single Vercel function instance. */
const _cache = new Map();

/**
 * Load a prompt template, substitute variables, and return system + user strings.
 *
 * @param {string}              name - Template name without .md extension
 * @param {Record<string,string>} vars - Substitution values for {{VARIABLE}} slots
 * @returns {{ system: string, user: string }}
 */
function load(name, vars = {}) {
  let raw = _cache.get(name);
  if (!raw) {
    const filePath = path.join(PROMPTS_DIR, `${name}.md`);
    raw = fs.readFileSync(filePath, 'utf8');
    _cache.set(name, raw);
  }

  const { system, user } = _split(raw);

  _warnMissing(name, system + '\n' + user, vars);

  return {
    system: _substitute(system, vars),
    user:   _substitute(user,   vars),
  };
}

/**
 * Clear the in-memory cache.
 * Use in tests to force re-reads after editing fixture files.
 */
function clearCache() {
  _cache.clear();
}

// ─── internal helpers ─────────────────────────────────────────────────────────

/**
 * Split a raw template string into system and user sections.
 * Looks for a line containing only "USER" (with optional surrounding whitespace).
 * Everything before that line, minus the "SYSTEM" header, becomes system.
 * Everything after becomes user.
 *
 * @param   {string} raw
 * @returns {{ system: string, user: string }}
 */
function _split(raw) {
  // Find "\nUSER\n" — USER on its own line with surrounding newlines
  const userMatch = raw.match(/\n[ \t]*USER[ \t]*\n/);

  if (!userMatch) {
    // No USER section — treat entire file as the user message
    const userOnly = raw.replace(/^[ \t]*SYSTEM[ \t]*\n/, '').trim();
    return { system: '', user: userOnly };
  }

  const userIdx = userMatch.index;                         // index of the \n before USER
  const userEnd = userIdx + userMatch[0].length;           // index of first char after USER\n

  const systemRaw = raw.slice(0, userIdx)
    .replace(/^[ \t]*SYSTEM[ \t]*\n/, '')                  // strip "SYSTEM" header line
    .trim();

  const userRaw = raw.slice(userEnd).trim();

  return { system: systemRaw, user: userRaw };
}

/**
 * Replace all {{KEY}} occurrences in text with the matching value from vars.
 * If a key is not found in vars, the placeholder is left unchanged.
 *
 * @param   {string}              text
 * @param   {Record<string,any>}  vars
 * @returns {string}
 */
function _substitute(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

/**
 * Log a warning for any {{PLACEHOLDER}} found in the combined template text
 * that has no matching key in vars.
 *
 * @param {string}              templateName
 * @param {string}              combinedText  - system + user before substitution
 * @param {Record<string,any>}  vars
 */
function _warnMissing(templateName, combinedText, vars) {
  const needed  = [...combinedText.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  const unique  = [...new Set(needed)];
  const missing = unique.filter(k => !(k in vars));
  if (missing.length > 0) {
    console.warn(
      `[prompt-loader] "${templateName}" has unresolved variables: ${missing.join(', ')}` +
      ` — placeholders will remain in the output`
    );
  }
}

module.exports = { load, clearCache };
