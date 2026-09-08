/**
 * Proxy published world assets from Blob.
 * Mounted at /api/world/tiles?path=terrain/...  and rewritten from /api/world/world/*
 */
import { corsHeaders, handleOptions } from '../../lib/world-api/http.js';
import { PIPELINE_REVISION } from '../../lib/world-api/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, corsHeaders(req));
    res.end('method');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  let rel =
    url.searchParams.get('path') ||
    url.pathname.replace(/^\/api\/world\/(?:tiles|world)\/?/, '');
  // Support rewrite that leaves path in pathname after /api/world/tiles/
  if (rel.startsWith('api/')) {
    rel = rel.replace(/^api\/world\/(?:tiles|world)\/?/, '');
  }
  rel = decodeURIComponent(rel).replace(/^\/+/, '');
  if (!rel || rel.includes('..')) {
    res.writeHead(400, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'bad_path', path: rel }));
    return;
  }

  const base = (process.env.OTZ_BLOB_PUBLIC_BASE || '').replace(/\/$/, '');
  if (!base) {
    res.writeHead(404, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'no_blob_base',
        message: 'Set OTZ_BLOB_PUBLIC_BASE to the Blob public host',
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
      'Cache-Control': upstream.ok ? 'public, max-age=31536000, immutable' : 'no-store',
    };
    res.writeHead(upstream.status, headers);
    if (req.method !== 'HEAD') res.end(buf);
    else res.end();
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
