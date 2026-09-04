/**
 * OriginTrailz landing hero — lightweight engine-fragment vignette.
 * No GPS, IndexedDB, factory, or streaming.
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

declare global {
  interface Window {
    /** Optional: freeze idle camera drift while wiping (no reveal). */
    __otzHeroPointer?: (active: boolean) => void;
    __otzHeroReady?: boolean;
    __otzHeroFail?: string;
  }
}

/**
 * WEB.1 hero-clean presentation config.
 * Website paper-fog is the sole fog owner — engine shows fully revealed geography.
 */
export const HERO_CLEAN = {
  instantReveal: true,
  disableDiscoveryFog: true,
  discoveryOwnsOpacity: false,
  allowDiscoveryWrites: false,
  showPlayerMarker: false,
  allowTileGeneration: false,
} as const;

/** Sample Valley — shore settlement (water + roads + roofs), not empty lake. */
const ORIGIN_E = 319937.5;
const ORIGIN_N = 6531062.5;
const EXAG = 1.2;
const TERRAIN_IDS = [
  'terrain_250m_1279_26123',
  'terrain_250m_1280_26123',
  'terrain_250m_1279_26124',
  'terrain_250m_1280_26124',
];
const SEMANTIC_IDS = [
  'semantic_125m_2558_52247',
  'semantic_125m_2559_52247',
  'semantic_125m_2560_52247',
  'semantic_125m_2558_52248',
  'semantic_125m_2559_52248',
  'semantic_125m_2560_52248',
  'semantic_125m_2558_52249',
  'semantic_125m_2559_52249',
  'semantic_125m_2560_52249',
];

type TerrainTileJson = {
  terrain: { uri: string; grid: number; minM: number; maxM: number };
  origin: { easting: number; northing: number };
};

type LoadedTerrain = {
  id: string;
  worldX: number;
  worldZ: number;
  hf: Heightfield;
  mesh: THREE.Mesh;
};

function want2d(): boolean {
  return new URLSearchParams(location.search).get('hero') === '2d';
}

