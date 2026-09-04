/**
 * Semantic building ingest — bundled zip and LAN factory tiles share this path.
 * Older payloads may use polygon/height instead of footprint/floors.
 */

import type { Building, Point2 } from './types';

const MIN_FLOORS = 1;
const MAX_FLOORS = 12;
const METRES_PER_FLOOR = 3;

function ringArea(fp: Point2[]): number {
  let a = 0;
  for (let i = 0; i < fp.length; i++) {
    const [x0, z0] = fp[i]!;
    const [x1, z1] = fp[(i + 1) % fp.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a * 0.5;
}

function asPair(p: unknown): Point2 | null {
  if (Array.isArray(p) && p.length >= 2) {
    const x = Number(p[0]);
    const z = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(z)) return [x, z];
    return null;
  }
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    const x = Number(o.x ?? o.e ?? o.easting);
    const z = Number(o.z ?? o.n ?? o.northing);
    if (Number.isFinite(x) && Number.isFinite(z)) return [x, z];
  }
  return null;
}

function parseRing(raw: unknown): Point2[] {
  if (!Array.isArray(raw) || raw.length < 3) return [];
  // GeoJSON polygon: [ [ring], [hole] ]
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return parseRing(raw[0]);
  }
  const out: Point2[] = [];
  for (const p of raw) {
    const pair = asPair(p);
    if (pair) out.push(pair);
  }
  if (out.length >= 4) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) out.pop();
  }
  return out.length >= 3 ? out : [];
}

export function footprintFromBuildingLike(raw: Record<string, unknown>): Point2[] {
  const candidates = [
    raw.footprint,
    raw.polygon,
    raw.ring,
    raw.outer,
    raw.coordinates,
    (raw.geometry as Record<string, unknown> | undefined)?.coordinates,
  ];
  for (const c of candidates) {
    const ring = parseRing(c);
    if (ring.length >= 3) return ring;
  }
  return [];
}

function parseMetres(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.').replace(/m$/i, '').trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function defaultFloorsFromFootprint(
  fp: Point2[],
  tags?: Record<string, string>,
  buildingType?: string,
): number {
  const t = String(buildingType || tags?.building || tags?.['building:type'] || '').toLowerCase();
  if (t === 'garage' || t === 'shed' || t === 'hut' || t === 'cabin' || t === 'kiosk') {
    return 1;
  }
  if (t === 'apartments' || t === 'residential' || t === 'yes' || t === '') {
    const area = Math.abs(ringArea(fp));
    if (area > 0 && area < 40) return 1;
    if (area >= 280) return 3;
    return 2;
  }
  if (t === 'industrial' || t === 'warehouse' || t === 'school' || t === 'church') return 2;
  return 2;
}

export function floorsFromBuildingLike(
  raw: Record<string, unknown>,
  fp: Point2[],
): number {
  const tags =
    raw.sourceTags && typeof raw.sourceTags === 'object'
      ? (raw.sourceTags as Record<string, string>)
      : undefined;
  const explicit = Number(raw.floors ?? raw.levels ?? raw['building:levels'] ?? tags?.['building:levels']);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round(explicit)));
  }
  const heightM = parseMetres(raw.height ?? raw.buildingHeight ?? tags?.height ?? tags?.['building:height']);
  if (heightM != null) {
    return Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round(heightM / METRES_PER_FLOOR)));
  }
  return defaultFloorsFromFootprint(fp, tags, String(raw.type ?? raw.building ?? ''));
}

/** Wall height in metres — never degenerate to a silhouette. */
export function wallHeightFromFloors(floors: number): number {
  const f = Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round(floors) || 2));
  return Math.max(3, Math.min(36, f * METRES_PER_FLOOR));
}

export function normalizeBuilding(raw: unknown, index: number): Building | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const footprint = footprintFromBuildingLike(rec);
  if (footprint.length < 3) return null;
  const floors = floorsFromBuildingLike(rec, footprint);
  const seedRaw = Number(rec.seed);
  const id = String(rec.id ?? rec.osmId ?? rec.canonicalId ?? `b-${index}`);
  const osmId = rec.osmId != null ? String(rec.osmId) : undefined;
  const sourceTags =
    rec.sourceTags && typeof rec.sourceTags === 'object'
      ? (rec.sourceTags as Record<string, string>)
      : undefined;
  const foundation = rec.foundation === 'median_footprint' ? 'median_footprint' : 'min_footprint';
  return {
    id,
    footprint,
    floors,
    seed: Number.isFinite(seedRaw) && seedRaw > 0 ? seedRaw : index + 1,
    foundation,
    osmId,
    sourceTags,
  };
}

export function normalizeSemanticBuildings(list: unknown): Building[] {
  if (!Array.isArray(list)) return [];
  const out: Building[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = normalizeBuilding(list[i], i);
    if (b) out.push(b);
  }
  return out;
}
