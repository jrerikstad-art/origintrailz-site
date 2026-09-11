#!/usr/bin/env node
/**
 * Create the portable Python image used by the Vercel cell worker.
 *
 * Usage:
 *   node scripts/build-factory-snapshot.mjs --engine-root ../origintrailz-v4/world-lab
 *
 * The snapshot contains factory code and Python dependencies only. It never
 * contains credentials or a pre-baked geography. The cell job supplies its
 * cellId at runtime and writes into an isolated workspace.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
function option(name, fallback = '') {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] || fallback : fallback;
}

const engineRoot = path.resolve(option('--engine-root', '../origintrailz-v4/world-lab'));
const workdir = '/vercel/sandbox/world-lab';
const timeout = Number(option('--timeout-ms', '600000'));
const originE = Number(option('--origin-easting', '319543.58527136955'));
const originN = Number(option('--origin-northing', '6531135.525830367'));
const seedLon = Number(option('--seed-lon', '5.869'));
const seedLat = Number(option('--seed-lat', '58.882'));

const files = [
  // load_settings() resolves this file relative to the snapshot's
  // world-lab root. Omitting it makes the first cloud cell fail before DEM
  // or OSM work starts.
  'factory/config.default.json',
  'tools/requirements.txt',
  'tools/build_corridor_chunks.py',
  'tools/building_identity.py',
  'tools/chunk_grid.py',
  'tools/dem_mosaic.py',
  'tools/dem_mosaic_adapter.py',
  'tools/subdivide_corridor_chunks.py',
  'tools/water_osm.py',
  ...['__init__.py', 'atomic_replace.py', 'cells.py', 'cloud_cell_job.py', 'config.py', 'coverage.py', 'publish.py', 'store.py', 'worker.py']
    .map((name) => `tools/factory/${name}`),
];

async function readRequired(rel) {
  const source = path.join(engineRoot, rel);
  let content = await fs.readFile(source);
  if (rel === 'factory/config.default.json') {
    // Never carry a desktop data root into the VM. The job overrides this
    // with OTZ_WORLD_ROOT, but keeping the checked-in default portable also
    // makes smoke imports and operator inspection honest.
    const parsed = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    parsed.dataRoot = '/tmp/otz-world';
    content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  }
  return { path: `${workdir}/${rel}`, content };
}

async function main() {
  const uploads = [];
  for (const rel of files) uploads.push(await readRequired(rel));

  // build_corridor_chunks imports this config from public/world. Generate a
  // portable config instead of copying a desktop path or a bundled map.
  const worldConfig = {
    schema: 'otz-world/0.2',
    chunkSizeMeters: 250,
    terrainGrid: 65,
    corridorRing: 0,
    worldOrigin: { easting: originE, northing: originN },
    route: { waypoints: [{ lon: seedLon, lat: seedLat, name: 'runtime seed' }] },
  };
  uploads.push({
    path: `${workdir}/public/world/config.json`,
    content: Buffer.from(`${JSON.stringify(worldConfig, null, 2)}\n`),
  });

  if (args.includes('--check-source')) {
    process.stdout.write(`${JSON.stringify({ ok: true, checked: uploads.length, engineRoot })}\n`);
    return;
  }

  const { Sandbox } = await import('@vercel/sandbox');

  // Local operator credentials must be passed explicitly to this SDK. A
  // linked project's VERCEL_OIDC_TOKEN is used automatically when present.
  const credentials = process.env.VERCEL_TOKEN ? {
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  } : {};
  if (credentials.token && (!credentials.teamId || !credentials.projectId)) {
    throw new Error('VERCEL_TOKEN requires VERCEL_TEAM_ID and VERCEL_PROJECT_ID');
  }

  let sandbox;
  try {
    sandbox = await Sandbox.create({
      ...credentials,
      runtime: 'python3.13',
      resources: { vcpus: 4 },
      timeout,
      persistent: false,
      tags: { service: 'origintrailz-world-factory', purpose: 'cell-bake-image' },
    });
    await sandbox.writeFiles(uploads);
    const install = await sandbox.runCommand({
      cmd: 'python',
      args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '-r', 'tools/requirements.txt'],
      cwd: workdir,
      timeoutMs: Math.min(timeout - 30_000, 540_000),
    });
    if (install.exitCode !== 0) {
      const detail = await install.stderr();
      throw new Error(`dependency_install_failed_${install.exitCode}: ${detail.slice(-1000)}`);
    }
    const smoke = await sandbox.runCommand({
      cmd: 'python',
      args: ['-c', 'import numpy, PIL, pyproj, tifffile; import tools.factory.cloud_cell_job'],
      cwd: workdir,
    });
    if (smoke.exitCode !== 0) {
      const detail = await smoke.stderr();
      throw new Error(`factory_import_failed_${smoke.exitCode}: ${detail.slice(-1000)}`);
    }
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    const snapshotId = snapshot.snapshotId || snapshot.id;
    if (!snapshotId) throw new Error('snapshot_id_missing');
    process.stdout.write(`${JSON.stringify({ ok: true, snapshotId, runtime: 'python3.13', workdir })}\n`);
  } finally {
    if (sandbox) await sandbox.stop({ signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
