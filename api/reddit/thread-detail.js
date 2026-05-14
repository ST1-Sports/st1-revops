/**
 * GET /api/reddit/thread-detail?url={reddit_thread_url}
 *
 * Fetches a Reddit thread's post body and top comments via Reddit's public
 * JSON API (no OAuth required for public threads). Used by the RevOps Reddit
 * Engagement page to show thread context alongside the Perplexity-suggested reply.
 */

const { setCors } = require('../_lib/cors.js');

module.exports = async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param is required' });

  try {
    const jsonUrl = url.replace(/\/$/, '') + '.json?limit=10&raw_json=1';
    const r = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'ST1RevOps/1.0 (internal sales tool; contact sales@st1sports.com)',
        Accept: 'application/json',
      },
    });

    if (!r.ok) {
      return res.status(200).json({ title: '', body: '', topComments: [], fetchError: `Reddit ${r.status}` });
    }

    const data = await r.json();

    const post     = data[0]?.data?.children?.[0]?.data || {};
    const comments = data[1]?.data?.children || [];

    const topComments = comments
      .filter(c => c.kind === 't1' && c.data?.body && c.data.body !== '[deleted]' && c.data.body !== '[removed]')
      .slice(0, 6)
      .map(c => ({
        author: c.data.author,
        body:   c.data.body,
        score:  c.data.score,
      }));

    return res.status(200).json({
      title:        post.title          || '',
      subreddit:    post.subreddit      || '',
      body:         post.selftext       || '',
      score:        post.score          || 0,
      commentCount: post.num_comments   || 0,
      topComments,
    });
  } catch (e) {
    console.error('[reddit/thread-detail] error:', e.message);
    return res.status(200).json({ title: '', body: '', topComments: [], fetchError: e.message });
  }
};
