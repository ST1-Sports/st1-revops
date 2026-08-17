import { setCors } from '../_lib/cors.js';
import { authenticateToolRequest } from '../_lib/ai-tools/auth.js';
import { validateToolInput } from '../_lib/ai-tools/schema.js';
import {
  getTool,
  invokeTool,
  listProviderFormats,
  listToolsForAuth,
  publicToolDefinition,
  rawToolCount,
  TOOL_USE_GUIDANCE,
} from '../_lib/ai-tools/registry.js';

export const config = {
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
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return sendError(res, 405, 'method_not_allowed', 'Use GET to list tools or POST to invoke a tool.');
  }

  const auth = authenticateToolRequest(req);
  if (!auth.ok) return sendAuthError(res, auth);

  if (req.method === 'GET') {
    const includeFormats = req.query?.formats === 'true';
    return res.status(200).json({
      ok: true,
      subject: auth.subject,
      totalRegisteredTools: rawToolCount(),
      tools: listToolsForAuth(auth),
      toolUseGuidance: TOOL_USE_GUIDANCE,
      ...(includeFormats ? { providerFormats: listProviderFormats(auth) } : {}),
      safety: {
        readOnly: true,
        arbitraryDatabaseAccess: false,
        exposesRawSql: false,
        exposesSecrets: false,
      },
    });
  }

  const { tool: toolName, name, input = {} } = req.body || {};
  const requestedToolName = toolName || name;
  if (!requestedToolName || typeof requestedToolName !== 'string') {
    return sendError(res, 400, 'invalid_request', 'Request body must include a tool name and input object.');
  }

  const tool = getTool(requestedToolName);
  if (!tool) {
    return sendError(res, 404, 'unknown_tool', `Unknown ST1 AI tool: ${requestedToolName}`, {
      availableTools: listToolsForAuth(auth).map(item => item.name),
    });
  }

  const validation = validateToolInput(tool, input);
  if (!validation.ok) {
    return res.status(400).json({
      tool: requestedToolName,
      ok: false,
      error: validation.error,
      schema: publicToolDefinition(tool).input_schema,
    });
  }

  try {
    const result = await invokeTool(tool, input, auth);
    return res.status(result.ok === false ? 403 : 200).json(result);
  } catch (error) {
    console.error('[ai/tools]', requestedToolName, error.message);
    return sendError(res, 500, 'tool_execution_failed', 'The ST1 tool failed while retrieving authoritative data.');
  }
}
