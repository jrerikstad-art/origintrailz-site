import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGenerationReady, assertOutsidePack, verifyPublicWorld } from '../scripts/verify-public-world.mjs';
import { bakeConfiguration } from '../lib/world-api/sandbox-bake.mjs';
import { expectedTiles, collectCell, uploadCell } from '../lib/world-api/cell-artifacts.mjs';
import { getCell, putCell } from '../lib/world-api/store.js';
import tileProxy from '../api/world/tiles.js';

const CELL = 'NO-25832-318-6547';
const REV = 'norway-g2-2026.09';
const BASE = 'https://factory.example.test/api/world';
const COVERAGE = { terrain: { terrain_250m_1278_26124: { state: 'READY' } } };
const HEALTH = { bakeMode: 'sandbox', autoPublish: true, sandboxConfigured: true,
  durableStore: true, tileProxy: true, pipelineRevision: REV };
function fixture() {
  const files = new Map();
  for (const t of expectedTiles(CELL)) {
    const meta = { schema: `otz-${t.kind}/1.0`, kind: t.kind, id: t.id,
      sizeMeters: t.size, chunkIndex: { ix: t.ix, iy: t.iy },
      origin: { crs: 'EPSG:25832', swEasting: t.ix * t.size, swNorthing: t.iy * t.size },
      provenance: { cellId: CELL } };
    if (t.kind === 'terrain') {
      meta.terrain = { uri: 'terrain.bin', grid: 3, encoding: 'uint16', byteOrder: 'little',
        row0: 'north', col0: 'west', minM: 10, maxM: 40 };
      files.set(t.rel.replace('tile.json', 'terrain.bin'), Buffer.alloc(18));
    } else {
      meta.terrainParentId = `terrain_250m_${Math.floor(t.ix / 2)}_${Math.floor(t.iy / 2)}`;
      for (const key of ['roads', 'water', 'buildings', 'forests']) meta[key] = [];
    }
    files.set(t.rel, Buffer.from(JSON.stringify(meta)));
  }
  return files;
}
function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('an up API with a stub worker fails the acceptance preflight', () => {
  assert.throws(() => assertGenerationReady({ ok: true, bakeMode: 'stub', autoPublish: false }), /generation_disabled/);
  assert.equal(bakeConfiguration({ OTZ_BAKE_MODE: 'sandbox', OTZ_BAKE_SNAPSHOT_ID: 'snap_test',
    BLOB_READ_WRITE_TOKEN: 'fake', OTZ_BLOB_PUBLIC_BASE: 'http://invalid.test', OTZ_FIELD_TOKEN: 'fake' }).configured, false);
});

test('acceptance requires a known pack and zero test-cell overlap', () => {
  assert.throws(() => assertOutsidePack(CELL, {}), /unrecognized/);
  assert.throws(() => assertOutsidePack(CELL, { terrain: [expectedTiles(CELL)[0].id] }), /overlaps_pack/);
  assert.deepEqual(assertOutsidePack(CELL, COVERAGE), { bundledTerrainIds: 1, overlap: 0 });
});

test('proof checks enqueue, all 96 files and an independent second reader', async () => {
  const files = fixture();
  let queued = false, posts = 0, fileReads = 0;
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/healthz')) return responseJson(HEALTH);
    if (opts.method === 'OPTIONS') return new Response(null, { status: 204,
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:18743' } });
    if (url.includes('/cell-status')) return responseJson({ cells: [{ cellId: CELL,
      state: queued ? 'READY' : 'MISSING', jobId: queued ? 'job_verified' : undefined, attempt: 1 }] });
    if (url.endsWith('/request-cell')) {
      assert.deepEqual(JSON.parse(opts.body), { cellId: CELL }); posts++; queued = true;
      return responseJson({ cell: { jobId: 'job_verified' }, launch: { ok: true } }, 202);
    }
    const data = files.get(url.slice((BASE + '/world/').length));
    fileReads++;
    return data ? new Response(data) : new Response(null, { status: 404 });
  };
  const result = await verifyPublicWorld({ base: BASE, cellId: CELL, coverage: COVERAGE, fetchImpl });
  assert.equal(result.verifiedFiles, 96);
  assert.equal(fileReads, 192);
  assert.equal(posts, 1);
  assert.equal(result.secondReader, 'all_hashes_match');
  assert.equal(result.phoneRendering, 'NOT_TESTED');
});

test('a warm READY cell cannot masquerade as new generation', async () => {
  await assert.rejects(() => verifyPublicWorld({ base: BASE, cellId: CELL, coverage: COVERAGE,
    fetchImpl: async url => responseJson(url.endsWith('/healthz') ? HEALTH : { state: 'READY' }) }), /already_ready/);
});

test('a partial upload does not poison a retry with refreshed metadata', async () => {
  const files = fixture();
  const remote = new Map();
  let puts = 0;
  const fetchImpl = async url => {
    const data = remote.get(new URL(url).pathname.slice(1));
    return data ? new Response(data) : new Response(null, { status: 404 });
  };
  const put = async (pathname, bytes) => {
    if (++puts === 9) throw new Error('network_interrupted');
    remote.set(pathname, Buffer.from(bytes)); return { url: `https://blob.example.test/${pathname}` };
  };
  const first = await collectCell(CELL, rel => files.get(rel));
  await assert.rejects(() => uploadCell({ cell: first, revision: REV, base: 'https://blob.example.test', put, fetchImpl }), /network_interrupted/);
  const firstRel = expectedTiles(CELL)[0].rel;
  const changed = JSON.parse(files.get(firstRel)); changed.builtAt = '2026-09-10T08:00:00Z';
  files.set(firstRel, Buffer.from(JSON.stringify(changed)));
  const retry = await collectCell(CELL, rel => files.get(rel));
  const ready = await uploadCell({ cell: retry, revision: REV, base: 'https://blob.example.test', put, fetchImpl });
  assert.equal(ready.terrainTiles, 16);
  assert.equal(ready.semanticTiles, 64);
  assert.match(ready.artifactPrefix, /\/cells\/NO-25832-318-6547\/[a-f0-9]{64}\/$/);
});

test('public tile URL follows the verified batch recorded on the cell', async () => {
  const oldBase = process.env.OTZ_BLOB_PUBLIC_BASE;
  const oldToken = process.env.BLOB_READ_WRITE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.OTZ_BLOB_PUBLIC_BASE = 'https://blob.example.test';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const prefix = `published/${REV}/cells/${CELL}/${'b'.repeat(64)}/`;
  await putCell({ cellId: CELL, state: 'READY', artifactPrefix: prefix });
  const rel = expectedTiles(CELL)[0].rel;
  let target;
  globalThis.fetch = async url => { target = url; return responseJson({ correct: true }); };
  const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  try {
    await tileProxy({ method: 'GET', headers: {}, url: `/api/world/world/${rel}` }, res);
    assert.equal(res.status, 200);
    assert.equal(target, `https://blob.example.test/${prefix}${rel}`);
    assert.equal((await getCell(CELL)).state, 'READY');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBase === undefined) delete process.env.OTZ_BLOB_PUBLIC_BASE; else process.env.OTZ_BLOB_PUBLIC_BASE = oldBase;
    if (oldToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = oldToken;
  }
});
