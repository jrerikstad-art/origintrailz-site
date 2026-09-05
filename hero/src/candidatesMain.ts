/**
 * WEB.1 hero candidate contact frames — fixed cinematic camera, full plate load-before-show.
 * URL: candidates.html?id=A  (A–F)
 */
import * as THREE from 'three';
import {
  buildHeroScene,
  placeCinematicCamera,
  semanticIdsFromRange,
  terrainIdsFromRange,
  type HeroCameraSpec,
  type HeroPackSpec,
} from './scenePack';

declare global {
  interface Window {
    __otzCandidateReady?: boolean;
    __otzCandidateFail?: string;
    __otzCandidateId?: string;
    __otzCandidateCapture?: () => string | null;
  }
}

type CandidateReg = {
  camera: HeroCameraSpec;
  candidates: Array<{
    id: string;
    name: string;
    focusE: number;
    focusN: number;
    terrainIx: [number, number];
    terrainIy: [number, number];
    semanticIx: [number, number];
    semanticIy: [number, number];
    bbox: { minE: number; maxE: number; minN: number; maxN: number };
  }>;
};

async function main() {
  const params = new URLSearchParams(location.search);
  const id = (params.get('id') || 'A').toUpperCase();
  const worldBase = params.get('worldBase') || '/world';
  const host = document.getElementById('hero-world') as HTMLCanvasElement | null;
  const label = document.getElementById('candLabel');
  if (!host) {
    window.__otzCandidateFail = 'missing #hero-world';
    return;
  }
  host.style.opacity = '0';

  const reg = (await fetch('/hero-candidates.json').then((r) => r.json())) as CandidateReg;
  const cand = reg.candidates.find((c) => c.id === id);
  if (!cand) {
    window.__otzCandidateFail = `unknown candidate ${id}`;
    return;
  }
  window.__otzCandidateId = cand.id;
  if (label) label.textContent = `${cand.id} — ${cand.name}`;

  const originE = (cand.bbox.minE + cand.bbox.maxE) / 2;
  const originN = (cand.bbox.minN + cand.bbox.maxN) / 2;
  const stride = Math.max(1, Number(params.get('semStride') || '1') | 0);
  let semanticIds = semanticIdsFromRange(
    cand.semanticIx[0],
    cand.semanticIx[1],
    cand.semanticIy[0],
    cand.semanticIy[1],
  );
  if (stride > 1) {
    semanticIds = semanticIds.filter((_, i) => i % stride === 0);
  }
  const pack: HeroPackSpec = {
    originE,
    originN,
    focusE: cand.focusE,
    focusN: cand.focusN,
    terrainIds: terrainIdsFromRange(
      cand.terrainIx[0],
      cand.terrainIx[1],
      cand.terrainIy[0],
      cand.terrainIy[1],
    ),
    semanticIds,
    worldBase,
    concurrency: 12,
  };

  const camSpec: HeroCameraSpec = { ...reg.camera, drift: false };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: host,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    window.__otzCandidateFail = String(e);
    return;
  }

  const built = await buildHeroScene(pack);
  const { scene, focusX, focusY, focusZ } = built;
  const camera = new THREE.PerspectiveCamera(camSpec.fov, 1, 2, camSpec.far);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  placeCinematicCamera(camera, focusX, focusY, focusZ, camSpec, 0);
  renderer.render(scene, camera);
  // One more frame after layout so capture sees opaque pixels.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  renderer.render(scene, camera);

  host.style.opacity = '1';
  window.__otzCandidateReady = true;
  window.__otzCandidateCapture = () => {
    try {
      return host.toDataURL('image/png');
    } catch (e) {
      window.__otzCandidateFail = String(e);
      return null;
    }
  };

  window.addEventListener('resize', () => {
    resize();
    placeCinematicCamera(camera, focusX, focusY, focusZ, camSpec, 0);
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  console.warn('[otz-candidate]', e);
  window.__otzCandidateFail = String(e);
});
