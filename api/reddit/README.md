# Reddit Engagement Module

Approval-first Reddit workflow for ST1 Sports RevOps.

**Default state: ingestion and evaluation are disabled. Posting is always disabled until explicitly opted in.**

---

## What it does

1. **Ingest** candidate Reddit threads from configured subreddits matching brand keywords
2. **Evaluate** each thread with Claude to score brand fit (0–10) and extract intent
3. **Generate** 2 reply variants per passing thread
4. **Notify** the team via Slack with a link to the approval UI
5. **Approve or reject** via the RevOps web UI at `/reddit`
6. **Post** to Reddit only after explicit human approval (disabled by default)
7. **Log** engagement metrics (upvotes, removals) for posted comments

---

## Feature flags

| Env var | Default | Effect |
|---------|---------|--------|
| `REDDIT_ENABLED` | `false` | Master switch. Enables ingestion, evaluation, reply generation, and Slack notifications. |
| `REDDIT_POSTING_ENABLED` | `false` | Separately enables Reddit posting. Must be `true` **and** a reply must be approved before anything posts. |

Both flags must be set in the Vercel dashboard. They cannot be enabled from the UI.

---

## Setup

### 1. Create a Reddit app

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Click **Create app**
3. Type: **Script** (for a single account) or **Web app** (for multi-user)
4. Set the redirect URI to: `https://YOUR-DOMAIN.vercel.app/api/reddit-setup`
5. Copy the **client ID** (shown under the app name) and **client secret**

### 2. Get a refresh token (for posting)

For read-only ingestion, client credentials are sufficient (no refresh token needed).

For posting, you need a refresh token scoped to `submit` and `identity`:

```bash
# Replace with your values
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=https://YOUR-DOMAIN.vercel.app/api/reddit-setup

# Step 1: open this URL in a browser, authorize the app
https://www.reddit.com/api/v1/authorize?client_id=CLIENT_ID&response_type=code&state=random&redirect_uri=REDIRECT_URI&duration=permanent&scope=submit,identity,read

# Step 2: exchange the code for tokens
curl -X POST https://www.reddit.com/api/v1/access_token \
  -u CLIENT_ID:CLIENT_SECRET \
  -d "grant_type=authorization_code&code=CODE_FROM_REDIRECT&redirect_uri=REDIRECT_URI"
```

Save the `refresh_token` from the response as `REDDIT_REFRESH_TOKEN`.

### 3. Add env vars to Vercel

```bash
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_REFRESH_TOKEN=          # Only needed for posting
REDDIT_USERNAME=               # Reddit account username
REDDIT_USER_AGENT=             # e.g. "ST1RevOps/1.0 by u/yourname"

REDDIT_ENABLED=false
REDDIT_POSTING_ENABLED=false

REDDIT_SLACK_CHANNEL=          # Slack channel ID for review notifications
REDDIT_TARGET_SUBREDDITS=hockey,baseball,sportsparents,youthsports
REDDIT_BRAND_KEYWORDS=sports uniforms,team jerseys,custom teamwear
REDDIT_MAX_POSTS_PER_DAY=3
REDDIT_MIN_THREAD_SCORE=5
```

### 4. Run DB migration

The module adds 4 new Prisma models. After updating env vars:

```bash
npm run db:push     # or npm run db:migrate for production
```

---

## API reference

All actions are POST to `/api/reddit` with `{ "action": "...", ...params }`.

### Always available

| Action | Params | Returns |
|--------|--------|---------|
| `status` | — | Feature flags, env config summary |

### Requires `REDDIT_ENABLED=true`

| Action | Required params | Returns |
|--------|----------------|---------|
| `ingest` | `overrides?`, `dryRun?` | `{ ingested, skipped, threads[] }` |
| `evaluate` | `threadId` | `{ evaluation: EvaluatorResult }` |
| `generate` | `threadId` | `{ replySet: GeneratedReplySet }` |
| `notify` | `threadId`, `appBaseUrl?` | `{ sent, message }` |
| `approve` | `threadId`, `replyId`, `decidedBy?` | `{ approved, replyId }` |
| `reject` | `threadId`, `reason?` | `{ rejected, threadId }` |
| `analytics` | `dryRun?` | `{ records: AnalyticsRecord[] }` |
| `threads` | `status?`, `limit?` | `{ threads[] }` |
| `mute-add` | `type` ("subreddit"\|"keyword"), `value` | `{ muted, type, value }` |
| `mute-list` | — | `{ mutes[] }` |

### Requires `REDDIT_POSTING_ENABLED=true` and prior approval

| Action | Required params | Returns |
|--------|----------------|---------|
| `post` | `replyId` | `{ result: PostingResult }` |

---

## Data flow

```
ingest → [guardrail check] → RedditThread (PENDING)
  ↓ evaluate
  RedditThread (EVALUATED) + EvaluatorResult stored in .evaluation
  ↓ generate
  RedditReply × 2 created
  ↓ notify
  Slack message sent → RedditThread (NOTIFIED)
  ↓ approve (human, in /reddit UI)
  RedditReply.approvedAt set → RedditThread (APPROVED)
  ↓ post (only if REDDIT_POSTING_ENABLED=true)
  RedditReply.postedAt + redditCommentId set → RedditThread (POSTED)
  ↓ analytics
  RedditReply.upvotes updated
```

---

## Content guardrails (enforced in code, not configurable)

- No URLs in generated replies
- Max 280 characters per reply
- One reply per thread maximum
- Muted subreddits and keywords skipped at ingest
- Daily post cap (default 3, set via `REDDIT_MAX_POSTS_PER_DAY`)
- Duplicate thread deduplication via database unique constraint
- Posting disabled by default — env flag + database approval both required

---

## File structure

```
api/reddit/
  index.js          ← Vercel function entry point, action router
  types.js          ← JSDoc type definitions (all data shapes)
  reddit-client.js  ← Reddit OAuth2 + API calls
  ingest.js         ← Thread search + guardrail + DB write
  evaluate.js       ← Claude evaluation call + response parsing
  reply-gen.js      ← Claude reply generation + content guardrails
  guardrails.js     ← Mute list, dedupe, rate-limit checks
  slack-review.js   ← Slack notification sender
  post.js           ← Reddit posting (double-gated, disabled by default)
  analytics.js      ← Engagement metric polling
  prompts/
    eval.md         ← Evaluation prompt template
    reply.md        ← Reply generation prompt template
    guardrail.md    ← Content safety check prompt template
  README.md         ← This file
```

---

## Risks and known limitations

| Risk | Mitigation |
|------|-----------|
| Reddit API ToS | User agent is required; do not exceed 60 req/min. One reply per thread, no vote manipulation. |
| Vercel function timeout (30s) | Ingest + evaluate in separate calls, not a single pipeline call. |
| Access token not cached | Fresh token per invocation. Adds ~200ms per call. Future: cache in `Setting` table. |
| Slack MCP send failures | `notifySlack` returns `{ sent: false, error }` without throwing; approval link still works. |
| Posting without approval | Blocked at two layers: env flag + DB `approvedAt` check. |
