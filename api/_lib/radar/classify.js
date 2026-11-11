/**
 * Claude classification for Follow-Up Radar threads that survived hard filters.
 */
import { parseEmail } from './filters.js';

const MODEL = process.env.RADAR_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM = `You classify sales email threads for ST1 Sports (athletic equipment / team apparel distributor).
Return ONLY JSON with this shape:
{
  "bucket": "owes_reply" | "awaiting_them" | "closed_won" | "closed_lost" | "fulfillment",
  "contactName": string,
  "contactEmail": string,
  "organization": string,
  "orgType": "school" | "little_league" | "club" | "partner" | "other",
  "intentScore": 0-100,
  "dealContext": "one sentence: what's on the table — quote #, product, $ if stated",
  "openCommitments": ["things WE promised, e.g. send pricing"],
  "lastTouchBy": "us" | "them",
  "suggestedNextStep": string
}
Rules:
- owes_reply = they wrote last and expect something from us.
- awaiting_them = we wrote last, positive intent exists, no response yet.
- closed_lost = they declined ("we're set", "not this year", "going with someone else").
- closed_won = they placed / confirmed an order as a sale.
- fulfillment = active order logistics (POs, shipping, invoices) — not sales.
- contactEmail must be the external (non-st1sports.com) party.
- intentScore is 0-100 genuine buying interest. Logistics-only is low.
- Do not invent quote numbers, prices, or product names that are not in the thread.`;

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : raw;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return null;
  }
}

const BUCKETS = new Set(['owes_reply', 'awaiting_them', 'closed_won', 'closed_lost', 'fulfillment']);
const ORG_TYPES = new Set(['school', 'little_league', 'club', 'partner', 'other']);

export function normalizeClassification(parsed, thread, ownerEmail) {
  const last = thread.messages?.[thread.messages.length - 1];
  const lastFrom = parseEmail(last?.from || '').email;
  const owner = String(ownerEmail || '').toLowerCase();
  const inferredLastBy = lastFrom && lastFrom === owner ? 'us' : 'them';

  const externals = [];
  for (const m of thread.messages || []) {
    const from = parseEmail(m.from);
    if (from.email && !from.email.endsWith('@st1sports.com') && from.email !== owner) {
      externals.push(from);
    }
  }
  const fallback = externals[externals.length - 1] || {};

  const bucket = BUCKETS.has(parsed?.bucket) ? parsed.bucket : (inferredLastBy === 'them' ? 'owes_reply' : 'awaiting_them');
  const lastTouchBy = parsed?.lastTouchBy === 'us' || parsed?.lastTouchBy === 'them' ? parsed.lastTouchBy : inferredLastBy;
  const lastTouchAt = last?.internalDate ? new Date(last.internalDate) : new Date();
  const daysSinceLastTouch = Math.max(0, Math.floor((Date.now() - lastTouchAt.getTime()) / 86400000));

  return {
    bucket,
    contactName: String(parsed?.contactName || fallback.name || fallback.email || '').slice(0, 200),
    contactEmail: String(parsed?.contactEmail || fallback.email || '').toLowerCase().slice(0, 200),
    organization: String(parsed?.organization || '').slice(0, 200),
    orgType: ORG_TYPES.has(parsed?.orgType) ? parsed.orgType : 'other',
    intentScore: Math.max(0, Math.min(100, Number(parsed?.intentScore) || 0)),
    dealContext: String(parsed?.dealContext || '').slice(0, 400),
    openCommitments: Array.isArray(parsed?.openCommitments)
      ? parsed.openCommitments.map(s => String(s).slice(0, 200)).slice(0, 8)
      : [],
    lastTouchAt,
    lastTouchBy,
    daysSinceLastTouch,
    suggestedNextStep: String(parsed?.suggestedNextStep || '').slice(0, 400),
  };
}

export async function classifyThread(thread, { ownerEmail } = {}) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_KEY not configured');

  const transcript = (thread.messages || []).map(m => {
    const who = parseEmail(m.from).email || m.from;
    const when = m.internalDate ? new Date(m.internalDate).toISOString() : '';
    return `From: ${who}\nDate: ${when}\n${(m.body || '').slice(0, 2500)}`;
  }).join('\n\n----\n\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Our mailbox: ${ownerEmail}\nSubject: ${thread.subject || ''}\n\nFULL THREAD:\n${transcript.slice(0, 14000)}`,
      }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Claude ${r.status}`);
  const parsed = extractJson(data.content?.[0]?.text || '');
  return normalizeClassification(parsed || {}, thread, ownerEmail);
}
