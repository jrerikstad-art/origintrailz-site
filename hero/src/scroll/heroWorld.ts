/**
 * Site hero — Three.js world.
 *
 * Renders a FROZEN SNAPSHOT of inspected tiles, walked by page scroll, with the
 * fog opening behind the player. At the end of the page it hands over to free
 * orbit so the visitor can fly the world themselves.
 *
 * DELIBERATE DIFFERENCES FROM THE APP ENGINE
 * ------------------------------------------
 * This is a separate, small renderer. It does not import the app's streaming,
 * discovery or LOD systems, for two reasons:
 *
 *  1. The route is known in advance. Everything can be prefetched before it is
 *     looked at, so none of the reactive machinery is needed.
 *  2. It must not inherit the app's in-flight geometry bugs. A public page is
 *     the wrong place to discover that roads fall back to a constant 2 m.
 *
 * NO INVENTED HEIGHTS. Anywhere a height is unavailable, the feature is not
 * drawn. There is no `?? 2`, no `return 0`, no nearest-tile fallback. On a
 * frozen snapshot a miss means the snapshot is wrong, and it should be visible
 * in dev rather than papered over in production.
 */
import * as THREE from 'three';
import {
  DEFAULT_CAMERA,
  DEFAULT_REVEAL,
  Route,
  cameraPoseFor,
  handoverReached,
  revealedCells,
  scrollToProgress,
  tilesForRange,
  type RoutePoint,
} from './routeWalk';

export interface HeroConfig {
  /** Base URL of the FROZEN snapshot. Never the live factory. */
  worldBase: string;
  /** Recorded route through the snapshot, EPSG:25832. */
  route: RoutePoint[];
  /** Render origin — the snapshot centre. Local coords stay small. */
  originE: number;
  originN: number;
  container: HTMLElement;
  /** Vertical exaggeration. 1.3 reads well on a landing page. */
  exaggeration?: number;
}

const LOW = new THREE.Color(0x6f8a52);
const MID = new THREE.Color(0x8fa56a);
const HIGH = new THREE.Color(0xc4b896);
const PAPER = new THREE.Color(0xece6da);
const SKY = new THREE.Color(0xcfd8e0);

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

export class HeroWorld {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private group = new THREE.Group();
  private tiles = new Map<string, LoadedTile>();
  private inflight = new Set<string>();
  private route: Route;
  private cfg: Required<Omit<HeroConfig, 'container' | 'route'>> & { container: HTMLElement };
  private headingRad = 0;
  private progress = 0;
  private revealed = new Set<string>();
  private freeMode = false;
  private needsRender = true;

  /** Surfaced so the page can show "N tiles revealed" honestly. */
  stats = { tilesLoaded: 0, tilesFailed: 0, cellsRevealed: 0, triangles: 0 };

  constructor(config: HeroConfig) {
    this.cfg = {
      worldBase: config.worldBase.replace(/\/$/, ''),
      originE: config.originE,
      originN: config.originN,
      exaggeration: config.exaggeration ?? 1.3,
      container: config.container,
    };
    this.route = new Route(config.route);

    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY.getHex(), 800, 3200);
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(-0.4, 1, -0.5);
    this.scene.add(sun);

    const el = this.cfg.container;
    this.camera = new THREE.PerspectiveCamera(48, el.clientWidth / el.clientHeight, 1, 12000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(this.renderer.domElement);

    addEventListener('resize', () => this.onResize());
    this.attachFreeControls();
  }

  private local(e: number, n: number) {
    return { x: e - this.cfg.originE, z: this.cfg.originN - n };
  }

  // -- loading ------------------------------------------------------------

  /**
   * Prefetch every tile the whole route needs, before the walk starts.
   *
   * The app streams because it cannot know where the player will go. The site
   * does know, so nothing should ever load reactively — a tile arriving during
   * a scroll is a visible pop, and there is no reason to accept one.
   */
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
    this.applyReveal(0);
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

      // Reject a payload that decodes flat while its metadata claims relief.
      // The factory has published such tiles; a landing page must not show one.
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
      // Loud in dev, silent to the visitor. A failed tile on a frozen snapshot
      // means the snapshot is wrong and should be fixed, not tolerated.
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
    const colors = new Float32Array(g * g * 3);

