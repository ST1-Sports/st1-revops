import { setCors } from './_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } };

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });

  const { channel, text, blocks } = req.body || {};
  if (!channel || !text) return res.status(400).json({ error: 'channel and text required' });

  const payload = { channel, text };
  if (blocks) payload.blocks = blocks;

  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!data.ok) {
    return res.status(400).json({ error: data.error || 'Slack API error', raw: data });
  }

  return res.status(200).json({ ok: true, ts: data.ts, channel: data.channel });
}
