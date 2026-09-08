/**
 * Commit READY after an external/cloud bake uploaded tiles to Blob.
 * Body: { cellId, tileUrls: { terrain: [...], semantic: [...] }, bytes?, durationMs? }
 */
import { checkFieldToken, handleOptions, json, PIPELINE_REVISION } from '../lib/http.js';
import { getCell, putCell, touchWorker, setWorkerActive } from '../lib/store.js';

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method' });

  const auth = checkFieldToken(req);
  if (!auth.ok) return json(res, req, 401, { ok: false, error: 'unauthorized' });

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

  const ready = await putCell({
    ...row,
    state: 'READY',
    error: null,
    readyAt: new Date().toISOString(),
    tileUrls,
    bytes: body.bytes ?? null,
    durationMs: body.durationMs ?? null,
    pipelineRevision: PIPELINE_REVISION,
  });
  touchWorker(ready.jobId);
  setWorkerActive(0);
  return json(res, req, 200, { ok: true, cell: ready });
}
