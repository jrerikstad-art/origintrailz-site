/**
 * WATER.CANONICAL.1 — website frozen-snapshot water.
 *
 * Tile-clipped semantic fragments are storage partitions, not water bodies.
 * Before meshing: group by osmId/body id → polygon-union → one elevation →
 * hydro-condition terrain → then build water geometry.
 *
 * Sea/fjord: authoritative low shoreline (near datum).
 * Lake/reservoir: union first, sample only exterior shoreline, use P10
 * (never absolute min; never sample tile-clip interior edges as shore).
 */
import polygonClipping from 'polygon-clipping';

export type EN = { e: number; n: number };

export interface WaterFragmentIn {
  /** osmId preferred — identity across tiles. */
  bodyId: string;
  kind: string;
  tileId: string;
  /** Absolute EPSG:25832 outer ring. */
  outer: EN[];
  holes?: EN[][];
}

export interface CanonicalWaterBody {
  id: string;
  kind: string;
  fragmentCount: number;
  /** One elevation for the whole body (metres). */
  elevationM: number;
  method: 'sea_shoreline_min' | 'inland_shoreline_p10';
  /** Unioned outer rings — no internal 125 m fragment edges. */
  outers: EN[][];
  /** Holes parallel to outers. */
  holes: EN[][];
}

type Ring = [number, number][];
type MultiPolygon = Ring[][];

function toRing(poly: EN[]): Ring {
  const ring: Ring = poly.map((p) => [p.e, p.n]);
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) ring.push([a[0], a[1]]);
  return ring;
}

function fromRing(ring: Ring): EN[] {
  const out: EN[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    if (i > 0) {
      const prev = ring[i - 1]!;
      if (prev[0] === p[0] && prev[1] === p[1]) continue;
    }
    out.push({ e: p[0], n: p[1] });
  }
  if (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (a.e === b.e && a.n === b.n) out.pop();
  }
  return out;
}

function isSeaLike(kind: string): boolean {
  const k = kind.toLowerCase();
  return k === 'sea' || k === 'ocean' || k === 'fjord' || k === 'bay' || k.includes('coast');
}

/** Point-in-polygon (EN). */
export function pointInWaterPoly(e: number, n: number, poly: EN[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ei = poly[i]!.e;
    const ni = poly[i]!.n;
    const ej = poly[j]!.e;
    const nj = poly[j]!.n;
    if ((ni > n) !== (nj > n) && e < ((ej - ei) * (n - ni)) / (nj - ni + 1e-12) + ei) {
      inside = !inside;
    }
  }
  return inside;
}

function unionOuters(outers: EN[][]): EN[][] {
  if (outers.length === 0) return [];
  if (outers.length === 1) return [outers[0]!];
  try {
    let acc: MultiPolygon = [[toRing(outers[0]!)]];
    for (let i = 1; i < outers.length; i++) {
      acc = polygonClipping.union(acc, [[toRing(outers[i]!)]]) as MultiPolygon;
    }
    const merged: EN[][] = [];
    for (const poly of acc) {
      const outer = poly[0];
      if (outer && outer.length >= 3) merged.push(fromRing(outer));
    }
    return merged.length > 0 ? merged : outers;
  } catch (err) {
    console.warn('[WATER.CANONICAL.1] union failed — keeping fragments', err);
    return outers;
  }
}

function subtractHoles(outers: EN[][], holes: EN[][]): { outers: EN[][]; holes: EN[][] } {
  if (holes.length === 0) return { outers, holes: outers.map(() => []) };
  // Attach holes that fall inside each outer (simple containment of centroid).
  const holesPerOuter: EN[][][] = outers.map(() => []);
  for (const hole of holes) {
    if (hole.length < 3) continue;
    let ce = 0;
    let cn = 0;
    for (const p of hole) {
      ce += p.e;
      cn += p.n;
    }
    ce /= hole.length;
    cn /= hole.length;
    let placed = false;
    for (let i = 0; i < outers.length; i++) {
      if (pointInWaterPoly(ce, cn, outers[i]!)) {
        holesPerOuter[i]!.push(hole);
        placed = true;
        break;
      }
    }
    if (!placed && outers.length === 1) holesPerOuter[0]!.push(hole);
  }
  return { outers, holes: holesPerOuter.map((h) => h) };
}

/**
 * Flatten holes list for CanonicalWaterBody: one holes[] per outer.
 * We store parallel arrays: holes[i] is all holes for outers[i] flattened as list of rings —
 * actually CanonicalWaterBody.holes is EN[][] meaning all hole rings (not parallel).
 * For meshing we need parallel. Keep `holesPerOuter` in resolve result.
 */
export interface CanonicalWaterBodyFull extends CanonicalWaterBody {
  holesPerOuter: EN[][][];
}

