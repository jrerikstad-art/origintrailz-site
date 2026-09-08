/**
 * Site hero — scroll-driven walk tests.
 *
 * The interesting failures on a scroll-driven page are all in the maths:
 * distance-vs-index sampling, angle wrapping across north, reveal gaps at fast
 * scroll. All testable without a browser.
 *
 * Run: npx tsx routeWalk.test.ts
 */
import {
  Route,
  angleDelta,
  cameraPoseFor,
  dampHeading,
  handoverReached,
  headingBetween,
  revealDelta,
  revealedCells,
  scrollToProgress,
  tilesForRange,
} from './routeWalk';

let pass = 0;
let fail = 0;
const check = (n: string, f: () => void) => {
  try {
    f();
    pass++;
    console.log(`  ok   ${n}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${n}: ${(e as Error).message}`);
  }
};
const near = (a: number, b: number, tol: number, w: string) => {
  if (Math.abs(a - b) > tol) throw new Error(`${w}: ${a} vs ${b} (tol ${tol})`);
};
const eq = (a: unknown, b: unknown, w: string) => {
  if (a !== b) throw new Error(`${w}: got ${a}, want ${b}`);
};

console.log('Site hero — scroll-driven walk\n');

// A Bergura-ish route: 400 m east, then 300 m north.
const BERG = { e: 319543, n: 6531135 };
const route = new Route([
  { e: BERG.e, n: BERG.n },
  { e: BERG.e + 400, n: BERG.n },
  { e: BERG.e + 400, n: BERG.n + 300 },
]);

check('route length is the sum of its segments', () => {
  near(route.lengthM, 700, 0.001, 'length');
});

check('THE TRAP: sampling is by distance, not point index', () => {
  // Dense points at the start, sparse after. Index sampling would race through
  // the dense half and crawl through the sparse one.
  const uneven = new Route([
    { e: 0, n: 0 },
    { e: 1, n: 0 },
    { e: 2, n: 0 },
    { e: 3, n: 0 },
    { e: 1003, n: 0 },
  ]);
  const mid = uneven.at(0.5);
  near(mid.distanceM, uneven.lengthM / 2, 0.001, 'half the DISTANCE');
  // Index-based sampling would have put t=0.5 at the 3rd of 5 points, i.e. e=2.
  if (mid.e < 100) throw new Error(`index-sampled: e=${mid.e}`);
  console.log(`       (distance-sampled e=${mid.e.toFixed(0)}, index would give e=2)`);
});

check('endpoints are exact', () => {
  near(route.at(0).e, BERG.e, 1e-6, 'start e');
  const end = route.at(1);
  near(end.e, BERG.e + 400, 1e-6, 'end e');
  near(end.n, BERG.n + 300, 1e-6, 'end n');
});

check('progress is clamped outside 0..1', () => {
  near(route.at(-5).distanceM, 0, 1e-9, 'below');
  near(route.at(9).distanceM, route.lengthM, 1e-9, 'above');
});

check('heading: 0 is north, +PI/2 is east', () => {
  near(headingBetween({ e: 0, n: 0 }, { e: 0, n: 10 }), 0, 1e-9, 'north');
  near(headingBetween({ e: 0, n: 0 }, { e: 10, n: 0 }), Math.PI / 2, 1e-9, 'east');
  near(headingBetween({ e: 0, n: 0 }, { e: 0, n: -10 }), Math.PI, 1e-9, 'south');
});

check('THE TRAP: angle damping does not wrap the long way round north', () => {
  // 350 deg -> 10 deg is a 20 deg turn, not a 340 deg spin.
  const from = (350 * Math.PI) / 180;
  const to = (10 * Math.PI) / 180;
  const d = angleDelta(from, to);
  near((d * 180) / Math.PI, 20, 1e-6, 'delta');
  const stepped = dampHeading(from, to, 0.5);
  const moved = Math.abs((angleDelta(from, stepped) * 180) / Math.PI);
  near(moved, 10, 1e-6, 'half of a 20 deg turn');
});

