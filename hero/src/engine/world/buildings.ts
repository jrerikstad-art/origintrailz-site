import * as THREE from 'three';
import { mulberry32 } from './random';
import type { Building, HeightFn, Point2 } from './types';
import { wallHeightFromFloors } from './semanticBuildings';

export type FoundationMode = 'min_footprint' | 'median_footprint';

const GROUND_EPS = 0.15;
/** Honest OSM ring; still far below ExtrudeGeometry curveSegments=12 (~2700 tris/rect). */
const MAX_FOOTPRINT_VERTS = 16;
const GABLE_PITCH_RAD = (35 * Math.PI) / 180;
const GABLE_TAN = Math.tan(GABLE_PITCH_RAD);
const RIDGE_EPS = 1e-4;

const WALL_PALETTE = [0xc9ba9e, 0xd4c6ab, 0xbba98c];
const ROOF_PALETTE = [0x6e5a48, 0x7a6350, 0x5c4a3c];
const OVERHANG_M = 0.35;
/** A square corner offset by OVERHANG_M is sqrt(2) farther from the ring. */
const MAX_OVERHANG_DISTANCE_M = OVERHANG_M * Math.SQRT2 + 0.05;

/** Live counters for Walking Truth / Field Report (main.ts getWalkingTruthStats). */
export const buildingDiagnostics = {
  remoteBuildingsReceived: 0,
  wallMeshesCreated: 0,
  roofAttempts: 0,
  roofHardPass: 0,
  roofFallbacks: 0,
  roofMeshesAttached: 0,
  roofMeshesVisible: 0,
  roofGeomsEmpty: 0,
  roofConcatFailed: 0,
};

function roofFallback(ring: Point2[], wallH: number): THREE.BufferGeometry {
  buildingDiagnostics.roofFallbacks += 1;
  return makeFlatRoof(ring, wallH);
}

function wallMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
    emissive: color,
    emissiveIntensity: 0.08,
    flatShading: false,
    side: THREE.DoubleSide,
  });
}

function roofMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
    emissive: color,
    emissiveIntensity: 0.06,
    flatShading: false,
    side: THREE.FrontSide,
  });
}

