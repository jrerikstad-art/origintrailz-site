import { checkFieldToken, handleOptions, json, readJsonBody } from '../../../lib/world-api/http.js';
import { enqueueCell, getCell, touchWorker } from '../../../lib/world-api/store.js';
import { parseCellId } from '../../../lib/world-api/cell-artifacts.mjs';
import { bakeConfiguration } from '../../../lib/world-api/sandbox-bake.mjs';

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
    body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object_body_required');
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

  try {
    parseCellId(String(cellId));
  } catch {
    return json(res, req, 400, { ok: false, error: 'unsupported_cell_id' });
  }

  // Do not put a phone into an endless QUEUED/poll loop when no worker exists.
  // Already published cells remain readable while generation is disabled.
  const settings = bakeConfiguration();
  if (!settings.configured) {
    let existing;
    try { existing = await getCell(String(cellId)); } catch {
      return json(res, req, 503, { ok: false, error: 'cell_store_unavailable' });
    }
    if (existing?.state === 'READY') {
      return json(res, req, 409, { ok: false, message: 'already READY', cell: existing,
        alreadyReady: [cellId], queued: [], inFlight: [] });
    }
    return json(res, req, 503, {
      ok: false, error: 'generation_unavailable', autoPublish: false,
      mode: settings.mode, missing: settings.missing,
      message: 'The public terrain worker is not configured. No bake was queued.',
    });
  }

  let result;
  try {
    result = await enqueueCell(String(cellId));
  } catch {
    return json(res, req, 503, { ok: false, error: 'cell_store_unavailable' });
  }
  touchWorker(result.row.jobId);

  let launch = null;
  if (result.queued) {
    launch = await kickStartBake(req, String(cellId), result.row.jobId, result.row);
    // The starter owns all later state. Writing result.row here used to
    // overwrite GENERATING, FAILED, or READY with our stale QUEUED snapshot.
    result.row = (await getCell(String(cellId))) || result.row;
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