check('scroll mapping honours lead-in and lead-out', () => {
  const m = { scrollHeight: 5000, viewportH: 1000, leadIn: 0.1, leadOut: 0.15 };
  eq(scrollToProgress({ ...m, scrollY: 0 }), 0, 'top is still');
  eq(scrollToProgress({ ...m, scrollY: 4000 * 0.1 }), 0, 'walk starts after lead-in');
  eq(scrollToProgress({ ...m, scrollY: 4000 * 0.85 }), 1, 'walk ends before lead-out');
  eq(scrollToProgress({ ...m, scrollY: 4000 }), 1, 'bottom is complete');
  const half = scrollToProgress({ ...m, scrollY: 4000 * 0.475 });
  near(half, 0.5, 0.01, 'midpoint');
});

check('handover fires only at the end', () => {
  eq(handoverReached(0.9), false, 'mid-walk');
  eq(handoverReached(1), true, 'complete');
});

check('reveal has no gaps at coarse scroll steps', () => {
  // A fast flick jumps progress in one event. Segment sweep must still be solid.
  const coarse = revealedCells(route, 1);
  // Every 5 m along the route must be inside a revealed cell.
  for (let d = 0; d <= route.lengthM; d += 5) {
    const s = route.at(d / route.lengthM);
    const k = `${Math.floor(s.e / 10)},${Math.floor(s.n / 10)}`;
    if (!coarse.has(k)) throw new Error(`gap at ${d} m (${k})`);
  }
  console.log(`       (${coarse.size} cells, no gaps over ${route.lengthM} m)`);
});

check('reveal is monotonic — scrolling back never un-reveals', () => {
  const a = revealedCells(route, 0.4);
  const b = revealedCells(route, 0.8);
  for (const k of a) if (!b.has(k)) throw new Error(`cell ${k} lost between 0.4 and 0.8`);
  if (b.size <= a.size) throw new Error('no growth');
});

check('revealDelta returns only new cells', () => {
  const d = revealDelta(route, 0.4, 0.5);
  const before = revealedCells(route, 0.4);
  for (const k of d) if (before.has(k)) throw new Error(`${k} was already revealed`);
  if (d.size === 0) throw new Error('expected new cells');
  eq(revealDelta(route, 0.8, 0.4).size, 0, 'backwards yields nothing');
});

check('camera aims ahead of the player, not at it', () => {
  const pose = cameraPoseFor(route, 0.2, 0);
  const here = route.at(0.2);
  const ahead = Math.hypot(pose.targetE - here.e, pose.targetN - here.n);
  if (ahead < 20) throw new Error(`camera target only ${ahead.toFixed(0)} m ahead`);
});

check('camera heading damps rather than snapping', () => {
  // The route turns 90 deg at its corner. One update must not complete the turn.
  const atCorner = cameraPoseFor(route, 0.58, Math.PI / 2);
  const turned = Math.abs((angleDelta(Math.PI / 2, atCorner.heading) * 180) / Math.PI);
  if (turned > 20) throw new Error(`snapped ${turned.toFixed(0)} deg in one update`);
});

check('tile prefetch covers the corridor with margin', () => {
  const ids = tilesForRange(route, 0, 0.1);
  if (ids.length < 3) throw new Error(`only ${ids.length} tiles for the first 10%`);
  const startTile = `terrain_250m_${Math.floor(BERG.e / 250)}_${Math.floor(BERG.n / 250)}`;
  if (!ids.includes(startTile)) throw new Error(`start tile ${startTile} not prefetched`);
  const all = tilesForRange(route, 0, 1);
  console.log(`       (${all.length} tiles for the whole 700 m route)`);
});

check('a degenerate route is rejected, not silently accepted', () => {
  try {
    new Route([{ e: 0, n: 0 }]);
    throw new Error('expected a throw');
  } catch (e) {
    if (!(e as Error).message.includes('at least 2')) throw e;
  }
});

check('a zero-length route does not divide by zero', () => {
  const still = new Route([{ e: 5, n: 5 }, { e: 5, n: 5 }]);
  const s = still.at(0.5);
  near(s.e, 5, 1e-9, 'e');
  if (!Number.isFinite(s.heading)) throw new Error('heading not finite');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
