/**
 * Central API client for ST1 RevOps
 * Proxies all Claude API requests through /api/claude (Vercel Edge Function)
 * so the ANTHROPIC_KEY is never exposed to the browser.
 */

const API_ENDPOINT = '/api/claude';

/**
 * Send a message to Claude via the server-side proxy.
 * @param {Object} body - Full Anthropic messages API request body
 * @returns {Promise<Object>} Anthropic API response JSON
 */
export async function callClaude(body) {
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Convenience wrapper: single user message, returns assistant text.
 * @param {string} prompt
 * @param {Object} options - model, max_tokens, system, tools
 * @returns {Promise<string>}
 */
export async function askClaude(prompt, options = {}) {
  const {
    model = 'claude-sonnet-4-20250514',
    max_tokens = 1024,
    system,
    tools,
  } = options;

  const body = {
    model,
    max_tokens,
    messages: [{ role: 'user', content: prompt }],
  };

  if (system) body.system = system;
  if (tools) body.tools = tools;

  const data = await callClaude(body);
  const block = data.content?.find(b => b.type === 'text');
  return block?.text ?? '';
}
