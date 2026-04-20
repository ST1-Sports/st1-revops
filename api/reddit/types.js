/**
 * Reddit Engagement Module — shared type definitions (JSDoc).
 *
 * These are the canonical data shapes that flow through every service in this
 * module. All Claude responses are validated against the relevant type before
 * being persisted or passed downstream.
 *
 * No runtime validation library is used (consistent with the rest of the repo).
 * Services should return objects matching these shapes and document deviations.
 */

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A candidate Reddit thread fetched during ingestion.
 *
 * @typedef {Object} CandidateThread
 * @property {string}  redditId      - Reddit thing ID, e.g. "t3_abc123"
 * @property {string}  subreddit     - Subreddit name without r/ prefix
 * @property {string}  title         - Thread title
 * @property {string}  body          - Self-post body text (may be empty for link posts)
 * @property {string}  url           - Full permalink URL
 * @property {string}  author        - OP username
 * @property {number}  score         - Current upvote count
 * @property {number}  commentCount  - Current comment count
 * @property {string}  ingestedAt    - ISO 8601 timestamp
 */

// ─────────────────────────────────────────────────────────────────────────────
// AI OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured result returned by the Claude evaluator.
 * Stored as JSON in RedditThread.evaluation.
 *
 * @typedef {Object} EvaluatorResult
 * @property {number}   fitScore      - 0–10; how well the thread matches our ICP and brand
 * @property {string}   intent        - One of: "seeking_vendor","seeking_advice","venting","comparison","other"
 * @property {string[]} topics        - Relevant topic tags extracted from the thread, e.g. ["uniforms","youth hockey"]
 * @property {string}   reasoning     - 1–3 sentence plain-English explanation of the score
 * @property {boolean}  shouldReply   - true if fitScore >= threshold and no disqualifying signals
 * @property {string[]} redFlags      - Any signals that lower confidence (e.g. "already has vendor","off-topic")
 */

/**
 * One generated reply variant.
 *
 * @typedef {Object} ReplyVariant
 * @property {number} variant   - 1 or 2
 * @property {string} content   - The reply text, ready to post
 * @property {string} tone      - e.g. "helpful","direct","conversational"
 * @property {string} rationale - Why this tone/angle was chosen (for reviewer context)
 */

/**
 * Full result returned by the reply generator.
 * Contains exactly 2 variants.
 *
 * @typedef {Object} GeneratedReplySet
 * @property {ReplyVariant[]} variants     - Exactly 2 reply variants
 * @property {string}         threadSummary - One-sentence summary of the thread for reviewer context
 */

/**
 * Result from the guardrail checker.
 * A FAIL result causes the thread to be marked SKIPPED without further processing.
 *
 * @typedef {Object} GuardrailResult
 * @property {boolean}  pass          - true = thread clears all guardrails
 * @property {string[]} failures      - Human-readable descriptions of each failed check
 * @property {string}   [muteReason]  - Set if a subreddit or keyword mute triggered
 * @property {boolean}  isDuplicate   - true if we have already replied to this thread
 * @property {boolean}  rateLimited   - true if daily post cap has been reached
 */

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW ACTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for a human approval or rejection action, submitted via the review UI.
 *
 * @typedef {Object} ApprovalAction
 * @property {string}  threadId      - RedditThread.id (cuid)
 * @property {string}  replyId       - RedditReply.id of the chosen variant (cuid)
 * @property {"approve"|"reject"} decision
 * @property {string}  [decidedBy]   - User identifier (e.g. "matt")
 * @property {string}  [rejectionReason] - Required when decision === "reject"
 */

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of attempting to post a comment to Reddit.
 *
 * @typedef {Object} PostingResult
 * @property {boolean} ok              - true if Reddit accepted the comment
 * @property {string}  [commentId]     - Reddit comment ID (e.g. "t1_xyz") on success
 * @property {string}  [commentUrl]    - Full permalink to the posted comment
 * @property {string}  [error]         - Error message on failure
 * @property {number}  httpStatus      - Raw HTTP status from Reddit
 * @property {boolean} wasDisabled     - true if posting was skipped due to feature flag
 */

/**
 * A single analytics snapshot for a posted comment.
 * Fetched by polling Reddit after posting.
 *
 * @typedef {Object} AnalyticsRecord
 * @property {string}  replyId         - RedditReply.id
 * @property {string}  redditCommentId - Reddit comment ID
 * @property {number}  upvotes         - Current upvote count
 * @property {number}  score           - Reddit score (upvotes minus downvotes)
 * @property {boolean} removed         - true if moderators removed the comment
 * @property {string}  fetchedAt       - ISO 8601 timestamp
 */

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAG SHAPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved feature flags read at runtime from env vars.
 * Constructed once per request in index.js and passed to services that need it.
 *
 * @typedef {Object} RedditFlags
 * @property {boolean} enabled         - REDDIT_ENABLED === "true"
 * @property {boolean} postingEnabled  - REDDIT_POSTING_ENABLED === "true"
 * @property {number}  maxPostsPerDay  - REDDIT_MAX_POSTS_PER_DAY (default 3)
 * @property {number}  minThreadScore  - REDDIT_MIN_THREAD_SCORE (default 5)
 */

module.exports = {}; // no runtime exports — types are documentation only
