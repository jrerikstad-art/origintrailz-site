/**
 * Cell registry + tile pointers.
 * Blob (when configured) is authoritative across isolates; memory is a warm cache.
 * Prefer the newer updatedAt when both sides have a row.
 */

import { PIPELINE_REVISION } from './http.js';
import { parseCellId } from './cell-artifacts.mjs';

/** @type {Map<string, any>} */
const mem = globalThis.__otzCellRegistry || new Map();
globalThis.__otzCellRegistry = mem;

/** @type {{ heartbeatAt: number, lastJobId: string|null, active: number }} */
const worker = globalThis.__otzWorkerHealth || {
  heartbeatAt: 0,
  lastJobId: null,
  active: 0,
};
globalThis.__otzWorkerHealth = worker;

function key(cellId) {
  return `${PIPELINE_REVISION}::${cellId}`;
}

function cellPathname(cellId) {
  parseCellId(cellId);
  return `cells/${PIPELINE_REVISION}/${encodeURIComponent(cellId)}.json`;
}

export function workerHealth() {
  return {
    ...worker,
    staleMs: worker.heartbeatAt ? Date.now() - worker.heartbeatAt : null,
  };
}

export function touchWorker(jobId) {
  worker.heartbeatAt = Date.now();
  worker.lastJobId = jobId || worker.lastJobId;
}

export function setWorkerActive(n) {
  worker.active = n;
  touchWorker(worker.lastJobId);
}

function newerRow(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a.updatedAt || 0) || 0;
  const tb = Date.parse(b.updatedAt || 0) || 0;
  return tb >= ta ? b : a;
}

async function readBlobCell(cellId) {
  if (!(process.env.BLOB_READ_WRITE_TOKEN || '').trim()) return null;
  const pathname = cellPathname(cellId);
  const bases = [
    process.env.OTZ_BLOB_PUBLIC_BASE,
    process.env.BLOB_PUBLIC_BASE,
  ]
    .map((v) => (v || '').trim().replace(/\/$/, ''))
    .filter(Boolean);

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/${pathname}?updated=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return await res.json();
    } catch {
      /* try next */
    }
  }

  // Last resort: list by prefix (works without a public CDN base).
  try {
    const { list } = await import('@vercel/blob');
    const listed = await list({ prefix: pathname, limit: 1 });
    const hit = (listed.blobs || []).find((b) => b.pathname === pathname);
    if (hit?.url) {
      const res = await fetch(`${hit.url}?updated=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return await res.json();
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function getCell(cellId) {
  const k = key(cellId);
  const fromMem = mem.get(k) || null;
  const fromBlob = await readBlobCell(cellId);
  const pick = newerRow(fromMem, fromBlob);
  if (pick) mem.set(k, pick);
  return pick;
}

export async function putCell(row) {
  const k = key(row.cellId);
  const next = {
    ...row,
    pipelineRevision: PIPELINE_REVISION,
    updatedAt: new Date().toISOString(),
  };
  try {
    if ((process.env.BLOB_READ_WRITE_TOKEN || '').trim()) {
      const { put } = await import('@vercel/blob');
      await put(cellPathname(row.cellId), JSON.stringify(next, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(15_000),
      });
    }
  } catch (e) {
    // A durable commit must never be reported after an unacknowledged write.
    // The caller can retry with the same cell/job id.
    throw new Error(`cell_store_write_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  mem.set(k, next);
  return next;
}

export async function enqueueCell(cellId) {
  parseCellId(cellId);
  const existing = await getCell(cellId);
  if (existing?.state === 'READY') {
    return { row: existing, alreadyReady: true, queued: false, inFlight: false };
  }
  if (
    existing &&
    ['QUEUED', 'GENERATING', 'VALIDATING'].includes(String(existing.state).toUpperCase()) &&
    Date.parse(existing.leaseExpiresAt || '') > Date.now()
  ) {
    return { row: existing, alreadyReady: false, queued: false, inFlight: true };
  }
  const row = await putCell({
    cellId,
    state: 'QUEUED',
    error: null,
    jobId: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    attempt: (existing?.attempt || 0) + 1,
    readyAt: null,
    leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    tileUrls: existing?.tileUrls || null,
  });
  return { row, alreadyReady: false, queued: true, inFlight: false };
}

/** Update only the currently leased attempt; stale worker completions are ignored. */
export async function updateJob(cellId, jobId, fields) {
  const current = await getCell(cellId);
  if (!current || current.jobId !== jobId) throw new Error('superseded_job');
  return putCell({ ...current, ...fields });
}

export async function listCells(cellIds) {
  const out = [];
  for (const id of cellIds) {
    const row = await getCell(id);
    out.push(
      row || {
        cellId: id,
        state: 'MISSING',
        pipelineRevision: PIPELINE_REVISION,
      },
    );
  }
  return out;
}
