/**
 * Site hero — scroll-driven walk.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Orbit controls are table stakes; every 3D landing page has them. The thing
 * only Origintrailz can show is FOG CLEARING AS YOU MOVE. So the page binds
 * scroll to a walk: the visitor scrolls, the player moves along a real recorded
 * route, and the world reveals behind them. The medium demonstrates the
 * mechanic instead of describing it.
 *
 * This module is pure — no Three.js, no DOM. All of it is testable off-browser,
 * which matters because the interesting failures here are in the maths, not the
 * rendering.
 *
 * FROZEN SNAPSHOT, NOT THE LIVE FACTORY
 * -------------------------------------
 * The site must point at a versioned snapshot of inspected tiles. Pointing a
 * public page at the live factory publishes every geometry bug the moment it
 * lands. A 2x2 km snapshot is 2.1 MB — smaller than the average hero video.
 */

export interface RoutePoint {
  /** EPSG:25832 easting. */
  e: number;
  /** EPSG:25832 northing. */
  n: number;
}

export interface RouteSample {
  e: number;
  n: number;
  /** Heading in radians, atan2(dE, dN) — 0 = north, clockwise. */
  heading: number;
  /** Metres travelled from the route start. */
  distanceM: number;
  /** 0..1 along the whole route. */
  t: number;
}

/**
 * A route with cumulative distances, so scroll maps to DISTANCE rather than to
 * point index. Mapping to index makes the walk speed up over dense point
 * clusters and crawl over sparse ones — the single most common way a
 * scroll-driven animation feels wrong.
 */
export class Route {
  readonly points: RoutePoint[];
  /** Cumulative distance at each point; cum[0] = 0. */
  readonly cum: number[];
  readonly lengthM: number;

  constructor(points: RoutePoint[]) {
    if (points.length < 2) throw new Error('route needs at least 2 points');
    this.points = points;
    this.cum = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      total += Math.hypot(b.e - a.e, b.n - a.n);
      this.cum.push(total);
    }
    this.lengthM = total;
  }

  /** Sample by fraction of total DISTANCE, not point index. */
  at(t: number): RouteSample {
    const clamped = Math.min(1, Math.max(0, t));
    const target = clamped * this.lengthM;

    // Binary search the segment containing `target`.
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= target) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo]!;
    const b = this.points[Math.min(lo + 1, this.points.length - 1)]!;
    const segLen = (this.cum[lo + 1] ?? this.lengthM) - this.cum[lo]!;
    const f = segLen > 0 ? (target - this.cum[lo]!) / segLen : 0;

    const e = a.e + (b.e - a.e) * f;
    const n = a.n + (b.n - a.n) * f;
    return {
      e,
      n,
      heading: headingBetween(a, b),
      distanceM: target,
      t: clamped,
    };
  }
}

/** Bearing from a to b: 0 = north, increasing clockwise. */
export function headingBetween(a: RoutePoint, b: RoutePoint): number {
  const dE = b.e - a.e;
  const dN = b.n - a.n;
  if (dE === 0 && dN === 0) return 0;
  return Math.atan2(dE, dN);
}

/** Shortest signed angular difference, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Damp a heading toward a target without wrapping the wrong way round.
 *
 * Naive lerping of angles takes the long way round whenever the route crosses
 * north — the camera spins 350 degrees to turn 10.
 */
export function dampHeading(current: number, target: number, alpha: number): number {
  return current + angleDelta(current, target) * Math.min(1, Math.max(0, alpha));
}

// ---------------------------------------------------------------------------
// Scroll mapping
// ---------------------------------------------------------------------------

export interface ScrollMapping {
  /** Page scroll position, px. */
  scrollY: number;
  /** Total scrollable height, px. */
  scrollHeight: number;
  /** Viewport height, px. */
  viewportH: number;
  /** Fraction of the page reserved as a still hero before the walk starts. */
  leadIn?: number;
  /** Fraction reserved at the end for the handover to free controls. */
  leadOut?: number;
}

/**
 * Map page scroll to route progress.
 *
 * `leadIn` keeps the first screen still so the hero reads as an image before it
 * starts moving; `leadOut` gives the walk somewhere to finish before the
 * handover, so the world is not still sliding when controls appear.
 */
