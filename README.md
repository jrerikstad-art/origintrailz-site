# OriginTrailz marketing site

Static landing page (`index.html`) plus a lightweight **WebGL hero** that reuses
the World Engine visual language (terrain colours, roads, water, journal roofs,
parchment discovery reveal).

## Hero Scene

The landing uses a **scroll-driven interactive hero** with fog-of-war reveal (product demonstration).

**Current implementation:** Loads from `/hero/public/snapshot/bergura-a-v1/world/` with LOD rings:
- 96 terrain tiles (250m each)
- 384 semantic tiles (125m each) with core/middle/outer LOD
- Manifest: `/hero/public/hero-pack-lod.json`
- Real Bergura engine plate (~2×3 km lake + shore)

**Planned optimization (PC to add):** 
- Primary: `hero/public/bergura-a-2x3km.glb` (~26.6 MB) for visual mesh
- Source binary: `C:\Users\jreri\Desktop\bergura-a-2x3km.glb`
- Interactive features (height sampling, discovery) still use tile data
- See `hero/public/BERGURA_GLB_README.md` for details

### Interaction Model

- **Guided phase:** Scroll to move orange ball along route; pointer drag reveals fog (product gesture)
- **Handover phase:** "Your turn" message; tap to reveal fog
- **Explore phase:** Tap to move ball; free camera orbit

### Recent Fixes

- Added pointer-based fog wipe/reveal during guided and handover phases
- Relaxed WATER validation for guided route (allows bridge/ford scenarios)
- Fog reveal is now the primary interaction gesture (not orbit)

## Local

```bash
# Install + build hero fragment → hero.js + world/ at site root
npm --prefix hero install
npm run build

# Preview
npx --yes serve -l 5050 .
# http://127.0.0.1:5050/
```

Hero-only Vite hot reload: `npm run dev:hero` (assets from `hero/public`).

Flags:

- `?hero=2d` — SVG fog only (skip WebGL)
- `prefers-reduced-motion` — static pre-reveal; no camera drift / ambient trail

## Vercel

`vercel.json` runs `npm run build` after `npm --prefix hero install`.
Production: **https://origintrailz-site.vercel.app** (GitHub `main` auto-deploys).

**Apex `origintrailz.com` still points at an empty Lovable/Cloudflare shell** until
DNS is cut over. Step-by-step: [`docs/PUBLIC-CUTOVER.md`](docs/PUBLIC-CUTOVER.md).

## Public World Service (GPS field phones)

This repo is the **landing** only. Field phones need a separate HTTPS factory
(`world.origintrailz.com` → `serve_world` on `:8799`), not this marketing origin.
Until that subdomain exists: LAN `:8799` or a Cloudflare Tunnel URL in
`field-config.local.json`. See the cutover doc.