function ringArea(fp: Point2[]): number {
  let a = 0;
  for (let i = 0; i < fp.length; i++) {
    const [x0, z0] = fp[i]!;
    const [x1, z1] = fp[(i + 1) % fp.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a * 0.5;
}

/** Drop duplicates + collinear OSM verts. Hundreds of tris/house OK — not thousands of curve segs. */
export function simplifyFootprint(footprint: Point2[], epsM = 0.4, maxVerts = MAX_FOOTPRINT_VERTS): Point2[] {
  if (footprint.length < 3) return footprint;
  const raw: Point2[] = [];
  for (const p of footprint) {
    const prev = raw[raw.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.08) raw.push(p);
  }
  if (raw.length >= 2) {
    const a = raw[0]!;
    const b = raw[raw.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.08) raw.pop();
  }
  if (raw.length < 3) return footprint.slice(0, 3);
  const kept: Point2[] = [];
  const n = raw.length;
  for (let i = 0; i < n; i++) {
    const a = raw[(i + n - 1) % n]!;
    const b = raw[i]!;
    const c = raw[(i + 1) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (Math.abs(cross) > epsM * Math.max(ab, 0.2)) kept.push(b);
  }
  let ring = kept.length >= 3 ? kept : raw;
  if (ring.length > maxVerts) {
    const step = ring.length / maxVerts;
    const dec: Point2[] = [];
    for (let i = 0; i < maxVerts; i++) dec.push(ring[Math.min(ring.length - 1, Math.floor(i * step))]!);
    ring = dec;
  }
  if (ringArea(ring) < 0) ring = ring.slice().reverse();
  return ring;
}

/**
 * Unique ring verts, 2 tris/side + optional top cap. No ExtrudeGeometry.
 * L3 masses keep the cap; L4 house walls do not (the pitched roof is the cap).
 */
export function makePrismGeometry(
  footprint: Point2[],
  height: number,
  capTop = true,
  maxVerts = MAX_FOOTPRINT_VERTS,
): THREE.BufferGeometry | null {
  const ring = simplifyFootprint(footprint, 0.4, maxVerts);
  if (ring.length < 3 || height < 0.5) return null;
  const n = ring.length;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
  };
  if (capTop) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    let faces: number[][] = THREE.ShapeUtils.triangulateShape(contour, []);
    if (!faces.length) {
      faces = [];
      for (let i = 1; i < n - 1; i++) faces.push([0, i, i + 1]);
    }
    const topBase = 0;
    for (const [x, z] of ring) push(x, height, z, 0, 1, 0);
    for (const f of faces) idx.push(topBase + f[0]!, topBase + f[1]!, topBase + f[2]!);
  }
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % n]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len;
    const nz = -dx / len;
    const b = pos.length / 3;
    push(x0, 0, z0, nx, 0, nz);
    push(x1, 0, z1, nx, 0, nz);
    push(x1, height, z1, nx, 0, nz);
    push(x0, height, z0, nx, 0, nz);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Art-locked gable test - near-rect privilege with strict numbers. */
function classifyFootprint(ring: Point2[]): 'rect' | 'compact' | 'complex' {
  if (ring.length !== 4) {
    // 5-6 verts: check if hip/pyramid is SAFE (very conservative)
    if (ring.length >= 5 && ring.length <= 6) {
      let area = 0;
      let perim = 0;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const [x0, z0] = ring[i]!;
        const [x1, z1] = ring[(i + 1) % n]!;
        area += x0 * z1 - x1 * z0;
        perim += Math.hypot(x1 - x0, z1 - z0);
      }
      area = Math.abs(area) * 0.5;
      const compactness = (4 * Math.PI * area) / (perim * perim);
      
      if (compactness > 0.75) {
        // Still need to verify: convex, peak inside, no crossing triangles
        // Will be validated at build time - return 'compact' as candidate
        // If validation fails, fallback to flat happens in makeHipRoof
        return 'compact';
      }
    }
    return 'complex';
  }
  
  // Must be 4 verts from here. Check gable privilege with Art's numbers.
  
  // 1. No reflex vertex. simplifyFootprint normalises the ring CCW in XZ,
  // but the previous angle calculation used (previous - current), which
  // turned every ordinary 90° corner into 270° and forced rectangles down
  // the flat-roof fallback path.
  if (!isConvex(ring)) return 'complex';
  const angles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = ring[(i + 3) % 4]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % 4]!;
    const v1x = a[0] - b[0];
    const v1z = a[1] - b[1];
    const v2x = c[0] - b[0];
    const v2z = c[1] - b[1];
    const dot = v1x * v2x + v1z * v2z;
    const denom = Math.hypot(v1x, v1z) * Math.hypot(v2x, v2z);
    if (denom < 1e-8) return 'complex';
    const interior = Math.acos(THREE.MathUtils.clamp(dot / denom, -1, 1));
    angles.push(interior);
  }
  
  // 2. Each interior angle 90° ± 15°
  const deg90 = Math.PI / 2;
  const tolerance = (15 * Math.PI) / 180;
  for (const angle of angles) {
    if (Math.abs(angle - deg90) > tolerance) return 'complex';
  }
  
  // 3. Measure sides and check parallel
  const sides: { len: number; ux: number; uz: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % 4]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    sides.push({ len, ux: dx / len, uz: dz / len });
  }
  
  const dot02 = sides[0]!.ux * sides[2]!.ux + sides[0]!.uz * sides[2]!.uz;
  const dot13 = sides[1]!.ux * sides[3]!.ux + sides[1]!.uz * sides[3]!.uz;
  
  const len01 = sides[0]!.len + sides[2]!.len;
  const len13 = sides[1]!.len + sides[3]!.len;
  const shortPairDot = len01 < len13 ? dot02 : dot13;
  const longPairDot = len01 < len13 ? dot13 : dot02;
  
  if (Math.abs(shortPairDot + 1) > 0.25) {
    if (Math.abs(shortPairDot + 1) > 0.4) return 'complex';
  }
  if (Math.abs(longPairDot + 1) > 0.25) return 'complex';
  
  // 4. Aspect ratio ≥ 1.15
  const long = Math.max(sides[0]!.len, sides[1]!.len, sides[2]!.len, sides[3]!.len);
  const short = Math.min(sides[0]!.len, sides[1]!.len, sides[2]!.len, sides[3]!.len);
  const aspect = long / (short || 1);
  
  if (aspect < 1.15) return 'compact';
  
  return 'rect';
}

