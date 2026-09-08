/**
 * Copy world-lab production dist into map-engine/ for /map.
 * Expects OTZ_WORLD_LAB or sibling path to origintrailz-v4/world-lab/dist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const candidates = [
  process.env.OTZ_WORLD_LAB_DIST,
  path.resolve(siteRoot, '..', 'OriginTrailz', 'origintrailz-v4', 'world-lab', 'dist'),
  'C:/Users/jreri/OneDrive/Documents/OriginTrailz/origintrailz-v4/world-lab/dist',
].filter(Boolean);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const src = candidates.find((p) => p && fs.existsSync(path.join(p, 'index.html')));
const dst = path.join(siteRoot, 'map-engine');
if (!src) {
  console.warn('copy-map-engine: world-lab dist not found — /map will 404 until built');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(
    path.join(dst, 'index.html'),
    '<!doctype html><title>map-engine missing</title><p>Build world-lab dist and re-run copy-map-engine.</p>',
  );
  process.exit(0);
}
if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
copyDir(src, dst);
console.log('Copied map-engine from', src);
