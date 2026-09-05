import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'hero', 'dist');

cpSync(join(dist, 'hero.js'), join(root, 'hero.js'));
const worldSrc = join(dist, 'world');
const worldDst = join(root, 'world');
if (existsSync(worldDst)) rmSync(worldDst, { recursive: true, force: true });
mkdirSync(worldDst, { recursive: true });
cpSync(worldSrc, worldDst, { recursive: true });
const manifestSrc = join(dist, 'hero-scene-manifest.json');
if (existsSync(manifestSrc)) {
  cpSync(manifestSrc, join(root, 'hero-scene-manifest.json'));
}
console.log('Copied hero.js + world/ (+ manifest if present) to site root');
