/**
 * AI Router — classifies a user task and dispatches to the right plugin.
 *
 * Uses claude-haiku for fast/cheap single-token classification, then delegates
 * to the matching plugin from the registry. Falls back to "general" (Claude)
 * if no plugin is found for the classified capability or user role.
 */

import { getPlugin } from './plugins/index.js'

const IS_DEV   = typeof import.meta !== 'undefined' && import.meta.env?.DEV
const DEV_KEY  = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_ANTHROPIC_KEY || '') : ''
const ENDPOINT = IS_DEV ? 'https://api.anthropic.com/v1/messages' : '/api/claude'

const VALID_SLUGS = new Set([
  'copy', 'quote', 'finance', 'email', 'social', 'image',
  'research', 'web-search', 'competitor-intel', 'code-execution',
  'video-clips', 'database', 'workflow', 'general',
  'prospecting', 'outreach', 'invoice', 'reconcile', 'vendor-bill', 'payments',
  'forecast', 'health', 'digest', 'ask',
])

const TEXT_CAPABILITIES = new Set([
  'copy', 'quote', 'finance', 'email', 'social', 'general',
])

const CLASSIFIER_SYSTEM =
  'You are a task classifier. Given a user task description, return ' +
  'ONLY a single capability slug from this list: copy, quote, finance, email, ' +
  'social, image, research, web-search, competitor-intel, code-execution, ' +
  'video-clips, database, workflow, general, prospecting, outreach, invoice, reconcile, vendor-bill, payments, ' +
  'forecast, health, digest, ask. ' +
  'Return nothing else. ' +
  'Use "prospecting" for finding leads, ranking contacts, or deciding who to contact next. ' +
  'Use "outreach" for bulk outreach drafting or campaign-like sales development tasks. ' +
  'Use "invoice" for creating invoices from won deals or CRM deal-won events. ' +
  'Use "reconcile" for matching bank deposits, /reconcile commands, or deposit review. ' +
  'Use "vendor-bill" for processing vendor invoices, /bill commands, or mapping supplier bills. ' +
  'Use "payments" for checking invoice payment status, overdue invoices, upcoming due dates, or payment reminders. ' +
  'Use "forecast" for revenue/cash projections ("what will revenue look like next quarter"). ' +
  'Use "digest" for weekly/monthly financial summary or rollup requests. ' +
  'Use "health" for a broad "how is the business/financials doing overall" question. ' +
  'Use "ask" for any other specific question about ST1\'s actual financial data — cash position, ' +
  'AR/AP, margin, pipeline, customer payment reliability, vendor spend. Annie has live data for ' +
  'forecast/health/digest/ask — prefer these over "finance" whenever the question is about our ' +
  'real numbers. Reserve "finance" for generic financial writing not about our specific data ' +
  '(e.g. drafting an explainer paragraph about financial concepts).'

async function classify(task) {
  const headers = { 'Content-Type': 'application/json' }
  if (IS_DEV && DEV_KEY) {
    headers['x-api-key']         = DEV_KEY
    headers['anthropic-version'] = '2023-06-01'
  }

  const r = await fetch(ENDPOINT, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 20,
      system:     CLASSIFIER_SYSTEM,
      messages:   [{ role: 'user', content: task }],
    }),
  })

  if (!r.ok) throw new Error(`AI Router classify failed (${r.status})`)

  const d    = await r.json()
  const slug = (d.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
    .toLowerCase()

  return VALID_SLUGS.has(slug) ? slug : 'general'
}

function resolvePlugin(capability, userRole) {
  return getPlugin(capability, userRole) ?? getPlugin('general', userRole)
}

function normalise(raw) {
  if (raw == null)              return { output: '',       metadata: {} }
  if (typeof raw === 'string')  return { output: raw,      metadata: {} }
  return {
    output:   raw.output   ?? '',
    metadata: raw.metadata ?? {},
  }
}

/**
 * Route a task to the best-matching plugin and return the full result.
 *
 * @param {object} params
 * @param {string} params.task      - Natural-language description of the task
 * @param {*}      params.input     - Structured input passed to the plugin handler
 * @param {string} [params.userRole="sales_rep"] - Role used to filter plugins
 * @returns {Promise<{ output, metadata, pluginUsed: string, capability: string }>}
 */
export async function routeTask({ task, input, userRole = 'sales_rep' }) {
  const capability = await classify(task)
  const plugin     = resolvePlugin(capability, userRole)
  const raw        = await plugin.handler(task, input)
  const { output, metadata } = normalise(raw)
  return { output, metadata, pluginUsed: plugin.id, capability }
}

/**
 * Route a task and stream the response for text-based capabilities.
 * Yields `{ text, done, pluginUsed, capability, metadata? }` objects.
 *
 * Text capabilities (streamed): copy, quote, finance, email, social, general.
 * Other capabilities: executed normally, result yielded as a single done chunk.
 *
 * Plugin handlers may return:
 *   - AsyncIterable  → chunks forwarded directly
 *   - ReadableStream → chunks decoded and forwarded
 *   - Promise        → awaited and yielded as one shot
 *
 * @param {object} params
 * @param {string} params.task
 * @param {*}      params.input
 * @param {string} [params.userRole="sales_rep"]
 * @returns {AsyncGenerator<{ text: string, done: boolean, pluginUsed: string, capability: string, metadata?: object }>}
 */
export async function* routeTaskStream({ task, input, userRole = 'sales_rep' }) {
  const capability = await classify(task)
  const plugin     = resolvePlugin(capability, userRole)

  // Non-text capabilities don't stream — execute and yield once
  if (!TEXT_CAPABILITIES.has(capability)) {
    const raw              = await plugin.handler(task, input)
    const { output, metadata } = normalise(raw)
    yield { text: output, done: true, pluginUsed: plugin.id, capability, metadata }
    return
  }

  const pending = plugin.handler(task, input)

  // Async-iterable handler (generator or SSE wrapper)
  if (pending != null && typeof pending[Symbol.asyncIterator] === 'function') {
    for await (const chunk of pending) {
      yield {
        text:       typeof chunk === 'string' ? chunk : (chunk.text ?? ''),
        done:       false,
        pluginUsed: plugin.id,
        capability,
      }
    }
    yield { text: '', done: true, pluginUsed: plugin.id, capability, metadata: {} }
    return
  }

  // ReadableStream handler (browser fetch stream)
  if (typeof ReadableStream !== 'undefined' && pending instanceof ReadableStream) {
    const reader  = pending.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield { text: decoder.decode(value), done: false, pluginUsed: plugin.id, capability }
    }
    yield { text: '', done: true, pluginUsed: plugin.id, capability, metadata: {} }
    return
  }

  // Regular Promise — await and yield in one shot
  const raw              = await pending
  const { output, metadata } = normalise(raw)
  yield { text: output, done: true, pluginUsed: plugin.id, capability, metadata }
}
