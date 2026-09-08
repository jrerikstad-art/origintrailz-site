/**
 * Shared pack loading + scene build for landing hero and contact-sheet candidates.
 */
import * as THREE from 'three';
import { heightfieldFromBuffer } from './engine/world/heightfield';
import { makeHeightfieldTerrain, applySurfaceShading } from './engine/world/terrainMesh';
import { LandcoverIndex, landcoverColor, landcoverStrength } from './engine/world/landcover';
import { makeRoads } from './engine/world/roads';
import { makeWaterAreas, type HeroWaterBody } from './engine/world/water';
import { makeBuildings } from './engine/world/buildings';
import { normalizeSemanticBuildings } from './engine/world/semanticBuildings';
import { pointInPoly } from './engine/world/vegetation';
import type { Building, Landcover, Point2, Road } from './engine/world/types';
import type { Heightfield } from './engine/world/heightfield';
import {
  canonicalizeWaterFragments,
  conditionHeightM,
  waterCanonStats,
  type WaterFragmentIn,
} from './scroll/canonicalWater';
import { resampleHeightfieldTerrain } from './engine/world/terrainMesh';

export const EXAG = 1.2;

export type HeroCameraSpec = {
  fov: number;
  yawRad: number;
  baseDistM: number;
  heightAboveFocusM: number;
  lookAtLiftM: number;
  far: number;
  drift: boolean;
};

export type LodRing = 'core' | 'middle' | 'outer';

export type HeroPackSpec = {
  originE: number;
  originN: number;
  focusE: number;
  focusN: number;
  terrainIds: string[];
  semanticIds: string[];
  worldBase?: string;
  /** Cap concurrent fetches. */
  concurrency?: number;
  /** Per-semantic-tile LOD ring (from hero-pack-lod.json). */
  semanticRings?: Record<string, LodRing>;
  /** When true, apply core/middle/outer feature filters. */
  applyLod?: boolean;
};

type TerrainTileJson = {
  terrain: { uri: string; grid: number; minM: number; maxM: number };
  origin: { easting: number; northing: number };
};

export type LoadedTerrain = {
  id: string;
  worldX: number;
  worldZ: number;
  hf: Heightfield;
  mesh: THREE.Mesh;
};

export function terrainIdsFromRange(ix0: number, ix1: number, iy0: number, iy1: number): string[] {
  const out: string[] = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      out.push(`terrain_250m_${ix}_${iy}`);
    }
  }
  return out;
}

export function semanticIdsFromRange(ix0: number, ix1: number, iy0: number, iy1: number): string[] {
  const out: string[] = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      out.push(`semantic_125m_${ix}_${iy}`);
    }
  }
  return out;
}

function worldUrl(base: string | undefined, path: string): string {
  const b = (base ?? '/world').replace(/\/$/, '');
  return `${b}/${path.replace(/^\//, '')}`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function loadTerrain(
  id: string,
  originE: number,
  originN: number,
  worldBase?: string,
  skirtEdges?: import('./engine/world/terrainMesh').SkirtEdges | false,
): Promise<LoadedTerrain | null> {
  const tileRes = await fetch(worldUrl(worldBase, `terrain/${id}/tile.json`));
  if (!tileRes.ok) return null;
  const tile = (await tileRes.json()) as TerrainTileJson;
  const binRes = await fetch(worldUrl(worldBase, `terrain/${id}/${tile.terrain.uri}`));
  if (!binRes.ok) return null;
  const buf = await binRes.arrayBuffer();
  const hf = heightfieldFromBuffer(
    250,
    {
      grid: tile.terrain.grid,
      encoding: 'uint16',
      minM: tile.terrain.minM,
      maxM: tile.terrain.maxM,
      uri: tile.terrain.uri,
    },
    buf,
  );
  const mesh = makeHeightfieldTerrain(hf, EXAG, undefined, skirtEdges ?? false);
  const worldX = tile.origin.easting - originE;
  const worldZ = originN - tile.origin.northing;
  mesh.position.set(worldX, 0, worldZ);
  mesh.name = id;
  return { id, worldX, worldZ, hf, mesh };
}

export function sampleTerrainY(terrains: LoadedTerrain[], wx: number, wz: number): number {
  const half = 125;
  for (const t of terrains) {
    const lx = wx - t.worldX;
    const lz = wz - t.worldZ;
    if (lx < -half || lx > half || lz < -half || lz > half) continue;
    return t.hf.sampleSurface(lx, lz) * EXAG;
  }
  let best: LoadedTerrain | null = null;
  let bestD = Infinity;
  for (const t of terrains) {
    const d = Math.hypot(wx - t.worldX, wz - t.worldZ);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return 0;
  return best.hf.sampleSurface(wx - best.worldX, wz - best.worldZ) * EXAG;
}

export function setFeatureOpacity(root: THREE.Object3D, opacity: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!('opacity' in std)) continue;
      std.transparent = opacity < 0.99;
      std.opacity = opacity;
      std.needsUpdate = true;
    }
  });
}

