# OriginTrailz marketing site

Static landing page (`index.html`) plus a lightweight **WebGL hero** that reuses
the World Engine visual language (terrain colours, roads, water, journal roofs,
parchment discovery reveal).

## Hero Scene

The landing uses a **scroll-driven interactive hero** with fog-of-war reveal (product demonstration).

**Implementation:** Loads `bergura-a-2x3km.glb` (~26.6 MB) via GLTFLoader - real Bergura engine plate (~2×3 km).

### Critical: GLB Binary (NOT Git LFS)

**File:** `hero/public/bergura-a-2x3km.glb` (26,622,800 bytes)  
**Source:** `C:\Users\jreri\Desktop\bergura-a-2x3km.glb` (Jan's PC)

**MUST commit as regular binary (NOT Git LFS):**
- `.gitattributes` configured to exclude `*.glb` from LFS
- Vercel static builds require actual binary in repo
- If 404 on deploy: GLB was committed as LFS pointer (see fix in `hero/public/BERGURA_GLB_README.md`)

**Installation:**
```bash
# Copy from Desktop
copy C:\Users\jreri\Desktop\bergura-a-2x3km.glb hero\public\bergura-a-2x3km.glb

# Commit as regular binary
git add hero/public/bergura-a-2x3km.glb
git commit -m "Add Bergura hero GLB binary (26.6 MB)"
```

See `hero/public/BERGURA_GLB_README.md` for full details and LFS troubleshooting.

### Interaction Model

- **Guided phase:** Scroll to move orange ball along route; pointer drag reveals fog (product gesture)
- **Handover phase:** "Your turn" message; tap/drag to reveal fog
- **Explore phase:** Tap to move ball; free camera orbit

### Technical

- Hero loads GLB via `GLTFLoader` (no tile streaming)
- Height samples extracted from GLB geometry for ball collision
- Water/roads/buildings are in GLB visual mesh
- Discovery mask painted over GLB scene
- Build copies GLB: `hero/public/` → `hero/dist/` → site root `/`

## Local

```bash
# Install + build hero fragment → hero.js + bergura-a-2x3km.glb at site root
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

**Build output verification:**
```bash
# Verify GLB is served (not LFS pointer)
curl -I https://your-preview.vercel.app/bergura-a-2x3km.glb
# Should show: Content-Length: 26622800 (not 132)
```

**Apex `origintrailz.com` still points at an empty Lovable/Cloudflare shell** until
DNS is cut over. Step-by-step: [`docs/PUBLIC-CUTOVER.md`](docs/PUBLIC-CUTOVER.md).

## Public World Service (GPS field phones)

This repo is the **landing** only. Field phones need a separate HTTPS factory
(`world.origintrailz.com` → `serve_world` on `:8799`), not this marketing origin.
Until that subdomain exists: LAN `:8799` or a Cloudflare Tunnel URL in
`field-config.local.json`. See the cutover doc.
