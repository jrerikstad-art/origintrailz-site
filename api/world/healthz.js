import { checkFieldToken, handleOptions, json, PIPELINE_REVISION } from '../_lib/http.js';
import { workerHealth } from '../_lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') return json(res, req, 405, { ok: false, error: 'method' });

  const wh = workerHealth();
  const queueAgeMs = wh.staleMs;
  const processingOk =
    wh.active > 0 || queueAgeMs == null || queueAgeMs < 15 * 60 * 1000;

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
    fieldTokenRequired: !!(process.env.OTZ_FIELD_TOKEN || '').trim(),
    cellOnly: true,
    pipelineRevision: PIPELINE_REVISION,
    geography: 'Norway / EPSG:25832',
  });
}
