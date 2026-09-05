# FOG.VISUAL.TRUTH — Gate 1 blocker

## Required stacking

| Layer | z-index |
| --- | --- |
| poster SVG (inside world layer) | 0 |
| `.hero-world-layer` (`isolation:isolate`, `contain:paint`) | 0 |
| `#hero-world` canvas | 1 |
| `#fog` canvas | 2 |
| `.hero-copy` / hint | 3 |

WebGL is trapped inside `.hero-world-layer` so it cannot composite above the fog canvas.
Fog is painted **directly** on `#fog` with opaque `rgb(240,235,224)`; wipes use `destination-out` (no offscreen mask blit — that left the visible buffer empty).

## Automated assert

After init (and after idle resize), the page samples the fog canvas centre pixel:

- `window.__otzFogCenterAlpha` — 0..1
- `window.__otzFogOpaqueOk` — must be `true` (alpha ≥ 0.9)
- `window.__otzAssertFogOpaque(label)` — re-run manually in DevTools

Console: `[otz-fog] FOG.VISUAL.TRUTH ok …` or `FAIL`.

## Manual acceptance

1. Hard refresh — landscape covered by paper fog.
2. Move pointer — continuous uncover.
3. Refresh — fog restored.
4. Only website `#fog`; no engine discovery fog.
5. If WebGL fails (`__otzHeroFail`), fog reveals the SVG poster (not empty beige).
