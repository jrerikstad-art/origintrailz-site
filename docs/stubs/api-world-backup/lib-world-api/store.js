/**
 * Cell registry + tile pointers.
 * Uses in-memory map (warm isolate) + optional Vercel Blob JSON when
 * BLOB_READ_WRITE_TOKEN is configured. Not a substitute for Postgres leases
 * under multi-region load — see docs/PUBLIC-WORLD-VERCEL.md.
 */

import { PIPELINE_REVISION } from './http.js';

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

export async function getCell(cellId) {
  const k = key(cellId);
  if (mem.has(k)) return mem.get(k);
  // Optional Blob read
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { head } = await import('@vercel/blob');
      // listing individual JSON objects by pathname
      const pathname = `cells/${PIPELINE_REVISION}/${encodeURIComponent(cellId)}.json`;
      const url = process.env.OTZ_BLOB_PUBLIC_BASE
        ? `${process.env.OTZ_BLOB_PUBLIC_BASE.replace(/\/$/, '')}/${pathname}`
        : null;
      if (url) {
        const res = await fetch(url);
        if (res.ok) {
          const row = await res.json();
          mem.set(k, row);
          return row;
        }
      }
      void head;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function putCell(row) {
  const k = key(row.cellId);
  const next = {
    ...row,
    pipelineRevision: PIPELINE_REVISION,
    updatedAt: new Date().toISOString(),
  };
  mem.set(k, next);
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const pathname = `cells/${PIPELINE_REVISION}/${encodeURIComponent(row.cellId)}.json`;
      await put(pathname, JSON.stringify(next, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    }
  } catch (e) {
    console.warn('[otz-store] blob put failed', e);
  }
  return next;
}

export async function enqueueCell(cellId) {
  const existing = await getCell(cellId);
  if (existing?.state === 'READY') {
    return { row: existing, alreadyReady: true, queued: false, inFlight: false };
  }
  if (
    existing &&
    ['QUEUED', 'GENERATING', 'VALIDATING'].includes(String(existing.state).toUpperCase())
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
    tileUrls: existing?.tileUrls || null,
  });
  return { row, alreadyReady: false, queued: true, inFlight: false };
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
