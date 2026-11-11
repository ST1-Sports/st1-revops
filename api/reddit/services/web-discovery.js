/**
 * Reddit Engagement — thread discovery via Claude's native web_search tool.
 *
 * Replaces the old public-RSS-feed scraper (searchSubredditRSS, formerly in
 * rss-fetcher.js): Reddit's own search.rss, restricted to one subreddit and
 * a literal keyword match within the past month, returned almost nothing
 * for niche product/brand terms in low-traffic subreddits — and what did
 * come back was often an old, coincidental keyword match rather than a
 * genuinely current, relevant discussion. Claude's web_search tool searches
 * the real web (not just one subreddit's narrow internal search index), can
 * be told explicitly to prioritize recent activity, and judges relevance
 * semantically instead of by literal substring match.
 *
 * One Claude call covers every subreddit/keyword pair at once — the
 * web_search tool can be invoked many times per turn, up to max_uses —
 * rather than looping a separate request per pair.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function buildPrompt(pairs) {
  const topics = pairs.map(p => `- r/${p.sub}: "${p.kw}"`).join('\n');
  return `Search Reddit for genuinely CURRENT, ACTIVE discussions (posted within the last 2 weeks) matching these subreddit/topic pairs. ST1 Sports sells track & field, cross country, and multi-sport athletic equipment to US high schools and universities — you're looking for real buying-intent, problem, or competitor-mention threads a sales rep could genuinely add value to, not old resolved threads or coincidental keyword matches.

${topics}

For each pair, search the web (site:reddit.com plus the subreddit name and topic) and only include a thread if you actually found it in your search results, with a real URL. Skip a pair entirely rather than including a stale, off-topic, or resolved thread just to fill space.

Return ONLY a JSON array, no markdown fences, no other text:
[
  {
    "subreddit": "exact subreddit name, no r/ prefix",
    "title": "exact thread title",
    "url": "the real reddit.com URL from your search results",
    "author": "poster's username if visible, or null",
    "snippet": "1-3 sentence summary of what the post/discussion is actually about",
    "publishedAt": "an ISO date if you can tell, or null",
    "matchedQuery": "which topic above this came from"
  }
]

Never fabricate a URL, title, or author — only report what a real search result actually shows.`;
}

/**
 * @param {Array<{sub: string, kw: string}>} pairs
 * @returns {Promise<Array>} candidate threads in the same shape ingestion.js
 *   previously got from rss-fetcher's searchSubredditRSS
 */
async function discoverThreadsViaWebSearch(pairs) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    console.warn('[web-discovery] No ANTHROPIC_KEY — skipping discovery');
    return [];
  }
  if (!pairs.length) return [];

  let data;
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL_FOR_REDDIT_DISCOVERY || 'claude-sonnet-4-6',
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(20, Math.max(3, pairs.length * 2)) }],
        messages: [{ role: 'user', content: buildPrompt(pairs) }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      console.warn(`[web-discovery] Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return [];
    }
    data = await r.json();
  } catch (e) {
    console.warn('[web-discovery] request failed:', e.message);
    return [];
  }

  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let parsed = [];
  try {
    const match = textBlocks.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn('[web-discovery] failed to parse Claude response:', e.message);
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(t => t && typeof t.url === 'string' && t.url.includes('reddit.com/r/') && t.url.includes('/comments/'))
    .map(t => ({
      redditId:     t.url.replace(/.*comments\/([^/]+).*/, 't3_$1'),
      title:        String(t.title || '').trim(),
      url:          t.url.split('?')[0],
      author:       t.author ? String(t.author).replace(/^\/?u\//, '') : '[unknown]',
      subreddit:    String(t.subreddit || '').replace(/^r\//, '').trim(),
      score:        0,
      scoreKnown:   false, // web search doesn't reliably surface an upvote count
      commentCount: 0,
      body:         String(t.snippet || '').trim(),
      publishedAt:  t.publishedAt || null,
    }))
    .filter(t => t.title && t.subreddit);
}

module.exports = { discoverThreadsViaWebSearch };
