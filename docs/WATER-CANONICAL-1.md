# WATER.CANONICAL.1

**Status:** blocks ball/hero polish until acceptance passes.

## Defect

Semantic water is stored as 125 m tile-clipped fragments. The website was meshing each fragment with its own shoreline elevation. That produced:

- rectangular vertical steps (up to ~1.8 m after 1.3× exaggeration);
- internal 125 m hairlines;
- terrain protrusions where DEM was not hydro-conditioned under water.

## Contract

1. Group fragments by `osmId` / body id.
2. **Polygon-union** outers (and re-parent holes) before mesh creation.
3. One elevation per body:
   - sea/fjord → shoreline min / datum;
   - lake/reservoir → shoreline **P10** (never absolute min; never sample tile-clip interiors as shore).
4. Hydro-condition terrain beds under the canonical plane.
5. Mesh water once per body; participate in atmospheric fog; sample the same discovery `DataTexture` as terrain.
6. No internal terrain skirts where a neighbour tile is loaded (website plate: skirts off).

## Acceptance

| Check | Target |
| --- | --- |
| Fragments → bodies (focus lakes) | `12 → 2` (or plate-wide: N fragments → M osm bodies) |
| Elevation delta within a body | `0` |
| Terrain protrusion above water | `< 0.05 m` |
| Post-hydro shared edge | `< 0.01 m` |
| Internal skirts with neighbours | `0` |
| Visible 125/250 m grid when rotating | none |
| Load/unload nearby tile | must not change existing body elevation/shoreline |

## Modules

| Path | Role |
| --- | --- |
| `hero/src/scroll/canonicalWater.ts` | Union + P10 + hydro bed |
| `hero/src/scroll/heroWorld.ts` | Scroll hero applies gate before meshing |
| `hero/src/scenePack.ts` | Contact-sheet / pack path |
| `hero/src/engine/world/terrainMesh.ts` | Perimeter-only skirts |
| `world-lab/src/world/hydroCondition.ts` | Fingerprint includes geometry hash |

```bash
npm run test:scroll-hero
```
