# WEB.1 Gate 1 — Hero acceptance matrix

**Commit under test:** `ce390ed`+ (CTA/pricing/cones follow-up)  
**Preview:** https://origintrailz-site.vercel.app/

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| 1 | Idle 60s | No ambient reveal / no snake | pending manual |
| 2 | Fast corner sweep | Continuous soft wipe, no separated drops | pending manual |
| 3 | Reveal then resize | Coordinates stay aligned; one fog layer | pending manual |
| 4 | Inspect 3D | Clean fully-revealed terrain under paper fog; no engine parchment | pending manual |
| 5 | Network after load | Pointer creates **zero** tile/bake requests | pending manual |
| 6 | HiDPI | Brush aligns with cursor | pending manual |
| 7 | Touch / mouse / pen | Continuous stroke | pending manual |
| 8 | Fidelity vs World Lab | Same landscape (not cone diorama) | partial — real tiles, cones removed; GLB package deferred |
| 9 | Poster → complete scene | Atomic reveal, no jigsaw | deferred (A5.7) |
| 10 | Hero manifest | Real tile IDs + pipeline versions | `hero/public/hero-scene-manifest.json` |
| 11 | No €3.99 / no fake tile counter | Copy + UI clean | done in source |

## Source changes (Gate 1)

- `hero/src/main.ts` — `HERO_CLEAN`, no `__otzHeroReveal`, no cone forest
- `index.html` — sole paper-fog canvas; coalesced brush; no ambient walker; **Start 7 days free**; no mouse “tiles revealed” counter
- `hero/public/hero-scene-manifest.json` — source tile IDs for the current pack
- `docs/WEB1-GATE0-ARCHITECTURE.md` — Gate 0 inventory

## Deferred (Gate 1 still open)

- Deterministic GLB/meshopt hero asset + poster atomic load (A5.4–A5.7)
- Paired same-camera World Lab vs website screenshots (A5 fidelity fixture)
- Production vegetation instances when the selected pack has forests
- Gates 2–7 (location preview, auth, entitlements, CDN, My World, hardening)
