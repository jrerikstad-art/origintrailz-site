/** Frozen GLB header. No factory requests, no runtime tile rebuilds. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HEADER, HeaderGround } from './headerTerrain';
import { DiscoveryMask } from './discoveryMask';
import { Route, type RoutePoint } from './routeWalk';
import { checkGroundPath, type GroundPoint } from './exploration';

export interface HeroConfig {
  route: RoutePoint[];
  container: HTMLElement;
  preview?: boolean;
  onModeChange?: (exploring: boolean) => void;
  onStatus?: (message: string) => void;
}

const ORANGE = 0xc2692a;
const RADIUS = 10;

export class HeroWorld {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, 1, 12000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly mask = new DiscoveryMask();
  private readonly route: Route;
  private readonly marker = new THREE.Group();
  private readonly roll = new THREE.Group();
  private readonly events = new AbortController();
  private readonly resize: ResizeObserver;
  private ground?: HeaderGround;
  private model?: THREE.Group;
  private ready = false;
  private disposed = false;
  private frame = 0;
  private progress = 0;
  private revealedDistance = 0;
  private markerDistance = 0;
  private manual = false;
  private exploring = false;
  private target = new THREE.Vector3(0, 160, 10);
  private orbit = { theta: -.12, phi: .94, distance: 2500 };
  private drag: { id: number; x: number; y: number; startX: number; startY: number;
    mode: 'orbit' | 'pan' | 'ball'; moved: boolean } | null = null;
  private readonly pointers = new Map<number, GroundPoint>();
  private pinch: { x: number; y: number; distance: number } | null = null;
  private motion?: { from: GroundPoint; to: GroundPoint; start: number; duration: number };
  private refusal?: { start: number; angle: number };
  private statusTimer?: ReturnType<typeof setTimeout>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  stats = { meshesLoaded: 0, triangles: 0, bytes: HEADER.bytes, ready: false };

  constructor(private readonly config: HeroConfig) {
    this.route = new Route(config.route);
    this.scene.background = new THREE.Color(0xeee9de);
    // Discovery mask owns concealment. Distance fog must not bleach the plate.
    // Match the supplied app's normal presentation (not its DTM debug mode).
    this.scene.add(new THREE.HemisphereLight(0xfff2dd, 0x4a5c42, 1.3));
    const sun = new THREE.DirectionalLight(0xffe6c8, 2.0);
    sun.position.set(400, 600, 200);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7f97b3, .35);
    fill.position.set(360, 120, 360);
    this.scene.add(fill);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.style.opacity = '0';
    this.renderer.domElement.style.touchAction = config.preview ? 'none' : 'pan-y pinch-zoom';
    this.renderer.domElement.setAttribute('aria-label', 'Bergura 3D terrain. Drag to rotate, Shift-drag to pan, plus and minus to zoom.');
    this.renderer.domElement.tabIndex = 0;
    config.container.appendChild(this.renderer.domElement);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ color: ORANGE, roughness: .55, metalness: 0 }));
    const rim = new THREE.Mesh(new THREE.SphereGeometry(RADIUS + .75, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff4df, side: THREE.BackSide }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(RADIUS + .05, .38, 6, 48),
      new THREE.MeshStandardMaterial({ color: 0xfff4df, roughness: .65 }));
    this.roll.add(ball, rim, band);
    this.marker.add(this.roll);
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.attachControls();
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(config.container);
    this.onResize();
  }

  private point(distance: number) {
    const sample = this.route.at(distance / this.route.lengthM);
    return { x: sample.e - HEADER.originE, z: HEADER.originN - sample.n };
  }

  async preload(onProgress?: (loaded: number, total: number) => void) {
    const gltf = await new GLTFLoader().loadAsync(HEADER.url, event => {
      onProgress?.(Math.min(event.loaded, HEADER.bytes), event.lengthComputable ? event.total : HEADER.bytes);
    });
    if (this.disposed) { this.disposeObject(gltf.scene); return; }
    const ground = new HeaderGround(gltf.scene);
    // Reject a wrong crop before any geometry or marker becomes visible.
    for (let d = 0; d <= this.route.lengthM + 5; d += 5) {
      const p = this.point(Math.min(d, this.route.lengthM));
      ground.required(p.x, p.z);
    }
    for (let i = 1; i < this.route.cum.length; i++) {
      if (checkGroundPath(ground, this.point(this.route.cum[i - 1]), this.point(this.route.cum[i])) !== 'ok') {
        this.disposeObject(gltf.scene);
        throw new Error('Header demo path crosses missing ground or a steep slope');
      }
    }
    this.ground = ground;
    this.model = gltf.scene;
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => this.mask.apply(material));
    });
    this.scene.add(gltf.scene);
    this.stats.meshesLoaded = ground.meshes.length;
    this.stats.triangles = ground.triangles;
    if (this.config.preview) {
      this.mask.revealAll();
      this.manual = true;
    } else {
      this.revealThrough(Math.max(100, this.progress * this.route.lengthM));
      this.moveMarker(this.progress * this.route.lengthM);
      this.marker.visible = true;
    }
    this.mask.flush();
    this.ready = true;
    this.stats.ready = true;
    this.storyCamera();
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    // Atomic reveal: all four chunks, ground checks, mask and first frame ready.
    this.renderer.domElement.style.opacity = '1';
    onProgress?.(HEADER.bytes, HEADER.bytes);
  }

  private revealThrough(distance: number) {
    const end = Math.min(this.route.lengthM, distance);
    if (end <= this.revealedDistance) return;
    let from = this.point(this.revealedDistance);
    // Respect route corners instead of connecting a fast scroll with one chord.
    const stops = this.route.cum.filter(d => d > this.revealedDistance && d < end).concat(end);
    for (const d of stops) {
      const to = this.point(d);
      this.mask.revealSegment(from.x, from.z, to.x, to.z);
      from = to;
    }
    this.revealedDistance = end;
  }

  private moveMarker(distance: number) {
    if (!this.ground) return;
    let from = this.point(this.markerDistance);
    const delta = distance - this.markerDistance;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 8));
    const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
    const direction = new THREE.Vector3(), turn = new THREE.Quaternion();
    for (let i = 1; i <= steps; i++) {
      const to = this.point(this.markerDistance + delta * i / steps);
      direction.set(to.x - from.x, 0, to.z - from.z);
      const length = direction.length();
      if (length > .00001) {
        axis.crossVectors(up, direction.normalize()).normalize();
        turn.setFromAxisAngle(axis, length / RADIUS);
        this.roll.quaternion.premultiply(turn).normalize();
      }
      from = to;
    }
    this.markerDistance = distance;
    const y = this.ground.required(from.x, from.z);
    this.marker.position.set(from.x, y + RADIUS, from.z);
  }

  /** Progress belongs to the four hero panels, not the pricing/footer height. */
  onScroll(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    if (!this.ready || this.config.preview || this.exploring) return;
    this.revealThrough(Math.max(100, this.progress * this.route.lengthM));
    this.moveMarker(this.progress * this.route.lengthM);
    if (!this.manual) this.storyCamera();
    this.draw();
  }

  private fitDistance() {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    return 1050 / Math.sin(Math.min(vertical, horizontal));
  }

  private storyCamera() {
    const overview = this.config.preview || this.reducedMotion ? 1 : this.progress * this.progress * (3 - 2 * this.progress);
    const opening = this.point(60);
    const startY = (this.ground?.sample(opening.x, opening.z) ?? 70) + 45;
    this.target.set(opening.x * (1 - overview),
      THREE.MathUtils.lerp(startY, 160, overview), opening.z * (1 - overview));
    this.orbit.theta = -.12 + (this.reducedMotion ? 0 : this.progress * .16);
    this.orbit.phi = .94 - (this.reducedMotion ? 0 : this.progress * .1);
    const full = this.fitDistance() * .9;
    this.orbit.distance = THREE.MathUtils.lerp(Math.min(full, 1000), full, overview);
    this.applyOrbit();
  }

  private applyOrbit() {
    const { theta, phi, distance } = this.orbit;
    this.camera.position.set(
      distance * Math.sin(phi) * Math.sin(theta),
      distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.cos(theta),
    ).add(this.target);
    const below = this.ground?.sample(this.camera.position.x, this.camera.position.z);
    if (below != null) this.camera.position.y = Math.max(this.camera.position.y, below + 35);
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(.5, distance / 3000);
    this.camera.far = distance + 7000;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  zoom(factor: number) {
    if (!this.ready) return;
    this.manual = true;
    this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance * factor, 220, Math.max(8000, this.fitDistance()));
    this.applyOrbit();
  }

  resetView() {
    if (this.exploring) {
      this.target.set(0, 160, 0);
      this.orbit = { theta: -.12, phi: .94, distance: this.fitDistance() * .9 };
      this.applyOrbit();
      return;
    }
    this.manual = Boolean(this.config.preview);
    this.storyCamera();
  }

  setExploring(enabled: boolean) {
    if (!this.ready || this.config.preview || this.exploring === enabled) return;
    this.exploring = enabled;
    this.manual = enabled;
    this.motion = undefined;
    this.refusal = undefined;
    this.marker.rotation.set(0, 0, 0);
    this.pointers.clear(); this.pinch = null; this.drag = null;
    this.renderer.domElement.style.touchAction = enabled ? 'none' : 'pan-y pinch-zoom';
    if (!enabled) {
      // Return to the narrative without painting a shortcut from free play.
      // The accumulated reveal and rolling quaternion both survive this switch.
      this.markerDistance = this.progress * this.route.lengthM;
      this.onScroll(this.progress);
    }
    this.config.onModeChange?.(enabled);
    this.tell(this.instructions());
    this.draw();
  }

  private instructions() {
    if (this.config.preview) return 'Drag to rotate · Shift-drag to pan · + / − to zoom';
    return this.exploring ? 'Click ground or drag the orange ball · drag elsewhere to rotate · Shift-drag to pan' :
      'Scroll to reveal · drag to rotate · Explore freely to move the ball';
  }

  private tell(message: string, briefly = false) {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.config.onStatus?.(message);
    if (briefly) this.statusTimer = setTimeout(() => this.config.onStatus?.(this.instructions()), 2400);
  }

  /** Free exploration affects only this in-memory demo mask. */
  moveBallTo(x: number, z: number): boolean {
    if (!this.ready || !this.ground || !this.exploring) return false;
    const from = { x: this.marker.position.x, z: this.marker.position.z };
    const result = checkGroundPath(this.ground, from, { x, z });
    if (result !== 'ok') {
      this.reject(result === 'outside' ? 'That is outside this map preview.' : 'That slope is too steep. Try closer ground.', x, z);
      return false;
    }
    this.refusal = undefined; this.marker.rotation.set(0, 0, 0);
    this.motion = { from, to: { x, z }, start: performance.now(),
      duration: this.reducedMotion ? 1 : Math.min(2400, Math.max(120, Math.hypot(x - from.x, z - from.z) / .28)) };
    this.draw();
    return true;
  }

  private reject(message: string, x = this.marker.position.x, z = this.marker.position.z) {
    this.motion = undefined;
    this.refusal = this.reducedMotion ? undefined :
      { start: performance.now(), angle: Math.atan2(x - this.marker.position.x, z - this.marker.position.z) };
    this.tell(message, true); this.draw();
  }

  private advanceMotion(now: number) {
    if (this.motion && this.ground) {
      const t = THREE.MathUtils.clamp((now - this.motion.start) / this.motion.duration, 0, 1);
      const a = t * t * (3 - 2 * t);
      const x = THREE.MathUtils.lerp(this.motion.from.x, this.motion.to.x, a);
      const z = THREE.MathUtils.lerp(this.motion.from.z, this.motion.to.z, a);
      const from = this.marker.position;
      const direction = new THREE.Vector3(x - from.x, 0, z - from.z);
      const distance = direction.length();
      if (distance > .00001) {
        const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        this.roll.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, distance / RADIUS)).normalize();
        this.mask.revealSegment(from.x, from.z, x, z);
      }
      this.marker.position.set(x, this.ground.required(x, z) + RADIUS, z);
      if (t >= 1) this.motion = undefined;
    }
    if (this.refusal) {
      const t = THREE.MathUtils.clamp((now - this.refusal.start) / 350, 0, 1);
      const tilt = Math.sin(t * Math.PI) * .2;
      this.marker.rotation.set(Math.cos(this.refusal.angle) * tilt, 0, -Math.sin(this.refusal.angle) * tilt);
      if (t >= 1) { this.refusal = undefined; this.marker.rotation.set(0, 0, 0); }
    }
  }

  private pan(dx: number, dy: number) {
    this.manual = true;
    const metresPerPixel = 2 * this.orbit.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) /
      Math.max(1, this.config.container.clientHeight);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0; up.y = 0; right.normalize(); up.normalize();
    this.target.addScaledVector(right, -dx * metresPerPixel).addScaledVector(up, dy * metresPerPixel);
    this.target.x = THREE.MathUtils.clamp(this.target.x, HEADER.minX, HEADER.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, HEADER.minZ, HEADER.maxZ);
    const y = this.ground?.sample(this.target.x, this.target.z);
    if (y != null) this.target.y = THREE.MathUtils.lerp(this.target.y, y + 40, .25);
    this.applyOrbit();
  }

  private setRay(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
    this.camera.updateMatrixWorld(); this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  private moveFromPointer(x: number, y: number) {
    this.setRay(x, y);
    const hit = this.raycaster.intersectObjects(this.ground?.meshes ?? [], false)[0];
    if (hit) this.moveBallTo(hit.point.x, hit.point.z);
    else this.reject('That is outside this map preview.');
  }

  private attachControls() {
    const el = this.renderer.domElement;
    const signal = this.events.signal;
    const touchPair = () => {
      const [a, b] = [...this.pointers.values()];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.z + b.z) / 2,
        distance: Math.max(1, Math.hypot(a.x - b.x, a.z - b.z)) } : null;
    };
    el.addEventListener('pointerdown', event => {
      if (!this.ready || ![0, 2].includes(event.button) || (!this.exploring && !this.config.preview && !event.isPrimary)) return;
      this.manual = true;
      this.pointers.set(event.pointerId, { x: event.clientX, z: event.clientY });
      el.setPointerCapture(event.pointerId);
      if (event.pointerType === 'touch' && (this.exploring || this.config.preview) && this.pointers.size > 1) {
        this.pinch = touchPair();
        if (this.drag) this.drag.moved = true;
        return;
      }
      let mode: 'orbit' | 'pan' | 'ball' = event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
      if (this.exploring && mode === 'orbit') {
        this.setRay(event.clientX, event.clientY);
        if (this.raycaster.intersectObject(this.marker, true).length) mode = 'ball';
      }
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, mode, moved: false };
    }, { signal });
    el.addEventListener('pointermove', event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, z: event.clientY });
      if (event.pointerType === 'touch' && (this.exploring || this.config.preview) && this.pointers.size > 1) {
        const next = touchPair();
        if (next && this.pinch) {
          this.pan(next.x - this.pinch.x, next.y - this.pinch.y);
          this.zoom(this.pinch.distance / next.distance);
        }
        this.pinch = next;
        return;
      }
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 5) this.drag.moved = true;
      if (this.drag.mode === 'ball') {
        if (this.drag.moved) this.moveFromPointer(event.clientX, event.clientY);
      } else if (this.drag.mode === 'pan') this.pan(dx, dy);
      else {
        this.orbit.theta -= dx * .004;
        // Touch vertical motion belongs to page scroll until Explore is chosen.
        if (this.exploring || this.config.preview || event.pointerType !== 'touch') this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi - dy * .004, .2, 1.25);
        this.applyOrbit();
      }
      this.drag.x = event.clientX; this.drag.y = event.clientY;
    }, { signal });
    const end = (event: PointerEvent) => {
      const drag = this.drag;
      const wasPinching = this.pinch !== null;
      if (event.type === 'pointerup' && drag?.id === event.pointerId && !drag.moved && drag.mode !== 'pan' && this.exploring && !this.pinch) {
        this.moveFromPointer(event.clientX, event.clientY);
      }
      this.pointers.delete(event.pointerId);
      if (drag?.id === event.pointerId) this.drag = null;
      if (this.pointers.size < 2) {
        this.pinch = null;
        const remaining = this.pointers.entries().next().value;
        if (remaining && (wasPinching || !this.drag)) {
          const [id, p] = remaining;
          this.drag = { id, x: p.x, y: p.z, startX: p.x, startY: p.z, mode: 'orbit', moved: true };
        }
      }
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    el.addEventListener('lostpointercapture', end, { signal });
    el.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    el.addEventListener('keydown', event => {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoom(.85); }
      else if (event.key === '-') { event.preventDefault(); this.zoom(1 / .85); }
      else if (event.key === 'Home') { event.preventDefault(); this.resetView(); }
      else if (event.key === 'Escape' && this.exploring) { event.preventDefault(); this.setExploring(false); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); this.manual = true;
        if (event.shiftKey) { this.pan(event.key === 'ArrowLeft' ? 30 : -30, 0); return; }
        this.orbit.theta += event.key === 'ArrowLeft' ? .08 : -.08;
        this.applyOrbit();
      } else if (this.exploring && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault(); this.manual = true;
        if (event.shiftKey) this.pan(0, event.key === 'ArrowUp' ? 30 : -30);
        else { this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + (event.key === 'ArrowUp' ? -.08 : .08), .2, 1.25); this.applyOrbit(); }
      }
    }, { signal });
    // Deliberately no wheel listener: wheel and Ctrl+wheel stay with the browser.
  }

  private onResize() {
    const w = Math.max(1, this.config.container.clientWidth);
    const h = Math.max(1, this.config.container.clientHeight);
    this.camera.aspect = w / h;
    this.renderer.setSize(w, h);
    if (!this.manual) this.storyCamera(); else this.applyOrbit();
  }

  /** Idle-free rendering; short ball movements schedule only their own frames. */
  private draw() {
    if (!this.ready || this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(now => {
      this.frame = 0;
      this.advanceMotion(now);
      this.mask.flush();
      this.renderer.render(this.scene, this.camera);
      if (this.motion || this.refusal) this.draw();
    });
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
  }

  dispose() {
    this.disposed = true;
    this.events.abort(); this.resize.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.disposeObject(this.scene);
    this.mask.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
