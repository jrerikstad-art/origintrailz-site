/**
 * WATER.CANONICAL.1 acceptance — fragments → bodies, one elevation, union.
 * Run: npx tsx hero/src/scroll/canonicalWater.test.ts
 */
import {
  canonicalizeWaterFragments,
  conditionHeightM,
  ensureOuterCcw,
  maxElevationDeltaWithinBodies,
  ringSignedAreaEN,
  waterCanonStats,
  waterSurfaceAt,
  type WaterFragmentIn,
} from './canonicalWater';

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
  if (Math.abs(a - b) > tol) throw new Error(`${w}: ${a} vs ${b}`);
};

console.log('WATER.CANONICAL.1\n');

/** Two lakes, 6 fragments each (12 → 2), overlapping tile clips. */
function makeFragments(): WaterFragmentIn[] {
  const out: WaterFragmentIn[] = [];
  // Lake A centred ~ (0,0), clipped into 6 tiles
  const lakeA = [
    { e0: -40, n0: -30, e1: 0, n1: 0 },
    { e0: 0, n0: -30, e1: 40, n1: 0 },
    { e0: -40, n0: 0, e1: 0, n1: 30 },
    { e0: 0, n0: 0, e1: 40, n1: 30 },
    { e0: -20, n0: -15, e1: 20, n1: 15 },
    { e0: -10, n0: -10, e1: 10, n1: 10 },
  ];
  for (let i = 0; i < lakeA.length; i++) {
    const b = lakeA[i]!;
    out.push({
      bodyId: 'osm-lake-A',
      kind: 'lake',
      tileId: `tA${i}`,
      outer: [
        { e: b.e0, n: b.n0 },
        { e: b.e1, n: b.n0 },
        { e: b.e1, n: b.n1 },
        { e: b.e0, n: b.n1 },
      ],
    });
  }
  // Lake B farther east
  for (let i = 0; i < 6; i++) {
    const e0 = 200 + (i % 3) * 20;
    const n0 = (Math.floor(i / 3) - 1) * 20;
    out.push({
      bodyId: 'osm-lake-B',
      kind: 'lake',
      tileId: `tB${i}`,
      outer: [
        { e: e0, n: n0 },
        { e: e0 + 25, n: n0 },
        { e: e0 + 25, n: n0 + 25 },
        { e: e0, n: n0 + 25 },
      ],
    });
  }
  return out;
}

const flat = (_e: number, _n: number) => 12.5;

check('12 fragments → 2 bodies', () => {
  const frags = makeFragments();
  const bodies = canonicalizeWaterFragments(frags, flat);
  const s = waterCanonStats(frags, bodies);
  if (s.fragments !== 12) throw new Error(`fragments ${s.fragments}`);
  if (s.bodies !== 2) throw new Error(`bodies ${s.bodies} want 2`);
});

check('one elevation per body (delta 0)', () => {
  const bodies = canonicalizeWaterFragments(makeFragments(), flat);
  near(maxElevationDeltaWithinBodies(bodies), 0, 1e-9, 'delta');
  for (const b of bodies) near(b.elevationM, 12.5, 1e-6, b.id);
});

check('union removes need for 6 separate elevations', () => {
  // Before: each fragment would sample its own rim. After: one plane.
  const bodies = canonicalizeWaterFragments(makeFragments(), (e, n) => 10 + 0.01 * e);
  for (const b of bodies) {
    if (b.fragmentCount < 2) throw new Error(`${b.id} not merged`);
  }
});

check('hydro bed sits below water plane', () => {
  const bodies = canonicalizeWaterFragments(makeFragments(), flat);
  const bed = conditionHeightM(0, 0, 20, bodies, { bedDepthM: 1 });
  if (bed > bodies[0]!.elevationM - 0.5) throw new Error(`bed ${bed} not below water`);
});

check('outside water unchanged', () => {
  const bodies = canonicalizeWaterFragments(makeFragments(), flat);
  const h = conditionHeightM(5000, 5000, 44, bodies);
  near(h, 44, 1e-9, 'outside');
});

check('waterSurfaceAt hits lake interior', () => {
  const bodies = canonicalizeWaterFragments(makeFragments(), flat);
  const hit = waterSurfaceAt(0, 0, bodies);
  if (!hit || hit.bodyId !== 'osm-lake-A') throw new Error(JSON.stringify(hit));
});

check('outer rings are forced CCW for ShapeGeometry', () => {
  const cw = [
    { e: 0, n: 0 },
    { e: 0, n: 10 },
    { e: 10, n: 10 },
    { e: 10, n: 0 },
  ];
  const out = ensureOuterCcw(cw);
  if (ringSignedAreaEN(out) <= 0) throw new Error('expected CCW');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