export type BuiltHeroScene = {
  scene: THREE.Scene;
  terrains: LoadedTerrain[];
  focusX: number;
  focusY: number;
  focusZ: number;
  dispose: () => void;
};

export async function buildHeroScene(pack: HeroPackSpec): Promise<BuiltHeroScene> {
  const concurrency = pack.concurrency ?? 8;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0ebe0);

  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x6a7a68, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(180, 420, 90);
  scene.add(sun);

  const loaded = await mapPool(pack.terrainIds, concurrency, (id) =>
    loadTerrain(id, pack.originE, pack.originN, pack.worldBase),
  );
  const terrains = loaded.filter((t): t is LoadedTerrain => !!t);
  for (const t of terrains) scene.add(t.mesh);
  if (!terrains.length) {
    throw new Error('no terrain');
  }

  const focusX = pack.focusE - pack.originE;
  const focusZ = pack.originN - pack.focusN;
  const focusY = sampleTerrainY(terrains, focusX, focusZ);

  const landcover = new LandcoverIndex();
  const landcoverTiles: {
    id: string;
    worldX: number;
    worldZ: number;
    landcover: Landcover[];
    forests: [];
  }[] = [];
  const roadsAll: Road[] = [];
  const buildingsAll: Building[] = [];
  const waterBodies: HeroWaterBody[] = [];
  const waterFragments: WaterFragmentIn[] = [];

  await mapPool(pack.semanticIds, concurrency, async (sid) => {
    try {
      const ring: LodRing = pack.semanticRings?.[sid] ?? 'core';
      if (pack.applyLod && ring === 'outer') return;

      const res = await fetch(worldUrl(pack.worldBase, `semantic/${sid}/tile.json`));
      if (!res.ok) return;
      const j = await res.json();
      const ox = (j.origin?.easting ?? 0) - pack.originE;
      const oz = pack.originN - (j.origin?.northing ?? 0);
      const oe = j.origin?.easting ?? 0;
      const on = j.origin?.northing ?? 0;

      if (!pack.applyLod || ring === 'core') {
        landcoverTiles.push({
          id: sid,
          worldX: ox,
          worldZ: oz,
          landcover: (j.landcover ?? []) as Landcover[],
          forests: [],
        });
      }

      const allowBuildings = !pack.applyLod || ring === 'core';
      const allowAllRoads = !pack.applyLod || ring === 'core';
      const allowMainRoads = !pack.applyLod || ring === 'core' || ring === 'middle';
      const allowWater = !pack.applyLod || ring === 'core' || ring === 'middle';

      if (allowMainRoads) {
        for (const r of j.roads ?? []) {
          if (!r.points || r.points.length < 2) continue;
          const cls = String(r.class ?? '').toLowerCase();
          const width = r.width ?? 5;
          const isMain =
            width >= 6 ||
            cls.includes('primary') ||
            cls.includes('secondary') ||
            cls.includes('tertiary') ||
            cls.includes('trunk') ||
            cls.includes('motorway');
          if (!allowAllRoads && !isMain) continue;
          roadsAll.push({
            id: r.id ?? `${sid}-r`,
            width,
            class: r.class,
            points: r.points.map(([x, z]: number[]) => [ox + x, oz + z] as Point2),
          });
        }
      }

      if (allowBuildings) {
        const blds = normalizeSemanticBuildings(j.buildings ?? []);
        for (const b of blds) {
          buildingsAll.push({
            ...b,
            footprint: b.footprint.map(([x, z]) => [ox + x, oz + z] as Point2),
          });
        }
      }

      if (allowWater) {
        for (const w of j.water ?? []) {
          if (!w.polygon || w.polygon.length < 3) continue;
          waterFragments.push({
            bodyId: String(w.osmId ?? w.id ?? `${sid}-w`),
            kind: w.kind ?? 'lake',
            tileId: sid,
            outer: w.polygon.map(([x, z]: number[]) => ({ e: oe + x, n: on + z })),
            holes: (w.holes ?? []).map((h: number[][]) =>
              h.map(([x, z]) => ({ e: oe + x, n: on + z })),
            ),
          });
        }
      }
    } catch {
      /* skip */
    }
  });

  // WATER.CANONICAL.1 — union by body id, one elevation, then mesh.
  const sampleEN = (e: number, n: number) => {
    const wx = e - pack.originE;
    const wz = pack.originN - n;
    return sampleTerrainY(terrains, wx, wz) / EXAG;
  };
  const canonical = canonicalizeWaterFragments(waterFragments, sampleEN);
  console.info('[WATER.CANONICAL.1]', waterCanonStats(waterFragments, canonical));
  for (const body of canonical) {
    waterBodies.push({
      stableId: body.id,
      elevationM: body.elevationM,
      renderPolygons: body.outers.map((outer) =>
        outer.map((p) => [p.e - pack.originE, pack.originN - p.n] as Point2),
      ),
      renderHoles: body.holesPerOuter.map((holes) =>
        holes.map((h) => h.map((p) => [p.e - pack.originE, pack.originN - p.n] as Point2)),
      ),
      kind: body.kind,
    });
  }

  // Hydro-condition terrain beds under canonical water (no protrusions).
  for (const t of terrains) {
    resampleHeightfieldTerrain(t.mesh, t.hf, EXAG, (lx, lz, sourceM) => {
      const e = pack.originE + t.worldX + lx;
      const n = pack.originN - (t.worldZ + lz);
      return conditionHeightM(e, n, sourceM, canonical);
    });
  }

  landcover.setPolygons(landcoverTiles);
  const heightFn = (x: number, z: number) => sampleTerrainY(terrains, x, z);
  const roadsGroup = makeRoads(roadsAll, heightFn, EXAG);
  scene.add(roadsGroup);
  const buildingsGroup = makeBuildings(buildingsAll, heightFn, EXAG);
  scene.add(buildingsGroup);
  const waterGroup = makeWaterAreas(waterBodies, EXAG);
  // Atmospheric fog + discovery will be applied by callers; enable fog on mats.
  waterGroup.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat && 'fog' in mat) mat.fog = true;
  });
  scene.add(waterGroup);
  const treesGroup = new THREE.Group();
  treesGroup.name = 'hero-trees';
  scene.add(treesGroup);

  setFeatureOpacity(roadsGroup, 1);
  setFeatureOpacity(buildingsGroup, 1);
  setFeatureOpacity(waterGroup, 1);
  setFeatureOpacity(treesGroup, 1);

  const sampleGround = (wx: number, wz: number) => {
    const kind = landcover.kindAt(wx, wz);
    if (!kind) return null;
    return { color: landcoverColor(kind), strength: landcoverStrength(kind) };
  };
  const sampleWater = (wx: number, wz: number): number | null => {
    for (const b of waterBodies) {
      for (let i = 0; i < b.renderPolygons.length; i++) {
        const outer = b.renderPolygons[i]!;
        if (!pointInPoly([wx, wz], outer)) continue;
        const holes = b.renderHoles[i] ?? [];
        if (holes.some((h) => pointInPoly([wx, wz], h))) continue;
        return b.elevationM;
      }
    }
    return null;
  };

  for (const t of terrains) {
    applySurfaceShading(
      t.mesh,
      (x, z) => sampleTerrainY(terrains, x, z),
      sampleGround,
      () => 1,
      undefined,
      sampleWater,
    );
  }

  return {
    scene,
    terrains,
    focusX,
    focusY,
    focusZ,
    dispose: () => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
      });
    },
  };
}

