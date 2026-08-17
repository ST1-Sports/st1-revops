import { setCors } from '../../_lib/cors.js';
import { authenticateToolRequest, requireScope } from '../../_lib/ai-tools/auth.js';
import { saveKnowledgeDocument } from '../../_lib/ai-tools/sources.js';

const NOTION_VERSION = '2022-06-28';

export const config = {
  api: { bodyParser: { sizeLimit: '200kb' } },
  maxDuration: 30,
};

function sendError(res, status, code, message, details) {
  return res.status(status).json({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

function notionToken() {
  return process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || '';
}

function parsePageId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const compact = value.replace(/-/g, '');
  const match = compact.match(/[a-f0-9]{32}/i);
  if (!match) return value;
  const id = match[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function plainText(richText = []) {
  return richText.map(part => part.plain_text || '').join('');
}

function blockText(block) {
  const type = block.type;
  const data = block[type];
  if (!data) return '';
  if (Array.isArray(data.rich_text)) {
    const text = plainText(data.rich_text);
    return text ? text : '';
  }
  if (type === 'child_database') return `[Database] ${data.title || ''}`;
  if (type === 'child_page') return `[Page] ${data.title || ''}`;
  return '';
}

async function notionFetch(path, token) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    throw new Error(data.message || `Notion ${response.status}`);
  }
  return data;
}

function pageTitle(page) {
  const props = page?.properties || {};
  for (const prop of Object.values(props)) {
    if (prop?.type === 'title') {
      const text = plainText(prop.title || []);
      if (text) return text;
    }
  }
  return 'Notion page';
}

async function readBlocks(pageId, token, depth = 0) {
  if (depth > 2) return [];
  const lines = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notionFetch(`/blocks/${pageId}/children?${params.toString()}`, token);
    for (const block of data.results || []) {
      const text = blockText(block);
      if (text) lines.push(text);
      if (block.has_children) {
        const childLines = await readBlocks(block.id, token, depth + 1);
        lines.push(...childLines.map(line => `  ${line}`));
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return lines;
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'POST only');

  const auth = authenticateToolRequest(req);
  if (!auth.ok) {
    return sendError(res, auth.status || 401, auth.status === 503 ? 'auth_not_configured' : 'unauthorized', auth.error, auth.details);
  }
  const permissionError = requireScope(auth, 'knowledge:write');
  if (permissionError) {
    return sendError(res, 403, permissionError.code, permissionError.message, { requiredScope: permissionError.requiredScope });
  }

  const token = notionToken();
  if (!token) {
    return sendError(res, 503, 'notion_not_configured', 'NOTION_API_KEY or NOTION_TOKEN is not configured in Vercel.');
  }

  const pageId = parsePageId(req.body?.pageId || req.body?.url);
  if (!pageId) return sendError(res, 400, 'invalid_input', 'Notion page URL or page ID is required.');

  try {
    const page = await notionFetch(`/pages/${pageId}`, token);
    const lines = await readBlocks(pageId, token);
    const content = lines.join('\n').trim();
    if (!content) return sendError(res, 404, 'no_content', 'No readable text blocks were found on that Notion page.');

    const document = await saveKnowledgeDocument({
      title: req.body?.title || pageTitle(page),
      sourceType: 'notion',
      sourceName: req.body?.url || pageId,
      content,
    });

    return res.status(200).json({ ok: true, document, importedBlocks: lines.length });
  } catch (error) {
    console.error('[ai/connectors/notion]', error.message);
    return sendError(res, 500, 'notion_import_failed', error.message);
  }
}
