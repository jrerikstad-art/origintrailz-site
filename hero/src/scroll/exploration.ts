/** Geometry checks for an illustrative terrain demo, not route navigation.
 * The header has no water/road semantics; do not claim a walkable land route.
 */
export interface DemoGround { sample(x: number, z: number): number | null }
export type GroundPoint = { x: number; z: number };
export function checkGroundPath(ground: DemoGround, from: GroundPoint, to: GroundPoint): 'ok' | 'outside' | 'steep' {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return 'outside';
  if (ground.sample(from.x, from.z) === null || ground.sample(to.x, to.z) === null) return 'outside';
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 2));
  let previous: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps;
    const z = from.z + (to.z - from.z) * i / steps;
    const y = ground.sample(x, z);
    if (y === null || !Number.isFinite(y)) return 'outside';
    // Heights were baked at 1.2x. Reject a >45 degree source-ground slope.
    if (previous !== null && distance > .01 && Math.abs(y - previous) / (distance / steps) > 1.2) return 'steep';
    const west = ground.sample(x - 1, z), east = ground.sample(x + 1, z);
    const north = ground.sample(x, z - 1), south = ground.sample(x, z + 1);
    // Probe the midpoint between path samples as well as a small footprint.
    if (west === null || east === null || north === null || south === null ||
        ![west, east, north, south].every(Number.isFinite)) return 'outside';
    if (Math.hypot((east - west) / 2, (south - north) / 2) > 1.2) return 'steep';
    previous = y;
  }
  return 'ok';
}
