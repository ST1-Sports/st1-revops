/**
 * /api/zoho-quotes  — Zoho Books Estimates (Quotes) + Inventory Items
 *
 * Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID
 *
 * Actions:
 *   list_items    — Fetch active items/products from Zoho Books inventory
 *   create_quote  — Create a Zoho Books Estimate (optionally email to customer)
 *   list_quotes   — List recent estimates
 *   get_quote     — Fetch a single estimate by ID
 */

import { getZohoToken } from './_lib/zoho-token.js';
import { setCors }      from './_lib/cors.js';

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const BOOKS = "https://www.zohoapis.com/books/v3";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const orgId = process.env.ZOHO_ORG_ID;
  if (!orgId) return res.status(500).json({ error: "ZOHO_ORG_ID not configured — add it in Vercel env vars" });

  const { action, ...params } = req.body || {};
  if (!action) return res.status(400).json({ error: "action required" });

  let token;
  try {
    token = await getZohoToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: "/api/zoho-setup" });
  }

  const headers = {
    Authorization:  `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };

  try {

    // ── LIST INVENTORY ITEMS ──────────────────────────────────────────────────
    if (action === "list_items") {
      const r = await fetch(
        `${BOOKS}/items?organization_id=${orgId}&per_page=200&status=active&filter_by=Status.Active`,
        { headers }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Items fetch failed", raw: data });
      const items = (data.items || []).map(item => ({
        item_id:     item.item_id,
        name:        item.name,
        description: item.description || "",
        rate:        parseFloat(item.rate || item.selling_price || 0),
        unit:        item.unit || "",
        sku:         item.sku || "",
        stock:       item.stock_on_hand ?? null,
      }));
      return res.json({ items });
    }

    // ── CREATE QUOTE (Zoho Books Estimate) ────────────────────────────────────
    if (action === "create_quote") {
      const {
        customer_name,
        billing_address = {},
        line_items = [],
        discount = 0,
        tax_percentage = 0,
        date,
        expiry_date,
        notes,
        terms,
        send_email = false,
        email,
        contact_person,
      } = params;

      if (!customer_name) return res.status(400).json({ error: "customer_name required" });
      if (!line_items.length) return res.status(400).json({ error: "line_items required" });

      const estimateBody = {
        customer_name,
        date:        date || new Date().toISOString().split("T")[0],
        expiry_date: expiry_date || "",
        notes:       notes || "",
        terms:       terms || "",
        discount,
        is_discount_before_tax: true,
        discount_type:          "percentage",
        billing_address,
        line_items: line_items.map(li => ({
          ...(li.item_id ? { item_id: li.item_id } : {}),
          name:           li.name || "",
          description:    li.description || "",
          quantity:       Number(li.quantity) || 1,
          rate:           Number(li.rate) || 0,
          tax_percentage: Number(tax_percentage) || 0,
        })),
      };

      const r = await fetch(`${BOOKS}/estimates?organization_id=${orgId}`, {
        method: "POST",
        headers,
        body:   JSON.stringify(estimateBody),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Create quote failed", raw: data });

      const est = data.estimate || {};
      const result = {
        quote_id:        est.estimate_id,
        estimate_number: est.estimate_number,
        status:          est.status,
        total:           est.total,
      };

      // Optionally email the quote to the customer
      if (send_email && email && est.estimate_id) {
        try {
          await fetch(`${BOOKS}/estimates/${est.estimate_id}/email?organization_id=${orgId}`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              to_mail_ids: [email],
              subject: `Quote from ST1 Sports — ${est.estimate_number}`,
              body: [
                `Hi ${contact_person || customer_name},`,
                "",
                "Please find your quote attached.",
                "",
                notes ? notes + "\n" : "",
                "To accept this quote or ask questions, just reply to this email or call Matt directly.",
                "",
                "Best,",
                "Matt Stone",
                "ST1 Sports | matt@st1sports.com | 719-256-0275 | st1sports.com",
              ].join("\n"),
            }),
          });
          result.emailed = true;
        } catch {
          result.emailed = false;
        }
      }

      return res.json(result);
    }

    // ── LIST QUOTES ───────────────────────────────────────────────────────────
    if (action === "list_quotes") {
      const { page = 1 } = params;
      const r = await fetch(
        `${BOOKS}/estimates?organization_id=${orgId}&per_page=50&page=${page}&sort_column=created_time&sort_order=D`,
        { headers }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "List quotes failed" });
      const quotes = (data.estimates || []).map(q => ({
        id:              q.estimate_id,
        estimate_number: q.estimate_number,
        customer_name:   q.customer_name,
        date:            q.date,
        expiry_date:     q.expiry_date,
        total:           q.total,
        status:          q.status,  // draft | sent | accepted | declined | expired | invoiced
      }));
      return res.json({ quotes });
    }

    // ── GET SINGLE QUOTE ──────────────────────────────────────────────────────
    if (action === "get_quote") {
      const { quote_id } = params;
      if (!quote_id) return res.status(400).json({ error: "quote_id required" });
      const r = await fetch(`${BOOKS}/estimates/${quote_id}?organization_id=${orgId}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Get quote failed" });
      return res.json(data.estimate || data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
