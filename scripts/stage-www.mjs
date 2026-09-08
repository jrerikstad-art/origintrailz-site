/**
 * Stage static site into www/ so Vercel outputDirectory does not swallow /api.
 * Serverless handlers in api/ stay at the repo root.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

const STATIC_FILES = [
  'index.html',
  'header-preview.html',
  'hero.js',
  'hero-scene-manifest.json',
  'hero-header-manifest.json',
  'hero-pack-lod.json',
  'hero-candidates.json',
];

const STATIC_DIRS = ['hero-assets', 'map', 'map-engine', 'snapshot', 'assets'];

if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const name of STATIC_FILES) {
  const src = join(root, name);
  if (existsSync(src) && statSync(src).isFile()) {
    cpSync(src, join(www, name));
  }
}

for (const name of STATIC_DIRS) {
  const src = join(root, name);
  if (!existsSync(src)) continue;
  cpSync(src, join(www, name), { recursive: true });
}

// Optional: shallow copy of any other top-level *.html
for (const ent of readdirSync(root, { withFileTypes: true })) {
  if (!ent.isFile() || !ent.name.endsWith('.html')) continue;
  if (STATIC_FILES.includes(ent.name)) continue;
  cpSync(join(root, ent.name), join(www, ent.name));
}

console.log('Staged static site into www/ (api/ left at repo root for Vercel Functions)');
