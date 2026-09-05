# WEB.1 Scroll hero — orange explorer

**Status:** scroll-guided orange explorer (`#C2692A`) on frozen Bergura-A snapshot.

## State machine

`Ready → Drop → Guided → Handover → Explore ⇄ Guided`

## Hard contracts

| Contract | Rule |
| --- | --- |
| Rolling | `axis = normalize(cross(up, dir))`, angle = signed distance / radius; one quaternion; subdivide large jumps |
| Session isolation | `HeroRevealSession` — in-memory only; no localStorage / IndexedDB / account sync |
| Monotonic mask | Progress moves the ball; mask is write-once; reload is the only reset |
| Rejected move | Typed `WATER` / `TOO_STEEP` / `OUTSIDE_WORLD` / `NO_GROUND` + caption |
| Ball | Exact `#C2692A`, high roughness, off-white rim, contact shadow |
| Strict ground | `sampleHeight → null` throws in DEV; prod keeps last valid |
| Route validation | Same gate as free explore, sampled every 5 m |
| Scrub test | Forward / back / forward → same orientation; revealed area = union |

## Modules

| File | Role |
| --- | --- |
| `heroRevealSession.ts` | Monotonic mask session |
| `explorerRoll.ts` | Rolling quaternion |
| `movementGate.ts` | Typed destination gate |
| `heroWorld.ts` | Three.js world + ball phases |
| `routeWalk.ts` | Pure scroll/route maths |

## Tests

```bash
npm run test:scroll-hero
```
