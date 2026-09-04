/**
 * In-memory discovery for the landing hero — no IndexedDB.
 * Cell size matches engine DISCOVERY_CELL_M (10 m).
 */
export const DISCOVERY_CELL_M = 10;

export class HeroDiscovery {
  private readonly cells = new Set<string>();
  private revision = 0;

  get rev() {
    return this.revision;
  }

  clear() {
    this.cells.clear();
    this.revision++;
  }

  revealAt(worldX: number, worldZ: number, radiusM: number) {
    const r = Math.max(1, radiusM);
    const r2 = r * r;
    const c0 = Math.floor((worldX - r) / DISCOVERY_CELL_M);
    const c1 = Math.floor((worldX + r) / DISCOVERY_CELL_M);
    const r0 = Math.floor((worldZ - r) / DISCOVERY_CELL_M);
    const r1 = Math.floor((worldZ + r) / DISCOVERY_CELL_M);
    let added = 0;
    for (let ix = c0; ix <= c1; ix++) {
      for (let iz = r0; iz <= r1; iz++) {
        const cx = (ix + 0.5) * DISCOVERY_CELL_M;
        const cz = (iz + 0.5) * DISCOVERY_CELL_M;
        if ((cx - worldX) ** 2 + (cz - worldZ) ** 2 > r2) continue;
        const key = `${ix}:${iz}`;
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        added++;
      }
    }
    if (added) this.revision++;
    return added;
  }

  /** Soft 0..1 discovery for parchment lerp. */
  sample(worldX: number, worldZ: number, featherM = 14): number {
    if (this.cells.size === 0) return 0;
    const ix = Math.floor(worldX / DISCOVERY_CELL_M);
    const iz = Math.floor(worldZ / DISCOVERY_CELL_M);
    if (this.cells.has(`${ix}:${iz}`)) return 1;
    // Cheap neighbourhood feather
    const steps = Math.max(1, Math.ceil(featherM / DISCOVERY_CELL_M));
    let best = Infinity;
    for (let dx = -steps; dx <= steps; dx++) {
      for (let dz = -steps; dz <= steps; dz++) {
        if (!this.cells.has(`${ix + dx}:${iz + dz}`)) continue;
        const cx = (ix + dx + 0.5) * DISCOVERY_CELL_M;
        const cz = (iz + dz + 0.5) * DISCOVERY_CELL_M;
        best = Math.min(best, Math.hypot(worldX - cx, worldZ - cz));
      }
    }
    if (!Number.isFinite(best)) return 0;
    if (best >= featherM) return 0;
    const t = 1 - best / featherM;
    return t * t * (3 - 2 * t);
  }
}
