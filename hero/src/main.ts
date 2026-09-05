/**
 * OriginTrailz landing hero — chosen plate A (Bergura lake + shore), LOD rings.
 * Website paper-fog is the sole fog owner. No GPS / IndexedDB / factory.
 */
import * as THREE from 'three';
import {
  CHOSEN_A_CAMERA,
  CHOSEN_A_PACK_BASE,
  buildHeroScene,
  cameraForViewport,
  placeCinematicCamera,
  semanticIdsFromRange,
  terrainIdsFromRange,
  type HeroPackSpec,
  type LodRing,
} from './scenePack';

declare global {
  interface Window {
    __otzHeroPointer?: (active: boolean) => void;
    __otzHeroReady?: boolean;
    __otzHeroFail?: string;
  }
}

export const HERO_CLEAN = {
  instantReveal: true,
  disableDiscoveryFog: true,
  discoveryOwnsOpacity: false,
  allowDiscoveryWrites: false,
  showPlayerMarker: false,
  allowTileGeneration: false,
} as const;

function want2d(): boolean {
  return new URLSearchParams(location.search).get('hero') === '2d';
}

async function loadChosenPack(): Promise<HeroPackSpec> {
  const base = CHOSEN_A_PACK_BASE;
  const pack: HeroPackSpec = {
    originE: base.originE,
    originN: base.originN,
    focusE: base.focusE,
    focusN: base.focusN,
    terrainIds: terrainIdsFromRange(
      base.terrainIx[0],
      base.terrainIx[1],
      base.terrainIy[0],
      base.terrainIy[1],
    ),
    semanticIds: semanticIdsFromRange(
      base.semanticIx[0],
      base.semanticIx[1],
      base.semanticIy[0],
      base.semanticIy[1],
    ),
    applyLod: true,
    concurrency: 10,
  };
  try {
    const res = await fetch('/hero-pack-lod.json');
    if (res.ok) {
      const lod = await res.json();
      const rings: Record<string, LodRing> = {};
      for (const s of lod.semantic ?? []) {
        if (s?.id && s?.ring) rings[s.id] = s.ring as LodRing;
      }
      pack.semanticRings = rings;
      if (lod.origin?.easting != null) pack.originE = lod.origin.easting;
      if (lod.origin?.northing != null) pack.originN = lod.origin.northing;
      if (lod.focus?.e != null) pack.focusE = lod.focus.e;
      if (lod.focus?.n != null) pack.focusN = lod.focus.n;
    }
  } catch {
    /* rings optional — without them applyLod treats missing as core */
  }
  return pack;
}

async function main() {
  const host = document.getElementById('hero-world') as HTMLCanvasElement | null;
  const heroEl = document.getElementById('hero');
  const mapSvg = document.querySelector('.hero-map svg') as SVGElement | null;

  const fail = (reason: string) => {
    window.__otzHeroFail = reason;
    console.warn('[otz-hero]', reason);
    if (mapSvg) mapSvg.style.opacity = '1';
  };

  if (want2d()) {
    fail('hero=2d');
    return;
  }
  if (!host || !heroEl) {
    fail('missing #hero-world');
    return;
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: host,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
  } catch (e) {
    fail(String(e));
    return;
  }
  host.style.position = 'absolute';
  host.style.inset = '0';
  host.style.zIndex = '1';
  host.style.width = '100%';
  host.style.height = '100%';
  host.style.opacity = '0';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let built;
  try {
    const pack = await loadChosenPack();
    built = await buildHeroScene(pack);
  } catch (e) {
    fail(String(e));
    renderer.dispose();
    return;
  }
  const { scene, focusX, focusY, focusZ } = built;

  let camSpec = {
    ...cameraForViewport(heroEl.clientWidth, CHOSEN_A_CAMERA),
    drift: !reduced,
  };
  const camera = new THREE.PerspectiveCamera(camSpec.fov, 1, 2, camSpec.far);

  let needRender = true;
  let driftT = 0;
  let visible = true;
  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = heroEl.clientWidth;
    const h = heroEl.clientHeight;
    camSpec = { ...cameraForViewport(w, CHOSEN_A_CAMERA), drift: !reduced };
    camera.fov = camSpec.fov;
    camera.far = camSpec.far;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    placeCinematicCamera(camera, focusX, focusY, focusZ, camSpec, driftT);
    needRender = true;
  }
  resize();
  window.addEventListener('resize', () => {
    resize();
    schedule();
  });

  function placeCamera(t: number) {
    placeCinematicCamera(camera, focusX, focusY, focusZ, camSpec, t);
  }
  placeCamera(0);

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
    if (camSpec.drift && !pointerActive) {
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
    built.dispose();
    renderer.dispose();
  });
}

main().catch((e) => {
  console.warn('[otz-hero]', e);
  window.__otzHeroFail = String(e);
  const mapSvg = document.querySelector('.hero-map svg') as SVGElement | null;
  if (mapSvg) mapSvg.style.opacity = '1';
});
