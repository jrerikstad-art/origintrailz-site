/** Shared CORS + auth for /api/world/* */

const ALLOWED = new Set([
  'https://origintrailz.com',
  'https://www.origintrailz.com',
  'https://origintrailz-site.vercel.app',
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
    'Access-Control-Allow-Headers': 'Content-Type, X-OTZ-Field-Token, X-OTZ-Publish-Token, Authorization',
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

function bearerOrFieldHeader(req) {
  return (
    (req.headers['x-otz-field-token'] || '').trim() ||
    ((req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1]?.trim() ||
    ''
  );
}

/** Client enqueue / status. Open only when OTZ_FIELD_TOKEN is unset (dev). */
export function checkFieldToken(req) {
  const expected = (process.env.OTZ_FIELD_TOKEN || '').trim();
  if (!expected) return { ok: true, open: true };
  if (bearerOrFieldHeader(req) !== expected) {
    return { ok: false, open: false };
  }
  return { ok: true, open: false };
}

/**
 * Job/operator publication. Requires OTZ_PUBLISH_TOKEN when set;
 * otherwise falls back to field token. Never open when both are unset in prod
 * if OTZ_REQUIRE_PUBLISH_AUTH=1.
 */
export function checkPublishToken(req) {
  const publish = (process.env.OTZ_PUBLISH_TOKEN || '').trim();
  const field = (process.env.OTZ_FIELD_TOKEN || '').trim();
  const header =
    (req.headers['x-otz-publish-token'] || '').trim() || bearerOrFieldHeader(req);
  if (publish) {
    return header === publish ? { ok: true, open: false } : { ok: false, open: false };
  }
  if (field) {
    return header === field ? { ok: true, open: false } : { ok: false, open: false };
  }
  if ((process.env.OTZ_REQUIRE_PUBLISH_AUTH || '').trim() === '1') {
    return { ok: false, open: false };
  }
  return { ok: true, open: true };
}

export const PIPELINE_REVISION = process.env.OTZ_PIPELINE_REVISION || 'norway-g2-2026.09';

/** Read a small JSON request body in both Vercel's parsed and raw Node forms. */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(req.body) > 64 * 1024) throw new Error('body_too_large');
    return JSON.parse(req.body.toString());
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error('body_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
