# WEB.1 Gate 1 — Hero acceptance matrix

**Commit under test:** (fill after push)  
**Preview:** https://origintrailz-site.vercel.app/

| # | Test | Expected | Result |
| --- | --- | --- | --- |
| 1 | Idle 60s | No ambient reveal / no snake | |
| 2 | Fast corner sweep | Continuous soft wipe, no separated drops | |
| 3 | Reveal then resize | Coordinates stay aligned; one fog layer | |
| 4 | Inspect 3D | Clean fully-revealed terrain under paper fog; no engine parchment | |
| 5 | Network after load | Pointer creates **zero** tile/bake requests | |
| 6 | HiDPI | Brush aligns with cursor | |
| 7 | Touch / mouse / pen | Continuous stroke | |

## Source changes (Gate 1)

- `hero/src/main.ts` — `HERO_CLEAN`, full reveal, no `__otzHeroReveal`, features always opaque
- `index.html` — sole paper-fog owner; offscreen mask; coalesced+interpolated brush; no engine calls; no ambient walker
- `docs/WEB1-GATE0-ARCHITECTURE.md` — Gate 0 inventory
