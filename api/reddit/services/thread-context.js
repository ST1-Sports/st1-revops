async function fetchThreadContext(url) {
  if (!url) return { topComments: [] };
  const jsonUrl = url.replace(/\/$/, "") + ".json?limit=8&raw_json=1";
  const r = await fetch(jsonUrl, {
    headers: {
      "User-Agent": "ST1RevOps/1.0 (internal sales tool; contact sales@st1sports.com)",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`Reddit ${r.status}`);
  const data = await r.json();
  const post = data[0]?.data?.children?.[0]?.data || {};
  const comments = data[1]?.data?.children || [];
  const topComments = comments
    .filter(c => c.kind === "t1" && c.data?.body && c.data.body !== "[deleted]" && c.data.body !== "[removed]")
    .slice(0, 6)
    .map(c => ({ author: c.data.author, body: c.data.body, score: c.data.score || 0 }));
  return {
    body: post.selftext || "",
    score: post.score,
    commentCount: post.num_comments,
    topComments,
  };
}

function formatTopComments(comments = []) {
  return comments.length
    ? comments.map(c => `u/${c.author} (${c.score || 0}): ${c.body}`).join("\n\n")
    : "";
}

async function ensureThreadContext(db, thread) {
  if (!thread?.url) return { thread, topCommentsText: "" };
  try {
    const ctx = await fetchThreadContext(thread.url);
    const updates = {};
    if (ctx.body && ctx.body !== thread.body) updates.body = ctx.body;
    if (Number.isFinite(ctx.score)) updates.score = ctx.score;
    if (Number.isFinite(ctx.commentCount)) updates.commentCount = ctx.commentCount;
    const nextThread = Object.keys(updates).length
      ? await db.redditThread.update({ where: { id: thread.id }, data: updates })
      : thread;
    return { thread: nextThread, topCommentsText: formatTopComments(ctx.topComments) };
  } catch {
    return { thread, topCommentsText: "" };
  }
}

module.exports = { ensureThreadContext, fetchThreadContext, formatTopComments };
