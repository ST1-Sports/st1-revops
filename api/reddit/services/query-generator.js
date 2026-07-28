/**
 * Reddit Engagement — AI-powered search query generator.
 *
 * Uses Claude to generate diverse, contextually relevant Reddit search queries
 * rather than relying on static env var keywords. This finds threads that
 * fixed keyword lists would miss (buying intent, competitor mentions, etc.)
 */

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_QUERIES = [
  { subreddit: 'trackandfield',         query: 'equipment recommendation' },
  { subreddit: 'CrossCountry',          query: 'timing system' },
  { subreddit: 'HS_Cross_Country',      query: 'where to buy equipment' },
  { subreddit: 'Coaching',              query: 'track field equipment purchase' },
  { subreddit: 'HighSchoolSports',      query: 'athletic director equipment' },
  { subreddit: 'SportsBusiness',        query: 'school sports equipment budget' },
  // Competitor monitoring — complaints, comparisons, alternatives
  { subreddit: 'HighSchoolSports',      query: 'BSN Sports' },
  { subreddit: 'Coaching',              query: 'BSN Sports shipping' },
  { subreddit: 'trackandfield',         query: 'Gopher Sport' },
  { subreddit: 'HighSchoolSports',      query: 'Dick\'s Sporting Goods team order' },
  { subreddit: 'Coaching',              query: 'VS Athletics MF Athletic' },
];

/**
 * Use Claude to generate fresh, targeted Reddit search queries.
 *
 * @returns {Promise<Array<{subreddit: string, query: string}>>}
 */
async function generateSearchQueries() {
  const apiKey = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[query-generator] No Anthropic key — using default queries');
    return DEFAULT_QUERIES;
  }

  const client = new Anthropic({ apiKey });

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `ST1 Sports sells track & field timing systems, cross country equipment, pole vault / high jump gear, throws equipment (javelin/discus/shot put), and multi-sport athletic equipment to high schools and universities in the US.

Key competitors: BSN Sports, Gopher Sport, Dick's Sporting Goods, VS Athletics, MF Athletic, School Specialty, Epic Sports, SquadLocker.

Generate 18 Reddit search query pairs. Mix two types:

TYPE A — Buying intent / topical (12 queries):
- Buying intent ("looking for", "recommendations", "best X for")
- Budget / purchasing ("where do schools buy", "AD purchasing")
- Problems / complaints about equipment
- Specific event equipment (pole vault, timing, throws, cross country)

TYPE B — Competitor monitoring (6 queries):
- Direct competitor name searches: people complaining about a competitor, asking for alternatives, comparing options
- Use the competitor names above; vary across subreddits
- Examples: "BSN Sports", "Gopher Sport alternative", "Dick's team order problems", "VS Athletics review"

Target subreddits: trackandfield, CrossCountry, HS_Cross_Country, running, athletics, Coaching, HighSchoolSports, physed, polevault, AmateurCompetitionAthletics, SportsBusiness, Teachers

Return ONLY a JSON array, no explanation:
[{"subreddit":"trackandfield","query":"best timing system high school track meet"},...]`,
      }],
    });
  } catch (e) {
    console.error('[query-generator] Claude call failed:', e.message);
    return DEFAULT_QUERIES;
  }

  const raw = message.content?.[0]?.text || '';
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : [];
    // Validate shape and dedupe
    const seen = new Set();
    return parsed.filter(q => {
      if (!q?.subreddit || !q?.query) return false;
      const key = `${q.subreddit}:${q.query}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (e) {
    console.error('[query-generator] failed to parse Claude response:', e.message);
    return DEFAULT_QUERIES;
  }
}

module.exports = { generateSearchQueries };
