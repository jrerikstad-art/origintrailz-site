/**
 * Terrain mesh from a heightfield grid — vertices sit on DEM samples.
 * Adjacent tiles share the same edge XZ. A downward skirt seals raster cracks
 * so the camera cannot see through the world.
 *
 * Shading is derived from height samples, never from `computeVertexNormals`:
 * that averages the vertical skirt faces into the rim vertices and draws a
 * shaded border around every tile, which reads as a grid over the landscape.
 */
import * as THREE from 'three';
import type { Heightfield } from './heightfield';

const SKIRT_DEPTH_M = 28;
/**
 * Straight down, never outward: an outward skirt draws over the neighbour tile
 * and reads as a dark line along every seam.
 */
const SKIRT_OUT_M = 0;

const LOW = new THREE.Color(0x6f8a52);
const MID = new THREE.Color(0x8fa56a);
const HIGH = new THREE.Color(0xc4b896);
const ROCK = new THREE.Color(0x9a8f7c);
/** Gate N.0 — undiscovered paper. JOURNAL.WORLD: #ece6da only. */
const PARCHMENT = new THREE.Color(0xece6da);
/** WORLD.COVERAGE.TRUTH — unpublished cells: paper #ece6da → far haze #cfd8e0 soft dissolve. */
const FAR_HAZE = new THREE.Color(0xcfd8e0);
/** Visible lake surface on terrain when W.0 mesh is absent or behind the camera. */
const LAKE_SURFACE = new THREE.Color(0x4a6570);
const LAKE_BED = new THREE.Color(0x2d6a9a);

export function makeHeightfieldTerrain(
  hf: Heightfield,
  exaggeration: number,
  sampleWorldM?: (localX: number, localZ: number, sourceM: number) => number,
): THREE.Mesh {
  const n = hf.grid;
  const size = hf.sizeMeters;
  const half = size / 2;
  const step = size / (n - 1);

  const inner = n * n;
  const positions: number[] = [];

  const heightAt = (col: number, row: number) => {
    const sourceM = hf.at(col, row);
    const x = -half + col * step;
    const z = -half + row * step;
    const yM = sampleWorldM ? sampleWorldM(x, z, sourceM) : sourceM;
    return yM * exaggeration;
  };

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x = -half + col * step;
      const z = -half + row * step;
      positions.push(x, heightAt(col, row), z);
    }
  }

  const rimIndex = (col: number, row: number) => row * n + col;
  const rim: { i: number; ox: number; oz: number }[] = [];
  for (let col = 0; col < n; col++) rim.push({ i: rimIndex(col, n - 1), ox: 0, oz: 1 });
  for (let row = n - 2; row >= 0; row--) rim.push({ i: rimIndex(n - 1, row), ox: 1, oz: 0 });
  for (let col = n - 2; col >= 0; col--) rim.push({ i: rimIndex(col, 0), ox: 0, oz: -1 });
  for (let row = 1; row <= n - 2; row++) rim.push({ i: rimIndex(0, row), ox: -1, oz: 0 });

  const skirtStart = inner;
  /** Surface vertex each skirt vertex hangs from — reused after seam stitching. */
  const skirtRim = new Int32Array(rim.length);
  for (let s = 0; s < rim.length; s++) {
    const r = rim[s]!;
    const x = positions[r.i * 3]!;
    const y = positions[r.i * 3 + 1]!;
    const z = positions[r.i * 3 + 2]!;
    positions.push(x + r.ox * SKIRT_OUT_M, y - SKIRT_DEPTH_M, z + r.oz * SKIRT_OUT_M);
    skirtRim[s] = r.i;
  }

  const index: number[] = [];
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const rimLen = rim.length;
  for (let i = 0; i < rimLen; i++) {
    const i0 = rim[i]!.i;
    const i1 = rim[(i + 1) % rimLen]!.i;
    const s0 = skirtStart + i;
    const s1 = skirtStart + ((i + 1) % rimLen);
    index.push(i0, s0, i1, i1, s0, s1);
  }

  const vertexCount = positions.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  g.setIndex(index);

  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      // Single-sided terrain lets any downward view see sky through the ground.
      side: THREE.DoubleSide,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.userData.grid = n;
  mesh.userData.innerVerts = inner;
  mesh.userData.skirtRim = skirtRim;
  mesh.userData.skirtDepth = SKIRT_DEPTH_M;
  mesh.userData.stepM = step;
  mesh.userData.exaggeration = exaggeration;

  applySurfaceShading(mesh, (x, z) => hf.sampleSurface(x, z) * exaggeration);
  g.computeBoundingSphere();
  return mesh;
}

export type SurfaceShadingStats = {
  verts: number;
  discoverySamples: number;
};

/**
 * Rebuild normals and vertex colours from height samples.
 *
 * `sampleWorldY` is queried in the mesh's own world frame. Pass a cross-tile
 * sampler after seam stitching and neighbouring tiles agree along the shared
 * edge, so no seam is visible; pass the tile's own heightfield at build time.
 */
