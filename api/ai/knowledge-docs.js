import { setCors } from '../_lib/cors.js';
import { authenticateToolRequest, requireScope } from '../_lib/ai-tools/auth.js';
import {
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  saveKnowledgeDocument,
} from '../_lib/ai-tools/sources.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
  maxDuration: 30,
};

function sendAuthError(res, auth) {
  return res.status(auth.status || 401).json({
    ok: false,
    error: {
      code: auth.status === 503 ? 'auth_not_configured' : 'unauthorized',
      message: auth.error,
      ...(auth.details ? { details: auth.details } : {}),
    },
  });
}

function sendError(res, status, code, message, details) {
  return res.status(status).json({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

function validateDocInput(body) {
  const errors = [];
  const title = String(body?.title || '').trim();
  const sourceType = String(body?.sourceType || '').trim();
  const content = String(body?.content || '').trim();
  if (title.length < 2) errors.push('title must be at least 2 characters');
  if (!['upload', 'notion', 'google_drive', 'manual'].includes(sourceType)) {
    errors.push('sourceType must be upload, notion, google_drive, or manual');
  }
  if (content.length < 2) errors.push('content must be at least 2 characters');
  if (content.length > 200_000) errors.push('content must be 200,000 characters or less');
  return errors;
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return sendError(res, 405, 'method_not_allowed', 'Use GET, POST, or DELETE.');
  }

  const auth = authenticateToolRequest(req);
  if (!auth.ok) return sendAuthError(res, auth);

  const neededScope = req.method === 'GET' ? 'knowledge:read' : 'knowledge:write';
  const permissionError = requireScope(auth, neededScope);
  if (permissionError) {
    return sendError(res, 403, permissionError.code, permissionError.message, {
      requiredScope: permissionError.requiredScope,
    });
  }

  try {
    if (req.method === 'GET') {
      const documents = await listKnowledgeDocuments();
      return res.status(200).json({ ok: true, documents });
    }

    if (req.method === 'POST') {
      const errors = validateDocInput(req.body || {});
      if (errors.length) return sendError(res, 400, 'invalid_input', 'Document input is invalid.', errors);
      const document = await saveKnowledgeDocument({
        title: req.body.title,
        sourceType: req.body.sourceType,
        sourceName: req.body.sourceName,
        content: req.body.content,
      });
      return res.status(200).json({ ok: true, document });
    }

    const id = String(req.query?.id || req.body?.id || '').trim();
    if (!id) return sendError(res, 400, 'invalid_input', 'Document id is required.');
    const result = await deleteKnowledgeDocument(id);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[ai/knowledge-docs]', error.message);
    return sendError(res, 500, 'knowledge_docs_failed', 'Knowledge document operation failed.');
  }
}