    for (let row = 0; row < g; row++) {
      const n = swN + sizeM - row * step; // row 0 = north
      for (let col = 0; col < g; col++) {
        const e = swE + col * step;
        const h = heights[row * g + col]!;
        const p = this.local(e, n);
        const i = (row * g + col) * 3;
        positions[i] = p.x;
        positions[i + 1] = h * this.cfg.exaggeration;
        positions[i + 2] = p.z;
        // Start fully undiscovered; applyReveal paints the walked cells.
        colors[i] = PAPER.r;
        colors[i + 1] = PAPER.g;
        colors[i + 2] = PAPER.b;
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
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(index);
    geom.computeVertexNormals();
    this.stats.triangles += index.length / 3;
    return new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  // -- reveal -------------------------------------------------------------

  /**
   * Repaint vertex colours for the walked area.
   *
   * Uses a plain membership test per vertex, NOT a Gaussian kernel. The app's
   * field does ~149 lookups per vertex and that measured at 344 ms a frame; a
   * landing page cannot afford it and does not need it — the softness here
   * comes from a distance ramp against the nearest revealed cell, one lookup.
   */
  private applyReveal(progress: number) {
    const cells = revealedCells(this.route, progress, DEFAULT_REVEAL);
    this.revealed = cells;
    this.stats.cellsRevealed = cells.size;
    const cellM = DEFAULT_REVEAL.cellM;
    const c = new THREE.Color();

    for (const t of this.tiles.values()) {
      const attr = t.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const step = t.sizeM / (t.grid - 1);
      let changed = false;
      for (let row = 0; row < t.grid; row++) {
        const n = t.swN + t.sizeM - row * step;
        for (let col = 0; col < t.grid; col++) {
          const e = t.swE + col * step;
          const key = `${Math.floor(e / cellM)},${Math.floor(n / cellM)}`;
          const idx = row * t.grid + col;
          if (cells.has(key)) {
            const h = t.heights[idx]!;
            const f = Math.min(1, Math.max(0, h / 220));
            c.copy(LOW).lerp(MID, Math.min(1, f * 1.6));
            if (f > 0.55) c.lerp(HIGH, (f - 0.55) / 0.45);
          } else {
            c.copy(PAPER);
          }
          attr.setXYZ(idx, c.r, c.g, c.b);
          changed = true;
        }
      }
      if (changed) attr.needsUpdate = true;
    }
    this.needsRender = true;
  }

  // -- scroll -------------------------------------------------------------

  /** Call from a scroll listener. Cheap when progress has not moved. */
  onScroll(scrollY: number, scrollHeight: number, viewportH: number) {
    if (this.freeMode) return;
    const p = scrollToProgress({ scrollY, scrollHeight, viewportH });
    if (Math.abs(p - this.progress) < 0.0005) return;
    this.progress = p;
    this.applyReveal(p);
    this.updateCamera(p);
    if (handoverReached(p)) this.enterFreeMode();
  }

  private updateCamera(progress: number) {
    const pose = cameraPoseFor(this.route, progress, this.headingRad, DEFAULT_CAMERA);
    this.headingRad = pose.heading;
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

  /**
   * Strict height lookup. Returns null when the tile is not loaded — the caller
   * decides. No fallback, ever.
   */
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

  // -- free mode ----------------------------------------------------------

  private enterFreeMode() {
    if (this.freeMode) return;
    this.freeMode = true;
    this.cfg.container.dispatchEvent(new CustomEvent('hero:handover'));
  }

  private orbit = { dragging: false, lastX: 0, lastY: 0, theta: 0, phi: 1.0, dist: 900 };

  private attachFreeControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.freeMode) return;
      this.orbit.dragging = true;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
    });
    addEventListener('pointerup', () => {
      this.orbit.dragging = false;
    });
    addEventListener('pointermove', (e) => {
      if (!this.freeMode || !this.orbit.dragging) return;
      this.orbit.theta -= (e.clientX - this.orbit.lastX) * 0.005;
      this.orbit.phi = Math.min(1.45, Math.max(0.15, this.orbit.phi - (e.clientY - this.orbit.lastY) * 0.005));
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      this.applyOrbit();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.freeMode) return;
        e.preventDefault();
        this.orbit.dist = Math.min(6000, Math.max(120, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.12)));
        this.applyOrbit();
      },
      { passive: false },
    );
  }

  private applyOrbit() {
    const end = this.route.at(1);
    const t = this.local(end.e, end.n);
    const g = this.sampleHeight(end.e, end.n);
    const y = (g === null ? 0 : g * this.cfg.exaggeration);
    const { theta, phi, dist } = this.orbit;
    this.camera.position.set(
      t.x + dist * Math.sin(phi) * Math.sin(theta),
      y + dist * Math.cos(phi),
      t.z + dist * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(t.x, y, t.z);
    // Near/far must follow the camera, or geometry falls outside the frustum
    // and appears to stream in while panning.
    this.camera.near = Math.max(1, dist * 0.002);
    this.camera.far = dist * 8 + 4000;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  // -- loop ---------------------------------------------------------------

  private onResize() {
    const el = this.cfg.container;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.needsRender = true;
  }

  /** Render on demand only — an idle landing page must not spin the GPU. */
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
