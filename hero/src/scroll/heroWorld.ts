/**
 * Site hero — Three.js world.
 *
 * Frozen snapshot + scroll walk + mask-texture discovery. Separate from the
 * app engine: preload only, no streaming, no invented heights.
 */
import * as THREE from 'three';
import {
  DEFAULT_CAMERA,
  DEFAULT_REVEAL,
  Route,
  cameraPoseFor,
  handoverReached,
  revealDelta,
  revealedCells,
  tilesForRange,
  type RoutePoint,
} from './routeWalk';
import { PLATE_BBOX } from './routeConfig';

export interface HeroConfig {
  worldBase: string;
  route: RoutePoint[];
  originE: number;
  originN: number;
  container: HTMLElement;
  exaggeration?: number;
}

const LOW = new THREE.Color(0x6f8a52);
const MID = new THREE.Color(0x8fa56a);
const HIGH = new THREE.Color(0xc4b896);
const PAPER = new THREE.Color(0xece6da);
const SKY = new THREE.Color(0xcfd8e0);
const ROAD = new THREE.Color(0x5c5348);
const WATER = new THREE.Color(0x4a7a9b);
const BUILDING = new THREE.Color(0xb8a890);

const MASK_CELL_M = 10;
const SEED_REVEAL_M = 90;
const SEM_SIZE_M = 125;

interface TileMeta {
  sizeMeters?: number;
  size?: number;
  terrain: { grid: number; minM: number; maxM: number; uri: string; encoding: string };
  origin: { swEasting?: number; swNorthing?: number; easting: number; northing: number };
}

interface LoadedTile {
  id: string;
  mesh: THREE.Mesh;
  grid: number;
  sizeM: number;
  swE: number;
  swN: number;
  heights: Float32Array;
}

type SemLayer = 'core' | 'middle';

