/**
 * Gate L.0 — semantic landcover.
 *
 * The ground was previously shaded from elevation and slope alone, so every
 * low-lying surface read as the same meadow green regardless of whether it was
 * farmland, heath, bare rock or a car park. Landcover supplies a base ground
 * class per world position; the existing elevation/slope shading then modulates
 * it, so terrain relief still reads.
 *
 * Polygons are semantic, not visual: a chunk stores `kind` and the ring, never
 * a colour. The palette lives in the renderer and can be replaced by an art
 * profile without reprocessing geography.
 */
import { pointInPoly } from './vegetation';
import type { Forest, Landcover, LandcoverKind, Point2 } from './types';

/** JOURNAL.WORLD art tokens — classes must read; elevation only shades. */
export const FOREST_FLOOR = 0x5c6b48;
export const FOREST_FLOOR_STRENGTH = 0.58;

const PALETTE: Record<LandcoverKind, number> = {
  farmland: 0xc6b17a,
  meadow: 0xb4c07a,
  grass: 0x8fa56a,
  heath: 0x8b8460,
  scrub: 0x8b8460,
  moor: 0x8b8460,
  wetland: 0x6e8b86,
  bare_rock: 0xb8ad9c,
  scree: 0xb8ad9c,
  sand: 0xdcc9a4,
  residential: 0x9a9384,
  industrial: 0x8e8a83,
  quarry: 0x8f8577,
  orchard: 0x87a05e,
  cemetery: 0x86956a,
  pitch: 0x7fa163,
  unknown: 0x86a05e,
};

/**
 * How strongly a class asserts itself over elevation/slope shading.
 * Built surfaces hold their colour; vegetation yields to relief.
 */
const STRENGTH: Record<LandcoverKind, number> = {
  farmland: 0.92,
  meadow: 0.88,
  grass: 0.86,
  heath: 0.9,
  scrub: 0.88,
  moor: 0.9,
  wetland: 0.92,
  bare_rock: 0.9,
  scree: 0.85,
  sand: 0.9,
  residential: 0.8,
  industrial: 0.85,
  quarry: 0.85,
  orchard: 0.7,
  cemetery: 0.7,
  pitch: 0.8,
  unknown: 0.0,
};

export function landcoverColor(kind: LandcoverKind): number {
  return PALETTE[kind] ?? PALETTE.unknown;
}

export function landcoverStrength(kind: LandcoverKind): number {
  return STRENGTH[kind] ?? 0;
}

/** OSM tags to a landcover class. Mirrors classifyWaterArea in waterKinds. */
export function classifyLandcover(
  tags: Record<string, string> = {},
): LandcoverKind | null {
  const landuse = tags.landuse ?? '';
  const natural = tags.natural ?? '';
  const leisure = tags.leisure ?? '';
  const amenity = tags.amenity ?? '';
  const surface = tags.surface ?? '';

  // Vegetation handled by the Forest layer — never claim it here.
  if (landuse === 'forest' || natural === 'wood') return null;

  // Closed water areas — W.0 / hydro own the surface colour.
  if (tags.natural === 'water' || tags.water || tags.waterway) return null;

  if (landuse === 'farmland' || landuse === 'farm' || landuse === 'allotments') {
    return 'farmland';
  }
  if (landuse === 'meadow' || landuse === 'grass' || natural === 'grassland') {
    return landuse === 'grass' ? 'grass' : 'meadow';
  }
  if (landuse === 'orchard' || landuse === 'vineyard') return 'orchard';
  if (landuse === 'residential') return 'residential';
  if (landuse === 'industrial' || landuse === 'retail' || landuse === 'commercial') {
    return 'industrial';
  }
  if (landuse === 'quarry' || landuse === 'landfill') return 'quarry';
  if (landuse === 'cemetery' || amenity === 'grave_yard') return 'cemetery';

  if (natural === 'heath') return 'heath';
  if (natural === 'scrub') return 'scrub';
  if (natural === 'moor' || natural === 'tundra') return 'moor';
  if (natural === 'wetland' || landuse === 'wetland') return 'wetland';
  if (natural === 'bare_rock' || natural === 'rock' || natural === 'cliff') {
    return 'bare_rock';
  }
  if (natural === 'scree' || natural === 'shingle') return 'scree';
  if (natural === 'sand' || natural === 'beach' || surface === 'sand') return 'sand';

  if (leisure === 'pitch' || leisure === 'golf_course' || leisure === 'park') {
    return leisure === 'pitch' ? 'pitch' : 'grass';
  }

  return null;
}

interface IndexedPoly {
  kind: LandcoverKind;
  priority: number;
  poly: Point2[];
  bbox: [number, number, number, number];
}

