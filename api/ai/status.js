/**
 * GET /api/ai/status — what the knowledge layer can actually reach.
 * Booleans and counts only. No tokens, no document bodies.
 */
import { setCors } from '../_lib/cors.js';
import { prisma } from '../_lib/prisma.js';
import { getConfiguredToolKeys } from '../_lib/ai-tools/auth.js';
import { listKnowledgeDocuments } from '../_lib/ai-tools/sources.js';

export const config = { maxDuration: 20 };

function driveConfigured() {
  const sa = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64;
  const oauth = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
    && (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID)
    && (process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET);
  return Boolean(sa || oauth);
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  try {
    const [documents, priceItems, products, suppliers, contacts, memoryFacts, chatSessions] = await Promise.all([
      listKnowledgeDocuments().catch(() => []),
      prisma.priceItem.count().catch(() => 0),
      prisma.product.count().catch(() => 0),
      prisma.supplier.count({ where: { active: true } }).catch(() => 0),
      prisma.salesContact.count().catch(() => 0),
      prisma.agentMemory.count({ where: { NOT: { scope: 'tools' } } }).catch(() => 0),
      prisma.chatSession.count().catch(() => 0),
    ]);

    const bySource = documents.reduce((acc, doc) => {
      const key = doc.sourceType || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      ok: true,
      connectors: {
        database: true,
        toolAuth: getConfiguredToolKeys().length > 0,
        notion: Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN),
        googleDrive: driveConfigured(),
        zoho: Boolean(process.env.ZOHO_ORG_ID && process.env.ZOHO_REFRESH_TOKEN),
      },
      counts: {
        knowledgeDocs: documents.length,
        knowledgeDocsBySource: bySource,
        priceItems,
        products,
        suppliers,
        contacts,
        memoryFacts,
        chatSessions,
      },
      documents: documents.slice(0, 40),
    });
  } catch (e) {
    console.error('[ai/status]', e.message);
    return res.status(500).json({
      ok: false,
      connectors: {
        database: false,
        toolAuth: getConfiguredToolKeys().length > 0,
        notion: Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN),
        googleDrive: driveConfigured(),
        zoho: Boolean(process.env.ZOHO_ORG_ID && process.env.ZOHO_REFRESH_TOKEN),
      },
      error: e.message,
    });
  }
}
