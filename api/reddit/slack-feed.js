/**
 * GET /api/reddit/slack-feed
 *
 * Reads the #reddit Slack channel where the Perplexity Reddit Monitor posts
 * its daily digest, parses the thread entries, and returns them as structured
 * JSON for the RevOps Reddit Engagement page.
 *
 * Env vars required:
 *   SLACK_BOT_TOKEN               — bot token with channels:history scope
 *   REDDIT_SLACK_CHANNEL_ID       — defaults to C0B0LR03JSZ (#reddit)
 */

const { setCors } = require('../_lib/cors.js');

const CHANNEL_ID = process.env.REDDIT_SLACK_CHANNEL_ID || 'C0B0LR03JSZ';

async function slackHistory(channelId, limit = 60) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

  const url = `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=${limit}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!d.ok) throw new Error(`Slack API error: ${d.error}`);
  return d.messages || [];
}

function parseThreads(messages) {
  // Sort chronologically (oldest first) so numbered entries read in order
  const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  // Only grab messages that contain Reddit thread data or the run summary
  const relevant = sorted.filter(m =>
    m.text && (m.text.includes('r/') || m.text.includes('ST1 Reddit Monitor'))
  );

  const combined = relevant.map(m => m.text).join('\n');

  // Run metadata — most recent summary header
  const summaryMsg = messages
    .slice()
    .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts))
    .find(m => m.text && m.text.includes('ST1 Reddit Monitor') && m.text.includes('qualifying threads found'));

  const lastRunDate = summaryMsg
    ? new Date(parseFloat(summaryMsg.ts) * 1000).toISOString()
    : null;

  const runDescription = summaryMsg
    ? (summaryMsg.text.match(/—\s*(.+)$/m)?.[1] || '').trim()
    : '';

  // Parse each thread entry.
  // Perplexity format (Slack mrkdwn):
  //   _N. r/sub — Title_
  //   <https://url|Open thread>
  //   Paste this:
  //   ```reply text```
  const pattern = /_(\d+)\.\s+r\/([\w]+)\s+[—–]\s+(.+?)_\n<(https?:\/\/[^|>\s]+)\|Open thread>\nPaste this:\n```([\s\S]+?)```/g;

  const threads = [];
  let match;
  while ((match = pattern.exec(combined)) !== null) {
    threads.push({
      id:             match[1],
      subreddit:      `r/${match[2]}`,
      title:          match[3].trim(),
      url:            match[4].trim(),
      suggestedReply: match[5].trim(),
    });
  }

  return { threads, lastRunDate, runDescription };
}

module.exports = async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const messages = await slackHistory(CHANNEL_ID);
    const result   = parseThreads(messages);
    return res.status(200).json(result);
  } catch (e) {
    console.error('[reddit/slack-feed] error:', e.message);
    return res.status(500).json({ error: e.message, threads: [], lastRunDate: null, runDescription: '' });
  }
};
