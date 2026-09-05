/**
 * Explorer contracts: rolling scrub, monotonic reveal session, movement gate.
 * Run: npx tsx hero/src/scroll/explorerContracts.test.ts
 */
import { RollingOrientation, scrubOrientationMatches, quatNearlyEqual } from './explorerRoll';
import { HeroRevealSession } from './heroRevealSession';
import { evaluateDestination, REJECT_CAPTIONS } from './movementGate';

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
const eq = (a: unknown, b: unknown, w: string) => {
  if (a !== b) throw new Error(`${w}: got ${a}, want ${b}`);
};

console.log('Explorer contracts\n');

check('scrub forward/back/forward restores orientation', () => {
  const pts = [
    { e: 0, n: 0 },
    { e: 40, n: 0 },
    { e: 40, n: 90 },
    { e: 10, n: 120 },
  ];
  if (!scrubOrientationMatches(pts, 7)) throw new Error('orientation drift after scrub');
});

check('large jump subdivision matches fine steps', () => {
  const a = new RollingOrientation(7, 2);
  a.advanceEN(0, 0, 100, 0);
  const b = new RollingOrientation(7, 2);
  for (let i = 0; i < 50; i++) b.advanceEN(i * 2, 0, (i + 1) * 2, 0);
  if (!quatNearlyEqual(a.quat, b.quat, 1e-5)) throw new Error('subdivision drift');
});

check('reveal session is write-once (monotonic)', () => {
  const s = new HeroRevealSession({
    minE: 0,
    minN: 0,
    cellM: 10,
    width: 20,
    height: 20,
    radiusM: 20,
  });
  s.revealAround(50, 50);
  const n1 = s.revealedCount;
  s.revealAround(50, 50);
  eq(s.revealedCount, n1, 'second paint adds nothing');
  // "Scroll back" does not exist as an API — mask only grows.
  s.revealAround(80, 50);
  if (s.revealedCount <= n1) throw new Error('expected growth');
});

check('session has no persistence surface', () => {
  const proto = Object.getOwnPropertyNames(HeroRevealSession.prototype);
  for (const name of proto) {
    if (/persist|storage|indexed|sync|save|load|local/i.test(name) && name !== 'constructor') {
      throw new Error(`forbidden method ${name}`);
    }
  }
});

check('movement gate returns typed reasons', () => {
  const ctx = {
    bounds: { minE: 0, maxE: 100, minN: 0, maxN: 100 },
    sampleHeight: (e: number, n: number) => {
      if (e < 0 || e > 100 || n < 0 || n > 100) return null;
      return n * 0.5; // steep along N
    },
    isWater: (e: number, n: number) => e > 70 && e < 80 && n > 40 && n < 60,
  };
  const out = evaluateDestination(150, 50, ctx);
  eq(out.ok, false, 'outside');
  if (out.ok) throw new Error('expected reject');
  eq(out.reason, 'OUTSIDE_WORLD', 'reason');
  eq(out.caption, REJECT_CAPTIONS.OUTSIDE_WORLD, 'caption');

  const water = evaluateDestination(75, 50, {
    ...ctx,
    sampleHeight: () => 10,
  });
  if (water.ok || water.reason !== 'WATER') throw new Error('expected WATER');

  const steep = evaluateDestination(10, 50, ctx);
  if (steep.ok || steep.reason !== 'TOO_STEEP') throw new Error(`expected TOO_STEEP got ${JSON.stringify(steep)}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
