# WEB.1 Gate 1 — Hero acceptance matrix

**Preview:** https://origintrailz-site.vercel.app/  
**Status:** Gate 1 still **open**. Landing interaction is **scroll-driven walk + monotonic fog** ([WEB1-SCROLL-HERO.md](./WEB1-SCROLL-HERO.md)). Chosen region **A**. Roads/buildings deferred until G.T.

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| S0 | routeWalk pure logic | 16/16 | pass (`npm run test:scroll-hero`) |
| S1 | Scroll walk | Progress by distance; fog opens along route | wired in source |
| S2 | Fast flick | Continuous reveal, no dotted gaps | pinned by tests |
| S3 | Scroll back | Reveal monotonic (no un-fog) | pinned by tests |
| S4 | Handover | Free orbit after walk | wired in source |
| S5 | Snapshot only | `worldBase` → frozen bergura-a-v1, not live factory | wired |
| S6 | Strict heights | `sampleHeight` null; reject flat-vs-relief tiles | in heroWorld |
| S7 | No roads/buildings yet | Terrain + reveal only | intentional until G.T. |
| H2 | Chosen plate A | Bergura lake + shore ~2×3 km | chosen + snapshot staged |
| 11 | No €3.99 / no fake tile counter | Honest cells-revealed from renderer stats | done |

## Deferred

- Real GPX/exported route replacing hand polyline
- Same-camera Lab comparison + GLB/meshopt
- Roads/buildings/water after G.T. (strict sampler)
- Gates 2–7
