import assert from 'node:assert/strict';
import test from 'node:test';
import startBake, { executeJob } from '../api/world/jobs/start-bake.js';
import requestCell from '../api/world/factory/request-cell.js';
import { putCell, getCell } from '../lib/world-api/store.js';

function response() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

const CELL = 'NO-25832-319-6531';

test('stub mode never claims a bake was published', async () => {
  const oldMode = process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_FIELD_TOKEN;
  const req = { method: 'POST', headers: {}, body: { cellId: CELL, jobId: 'job_test' } };
  const res = response();
  await startBake(req, res);
  assert.equal(res.status, 503);
  assert.equal(res.body.mode, 'stub');
  assert.equal(res.body.autoPublish, false);
  if (oldMode === undefined) delete process.env.OTZ_BAKE_MODE;
  else process.env.OTZ_BAKE_MODE = oldMode;
});

test('executeJob commits the verified result to the same job id', async () => {
  const oldMode = process.env.OTZ_BAKE_MODE;
  process.env.OTZ_BAKE_MODE = 'sandbox';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const row = await putCell({ cellId: CELL, jobId: 'job_execute_test', state: 'GENERATING', attempt: 1 });
  const result = await executeJob(row, async () => ({
    cellId: CELL,
    state: 'READY',
    terrainTiles: 16,
    semanticTiles: 64,
    tileUrls: { terrain: [], semantic: [] },
    bytes: 123,
  }));
  assert.equal(result.state, 'READY');
  assert.equal((await getCell(CELL)).jobId, 'job_execute_test');
  assert.equal((await getCell(CELL)).terrainTiles, 16);
  if (oldMode === undefined) delete process.env.OTZ_BAKE_MODE;
  else process.env.OTZ_BAKE_MODE = oldMode;
});

test('start-bake rejects malformed cell identifiers before touching the worker', async () => {
  const req = { method: 'POST', headers: {}, body: { cellId: 'not-a-cell', jobId: 'job_bad' } };
  const res = response();
  await startBake(req, res);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_cell_request');
});

test('request-cell refuses to queue a new cell while generation is disabled', async () => {
  const oldMode = process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_FIELD_TOKEN;
  const req = { method: 'POST', headers: {}, body: { cellId: 'NO-25832-318-6537' } };
  const res = response();
  await requestCell(req, res);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'generation_unavailable');
  assert.equal(await getCell('NO-25832-318-6537'), null);
  if (oldMode === undefined) delete process.env.OTZ_BAKE_MODE;
  else process.env.OTZ_BAKE_MODE = oldMode;
});

test('request-cell rejects null and array bodies without throwing', async () => {
  const oldMode = process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_BAKE_MODE;
  delete process.env.OTZ_FIELD_TOKEN;
  for (const body of [null, []]) {
    const req = { method: 'POST', headers: {}, body };
    const res = response();
    await requestCell(req, res);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_json');
  }
  if (oldMode === undefined) delete process.env.OTZ_BAKE_MODE;
  else process.env.OTZ_BAKE_MODE = oldMode;
});
