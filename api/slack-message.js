import { setCors } from './_lib/cors.js';
import {
  sendSlackText,
  loadSlackWebhook,
  saveSlackWebhook,
  clearSlackWebhook,
  formatSlackError,
  loadSlackBotToken,
  failedBradSlackRows,
} from './_lib/slack.js';
import { replayFailedBradSlack } from './_lib/bradSlackReplay.js';
import { prisma } from './_lib/prisma.js';

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } };

async function slackStatus() {
  const token = await loadSlackBotToken();
  let auth = null;
  if (token) {
    const r = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    });
    auth = await r.json().catch(() => ({ ok: false }));
  }
  const webhook = await loadSlackWebhook();
  const last = await prisma.agentInteraction.findFirst({
    where: { agentId: 'brad', action: 'reply_intent' },
    orderBy: { createdAt: 'desc' },
    select: { output: true, createdAt: true, input: true },
  }).catch(() => null);
  const recent = await prisma.agentInteraction.findMany({
    where: { agentId: 'brad', action: 'reply_intent' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { output: true },
  }).catch(() => []);
  const lastSlack = last?.output?.slack || null;
  const failedCount = failedBradSlackRows(recent).length;
  return {
    ok: true,
    tokenConfigured: !!token,
    team: auth?.ok ? auth.team : null,
    webhookConfigured: !!webhook,
    oauthConfigured: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
    failedBradSlack: failedCount,
    lastReplySlack: lastSlack,
    lastReplyAt: last?.createdAt || null,
    lastReplyFrom: last?.input?.fromEmail || null,
    canPostViaApi: lastSlack === 'sent' || (auth?.ok && lastSlack && !String(lastSlack).includes('missing_scope')),
    hint: !token
      ? 'SLACK_BOT_TOKEN is not set.'
      : !webhook && String(lastSlack || '').includes('missing_scope')
        ? 'Slack cannot post with the current app token. Paste an Incoming Webhook URL below (or on the Brad tab) — failed reply alerts will send immediately.'
        : null,
  };
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' || req.body?.action === 'status') {
    try {
      return res.status(200).json(await slackStatus());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.body?.action === 'save-webhook') {
    const result = await saveSlackWebhook(req.body?.url);
    if (!result.ok) return res.status(400).json(result);
    const replay = await replayFailedBradSlack({ limit: 25 });
    return res.status(200).json({ ok: true, webhookConfigured: true, replayed: replay.replayed, remaining: replay.remaining });
  }

  if (req.body?.action === 'clear-webhook') {
    await clearSlackWebhook();
    return res.status(200).json({ ok: true, webhookConfigured: false });
  }

  if (req.body?.action === 'replay-failed') {
    const replay = await replayFailedBradSlack({ limit: 25 });
    if (!replay.ok && replay.error) return res.status(400).json(replay);
    return res.status(200).json(replay);
  }

  const token = await loadSlackBotToken();
  const webhook = await loadSlackWebhook();
  if (!token && !webhook) return res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });

  const { channel, text, blocks } = req.body || {};
  if (!channel || !text) return res.status(400).json({ error: 'channel and text required' });

  const result = await sendSlackText({ channel, text, blocks });
  if (!result.ok) {
    return res.status(400).json({
      error: result.error || formatSlackError(result) || 'Slack API error',
      raw: result,
    });
  }

  return res.status(200).json({ ok: true, ts: result.ts, channel: result.channel, via: result.via });
}
