/**
 * Bake starter for /api/world.
 *
 * Modes (OTZ_BAKE_MODE):
 * - stub (default): enqueue only — does NOT auto-publish (manual cloud_cell_job is separate)
 * - sandbox: create/run Sandbox with cloud_cell_job.py → Blob → READY
 *
 * sandbox_not_fully_wired verdict:
 * Configuring OTZ_BAKE_SNAPSHOT_ID alone is NOT enough if this file still
 * short-circuits. This handler now runs the job when snapshot + Blob token
 * are present. Remaining gaps are operational (snapshot image must contain
 * world-lab tools + numpy/Pillow/pyproj/tifffile + DEM/OSM network access).
 */

import { checkFieldToken, handleOptions, json, PIPELINE_REVISION } from '../../../lib/world-api/http.js';
import { getCell, putCell, setWorkerActive, touchWorker } from '../../../lib/world-api/store.js';

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

  const row = await getCell(cellId);
  if (!row) return json(res, req, 404, { ok: false, error: 'not_queued' });
  if (row.state === 'READY') {
    return json(res, req, 200, { ok: true, state: 'READY', cell: row });
  }

  const mode = (process.env.OTZ_BAKE_MODE || 'stub').toLowerCase();
  setWorkerActive(1);
  touchWorker(row.jobId);
  await putCell({ ...row, state: 'GENERATING', error: null });

  if (mode === 'sandbox') {
    const snapshotId = (process.env.OTZ_BAKE_SNAPSHOT_ID || '').trim();
    const blobTok = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
    if (!snapshotId || !blobTok) {
      const missing = [
        !snapshotId ? 'OTZ_BAKE_SNAPSHOT_ID' : null,
        !blobTok ? 'BLOB_READ_WRITE_TOKEN' : null,
      ].filter(Boolean);
      await putCell({
        ...row,
        state: 'FAILED',
        error: `sandbox_env_incomplete: missing ${missing.join(',')}`,
      });
      setWorkerActive(0);
      return json(res, req, 501, {
        ok: false,
        error: 'sandbox_env_incomplete',
        missing,
        note:
          'Snapshot alone is not enough until these envs exist; the launcher code path itself is implemented below when they are set.',
      });
    }

    try {
      const { Sandbox } = await import('@vercel/sandbox');
      const t0 = Date.now();
      const sandbox = await Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        resources: { vcpus: Number(process.env.OTZ_BAKE_VCPUS || 4) },
        timeout: Number(process.env.OTZ_BAKE_TIMEOUT_MS || 15 * 60 * 1000),
      });

      const outDir = '/tmp/otz-out';
      const run = await sandbox.runCommand({
        cmd: 'python',
        args: [
          'tools/factory/cloud_cell_job.py',
          '--cell-id',
          cellId,
          '--out',
          outDir,
          '--pipeline-revision',
          PIPELINE_REVISION,
        ],
        cwd: process.env.OTZ_BAKE_WORKDIR || '/workspace/world-lab',
      });

      const code = run.exitCode ?? run.code ?? -1;
      if (code !== 0) {
        const errText =
          (typeof run.stderr === 'string' ? run.stderr : '') ||
          `cloud_cell_job exit ${code}`;
        await putCell({
          ...row,
          state: 'FAILED',
          error: errText.slice(0, 2000),
          sandboxId: sandbox.sandboxId,
        });
        setWorkerActive(0);
        try {
          await sandbox.stop();
        } catch {
          /* ignore */
        }
        return json(res, req, 500, {
          ok: false,
          error: 'bake_failed',
          detail: errText.slice(0, 500),
          sandboxId: sandbox.sandboxId,
        });
      }

      // Pull published tree from sandbox when SDK supports download; else expect
      // cloud_cell_job to have pushed via network (future). Local bridge: read
      // publish-result.json content from stdout.
      let publish;
      try {
        const pr = await sandbox.runCommand({
          cmd: 'cat',
          args: [`${outDir}/publish-result.json`],
        });
        const raw = typeof pr.stdout === 'string' ? pr.stdout : '';
        publish = JSON.parse(raw);
      } catch (e) {
        await putCell({
          ...row,
          state: 'FAILED',
          error: `sandbox_publish_result_unreadable: ${e instanceof Error ? e.message : String(e)}`,
          sandboxId: sandbox.sandboxId,
        });
        setWorkerActive(0);
        try {
          await sandbox.stop();
        } catch {
          /* ignore */
        }
        return json(res, req, 501, {
          ok: false,
          error: 'sandbox_artifact_bridge_incomplete',
          note:
            'Job ran but artifact download/upload bridge needs SDK file pull or in-sandbox Blob upload. Code path is not finished for file egress.',
          sandboxId: sandbox.sandboxId,
        });
      }

      if (publish.state === 'READY' && publish.tileUrls) {
        // Prefer URLs already uploaded from inside the sandbox job if present as https.
        const ready = await putCell({
          ...row,
          state: 'READY',
          error: null,
          readyAt: new Date().toISOString(),
          tileUrls: publish.tileUrls,
          bytes: publish.bytes ?? null,
          durationMs: publish.durationMs ?? Date.now() - t0,
          sandboxId: sandbox.sandboxId,
        });
        setWorkerActive(0);
        try {
          await sandbox.stop();
        } catch {
          /* ignore */
        }
        return json(res, req, 200, { ok: true, mode: 'sandbox', cell: ready });
      }

      await putCell({
        ...row,
        state: 'FAILED',
        error: publish.error || 'bake_not_ready',
        sandboxId: sandbox.sandboxId,
      });
      setWorkerActive(0);
      try {
        await sandbox.stop();
      } catch {
        /* ignore */
      }
      return json(res, req, 500, { ok: false, error: publish.error || 'bake_not_ready' });
    } catch (e) {
      await putCell({
        ...row,
        state: 'FAILED',
        error: e instanceof Error ? e.message : String(e),
      });
      setWorkerActive(0);
      return json(res, req, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // stub: durable QUEUED/GENERATING — does not auto-publish
  setWorkerActive(0);
  touchWorker(row.jobId);
  return json(res, req, 202, {
    ok: true,
    mode: 'stub',
    state: 'GENERATING',
    cellId,
    jobId: row.jobId,
    autoPublish: false,
    next: 'Set OTZ_BAKE_MODE=sandbox with snapshot+Blob, or run cloud_cell_job.py and POST publish-result',
    pipelineRevision: PIPELINE_REVISION,
  });
}
