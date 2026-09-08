/**
 * Proxy / serve published world assets.
 * Prefer Blob public URLs when OTZ_BLOB_PUBLIC_BASE is set; else 404 with hint.
 *
 * Client paths: /api/world/world/terrain/...  (generationApiBase + /world/...)
 */
import { corsHeaders, handleOptions } from '../lib/http.js';
import { PIPELINE_REVISION } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, corsHeaders(req));
    res.end('method');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  // /api/world/world/terrain/... → terrain/...
  let rel = url.pathname.replace(/^\/api\/world\/world\/?/, '');
  if (!rel || rel.includes('..')) {
    res.writeHead(400, corsHeaders(req));
    res.end('bad path');
    return;
  }

  const base = (process.env.OTZ_BLOB_PUBLIC_BASE || '').replace(/\/$/, '');
  if (!base) {
    res.writeHead(404, {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'no_blob_base',
        message: 'Set OTZ_BLOB_PUBLIC_BASE to the Blob public prefix for published tiles',
        pipelineRevision: PIPELINE_REVISION,
        path: rel,
      }),
    );
    return;
  }

  const target = `${base}/published/${PIPELINE_REVISION}/${rel}`;
  try {
    const upstream = await fetch(target);
    const buf = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      ...corsHeaders(req),
      'Content-Type':
        upstream.headers.get('content-type') ||
        (rel.endsWith('.json') ? 'application/json' : 'application/octet-stream'),
      'Cache-Control': upstream.ok
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    };
    res.writeHead(upstream.status, headers);
    if (req.method !== 'HEAD') res.end(buf);
    else res.end();
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}

// Vercel: map all /api/world/world/* here via vercel.json rewrite
export const config = {
  api: { bodyParser: false },
};
