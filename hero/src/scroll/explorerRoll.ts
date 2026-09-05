/**
 * Pure rolling orientation for the orange explorer ball.
 *
 * Contracts:
 * - axis = normalize(cross(up, direction))
 * - angle = signedHorizontalDistance / radius
 * - one accumulated quaternion, updated incrementally both directions
 * - large jumps are subdivided to avoid rotational drift
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

export function quatNearlyEqual(a: Quat, b: Quat, tol = 1e-6): boolean {
  // q and -q are the same orientation
  const d1 = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
  const d2 = Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
  return Math.min(d1, d2) <= tol;
}

/**
 * Horizontal travel in Three.js local space for this hero:
 * x = easting delta, z = -(northing delta).
 */
export function travelDirection(dE: number, dN: number): Vec3 | null {
  return normalize({ x: dE, y: 0, z: -dN });
}

export class RollingOrientation {
  quat: Quat = { ...IDENTITY_QUAT };
  readonly radiusM: number;
  /** Max horizontal metres per sub-step before subdivision. */
  readonly maxStepM: number;

  constructor(radiusM: number, maxStepM = 2) {
    this.radiusM = radiusM;
    this.maxStepM = Math.max(0.25, maxStepM);
  }

  reset() {
    this.quat = { ...IDENTITY_QUAT };
  }

  /**
   * Apply rolling for a horizontal move. Signed distance: positive when
   * travelling along (dE,dN), negative when reversed.
   */
  advanceEN(fromE: number, fromN: number, toE: number, toN: number) {
    const dE = toE - fromE;
    const dN = toN - fromN;
    const dist = Math.hypot(dE, dN);
    if (dist < 1e-9) return;

    const steps = Math.max(1, Math.ceil(dist / this.maxStepM));
    const stepE = dE / steps;
    const stepN = dN / steps;
    const stepDist = dist / steps;
    const dir = travelDirection(stepE, stepN);
    if (!dir) return;

    const up: Vec3 = { x: 0, y: 1, z: 0 };
    const axis = normalize(cross(up, dir));
    if (!axis) return;

    // Forward travel → positive roll; reverse of same vector is handled by
    // calling with swapped endpoints (signed via direction of step).
    const angle = stepDist / this.radiusM;
    for (let i = 0; i < steps; i++) {
      const dq = axisAngle(axis, angle);
      this.quat = quatMul(dq, this.quat);
    }
  }
}

/**
 * Acceptance helper: scrub forward/back/forward must match direct forward.
 */
export function scrubOrientationMatches(
  points: { e: number; n: number }[],
  radiusM: number,
): boolean {
  if (points.length < 2) return true;
  const direct = new RollingOrientation(radiusM);
  for (let i = 1; i < points.length; i++) {
    direct.advanceEN(points[i - 1]!.e, points[i - 1]!.n, points[i]!.e, points[i]!.n);
  }

  const scrub = new RollingOrientation(radiusM);
  // forward
  for (let i = 1; i < points.length; i++) {
    scrub.advanceEN(points[i - 1]!.e, points[i - 1]!.n, points[i]!.e, points[i]!.n);
  }
  // backward
  for (let i = points.length - 1; i > 0; i--) {
    scrub.advanceEN(points[i]!.e, points[i]!.n, points[i - 1]!.e, points[i - 1]!.n);
  }
  // forward again
  for (let i = 1; i < points.length; i++) {
    scrub.advanceEN(points[i - 1]!.e, points[i - 1]!.n, points[i]!.e, points[i]!.n);
  }

  return quatNearlyEqual(direct.quat, scrub.quat, 1e-5);
}