export function applySurfaceShading(
  mesh: THREE.Mesh,
  sampleWorldY: (worldX: number, worldZ: number) => number,
  /**
   * Gate L.0 — optional ground class per world position. Returns a base colour
   * and how strongly it overrides elevation/slope shading. Omit for the
   * pre-L.0 relief-only appearance.
   */
  sampleGround?: (worldX: number, worldZ: number) => { color: number; strength: number } | null,
  /** Gate N.0 — 0 undiscovered … 1 discovered; modulates colour toward parchment. */
  sampleDiscovery?: (worldX: number, worldZ: number) => number,
  /** Scene 0.0.1-R — optional camera XZ for cheap far-preview atmosphere. */
  cameraXZ?: { x: number; z: number },
  /** Gate W.0 — canonical water surface (m) when vertex lies inside a lake body. */
  sampleWaterSurface?: (worldX: number, worldZ: number) => number | null,
  stats?: SurfaceShadingStats,
) {
  const inner = Number(mesh.userData.innerVerts);
  const stepM = Number(mesh.userData.stepM);
  const exaggeration = Number(mesh.userData.exaggeration);
  if (!Number.isFinite(inner) || !Number.isFinite(stepM)) return;

  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const col = geo.attributes.color as THREE.BufferAttribute | undefined;
  if (!nrm || !col) return;

  const offsetX = mesh.position.x;
  const offsetZ = mesh.position.z;
  const inv = 1 / (2 * stepM);
  const c = new THREE.Color();
  const ground = new THREE.Color();
  const v = new THREE.Vector3();

  for (let i = 0; i < inner; i++) {
    const wx = offsetX + pos.getX(i);
    const wz = offsetZ + pos.getZ(i);
    const dx = (sampleWorldY(wx - stepM, wz) - sampleWorldY(wx + stepM, wz)) * inv;
    const dz = (sampleWorldY(wx, wz - stepM) - sampleWorldY(wx, wz + stepM)) * inv;
    v.set(dx, 1, dz).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);

    const y = pos.getY(i) / Math.max(0.01, exaggeration);
    const waterM = sampleWaterSurface?.(wx, wz);
    // Inside a lake polygon — always paint water (even before clip lowers protruding verts).
    if (waterM != null) {
      const depthM = Math.max(0, waterM - y);
      c.copy(LAKE_SURFACE).lerp(LAKE_BED, Math.min(1, depthM / 2.5));
      col.setXYZ(i, c.r, c.g, c.b);
      continue;
    }

    // Height ramp is primary. Class tints gentle ground only.
    const slope = 1 - THREE.MathUtils.clamp(v.y, 0, 1);
    
    // Build elevation gradient LOW → MID → HIGH
    const t = THREE.MathUtils.clamp(y / 220, 0, 1);
    c.copy(LOW).lerp(MID, Math.min(1, t * 1.8));
    if (t > 0.5) c.lerp(HIGH, (t - 0.5) * 2);
    
    // Landcover tints ONLY on gentle ground, WEAK strength
    if (slope < 0.35 && sampleGround) {
      const g = sampleGround(wx, wz);
      if (g && g.strength > 0) {
        ground.setHex(g.color);
        // Reduce strength: class tints, doesn't own
        const weakStrength = g.strength * 0.32;
        c.lerp(ground, weakStrength);
      }
    }
    
    // Steep fell/rock (sandy-grey mountain) — no landcover
    if (slope > 0.42) {
      const fell = Math.min(1, (slope - 0.42) / 0.35);
      c.lerp(HIGH, fell * 0.8);
      if (slope > 0.5) c.lerp(ROCK, Math.min(1, (slope - 0.5) / 0.35));
    }
    c.multiplyScalar(0.92 + 0.08 * v.y);

    if (sampleDiscovery) {
      stats && stats.discoverySamples++;
      const d = sampleDiscovery(wx, wz);
      if (d < 0.995) {
        // Paper → ~12 m kernel feather → revealed. No extra dark halo.
        c.lerp(PARCHMENT, 1 - d);
      }
    }

    if (cameraXZ && sampleDiscovery) {
      const cameraDist = Math.hypot(wx - cameraXZ.x, wz - cameraXZ.z);
      const distanceFade = THREE.MathUtils.smoothstep(cameraDist, 600, 1400);
      if (distanceFade > 0) c.lerp(FAR_HAZE, distanceFade * 0.72);
    }

    col.setXYZ(i, c.r, c.g, c.b);
    stats && stats.verts++;
  }

  // Skirt copies its rim vertex, so a visible skirt cannot read as a dark seam.
  const rim = mesh.userData.skirtRim as Int32Array | undefined;
  if (rim) {
    for (let s = 0; s < rim.length; s++) {
      const src = rim[s]!;
      const dst = inner + s;
      nrm.setXYZ(dst, nrm.getX(src), nrm.getY(src), nrm.getZ(src));
      col.setXYZ(dst, col.getX(src), col.getY(src), col.getZ(src));
    }
  }

  nrm.needsUpdate = true;
  col.needsUpdate = true;
}

/** Re-apply hydro conditioning to an existing mesh (no GPU rebuild). */
export function resampleHeightfieldTerrain(
  mesh: THREE.Mesh,
  hf: Heightfield,
  exaggeration: number,
  sampleWorldM?: (localX: number, localZ: number, sourceM: number) => number,
): void {
  const n = Number(mesh.userData.grid);
  const inner = Number(mesh.userData.innerVerts);
  if (!Number.isFinite(n) || !Number.isFinite(inner)) return;

  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const half = hf.sizeMeters / 2;
  const step = hf.sizeMeters / (n - 1);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const x = -half + col * step;
      const z = -half + row * step;
      const sourceM = hf.at(col, row);
      const yM = sampleWorldM ? sampleWorldM(x, z, sourceM) : sourceM;
      pos.setY(i, yM * exaggeration);
    }
  }

  const skirtRim = mesh.userData.skirtRim as Int32Array | undefined;
  const skirtDepth = Number(mesh.userData.skirtDepth);
  if (skirtRim && Number.isFinite(skirtDepth)) {
    for (let s = 0; s < skirtRim.length; s++) {
      const src = skirtRim[s]!;
      const dst = inner + s;
      pos.setY(dst, pos.getY(src) - skirtDepth);
    }
  }

  pos.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
}
