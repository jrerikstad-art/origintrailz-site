# Bergura Hero GLB

## File Required

The landing hero is optimized to load a pre-baked GLB export of the Bergura plate (real engine terrain + roads + buildings + water).

**Expected file:** `bergura-a-2x3km.glb`  
**Size:** ~26.6 MB (26,622,800 bytes)  
**Location:** Place at `/workspace/hero/public/bergura-a-2x3km.glb`

## Source

Desktop binary location (Jan's PC):
```
C:\Users\jreri\Desktop\bergura-a-2x3km.glb
```

## Installation

1. Copy the GLB file from Desktop to the repository:
   ```bash
   cp /path/to/bergura-a-2x3km.glb hero/public/bergura-a-2x3km.glb
   ```

2. The hero will automatically load the GLB if present at `/bergura-a-2x3km.glb`

3. If the GLB is missing, the hero gracefully falls back to loading the snapshot tile pack from `hero/public/snapshot/bergura-a-v1/` (96 terrain tiles + 384 semantic tiles)

## Deployment

For production deployment, ensure the GLB is either:
- Committed to the repository (if Git LFS is configured), or
- Uploaded directly to the hosting service (Vercel, etc.)

The file will be served as a static asset from the public directory.

## GLB Contents

- Real Bergura engine plate (~2×3 km)
- Terrain heightfield with proper elevation
- Roads network (classified by width/type)
- Building footprints with heights
- Water bodies (lakes + shore)
- Proper coordinate alignment to UTM33N (E=319500, N=6531500)

## Fallback Behavior

Without the GLB:
- Hero loads 96 terrain tiles from `snapshot/bergura-a-v1/world/terrain/`
- Semantic features loaded from 384 tiles with LOD rings (core/middle/outer)
- Total snapshot size: ~1.9 MB terrain + semantic data
- Same visual result, but with more HTTP requests

With the GLB:
- Single ~26.6 MB file load
- Faster initial display (fewer HTTP requests)
- Pre-optimized mesh topology
- Same camera positioning and lighting
