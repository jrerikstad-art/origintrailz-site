import * as THREE from 'three';

/** Coordinates and scale are baked into the GLB. Never exaggerate it twice. */
export const HEADER = {
  url: '/hero-assets/bergura-header-1750x1250.glb',
  originE: 319500, originN: 6531500,
  minX: -875, maxX: 875, minZ: -625, maxZ: 625,
  step: 3.90625, cols: 449, rows: 321,
  bytes: 5782344, triangles: 286720, meshes: 4,
} as const;

/** Reuse the exact exported vertex heights, including the welded boundaries. */
export class HeaderGround {
  readonly heights = new Float32Array(HEADER.cols * HEADER.rows).fill(NaN);
  readonly meshes: THREE.Mesh[] = [];
  triangles = 0;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      this.meshes.push(object);
      const positions = object.geometry.getAttribute('position');
      this.triangles += (object.geometry.index?.count ?? positions.count) / 3;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        const col = Math.round((p.x - HEADER.minX) / HEADER.step);
        const row = Math.round((p.z - HEADER.minZ) / HEADER.step);
        if (col < 0 || col >= HEADER.cols || row < 0 || row >= HEADER.rows ||
            !Number.isFinite(p.y) ||
            Math.abs(p.x - (HEADER.minX + col * HEADER.step)) > .001 ||
            Math.abs(p.z - (HEADER.minZ + row * HEADER.step)) > .001) {
          throw new Error('Header GLB does not match its declared grid');
        }
        const index = row * HEADER.cols + col;
        if (Number.isFinite(this.heights[index]) && Math.abs(this.heights[index] - p.y) > .001) {
          throw new Error('Header GLB has a split terrain boundary');
        }
        this.heights[index] = p.y;
      }
    });
    if (this.meshes.length !== HEADER.meshes || this.triangles !== HEADER.triangles ||
        this.heights.some(y => !Number.isFinite(y))) {
      throw new Error('Header GLB is incomplete');
    }
  }

  /** Interpolate the same diagonal as the exported triangles, not nearest DEM. */
  sample(x: number, z: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) ||
        x < HEADER.minX || x > HEADER.maxX || z < HEADER.minZ || z > HEADER.maxZ) return null;
    const gx = (x - HEADER.minX) / HEADER.step;
    const gz = (z - HEADER.minZ) / HEADER.step;
    const col = Math.min(HEADER.cols - 2, Math.floor(gx));
    const row = Math.min(HEADER.rows - 2, Math.floor(gz));
    const u = gx - col, v = gz - row;
    const i = row * HEADER.cols + col;
    const a = this.heights[i], b = this.heights[i + 1];
    const c = this.heights[i + HEADER.cols], d = this.heights[i + HEADER.cols + 1];
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) :
      d + (1 - u) * (c - d) + (1 - v) * (b - d);
  }

  required(x: number, z: number): number {
    const y = this.sample(x, z);
    if (y === null) throw new Error(`No header ground at ${x}, ${z}`);
    return y;
  }
}
