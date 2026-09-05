# WEB.1 Scroll hero — walk the fog

**Status:** landing interaction is **scroll-driven reveal**, not pointer wipe / orbit-first.

## Design (from scroll-walk package)

- Scroll maps to **distance along a route** (not point index).
- Fog reveal is **monotonic** and sweeps **segments** (no dotted trail on fast flick).
- Heading damping never takes the long way across north.
- Free **orbit is the reward** after handover.
- Renderer is **separate** from the app engine: preload only, no streaming, no `?? 2` / nearest-tile height fallback.
- **Terrain + reveal only** until G.T. — no roads/buildings (open FLAT_Y / water bugs).
- `worldBase` points at a **frozen snapshot**, never the live factory.

## Site wiring

| Piece | Path |
| --- | --- |
| Pure logic | [`hero/src/scroll/routeWalk.ts`](../hero/src/scroll/routeWalk.ts) |
| Tests (16/16) | `npm run test:scroll-hero` |
| Three.js world | [`hero/src/scroll/heroWorld.ts`](../hero/src/scroll/heroWorld.ts) |
| Boot | [`hero/src/scroll/main.ts`](../hero/src/scroll/main.ts) |
| Route + snapshot URL | [`hero/src/scroll/routeConfig.ts`](../hero/src/scroll/routeConfig.ts) |
| Frozen tiles | `hero/public/snapshot/bergura-a-v1/world/terrain/` (pack A terrain) |

## Needs from product

1. **Keep freezing** inspected tiles into `snapshot/bergura-a-v1/` (or bump version) when the plate changes.
2. **Replace** `BERGURA_A_ROUTE` with a real app-exported walk when available — current polyline sells the plate geography, not a personal track.
3. After G.T., add roads/buildings/water with the same strict `sampleHeight → null` contract.

## Supersedes

Canvas `#fog` pointer wipe (`FOG.VISUAL.TRUTH`) on the landing page. Paper fog is now mesh vertex colour along the walked cells. Orbit-first marketing hero is retired.
