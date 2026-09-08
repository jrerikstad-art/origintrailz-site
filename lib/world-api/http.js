/** Shared CORS + auth for /api/world/* */

const ALLOWED = new Set([
  'https://origintrailz.com',
  'https://www.origintrailz.com',
  'http://127.0.0.1:18743',
  'http://localhost:18743',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

export function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = ALLOWED.has(origin) ? origin : 'https://origintrailz.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-OTZ-Field-Token, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleOptions(req, res) {
  res.writeHead(204, corsHeaders(req));
  res.end();
}

export function json(res, req, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function checkFieldToken(req) {
  const expected = (process.env.OTZ_FIELD_TOKEN || '').trim();
  if (!expected) return { ok: true, open: true };
  const header =
    (req.headers['x-otz-field-token'] || '').trim() ||
    ((req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1]?.trim() ||
    '';
  if (header !== expected) {
    return { ok: false, open: false };
  }
  return { ok: true, open: false };
}

export const PIPELINE_REVISION = process.env.OTZ_PIPELINE_REVISION || 'norway-g2-2026.09';
