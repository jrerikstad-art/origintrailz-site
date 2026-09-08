import { checkFieldToken, handleOptions, json, PIPELINE_REVISION } from '../../lib/world-api/http.js';
import { workerHealth } from '../../lib/world-api/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') return json(res, req, 405, { ok: false, error: 'method' });

  const wh = workerHealth();
  const queueAgeMs = wh.staleMs;
  const processingOk =
    wh.active > 0 || queueAgeMs == null || queueAgeMs < 15 * 60 * 1000;

  const bakeMode = (process.env.OTZ_BAKE_MODE || 'stub').toLowerCase();
  const blobConfigured = !!(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  const blobPublic = !!(process.env.OTZ_BLOB_PUBLIC_BASE || '').trim();

  json(res, req, 200, {
    ok: true,
    gate: 'PUBLIC.WORLD.VERCEL',
    api: 'up',
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
    autoPublish: bakeMode === 'sandbox' && blobConfigured,
    durableStore: blobConfigured,
    tileProxy: blobPublic,
    fieldTokenRequired: !!(process.env.OTZ_FIELD_TOKEN || '').trim(),
    cellOnly: true,
    pipelineRevision: PIPELINE_REVISION,
    geography: 'Norway / EPSG:25832',
    note:
      bakeMode === 'stub' || !blobConfigured
        ? 'Enqueue works, but new cells outside the APK pack will not appear until OTZ_BAKE_MODE=sandbox + BLOB_READ_WRITE_TOKEN (+ public base) publish real tiles.'
        : undefined,
  });
}
