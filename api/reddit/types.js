/**
 * Reddit Engagement Module — shared type definitions (JSDoc).
 *
 * These are the canonical data shapes that flow through every service.
 * All Claude responses are validated against the relevant type via validators.js
 * before being persisted or passed downstream.
 *
 * Field names in AI output types match the JSON schema defined in the prompt
 * templates exactly (snake_case throughout). Do not rename fields here without
 * also updating the prompt schema and validators.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A candidate Reddit thread fetched during ingestion.
 *
 * @typedef {Object} CandidateThread
 * @property {string} redditId      - Reddit thing ID, e.g. "t3_abc123"
 * @property {string} subreddit     - Subreddit name without r/ prefix
 * @property {string} title         - Thread title
 * @property {string} body          - Self-post body text (may be empty for link posts)
 * @property {string} url           - Full permalink URL
 * @property {string} author        - OP username
 * @property {number} score         - Current upvote count
 * @property {number} commentCount  - Current comment count
 * @property {string} ingestedAt    - ISO 8601 timestamp
 */

// ─────────────────────────────────────────────────────────────────────────────
// AI OUTPUT TYPES  (field names match prompt schemas exactly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured result returned by the Claude evaluator (eval.md).
 * Stored as JSON in RedditThread.evaluation.
 *
 * @typedef {Object} EvaluatorResult
 * @property {"REPLY"|"MONITOR"|"SKIP"} decision
 *   - REPLY:   engage with a helpful reply
 *   - MONITOR: thread is interesting but too risky or unclear right now
 *   - SKIP:    do not engage
 * @property {number} fit_score      - Integer 1–10; overall fit for engagement
 * @property {number} promo_risk     - Integer 1–10; 10 = highest promotional risk
 * @property {number} confidence     - Integer 1–10; model confidence in this decision
 * @property {"buying_now"|"researching"|"general_discussion"|"support_request"|"off_topic"} intent_type
 * @property {"coach"|"parent"|"athlete"|"admin"|"unknown"} audience_type
 * @property {string} reasoning_summary  - Plain-English explanation, max 70 words
 * @property {string} value_angle        - What a good reply would say, max 40 words
 * @property {string} do_not_reply_reason - Non-empty when decision is SKIP or MONITOR
 */

/**
 * Full result returned by the reply generator (reply.md).
 * Matches the JSON schema defined in the SYSTEM block of reply.md exactly.
 *
 * When Claude determines there is no credible value-add for a thread, it returns
 * the literal string "SKIP" instead of JSON. In that case generateReplies()
 * returns { skip: true } and no DB rows are written.
 *
 * DB mapping (RedditReply table):
 *   primary_reply → { variant: 1, content: primary_reply }
 *   safer_reply   → { variant: 2, content: safer_reply }
 *
 * why_it_works and risk_notes are reviewer metadata; they are returned in the
 * API response but not persisted (no DB column for them yet).
 *
 * @typedef {Object} GeneratedReplySet
 * @property {string}  primary_reply - Strongest useful answer; variant 1 in DB
 * @property {string}  safer_reply   - Less promotional alternative; variant 2 in DB
 * @property {string}  why_it_works  - Reviewer context explaining the angle, max 60 words
 * @property {string}  risk_notes    - Reviewer-facing risk flags, max 50 words
 * @property {boolean} cta_present   - true if model detected a CTA (hard error; reply unusable)
 * @property {true}    [skip]        - Present and true when Claude returned SKIP
 */

/**
 * Result from the posting guardrail (guardrail.md).
 *
 * Two separate approval gates allow finer control:
 *   approved_for_review=true, approved_for_post=false → surface to human but flag for editing
 *   approved_for_review=false                         → block entirely; don't surface
 *
 * @typedef {Object} GuardrailResult
 * @property {boolean} approved_for_review - Show to human reviewer
 * @property {boolean} approved_for_post   - Ready to post as-is (requires approved_for_review=true)
 * @property {string}  block_reason        - Non-empty when either gate is false
 * @property {string}  edit_suggestion     - Specific fix suggestion when approved_for_post=false
 * @property {number}  final_risk_score    - Integer 1–10; overall posting risk
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
 * @property {string}  [decidedBy]   - User identifier, e.g. "matt"
 * @property {string}  [rejectionReason] - Required when decision === "reject"
 */

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of attempting to post a comment to Reddit.
 *
 * @typedef {Object} PostingResult
 * @property {boolean} ok            - true if Reddit accepted the comment
 * @property {string}  [commentId]   - Reddit comment ID, e.g. "t1_xyz" (on success)
 * @property {string}  [commentUrl]  - Full permalink to the posted comment
 * @property {string}  [error]       - Error message on failure
 * @property {number}  httpStatus    - Raw HTTP status from Reddit
 * @property {boolean} wasDisabled   - true if posting was skipped due to feature flag
 */

/**
 * A single analytics snapshot for a posted comment.
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
 * Resolved feature flags — constructed once per request in index.js.
 *
 * @typedef {Object} RedditFlags
 * @property {boolean} enabled        - REDDIT_ENABLED === "true"
 * @property {boolean} postingEnabled - REDDIT_POSTING_ENABLED === "true"
 * @property {number}  maxPostsPerDay - REDDIT_MAX_POSTS_PER_DAY (default 3)
 * @property {number}  minThreadScore - REDDIT_MIN_THREAD_SCORE (default 5)
 */

module.exports = {}; // no runtime exports — types are documentation only