/** Check if polygon is convex (all turns same direction). */
function isConvex(ring: Point2[]): boolean {
  if (ring.length < 3) return false;
  let sign = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % n]!;
    const [x2, z2] = ring[(i + 2) % n]!;
    const dx1 = x1 - x0;
    const dz1 = z1 - z0;
    const dx2 = x2 - x1;
    const dz2 = z2 - z1;
    const cross = dx1 * dz2 - dz1 * dx2;
    if (Math.abs(cross) > 1e-6) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}

/** Check if point is inside polygon (ray casting). */
function pointInPolygon(px: number, pz: number, ring: Point2[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Runtime validator for roof geometry - returns true if valid, false if must fallback. */
function validateRoofGeometry(
  geometry: THREE.BufferGeometry,
  footprint: Point2[],
  wallTopY: number,
  maxOverhang: number,
): { valid: boolean; reason?: string } {
  const pos = geometry.getAttribute('position');
  if (!pos) return { valid: false, reason: 'no position attribute' };
  
  // 1. Finite vertices
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { valid: false, reason: 'non-finite vertex' };
    }
  }
  
  // 2. Min roof Y >= wallTopY (with small epsilon tolerance)
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
  }
  if (minY < wallTopY - 0.001) {
    return { valid: false, reason: 'roof below wall top' };
  }
  
  // 3. Check max overhang from footprint
  let cx = 0;
  let cz = 0;
  for (const [x, z] of footprint) {
    cx += x;
    cz += z;
  }
  cx /= footprint.length;
  cz /= footprint.length;
  
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    
    // Check if vertex is inside footprint
    const inside = pointInPolygon(x, z, footprint);
    
    if (!inside) {
      // Outside footprint: measure distance to boundary
      let minDist = Infinity;
      const n = footprint.length;
      for (let j = 0; j < n; j++) {
        const [x0, z0] = footprint[j]!;
        const [x1, z1] = footprint[(j + 1) % n]!;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len2 = dx * dx + dz * dz;
        if (len2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / len2));
        const px = x0 + t * dx;
        const pz = z0 + t * dz;
        const d = Math.hypot(x - px, z - pz);
        minDist = Math.min(minDist, d);
      }
      // Outside vertices only allowed within maxOverhang
      if (minDist > maxOverhang) {
        return { valid: false, reason: 'excessive overhang' };
      }
    }
    // Inside footprint → always OK horizontally
  }
  
  // 4. Check for degenerate triangles in 3D. Testing only projected XZ area
  // incorrectly rejects the two perfectly valid vertical gable-end faces.
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i);
      const i1 = index.getX(i + 1);
      const i2 = index.getX(i + 2);
      const x0 = pos.getX(i0);
      const y0 = pos.getY(i0);
      const z0 = pos.getZ(i0);
      const x1 = pos.getX(i1);
      const y1 = pos.getY(i1);
      const z1 = pos.getZ(i1);
      const x2 = pos.getX(i2);
      const y2 = pos.getY(i2);
      const z2 = pos.getZ(i2);
      
      const abx = x1 - x0;
      const aby = y1 - y0;
      const abz = z1 - z0;
      const acx = x2 - x0;
      const acy = y2 - y0;
      const acz = z2 - z0;
      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;
      if (Math.hypot(crossX, crossY, crossZ) < 1e-4) {
        return { valid: false, reason: 'degenerate triangle' };
      }
    }
  }
  
  return { valid: true };
}

