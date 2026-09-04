# WEB.1 Gate 0 — Repository / deployment truth

**Date:** 2026-09-04  
**Live host:** https://origintrailz-site.vercel.app/  
**Source repo:** https://github.com/jrerikstad-art/origintrailz-site  
**Local checkout:** `c:\dev\origintrailz-site`  
**Deploy pipeline:** GitHub `main` → Vercel project `origintrailz-site` (auto)

## Inventory

| Piece | Finding |
| --- | --- |
| Frontend | Single static `index.html` (~2.9k lines) + Vite-built `hero.js` (Three.js fragment) |
| Framework | None for marketing shell; hero uses Vite + TypeScript + Three.js |
| Hosting | Vercel static (`vercel.json` build: `npm --prefix hero install` → `npm run build`) |
| Auth | **Prototype only** — `localStorage` users/session, base64-ish `enc(pw)`, `demo@origintrailz.com` auto-login |
| Storage | `localStorage` (auth, style templates); IndexedDB mentioned for Style Studio tiles |
| Engine artifact | Vendored slim modules under `hero/src/engine/` (not the full world-lab streamer) |
| Apex DNS | `origintrailz.com` still Lovable/Cloudflare empty shell (404) |

## Fog / reveal map (exact symbols)

| Item | File | Symbol |
| --- | --- | --- |
| Marketing fog canvas | `index.html` | `#fog` |
| 3D world canvas | `index.html` | `#hero-world` |
| Fill paper fog | `index.html` | `paintFog()` |
| Punch hole | `index.html` | `clearAt(x,y,r)` |
| Engine reveal bridge | `index.html` → `hero/src/main.ts` | `window.__otzHeroReveal` ← **double fog owner (bug)** |
| Pointer freeze | `index.html` → `hero/src/main.ts` | `window.__otzHeroPointer` |
| Discovery parchment | `hero/src/main.ts` | `HeroDiscovery` + `applySurfaceShading(..., discovery.sample)` |
| Ambient walker | `index.html` | **Removed** (Gate prep); must stay removed |

## Demo / LAN / path audit (site repo)

| Kind | Present? | Where |
| --- | --- | --- |
| `demo@origintrailz.com` | **Yes** | `index.html` `autoLogin()` |
| `localStorage` identity | **Yes** | `ot_users` / `ot_session` |
| Client-only auth | **Yes** | Style Studio auth block |
| `10.0.0.5` in production bundle | No in hero/index | Mentioned only in `docs/PUBLIC-CUTOVER.md` (ops) |
| Windows publish path in site | No | — |
| Bergura as GPS claim | Preview tiles are curated Norway sample; must not present as “your GPS” |

## Architecture target (from work order)

```text
Public site (Vercel)  →  Account/entitlement API
My World / Mobile     →  same API + tile gateway/CDN
Tile gateway          →  private bake queue/factory
Discovery sync store  ←  mobile writes; browser My World reads
```

Suggested hosts: `origintrailz.com`, `app`/`/world`, `api.`, `tiles.`. Raw factory stays private.

## Gate status

| Gate | Status |
| --- | --- |
| 0 Repository truth | **This note** — checkout is the live Vercel source |
| 1 Hero truth | **In progress** — sole website fog, hero-clean presentation |
| 2–7 | Deferred until Gate 1 acceptance |

## Deferred (not claimed complete)

Accounts, entitlements, My World sync, public tile gateway, DNS cutover, Studio admin lock.
