/**
 * POST /api/contacts/find-updated-contact
 *
 * On-demand web search for a current contact at an organization whose email
 * just bounced and for which mark-bounced's internal CRM lookup (another
 * SalesContact at the same account) came up empty. Called per-lead, only
 * when a human clicks for it — never automatically during an inbox sync,
 * since a live search has real latency/cost and isn't needed for bounces
 * nobody's going to resend to.
 *
 * Uses Claude's native web_search tool (same pattern as
 * api/contacts/enrich-website.js, same ANTHROPIC_KEY already used
 * everywhere else in this app) — not Perplexity, which burns through
 * credits too fast for this to run on demand at any real volume.
 *
 * Body: { orgName, city, state, sport, contactName }
 * Response: { ok, found, name, title, email, phone, sourceUrl, note }
 * Never auto-applied — the caller still shows this as a suggestion the
 * human clicks "USE THIS" on, same as the internal CRM suggestion.
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_KEY not set in Vercel env vars" });

  const { orgName, city, state, sport, contactName } = req.body || {};
  if (!orgName) return res.status(400).json({ error: "orgName required" });

  const place = [city, state].filter(Boolean).join(", ");
  const prompt = `Search the web for the current athletic director, head coach, or best athletics-department contact${sport ? ` for ${sport}` : ""} at "${orgName}"${place ? ` in ${place}` : ""}.
${contactName ? `The previous contact on file was ${contactName}, but their email address bounced — find whoever holds that role now, or a good current alternate contact for the athletics program.` : "We don't have a working contact for this organization's athletics program — find one."}

Return ONLY a JSON object, no markdown fences, no other text:
{
  "found": true or false,
  "name": "person's name, or null",
  "title": "their role/title, or null",
  "email": "their email address, or null — only if you actually found one in a real source",
  "phone": "phone number, or null",
  "sourceUrl": "the URL where you found this, or null"
}

Only set "found": true if you have at least a name or an email from an actual source you can cite in sourceUrl. Never guess, infer, or construct a plausible-looking email address — an unverified email is worse than none.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: `Anthropic ${r.status}: ${txt.slice(0, 200)}` });
    }

    const data = await r.json();
    const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    let result = {};
    try {
      const match = textBlocks.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch {
      result = {};
    }

    const email = typeof result.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email.trim())
      ? result.email.trim()
      : null;

    return res.json({
      ok: true,
      found: !!result.found && (!!email || !!result.name),
      name: result.name || null,
      title: result.title || null,
      email,
      phone: result.phone || null,
      sourceUrl: result.sourceUrl || null,
      searchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[find-updated-contact] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
