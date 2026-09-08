import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'hero', 'dist');
const heroPublic = join(root, 'hero', 'public');

cpSync(join(dist, 'hero.js'), join(root, 'hero.js'));

for (const name of ['world', 'snapshot']) {
  const src = join(dist, name);
  const dst = join(root, name);
  if (!existsSync(src)) continue;
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
}

for (const name of ['hero-scene-manifest.json', 'hero-pack-lod.json', 'hero-candidates.json']) {
  const src = join(dist, name);
  if (existsSync(src)) cpSync(src, join(root, name));
}

// Prefer dist (vite publicDir copy); fall back to hero/public so lib builds
// that skip publicDir still ship the Art-locked GLB to site root for Vercel.
for (const name of ['bergura-a-2x3km.glb']) {
  const fromDist = join(dist, name);
  const fromPublic = join(heroPublic, name);
  const src = existsSync(fromDist) ? fromDist : fromPublic;
  if (!existsSync(src)) {
    console.warn(`Missing ${name} in dist/ and hero/public/`);
    continue;
  }
  cpSync(src, join(root, name));
  console.log(`Copied ${name} to site root from ${src === fromDist ? 'dist' : 'hero/public'}`);
}

console.log('Copied hero.js + world/ + snapshot/ (+ manifests + GLBs) to site root');
