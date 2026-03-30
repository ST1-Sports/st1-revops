/**
 * Vercel Serverless: /api/zoho-campaigns
 *
 * Proxy for Zoho Campaigns API — email list management and marketing automation.
 * Same OAuth credentials as api/zoho.js; requires ZohoCampaigns scopes.
 *
 * Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 * Additional scope needed: ZohoCampaigns.campaign.ALL,ZohoCampaigns.contact.ALL
 * (run /api/zoho-setup again after adding these scopes to your OAuth app)
 *
 * Request body: { action: string, ...params }
 *
 * Actions:
 *   list_lists          — list all mailing lists with subscriber counts
 *   create_list         — create a new list { listname, description? }
 *   add_subscribers     — add contacts to a list { listkey, contacts: [{email,firstName,lastName,company}] }
 *   remove_subscriber   — remove a contact { listkey, email }
 *   list_details        — get details + stats for a list { listkey }
 *   list_campaigns      — list sent/scheduled campaigns
 *   list_subscribers    — get subscribers for a list { listkey, range? }
 */

import { getZohoToken } from './_lib/zoho-token.js';
import { setCors } from './_lib/cors.js';

const BASE = "https://campaigns.zoho.com/api/v1.1";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { action, ...params } = req.body || {};
  if (!action) return res.status(400).json({ error: "action required" });

  let token;
  try {
    token = await getZohoToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: "/api/zoho-setup" });
  }

  const headers = { Authorization: `Zoho-oauthtoken ${token}` };
  const formHeaders = { ...headers, "Content-Type": "application/x-www-form-urlencoded" };

  try {
    // ── LIST ALL MAILING LISTS ────────────────────────────────────────────────
    if (action === "list_lists") {
      const r = await fetch(`${BASE}/getmailinglists?resfmt=JSON&range=100`, { headers });
      const data = await r.json();
      // Normalize: Zoho Campaigns returns list_of_details or an error code
      if (data.status === "error") {
        return res.status(400).json({ error: data.message || "Campaigns API error", raw: data });
      }
      const lists = (data.list_of_details || []).map(l => ({
        listkey:      l.listkey,
        listname:     l.listname,
        subscribers:  parseInt(l.noofcontacts || "0"),
        description:  l.description || "",
        createdAt:    l.created_time || null,
      }));
      return res.json({ lists, total: lists.length });
    }

    // ── CREATE A NEW LIST ─────────────────────────────────────────────────────
    if (action === "create_list") {
      const { listname, description = "" } = params;
      if (!listname) return res.status(400).json({ error: "listname required" });
      const r = await fetch(`${BASE}/createlist?resfmt=JSON`, {
        method: "POST",
        headers: formHeaders,
        body: new URLSearchParams({ listname, signupformname: listname, description }).toString(),
      });
      const data = await r.json();
      if (data.status === "error") {
        return res.status(400).json({ error: data.message || "Create list failed", raw: data });
      }
      return res.json({ ok: true, listkey: data.list_of_details?.listkey, listname, raw: data });
    }

    // ── ADD SUBSCRIBERS TO A LIST ─────────────────────────────────────────────
    if (action === "add_subscribers") {
      const { listkey, contacts = [] } = params;
      if (!listkey) return res.status(400).json({ error: "listkey required" });
      if (!contacts.length) return res.status(400).json({ error: "contacts array required" });

      // Zoho Campaigns expects JSON array of objects with field names
      const contactinfo = JSON.stringify(
        contacts.map(c => ({
          "Contact Email": c.email,
          "First Name":    c.firstName || c.first_name || "",
          "Last Name":     c.lastName  || c.last_name  || "",
          "Company":       c.company   || c.orgName    || c.school || "",
          "Phone":         c.phone     || "",
        })).filter(c => c["Contact Email"])
      );

      const r = await fetch(`${BASE}/addlistsubscribers?resfmt=JSON`, {
        method: "POST",
        headers: formHeaders,
        body: new URLSearchParams({ listkey, contactinfo }).toString(),
      });
      const data = await r.json();
      if (data.status === "error") {
        return res.status(400).json({ error: data.message || "Add subscribers failed", raw: data });
      }
      return res.json({
        ok: true,
        added: data.addedcount ?? contacts.length,
        failed: data.failedcount ?? 0,
        raw: data,
      });
    }

    // ── REMOVE A SUBSCRIBER ───────────────────────────────────────────────────
    if (action === "remove_subscriber") {
      const { listkey, email } = params;
      if (!listkey || !email) return res.status(400).json({ error: "listkey and email required" });
      const r = await fetch(`${BASE}/deletelistsubscribers?resfmt=JSON`, {
        method: "POST",
        headers: formHeaders,
        body: new URLSearchParams({ listkey, emailids: email }).toString(),
      });
      const data = await r.json();
      return res.json({ ok: data.status !== "error", raw: data });
    }

    // ── LIST DETAILS / STATS ──────────────────────────────────────────────────
    if (action === "list_details") {
      const { listkey } = params;
      if (!listkey) return res.status(400).json({ error: "listkey required" });
      const r = await fetch(`${BASE}/listdetails?resfmt=JSON&listkey=${listkey}`, { headers });
      const data = await r.json();
      return res.json(data);
    }

    // ── LIST CAMPAIGNS ────────────────────────────────────────────────────────
    if (action === "list_campaigns") {
      const { type = "EZC", status: campStatus = "all", range = 50 } = params;
      const q = new URLSearchParams({ resfmt: "JSON", type, status: campStatus, range: String(range) });
      const r = await fetch(`${BASE}/getcampaigns?${q}`, { headers });
      const data = await r.json();
      if (data.status === "error") {
        return res.status(400).json({ error: data.message, raw: data });
      }
      const campaigns = (data.campaigns || []).map(c => ({
        campaignkey: c.campaignkey,
        campaignname: c.campaignname,
        subject:  c.subject || "",
        status:   c.status || "",
        sendDate: c.senddate || null,
        opens:    parseInt(c.openstotal || "0"),
        clicks:   parseInt(c.clickstotal || "0"),
        sent:     parseInt(c.sentcount || "0"),
      }));
      return res.json({ campaigns, total: campaigns.length });
    }

    // ── LIST SUBSCRIBERS FOR A LIST ───────────────────────────────────────────
    if (action === "list_subscribers") {
      const { listkey, range = 50 } = params;
      if (!listkey) return res.status(400).json({ error: "listkey required" });
      const q = new URLSearchParams({ resfmt: "JSON", listkey, range: String(range) });
      const r = await fetch(`${BASE}/getlistsubscribers?${q}`, { headers });
      const data = await r.json();
      return res.json(data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
