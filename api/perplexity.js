/**
 * POST /api/perplexity
 *
 * Calls Perplexity's sonar model to search Reddit for relevant discussions
 * and draft suggested replies from ST1 Sports' perspective.
 *
 * Required env var: PERPLEXITY_API_KEY
 *
 * Body: { topics: string[], customTopic?: string, company?: string }
 * Response: { threads: Thread[], searchedAt: string }
 *   Thread: { id, title, subreddit, url, excerpt, suggestedReply }
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "PERPLEXITY_API_KEY not set in Vercel env vars" });

  const {
    topics = [],
    customTopic = "",
    company = "ST1 Sports",
    context = "sports equipment supplier specializing in track & field, cross country, and multi-sport equipment for schools and universities",
  } = req.body || {};

  const topicList = [
    ...topics,
    ...(customTopic ? [customTopic] : []),
  ].filter(Boolean).join(", ") || "track and field equipment, sports equipment recommendations, athletic director purchasing";

  const prompt = `Search Reddit for recent discussions (past 2 months) about: ${topicList}.

Look in subreddits like r/trackandfield, r/CrossCountry, r/HS_Cross_Country, r/running, r/athletics, r/Coaching, r/SportsBusiness, r/physed, r/Teachers, r/education, and similar communities where coaches, athletic directors, or athletes ask questions or share experiences.

Find threads where ${company} (${context}) could add genuine value with a helpful reply.

Return a JSON array of up to 8 real Reddit threads you find. Each entry must use the EXACT URL from your search results — do not fabricate or guess URLs.

Format (return ONLY the JSON array, no other text):
[
  {
    "title": "exact thread title from Reddit",
    "subreddit": "r/subredditname",
    "url": "https://www.reddit.com/r/.../comments/...",
    "excerpt": "1-2 sentence quote or summary of what the person is asking/discussing",
    "suggestedReply": "a helpful, authentic 2-3 paragraph reply. Add genuine value first. Only mention ${company} naturally if it directly fits — never make it sound like an ad."
  }
]`;

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "You are a research assistant. Search the web and return only a valid JSON array. Every URL you include must be a real Reddit thread URL from your search results — never invent or approximate URLs.",
          },
          { role: "user", content: prompt },
        ],
        search_recency_filter: "month",
        return_citations: true,
        temperature: 0.1,
        max_tokens: 3000,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error?.message || "Perplexity API error", detail: data });
    }

    const content = data.choices?.[0]?.message?.content || "[]";
    const citations = (data.citations || []).filter(c => typeof c === "string");

    // Extract JSON array from response (model sometimes wraps it in markdown fences)
    let threads = [];
    try {
      const match = content.match(/\[[\s\S]*\]/);
      if (match) threads = JSON.parse(match[0]);
    } catch {
      threads = [];
    }

    // Keep only entries with plausible Reddit URLs
    // Cross-check against citations when available
    const citationSet = new Set(citations.map(c => c.split("?")[0].replace(/\/$/, "")));
    threads = threads
      .filter(t => t && typeof t.url === "string" && t.url.includes("reddit.com/r/") && t.url.includes("/comments/"))
      .filter(t => {
        if (citationSet.size === 0) return true; // no citations to cross-check
        const cleanUrl = t.url.split("?")[0].replace(/\/$/, "");
        // Accept if exact match or if the thread ID appears in any citation
        const threadId = cleanUrl.match(/\/comments\/([a-z0-9]+)/i)?.[1];
        return citationSet.has(cleanUrl) || (threadId && citations.some(c => c.includes(threadId)));
      })
      .map((t, i) => ({
        id: `pplx-${i}-${Date.now()}`,
        title: String(t.title || "").trim(),
        subreddit: String(t.subreddit || "").trim(),
        url: String(t.url || "").trim().split("?")[0],
        excerpt: String(t.excerpt || "").trim(),
        suggestedReply: String(t.suggestedReply || "").trim(),
      }));

    return res.json({
      threads,
      citations: citations.filter(c => c.includes("reddit.com")),
      searchedAt: new Date().toISOString(),
      topicsSearched: topicList,
    });
  } catch (err) {
    console.error("[perplexity] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
