export function readInput(req) {
  return req.method === "GET" ? (req.query || {}) : (req.body || {});
}

export function requireString(input, key) {
  const value = String(input?.[key] || "").trim();
  if (!value) {
    const error = new Error(`${key} is required`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function optionalString(input, key) {
  const value = input?.[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

export function optionalDate(input, key) {
  const value = input?.[key];
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${key} must be a valid date`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

export function optionalLimit(input, fallback = 20, max = 100) {
  const n = Number(input?.limit || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function handleApiError(res, scope, error) {
  const status = error.statusCode || 500;
  console.error(`[st1/${scope}] error:`, error);
  return res.status(status).json({ error: error.message || "Internal server error" });
}
