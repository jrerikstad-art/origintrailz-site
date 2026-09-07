/**
 * Illustrative demo path inside the 1.75 x 1.25 km header export.
 * This is not a recorded GPS walk or a navigable route recommendation.
 */
export const SNAPSHOT_WORLD_BASE = '/snapshot/bergura-a-v1/world';

/** Plate A centre (EPSG:25832). */
export const ORIGIN_E = 319500;
export const ORIGIN_N = 6531500;

/**
 * Foreground loop, checked for ground and steep slopes against the actual GLB.
 * No water/road semantics are bundled: it remains an illustrative demo path.
 */
export const BERGURA_A_ROUTE = [
  { e: 319400, n: 6531100 },
  { e: 319550, n: 6531100 },
  { e: 319670, n: 6531150 },
  { e: 319720, n: 6531150 },
  { e: 319700, n: 6531200 },
  { e: 319580, n: 6531270 },
  { e: 319430, n: 6531250 },
  { e: 319280, n: 6531260 },
];
