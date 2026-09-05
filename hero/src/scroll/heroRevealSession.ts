/**
 * HeroRevealSession — website discovery ONLY.
 *
 * ============================================================================
 * PERSISTENCE IS INTENTIONALLY FORBIDDEN.
 * ============================================================================
 * This session must NEVER grow a persistence adapter, localStorage /
 * sessionStorage writes, IndexedDB, account sync, or any app-style storage
 * keys (e.g. discovery stores used by the Origintrailz mobile shell).
 *
 * Website exploration is session-only. A full page reload is the only reset.
 * Revealed texels are write-once: hidden → revealed, never backwards.
 * Route progress must NOT own discovery — the ball paints the mask; scrolling
 * backwards moves the ball but does not restore fog.
 */

export type RevealCellKey = string;

export interface HeroRevealSessionConfig {
  /** Plate SW corner, EPSG:25832. */
  minE: number;
  minN: number;
  /** Metres per mask texel (typically 10). */
  cellM: number;
  width: number;
  height: number;
  /** Reveal brush radius in metres. */
  radiusM: number;
}

export class HeroRevealSession {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly cellM: number;
  readonly minE: number;
  readonly minN: number;
  readonly radiusM: number;
  /** Count of texels that have ever been painted revealed. */
  revealedCount = 0;

  constructor(cfg: HeroRevealSessionConfig) {
    this.width = cfg.width;
    this.height = cfg.height;
    this.cellM = cfg.cellM;
    this.minE = cfg.minE;
    this.minN = cfg.minN;
    this.radiusM = cfg.radiusM;
    this.data = new Uint8Array(cfg.width * cfg.height);
  }

  private indexFor(e: number, n: number): number | null {
    const mx = Math.floor((e - this.minE) / this.cellM);
    const my = Math.floor((n - this.minN) / this.cellM);
    if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) return null;
    return my * this.width + mx;
  }

  isRevealed(e: number, n: number): boolean {
    const i = this.indexFor(e, n);
    return i !== null && this.data[i]! > 0;
  }

  /**
   * Paint a disk around (e,n). Only upgrades 0 → 255. Returns true if any
   * texel changed (caller should mark the GPU texture dirty).
   */
  revealAround(e: number, n: number, radiusM = this.radiusM): boolean {
    const rCells = Math.ceil(radiusM / this.cellM);
    const cx = Math.floor((e - this.minE) / this.cellM);
    const cy = Math.floor((n - this.minN) / this.cellM);
    let touched = false;
    for (let dy = -rCells; dy <= rCells; dy++) {
      for (let dx = -rCells; dx <= rCells; dx++) {
        if (dx * dx + dy * dy > rCells * rCells) continue;
        const mx = cx + dx;
        const my = cy + dy;
        if (mx < 0 || my < 0 || mx >= this.width || my >= this.height) continue;
        const i = my * this.width + mx;
        if (this.data[i]! === 0) {
          this.data[i] = 255;
          this.revealedCount++;
          touched = true;
        }
      }
    }
    return touched;
  }
}
