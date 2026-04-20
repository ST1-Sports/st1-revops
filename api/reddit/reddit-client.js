/**
 * Reddit API client.
 *
 * Handles OAuth2 token exchange and provides thin wrappers around the Reddit
 * REST API endpoints needed by this module. All requests use the OAuth base URL
 * (oauth.reddit.com) as required for authenticated calls.
 *
 * Rate limits (Reddit API):
 *   - Authenticated: 60 requests/minute (tracked via X-Ratelimit-* headers)
 *   - Unauthenticated: 10 requests/minute (not used here)
 *
 * This client does NOT cache access tokens across Vercel function invocations
 * (serverless = stateless). Each handler call fetches a fresh token. Reddit
 * access tokens last 1 hour, so this is slightly wasteful but safe and simple.
 * A future improvement can cache in a Setting row via Prisma.
 */

const REDDIT_API   = 'https://oauth.reddit.com';
const REDDIT_TOKEN = 'https://www.reddit.com/api/v1/access_token';

/**
 * Exchange the stored refresh token for a short-lived access token.
 * Uses "refresh_token" grant when a refresh token is present (posting scope),
 * falls back to "client_credentials" for read-only ingestion.
 *
 * @returns {Promise<string>} Bearer access token
 */
async function getAccessToken() {
  const {
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_REFRESH_TOKEN,
    REDDIT_USER_AGENT,
  } = process.env;

  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
    throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required');
  }

  const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const hasRefreshToken = Boolean(REDDIT_REFRESH_TOKEN);

  const body = new URLSearchParams(
    hasRefreshToken
      ? { grant_type: 'refresh_token', refresh_token: REDDIT_REFRESH_TOKEN }
      : { grant_type: 'client_credentials' }
  );

  const res = await fetch(REDDIT_TOKEN, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT || 'ST1RevOps/1.0',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/**
 * Make an authenticated request to the Reddit API.
 *
 * @param {string} path     - API path, e.g. "/r/hockey/search"
 * @param {string} method   - HTTP method
 * @param {Object} [params] - Query params (GET) or body fields (POST)
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
async function redditRequest(path, method = 'GET', params = {}) {
  const token = await getAccessToken();
  const userAgent = process.env.REDDIT_USER_AGENT || 'ST1RevOps/1.0';

  let url = `${REDDIT_API}${path}`;
  let bodyStr;
  let headers = {
    'Authorization': `Bearer ${token}`,
    'User-Agent': userAgent,
  };

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyStr = new URLSearchParams(params).toString();
  }

  const res = await fetch(url, { method, headers, body: bodyStr });
  let data;
  try { data = await res.json(); } catch { data = null; }

  return { ok: res.ok, status: res.status, data };
}

/**
 * Search a subreddit for posts matching a query.
 *
 * @param {string} subreddit - Subreddit name without r/
 * @param {string} query     - Search query
 * @param {number} [limit]   - Max results (1–100, default 25)
 * @returns {Promise<import('./types').CandidateThread[]>}
 */
async function searchSubreddit(subreddit, query, limit = 25) {
  const { ok, status, data } = await redditRequest(`/r/${subreddit}/search`, 'GET', {
    q: query,
    restrict_sr: 'true',
    sort: 'new',
    t: 'week',
    limit: String(Math.min(limit, 100)),
    raw_json: '1',
  });

  if (!ok) {
    throw new Error(`Reddit search failed (${status}) for r/${subreddit}: ${JSON.stringify(data)}`);
  }

  const posts = data?.data?.children || [];
  return posts.map(child => normaliseListing(child.data));
}

/**
 * Fetch the full detail of a single post by its Reddit thing ID.
 *
 * @param {string} thingId - e.g. "t3_abc123" or just "abc123"
 * @returns {Promise<import('./types').CandidateThread>}
 */
async function getThread(thingId) {
  const id = thingId.replace(/^t3_/, '');
  const { ok, status, data } = await redditRequest(`/comments/${id}`, 'GET', {
    raw_json: '1',
    limit: '1',
  });

  if (!ok) {
    throw new Error(`Reddit getThread failed (${status}) for ${thingId}`);
  }

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error(`Reddit getThread: no post data for ${thingId}`);
  return normaliseListing(post);
}

/**
 * Post a top-level comment on a Reddit thread.
 * The caller is responsible for ensuring REDDIT_POSTING_ENABLED is true.
 *
 * @param {string} thingId - Parent thing ID, e.g. "t3_abc123"
 * @param {string} text    - Comment markdown text
 * @returns {Promise<import('./types').PostingResult>}
 */
async function postComment(thingId, text) {
  const { ok, status, data } = await redditRequest('/api/comment', 'POST', {
    thing_id: thingId,
    text,
    api_type: 'json',
  });

  const errors = data?.json?.errors;
  if (errors && errors.length > 0) {
    return {
      ok: false,
      httpStatus: status,
      wasDisabled: false,
      error: errors.map(e => e.join(': ')).join('; '),
    };
  }

  const commentData = data?.json?.data?.things?.[0]?.data;
  return {
    ok: ok && Boolean(commentData),
    httpStatus: status,
    wasDisabled: false,
    commentId:   commentData?.name,
    commentUrl:  commentData?.permalink ? `https://reddit.com${commentData.permalink}` : undefined,
    error:       ok ? undefined : `HTTP ${status}`,
  };
}

/**
 * Fetch current score/status of a posted comment.
 *
 * @param {string} commentId - Reddit comment ID, e.g. "t1_xyz"
 * @returns {Promise<{ score: number, removed: boolean }>}
 */
async function getCommentMetrics(commentId) {
  const id = commentId.replace(/^t1_/, '');
  const { ok, data } = await redditRequest('/api/info', 'GET', {
    id: `t1_${id}`,
    raw_json: '1',
  });

  if (!ok) return { score: 0, removed: false };

  const thing = data?.data?.children?.[0]?.data;
  return {
    score:   thing?.score ?? 0,
    removed: thing?.removed ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a Reddit listing post object into a CandidateThread.
 * @param {Object} post - Raw Reddit post data
 * @returns {import('./types').CandidateThread}
 */
function normaliseListing(post) {
  return {
    redditId:     post.name,              // e.g. "t3_abc123"
    subreddit:    post.subreddit,
    title:        post.title || '',
    body:         post.selftext || '',
    url:          `https://reddit.com${post.permalink}`,
    author:       post.author || '[deleted]',
    score:        post.score || 0,
    commentCount: post.num_comments || 0,
    ingestedAt:   new Date().toISOString(),
  };
}

module.exports = { getAccessToken, redditRequest, searchSubreddit, getThread, postComment, getCommentMetrics };
