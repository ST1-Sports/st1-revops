import { timingSafeEqual } from 'crypto';

export const ALL_READ_SCOPES = [
  'knowledge:read',
  'knowledge:write',
  'pricing:read',
  'product:read',
  'vendor:read',
  'brand:read',
  'customer:read',
  'customer:read:notes',
  'policy:read',
];

function splitScopes(raw) {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeKeyEntry(entry, fallbackSubject = 'ai-tool-client') {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { token: entry, subject: fallbackSubject, scopes: [...ALL_READ_SCOPES] };
  }
  if (typeof entry === 'object' && typeof entry.token === 'string') {
    return {
      token: entry.token,
      subject: entry.subject || entry.name || fallbackSubject,
      scopes: splitScopes(entry.scopes).length ? splitScopes(entry.scopes) : [...ALL_READ_SCOPES],
    };
  }
  return null;
}

function parseJsonKeyConfig(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry, idx) => normalizeKeyEntry(entry, `ai-tool-client-${idx + 1}`)).filter(Boolean);
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([subject, entry]) => normalizeKeyEntry(entry, subject))
        .filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

function parseCompactKeyConfig(raw) {
  // Format: token:scope1 scope2,other-token:scope1 scope2
  return raw.split(',')
    .map((entry, idx) => {
      const [token, scopes = ''] = entry.split(':');
      if (!token?.trim()) return null;
      return {
        token: token.trim(),
        subject: `ai-tool-client-${idx + 1}`,
        scopes: splitScopes(scopes).length ? splitScopes(scopes) : [...ALL_READ_SCOPES],
      };
    })
    .filter(Boolean);
}

export function getConfiguredToolKeys() {
  const configured = [];
  const defaultKey = process.env.ST1_AI_TOOL_API_KEY || process.env.ST1_AI_TOOL_KEY;

  if (defaultKey) {
    configured.push({
      token: defaultKey,
      subject: 'default-ai-tool-client',
      scopes: [...ALL_READ_SCOPES],
    });
  }

  const multiKeyConfig = (process.env.ST1_AI_TOOL_API_KEYS || '').trim();
  if (multiKeyConfig) {
    const parsed = multiKeyConfig.startsWith('{') || multiKeyConfig.startsWith('[')
      ? parseJsonKeyConfig(multiKeyConfig)
      : parseCompactKeyConfig(multiKeyConfig);
    configured.push(...parsed);
  }

  return configured.filter(entry => entry.token);
}

export function getBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/**
 * Hub and Scout run inside the signed-in app. If no bearer is sent, treat
 * the caller as the RevOps app with full tool scopes. External Claude/MCP
 * clients still send a bearer and are checked as usual.
 */
export function allowAppOrToolAuth(req) {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: true,
      subject: 'revops-app',
      scopes: new Set(ALL_READ_SCOPES),
    };
  }
  return authenticateToolRequest(req);
}

export function authenticateToolRequest(req) {
  const configured = getConfiguredToolKeys();
  if (!configured.length) {
    return {
      ok: false,
      status: 503,
      error: 'AI tool authentication is not configured',
      details: {
        expectedEnvVars: ['ST1_AI_TOOL_API_KEY', 'ST1_AI_TOOL_KEY', 'ST1_AI_TOOL_API_KEYS'],
        note: 'Set one of these variables in the same Vercel environment you are calling, then redeploy.',
      },
    };
  }

  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Missing bearer token',
    };
  }

  const match = configured.find(entry => safeEqual(token, entry.token));
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid bearer token',
    };
  }

  return {
    ok: true,
    subject: match.subject,
    scopes: new Set(match.scopes),
  };
}

export function hasScope(auth, scope) {
  if (!scope) return true;
  return Boolean(auth?.scopes?.has(scope) || auth?.scopes?.has('*'));
}

export function requireScope(auth, scope) {
  if (hasScope(auth, scope)) return null;
  return {
    code: 'permission_denied',
    message: `The caller is missing required scope: ${scope}`,
    requiredScope: scope,
  };
}
