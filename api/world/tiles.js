/**
 * Proxy published world assets from Blob.
 * Mounted at /api/world/tiles?path=terrain/...  and rewritten from /api/world/world/*
 */
import { corsHeaders, handleOptions } from '../../lib/world-api/http.js';
import { PIPELINE_REVISION } from '../../lib/world-api/http.js';
import { getCell } from '../../lib/world-api/store.js';
import { validatedArtifactPrefix } from '../../lib/world-api/cell-artifacts.mjs';

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
  try { rel = decodeURIComponent(rel).replace(/^\/+/, ''); } catch {
    res.writeHead(400, corsHeaders(req)); res.end('bad_path'); return;
  }
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

  try {
    let prefix = `published/${PIPELINE_REVISION}/`;
    const tile = /^(terrain|semantic)\/((?:terrain|semantic)_(250|125)m_(\d+)_(\d+))\/(tile\.json|terrain\.bin)$/.exec(rel);
    if (tile) {
      const n = tile[1] === 'terrain' ? 4 : 8;
      const cellId = `NO-25832-${Math.floor(Number(tile[4]) / n)}-${Math.floor(Number(tile[5]) / n)}`;
      const row = await getCell(cellId);
      if (row?.state === 'READY') {
        prefix = validatedArtifactPrefix(cellId, PIPELINE_REVISION, row.artifactPrefix);
      }
    }
    const target = `${base}/${prefix}${rel}`;
    const upstream = await fetch(target, { signal: AbortSignal.timeout(15_000) });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      ...corsHeaders(req),
      'Content-Type':
        upstream.headers.get('content-type') ||
        (rel.endsWith('.json') ? 'application/json' : 'application/octet-stream'),
      // The underlying batch is immutable; this public URL follows the READY
      // pointer and must not cache an old pipeline revision for a year.
      'Cache-Control': upstream.ok ? 'public, max-age=60' : 'no-store',
    };
    res.writeHead(upstream.status, headers);
    if (req.method !== 'HEAD') res.end(buf);
    else res.end();
  } catch (e) {
    res.writeHead(502, { ...corsHeaders(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
}
