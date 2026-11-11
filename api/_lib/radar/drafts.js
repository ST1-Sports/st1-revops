/**
 * Generate a short in-thread reply in the rep's voice and push it as an unsent Gmail draft.
 * Never sends. Never invents prices / dates / ETAs / quantities.
 */
import { prisma } from '../prisma.js';
import { assertNoFabricatedFacts } from './draftGuard.js';
import {
  createThreadedDraft,
  encodeRawMime,
  getDefaultSignature,
  listRecentSent,
  refreshAccessToken,
  threadText,
} from './gmail.js';
import { emailedWithinBusinessDays, HOME_DOMAIN, parseEmail } from './filters.js';
import { activeProgramHooks } from './seed.js';
import { buildStyleProfile, stylePrompt } from './style.js';

const MODEL = process.env.RADAR_DRAFT_MODEL || 'claude-sonnet-4-20250514';

async function ensureStyleProfile(connection, accessToken) {
  const fresh = connection.styleProfileAt
    && (Date.now() - new Date(connection.styleProfileAt).getTime()) < 14 * 86400000
    && connection.styleProfile;
  if (fresh) return connection.styleProfile;
  const sent = await listRecentSent(accessToken, 30);
  const profile = buildStyleProfile(sent);
  await prisma.inboxConnection.update({
    where: { id: connection.id },
    data: { styleProfile: profile, styleProfileAt: new Date() },
  });
  return profile;
}

function relevantHooks(hooks, thread) {
  const blob = `${thread.subject || ''} ${threadText(thread)}`.toLowerCase();
  return (hooks || []).filter(h => {
    const keys = Array.isArray(h.keywords) ? h.keywords : [];
    if (!keys.length) return false;
    return keys.some(k => blob.includes(String(k).toLowerCase()));
  });
}

function replyTargets(thread, ownerEmail) {
  const owner = String(ownerEmail || '').toLowerCase();
  const last = thread.messages?.[thread.messages.length - 1];
  const lastFrom = parseEmail(last?.from || '').email;
  const to = [];
  const cc = [];
  const seen = new Set([owner]);

  function add(list, email) {
    const e = String(email || '').toLowerCase();
    if (!e || seen.has(e)) return;
    if (e.endsWith(`@${HOME_DOMAIN}`)) return;
    seen.add(e);
    list.push(e);
  }

  if (lastFrom && lastFrom !== owner) add(to, lastFrom);
  for (const e of last?.to || []) add(to.length ? cc : to, e);
  for (const e of last?.cc || []) add(cc, e);
  if (!to.length) {
    for (const m of [...(thread.messages || [])].reverse()) {
      const from = parseEmail(m.from).email;
      if (from && from !== owner && !from.endsWith(`@${HOME_DOMAIN}`)) {
        add(to, from);
        break;
      }
    }
  }
  return { to, cc, last };
}

async function writeDraftBody({ thread, item, style, hooks }) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_KEY not configured');
  const hookLines = hooks.length
    ? hooks.map(h => `- ${h.title}: ${h.body}`).join('\n')
    : '(none — do not invent a promotion)';
  const system = `You write a short in-thread Gmail reply for an ST1 Sports sales rep.
${stylePrompt(style)}
Rules:
- Reply in-thread. Do not add a subject line.
- NEVER invent prices, dates, stock ETAs, or quantities.
- If a fact is not explicitly in the thread, write a [BRACKETED PLACEHOLDER] such as [PRICE], [ETA], [QTY], [DATE].
- Only mention a program hook if it is clearly relevant to the products in this thread.
- Return ONLY JSON: { "body": string, "needsInput": boolean }
- needsInput must be true if you used any placeholder.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{
        role: 'user',
        content: [
          `Contact: ${item.contactName || ''} <${item.contactEmail || ''}>`,
          `Org: ${item.organization || ''} (${item.orgType || ''})`,
          `Deal context: ${item.dealContext || ''}`,
          `Open commitments: ${(item.openCommitments || []).join('; ') || 'none'}`,
          `Suggested next step: ${item.suggestedNextStep || ''}`,
          `Relevant program hooks:\n${hookLines}`,
          '',
          'FULL THREAD:',
          threadText(thread).slice(0, 12000),
        ].join('\n'),
      }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Claude ${r.status}`);
  const text = data.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed = {};
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = { body: text }; }
  let body = String(parsed.body || text).replace(/^```(?:text|json)?\s*|\s*```$/g, '').trim();
  const check = assertNoFabricatedFacts(body, threadText(thread));
  if (!check.ok) {
    // Strip invented facts by rewriting as placeholders rather than sending a lie.
    body = `${body}\n\n[REVIEW: remove unverified numbers — ${check.fabricated.join(', ')}]`;
  }
  const needsInput = check.needsInput || !check.ok || Boolean(parsed.needsInput);
  return { body, needsInput, fabricated: check.fabricated };
}

export async function createRadarDraft({ connection, item, thread, skipRecentCheck = false }) {
  if (!skipRecentCheck && emailedWithinBusinessDays(item.lastTouchAt, item.lastTouchBy, 3)) {
    return { skipped: true, reason: 'emailed_within_3_business_days' };
  }
  const accessToken = await refreshAccessToken(connection.encryptedRefreshToken);
  const style = await ensureStyleProfile(connection, accessToken);
  const hooks = relevantHooks(await activeProgramHooks(), thread);
  const { body, needsInput, fabricated } = await writeDraftBody({ thread, item, style, hooks });
  const sig = await getDefaultSignature(accessToken);
  const fullBody = sig.text ? `${body}\n\n${sig.text}` : body;
  const { to, cc, last } = replyTargets(thread, connection.email);
  if (!to.length) throw new Error('No external recipient to draft to');

  const subj = thread.subject || item.dealContext || '';
  const subject = /^re\s*:/i.test(subj) ? subj : `Re: ${subj || '(no subject)'}`;
  const inReplyTo = last?.messageIdHeader || '';
  const references = [last?.references, last?.messageIdHeader].filter(Boolean).join(' ').trim();

  const raw = encodeRawMime({
    From: connection.email,
    To: to.join(', '),
    Cc: cc.join(', '),
    Subject: subject,
    'In-Reply-To': inReplyTo,
    References: references,
  }, fullBody);

  const created = await createThreadedDraft(accessToken, { threadId: thread.id, raw });
  const log = await prisma.draftLog.create({
    data: {
      followUpItemId: item.id,
      gmailDraftId: created.id || created.message?.id || null,
      body: fullBody,
      needsInput,
    },
  });
  await prisma.followUpItem.update({
    where: { id: item.id },
    data: { needsInput },
  });
  const permalink = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(created.message?.id || created.id || '')}`;
  await prisma.followUpItem.update({
    where: { id: item.id },
    data: { gmailPermalink: `https://mail.google.com/mail/u/0/#inbox/${thread.id}` },
  });
  return {
    ok: true,
    draftId: created.id,
    messageId: created.message?.id || null,
    needsInput,
    fabricated,
    permalink,
    logId: log.id,
    skipped: false,
  };
}

export { ensureStyleProfile };
