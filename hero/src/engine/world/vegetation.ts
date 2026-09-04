/** Hero stub — only point-in-polygon (full vegetation scatter omitted). */
import type { Point2 } from './types';

export function pointInPoly(p: Point2, poly: Point2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-15) + xi) {
      c = !c;
    }
  }
  return c;
}
