# WEB.1 Gate 1 — Hero acceptance matrix

**Preview:** https://origintrailz-site.vercel.app/  
**Status:** Gate 1 still **open** — FOG.VISUAL.TRUTH must pass on the *rendered* page (code alone is not acceptance).

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| F1 | FOG.VISUAL.TRUTH idle | Paper fog covers landscape; centre α ≥ 0.9 | repair in source — verify after deploy |
| F2 | Pointer wipe | Continuous uncover of landscape | repair in source — verify after deploy |
| F3 | Hard refresh | Marketing fog restored | repair in source — verify after deploy |
| F4 | Sole fog owner | Website `#fog` only; engine discovery off | done in source (`HERO_CLEAN`) |
| F5 | WebGL fail | Wipe reveals SVG poster, not empty beige | done in source (`__otzHeroFail` → SVG opacity) |
| 1 | Idle 60s | No ambient reveal / no snake | pending manual |
| 2 | Fast corner sweep | Continuous soft wipe, no separated drops | pending manual |
| 3 | Reveal then resize | Coordinates stay aligned; one fog layer | pending manual |
| 4 | Inspect 3D | Clean fully-revealed terrain under paper fog | pending manual |
| 5 | Network after load | Pointer creates **zero** tile/bake requests | pending manual |
| 6 | HiDPI | Brush aligns with cursor | pending manual |
| 7 | Touch / mouse / pen | Continuous stroke | pending manual |
| 8 | Fidelity vs World Lab | Same landscape (not cone diorama) | partial — real tiles, cones removed; GLB deferred |
| 9 | Poster → complete scene | Atomic reveal, no jigsaw | deferred (A5.7) |
| 10 | Hero manifest | Real tile IDs + pipeline versions | `hero/public/hero-scene-manifest.json` |
| 11 | No €3.99 / no fake tile counter | Copy + UI clean | done in source |

## FOG.VISUAL.TRUTH stacking

See [`WEB1-FOG-VISUAL-TRUTH.md`](./WEB1-FOG-VISUAL-TRUTH.md).

| Layer | z-index |
| --- | --- |
| `.hero-world-layer` (poster + WebGL, `isolation:isolate`) | 0 |
| `#hero-world` | 1 |
| `#fog` | 2 |
| `.hero-copy` / hint | 3 |

Assert: `window.__otzFogOpaqueOk === true` and `window.__otzFogCenterAlpha >= 0.9` after startup.

Local check: `node scripts/verify-fog-visual.mjs` (serves the site root + Chrome CDP).

## Deferred (Gate 1 still open)

- Deterministic GLB/meshopt hero asset + poster atomic load (A5.4–A5.7)
- Paired same-camera World Lab vs website screenshots (A5 fidelity fixture)
- Production vegetation instances when the selected pack has forests
- Gates 2–7 (location preview, auth, entitlements, CDN, My World, hardening)