function setFeatureOpacity(root: THREE.Object3D, opacity: number) {
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

async function loadTerrain(id: string): Promise<LoadedTerrain | null> {
  const tileRes = await fetch(`/world/terrain/${id}/tile.json`);
  if (!tileRes.ok) return null;
  const tile = (await tileRes.json()) as TerrainTileJson;
  const binRes = await fetch(`/world/terrain/${id}/${tile.terrain.uri}`);
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
  const mesh = makeHeightfieldTerrain(hf, EXAG);
  const worldX = tile.origin.easting - ORIGIN_E;
  const worldZ = ORIGIN_N - tile.origin.northing;
  mesh.position.set(worldX, 0, worldZ);
  mesh.name = id;
  return { id, worldX, worldZ, hf, mesh };
}

function sampleTerrainY(terrains: LoadedTerrain[], wx: number, wz: number): number {
  const half = 125;
  for (const t of terrains) {
    const lx = wx - t.worldX;
    const lz = wz - t.worldZ;
    if (lx < -half || lx > half || lz < -half || lz > half) continue;
    return t.hf.sampleSurface(lx, lz) * EXAG;
  }
  // Nearest tile fallback
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

async function main() {
  if (want2d()) {
    window.__otzHeroFail = 'hero=2d';
    return;
  }

  const host = document.getElementById('hero-world') as HTMLCanvasElement | null;
  const heroEl = document.getElementById('hero');
  const mapSvg = document.querySelector('.hero-map svg') as SVGElement | null;
  if (!host || !heroEl) {
    window.__otzHeroFail = 'missing #hero-world';
    return;
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: host,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
  } catch (e) {
    window.__otzHeroFail = String(e);
    return;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, 1, 2, 4000);
  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x6a7a68, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(180, 420, 90);
  scene.add(sun);

  const terrains: LoadedTerrain[] = [];
  for (const id of TERRAIN_IDS) {
    const t = await loadTerrain(id);
    if (t) {
      terrains.push(t);
      scene.add(t.mesh);
    }
  }
  if (!terrains.length) {
    window.__otzHeroFail = 'no terrain';
    renderer.dispose();
    return;
  }

  // Focus slightly toward the denser shore settlement (east of pack centre).
  const focusX =
    terrains.reduce((s, t) => s + t.worldX, 0) / terrains.length + 40;
  const focusZ =
    terrains.reduce((s, t) => s + t.worldZ, 0) / terrains.length - 20;
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

  for (const sid of SEMANTIC_IDS) {
    try {
      const res = await fetch(`/world/semantic/${sid}/tile.json`);
      if (!res.ok) continue;
      const j = await res.json();
      const ox = (j.origin?.easting ?? 0) - ORIGIN_E;
      const oz = ORIGIN_N - (j.origin?.northing ?? 0);

      landcoverTiles.push({
        id: sid,
        worldX: ox,
        worldZ: oz,
        landcover: (j.landcover ?? []) as Landcover[],
        forests: [],
      });

      for (const r of j.roads ?? []) {
        if (!r.points || r.points.length < 2) continue;
        roadsAll.push({
          id: r.id ?? `${sid}-r`,
          width: r.width ?? 5,
          class: r.class,
          points: r.points.map(([x, z]: number[]) => [ox + x, oz + z] as Point2),
        });
      }

      const blds = normalizeSemanticBuildings(j.buildings ?? []);
      for (const b of blds) {
        buildingsAll.push({
          ...b,
          footprint: b.footprint.map(([x, z]) => [ox + x, oz + z] as Point2),
        });
      }

      for (const w of j.water ?? []) {
        if (!w.polygon || w.polygon.length < 3) continue;
        const outer = w.polygon.map(([x, z]: number[]) => [ox + x, oz + z] as Point2);
        const holes = (w.holes ?? []).map((h: number[][]) =>
          h.map(([x, z]) => [ox + x, oz + z] as Point2),
        );
        let elevSum = 0;
        let elevN = 0;
        for (let i = 0; i < outer.length; i += Math.max(1, Math.floor(outer.length / 12))) {
          elevSum += sampleTerrainY(terrains, outer[i]![0], outer[i]![1]) / EXAG;
          elevN++;
        }
        waterBodies.push({
          stableId: w.osmId ?? w.id ?? `${sid}-w`,
          elevationM: elevN ? elevSum / elevN : focusY / EXAG,
          renderPolygons: [outer],
          renderHoles: [holes],
          kind: w.kind,
        });
      }
    } catch {
      /* skip tile */
    }
  }
  landcover.setPolygons(landcoverTiles);

  const heightFn = (x: number, z: number, _ex?: number) => sampleTerrainY(terrains, x, z);
  const roadsGroup = makeRoads(roadsAll, heightFn, EXAG);
  roadsGroup.position.set(0, 0, 0);
  scene.add(roadsGroup);

  const buildingsGroup = makeBuildings(buildingsAll, heightFn, EXAG);
  // makeBuildings expects local footprints; we already converted to world — heightFn is world.
  // Buildings are at local 0; footprints are world coords — mesh sits at origin. OK.
  scene.add(buildingsGroup);

  const waterGroup = makeWaterAreas(waterBodies, EXAG);
  scene.add(waterGroup);

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

  // Sparse silhouette trees (decorative — Bergura forest arrays are empty).
  const treesGroup = new THREE.Group();
  treesGroup.name = 'hero-trees';
  {
    const cone = new THREE.ConeGeometry(1.1, 1, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a5c32, roughness: 0.92 });
    const pts: Point2[] = [];
    let seed = 0xc0ffee;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 10000) / 10000;
    };
    for (let i = 0; i < 110; i++) {
      const x = focusX + (rand() - 0.5) * 440;
      const z = focusZ + (rand() - 0.5) * 440;
      if (sampleWater(x, z) != null) continue;
      let nearBld = false;
      for (const b of buildingsAll) {
        if (pointInPoly([x, z], b.footprint)) {
          nearBld = true;
          break;
        }
      }
      if (nearBld) continue;
      pts.push([x, z]);
    }
    if (pts.length) {
      const mesh = new THREE.InstancedMesh(cone, mat, pts.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      const eul = new THREE.Euler(0, 0, 0, 'YXZ');
      pts.forEach((pt, i) => {
        const h = 9 + rand() * 10;
        const w = 2.2 + rand() * 2.4;
        eul.y = rand() * Math.PI * 2;
        q.setFromEuler(eul);
        s.set(w, h, w);
        p.set(pt[0], heightFn(pt[0], pt[1]) + h * 0.45, pt[1]);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      treesGroup.add(mesh);
    }
  }
  scene.add(treesGroup);
  // hero-clean: fully visible under website paper-fog only.
  setFeatureOpacity(roadsGroup, 1);
  setFeatureOpacity(buildingsGroup, 1);
  setFeatureOpacity(waterGroup, 1);
  setFeatureOpacity(treesGroup, 1);

  let needRender = true;
  function resshade() {
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
    needRender = true;
  }
  resshade();

  let driftT = 0;
  let visible = true;
  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = heroEl.clientWidth;
    const h = heroEl.clientHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    needRender = true;
  }
  resize();
  window.addEventListener('resize', () => {
    resize();
    schedule();
  });

  const baseDist = 390;
  const baseHeight = focusY + 220;
  function placeCamera(t: number) {
    const yaw = -0.72 + Math.sin(t * 0.07) * 0.018;
    const pitchLift = Math.cos(t * 0.06) * 5;
    camera.position.set(
      focusX + Math.sin(yaw) * baseDist,
      baseHeight + pitchLift,
      focusZ + Math.cos(yaw) * baseDist,
    );
    camera.lookAt(focusX, focusY + 6, focusZ);
  }
  placeCamera(0);

  // Website #fog is the sole fog owner — no engine reveal bridge (WEB.1 A2).
  delete (window as unknown as { __otzHeroReveal?: unknown }).__otzHeroReveal;

  let pointerActive = false;
  window.__otzHeroPointer = (active: boolean) => {
    pointerActive = active;
    if (!active) schedule();
  };

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) schedule();
    },
    { threshold: 0.05 },
  );
  io.observe(heroEl);

  function tick() {
    raf = 0;
    if (!visible) return;
    let drifting = false;
    if (!reduced && !pointerActive) {
      driftT += 0.0012;
      placeCamera(driftT);
      drifting = true;
    }
    if (needRender || drifting) {
      renderer.render(scene, camera);
      needRender = false;
    }
    if (drifting) schedule();
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }

  if (mapSvg) mapSvg.style.opacity = '0';
  host.style.opacity = '1';
  window.__otzHeroReady = true;
  needRender = true;
  schedule();

  window.addEventListener('pagehide', () => {
    io.disconnect();
    renderer.dispose();
  });
}

main().catch((e) => {
  console.warn('[otz-hero]', e);
  window.__otzHeroFail = String(e);
});
