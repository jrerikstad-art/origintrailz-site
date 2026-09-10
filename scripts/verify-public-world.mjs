#!/usr/bin/env node
/**
 * A health response is not a bake proof. This command checks an unbundled,
 * previously unpublished cell through enqueue -> READY -> 96 public files.
 * It never uses a LAN server, browser cache, saved GPS trail or local tile pack.
 * Tokens come from the environment and are never included in its report.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { collectCell, expectedTiles, fetchArtifact, sha256 } from '../lib/world-api/cell-artifacts.mjs';

const PHONE_ORIGIN = 'http://127.0.0.1:18743';

export function assertGenerationReady(health) {
  const missing = ['autoPublish', 'sandboxConfigured', 'durableStore', 'tileProxy']
    .filter(key => health?.[key] !== true);
  if (health?.bakeMode !== 'sandbox' || missing.length) {
    throw new Error(`generation_disabled: mode=${health?.bakeMode ?? 'unknown'}; ${[
      ...missing, ...(health?.sandboxMissing ?? []),
    ].join(', ')}`);
  }
}

export function assertOutsidePack(cellId, coverage) {
  // Both coverage schema shapes have existed: tile ID keys and tile ID values.
  // Conservatively include all listed IDs, even non-READY entries.
  const ids = new Set();
  function visit(value) {
    if (typeof value === 'string') {
      if (/^terrain_250m_\d+_\d+$/.test(value)) ids.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) { visit(key); visit(item); }
    }
  }
  visit(coverage);
  if (!ids.size) throw new Error('bundled_coverage_unrecognized: no terrain tile IDs');
  const overlap = expectedTiles(cellId).filter(t => t.kind === 'terrain' && ids.has(t.id));
  if (overlap.length) throw new Error(`test_cell_overlaps_pack: ${overlap.map(t => t.id).join(',')}`);
  return { bundledTerrainIds: ids.size, overlap: 0 };
}

export async function verifyPublicWorld({
  base, cellId, coverage, token = '', timeoutMs = 600_000,
  fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, onStage = () => {},
}) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('factory_base_must_be_public_https');
  }
  base = url.href.replace(/\/$/, '');
  const started = now();
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { Origin: PHONE_ORIGIN, ...(token ? { 'X-OTZ-Field-Token': token } : {}) };
  async function json(path, options = {}, statuses = [200]) {
    const r = await fetchImpl(base + path, {
      cache: 'no-store', redirect: 'error', signal,
      ...options, headers: { ...headers, ...options.headers },
    });
    if (!statuses.includes(r.status)) throw new Error(`http_${r.status}: ${path}`);
    if (!r.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`not_json: ${path}`);
    }
    return r.json();
  }
  const health = await json('/healthz');
  assertGenerationReady(health);
  onStage('configuration_ready');
  if (!cellId) return { ok: true, scope: 'configuration_only', bakeProven: false, health };
  const outsidePack = assertOutsidePack(cellId, coverage);
  const statusPath = `/__factory/cell-status?cellId=${encodeURIComponent(cellId)}`;
  function row(body) {
    return body.cells?.find(c => c.cellId === cellId) ?? body.cell ?? body;
  }
  const before = row(await json(statusPath));
  if (before.state === 'READY') throw new Error('cell_already_ready: choose an unpublished cell');
  if (['QUEUED', 'GENERATING', 'VALIDATING'].includes(before.state)) {
    throw new Error('cell_already_in_flight: choose another cell or inspect the existing attempt');
  }
  const preflight = await fetchImpl(base + '/__factory/request-cell', {
    method: 'OPTIONS', redirect: 'error', signal,
    headers: { Origin: PHONE_ORIGIN, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-otz-field-token' },
  });
  const allow = preflight.headers.get('access-control-allow-origin');
  if (!preflight.ok || ![PHONE_ORIGIN, '*'].includes(allow)) throw new Error('mobile_cors_failed');
  const enqueued = await json('/__factory/request-cell', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cellId }),
  }, [202]);
  if (enqueued.autoPublish === false || enqueued.launch?.body?.autoPublish === false) {
    throw new Error('starter_is_stub');
  }
  if (enqueued.launch?.ok === false) throw new Error(`starter_failed: ${enqueued.launch.error || enqueued.launch.status}`);
  const jobId = enqueued.cell?.jobId;
  if (!jobId) throw new Error('queued_job_id_missing');
  onStage(`queued ${cellId}`);
  let ready;
  while (now() - started < timeoutMs) {
    ready = row(await json(statusPath));
    if (ready.jobId !== jobId) throw new Error('job_changed_during_proof');
    if (ready.state === 'READY') break;
    if (ready.state === 'FAILED') throw new Error(`bake_failed: ${ready.error || 'unknown'}`);
    await pause(2000);
  }
  if (ready?.state !== 'READY') throw new Error('bake_timeout');
  onStage('ready_verifying_files');
  async function readCell() {
    return collectCell(cellId, rel => fetchArtifact(`${base}/world/${rel}`, {
      signal, fetchImpl: (target, opts) => fetchImpl(target, { ...opts, headers }),
    }));
  }
  const first = await readCell();
  // Independent HTTP reads; this is not claimed to be a physical second phone.
  const second = await readCell();
  const hashes = new Map(first.files.map(f => [f.rel, f.sha256]));
  if (second.files.some(f => hashes.get(f.rel) !== f.sha256)) throw new Error('second_reader_hash_mismatch');
  const after = row(await json(statusPath));
  if (after.state !== 'READY' || after.jobId !== jobId || after.attempt !== ready.attempt) {
    throw new Error('cell_rebaked_during_second_read');
  }
  return {
    ok: true, scope: 'public_cell_http', checkedAt: new Date().toISOString(), base, cellId,
    outsidePack, jobId, pipelineRevision: health.pipelineRevision,
    durationMs: now() - started, terrainTiles: first.terrainTiles, semanticTiles: first.semanticTiles,
    verifiedFiles: first.files.length, bytes: first.bytes, secondReader: 'all_hashes_match',
    artifactDigest: sha256(Buffer.from(first.files.map(f => `${f.rel}:${f.sha256}`).join('\n'))),
    phoneRendering: 'NOT_TESTED',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const base = value('--base') || 'https://origintrailz-site.vercel.app/api/world';
  const cellId = value('--cell');
  const coveragePath = value('--bundled-coverage');
  if (cellId && !coveragePath) throw new Error('--bundled-coverage from the tested APK is required with --cell');
  const coverage = coveragePath ? JSON.parse(await fs.readFile(coveragePath, 'utf8')) : undefined;
  const result = await verifyPublicWorld({ base, cellId, coverage, token: process.env.OTZ_FIELD_TOKEN,
    onStage: text => process.stderr.write(`${text}\n`) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
