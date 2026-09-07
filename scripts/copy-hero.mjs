import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'hero', 'dist');

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

// Copy GLB files (e.g. bergura-a-2x3km.glb) to root for Vercel static serving
for (const name of ['bergura-a-2x3km.glb']) {
  const src = join(dist, name);
  if (existsSync(src)) {
    cpSync(src, join(root, name));
    console.log(`Copied ${name} to site root`);
  }
}

console.log('Copied hero.js + world/ + snapshot/ (+ manifests + GLBs) to site root');
