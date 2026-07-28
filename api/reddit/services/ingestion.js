/**
 * Reddit Engagement — thread ingestion via public RSS feeds.
 *
 * No Reddit API key required. Uses Reddit's public search RSS feeds
 * combined with AI-generated search queries to discover relevant threads.
 */

const { searchSubredditRSS } = require('./rss-fetcher');
const { checkGuardrails }    = require('./db-guardrails');


/**
 * Ingest candidate threads via RSS.
 *
 * @param {Object} flags
 * @param {Object} [overrides]   - { subreddits?: string[], keywords?: string[] }
 * @param {boolean} [dryRun]
 */
async function ingestThreads(flags, overrides = {}, dryRun = false) {
  const envSubreddits = (process.env.REDDIT_TARGET_SUBREDDITS || 'trackandfield,CrossCountry,HS_Cross_Country,Coaching,HighSchoolSports')
    .split(',').map(s => s.trim()).filter(Boolean);
  const envKeywords = (process.env.REDDIT_BRAND_KEYWORDS || 'track equipment,timing system,athletic director equipment')
    .split(',').map(k => k.trim()).filter(Boolean);

  const subreddits = overrides.subreddits?.length ? overrides.subreddits : envSubreddits;
  const keywords   = overrides.keywords?.length   ? overrides.keywords   : envKeywords;

  const seen = new Set();
  const candidates = [];
  const db = dryRun ? null : getPrisma();

  // Search each subreddit × keyword pair (capped at 20 pairs to stay under timeout)
  const pairs = [];
  for (const sub of subreddits) {
    for (const kw of keywords) {
      pairs.push({ sub, kw });
      if (pairs.length >= 20) break;
    }
    if (pairs.length >= 20) break;
  }

  for (const { sub, kw } of pairs) {
    let results;
    try {
      results = await searchSubredditRSS(sub, kw, 15);
    } catch (e) {
      console.error(`[ingestion] RSS error r/${sub} "${kw}":`, e.message);
      continue;
    }

    for (const thread of results) {
      if (seen.has(thread.redditId)) continue;
      seen.add(thread.redditId);

      // DB guardrail: dedup, mute list, etc.
      const guardrail = await checkGuardrails(thread, flags).catch(() => ({
        pass: false, failures: ['Guardrail error'], isDuplicate: false,
      }));

      if (!guardrail.pass) {
        if (!guardrail.isDuplicate) {
          candidates.push({ thread, status: 'skipped', reasons: guardrail.failures });
        }
        continue;
      }

      if (!dryRun) {
        await db.redditThread.create({
          data: {
            redditId:     thread.redditId,
            subreddit:    thread.subreddit,
            title:        thread.title,
            body:         thread.body || '',
            url:          thread.url,
            author:       thread.author,
            score:        thread.score || 0,
            commentCount: thread.commentCount || 0,
            status:       'PENDING',
          },
        }).catch(e => {
          if (!e.message.includes('Unique constraint')) {
            console.error('[ingestion] DB write error:', e.message);
          }
        });
      }

      candidates.push({ thread, status: 'ingested' });
    }
  }

  return {
    ingested: candidates.filter(c => c.status === 'ingested').length,
    skipped:  candidates.filter(c => c.status === 'skipped').length,
    threads:  candidates,
  };
}

module.exports = { ingestThreads };
