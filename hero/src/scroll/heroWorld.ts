/**
 * Site hero — Three.js world + orange explorer ball.
 *
 * Frozen snapshot, mask-texture discovery, scroll-guided journey, then
 * session-only free explore. Never writes Origintrailz discovery history.
 */
import * as THREE from 'three';
import {
  DEFAULT_CAMERA,
  DEFAULT_REVEAL,
  Route,
  cameraPoseFor,
  handoverReached,
  semanticTilesForPlate,
  tilesForPlate,
  type RoutePoint,
} from './routeWalk';
import { PLATE_BBOX } from './routeConfig';
import { HeroRevealSession } from './heroRevealSession';
import { RollingOrientation } from './explorerRoll';
import {
  evaluateDestination,
  validateRoutePoints,
  type MovementReject,
  type RejectReason,
} from './movementGate';

export interface HeroConfig {
  worldBase: string;
  route: RoutePoint[];
  originE: number;
  originN: number;
  container: HTMLElement;
  exaggeration?: number;
}

export type HeroPhase = 'ready' | 'drop' | 'guided' | 'handover' | 'explore';

const LOW = new THREE.Color(0x6f8a52);
const MID = new THREE.Color(0x8fa56a);
const HIGH = new THREE.Color(0xc4b896);
const PAPER = new THREE.Color(0xece6da);
const SKY = new THREE.Color(0xcfd8e0);
const ROAD = new THREE.Color(0x5c5348);
const WATER = new THREE.Color(0x4a7a9b);
const BUILDING = new THREE.Color(0xb8a890);
/** Brand orange — exact "everywhere" accent. */
const EXPLORER_ORANGE = 0xc2692a;

const MASK_CELL_M = 10;
/** Opening seed — enough to read water + shore buildings, not the whole plate. */
const SEED_RADIUS_M = 180;
const SEM_SIZE_M = 125;
/** Slightly oversized so it reads across a multi-km plate. */
const BALL_RADIUS_M = 7;
const IS_DEV = typeof import.meta !== 'undefined' && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

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
type WaterPoly = { e: number; n: number }[];

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

