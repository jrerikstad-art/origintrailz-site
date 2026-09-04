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
import { HeroDiscovery } from './engine/discovery';

declare global {
  interface Window {
    __otzHeroReveal?: (screenX: number, screenY: number, radiusPx: number) => void;
    /** True while the visitor is actively wiping — freezes camera drift. */
    __otzHeroPointer?: (active: boolean) => void;
    __otzHeroReady?: boolean;
    __otzHeroFail?: string;
  }
}

const ORIGIN_E = 319543.58527136955;
const ORIGIN_N = 6531135.525830367;
const EXAG = 1.05;
const TERRAIN_IDS = [
  'terrain_250m_1276_26123',
  'terrain_250m_1277_26123',
  'terrain_250m_1276_26124',
  'terrain_250m_1277_26124',
];
const SEMANTIC_IDS = [
  'semantic_125m_2552_52247',
  'semantic_125m_2553_52247',
  'semantic_125m_2552_52248',
  'semantic_125m_2553_52248',
  'semantic_125m_2554_52247',
  'semantic_125m_2554_52248',
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
  const discovery = new HeroDiscovery();
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

  // Focus on Sample Valley centre (lake cluster).
  const focusX =
    terrains.reduce((s, t) => s + t.worldX, 0) / terrains.length;
  const focusZ =
    terrains.reduce((s, t) => s + t.worldZ, 0) / terrains.length;
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

  // Start features hidden (parchment-first).
  setFeatureOpacity(roadsGroup, 0);
  setFeatureOpacity(buildingsGroup, 0);
  setFeatureOpacity(waterGroup, 0);

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

  let needRender = true;
  let lastDiscoveryRev = -1;
  function resshade() {
    if (discovery.rev === lastDiscoveryRev) return;
    lastDiscoveryRev = discovery.rev;
    for (const t of terrains) {
      applySurfaceShading(
        t.mesh,
        (x, z) => sampleTerrainY(terrains, x, z),
        sampleGround,
        (x, z) => discovery.sample(x, z),
        undefined,
        sampleWater,
      );
    }
    let acc = 0;
    let n = 0;
    for (const dx of [-80, 0, 80]) {
      for (const dz of [-80, 0, 80]) {
        acc += discovery.sample(focusX + dx, focusZ + dz);
        n++;
      }
    }
    const avg = n ? acc / n : discovery.sample(focusX, focusZ);
    setFeatureOpacity(roadsGroup, avg);
    setFeatureOpacity(buildingsGroup, avg);
    setFeatureOpacity(waterGroup, Math.min(1, avg * 1.15));
    needRender = true;
  }

  // Initial parchment shade
  discovery.clear();
  lastDiscoveryRev = -2;
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

  const baseDist = 520;
  const baseHeight = focusY + 280;
  function placeCamera(t: number) {
    // Very gentle idle sway — kept small so the vignette does not jitter.
    const yaw = -0.55 + Math.sin(t * 0.07) * 0.018;
    const pitchLift = Math.cos(t * 0.06) * 5;
    camera.position.set(
      focusX + Math.sin(yaw) * baseDist,
      baseHeight + pitchLift,
      focusZ + Math.cos(yaw) * baseDist,
    );
    camera.lookAt(focusX, focusY + 8, focusZ);
  }
  placeCamera(0);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function screenToWorld(screenX: number, screenY: number): Point2 | null {
    const rect = host.getBoundingClientRect();
    ndc.x = ((screenX / rect.width) * 2 - 1);
    ndc.y = -((screenY / rect.height) * 2 - 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      terrains.map((t) => t.mesh),
      false,
    );
    if (hits[0]) return [hits[0].point.x, hits[0].point.z];
    // Plane at focusY fallback
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -focusY);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) return [hit.x, hit.z];
    return null;
  }

  function revealScreen(screenX: number, screenY: number, radiusPx: number) {
    const w = screenToWorld(screenX, screenY);
    if (!w) return;
    // Map px brush to ~world metres (vignette scale).
    const worldR = Math.max(18, Math.min(55, radiusPx * 0.55));
    const added = discovery.revealAt(w[0], w[1], worldR);
    if (added) resshade();
  }

  window.__otzHeroReveal = revealScreen;

  let pointerActive = false;
  window.__otzHeroPointer = (active: boolean) => {
    pointerActive = active;
    if (!active) schedule();
  };

  if (reduced) {
    discovery.revealAt(focusX, focusZ, 160);
    resshade();
  }

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
    // Idle-only micro drift; freeze while wiping so raycasts stay stable.
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

  // Hide SVG once WebGL is up
  if (mapSvg) mapSvg.style.opacity = '0';
  host.style.opacity = '1';
  window.__otzHeroReady = true;
  needRender = true;
  schedule();
}

main().catch((e) => {
  console.warn('[otz-hero]', e);
  window.__otzHeroFail = String(e);
});