function polyBbox(poly: Point2[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of poly) {
    if (x < x0) x0 = x;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

function polyArea(poly: Point2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

const CELL_M = 64;

/**
 * Uniform-grid spatial index over landcover polygons.
 *
 * Terrain shading queries this once per vertex — roughly 66k times per 250 m
 * tile — so a linear scan over every polygon in the loaded world is not
 * viable. Bucketing by bbox reduces a query to the handful of polygons whose
 * bounds overlap one 64 m cell.
 */
type TileGroundSource = {
  id: string;
  worldX: number;
  worldZ: number;
  landcover?: Landcover[];
  forests?: Forest[];
};

interface IndexedForest {
  poly: Point2[];
  bbox: [number, number, number, number];
}

export class LandcoverIndex {
  private cells = new Map<string, IndexedPoly[]>();
  private entries: IndexedPoly[] = [];
  private forestCells = new Map<string, IndexedForest[]>();
  private forestEntries: IndexedForest[] = [];
  private fp = 'empty';

  /** Rebuild from the loaded semantic tiles. Returns false when fingerprint unchanged. */
  setPolygons(source: Iterable<TileGroundSource>): boolean {
    const nextFp = this.computeFingerprint(source);
    if (nextFp === this.fp) return false;

    this.cells.clear();
    this.entries = [];
    this.forestCells.clear();
    this.forestEntries = [];
    const parts: string[] = [];

    for (const tile of source) {
      const items = tile.landcover ?? [];
      const woods = tile.forests ?? [];
      if (items.length === 0 && woods.length === 0) continue;
      parts.push(`${tile.id}:${items.length}:f${woods.length}`);
      for (const lc of items) {
        if (!lc.polygon || lc.polygon.length < 3) continue;
        const world: Point2[] = lc.polygon.map(
          ([x, z]) => [tile.worldX + x, tile.worldZ + z] as Point2,
        );
        // Smaller polygons win: a quarry inside farmland should read as quarry.
        const entry: IndexedPoly = {
          kind: lc.kind,
          priority: -polyArea(world),
          poly: world,
          bbox: polyBbox(world),
        };
        this.entries.push(entry);
      }
      for (const f of woods) {
        if (!f.polygon || f.polygon.length < 3) continue;
        const world: Point2[] = f.polygon.map(
          ([x, z]) => [tile.worldX + x, tile.worldZ + z] as Point2,
        );
        this.forestEntries.push({ poly: world, bbox: polyBbox(world) });
      }
    }

    const bucketize = <T extends { bbox: [number, number, number, number] }>(
      list: T[],
      map: Map<string, T[]>,
    ) => {
      for (const e of list) {
        const [x0, z0, x1, z1] = e.bbox;
        const cx0 = Math.floor(x0 / CELL_M);
        const cz0 = Math.floor(z0 / CELL_M);
        const cx1 = Math.floor(x1 / CELL_M);
        const cz1 = Math.floor(z1 / CELL_M);
        for (let cz = cz0; cz <= cz1; cz++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const key = `${cx},${cz}`;
            let bucket = map.get(key);
            if (!bucket) {
              bucket = [];
              map.set(key, bucket);
            }
            bucket.push(e);
          }
        }
      }
    };
    bucketize(this.entries, this.cells);
    bucketize(this.forestEntries, this.forestCells);

    for (const bucket of this.cells.values()) {
      bucket.sort((a, b) => a.priority - b.priority);
    }
    this.fp = parts.sort().join('|') || 'empty';
    return true;
  }

  private computeFingerprint(source: Iterable<TileGroundSource>): string {
    const parts: string[] = [];
    for (const tile of source) {
      const items = tile.landcover ?? [];
      const woods = tile.forests ?? [];
      if (items.length === 0 && woods.length === 0) continue;
      parts.push(`${tile.id}:${items.length}:f${woods.length}`);
    }
    return parts.sort().join('|') || 'empty';
  }

  fingerprint(): string {
    return this.fp || 'empty';
  }

  count(): number {
    return this.entries.length;
  }

  isEmpty(): boolean {
    return this.entries.length === 0 && this.forestEntries.length === 0;
  }

  /** Landcover class at a world position, or null where nothing claims it. */
  kindAt(worldX: number, worldZ: number): LandcoverKind | null {
    if (this.entries.length === 0) return null;
    const key = `${Math.floor(worldX / CELL_M)},${Math.floor(worldZ / CELL_M)}`;
    const bucket = this.cells.get(key);
    if (!bucket) return null;

    const p: Point2 = [worldX, worldZ];
    for (const e of bucket) {
      const [x0, z0, x1, z1] = e.bbox;
      if (worldX < x0 || worldX > x1 || worldZ < z0 || worldZ > z1) continue;
      if (pointInPoly(p, e.poly)) return e.kind;
    }
    return null;
  }

  /** Forest polygon presence — trees stay instances; floor bias only. */
  forestAt(worldX: number, worldZ: number): boolean {
    if (this.forestEntries.length === 0) return false;
    const key = `${Math.floor(worldX / CELL_M)},${Math.floor(worldZ / CELL_M)}`;
    const bucket = this.forestCells.get(key);
    if (!bucket) return false;
    const p: Point2 = [worldX, worldZ];
    for (const e of bucket) {
      const [x0, z0, x1, z1] = e.bbox;
      if (worldX < x0 || worldX > x1 || worldZ < z0 || worldZ > z1) continue;
      if (pointInPoly(p, e.poly)) return true;
    }
    return false;
  }
}
