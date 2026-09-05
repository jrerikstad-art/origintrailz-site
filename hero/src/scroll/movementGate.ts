/**
 * Typed movement rejection for website free-explore and guided-route validation.
 * Same gate for both — no cliff-climbing shortcuts on the story path.
 */

export type RejectReason = 'WATER' | 'TOO_STEEP' | 'OUTSIDE_WORLD' | 'NO_GROUND';

export interface MovementOk {
  ok: true;
  e: number;
  n: number;
  heightM: number;
  slopeRad: number;
}

export interface MovementReject {
  ok: false;
  reason: RejectReason;
  caption: string;
}

export type MovementResult = MovementOk | MovementReject;

export const REJECT_CAPTIONS: Record<RejectReason, string> = {
  WATER: 'Water — pick dry ground.',
  TOO_STEEP: 'Too steep to explore.',
  OUTSIDE_WORLD: 'Outside this map.',
  NO_GROUND: 'Ground not loaded.',
};

export interface WorldBounds {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

export interface GateContext {
  bounds: WorldBounds;
  /** Absolute height metres, or null if tile missing. */
  sampleHeight: (e: number, n: number) => number | null;
  /** True if (e,n) is inside a water polygon. */
  isWater: (e: number, n: number) => boolean;
  /** Max absolute slope (radians). Default ~25°. */
  maxSlopeRad?: number;
  /** Offset used to estimate slope (metres). */
  slopeSampleM?: number;
}

export function evaluateDestination(e: number, n: number, ctx: GateContext): MovementResult {
  const { bounds } = ctx;
  if (e < bounds.minE || e > bounds.maxE || n < bounds.minN || n > bounds.maxN) {
    return { ok: false, reason: 'OUTSIDE_WORLD', caption: REJECT_CAPTIONS.OUTSIDE_WORLD };
  }
  const h = ctx.sampleHeight(e, n);
  if (h === null) {
    return { ok: false, reason: 'NO_GROUND', caption: REJECT_CAPTIONS.NO_GROUND };
  }
  if (ctx.isWater(e, n)) {
    return { ok: false, reason: 'WATER', caption: REJECT_CAPTIONS.WATER };
  }

  const step = ctx.slopeSampleM ?? 8;
  const maxSlope = ctx.maxSlopeRad ?? (25 * Math.PI) / 180;
  const hE = ctx.sampleHeight(e + step, n);
  const hN = ctx.sampleHeight(e, n + step);
  if (hE === null || hN === null) {
    return { ok: false, reason: 'NO_GROUND', caption: REJECT_CAPTIONS.NO_GROUND };
  }
  const slopeE = Math.atan2(Math.abs(hE - h), step);
  const slopeN = Math.atan2(Math.abs(hN - h), step);
  const slopeRad = Math.max(slopeE, slopeN);
  if (slopeRad > maxSlope) {
    return { ok: false, reason: 'TOO_STEEP', caption: REJECT_CAPTIONS.TOO_STEEP };
  }
  return { ok: true, e, n, heightM: h, slopeRad };
}

/**
 * Validate every sample along a guided route. Returns the first failure, or null.
 */
export function validateRoutePoints(
  points: { e: number; n: number }[],
  ctx: GateContext,
  sampleEveryM = 5,
): MovementReject | null {
  if (points.length < 2) {
    return { ok: false, reason: 'NO_GROUND', caption: 'Route too short.' };
  }
  let walked = 0;
  let prev = points[0]!;
  const first = evaluateDestination(prev.e, prev.n, ctx);
  if (!first.ok) return first;

  for (let i = 1; i < points.length; i++) {
    const cur = points[i]!;
    const seg = Math.hypot(cur.e - prev.e, cur.n - prev.n);
    const steps = Math.max(1, Math.ceil(seg / sampleEveryM));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const e = prev.e + (cur.e - prev.e) * t;
      const n = prev.n + (cur.n - prev.n) * t;
      const r = evaluateDestination(e, n, ctx);
      if (!r.ok) return r;
      walked += seg / steps;
    }
    prev = cur;
  }
  void walked;
  return null;
}
