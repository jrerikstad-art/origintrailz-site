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
Production: **https://origintrailz-site.vercel.app** (GitHub `main` auto-deploys).

**Apex `origintrailz.com` still points at an empty Lovable/Cloudflare shell** until
DNS is cut over. Step-by-step: [`docs/PUBLIC-CUTOVER.md`](docs/PUBLIC-CUTOVER.md).

## Public World Service (GPS field phones)

This repo is the **landing** only. Field phones need a separate HTTPS factory
(`world.origintrailz.com` → `serve_world` on `:8799`), not this marketing origin.
Until that subdomain exists: LAN `:8799` or a Cloudflare Tunnel URL in
`field-config.local.json`. See the cutover doc.