function featureList(tile: Record<string, unknown>, key: string): unknown[] {
  const top = tile[key];
  if (Array.isArray(top)) return top;
  const feat = tile.features;
  if (feat && typeof feat === 'object') {
    const nested = (feat as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export class HeroWorld {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private group = new THREE.Group();
  private semGroup = new THREE.Group();
  private tiles = new Map<string, LoadedTile>();
  private inflight = new Set<string>();
  private semLoaded = new Set<string>();
  private route: Route;
  private cfg: Required<Omit<HeroConfig, 'container' | 'route'>> & { container: HTMLElement };
  private headingRad = 0;
  private progress = 0;
  private revealed = new Set<string>();
  private freeMode = false;
  private needsRender = true;
  private maskTex: THREE.DataTexture;
  private maskW: number;
  private maskH: number;
  private plateMinE: number;
  private plateMinN: number;
  private plateWE: number;
  private plateHN: number;
  private terrainMat: THREE.ShaderMaterial;
  private seedProgress: number;
  private orbit = { dragging: false, lastX: 0, lastY: 0, theta: 0, phi: 1.0, dist: 900 };

  stats = {
    tilesLoaded: 0,
    tilesFailed: 0,
    cellsRevealed: 0,
    triangles: 0,
    roads: 0,
    water: 0,
    buildings: 0,
    semTiles: 0,
  };

  constructor(config: HeroConfig) {
    this.cfg = {
      worldBase: config.worldBase.replace(/\/$/, ''),
      originE: config.originE,
      originN: config.originN,
      exaggeration: config.exaggeration ?? 1.3,
      container: config.container,
    };
    this.route = new Route(config.route);
    this.seedProgress = Math.min(1, SEED_REVEAL_M / Math.max(1, this.route.lengthM));

    this.plateMinE = PLATE_BBOX.minE;
    this.plateMinN = PLATE_BBOX.minN;
    this.plateWE = PLATE_BBOX.maxE - PLATE_BBOX.minE;
    this.plateHN = PLATE_BBOX.maxN - PLATE_BBOX.minN;
    this.maskW = Math.round(this.plateWE / MASK_CELL_M);
    this.maskH = Math.round(this.plateHN / MASK_CELL_M);
    const maskData = new Uint8Array(this.maskW * this.maskH);
    this.maskTex = new THREE.DataTexture(maskData, this.maskW, this.maskH, THREE.RedFormat);
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.wrapS = THREE.ClampToEdgeWrapping;
    this.maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTex.needsUpdate = true;

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        revealMask: { value: this.maskTex },
        paperColor: { value: PAPER.clone() },
        plateMin: { value: new THREE.Vector2(this.plateMinE, this.plateMinN) },
        plateSize: { value: new THREE.Vector2(this.plateWE, this.plateHN) },
        originEN: { value: new THREE.Vector2(this.cfg.originE, this.cfg.originN) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 naturalColor;
        varying vec3 vNatural;
        varying vec2 vEN;
        uniform vec2 originEN;
        void main() {
          vNatural = naturalColor;
          // Reconstruct absolute easting/northing from local mesh position.
          vEN = vec2(position.x + originEN.x, originEN.y - position.z);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D revealMask;
        uniform vec3 paperColor;
        uniform vec2 plateMin;
        uniform vec2 plateSize;
        varying vec3 vNatural;
        varying vec2 vEN;
        void main() {
          vec2 uv = (vEN - plateMin) / plateSize;
          float m = texture2D(revealMask, uv).r;
          vec3 col = mix(paperColor, vNatural, m);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    // No THREE.Fog — atmospheric greying fights paper discovery on a ~3.6 km plate.
    this.scene.background = SKY;
    this.scene.add(this.group);
    this.scene.add(this.semGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.82));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-0.4, 1, -0.5);
    this.scene.add(sun);

    const el = this.cfg.container;
    this.camera = new THREE.PerspectiveCamera(48, el.clientWidth / el.clientHeight, 1, 12000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(this.renderer.domElement);

    addEventListener('resize', () => this.onResize());
    this.attachControls();
  }

  private local(e: number, n: number) {
    return { x: e - this.cfg.originE, z: this.cfg.originN - n };
  }

  async preload(onProgress?: (loaded: number, total: number) => void) {
    const ids = tilesForRange(this.route, 0, 1);
    let done = 0;
    const CONCURRENCY = 8;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]!;
        await this.loadTile(id);
        done++;
        onProgress?.(done, ids.length);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Semantics: prove start tile first, then expand core/middle rings along the route.
    await this.loadSemanticsAlongRoute();
    this.applyReveal(this.seedProgress);
    this.progress = this.seedProgress;
    this.updateCamera(this.seedProgress);
    this.needsRender = true;
  }

  private async loadTile(id: string) {
    if (this.tiles.has(id) || this.inflight.has(id)) return;
    this.inflight.add(id);
    try {
      const base = `${this.cfg.worldBase}/terrain/${id}`;
      const metaRes = await fetch(`${base}/tile.json`);
      if (!metaRes.ok) throw new Error(`tile.json ${metaRes.status}`);
      const text = await metaRes.text();
      if (!text.trimStart().startsWith('{')) throw new Error('non-JSON tile.json');
      const meta = JSON.parse(text) as TileMeta;

      const binRes = await fetch(`${base}/${meta.terrain.uri}`);
      if (!binRes.ok) throw new Error(`${meta.terrain.uri} ${binRes.status}`);
      const buf = await binRes.arrayBuffer();
      const g = meta.terrain.grid;
      if (buf.byteLength !== g * g * 2) {
        throw new Error(`payload ${buf.byteLength} != ${g * g * 2}`);
      }
      const q = new Uint16Array(buf);

      let qMin = 65535;
      let qMax = 0;
      for (let i = 0; i < q.length; i++) {
        if (q[i]! < qMin) qMin = q[i]!;
        if (q[i]! > qMax) qMax = q[i]!;
      }
      if (qMin === qMax && meta.terrain.maxM - meta.terrain.minM > 0.5) {
        throw new Error('degenerate payload (decodes flat)');
      }

      const span = meta.terrain.maxM - meta.terrain.minM || 1;
      const heights = new Float32Array(g * g);
      for (let i = 0; i < q.length; i++) {
        heights[i] = meta.terrain.minM + (q[i]! / 65535) * span;
      }

      const sizeM = meta.sizeMeters ?? meta.size ?? 250;
      const swE = meta.origin.swEasting ?? meta.origin.easting - sizeM / 2;
      const swN = meta.origin.swNorthing ?? meta.origin.northing - sizeM / 2;

      const mesh = this.buildMesh(heights, g, sizeM, swE, swN);
      mesh.name = id;
      this.group.add(mesh);
      this.tiles.set(id, { id, mesh, grid: g, sizeM, swE, swN, heights });
      this.stats.tilesLoaded++;
    } catch (e) {
      this.stats.tilesFailed++;
      console.warn('[hero] tile failed', id, e);
    } finally {
      this.inflight.delete(id);
    }
  }

  private buildMesh(
    heights: Float32Array,
    g: number,
    sizeM: number,
    swE: number,
    swN: number,
  ): THREE.Mesh {
    const step = sizeM / (g - 1);
    const positions = new Float32Array(g * g * 3);
    const natural = new Float32Array(g * g * 3);
    const c = new THREE.Color();

    for (let row = 0; row < g; row++) {
      const n = swN + sizeM - row * step;
      for (let col = 0; col < g; col++) {
        const e = swE + col * step;
        const h = heights[row * g + col]!;
        const p = this.local(e, n);
        const i = (row * g + col) * 3;
        positions[i] = p.x;
        positions[i + 1] = h * this.cfg.exaggeration;
        positions[i + 2] = p.z;

        const f = Math.min(1, Math.max(0, h / 220));
        c.copy(LOW).lerp(MID, Math.min(1, f * 1.6));
        if (f > 0.55) c.lerp(HIGH, (f - 0.55) / 0.45);
        natural[i] = c.r;
        natural[i + 1] = c.g;
        natural[i + 2] = c.b;
      }
    }

    const index: number[] = [];
    for (let row = 0; row < g - 1; row++) {
      for (let col = 0; col < g - 1; col++) {
        const a = row * g + col;
        index.push(a, a + g, a + 1, a + 1, a + g, a + g + 1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('naturalColor', new THREE.BufferAttribute(natural, 3));
    geom.setIndex(index);
    geom.computeVertexNormals();
    this.stats.triangles += index.length / 3;
    return new THREE.Mesh(geom, this.terrainMat);
  }

  // -- semantics ----------------------------------------------------------

  private async loadSemanticsAlongRoute() {
    const start = this.route.at(0);
    const startId = this.semanticId(start.e, start.n);
    await this.loadSemanticTile(startId, 'core');

    const ids = new Set<string>();
    const step = 60;
    for (let d = 0; d <= this.route.lengthM; d += step) {
      const s = this.route.at(d / this.route.lengthM);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const e = s.e + dx * SEM_SIZE_M;
          const n = s.n + dy * SEM_SIZE_M;
          const layer = this.semLayerFor(e, n);
          if (!layer) continue;
          ids.add(`${this.semanticId(e, n)}|${layer}`);
        }
      }
    }
    // Focus centre also for buildings around lake
    const focusE = (PLATE_BBOX.minE + PLATE_BBOX.maxE) / 2;
    const focusN = (PLATE_BBOX.minN + PLATE_BBOX.maxN) / 2;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const e = focusE + dx * SEM_SIZE_M;
        const n = focusN + dy * SEM_SIZE_M;
        const layer = this.semLayerFor(e, n);
        if (!layer) continue;
        ids.add(`${this.semanticId(e, n)}|${layer}`);
      }
    }

    let cursor = 0;
    const list = [...ids];
    const worker = async () => {
      while (cursor < list.length) {
        const entry = list[cursor++]!;
        const [id, layer] = entry.split('|') as [string, SemLayer];
        await this.loadSemanticTile(id, layer);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  private semLayerFor(e: number, n: number): SemLayer | null {
    const cx = (PLATE_BBOX.minE + PLATE_BBOX.maxE) / 2;
    const cy = (PLATE_BBOX.minN + PLATE_BBOX.maxN) / 2;
    const dx = Math.abs(e - cx);
    const dy = Math.abs(n - cy);
    if (dx <= 500 && dy <= 500) return 'core';
    if (dx <= 900 && dy <= 1200) return 'middle';
    return null;
  }

  private semanticId(e: number, n: number): string {
    const ix = Math.floor(e / SEM_SIZE_M);
    const iy = Math.floor(n / SEM_SIZE_M);
    return `semantic_${SEM_SIZE_M}m_${ix}_${iy}`;
  }

  private async loadSemanticTile(id: string, layer: SemLayer) {
    if (this.semLoaded.has(id)) return;
    this.semLoaded.add(id);
    try {
      const res = await fetch(`${this.cfg.worldBase}/semantic/${id}/tile.json`);
      if (!res.ok) {
        if (res.status !== 404) console.warn('[hero] semantic', id, res.status);
        return;
      }
      const tile = (await res.json()) as Record<string, unknown>;
      const origin = tile.origin as { easting: number; northing: number };
      const oe = origin.easting;
      const on = origin.northing;

      const roads = featureList(tile, 'roads') as Array<{ points?: number[][]; width?: number; class?: string }>;
      const water = featureList(tile, 'water') as Array<{ polygon?: number[][] }>;
      const buildings = featureList(tile, 'buildings') as Array<{
        footprint?: number[][];
        heightM?: number;
      }>;

      if (layer === 'core' || layer === 'middle') {
        for (const w of water) {
          const poly = w.polygon;
          if (!poly || poly.length < 3) continue;
          this.addWaterPoly(oe, on, poly);
        }
        for (const r of roads) {
          const pts = r.points;
          if (!pts || pts.length < 2) continue;
          if (layer === 'middle' && r.class && /track|path|footway|service/i.test(r.class)) continue;
          this.addRoad(oe, on, pts, r.width ?? 5);
        }
      }
      if (layer === 'core') {
        for (const b of buildings) {
          const fp = b.footprint;
          if (!fp || fp.length < 3) continue;
          this.addBuilding(oe, on, fp, b.heightM ?? 8);
        }
      }
      this.stats.semTiles++;
      this.needsRender = true;
    } catch (e) {
      console.warn('[hero] semantic failed', id, e);
    }
  }

  private addRoad(oe: number, on: number, pts: number[][], width: number) {
    const positions: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const e = oe + pts[i]![0]!;
      const n = on + pts[i]![1]!;
      const h = this.sampleHeight(e, n);
      if (h === null) continue;
      const p = this.local(e, n);
      positions.push(p.x, h * this.cfg.exaggeration + 0.35, p.z);
    }
    if (positions.length < 6) return;
    this.drawRoadRibbon(oe, on, pts, Math.max(2.5, width * 0.55));
    this.stats.roads++;
  }

  private drawRoadRibbon(oe: number, on: number, pts: number[][], halfW: number) {
    const verts: number[] = [];
    const idx: number[] = [];
    const samples: { x: number; y: number; z: number; e: number; n: number }[] = [];
    for (const pt of pts) {
      const e = oe + pt[0]!;
      const n = on + pt[1]!;
      const h = this.sampleHeight(e, n);
      if (h === null) continue;
      const p = this.local(e, n);
      samples.push({ x: p.x, y: h * this.cfg.exaggeration + 0.4, z: p.z, e, n });
    }
    if (samples.length < 2) return;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[Math.max(0, i - 1)]!;
      const b = samples[Math.min(samples.length - 1, i + 1)]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * halfW;
      const pz = (dx / len) * halfW;
      const s = samples[i]!;
      verts.push(s.x + px, s.y, s.z + pz, s.x - px, s.y, s.z - pz);
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    this.semGroup.add(
      new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: ROAD, flatShading: true })),
    );
  }

  private addWaterPoly(oe: number, on: number, poly: number[][]) {
    const shape = new THREE.Shape();
    const abs: { e: number; n: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const e = oe + poly[i]![0]!;
      const n = on + poly[i]![1]!;
      abs.push({ e, n });
      const p = this.local(e, n);
      if (i === 0) shape.moveTo(p.x, -p.z);
      else shape.lineTo(p.x, -p.z);
    }
    // Height: require every vertex; skip if any miss (no invented heights).
    let ySum = 0;
    for (const a of abs) {
      const h = this.sampleHeight(a.e, a.n);
      if (h === null) return;
      ySum += h;
    }
    const y = (ySum / abs.length) * this.cfg.exaggeration + 0.15;
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, y, 0);
    this.semGroup.add(
      new THREE.Mesh(
        geom,
        new THREE.MeshLambertMaterial({
          color: WATER,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
        }),
      ),
    );
    this.stats.water++;
  }

  private addBuilding(oe: number, on: number, fp: number[][], heightM: number) {
    const shape = new THREE.Shape();
    const abs: { e: number; n: number }[] = [];
    for (let i = 0; i < fp.length; i++) {
      const e = oe + fp[i]![0]!;
      const n = on + fp[i]![1]!;
      abs.push({ e, n });
      const p = this.local(e, n);
      if (i === 0) shape.moveTo(p.x, -p.z);
      else shape.lineTo(p.x, -p.z);
    }
    let ySum = 0;
    for (const a of abs) {
      const h = this.sampleHeight(a.e, a.n);
      if (h === null) return;
      ySum += h;
    }
    const baseY = (ySum / abs.length) * this.cfg.exaggeration;
    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(3, heightM) * this.cfg.exaggeration,
      bevelEnabled: false,
    });
    extrude.rotateX(-Math.PI / 2);
    extrude.translate(0, baseY, 0);
    this.semGroup.add(
      new THREE.Mesh(extrude, new THREE.MeshLambertMaterial({ color: BUILDING })),
    );
    this.stats.buildings++;
  }

  // -- reveal (mask texture) ----------------------------------------------

  private applyReveal(progress: number) {
    const effective = Math.max(progress, this.seedProgress);
    const cells = revealedCells(this.route, effective, DEFAULT_REVEAL);
    const delta = revealDelta(this.route, this.progress, effective, DEFAULT_REVEAL);
    // First paint: write whole set; later: delta only.
    const toPaint = this.revealed.size === 0 ? cells : delta;
    this.revealed = cells;
    this.stats.cellsRevealed = cells.size;

    const data = this.maskTex.image.data as Uint8Array;
    const cellM = DEFAULT_REVEAL.cellM;
    const originCx = Math.floor(this.plateMinE / cellM);
    const originCy = Math.floor(this.plateMinN / cellM);
    let touched = false;
    for (const key of toPaint) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      const mx = cx - originCx;
      const my = cy - originCy;
      if (mx < 0 || my < 0 || mx >= this.maskW || my >= this.maskH) continue;
      const i = my * this.maskW + mx;
      if (data[i]! < 255) {
        data[i] = 255;
        touched = true;
      }
    }
    if (touched) this.maskTex.needsUpdate = true;
    this.needsRender = true;
  }

  // -- scroll -------------------------------------------------------------

  /**
   * Progress from `.scroll-panels` metrics. Opening uses an eased curve so the
   * first metres reveal faster.
   */
  onPanelsProgress(rawProgress: number) {
    const eased = this.easeOpening(rawProgress);
    if (this.freeMode) {
      // Scrolling back into the guided story exits orbit.
      if (rawProgress < 0.98) {
        this.exitFreeMode();
      } else {
        return;
      }
    }
    const p = Math.max(eased, this.seedProgress);
    if (Math.abs(p - this.progress) < 0.0005 && p > this.seedProgress) return;
    this.applyReveal(p);
    this.progress = p;
    this.updateCamera(p);
    if (handoverReached(rawProgress)) this.enterFreeMode();
  }

  /** Ease: faster reveal in the first ~20% of the story. */
  private easeOpening(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    // Smoothstep-ish boost early: map 0..0.25 → 0..0.4
    if (c < 0.25) {
      const u = c / 0.25;
      return 0.4 * (u * u * (3 - 2 * u));
    }
    return 0.4 + ((c - 0.25) / 0.75) * 0.6;
  }

  private updateCamera(progress: number) {
    const pose = cameraPoseFor(this.route, progress, this.headingRad, DEFAULT_CAMERA);
    this.headingRad = pose.heading;
    const t = this.local(pose.targetE, pose.targetN);
    const groundY = this.sampleHeight(pose.targetE, pose.targetN);
    const baseY = groundY === null ? 0 : groundY * this.cfg.exaggeration;
    if (!this.freeMode) {
      this.camera.position.set(
        t.x - Math.sin(pose.heading) * pose.distanceM,
        baseY + pose.heightM,
        t.z + Math.cos(pose.heading) * pose.distanceM,
      );
      this.camera.lookAt(t.x, baseY + 12, t.z);
    }
    this.needsRender = true;
  }

  sampleHeight(e: number, n: number): number | null {
    for (const t of this.tiles.values()) {
      if (e < t.swE || e > t.swE + t.sizeM || n < t.swN || n > t.swN + t.sizeM) continue;
      const step = t.sizeM / (t.grid - 1);
      const col = Math.min(t.grid - 1, Math.max(0, Math.round((e - t.swE) / step)));
      const row = Math.min(t.grid - 1, Math.max(0, Math.round((t.swN + t.sizeM - n) / step)));
      return t.heights[row * t.grid + col] ?? null;
    }
    return null;
  }

  // -- controls: wheel scrolls page; drag orbits; pinch / +/- zoom --------

  private enterFreeMode() {
    if (this.freeMode) return;
    this.freeMode = true;
    const end = this.route.at(1);
    const t = this.local(end.e, end.n);
    const dx = this.camera.position.x - t.x;
    const dy = this.camera.position.y;
    const dz = this.camera.position.z - t.z;
    this.orbit.dist = Math.hypot(dx, dy, dz);
    this.orbit.theta = Math.atan2(dx, dz);
    this.orbit.phi = Math.acos(Math.min(1, Math.max(0, dy / Math.max(1, this.orbit.dist))));
    this.cfg.container.dispatchEvent(new CustomEvent('hero:handover'));
    this.applyOrbit();
  }

  private exitFreeMode() {
    if (!this.freeMode) return;
    this.freeMode = false;
    this.cfg.container.dispatchEvent(new CustomEvent('hero:story'));
    this.updateCamera(this.progress);
  }

  zoomBy(factor: number) {
    this.orbit.dist = Math.min(6000, Math.max(120, this.orbit.dist * factor));
    if (this.freeMode) this.applyOrbit();
    else {
      // Allow zoom during story without stealing scroll.
      this.updateCamera(this.progress);
      const pose = cameraPoseFor(this.route, this.progress, this.headingRad, {
        ...DEFAULT_CAMERA,
        distanceM: Math.min(600, Math.max(60, DEFAULT_CAMERA.distanceM * (this.orbit.dist / 900))),
      });
      const t = this.local(pose.targetE, pose.targetN);
      const groundY = this.sampleHeight(pose.targetE, pose.targetN);
      const baseY = groundY === null ? 0 : groundY * this.cfg.exaggeration;
      this.camera.position.set(
        t.x - Math.sin(pose.heading) * pose.distanceM,
        baseY + pose.heightM,
        t.z + Math.cos(pose.heading) * pose.distanceM,
      );
      this.camera.lookAt(t.x, baseY + 12, t.z);
      this.needsRender = true;
    }
  }

  private attachControls() {
    const el = this.renderer.domElement;
    // Drag always rotates (story + free). Wheel is NEVER captured — page scrolls.
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.orbit.dragging = true;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      this.orbit.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.orbit.dragging) return;
      this.orbit.theta -= (e.clientX - this.orbit.lastX) * 0.005;
      this.orbit.phi = Math.min(
        1.45,
        Math.max(0.15, this.orbit.phi - (e.clientY - this.orbit.lastY) * 0.005),
      );
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      if (this.freeMode) {
        this.applyOrbit();
      } else {
        // During story, drag nudges heading without leaving the route lock.
        this.headingRad += (e.movementX || 0) * -0.004;
        this.updateCamera(this.progress);
      }
    });

    // Pinch zoom (two pointers) — does not use wheel.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    el.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    });
    el.addEventListener('pointerup', (e) => pointers.delete(e.pointerId));
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist > 0) {
        const factor = pinchDist / Math.max(1, d);
        this.zoomBy(factor);
      }
      pinchDist = d;
    });
  }

  private applyOrbit() {
    const end = this.route.at(1);
    const t = this.local(end.e, end.n);
    const g = this.sampleHeight(end.e, end.n);
    const y = g === null ? 0 : g * this.cfg.exaggeration;
    const { theta, phi, dist } = this.orbit;
    this.camera.position.set(
      t.x + dist * Math.sin(phi) * Math.sin(theta),
      y + dist * Math.cos(phi),
      t.z + dist * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(t.x, y, t.z);
    this.camera.near = Math.max(1, dist * 0.002);
    this.camera.far = dist * 8 + 4000;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private onResize() {
    const el = this.cfg.container;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.needsRender = true;
  }

  start() {
    const tick = () => {
      if (this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}
