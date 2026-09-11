import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectCell,
  expectedTiles,
  publicBase,
  uploadCell,
  verifyPublishedCell,
} from '../lib/world-api/cell-artifacts.mjs';
import { runSandboxBake } from '../lib/world-api/sandbox-bake.mjs';

const CELL = 'NO-25832-319-6531';
const REV = 'test-revision';

function fixture() {
  const files = new Map();
  for (const t of expectedTiles(CELL)) {
    const meta = {
      schema: `otz-${t.kind}/1.0`,
      id: t.id,
      kind: t.kind,
      chunkIndex: { ix: t.ix, iy: t.iy },
      sizeMeters: t.size,
      origin: {
        crs: 'EPSG:25832',
        easting: t.ix * t.size + t.size / 2,
        northing: t.iy * t.size + t.size / 2,
        swEasting: t.ix * t.size,
        swNorthing: t.iy * t.size,
      },
      provenance: { cellId: CELL },
    };
    if (t.kind === 'terrain') {
      meta.terrain = {
        grid: 3,
        encoding: 'uint16',
        byteOrder: 'little',
        minM: 1,
        maxM: 2,
        uri: 'terrain.bin',
        row0: 'north',
        col0: 'west',
      };
      files.set(t.rel.replace(/tile\.json$/, 'terrain.bin'), Buffer.alloc(18, t.ix & 255));
    } else {
      for (const key of ['roads', 'buildings', 'water', 'forests']) meta[key] = [];
      meta.terrainParentId = `terrain_250m_${Math.floor(t.ix / 2)}_${Math.floor(t.iy / 2)}`;
    }
    files.set(t.rel, Buffer.from(JSON.stringify(meta)));
  }
  return files;
}

function reader(files) { return async (rel) => files.get(rel) || null; }

test('expected cell is exactly 16 terrain + 64 semantic tiles', () => {
  const tiles = expectedTiles(CELL);
  assert.equal(tiles.filter((t) => t.kind === 'terrain').length, 16);
  assert.equal(tiles.filter((t) => t.kind === 'semantic').length, 64);
  assert.equal(tiles[0].id, 'terrain_250m_1276_26124');
  assert.equal(tiles.at(-1).id, 'semantic_125m_2559_52255');
});

test('collectCell validates metadata and all terrain height payloads', async () => {
  const result = await collectCell(CELL, reader(fixture()));
  assert.equal(result.terrainTiles, 16);
  assert.equal(result.semanticTiles, 64);
  assert.ok(result.files.length >= 96);
});

test('collectCell rejects a missing height payload', async () => {
  const files = fixture();
  files.delete('terrain/terrain_250m_1276_26124/terrain.bin');
  await assert.rejects(() => collectCell(CELL, reader(files)), /missing_artifact/);
});

test('collectCell rejects a semantic tile without a layer array', async () => {
  const files = fixture();
  const rel = 'semantic/semantic_125m_2552_52248/tile.json';
  const meta = JSON.parse(files.get(rel));
  delete meta.water;
  files.set(rel, Buffer.from(JSON.stringify(meta)));
  await assert.rejects(() => collectCell(CELL, reader(files)), /invalid_semantic_layer/);
});

test('public Blob base must be HTTPS and have no query', () => {
  assert.equal(publicBase('https://blob.example.test/'), 'https://blob.example.test');
  assert.throws(() => publicBase('http://blob.example.test'), /invalid_blob_public_base/);
  assert.throws(() => publicBase('https://blob.example.test/?token=x'), /invalid_blob_public_base/);
});

test('uploadCell is idempotent and verifies the complete published cell', async () => {
  const local = await collectCell(CELL, reader(fixture()));
  const remote = new Map();
  const fetchImpl = async (url) => {
    const rel = new URL(url).pathname.replace(/^\/+/, '');
    const data = remote.get(rel);
    return data ? new Response(data, { status: 200 }) : new Response('', { status: 404 });
  };
  let puts = 0;
  const put = async (pathname, body) => {
    remote.set(pathname, Buffer.from(body));
    puts += 1;
    return { url: `https://blob.example.test/${pathname}` };
  };
  const first = await uploadCell({ cell: local, revision: REV, base: 'https://blob.example.test', put, fetchImpl });
  assert.equal(first.terrainTiles, 16);
  assert.equal(first.semanticTiles, 64);
  const count = puts;
  await uploadCell({ cell: local, revision: REV, base: 'https://blob.example.test', put, fetchImpl });
  assert.equal(puts, count, 'second upload must reuse identical immutable files');
  const verified = await verifyPublishedCell({ cellId: CELL, revision: REV, base: 'https://blob.example.test', artifactPrefix: first.artifactPrefix, fetchImpl });
  assert.equal(verified.bytes, first.bytes);
});

test('runSandboxBake reads the asynchronous SDK file API and publishes only verified output', async () => {
  const files = fixture();
  const sandboxFiles = new Map([
    ['/tmp/otz-out/publish-result.json', Buffer.from(JSON.stringify({ cellId: CELL, state: 'READY' }))],
  ]);
  for (const [rel, data] of files) sandboxFiles.set(`/tmp/otz-out/published/${REV}/${rel}`, data);
  const remote = new Map();
  const fetchImpl = async (url) => {
    const data = remote.get(new URL(url).pathname.replace(/^\/+/, ''));
    return data ? new Response(data, { status: 200 }) : new Response('', { status: 404 });
  };
  const put = async (pathname, body) => {
    remote.set(pathname, Buffer.from(body));
    return { url: `https://blob.example.test/${pathname}` };
  };
  let command;
  const sandbox = {
    sandboxId: 'sbx_test',
    async runCommand(args) { command = args; return { exitCode: 0, async stderr() { return ''; } }; },
    async readFileToBuffer({ path }) { return sandboxFiles.get(path) || null; },
    async stop() {},
  };
  class FakeSandbox { static async create() { return sandbox; } }
  const out = await runSandboxBake({ cellId: CELL, revision: REV, snapshotId: 'snap_test',
    base: 'https://blob.example.test', Sandbox: FakeSandbox, put, fetchImpl });
  assert.equal(out.state, 'READY');
  assert.equal(out.terrainTiles, 16);
  assert.equal(out.semanticTiles, 64);
  assert.ok(command.args.includes('--skip-blob-upload'));
  assert.ok(command.args.includes('--force-rebuild'));
});