function pushUpwardTriangle(
  idx: number[],
  pos: number[],
  ia: number,
  ib: number,
  ic: number,
) {
  const ax = pos[ia * 3]!;
  const az = pos[ia * 3 + 2]!;
  const bx = pos[ib * 3]!;
  const bz = pos[ib * 3 + 2]!;
  const cx = pos[ic * 3]!;
  const cz = pos[ic * 3 + 2]!;
  // Y component of (B-A) x (C-A). FrontSide culling follows index winding,
  // not the normal attribute, so an upward normal alone cannot make a
  // downward-wound XZ triangle visible from above.
  const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (normalY >= 0) idx.push(ia, ib, ic);
  else idx.push(ia, ic, ib);
}

/** SAFE flat roof - ALWAYS succeeds, NEVER returns null. */
function makeFlatRoof(ring: Point2[], wallH: number): THREE.BufferGeometry {
  // Use the actual wall ring for the guaranteed fallback. The previous
  // per-edge "overhang" moved each vertex along only its outgoing edge normal;
  // for a CCW ring that points inward and can shrink/shear the cap. Exact
  // footprint coverage is safer than a malformed decorative overhang.
  const finalRing = ring;
  const contour = finalRing.map(([x, z]) => new THREE.Vector2(x, z));
  
  // Triangulate - if this fails, make a simple fan from centroid
  let faces = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!faces.length && finalRing.length >= 3) {
    // Fallback: fan from first vertex
    faces = [];
    for (let i = 1; i < finalRing.length - 1; i++) {
      faces.push([0, i, i + 1]);
    }
  }
  
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const y = wallH + 0.02; // Epsilon above wall
  
  for (const [x, z] of finalRing) {
    pos.push(x, y, z);
    nrm.push(0, 1, 0);
  }
  
  for (const f of faces) {
    pushUpwardTriangle(idx, pos, f[0]!, f[1]!, f[2]!);
  }
  
  // If no faces, create minimal cap
  if (idx.length === 0 && finalRing.length >= 3) {
    for (let i = 1; i < finalRing.length - 1; i++) {
      pushUpwardTriangle(idx, pos, 0, i, i + 1);
    }
  }
  
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g; // ALWAYS returns valid geometry, NEVER null
}

/** Hip/pyramid roof - VERY conservative, falls back to flat on validation fail. */
function makeHipRoof(ring: Point2[], wallH: number): THREE.BufferGeometry {
  // Validation checks - if any fail, return flat slab
  if (ring.length < 3 || ring.length > 6) {
    return roofFallback(ring, wallH);
  }
  
  if (!isConvex(ring)) {
    return roofFallback(ring, wallH);
  }
  
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x;
    cz += z;
  }
  cx /= ring.length;
  cz /= ring.length;
  
  if (!pointInPolygon(cx, cz, ring)) {
    return roofFallback(ring, wallH);
  }
  
  // Check for triangle crossings
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = ring[i]!;
    const mx = (x + cx) * 0.5;
    const mz = (z + cz) * 0.5;
    if (!pointInPolygon(mx, mz, ring)) {
      return roofFallback(ring, wallH);
    }
  }
  
  // Build hip geometry
  let maxDist = 0;
  for (const [x, z] of ring) {
    const d = Math.hypot(x - cx, z - cz);
    maxDist = Math.max(maxDist, d);
  }
  
  const rise = Math.min(2.5, Math.max(0.8, maxDist * 0.7));
  const baseY = wallH + 0.02;
  const peakY = baseY + rise;
  
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % n]!;
    
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    // simplifyFootprint normalises the ring CCW in XZ. Its outward edge
    // normal is (dz, -dx); the old sign pointed inward and left the walls
    // protruding beyond the roof.
    const nx = dz / len;
    const nz = -dx / len;
    
    const ex0 = x0 + nx * OVERHANG_M;
    const ez0 = z0 + nz * OVERHANG_M;
    const ex1 = x1 + nx * OVERHANG_M;
    const ez1 = z1 + nz * OVERHANG_M;
    
    const base = pos.length / 3;
    pos.push(ex0, baseY, ez0);
    pos.push(ex1, baseY, ez1);
    pos.push(cx, peakY, cz);
    
    const v1x = ex1 - ex0;
    const v1y = 0;
    const v1z = ez1 - ez0;
    const v2x = cx - ex0;
    const v2y = peakY - baseY;
    const v2z = cz - ez0;
    
    let fnx = v1y * v2z - v1z * v2y;
    let fny = v1z * v2x - v1x * v2z;
    let fnz = v1x * v2y - v1y * v2x;
    const flen = Math.hypot(fnx, fny, fnz) || 1;
    fnx /= flen;
    fny /= flen;
    fnz /= flen;
    
    if (fny < 0) {
      fnx = -fnx;
      fny = -fny;
      fnz = -fnz;
      idx.push(base, base + 2, base + 1);
    } else {
      idx.push(base, base + 1, base + 2);
    }
    nrm.push(fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz);
  }
  
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  
  // Runtime validation - fallback to flat if fails
  const validation = validateRoofGeometry(g, ring, wallH, MAX_OVERHANG_DISTANCE_M);
  if (!validation.valid) {
    g.dispose();
    return roofFallback(ring, wallH);
  }
  
  buildingDiagnostics.roofHardPass += 1;
  return g;
}

