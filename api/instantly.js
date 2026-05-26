/**
 * Vercel Serverless Function: /api/instantly
 *
 * Proxy for Instantly.ai API v1.
 * Actions:
 *   list_campaigns — return all campaigns for the workspace
 *   add_lead       — add a single lead to a campaign (uses INSTANTLY_DEFAULT_CAMPAIGN_ID if no campaign_id supplied)
 *
 * Required env vars:
 *   INSTANTLY_API_KEY            — workspace API key from Instantly → Settings → API
 *   INSTANTLY_DEFAULT_CAMPAIGN_ID — optional default campaign to add leads to
 */

const BASE = "https://api.instantly.ai/api/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "INSTANTLY_API_KEY not configured" });

  const { action, ...body } = req.body || {};

  try {
    if (action === "list_campaigns") {
      const r = await fetch(`${BASE}/campaign/list?api_key=${encodeURIComponent(apiKey)}&limit=50&skip=0`);
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: `Instantly error: ${txt.slice(0, 200)}` });
      }
      const data = await r.json();
      return res.json({ campaigns: data.list || data.campaigns || data || [] });
    }

    if (action === "add_lead") {
      const { email, firstName, lastName, company, campaignId, personalization } = body;
      if (!email) return res.status(400).json({ error: "email is required" });

      const campaign_id = campaignId || process.env.INSTANTLY_DEFAULT_CAMPAIGN_ID;
      if (!campaign_id) {
        return res.status(400).json({
          error: "No campaign_id provided and INSTANTLY_DEFAULT_CAMPAIGN_ID is not set"
        });
      }

      const payload = {
        api_key: apiKey,
        campaign_id,
        email,
        first_name: firstName || "",
        last_name: lastName || "",
        company_name: company || "",
      };
      if (personalization) payload.personalization = personalization;

      const r = await fetch(`${BASE}/lead/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: `Instantly error: ${txt.slice(0, 200)}` });
      }

      const data = await r.json();
      return res.json({ added: true, data });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
