/**
 * Quantized heightfield sampler — no Three.js dependency.
 *
 * Local frame (Gate B Bergura):
 *   +X = east, +Z = south, Y = up (metres)
 *   origin = chunk.origin easting/northing in EPSG:25832
 *
 * Grid layout:
 *   row 0 = north edge (localZ = -half)
 *   col 0 = west edge (localX = -half)
 */
import type { TerrainSpec } from './types';

export class Heightfield {
  readonly grid: number;
  readonly sizeMeters: number;
  readonly minM: number;
  readonly maxM: number;
  /**
   * True when the payload decoded to a constant plane despite metadata
   * promising relief — i.e. terrain.bin arrived correctly sized but empty
   * (zero-filled fetch, detached IndexedDB buffer, WebView binary mangling).
   * The mesh still builds; the renderer surfaces this so a flat world is
   * reported rather than silently drawn.
   */
  readonly degenerate: boolean;
  private readonly values: Float32Array;

  constructor(sizeMeters: number, spec: TerrainSpec, quantized: Uint16Array) {
    if (spec.encoding !== 'uint16') {
      throw new Error(`Unsupported terrain encoding: ${spec.encoding}`);
    }
    const n = spec.grid;
    if (quantized.length !== n * n) {
      throw new Error(`terrain.bin length ${quantized.length} != grid^2 ${n * n}`);
    }
    this.grid = n;
    this.sizeMeters = sizeMeters;
    this.minM = spec.minM;
    this.maxM = spec.maxM;
    const span = spec.maxM - spec.minM || 1;
    this.values = new Float32Array(n * n);
    let qMin = 65535;
    let qMax = 0;
    for (let i = 0; i < quantized.length; i++) {
      const q = quantized[i]!;
      if (q < qMin) qMin = q;
      if (q > qMax) qMax = q;
      this.values[i] = spec.minM + (q / 65535) * span;
    }
    // Metadata claims relief but every sample is identical → payload is empty.
    this.degenerate = qMax === qMin && spec.maxM - spec.minM > 0.5;
  }

  /** Grid sample (col 0 = west, row 0 = north). */
  at(col: number, row: number): number {
    return this.values[row * this.grid + col]!;
  }

  /** Real elevation in metres (no exaggeration). Bilinear — debug/legacy only. */
  sample(localX: number, localZ: number): number {
    const half = this.sizeMeters / 2;
    const n = this.grid;
    const u = ((localX + half) / this.sizeMeters) * (n - 1);
    const v = ((localZ + half) / this.sizeMeters) * (n - 1);
    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, n - 1);
    const z1 = Math.min(z0 + 1, n - 1);
    const tx = u - x0;
    const tz = v - z0;
    const c00 = this.at(clampIndex(x0, n), clampIndex(z0, n));
    const c10 = this.at(clampIndex(x1, n), clampIndex(z0, n));
    const c01 = this.at(clampIndex(x0, n), clampIndex(z1, n));
    const c11 = this.at(clampIndex(x1, n), clampIndex(z1, n));
    const a = c00 * (1 - tx) + c10 * tx;
    const b = c01 * (1 - tx) + c11 * tx;
    return a * (1 - tz) + b * tz;
  }

  /**
   * Elevation on the rendered terrain mesh (same triangulation as
   * `makeHeightfieldTerrain`: diagonal SW–NE). Roads/buildings must use this,
   * not bilinear `sample()`, or they chord through triangle faces.
   */
  sampleSurface(localX: number, localZ: number): number {
    const half = this.sizeMeters / 2;
    const n = this.grid;
    const x = clampRange(localX, -half, half);
    const z = clampRange(localZ, -half, half);
    const u = ((x + half) / this.sizeMeters) * (n - 1);
    const v = ((z + half) / this.sizeMeters) * (n - 1);
    const col = Math.min(n - 2, Math.max(0, Math.floor(u)));
    const row = Math.min(n - 2, Math.max(0, Math.floor(v)));
    const fu = clampRange(u - col, 0, 1);
    const fv = clampRange(v - row, 0, 1);
    const ha = this.at(col, row);
    const hb = this.at(col + 1, row);
    const hc = this.at(col, row + 1);
    const hd = this.at(col + 1, row + 1);
    // Mesh index: (a,c,b) and (b,c,d) → diagonal from SW(c) to NE(b).
    if (fu + fv <= 1) {
      return (1 - fu - fv) * ha + fu * hb + fv * hc;
    }
    return (1 - fv) * hb + (1 - fu) * hc + (fu + fv - 1) * hd;
  }
}

function clampIndex(i: number, n: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}

function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function heightfieldFromBuffer(
  sizeMeters: number,
  spec: TerrainSpec,
  buf: ArrayBuffer,
): Heightfield {
  return new Heightfield(sizeMeters, spec, new Uint16Array(buf));
}

export async function loadHeightfield(
  baseUrl: string,
  sizeMeters: number,
  spec: TerrainSpec,
): Promise<Heightfield> {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  // Resolve against the page origin so relative chunk paths work in the browser.
  const url = new URL(spec.uri, new URL(root, globalThis.location.href)).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return heightfieldFromBuffer(sizeMeters, spec, buf);
}