export function placeCinematicCamera(
  camera: THREE.PerspectiveCamera,
  focusX: number,
  focusY: number,
  focusZ: number,
  cam: HeroCameraSpec,
  t = 0,
) {
  const yaw = cam.drift ? cam.yawRad + Math.sin(t * 0.07) * 0.018 : cam.yawRad;
  const pitchLift = cam.drift ? Math.cos(t * 0.06) * 5 : 0;
  camera.position.set(
    focusX + Math.sin(yaw) * cam.baseDistM,
    focusY + cam.heightAboveFocusM + pitchLift,
    focusZ + Math.cos(yaw) * cam.baseDistM,
  );
  camera.lookAt(focusX, focusY + cam.lookAtLiftM, focusZ);
}

/** Chosen WEB.1 plate — Bergura lake + shore (~2×3 km). Rings filled at runtime from hero-pack-lod.json. */
export const CHOSEN_A_PACK_BASE = {
  originE: 319500,
  originN: 6531500,
  focusE: 319500,
  focusN: 6531500,
  terrainIx: [1274, 1281] as [number, number],
  terrainIy: [26120, 26131] as [number, number],
  semanticIx: [2548, 2563] as [number, number],
  semanticIy: [52240, 52263] as [number, number],
};

export const CHOSEN_A_CAMERA: HeroCameraSpec = {
  fov: 42,
  yawRad: -0.72,
  baseDistM: 2000,
  heightAboveFocusM: 900,
  lookAtLiftM: 20,
  far: 12000,
  drift: true,
};

