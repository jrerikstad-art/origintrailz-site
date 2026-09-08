import { checkFieldToken, handleOptions, json } from '../../../lib/world-api/http.js';
import { enqueueCell, putCell, touchWorker } from '../../../lib/world-api/store.js';

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

async function kickStartBake(req, cellId, jobId, cellRow) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return { ok: false, error: 'missing_host' };

  const url = `${proto}://${host}/api/world/jobs/start-bake`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(process.env.OTZ_START_BAKE_WAIT_MS || 25000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OTZ-Field-Token': req.headers['x-otz-field-token'] || '',
        Authorization: req.headers.authorization || '',
      },
      body: JSON.stringify({ cellId, jobId, cell: cellRow }),
      signal: ac.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.name === 'AbortError' ? 'start_bake_timeout' : e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
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

  const result = await enqueueCell(String(cellId));
  touchWorker(result.row.jobId);

  let launch = null;
  if (result.queued) {
    launch = await kickStartBake(req, String(cellId), result.row.jobId, result.row);
    await putCell({
      ...result.row,
      launchOk: !!launch.ok,
      launchStatus: launch.status ?? null,
      launchError: launch.ok ? null : launch.error || launch.body?.error || 'start_bake_failed',
      // If stub mode queued generation, keep QUEUED/GENERATING from starter;
      // only annotate launch when starter could not be reached.
      state: result.row.state,
    });
  }

  if (result.alreadyReady) {
    // Compat: keep 409 for already READY; clients treat as success during migration.
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
    launch,
  });
}
