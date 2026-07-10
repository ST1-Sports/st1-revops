/**
 * Reddit thread discovery via public RSS feeds.
 *
 * Reddit's OAuth API is no longer freely available, but their public RSS
 * search feeds still work. No API key required.
 *
 * Feed URL pattern:
 *   https://www.reddit.com/r/{sub}/search.rss?q={query}&sort=new&t=month&restrict_sr=1
 */

const USER_AGENT = 'ST1RevOps/1.0 (+https://revops.st1sports.com)';

/**
 * Search a subreddit via RSS feed.
 *
 * @param {string} subreddit  - Subreddit name without r/
 * @param {string} query      - Search query
 * @param {number} [limit]    - Max results (Reddit caps at 25)
 * @returns {Promise<Array<{title,url,author,subreddit,score,commentCount,publishedAt}>>}
 */
async function searchSubredditRSS(subreddit, query, limit = 15) {
  const url = `https://www.reddit.com/r/${subreddit}/search.rss?q=${encodeURIComponent(query)}&sort=new&t=month&restrict_sr=1&limit=${Math.min(limit, 25)}`;

  let xml;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[rss-fetcher] r/${subreddit} "${query}" → HTTP ${r.status}`);
      return [];
    }
    xml = await r.text();
  } catch (e) {
    console.warn(`[rss-fetcher] r/${subreddit} "${query}" fetch error:`, e.message);
    return [];
  }

  return parseAtomFeed(xml, subreddit);
}

/**
 * Fetch the "hot" posts from a subreddit (no query needed).
 */
async function fetchSubredditHot(subreddit, limit = 10) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.rss?limit=${Math.min(limit, 25)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseAtomFeed(xml, subreddit);
  } catch {
    return [];
  }
}

// ── RSS / Atom parser ─────────────────────────────────────────────────────────

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? m[1].trim() : '';
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

function parseAtomFeed(xml, subreddit) {
  const results = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;

  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    const title = extractTag(entry, 'title');
    const link  = extractAttr(entry, 'link', 'href') || extractTag(entry, 'id');
    const author = extractTag(entry, 'name').replace(/^\/u\//, '');
    const published = extractTag(entry, 'published') || extractTag(entry, 'updated');

    // Pull score and comment count from the HTML content block
    const content = extractTag(entry, 'content') || '';
    const scoreM  = content.match(/(\d+)\s+point/i);
    const commM   = content.match(/(\d+)\s+comment/i);

    // Only include actual reddit.com thread links
    if (!title || !link.includes('reddit.com/r/')) continue;
    // Skip cross-posts that match the subreddit pattern but are in a different sub
    if (!link.toLowerCase().includes(subreddit.toLowerCase())) continue;

    results.push({
      redditId:     link.replace(/.*comments\/([^/]+).*/, 't3_$1'),
      title:        title,
      url:          link.split('?')[0], // strip tracking params
      author:       author || '[deleted]',
      subreddit:    subreddit,
      score:        scoreM ? parseInt(scoreM[1], 10) : 0,
      commentCount: commM  ? parseInt(commM[1],  10) : 0,
      body:         '',  // RSS doesn't include body text
      publishedAt:  published,
    });
  }

  return results;
}

module.exports = { searchSubredditRSS, fetchSubredditHot };