/** Gable roof - falls back to flat on validation fail. */
function makeGableRoof(ring: Point2[], wallH: number): THREE.BufferGeometry {
  if (ring.length !== 4) {
    return roofFallback(ring, wallH);
  }
  
  // PCA for elongated rects, longest edge for near-square
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x;
    cz += z;
  }
  cx /= 4;
  cz /= 4;
  
  // Measure side lengths first
  const sides: { len: number; ux: number; uz: number; idx: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % 4]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    sides.push({ len, ux: dx / len, uz: dz / len, idx: i });
  }
  
  // Find longest side
  sides.sort((a, b) => b.len - a.len);
  const long = sides[0]!.len;
  const short = sides[3]!.len;
  const aspect = long / (short || 1);
  
  let ax: number, az: number;
  
  if (aspect < 1.3) {
    // Near-square: use longest footprint edge for stable tie-break
    const longest = sides[0]!;
    ax = longest.ux;
    az = longest.uz;
  } else {
    // Elongated: use PCA
    let xx = 0;
    let zz = 0;
    let xz = 0;
    for (const [x, z] of ring) {
      const dx = x - cx;
      const dz = z - cz;
      xx += dx * dx;
      zz += dz * dz;
      xz += dx * dz;
    }
    
    const trace = xx + zz;
    const disc = Math.max(0, (trace * trace) / 4 - (xx * zz - xz * xz));
    const l1 = trace / 2 + Math.sqrt(disc);
    ax = xz;
    az = l1 - xx;
    if (Math.hypot(ax, az) < 1e-8) {
      ax = l1 - zz;
      az = xz;
    }
    const len = Math.hypot(ax, az);
    if (len < 1e-8) {
      ax = 1;
      az = 0;
    } else {
      ax /= len;
      az /= len;
    }
  }
  
  const bx = -az;
  const bz = ax;
  
  // Project onto axes
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  
  for (const [x, z] of ring) {
    const u = (x - cx) * ax + (z - cz) * az;
    const v = (x - cx) * bx + (z - cz) * bz;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  
  const halfW = Math.max(0.5, (vMax - vMin) * 0.5);
  const rise = Math.min(2.7, Math.max(0.85, halfW * GABLE_TAN));
  const baseY = wallH + 0.02;
  const ridgeY = baseY + rise;
  
  const pad = OVERHANG_M;
  const r0x = cx + (uMin - pad) * ax;
  const r0z = cz + (uMin - pad) * az;
  const r1x = cx + (uMax + pad) * ax;
  const r1z = cz + (uMax + pad) * az;
  
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  
  // Two slopes
  const quad1 = [
    { x: r0x + bx * (vMax + pad), y: baseY, z: r0z + bz * (vMax + pad) },
    { x: r1x + bx * (vMax + pad), y: baseY, z: r1z + bz * (vMax + pad) },
    { x: r1x, y: ridgeY, z: r1z },
    { x: r0x, y: ridgeY, z: r0z },
  ];
  emitQuad(pos, nrm, idx, quad1);
  
  const quad2 = [
    { x: r0x + bx * (vMin - pad), y: baseY, z: r0z + bz * (vMin - pad) },
    { x: r0x, y: ridgeY, z: r0z },
    { x: r1x, y: ridgeY, z: r1z },
    { x: r1x + bx * (vMin - pad), y: baseY, z: r1z + bz * (vMin - pad) },
  ];
  emitQuad(pos, nrm, idx, quad2);
  
  // Two gable ends
  const tri1 = [
    { x: r0x + bx * (vMin - pad), y: baseY, z: r0z + bz * (vMin - pad) },
    { x: r0x + bx * (vMax + pad), y: baseY, z: r0z + bz * (vMax + pad) },
    { x: r0x, y: ridgeY, z: r0z },
  ];
  emitTri(pos, nrm, idx, tri1);
  
  const tri2 = [
    { x: r1x + bx * (vMax + pad), y: baseY, z: r1z + bz * (vMax + pad) },
    { x: r1x + bx * (vMin - pad), y: baseY, z: r1z + bz * (vMin - pad) },
    { x: r1x, y: ridgeY, z: r1z },
  ];
  emitTri(pos, nrm, idx, tri2);
  
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  
  // Runtime validation - fallback to flat if fails
  const validation = validateRoofGeometry(g, ring, wallH, MAX_OVERHANG_DISTANCE_M);
  if (!validation.valid) {
    g.dispose();
    return roofFallback(ring, wallH);
  }
  
  buildingDiagnostics.roofHardPass += 1;
  return g;
}