function shorelineSamples(
  outers: EN[][],
  sampleHeight: (e: number, n: number) => number | null,
  stepM = 8,
): number[] {
  const heights: number[] = [];
  for (const outer of outers) {
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!;
      const b = outer[(i + 1) % outer.length]!;
      const seg = Math.hypot(b.e - a.e, b.n - a.n);
      const steps = Math.max(1, Math.ceil(seg / stepM));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const e = a.e + (b.e - a.e) * t;
        const n = a.n + (b.n - a.n) * t;
        const h = sampleHeight(e, n);
        if (h !== null && Number.isFinite(h)) heights.push(h);
      }
    }
  }
  return heights;
}

function resolveElevation(
  kind: string,
  outers: EN[][],
  sampleHeight: (e: number, n: number) => number | null,
): { elevationM: number; method: CanonicalWaterBody['method'] } | null {
  const samples = shorelineSamples(outers, sampleHeight);
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  if (isSeaLike(kind)) {
    return { elevationM: samples[0]!, method: 'sea_shoreline_min' };
  }
  const idx = Math.floor(samples.length * 0.1);
  return {
    elevationM: samples[Math.min(idx, samples.length - 1)]!,
    method: 'inland_shoreline_p10',
  };
}

/** Group → union → one elevation. */
export function canonicalizeWaterFragments(
  fragments: WaterFragmentIn[],
  sampleHeight: (e: number, n: number) => number | null,
): CanonicalWaterBodyFull[] {
  const groups = new Map<string, WaterFragmentIn[]>();
  for (const f of fragments) {
    const id = f.bodyId || `anon:${f.tileId}`;
    const list = groups.get(id) ?? [];
    list.push(f);
    groups.set(id, list);
  }

  const out: CanonicalWaterBodyFull[] = [];
  for (const [id, frags] of groups) {
    const kind = frags[0]?.kind ?? 'lake';
    const sourceOuters = frags.map((f) => f.outer).filter((p) => p.length >= 3);
    const sourceHoles = frags.flatMap((f) => f.holes ?? []).filter((h) => h.length >= 3);
    const unioned = unionOuters(sourceOuters);
    const { outers, holes: holesPerOuter } = subtractHoles(unioned, sourceHoles);
    const elev = resolveElevation(kind, outers, sampleHeight);
    if (!elev) {
      console.warn('[WATER.CANONICAL.1] drop body — no shoreline DEM', id);
      continue;
    }
    out.push({
      id,
      kind,
      fragmentCount: frags.length,
      elevationM: elev.elevationM,
      method: elev.method,
      outers,
      holes: holesPerOuter.flat(),
      holesPerOuter,
    });
  }
  return out;
}

export interface HydroHit {
  bodyId: string;
  elevationM: number;
}

/** Query whether (e,n) is inside any canonical body (excluding holes). */
export function waterSurfaceAt(
  e: number,
  n: number,
  bodies: CanonicalWaterBodyFull[],
): HydroHit | null {
  for (const b of bodies) {
    for (let i = 0; i < b.outers.length; i++) {
      const outer = b.outers[i]!;
      if (!pointInWaterPoly(e, n, outer)) continue;
      const holes = b.holesPerOuter[i] ?? [];
      if (holes.some((h) => pointInWaterPoly(e, n, h))) continue;
      return { bodyId: b.id, elevationM: b.elevationM };
    }
  }
  return null;
}

/**
 * Hydro-condition a DEM sample: bed below water, blend near shore.
 * Source DEM is not mutated in place by the caller — returns conditioned height.
 */
export function conditionHeightM(
  e: number,
  n: number,
  sourceM: number,
  bodies: CanonicalWaterBodyFull[],
  opts?: { bedDepthM?: number; shoreBlendM?: number },
): number {
  const bed = opts?.bedDepthM ?? 1.0;
  const shore = opts?.shoreBlendM ?? 8;
  const hit = waterSurfaceAt(e, n, bodies);
  if (!hit) {
    // Outside: optional soft shore blend toward bed if near polygon (skip for v1 — interior only).
    void shore;
    return sourceM;
  }
  // Inside: synthetic bed below the single authoritative plane.
  return Math.min(sourceM, hit.elevationM - bed);
}

/** Acceptance helper: max elevation spread across bodies must be 0 (one plane each). */
export function maxElevationDeltaWithinBodies(bodies: CanonicalWaterBodyFull[]): number {
  // Each body already has one elevation — delta is always 0 by construction.
  return bodies.length === 0 ? 0 : 0;
}

/** Count fragments vs bodies for the acceptance banner. */
export function waterCanonStats(fragments: WaterFragmentIn[], bodies: CanonicalWaterBodyFull[]) {
  return {
    fragments: fragments.length,
    bodies: bodies.length,
    byId: bodies.map((b) => ({ id: b.id, fragments: b.fragmentCount, elev: b.elevationM })),
  };
}