export function scrollToProgress(m: ScrollMapping): number {
  const leadIn = m.leadIn ?? 0.1;
  const leadOut = m.leadOut ?? 0.15;
  const scrollable = Math.max(1, m.scrollHeight - m.viewportH);
  const raw = Math.min(1, Math.max(0, m.scrollY / scrollable));
  const span = Math.max(0.01, 1 - leadIn - leadOut);
  return Math.min(1, Math.max(0, (raw - leadIn) / span));
}

/**
 * Map scroll through `.scroll-panels` to route progress (0..1).
 *
 * Uses the panels block, not the whole document — so later marketing sections
 * do not keep advancing the walk.
 */
export function panelsScrollToProgress(opts: {
  scrollY: number;
  viewportH: number;
  panelsTop: number;
  panelsHeight: number;
  leadIn?: number;
  leadOut?: number;
}): number {
  const leadIn = opts.leadIn ?? 0.06;
  const leadOut = opts.leadOut ?? 0.12;
  const start = opts.panelsTop;
  const end = opts.panelsTop + opts.panelsHeight - opts.viewportH;
  const scrollable = Math.max(1, end - start);
  const raw = Math.min(1, Math.max(0, (opts.scrollY - start) / scrollable));
  const span = Math.max(0.01, 1 - leadIn - leadOut);
  return Math.min(1, Math.max(0, (raw - leadIn) / span));
}