function emitQuad(
  pos: number[],
  nrm: number[],
  idx: number[],
  pts: { x: number; y: number; z: number }[],
) {
  if (pts.length !== 4) return;
  const [a, b, c, d] = pts;
  
  // Compute normal from first triangle
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  
  const base = pos.length / 3;
  const flip = ny < 0;
  if (flip) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function emitTri(
  pos: number[],
  nrm: number[],
  idx: number[],
  pts: { x: number; y: number; z: number }[],
) {
  if (pts.length !== 3) return;
  const [a, b, c] = pts;
  
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  
  const base = pos.length / 3;
  const flip = ny < 0;
  if (flip) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  if (flip) idx.push(base, base + 2, base + 1);
  else idx.push(base, base + 1, base + 2);
}

function concatGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geoms.length) return null;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geoms) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const index = g.getIndex();
    if (!p) continue;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      else nrm.push(0, 1, 0);
    }
    if (index) {
      for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
    }
    base += p.count;
    g.dispose();
  }
  if (!pos.length) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/**
 * JOURNAL.WORLD L4: closed house meshes with deterministic roofs.
 * Pipeline: OSM footprint → simplified mass → modest walls → roof on THAT mass.
 * Three cases: rect→gable, compact→hip, complex→flat. No broken topology.
 */
