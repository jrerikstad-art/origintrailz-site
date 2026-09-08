import { checkFieldToken, handleOptions, json } from '../../lib/world-api/http.js';
import { enqueueCell, touchWorker } from '../../lib/world-api/store.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
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

  const cellId = body.cellId || body.cell_id;
  if (!cellId) {
    return json(res, req, 400, {
      ok: false,
      error: 'cellId_required',
      message: 'WORLD.DISTRIBUTION privacy: send cellId only (no lon/lat)',
    });
  }
  if ((body.lon != null || body.lat != null) && !(process.env.OTZ_ALLOW_LONLAT === '1')) {
    // Ignore lon/lat when cellId present (compat); reject lon/lat-only above.
  }

  const result = await enqueueCell(String(cellId));
  touchWorker(result.row.jobId);

  // Fire-and-forget kick of the bake starter (best-effort in this isolate).
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (result.queued && host) {
    const url = `${proto}://${host}/api/world/jobs/start-bake`;
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OTZ-Field-Token': req.headers['x-otz-field-token'] || '',
        Authorization: req.headers.authorization || '',
      },
      body: JSON.stringify({ cellId, jobId: result.row.jobId }),
    }).catch(() => {});
  }

  if (result.alreadyReady) {
    return json(res, req, 409, {
      ok: false,
      message: 'already READY',
      queued: [],
      alreadyReady: [cellId],
      inFlight: [],
      cell: result.row,
    });
  }

  return json(res, req, 202, {
    ok: true,
    queued: result.queued ? [cellId] : [],
    alreadyReady: [],
    inFlight: result.inFlight ? [cellId] : [],
    cell: result.row,
  });
}
