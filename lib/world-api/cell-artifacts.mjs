import { createHash } from 'node:crypto';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CELL_BYTES = 128 * 1024 * 1024;

export function parseCellId(cellId) {
  const m = /^NO-25832-(0|[1-9]\d{0,3})-(0|[1-9]\d{0,4})$/.exec(cellId);
  if (!m) throw new Error('unsupported_cell_id: expected NO-25832-<ix>-<iy>');
  return { ix: Number(m[1]), iy: Number(m[2]) };
}

export function publishedPrefix(revision) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(revision)) throw new Error('invalid_pipeline_revision');
  return `published/${revision}/`;
}

export function publicBase(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('invalid_blob_public_base');
  return u.href.replace(/\/$/, '');
}

export function expectedTiles(cellId) {
  const { ix, iy } = parseCellId(cellId);
  const out = [];
  for (const [kind, size, n] of [['terrain', 250, 4], ['semantic', 125, 8]]) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const tx = ix * n + x, ty = iy * n + y;
      const id = `${kind}_${size}m_${tx}_${ty}`;
      out.push({ kind, size, ix: tx, iy: ty, id, rel: `${kind}/${id}/tile.json` });
    }
  }
  return out;
}

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function validatedArtifactPrefix(cellId, revision, value) {
  const legacy = publishedPrefix(revision);
  if (!value || value === legacy) return legacy;
  parseCellId(cellId);
  const start = `${legacy}cells/${cellId}/`;
  if (!value.startsWith(start) || !/^[a-f0-9]{64}\/$/.test(value.slice(start.length))) {
    throw new Error('invalid_artifact_prefix');
  }
  return value;
}

/** Validate the entire cell, including height payloads. A Python READY flag is not publication proof. */
export async function collectCell(cellId, read) {
  const files = [];
  let bytes = 0;
  async function add(rel) {
    const raw = await read(rel);
    if (!raw) throw new Error(`missing_artifact: ${rel}`);
    const data = Buffer.from(raw);
    bytes += data.length;
    if (!data.length || data.length > MAX_FILE_BYTES || bytes > MAX_CELL_BYTES) throw new Error(`artifact_size_limit: ${rel}`);
    files.push({ rel, data, sha256: sha256(data) });
    return data;
  }
  for (const t of expectedTiles(cellId)) {
    let meta;
    try { meta = JSON.parse((await add(t.rel)).toString('utf8')); }
    catch (e) { throw new Error(`invalid_metadata: ${t.rel}: ${e.message}`); }
    if (meta.schema !== `otz-${t.kind}/1.0` || meta.kind !== t.kind || meta.id !== t.id ||
        meta.sizeMeters !== t.size || meta.chunkIndex?.ix !== t.ix || meta.chunkIndex?.iy !== t.iy ||
        meta.origin?.crs !== 'EPSG:25832' || meta.origin?.swEasting !== t.ix * t.size ||
        meta.origin?.swNorthing !== t.iy * t.size || meta.provenance?.cellId !== cellId) {
      throw new Error(`tile_identity_mismatch: ${t.rel}`);
    }
    if (t.kind === 'terrain') {
      const h = meta.terrain;
      if (!h || h.uri !== 'terrain.bin' || h.encoding !== 'uint16' || h.byteOrder !== 'little' ||
          h.row0 !== 'north' || h.col0 !== 'west' || !Number.isInteger(h.grid) || h.grid < 2 || h.grid > 1025 ||
          !Number.isFinite(h.minM) || !Number.isFinite(h.maxM) || h.maxM < h.minM) {
        throw new Error(`invalid_height_descriptor: ${t.id}`);
      }
      const bin = await add(t.rel.replace(/tile\.json$/, 'terrain.bin'));
      if (bin.length !== h.grid * h.grid * 2) throw new Error(`height_byte_count: ${t.id}`);
    } else {
      for (const key of ['roads', 'buildings', 'water', 'forests']) {
        if (!Array.isArray(meta[key])) throw new Error(`invalid_semantic_layer: ${t.id}/${key}`);
      }
      const parent = `terrain_250m_${Math.floor(t.ix / 2)}_${Math.floor(t.iy / 2)}`;
      if (meta.terrainParentId !== parent) throw new Error(`wrong_terrain_parent: ${t.id}`);
    }
  }
  return { cellId, files, bytes, terrainTiles: 16, semanticTiles: 64 };
}

export async function fetchArtifact(url, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`artifact_http_${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('artifact_size_limit');
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (!fallback.length || fallback.length > MAX_FILE_BYTES) throw new Error('artifact_size_limit');
    return fallback;
  }
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES) throw new Error('artifact_size_limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export async function verifyPublishedCell({ cellId, revision, base, artifactPrefix, expectedHashes, fetchImpl = fetch, signal }) {
  const relativePrefix = validatedArtifactPrefix(cellId, revision, artifactPrefix);
  const prefix = `${publicBase(base)}/${relativePrefix}`;
  const cell = await collectCell(cellId, async (rel) => {
    const data = await fetchArtifact(prefix + rel, { fetchImpl, signal });
    if (data && expectedHashes && sha256(data) !== expectedHashes.get(rel)) throw new Error(`published_hash_mismatch: ${rel}`);
    return data;
  });
  return {
    artifactPrefix: relativePrefix,
    bytes: cell.bytes,
    terrainTiles: cell.terrainTiles,
    semanticTiles: cell.semanticTiles,
    tileUrls: Object.fromEntries(['terrain', 'semantic'].map(kind => [kind,
      expectedTiles(cellId).filter(t => t.kind === kind).map(t => prefix + t.rel)])),
  };
}

export async function uploadCell({ cell, revision, base, put, fetchImpl = fetch, signal }) {
  // A retry can contain new build timestamps or refreshed source data. Publish
  // it into its own content-addressed batch, then move the cell's READY pointer
  // only after all 96 files verify. Partial uploads never poison a later bake.
  const digest = sha256(Buffer.from(cell.files.map(f => `${f.rel}:${f.sha256}`).join('\n')));
  const prefix = validatedArtifactPrefix(cell.cellId, revision,
    `${publishedPrefix(revision)}cells/${cell.cellId}/${digest}/`);
  const host = publicBase(base);
  // Stable versioned paths must not overwrite a different immutable payload.
  // A failed attempt may leave some files; retries can reuse only identical bytes.
  for (const f of cell.files) {
    const existing = await fetchArtifact(`${host}/${prefix}${f.rel}`, { fetchImpl, signal });
    if (existing) {
      if (sha256(existing) !== f.sha256) throw new Error(`immutable_artifact_conflict: ${f.rel}; use a new pipeline revision`);
      continue;
    }
    const written = await put(prefix + f.rel, f.data, {
      access: 'public', addRandomSuffix: false,
      contentType: f.rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      cacheControlMaxAge: 31536000, abortSignal: signal,
    });
    if (written.url !== `${host}/${prefix}${f.rel}`) throw new Error('blob_store_does_not_match_public_base');
  }
  return verifyPublishedCell({ cellId: cell.cellId, revision, base: host, artifactPrefix: prefix,
    expectedHashes: new Map(cell.files.map(f => [f.rel, f.sha256])), fetchImpl, signal });
}