export function makeBuildings(
  items: Building[],
  sampleHeight: HeightFn,
  ex: number,
  foundation: FoundationMode = 'min_footprint',
) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const wallGeoms: THREE.BufferGeometry[][] = WALL_PALETTE.map(() => []);
  const roofGeoms: THREE.BufferGeometry[][] = ROOF_PALETTE.map(() => []);

  buildingDiagnostics.remoteBuildingsReceived += items.length;

  for (const b of items) {
    if (b.footprint.length < 3) continue;
    const rng = mulberry32(b.seed || 1);
    const wallI = Math.floor(rng() * WALL_PALETTE.length) % WALL_PALETTE.length;
    const roofI = Math.floor(rng() * ROOF_PALETTE.length) % ROOF_PALETTE.length;
    
    // Simplified stable mass
    const ring = simplifyFootprint(b.footprint, 0.4, MAX_FOOTPRINT_VERTS);
    if (ring.length < 3) continue;
    
    const wallH = wallHeightFromFloors(b.floors);
    const mode = b.foundation ?? foundation;
    const base = foundationElevation(b.footprint, sampleHeight, ex, mode) + GROUND_EPS;
    
    // Walls (no top cap - roof is the cap)
    const wallG = makePrismGeometry(ring, wallH, false, MAX_FOOTPRINT_VERTS);
    if (!wallG) continue;
    wallG.translate(0, base, 0);
    wallGeoms[wallI]!.push(wallG);
    
    // Deterministic roof on simplified mass
    const shape = classifyFootprint(ring);
    
    // CRITICAL: roof functions ALWAYS return valid geometry, never null
    // If validation fails, they fall back to safe flat roof
    buildingDiagnostics.roofAttempts += 1;
    let roofG: THREE.BufferGeometry;
    
    if (shape === 'rect') {
      roofG = makeGableRoof(ring, wallH);
    } else if (shape === 'compact') {
      roofG = makeHipRoof(ring, wallH);
    } else {
      // Intentional flat for complex footprints — not a validation fallback
      roofG = makeFlatRoof(ring, wallH);
      buildingDiagnostics.roofHardPass += 1;
    }
    
    // NEVER omit a roof - every building MUST have one
    roofG.translate(0, base, 0);
    roofGeoms[roofI]!.push(roofG);
  }

  for (let i = 0; i < WALL_PALETTE.length; i++) {
    const merged = concatGeometries(wallGeoms[i]!);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, wallMat(WALL_PALETTE[i]!));
    mesh.name = 'buildings-wall';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    buildingDiagnostics.wallMeshesCreated += 1;
  }
  for (let i = 0; i < ROOF_PALETTE.length; i++) {
    const bucket = roofGeoms[i]!;
    if (!bucket.length) continue;
    const merged = concatGeometries(bucket);
    if (!merged) {
      buildingDiagnostics.roofConcatFailed += 1;
      buildingDiagnostics.roofGeomsEmpty += 1;
      continue;
    }
    const mesh = new THREE.Mesh(merged, roofMat(ROOF_PALETTE[i]!));
    mesh.name = 'buildings-roof';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = true;
    group.add(mesh);
    buildingDiagnostics.roofMeshesAttached += 1;
    if (mesh.visible) buildingDiagnostics.roofMeshesVisible += 1;
  }
  return group;
}

export function foundationElevation(
  footprint: Point2[],
  sampleHeight: HeightFn,
  ex: number,
  mode: FoundationMode,
): number {
  const samples = sampleFootprint(footprint);
  const ys = samples.map(([x, z]) => sampleHeight(x, z, ex));
  if (ys.length === 0) return 0;
  if (mode === 'median_footprint') {
    const sorted = [...ys].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  return Math.min(...ys);
}

export function sampleFootprint(footprint: Point2[]): Point2[] {
  const ring = simplifyFootprint(footprint);
  const out: Point2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]!;
    const [x1, z1] = ring[(i + 1) % n]!;
    out.push([x0, z0]);
    out.push([(x0 + x1) / 2, (z0 + z1) / 2]);
  }
  return out;
}

/** L3 cheap settlement mass — bbox prism. Standard muted tan, sticky 1000/1400 only. */
export function makeBuildingMasses(items: Building[], sampleHeight: HeightFn, ex: number) {
  const group = new THREE.Group();
  group.name = 'buildings-mass';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8a88c,
    roughness: 0.94,
    metalness: 0,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const geoms: THREE.BufferGeometry[] = [];
  for (const b of items) {
    if (b.footprint.length < 3) continue;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    let cx = 0,
      cz = 0;
    for (const [x, z] of b.footprint) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      cx += x;
      cz += z;
    }
    cx /= b.footprint.length;
    cz /= b.footprint.length;
    const h = wallHeightFromFloors(b.floors);
    const y = sampleHeight(cx, cz, ex);
    const g = makePrismGeometry(
      [
        [minX, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [minX, maxZ],
      ],
      h,
      true,
    );
    if (!g) continue;
    g.translate(0, y + GROUND_EPS, 0);
    geoms.push(g);
  }
  const merged = concatGeometries(geoms);
  if (merged) {
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'buildings-mass';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
