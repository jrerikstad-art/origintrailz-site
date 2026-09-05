/**
 * Frozen pack A (Bergura lake + shore) — route + snapshot URLs for the scroll hero.
 * Route is a hand-authored corridor through the inspected 2×3 km plate (not live GPS).
 * Replace with an app-exported GPX walk when available.
 */
export const SNAPSHOT_WORLD_BASE = '/snapshot/bergura-a-v1/world';

/** Plate A centre (EPSG:25832). */
export const ORIGIN_E = 319500;
export const ORIGIN_N = 6531500;

/**
 * ~2.1 km walk: SW shore → lake edge → settlement fringe → north ridge approach.
 * Stays inside bbox E 318500–320500, N 6530000–6533000.
 */
export const BERGURA_A_ROUTE = [
  { e: 318750, n: 6530600 },
  { e: 319050, n: 6530850 },
  { e: 319350, n: 6531050 },
  { e: 319550, n: 6531250 },
  { e: 319750, n: 6531450 },
  { e: 319950, n: 6531650 },
  { e: 320100, n: 6531900 },
  { e: 320200, n: 6532200 },
  { e: 320150, n: 6532500 },
];
