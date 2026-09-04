/**
 * Slim L4 road ribbons for the landing hero (no semantic LOD gate).
 */
import * as THREE from 'three';
import type { HeightFn, Road } from './types';

export const ROAD_EPS = 0.2;
export const ROAD_BASE_STEP_M = 2;
export const ROAD_MIN_STEP_M = 0.5;
export const ROAD_MAX_CHORD_ERR_M = 0.08;
export const ROAD_CROSS_STEP_M = 0.75;

const CLASS_COLOR: Record<string, number> = {
  secondary: 0x8a8a90,
  tertiary: 0x949498,
  residential: 0x9a9aa0,
  unclassified: 0x9a9a94,
  service: 0xa4a49a,
  track: 0x8a7a62,
  path: 0x9a8a6c,
  footway: 0x9a8a6c,
  cycleway: 0x7a8a74,
  living_street: 0x9c9c96,
  pedestrian: 0xaaa494,
};

export function makeRoads(items: Road[], sampleHeight: HeightFn, ex: number) {
  const group = new THREE.Group();
  group.name = 'roads';
  const sampleY = (x: number, z: number) => sampleHeight(x, z, ex);
  for (const r of items) {
    const densified = densifyRoadPolyline(r.points, sampleY);
    if (densified.length < 2) continue;
    const halfW = Math.max(1.6, (r.width ?? 5.5) / 2);
    const geom = drapeRibbon(densified, halfW, sampleY);
    if (!geom) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: CLASS_COLOR[r.class ?? ''] ?? 0x8a8a8e,
      roughness: r.class === 'path' || r.class === 'track' || r.class === 'footway' ? 1 : 0.85,
      metalness: 0,
      fog: false,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  }
  return group;
}

export function densifyUniform(points: [number, number][], stepM: number): [number, number][] {
  if (points.length < 2) return points.slice();
  const out: [number, number][] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1]!;
    const [x1, z1] = points[i]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([x0 + dx * t, z0 + dz * t]);
    }
  }
  return out;
}

export function densifyRoadPolyline(
  points: [number, number][],
  sampleY: (x: number, z: number) => number,
  baseStepM = ROAD_BASE_STEP_M,
  minStepM = ROAD_MIN_STEP_M,
  maxChordErrM = ROAD_MAX_CHORD_ERR_M,
): [number, number][] {
  const uniform = densifyUniform(points, baseStepM);
  if (uniform.length < 2) return uniform;
  const out: [number, number][] = [uniform[0]!];
  for (let i = 1; i < uniform.length; i++) {
    splitSegment(out, uniform[i - 1]!, uniform[i]!, sampleY, minStepM, maxChordErrM, 0);
  }
  return out;
}

function splitSegment(
  out: [number, number][],
  a: [number, number],
  b: [number, number],
  sampleY: (x: number, z: number) => number,
  minStepM: number,
  maxChordErrM: number,
  depth: number,
) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (depth > 12 || len <= minStepM) {
    out.push(b);
    return;
  }
  const mid: [number, number] = [a[0] + dx * 0.5, a[1] + dz * 0.5];
  const yChord = (sampleY(a[0], a[1]) + sampleY(b[0], b[1])) * 0.5;
  const yMid = sampleY(mid[0], mid[1]);
  if (Math.abs(yChord - yMid) <= maxChordErrM) {
    out.push(b);
    return;
  }
  splitSegment(out, a, mid, sampleY, minStepM, maxChordErrM, depth + 1);
  splitSegment(out, mid, b, sampleY, minStepM, maxChordErrM, depth + 1);
}

function drapeRibbon(
  points: [number, number][],
  halfW: number,
  sampleY: (x: number, z: number) => number,
): THREE.BufferGeometry | null {
  const stations = points.length;
  if (stations < 2) return null;
  const cols = Math.max(2, Math.ceil((halfW * 2) / ROAD_CROSS_STEP_M) + 1);
  const across = (2 * halfW) / (cols - 1);
  const positions = new Float32Array(stations * cols * 3);
  let ltx = 1;
  let ltz = 0;
  for (let i = 0; i < stations; i++) {
    const [x, z] = points[i]!;
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(stations - 1, i + 1)]!;
    const tx = next[0] - prev[0];
    const tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz);
    if (len >= 1e-4) {
      ltx = tx / len;
      ltz = tz / len;
    }
    const nx = -ltz;
    const nz = ltx;
    for (let j = 0; j < cols; j++) {
      const off = halfW - j * across;
      const px = x + nx * off;
      const pz = z + nz * off;
      const o = (i * cols + j) * 3;
      positions[o] = px;
      positions[o + 1] = sampleY(px, pz) + ROAD_EPS;
      positions[o + 2] = pz;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