/** True once the walk has finished and free controls should take over. */
export function handoverReached(progress: number, threshold = 0.995): boolean {
  return progress >= threshold;
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

export interface RevealConfig {
  /** Discovery cell size, metres. */
  cellM: number;
  /** Reveal radius around the path, metres. */
  radiusM: number;
}

export const DEFAULT_REVEAL: RevealConfig = { cellM: 10, radiusM: 90 };

/**
 * Cells revealed by walking a route up to `progress`.
 *
 * Reveals along the SEGMENT, not around sampled points. Point reveal leaves
 * gaps whenever the step exceeds the reveal diameter — which is exactly what a
 * fast scroll produces. Sweeping the segment costs nothing extra and is why the
 * trail cannot be scrubbed into a dotted line.
 *
 * Keys are ABSOLUTE EPSG:25832 cell indices. Never local coordinates: the same
 * lesson as the discovery store — a key that depends on an origin is a key that
 * cannot be reasoned about.
 */
export function revealedCells(
  route: Route,
  progress: number,
  cfg: RevealConfig = DEFAULT_REVEAL,
): Set<string> {
  const cells = new Set<string>();
  const end = Math.min(1, Math.max(0, progress)) * route.lengthM;
  if (end <= 0) return cells;

  const stepM = Math.max(cfg.cellM * 0.5, 2);
  const rCells = Math.ceil(cfg.radiusM / cfg.cellM);

  let walked = 0;
  while (walked <= end) {
    const s = route.at(walked / route.lengthM);
    const cx = Math.floor(s.e / cfg.cellM);
    const cy = Math.floor(s.n / cfg.cellM);
    for (let dy = -rCells; dy <= rCells; dy++) {
      for (let dx = -rCells; dx <= rCells; dx++) {
        if (dx * dx + dy * dy > rCells * rCells) continue;
        cells.add(`${cx + dx},${cy + dy}`);
      }
    }
    walked += stepM;
  }
  return cells;
}

/**
 * Incremental reveal — only the cells added between two progress values.
 *
 * The page re-renders on every scroll event. Recomputing the whole reveal each
 * time is O(route length) per frame and is how a scroll animation ends up at
 * 5 fps. This returns just the delta so the caller can shade the new cells.
 */
export function revealDelta(
  route: Route,
  fromProgress: number,
  toProgress: number,
  cfg: RevealConfig = DEFAULT_REVEAL,
): Set<string> {
  if (toProgress <= fromProgress) return new Set();
  const before = revealedCells(route, fromProgress, cfg);
  const after = revealedCells(route, toProgress, cfg);
  const delta = new Set<string>();
  for (const k of after) if (!before.has(k)) delta.add(k);
  return delta;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface CameraPose {
  /** Where the camera looks, in EN. */
  targetE: number;
  targetN: number;
  /** Metres behind the target along the reverse heading. */
  distanceM: number;
  /** Metres above the ground. */
  heightM: number;
  /** Camera heading, damped toward the route heading. */
  heading: number;
}

export interface CameraConfig {
  distanceM: number;
  heightM: number;
  /** Heading damping per update, 0..1. Lower is smoother and laggier. */
  headingAlpha: number;
  /** Metres ahead of the player the camera aims. */
  lookAheadM: number;
}

export const DEFAULT_CAMERA: CameraConfig = {
  distanceM: 420,
  heightM: 210,
  headingAlpha: 0.06,
  lookAheadM: 90,
};

/**
 * Camera pose for a route position.
 *
 * Aims slightly AHEAD of the player so the reveal happens in front of the
 * viewer rather than behind them. Revealing behind the camera is the difference
 * between "the world is opening up" and "something happened off-screen".
 */
export function cameraPoseFor(
  route: Route,
  progress: number,
  previousHeading: number,
  cfg: CameraConfig = DEFAULT_CAMERA,
): CameraPose {
  const here = route.at(progress);
  const aheadT = Math.min(1, progress + cfg.lookAheadM / route.lengthM);
  const ahead = route.at(aheadT);
  const heading = dampHeading(previousHeading, here.heading, cfg.headingAlpha);
  return {
    targetE: ahead.e,
    targetN: ahead.n,
    distanceM: cfg.distanceM,
    heightM: cfg.heightM,
    heading,
  };
}

// ---------------------------------------------------------------------------
// Tile need
// ---------------------------------------------------------------------------

/**
 * Terrain tile ids the walk needs between two progress values, plus a margin.
 *
 * Used to prefetch ahead of the scroll so a tile is resident before it is
 * looked at. The site has the luxury the app does not: the route is known in
 * advance, so nothing ever needs to load reactively.
 */
export function tilesForRange(
  route: Route,
  fromProgress: number,
  toProgress: number,
  tileSizeM = 250,
  marginM = 500,
): string[] {
  const ids = new Set<string>();
  const from = Math.max(0, fromProgress * route.lengthM - marginM);
  const to = Math.min(route.lengthM, toProgress * route.lengthM + marginM);
  const step = tileSizeM * 0.5;
  for (let d = from; d <= to; d += step) {
    const s = route.at(d / route.lengthM);
    const ix = Math.floor(s.e / tileSizeM);
    const iy = Math.floor(s.n / tileSizeM);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        ids.add(`terrain_${tileSizeM}m_${ix + dx}_${iy + dy}`);
      }
    }
  }
  return [...ids];
}

export interface PlateBBox {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

/**
 * Every terrain tile that covers the frozen plate bbox — the full snapshot,
 * not a route corridor stub.
 */
export function tilesForPlate(bbox: PlateBBox, tileSizeM = 250): string[] {
  const ix0 = Math.floor(bbox.minE / tileSizeM);
  const ix1 = Math.floor((bbox.maxE - 1e-9) / tileSizeM);
  const iy0 = Math.floor(bbox.minN / tileSizeM);
  const iy1 = Math.floor((bbox.maxN - 1e-9) / tileSizeM);
  const ids: string[] = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      ids.push(`terrain_${tileSizeM}m_${ix}_${iy}`);
    }
  }
  return ids;
}

/**
 * Every semantic tile id covering the plate (125 m cells for pack A).
 */
export function semanticTilesForPlate(bbox: PlateBBox, tileSizeM = 125): string[] {
  const ix0 = Math.floor(bbox.minE / tileSizeM);
  const ix1 = Math.floor((bbox.maxE - 1e-9) / tileSizeM);
  const iy0 = Math.floor(bbox.minN / tileSizeM);
  const iy1 = Math.floor((bbox.maxN - 1e-9) / tileSizeM);
  const ids: string[] = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      ids.push(`semantic_${tileSizeM}m_${ix}_${iy}`);
    }
  }
  return ids;
}
