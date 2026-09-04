/**
 * Slim water areas for the landing hero (no waterways / elevation registry).
 */
import * as THREE from 'three';
import type { Point2 } from './types';
import { getArtProfile } from './artProfile';

export interface HeroWaterBody {
  stableId: string;
  elevationM: number;
  renderPolygons: Point2[][];
  renderHoles: Point2[][][];
  kind?: string;
}

export function makeWaterAreas(
  bodies: HeroWaterBody[],
  exaggeration: number,
  profileId = 'origin-balanced',
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water-areas';
  const waterArt = getArtProfile(profileId).water;

  for (const body of bodies) {
    const y = body.elevationM * exaggeration + 0.08;
    const polys = body.renderPolygons;
    const holesList = body.renderHoles ?? polys.map(() => [] as Point2[][]);
    for (let pi = 0; pi < polys.length; pi++) {
      const poly = polys[pi]!;
      if (poly.length < 3) continue;
      const holes = holesList[pi] ?? [];
      const mat = new THREE.MeshStandardMaterial({
        color: waterArt.fill,
        roughness: waterArt.roughness,
        metalness: waterArt.metalness ?? 0.05,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: true,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const shape = new THREE.Shape();
      shape.moveTo(poly[0]![0], poly[0]![1]);
      for (let i = 1; i < poly.length; i++) {
        shape.lineTo(poly[i]![0], poly[i]![1]);
      }
      shape.closePath();
      for (const hole of holes) {
        if (hole.length < 3) continue;
        const path = new THREE.Path();
        path.moveTo(hole[0]![0], hole[0]![1]);
        for (let i = 1; i < hole.length; i++) {
          path.lineTo(hole[i]![0], hole[i]![1]);
        }
        path.closePath();
        shape.holes.push(path);
      }
      const geom = new THREE.ShapeGeometry(shape);
      const pos = geom.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getY(i);
        pos.setXYZ(i, x, y, z);
      }
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = `water-${body.stableId}`;
      mesh.renderOrder = 4;
      group.add(mesh);
    }
  }
  return group;
}
