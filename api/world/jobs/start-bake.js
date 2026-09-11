import { waitUntil } from '@vercel/functions';
import { checkFieldToken, handleOptions, json, PIPELINE_REVISION, readJsonBody } from '../../../lib/world-api/http.js';
import { getCell, updateJob, setWorkerActive } from '../../../lib/world-api/store.js';
import { parseCellId } from '../../../lib/world-api/cell-artifacts.mjs';
import { bakeConfiguration, runSandboxBake } from '../../../lib/world-api/sandbox-bake.mjs';

export const config = { maxDuration: 300 };

const activeJobs = globalThis.__otzActiveBakeJobs || new Set();
globalThis.__otzActiveBakeJobs = activeJobs;

export async function executeJob(row, bake = runSandboxBake) {
  if (activeJobs.has(row.jobId)) return null;
  activeJobs.add(row.jobId);
  setWorkerActive(1);
  try {
    const published = await bake({
      cellId: row.cellId,
      revision: PIPELINE_REVISION,
      snapshotId: process.env.OTZ_BAKE_SNAPSHOT_ID,
      base: process.env.OTZ_BLOB_PUBLIC_BASE,
      workdir: process.env.OTZ_BAKE_WORKDIR || '/vercel/sandbox/world-lab',
      timeoutMs: Math.min(Number(process.env.OTZ_BAKE_TIMEOUT_MS || 240_000), 240_000),
      onValidating: (details) => updateJob(row.cellId, row.jobId, {
        state: 'VALIDATING',
        ...details,
      }),
    });
    return await updateJob(row.cellId, row.jobId, {
      ...published,
      state: 'READY',
      error: null,
      readyAt: new Date().toISOString(),
      leaseExpiresAt: null,
    });
  } catch (e) {
    // Do not let a stale worker replace a newer attempt. Lease expiry lets a
    // later request retry a crashed job.
    if (e?.message !== 'superseded_job') {
      await updateJob(row.cellId, row.jobId, {
        state: 'FAILED',
        error: String(e?.message || e).slice(0, 500),
        leaseExpiresAt: null,
      }).catch(() => {});
    }
    return null;
  } finally {
    activeJobs.delete(row.jobId);
    setWorkerActive(0);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method' });
  if (!checkFieldToken(req).ok) return json(res, req, 401, { ok: false, error: 'unauthorized' });

  let body;
  try {
    body = await readJsonBody(req);
    parseCellId(String(body.cellId || ''));
  } catch {
    return json(res, req, 400, { ok: false, error: 'invalid_cell_request' });
  }
  const cellId = String(body.cellId);
  const jobId = String(body.jobId || '');
  if (!jobId) return json(res, req, 400, { ok: false, error: 'jobId_required' });

  const settings = bakeConfiguration();
  if (!settings.configured) {
    return json(res, req, 503, { ok: false, error: 'sandbox_not_configured',
      mode: settings.mode, autoPublish: false, missing: settings.missing });
  }

  try {
    // Registry state is authoritative; a caller-provided row is only a hint.
    const row = await getCell(cellId);
    if (!row) return json(res, req, 404, { ok: false, error: 'not_queued' });
    if (row.state === 'READY') return json(res, req, 200, { ok: true, state: 'READY', cell: row });
    if (row.jobId !== jobId) return json(res, req, 409, { ok: false, error: 'superseded_job' });
    if (['GENERATING', 'VALIDATING'].includes(String(row.state).toUpperCase())) {
      return json(res, req, 202, { ok: true, state: row.state, cell: row });
    }
    if (row.state !== 'QUEUED') return json(res, req, 409, { ok: false, error: 'not_queued' });

    const running = await updateJob(cellId, jobId, {
      state: 'GENERATING',
      error: null,
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    // `waitUntil` keeps the bounded bake alive after the 202 response. This
    // is intentionally finite; it is not a claim of an unlimited queue.
    waitUntil(executeJob(running));
    return json(res, req, 202, { ok: true, mode: 'sandbox', state: 'GENERATING', cell: running });
  } catch {
    return json(res, req, 503, { ok: false, error: 'bake_start_failed' });
  }
}
