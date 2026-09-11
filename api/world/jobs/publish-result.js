/**
 * Commit READY only after the complete immutable cell is readable from Blob.
 * The Python job may send local paths in publish-result.json; those paths are
 * deliberately ignored here because they are not publication proof.
 */
import {
  checkPublishToken,
  handleOptions,
  json,
  PIPELINE_REVISION,
  readJsonBody,
} from '../../../lib/world-api/http.js';
import { getCell, touchWorker, setWorkerActive, updateJob } from '../../../lib/world-api/store.js';
import { parseCellId, publicBase, verifyPublishedCell } from '../../../lib/world-api/cell-artifacts.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method' });
  if (!checkPublishToken(req).ok) return json(res, req, 401, { ok: false, error: 'unauthorized_publish' });

  let body;
  try {
    body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object_body_required');
  } catch {
    return json(res, req, 400, { ok: false, error: 'invalid_json' });
  }
  const cellId = String(body.cellId || '');
  try { parseCellId(cellId); } catch { return json(res, req, 400, { ok: false, error: 'unsupported_cell_id' }); }

  const row = await getCell(cellId);
  if (!row) return json(res, req, 404, { ok: false, error: 'not_queued' });
  if (body.jobId && body.jobId !== row.jobId) return json(res, req, 409, { ok: false, error: 'superseded_job' });

  if (body.state === 'FAILED') {
    const failed = await updateJob(cellId, body.jobId || row.jobId, {
      state: 'FAILED', error: String(body.error || 'bake_failed').slice(0, 500), leaseExpiresAt: null,
    });
    setWorkerActive(0);
    return json(res, req, 200, { ok: true, cell: failed });
  }

  const base = String(process.env.OTZ_BLOB_PUBLIC_BASE || '').trim();
  try { publicBase(base); } catch {
    return json(res, req, 503, { ok: false, error: 'blob_public_base_not_configured' });
  }
  const revision = String(body.pipelineRevision || PIPELINE_REVISION);
  if (revision !== PIPELINE_REVISION) return json(res, req, 409, { ok: false, error: 'pipeline_revision_mismatch' });

  setWorkerActive(1);
  try {
    const verified = await verifyPublishedCell({ cellId, revision, base, artifactPrefix: body.artifactPrefix });
    const ready = await updateJob(cellId, row.jobId, {
      state: 'READY',
      error: null,
      readyAt: new Date().toISOString(),
      leaseExpiresAt: null,
      pipelineRevision: revision,
      tileUrls: verified.tileUrls,
      artifactPrefix: verified.artifactPrefix,
      terrainTiles: verified.terrainTiles,
      semanticTiles: verified.semanticTiles,
      bytes: verified.bytes,
      durationMs: body.durationMs ?? null,
    });
    touchWorker(ready.jobId);
    return json(res, req, 200, { ok: true, cell: ready, verified: {
      terrainTiles: verified.terrainTiles, semanticTiles: verified.semanticTiles, bytes: verified.bytes,
    } });
  } catch (e) {
    // Leave the lease available for a retry; an incomplete upload is not a
    // FAILED cell and must not poison the registry permanently.
    return json(res, req, 400, {
      ok: false,
      error: 'tile_publication_not_verified',
      detail: String(e?.message || e).slice(0, 500),
      required: { terrainTiles: 16, semanticTiles: 64, terrainHeightFiles: 16 },
    });
  } finally { setWorkerActive(0); }
}
