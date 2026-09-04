# OriginTrailz marketing site

Static landing page (`index.html`) plus a lightweight **WebGL hero** that reuses
the World Engine visual language (terrain colours, roads, water, journal roofs,
parchment discovery reveal).

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
Deploy this project; **DNS cutover for origintrailz.com is separate** (today that
apex still serves an empty Lovable/Cloudflare shell).

## Public World Service

This repo is the **landing** only. Field phones must not use this origin as
`OTZ_WORLD_BASE` until hosted `world` + `api` exist. Until then: LAN `:8799` or a
temporary tunnel URL in `field-config`.
