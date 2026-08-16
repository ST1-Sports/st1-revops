import { prisma } from "../_lib/prisma.js";
import { setCors } from "../_lib/cors.js";
import { requireKnowledgeActor } from "../knowledge/_lib/auth.js";
import { getPricing } from "./_lib/service.js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

function pricingCors(res, methods = "GET, POST, OPTIONS") {
  setCors(res, methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-st1-user-id, x-knowledge-api-key");
}

export default async function handler(req, res) {
  pricingCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await requireKnowledgeActor(req, res, prisma);
  if (!actor) return;

  try {
    const input = req.method === "GET" ? req.query : req.body || {};
    const pricing = await getPricing(prisma, {
      sku: input.sku,
      brand: input.brand,
      customerId: input.customerId,
      programId: input.programId,
      date: input.date,
    });
    return res.json({ pricing });
  } catch (error) {
    console.error("[pricing/resolve] error:", error);
    return res.status(400).json({ error: error.message });
  }
}
