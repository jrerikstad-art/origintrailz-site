# Bergura Hero GLB

## File Required

The landing hero loads a pre-baked GLB export of the Bergura plate (real engine terrain + roads + buildings + water).

**Expected file:** `bergura-a-2x3km.glb`  
**Size:** ~26.6 MB (26,622,800 bytes)  
**Location:** Place at `hero/public/bergura-a-2x3km.glb`

## Source

Desktop binary location (Jan's PC):
```
C:\Users\jreri\Desktop\bergura-a-2x3km.glb
```

## Installation

1. Copy the GLB file from Desktop to the repository:
   ```bash
   # From Windows (Jan's PC)
   copy C:\Users\jreri\Desktop\bergura-a-2x3km.glb hero\public\bergura-a-2x3km.glb
   ```

2. **CRITICAL - Git LFS:** This file must be committed as a **regular binary** (NOT Git LFS).
   - The `.gitattributes` file is configured to exclude `*.glb` from LFS
   - Vercel static builds require the actual binary in the repo
   - If accidentally committed via LFS, see "Fixing LFS Commits" below

3. Commit and push:
   ```bash
   git add hero/public/bergura-a-2x3km.glb
   git commit -m "Add Bergura hero GLB binary (26.6 MB)"
   git push
   ```

4. The build process (`npm run build`) will copy the GLB from `hero/public/` to the site root

## Deployment (Vercel)

The GLB will be served from the root path `/bergura-a-2x3km.glb` after build.

**Build process:**
1. Vite copies `hero/public/bergura-a-2x3km.glb` → `hero/dist/bergura-a-2x3km.glb`
2. `scripts/copy-hero.mjs` copies `hero/dist/bergura-a-2x3km.glb` → `/bergura-a-2x3km.glb` (site root)
3. Vercel serves `/bergura-a-2x3km.glb` as static asset

**Verify deployment:**
```bash
curl -I https://your-preview.vercel.app/bergura-a-2x3km.glb
# Should return: HTTP/2 200, Content-Length: 26622800
```

## Fixing LFS Commits

If the GLB was accidentally committed via Git LFS (shows as 132-byte pointer):

```bash
# 1. Untrack from LFS
git lfs untrack '*.glb'

# 2. Remove LFS pointer
git rm --cached hero/public/bergura-a-2x3km.glb

# 3. Re-add as regular binary
git add hero/public/bergura-a-2x3km.glb

# 4. Commit
git commit -m "Fix: Commit GLB as regular binary (not LFS)"
git push --force-with-lease
```

## GLB Contents

- Real Bergura engine plate (~2×3 km)
- Terrain heightfield with proper elevation
- Roads network (classified by width/type)
- Building footprints with heights
- Water bodies (lakes + shore)
- Proper coordinate alignment to UTM33N (E=319500, N=6531500)

## Hero Behavior

The hero loads ONLY this GLB file (no tile streaming):
- Single GLB load via `GLTFLoader`
- Height samples extracted from geometry for ball collision
- Visual mesh rendered directly from GLB
- Discovery mask painted over the GLB scene
