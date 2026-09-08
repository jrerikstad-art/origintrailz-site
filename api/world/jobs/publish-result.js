/**
 * Commit READY after an external/cloud bake uploaded tiles to Blob.
 * Body: { cellId, tileUrls: { terrain: [...], semantic: [...] }, bytes?, durationMs? }
 *
 * tileUrls must be absolute https URLs (or paths under an https OTZ_BLOB_PUBLIC_BASE).
 * Relative local paths alone are rejected — they do not prove Blob publication.
 */
import {
  checkPublishToken,
  handleOptions,
  json,
  PIPELINE_REVISION,
} from '../../../lib/world-api/http.js';
import { getCell, putCell, touchWorker, setWorkerActive } from '../../../lib/world-api/store.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function isHttpsUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveUrl(u) {
  const s = String(u || '');
  if (isHttpsUrl(s)) return s;
  const base = (process.env.OTZ_BLOB_PUBLIC_BASE || '').trim().replace(/\/$/, '');
  if (base && s && !s.includes('://')) return `${base}/${s.replace(/^\//, '')}`;
  return null;
}

async function assertReadable(urls) {
  const checked = [];
  for (const u of urls) {
    const abs = resolveUrl(u);
    if (!abs) {
      return { ok: false, error: `not_https_url: ${u}` };
    }
    try {
      const res = await fetch(abs, { method: 'HEAD' });
      if (!res.ok) {
        // Some stores reject HEAD — try ranged GET
        const g = await fetch(abs, { method: 'GET', headers: { Range: 'bytes=0-0' } });
        if (!(g.ok || g.status === 206)) {
          return { ok: false, error: `unreachable_${g.status}: ${abs}` };
        }
      }
      checked.push(abs);
    } catch (e) {
      return {
        ok: false,
        error: `fetch_failed: ${abs}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  return { ok: true, urls: checked };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method' });

  const auth = checkPublishToken(req);
  if (!auth.ok) return json(res, req, 401, { ok: false, error: 'unauthorized_publish' });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, req, 400, { ok: false, error: 'invalid_json' });
  }

  const cellId = String(body.cellId || '');
  if (!cellId) return json(res, req, 400, { ok: false, error: 'cellId_required' });
  const row = (await getCell(cellId)) || { cellId, attempt: 1 };
  if (body.state === 'FAILED') {
    const failed = await putCell({
      ...row,
      state: 'FAILED',
      error: body.error || 'bake_failed',
    });
    setWorkerActive(0);
    return json(res, req, 200, { ok: true, cell: failed });
  }

  const tileUrls = body.tileUrls;
  if (!tileUrls || (!tileUrls.terrain?.length && !tileUrls.semantic?.length)) {
    return json(res, req, 400, { ok: false, error: 'tileUrls_required' });
  }

  const all = [...(tileUrls.terrain || []), ...(tileUrls.semantic || [])];
  const probe = await assertReadable(all.slice(0, 8)); // bound cost; require samples readable
  if (!probe.ok) {
    return json(res, req, 400, {
      ok: false,
      error: 'tile_urls_not_published',
      detail: probe.error,
      note: 'Publish HTTPS Blob URLs (or paths under OTZ_BLOB_PUBLIC_BASE). Relative local paths are rejected.',
    });
  }

  const normalized = {
    terrain: (tileUrls.terrain || []).map((u) => resolveUrl(u)).filter(Boolean),
    semantic: (tileUrls.semantic || []).map((u) => resolveUrl(u)).filter(Boolean),
  };
  if (!normalized.terrain.length && !normalized.semantic.length) {
    return json(res, req, 400, { ok: false, error: 'tile_urls_unresolvable' });
  }

  const ready = await putCell({
    ...row,
    state: 'READY',
    error: null,
    readyAt: new Date().toISOString(),
    tileUrls: normalized,
    bytes: body.bytes ?? null,
    durationMs: body.durationMs ?? null,
    pipelineRevision: PIPELINE_REVISION,
  });
  touchWorker(ready.jobId);
  setWorkerActive(0);
  return json(res, req, 200, { ok: true, cell: ready });
}