/** Mobile: tighter crop (closer camera), not a shrunk plate. */
export function cameraForViewport(width: number, base: HeroCameraSpec = CHOSEN_A_CAMERA): HeroCameraSpec {
  if (width < 720) {
    return {
      ...base,
      baseDistM: Math.round(base.baseDistM * 0.7),
      heightAboveFocusM: Math.round(base.heightAboveFocusM * 0.72),
      lookAtLiftM: base.lookAtLiftM,
    };
  }
  return { ...base };
}

/** @deprecated shore vignette — landing now uses CHOSEN_A. */
export const DEFAULT_SHORE_PACK: HeroPackSpec = {
  originE: 319937.5,
  originN: 6531062.5,
  focusE: 319937.5 + 40,
  focusN: 6531062.5 + 20,
  terrainIds: [
    'terrain_250m_1279_26123',
    'terrain_250m_1280_26123',
    'terrain_250m_1279_26124',
    'terrain_250m_1280_26124',
  ],
  semanticIds: [
    'semantic_125m_2558_52247',
    'semantic_125m_2559_52247',
    'semantic_125m_2560_52247',
    'semantic_125m_2558_52248',
    'semantic_125m_2559_52248',
    'semantic_125m_2560_52248',
    'semantic_125m_2558_52249',
    'semantic_125m_2559_52249',
    'semantic_125m_2560_52249',
  ],
};

export const DEFAULT_SHORE_CAMERA: HeroCameraSpec = {
  fov: 42,
  yawRad: -0.72,
  baseDistM: 390,
  heightAboveFocusM: 220,
  lookAtLiftM: 6,
  far: 4000,
  drift: true,
};
