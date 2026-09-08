import * as THREE from 'three';
import { HEADER } from './headerTerrain';

/**
 * Website demo ONLY. The byte array is the sole reveal state and has no
 * persistence adapter. Never connect this to the app's localStorage/IndexedDB.
 * Progress moves the marker; it cannot clear already revealed mask texels.
 */
export class DiscoveryMask {
  readonly width = 351;
  readonly height = 251;
  readonly data = new Uint8Array(this.width * this.height);
  readonly texture = new THREE.DataTexture(this.data, this.width, this.height, THREE.RedFormat);
  private dirty = true;

  constructor() {
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.unpackAlignment = 1;
  }

  /** Swept capsule: even a large scroll jump makes a continuous reveal. */
  revealSegment(ax: number, az: number, bx: number, bz: number, radius = 165) {
    const stepX = (HEADER.maxX - HEADER.minX) / this.width;
    const stepZ = (HEADER.maxZ - HEADER.minZ) / this.height;
    const minCol = Math.max(0, Math.floor((Math.min(ax, bx) - radius - HEADER.minX) / stepX));
    const maxCol = Math.min(this.width - 1, Math.ceil((Math.max(ax, bx) + radius - HEADER.minX) / stepX));
    const minRow = Math.max(0, Math.floor((Math.min(az, bz) - radius - HEADER.minZ) / stepZ));
    const maxRow = Math.min(this.height - 1, Math.ceil((Math.max(az, bz) + radius - HEADER.minZ) / stepZ));
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const x = HEADER.minX + (col + .5) * stepX;
      const z = HEADER.minZ + (row + .5) * stepZ;
      const t = len2 > 0 ? THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
      const distance = Math.hypot(x - ax - t * dx, z - az - t * dz);
      const a = THREE.MathUtils.clamp((radius - distance) / 35, 0, 1);
      const value = Math.round(255 * a * a * (3 - 2 * a));
      const index = row * this.width + col;
      if (value > this.data[index]) { this.data[index] = value; this.dirty = true; }
    }
  }

  revealAll() { this.data.fill(255); this.dirty = true; }
  flush() {
    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }

  apply(material: THREE.Material) {
    material.onBeforeCompile = shader => {
      shader.uniforms.heroReveal = { value: this.texture };
      shader.uniforms.heroPaper = { value: new THREE.Color(0xece6da) };
      shader.vertexShader = 'varying vec2 vHeroXZ;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nvHeroXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = 'varying vec2 vHeroXZ;\nuniform sampler2D heroReveal;\nuniform vec3 heroPaper;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec2 heroUV = (vHeroXZ - vec2(${HEADER.minX.toFixed(1)}, ${HEADER.minZ.toFixed(1)})) / vec2(1750.0, 1250.0);
        float heroSeen = texture2D(heroReveal, heroUV).r;
        float heroRelief = 0.86 + 0.14 * abs(normal.z);
        outgoingLight = mix(heroPaper * heroRelief, outgoingLight, heroSeen);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => 'origintrailz-header-mask-v1';
    material.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}
