import { handleOptions, json, PIPELINE_REVISION } from '../../lib/world-api/http.js';
import { workerHealth } from '../../lib/world-api/store.js';
import { bakeConfiguration } from '../../lib/world-api/sandbox-bake.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') return json(res, req, 405, { ok: false, error: 'method' });

  const wh = workerHealth();
  const queueAgeMs = wh.staleMs;
  const processingOk =
    wh.active > 0 || queueAgeMs == null || queueAgeMs < 15 * 60 * 1000;

  const settings = bakeConfiguration();
  const bakeMode = settings.mode;
  const blobConfigured = !!(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  const blobPublic = !!(process.env.OTZ_BLOB_PUBLIC_BASE || '').trim();
  const bakeConfigured = settings.configured;

  json(res, req, 200, {
    ok: true,
    gate: 'PUBLIC.WORLD.VERCEL',
    api: 'up',
    workerImplementation: 'cell-artifact-bridge-v2',
    readyForGeneration: bakeConfigured,
    worker: {
      ok: processingOk,
      active: wh.active,
      lastHeartbeatAt: wh.heartbeatAt || null,
      lastJobId: wh.lastJobId,
      note:
        wh.heartbeatAt === 0
          ? 'no worker heartbeat yet (on-demand jobs idle is normal)'
          : processingOk
            ? 'ok'
            : 'queue age without progress',
    },
    bakeMode,
    autoPublish: bakeConfigured,
    sandboxConfigured: bakeConfigured,
    sandboxMissing: settings.missing,
    durableStore: blobConfigured,
    tileProxy: blobPublic,
    fieldTokenRequired: !!(process.env.OTZ_FIELD_TOKEN || '').trim(),
    cellOnly: true,
    pipelineRevision: PIPELINE_REVISION,
    geography: 'Norway / EPSG:25832',
    note:
      bakeMode === 'stub'
        ? 'The API is up, but generation is disabled. Configure the Python snapshot and set OTZ_BAKE_MODE=sandbox before an outside-pack field test.'
        : !bakeConfigured
          ? 'Auto-bake is disabled until a verified snapshot, Blob token, and HTTPS Blob public base are configured.'
          : undefined,
  });
}
