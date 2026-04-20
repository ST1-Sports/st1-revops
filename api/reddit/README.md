# Reddit Engagement Module

Approval-first workflow for monitoring Reddit, generating replies with Claude, and posting via the official Reddit OAuth2 API.

## Directory layout

```
api/reddit/
  index.js              Vercel serverless entry point — dispatches on action=
  prompt-loader.js      Loads .md prompt files from prompts/
  reddit-client.js      Reddit OAuth2 client (search, post, metrics)
  validators.js         JSON schema validators for Claude outputs
  types.js              JSDoc type definitions
  prompts/
    evaluate.md         Thread evaluation prompt (fit_score, promo_risk, …)
    reply-gen.md        Reply generation prompt (primary + safer variants)
    guardrail.md        Content guardrail prompt (approved_for_review/post, risk_score)
  services/
    ingestion.js        Search Reddit, apply DB guardrails, persist threads
    evaluator.js        Run Claude evaluation on a pending thread
    reply-generator.js  Generate reply variants (primary + safer) for an evaluated thread
    content-guardrail.js  Claude-based content review before approval/posting
    db-guardrails.js    DB-level guardrails: score filter, mute list, dedup, rate cap
    slack-review.js     Build Block Kit cards and post Slack review notifications
    posting.js          10-gate posting flow with full audit logging
    analytics.js        Poll Reddit for upvote/moderation metrics on posted replies
    report.js           Aggregate analytics report (funnel, subreddits, variants, guardrails)
```

## Actions (POST /api/reddit)

| action      | Required fields          | Description |
|-------------|--------------------------|-------------|
| status      | —                        | Feature flag state (always allowed) |
| ingest      | —                        | Fetch Reddit threads, apply guardrails, persist |
| evaluate    | threadId                 | Run Claude evaluation on a pending thread |
| generate    | threadId                 | Generate primary + safer reply variants |
| notify      | threadId                 | Send Slack review card |
| approve     | threadId, replyId        | Record human approval |
| reject      | threadId                 | Reject all variants |
| check       | replyId                  | Run Claude content guardrail |
| post        | replyId                  | Post approved reply (requires REDDIT_POSTING_ENABLED=true) |
| analytics   | —                        | Refresh upvote metrics for posted replies |
| report      | days? (default 90)       | Aggregated analytics report |
| threads     | status?, limit?          | List threads from DB |
| mute-add    | type, value              | Add subreddit or keyword to mute list |
| mute-list   | —                        | List all mute entries |

All requests accept `dryRun: true` to simulate without side effects.

## Feature flags (env vars)

| Variable                     | Default | Description |
|------------------------------|---------|-------------|
| REDDIT_ENABLED               | false   | Master switch — gates all actions except status |
| REDDIT_POSTING_ENABLED       | false   | Enables actual posting to Reddit |
| REDDIT_MAX_POSTS_PER_DAY     | 3       | Daily post cap |
| REDDIT_POST_COOLDOWN_MINUTES | 30      | Minimum minutes between posts |
| REDDIT_MIN_THREAD_SCORE      | 5       | Minimum Reddit score to ingest |
| REDDIT_TARGET_SUBREDDITS     | —       | Comma-separated subreddits to monitor |
| REDDIT_BRAND_KEYWORDS        | —       | Comma-separated keywords to detect in threads |
| REDDIT_CLIENT_ID             | —       | Reddit app client ID |
| REDDIT_CLIENT_SECRET         | —       | Reddit app client secret |
| REDDIT_REFRESH_TOKEN         | —       | Reddit OAuth2 refresh token (for posting) |
| REDDIT_USERNAME              | —       | Reddit account username |
| REDDIT_USER_AGENT            | —       | User-Agent header (required by Reddit ToS) |
| REDDIT_SLACK_CHANNEL         | —       | Slack channel ID for review cards |
| SLACK_BOT_TOKEN              | —       | Slack bot token (chat:write scope) |
| SLACK_SIGNING_SECRET         | —       | Slack signing secret (for /api/slack/actions) |

## Posting gates

Checked in order — all must pass before a reply reaches Reddit:

1. `REDDIT_POSTING_ENABLED=true`
2. Reply exists in DB
3. Reply has `approvedAt` set (human approval)
4. Reply not already posted (`postedAt` is null)
5. No other reply for the same thread already posted
6. Subreddit not in mute list
7. Thread title/body contains no muted keyword
8. Daily post cap not exceeded
9. Post cooldown not active
10. Reply content not too similar to a recent post (Jaccard < 0.85, 14-day window)
11. Claude content guardrail approves (`approved_for_post: true`)

Every attempt — including blocked ones — is written to `RedditPostingAttempt` for the audit trail.

## Guardrail schema

Claude returns:
```json
{
  "approved_for_review": true,
  "approved_for_post": false,
  "block_reason": "Too promotional",
  "edit_suggestion": "Remove the product name from line 2",
  "final_risk_score": 7
}
```

`approved_for_review=false` implies `approved_for_post=false`. A blocked result always includes a non-empty `block_reason`.

## Slack review flow

1. `notify` action posts a Block Kit card with thread context, evaluation scores, and both reply variants.
2. Reviewer clicks one of six buttons: Approve & Post, Approve Safer, Edit Reply, Skip, Mute Subreddit, Mute Keyword.
3. `/api/slack/actions` handles the callback, acks within 3s, processes async, updates the card via `response_url`.
4. If `REDDIT_POSTING_ENABLED=false`, approval is recorded but posting is deferred for manual execution.
