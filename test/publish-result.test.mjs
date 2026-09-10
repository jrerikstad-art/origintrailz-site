import assert from 'node:assert/strict';
import test from 'node:test';
import publishResult from '../api/world/jobs/publish-result.js';
import { putCell, getCell } from '../lib/world-api/store.js';
import { expectedTiles } from '../lib/world-api/cell-artifacts.mjs';

const CELL = 'NO-25832-319-6532';
const REV = 'norway-g2-2026.09';

function response() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function filesFor(cellId) {
  const files = new Map();
  for (const t of expectedTiles(cellId)) {
    const meta = {
      schema: `otz-${t.kind}/1.0`, id: t.id, kind: t.kind,
      chunkIndex: { ix: t.ix, iy: t.iy }, sizeMeters: t.size,
      origin: { crs: 'EPSG:25832', easting: t.ix * t.size + t.size / 2,
        northing: t.iy * t.size + t.size / 2, swEasting: t.ix * t.size, swNorthing: t.iy * t.size },
      provenance: { cellId },
    };
    if (t.kind === 'terrain') {
      meta.terrain = { grid: 3, encoding: 'uint16', byteOrder: 'little', minM: 1, maxM: 2,
        uri: 'terrain.bin', row0: 'north', col0: 'west' };
      files.set(t.rel.replace(/tile\.json$/, 'terrain.bin'), Buffer.alloc(18));
    } else {
      for (const key of ['roads', 'buildings', 'water', 'forests']) meta[key] = [];
      meta.terrainParentId = `terrain_250m_${Math.floor(t.ix / 2)}_${Math.floor(t.iy / 2)}`;
    }
    files.set(t.rel, Buffer.from(JSON.stringify(meta)));
  }
  return files;
}

test('publish-result requires every tile and height payload before READY', async () => {
  const oldBase = process.env.OTZ_BLOB_PUBLIC_BASE;
  const oldRevision = process.env.OTZ_PIPELINE_REVISION;
  process.env.OTZ_BLOB_PUBLIC_BASE = 'https://blob.example.test';
  process.env.OTZ_PIPELINE_REVISION = REV;
  const row = await putCell({ cellId: CELL, jobId: 'job_publish_test', state: 'GENERATING', attempt: 1 });
  const files = filesFor(CELL);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const rel = new URL(url).pathname.replace(/^\/+/, '').replace(`published/${REV}/`, '');
    const data = files.get(rel);
    return data ? new Response(data, { status: 200 }) : new Response('', { status: 404 });
  };
  try {
    const req = { method: 'POST', headers: {}, body: { cellId: CELL, jobId: row.jobId } };
    const res = response();
    await publishResult(req, res);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.verified, { terrainTiles: 16, semanticTiles: 64, bytes: res.body.verified.bytes });
    assert.equal((await getCell(CELL)).state, 'READY');
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.OTZ_BLOB_PUBLIC_BASE; else process.env.OTZ_BLOB_PUBLIC_BASE = oldBase;
    if (oldRevision === undefined) delete process.env.OTZ_PIPELINE_REVISION; else process.env.OTZ_PIPELINE_REVISION = oldRevision;
  }
});

test('publish-result rejects null and array bodies without throwing', async () => {
  const oldPublish = process.env.OTZ_PUBLISH_TOKEN;
  const oldField = process.env.OTZ_FIELD_TOKEN;
  delete process.env.OTZ_PUBLISH_TOKEN;
  delete process.env.OTZ_FIELD_TOKEN;
  for (const body of [null, []]) {
    const req = { method: 'POST', headers: {}, body };
    const res = response();
    await publishResult(req, res);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_json');
  }
  if (oldPublish === undefined) delete process.env.OTZ_PUBLISH_TOKEN; else process.env.OTZ_PUBLISH_TOKEN = oldPublish;
  if (oldField === undefined) delete process.env.OTZ_FIELD_TOKEN; else process.env.OTZ_FIELD_TOKEN = oldField;
});