function pointInPoly(e: number, n: number, poly: WaterPoly): boolean {
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

export class HeroWorld {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private group = new THREE.Group();
  private semGroup = new THREE.Group();
  private tiles = new Map<string, LoadedTile>();
  private inflight = new Set<string>();
  private semLoaded = new Set<string>();
  private waterPolys: WaterPoly[] = [];
  private route: Route;
  private cfg: Required<Omit<HeroConfig, 'container' | 'route'>> & { container: HTMLElement };
  private headingRad = 0;
  /** Guided story progress 0..1 — owns ball position on the route only. */
  private progress = 0;
  private phase: HeroPhase = 'ready';
  private needsRender = true;
  private maskTex: THREE.DataTexture;
  private reveal: HeroRevealSession;
  private terrainMat: THREE.ShaderMaterial;
  private orbit = { dragging: false, moved: false, lastX: 0, lastY: 0, theta: 0, phi: 1.05, dist: 1100 };
  private ball!: THREE.Mesh;
  private shadow!: THREE.Mesh;
  private roll = new RollingOrientation(BALL_RADIUS_M, 2);
  private ballE = 0;
  private ballN = 0;
  private lastValidE = 0;
  private lastValidN = 0;
  private lastValidH = 0;
  private dropT = 0;
  private bounceT = -1;
  private animActive = false;
  private exploreTarget: { e: number; n: number } | null = null;
  private rejectLean: { e: number; n: number; until: number } | null = null;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  stats = {
    tilesLoaded: 0,
    tilesFailed: 0,
    cellsRevealed: 0,
    triangles: 0,
    roads: 0,
    water: 0,
    buildings: 0,
    semTiles: 0,
    routeRejects: 0,
    snapshotErrors: 0,
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

    const plateWE = PLATE_BBOX.maxE - PLATE_BBOX.minE;
    const plateHN = PLATE_BBOX.maxN - PLATE_BBOX.minN;
    const maskW = Math.round(plateWE / MASK_CELL_M);
    const maskH = Math.round(plateHN / MASK_CELL_M);
    this.reveal = new HeroRevealSession({
      minE: PLATE_BBOX.minE,
      minN: PLATE_BBOX.minN,
      cellM: MASK_CELL_M,
      width: maskW,
      height: maskH,
      radiusM: 90,
    });
    this.maskTex = new THREE.DataTexture(this.reveal.data, maskW, maskH, THREE.RedFormat);
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.wrapS = THREE.ClampToEdgeWrapping;
    this.maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTex.needsUpdate = true;

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        revealMask: { value: this.maskTex },
        paperColor: { value: PAPER.clone() },
        plateMin: { value: new THREE.Vector2(PLATE_BBOX.minE, PLATE_BBOX.minN) },
        plateSize: { value: new THREE.Vector2(plateWE, plateHN) },
        originEN: { value: new THREE.Vector2(this.cfg.originE, this.cfg.originN) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 naturalColor;
        varying vec3 vNatural;
        varying vec2 vEN;
        uniform vec2 originEN;
        void main() {
          vNatural = naturalColor;
          vEN = vec2(position.x + originEN.x, originEN.y - position.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
          gl_FragColor = vec4(mix(paperColor, vNatural, m), 1.0);
        }
      `,
    });

    this.scene.background = SKY;
    this.scene.add(this.group);
    this.scene.add(this.semGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(-0.35, 1.1, -0.45);
    this.scene.add(sun);
    // Restrained off-white rim so brand orange stays readable on parchment.
    const rim = new THREE.DirectionalLight(0xf5f0e8, 0.35);
    rim.position.set(0.6, 0.35, 0.7);
    this.scene.add(rim);

    this.buildExplorer();

    const el = this.cfg.container;
    this.camera = new THREE.PerspectiveCamera(52, el.clientWidth / el.clientHeight, 1, 16000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(this.renderer.domElement);

    addEventListener('resize', () => this.onResize());
    this.attachControls();
  }

  getPhase(): HeroPhase {
    return this.phase;
  }

  private local(e: number, n: number) {
    return { x: e - this.cfg.originE, z: this.cfg.originN - n };
  }

  private buildExplorer() {
    const geo = new THREE.SphereGeometry(BALL_RADIUS_M, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: EXPLORER_ORANGE,
      roughness: 0.82,
      metalness: 0.04,
    });
    this.ball = new THREE.Mesh(geo, mat);
    this.ball.visible = false;
    this.scene.add(this.ball);

    const shadowGeo = new THREE.CircleGeometry(BALL_RADIUS_M * 0.95, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1c1917,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = false;
    this.scene.add(this.shadow);
  }

  // -- loading ------------------------------------------------------------

  async preload(onProgress?: (loaded: number, total: number) => void) {
    // Full frozen plate — not a route corridor stub.
    const terrainIds = tilesForPlate(PLATE_BBOX);
    const semIds = semanticTilesForPlate(PLATE_BBOX);
    const total = terrainIds.length + semIds.length;
    let done = 0;
    const report = () => onProgress?.(done, total);

    let tCursor = 0;
    const terrainWorker = async () => {
      while (tCursor < terrainIds.length) {
        const id = terrainIds[tCursor++]!;
        await this.loadTile(id);
        done++;
        report();
      }
    };
    await Promise.all(Array.from({ length: 12 }, terrainWorker));

    // Prove start tile first, then the rest of the plate with LOD rings.
    const start = this.route.at(0);
    await this.loadSemanticTile(this.semanticId(start.e, start.n), 'core');

    let sCursor = 0;
    const semWorker = async () => {
      while (sCursor < semIds.length) {
        const id = semIds[sCursor++]!;
        if (!this.semLoaded.has(id)) {
          const layer = this.semLayerForId(id);
          await this.loadSemanticTile(id, layer);
        }
        done++;
        report();
      }
    };
    await Promise.all(Array.from({ length: 10 }, semWorker));

    this.ballE = start.e;
    this.ballN = start.n;
    const h0 = this.requireHeight(start.e, start.n, 'route start');
    this.lastValidE = start.e;
    this.lastValidN = start.n;
    this.lastValidH = h0;

    const gateFail = validateRoutePoints(this.route.points, this.gateCtx(), 5);
    if (gateFail) {
      this.stats.routeRejects++;
      console.error('[hero] guided route failed validation', gateFail);
    }

    if (this.reveal.revealAround(start.e, start.n, SEED_RADIUS_M)) {
      this.maskTex.needsUpdate = true;
    }
    this.stats.cellsRevealed = this.reveal.revealedCount;
    this.placeBallVisual(start.e, start.n, h0, /* airborne */ BALL_RADIUS_M * 14);
    this.ball.visible = false;
    this.shadow.visible = false;
    this.phase = 'ready';
    this.updateCameraGuided(0);
    this.needsRender = true;
  }

  private gateCtx() {
    return {
      bounds: PLATE_BBOX,
      sampleHeight: (e: number, n: number) => this.sampleHeight(e, n),
      isWater: (e: number, n: number) => this.isWater(e, n),
    };
  }

  private isWater(e: number, n: number): boolean {
    for (const poly of this.waterPolys) {
      if (pointInPoly(e, n, poly)) return true;
    }
    return false;
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
      if (buf.byteLength !== g * g * 2) throw new Error(`payload ${buf.byteLength}`);
      const q = new Uint16Array(buf);
      let qMin = 65535;
      let qMax = 0;
      for (let i = 0; i < q.length; i++) {
        if (q[i]! < qMin) qMin = q[i]!;
        if (q[i]! > qMax) qMax = q[i]!;
      }
      if (qMin === qMax && meta.terrain.maxM - meta.terrain.minM > 0.5) {
        throw new Error('degenerate payload');
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

  private buildMesh(heights: Float32Array, g: number, sizeM: number, swE: number, swN: number) {
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

  private semLayerForId(id: string): SemLayer {
    // semantic_125m_{ix}_{iy} → cell centre
    const parts = id.split('_');
    const ix = Number(parts[2]);
    const iy = Number(parts[3]);
    const e = ix * SEM_SIZE_M + SEM_SIZE_M / 2;
    const n = iy * SEM_SIZE_M + SEM_SIZE_M / 2;
    return this.semLayerFor(e, n);
  }

  private semLayerFor(e: number, n: number): SemLayer {
    const cx = (PLATE_BBOX.minE + PLATE_BBOX.maxE) / 2;
    const cy = (PLATE_BBOX.minN + PLATE_BBOX.maxN) / 2;
    const dx = Math.abs(e - cx);
    const dy = Math.abs(n - cy);
    // Full plate gets semantics: core buildings near focus, middle roads+water elsewhere.
    if (dx <= 600 && dy <= 600) return 'core';
    return 'middle';
  }

  private semanticId(e: number, n: number) {
    return `semantic_${SEM_SIZE_M}m_${Math.floor(e / SEM_SIZE_M)}_${Math.floor(n / SEM_SIZE_M)}`;
  }

  private async loadSemanticTile(id: string, layer: SemLayer) {
    if (this.semLoaded.has(id)) return;
    this.semLoaded.add(id);
    try {
      const res = await fetch(`${this.cfg.worldBase}/semantic/${id}/tile.json`);
      if (!res.ok) return;
      const tile = (await res.json()) as Record<string, unknown>;
      const origin = tile.origin as { easting: number; northing: number };
      const oe = origin.easting;
      const on = origin.northing;
      const roads = featureList(tile, 'roads') as Array<{ points?: number[][]; width?: number; class?: string }>;
      const water = featureList(tile, 'water') as Array<{ polygon?: number[][] }>;
      const buildings = featureList(tile, 'buildings') as Array<{ footprint?: number[][]; heightM?: number }>;

      for (const w of water) {
        const poly = w.polygon;
        if (!poly || poly.length < 3) continue;
        const abs: WaterPoly = poly.map((p) => ({ e: oe + p[0]!, n: on + p[1]! }));
        this.waterPolys.push(abs);
        if (layer === 'core' || layer === 'middle') this.addWaterPoly(oe, on, poly);
      }
      if (layer === 'core' || layer === 'middle') {
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
    let ok = 0;
    for (const pt of pts) {
      if (this.sampleHeight(oe + pt[0]!, on + pt[1]!) !== null) ok++;
    }
    if (ok < 2) return;
    this.drawRoadRibbon(oe, on, pts, Math.max(2.5, width * 0.55));
    this.stats.roads++;
  }

  private drawRoadRibbon(oe: number, on: number, pts: number[][], halfW: number) {
    const samples: { x: number; y: number; z: number }[] = [];
    for (const pt of pts) {
      const e = oe + pt[0]!;
      const n = on + pt[1]!;
      const h = this.sampleHeight(e, n);
      if (h === null) continue;
      const p = this.local(e, n);
      samples.push({ x: p.x, y: h * this.cfg.exaggeration + 0.4, z: p.z });
    }
    if (samples.length < 2) return;
    const verts: number[] = [];
    const idx: number[] = [];
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
    this.semGroup.add(new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: ROAD, flatShading: true })));
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
        new THREE.MeshLambertMaterial({ color: WATER, transparent: true, opacity: 0.88, depthWrite: false }),
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
    this.semGroup.add(new THREE.Mesh(extrude, new THREE.MeshLambertMaterial({ color: BUILDING })));
    this.stats.buildings++;
  }

  // -- ground / ball ------------------------------------------------------

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

  private requireHeight(e: number, n: number, where: string): number {
    const h = this.sampleHeight(e, n);
    if (h !== null) return h;
    this.stats.snapshotErrors++;
    if (IS_DEV) {
      throw new Error(`[hero] NO_GROUND at ${where} (${e.toFixed(1)}, ${n.toFixed(1)})`);
    }
    console.error('[hero] NO_GROUND — retaining last valid', where, e, n);
    return this.lastValidH;
  }

  private paintRevealAt(e: number, n: number) {
    if (this.reveal.revealAround(e, n)) {
      this.maskTex.needsUpdate = true;
      this.stats.cellsRevealed = this.reveal.revealedCount;
      this.needsRender = true;
    }
  }

  private placeBallVisual(e: number, n: number, h: number, airM = 0) {
    const p = this.local(e, n);
    const y = h * this.cfg.exaggeration + BALL_RADIUS_M + airM;
    this.ball.position.set(p.x, y, p.z);
    this.ball.quaternion.set(this.roll.quat.x, this.roll.quat.y, this.roll.quat.z, this.roll.quat.w);
    this.shadow.position.set(p.x, h * this.cfg.exaggeration + 0.2, p.z);
    const shadowOpacity = airM > 0.5 ? Math.max(0.06, 0.28 * (1 - Math.min(1, airM / 40))) : 0.28;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = shadowOpacity;
    this.shadow.scale.setScalar(airM > 0.5 ? 0.55 + 0.45 * (1 - Math.min(1, airM / 40)) : 1);
  }

  /**
   * Move ball on ground with rolling + monotonic reveal. Rejects invalid ground.
   */
  private moveBallTo(e: number, n: number, opts?: { skipGate?: boolean }): boolean {
    const gate = opts?.skipGate ? { ok: true as const, e, n, heightM: 0, slopeRad: 0 } : evaluateDestination(e, n, this.gateCtx());
    if (!gate.ok) {
      this.onRejected(gate);
      return false;
    }
    const h = this.requireHeight(e, n, 'ball move');
    this.roll.advanceEN(this.ballE, this.ballN, e, n);
    this.ballE = e;
    this.ballN = n;
    this.lastValidE = e;
    this.lastValidN = n;
    this.lastValidH = h;
    this.placeBallVisual(e, n, h, 0);
    this.paintRevealAt(e, n);
    this.needsRender = true;
    return true;
  }

  private onRejected(reject: MovementReject, toward?: { e: number; n: number }) {
    this.rejectLean = {
      e: toward?.e ?? this.ballE,
      n: toward?.n ?? this.ballN,
      until: performance.now() + 420,
    };
    this.cfg.container.dispatchEvent(
      new CustomEvent('hero:reject', { detail: { reason: reject.reason as RejectReason, caption: reject.caption } }),
    );
    this.needsRender = true;
  }

  // -- scroll / phases ----------------------------------------------------

  onPanelsProgress(rawProgress: number) {
    const story = this.easeOpening(rawProgress);

    if (this.phase === 'explore' || this.phase === 'handover') {
      if (rawProgress < 0.98) {
        this.enterGuidedFromExplore(story);
      } else {
        return;
      }
    }

    if (this.phase === 'ready') {
      if (rawProgress < 0.002) {
        this.updateCameraGuided(0);
        return;
      }
      this.beginDrop();
    }

    if (this.phase === 'drop') {
      // Progress waits until drop settles; still allow camera ease.
      this.updateCameraGuided(Math.min(story, 0.02));
      return;
    }

    if (this.phase === 'guided') {
      this.setGuidedProgress(story);
      if (handoverReached(rawProgress)) this.beginHandover();
    }
  }

  private easeOpening(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    if (c < 0.25) {
      const u = c / 0.25;
      return 0.4 * (u * u * (3 - 2 * u));
    }
    return 0.4 + ((c - 0.25) / 0.75) * 0.6;
  }

  private beginDrop() {
    this.phase = 'drop';
    this.dropT = 0;
    this.animActive = true;
    this.ball.visible = true;
    this.shadow.visible = true;
    const h = this.requireHeight(this.ballE, this.ballN, 'drop');
    this.placeBallVisual(this.ballE, this.ballN, h, BALL_RADIUS_M * 16);
    this.cfg.container.dispatchEvent(new CustomEvent('hero:phase', { detail: { phase: 'drop' } }));
  }

  private tickDrop(dt: number) {
    this.dropT += dt;
    const dur = 0.85;
    const u = Math.min(1, this.dropT / dur);
    // Soft landing ease-out with slight squash anticipation.
    const air = BALL_RADIUS_M * 16 * (1 - u) * (1 - u);
    const h = this.requireHeight(this.ballE, this.ballN, 'drop tick');
    this.placeBallVisual(this.ballE, this.ballN, h, air);
    this.needsRender = true;
    if (u >= 1) {
      this.phase = 'guided';
      this.animActive = false;
      this.paintRevealAt(this.ballE, this.ballN);
      this.cfg.container.dispatchEvent(new CustomEvent('hero:phase', { detail: { phase: 'guided' } }));
    }
  }

  private setGuidedProgress(p: number) {
    const clamped = Math.min(1, Math.max(0, p));
    if (Math.abs(clamped - this.progress) < 1e-6) {
      this.updateCameraGuided(clamped);
      return;
    }
    const from = this.route.at(this.progress);
    const to = this.route.at(clamped);
    // Subdivide large scroll jumps for roll + reveal continuity.
    const dist = Math.hypot(to.e - from.e, to.n - from.n);
    const steps = Math.max(1, Math.ceil(dist / 2));
    let e = from.e;
    let n = from.n;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ne = from.e + (to.e - from.e) * t;
      const nn = from.n + (to.n - from.n) * t;
      // Guided route already validated; still refuse NO_GROUND in prod.
      const h = this.sampleHeight(ne, nn);
      if (h === null) {
        this.stats.snapshotErrors++;
        if (IS_DEV) throw new Error(`[hero] NO_GROUND on guided route at ${ne},${nn}`);
        break;
      }
      this.roll.advanceEN(e, n, ne, nn);
      e = ne;
      n = nn;
      this.paintRevealAt(e, n);
    }
    this.ballE = e;
    this.ballN = n;
    this.lastValidE = e;
    this.lastValidN = n;
    this.lastValidH = this.requireHeight(e, n, 'guided');
    this.placeBallVisual(e, n, this.lastValidH, 0);
    this.progress = clamped;
    this.updateCameraGuided(clamped);
  }

  private beginHandover() {
    if (this.phase === 'handover' || this.phase === 'explore') return;
    this.phase = 'handover';
    this.bounceT = 0;
    this.animActive = true;
    this.cfg.container.dispatchEvent(new CustomEvent('hero:handover'));
    this.cfg.container.dispatchEvent(new CustomEvent('hero:phase', { detail: { phase: 'handover' } }));
  }

  private tickBounce(dt: number) {
    this.bounceT += dt;
    const t = this.bounceT;
    // One short satisfying bounce then settle.
    const bounce = t < 0.55 ? Math.abs(Math.sin((t / 0.55) * Math.PI)) * BALL_RADIUS_M * 1.8 * (1 - t / 0.55) : 0;
    this.placeBallVisual(this.ballE, this.ballN, this.lastValidH, bounce);
    this.needsRender = true;
    if (t >= 0.7) {
      this.phase = 'explore';
      this.animActive = false;
      this.syncOrbitFromCamera();
      this.cfg.container.dispatchEvent(new CustomEvent('hero:phase', { detail: { phase: 'explore' } }));
    }
  }

  private enterGuidedFromExplore(storyProgress: number) {
    this.phase = 'guided';
    this.exploreTarget = null;
    this.cfg.container.dispatchEvent(new CustomEvent('hero:story'));
    this.cfg.container.dispatchEvent(new CustomEvent('hero:phase', { detail: { phase: 'guided' } }));
    this.setGuidedProgress(storyProgress);
  }

  private updateCameraGuided(progress: number) {
    const pose = cameraPoseFor(this.route, progress, this.headingRad, DEFAULT_CAMERA);
    this.headingRad = pose.heading;
    const look = this.local(this.ballE, this.ballN);
    const groundY = this.lastValidH * this.cfg.exaggeration;
    this.camera.position.set(
      look.x - Math.sin(pose.heading) * pose.distanceM,
      groundY + pose.heightM,
      look.z + Math.cos(pose.heading) * pose.distanceM,
    );
    this.camera.lookAt(look.x, groundY + BALL_RADIUS_M, look.z);
    this.needsRender = true;
  }

  private syncOrbitFromCamera() {
    const t = this.local(this.ballE, this.ballN);
    const dx = this.camera.position.x - t.x;
    const dy = this.camera.position.y - this.lastValidH * this.cfg.exaggeration;
    const dz = this.camera.position.z - t.z;
    this.orbit.dist = Math.hypot(dx, dy, dz);
    this.orbit.theta = Math.atan2(dx, dz);
    this.orbit.phi = Math.acos(Math.min(1, Math.max(0.05, dy / Math.max(1, this.orbit.dist))));
  }

  private applyOrbit() {
    const t = this.local(this.ballE, this.ballN);
    const y = this.lastValidH * this.cfg.exaggeration;
    const { theta, phi, dist } = this.orbit;
    this.camera.position.set(
      t.x + dist * Math.sin(phi) * Math.sin(theta),
      y + dist * Math.cos(phi),
      t.z + dist * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(t.x, y + BALL_RADIUS_M, t.z);
    this.camera.near = Math.max(1, dist * 0.002);
    this.camera.far = dist * 8 + 4000;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  zoomBy(factor: number) {
    this.orbit.dist = Math.min(6000, Math.max(80, this.orbit.dist * factor));
    if (this.phase === 'explore' || this.phase === 'handover') this.applyOrbit();
    else this.updateCameraGuided(this.progress);
  }

  // -- free explore -------------------------------------------------------

  private tryTapExplore(clientX: number, clientY: number) {
    if (this.phase !== 'explore') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.group.children], false);
    if (!hits.length) return;
    const hit = hits[0]!;
    const e = hit.point.x + this.cfg.originE;
    const n = this.cfg.originN - hit.point.z;
    const gate = evaluateDestination(e, n, this.gateCtx());
    if (!gate.ok) {
      this.onRejected(gate, { e, n });
      return;
    }
    this.exploreTarget = { e: gate.e, n: gate.n };
  }

  private tickExplore(dt: number) {
    // Reject lean: nudge toward bad target then ease back.
    if (this.rejectLean && performance.now() < this.rejectLean.until) {
      const lean = this.rejectLean;
      const t = 1 - (this.rejectLean.until - performance.now()) / 480;
      const mix = Math.sin(Math.min(1, t) * Math.PI) * 0.35;
      const e = this.lastValidE + (lean.e - this.lastValidE) * mix * 0.15;
      const n = this.lastValidN + (lean.n - this.lastValidN) * mix * 0.15;
      const h = this.requireHeight(this.lastValidE, this.lastValidN, 'lean');
      this.placeBallVisual(e, n, h, 0);
      this.needsRender = true;
    } else if (this.rejectLean) {
      this.rejectLean = null;
      this.placeBallVisual(this.lastValidE, this.lastValidN, this.lastValidH, 0);
    }

    if (!this.exploreTarget) {
      this.applyOrbit();
      return;
    }
    const te = this.exploreTarget.e;
    const tn = this.exploreTarget.n;
    const dE = te - this.ballE;
    const dN = tn - this.ballN;
    const dist = Math.hypot(dE, dN);
    if (dist < 0.8) {
      this.exploreTarget = null;
      this.applyOrbit();
      return;
    }
    const speed = Math.min(55, 18 + dist * 0.35);
    const step = Math.min(dist, speed * dt);
    const ne = this.ballE + (dE / dist) * step;
    const nn = this.ballN + (dN / dist) * step;
    if (!this.moveBallTo(ne, nn)) {
      this.exploreTarget = null;
    }
    this.applyOrbit();
  }

  private attachControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.orbit.dragging = true;
      this.orbit.moved = false;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      const wasDrag = this.orbit.dragging;
      const moved = this.orbit.moved;
      this.orbit.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasDrag && !moved && this.phase === 'explore') {
        this.tryTapExplore(e.clientX, e.clientY);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.orbit.dragging) return;
      const dx = e.clientX - this.orbit.lastX;
      const dy = e.clientY - this.orbit.lastY;
      if (Math.hypot(dx, dy) > 3) this.orbit.moved = true;
      this.orbit.theta -= dx * 0.005;
      this.orbit.phi = Math.min(1.45, Math.max(0.15, this.orbit.phi - dy * 0.005));
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      if (this.phase === 'explore' || this.phase === 'handover') this.applyOrbit();
      else {
        this.headingRad += dx * -0.004;
        this.updateCameraGuided(this.progress);
      }
    });

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
      if (pinchDist > 0) this.zoomBy(pinchDist / Math.max(1, d));
      pinchDist = d;
    });
  }

  private onResize() {
    const el = this.cfg.container;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.needsRender = true;
  }

  start() {
    this.clock.start();
    const tick = () => {
      const dt = Math.min(0.05, this.clock.getDelta());
      if (this.phase === 'drop') this.tickDrop(dt);
      else if (this.phase === 'handover') this.tickBounce(dt);
      else if (this.phase === 'explore') this.tickExplore(dt);

      if (this.needsRender || this.animActive || this.phase === 'explore') {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}
