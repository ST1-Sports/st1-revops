import { setCors } from './_lib/cors.js';
import {
  sendSlackText,
  loadSlackWebhook,
  saveSlackWebhook,
  clearSlackWebhook,
  formatSlackError,
} from './_lib/slack.js';
import { prisma } from './_lib/prisma.js';

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } };

async function slackStatus() {
  const token = process.env.SLACK_BOT_TOKEN;
  let auth = null;
  if (token) {
    const r = await fetch('https://slack.com/api/auth.test', {
      method:  'POST',
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
  const lastSlack = last?.output?.slack || null;
  return {
    ok: true,
    tokenConfigured: !!token,
    team: auth?.ok ? auth.team : null,
    webhookConfigured: !!webhook,
    lastReplySlack: lastSlack,
    lastReplyAt: last?.createdAt || null,
    lastReplyFrom: last?.input?.fromEmail || null,
    canPostViaApi: lastSlack === 'sent' || (auth?.ok && lastSlack && !String(lastSlack).includes('missing_scope')),
    hint: !token
      ? 'SLACK_BOT_TOKEN is not set.'
      : String(lastSlack || '').includes('missing_scope')
        ? 'The Slack app only has incoming-webhook. Add chat:write under OAuth & Permissions and reinstall, or paste the Incoming Webhook URL.'
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
    return res.status(200).json({ ok: true, webhookConfigured: true });
  }

  if (req.body?.action === 'clear-webhook') {
    await clearSlackWebhook();
    return res.status(200).json({ ok: true, webhookConfigured: false });
  }

  const token = process.env.SLACK_BOT_TOKEN;
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
