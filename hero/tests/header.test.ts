import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';
import { HEADER, HeaderGround } from '../src/scroll/headerTerrain';
import { DiscoveryMask } from '../src/scroll/discoveryMask';
import { HeroWorld } from '../src/scroll/heroWorld';
import { Route } from '../src/scroll/routeWalk';
import { BERGURA_A_ROUTE } from '../src/scroll/routeConfig';
import { checkGroundPath } from '../src/scroll/exploration';

const bytes = readFileSync(`public${HEADER.url}`);
const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));
assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues));
assert.equal(bytes.byteLength, HEADER.bytes);
assert.ok(bytes.byteLength < 6_000_000, 'header exceeds the agreed 6 MB asset budget');
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const ground = new HeaderGround(gltf.scene);
assert.equal(ground.meshes.length, 4);
assert.equal(ground.triangles, 286720);
assert.equal(ground.heights.length, 449 * 321);
console.log('PASS: real GLB, Khronos validation, budget, chunks and complete welded grid');

// Compare the CPU ground sampler against actual triangle intersections, not
// another copy of the interpolation equation. Include chunk joins and edges.
const points = [[0, 0], [0, -400], [0, 350], [-700, 0], [700, 0], [-875, -625], [875, 625]];
let seed = 23;
for (let i = 0; i < 16; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const x = -874 + (seed / 4294967296) * 1748;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  points.push([x, -624 + (seed / 4294967296) * 1248]);
}
for (const [x, z] of points) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(ground.meshes, false)[0];
  assert.ok(hit, `mesh hole at ${x}, ${z}`);
  assert.ok(Math.abs(ground.required(x, z) - hit.point.y) < .0001, `ground mismatch at ${x}, ${z}`);
}
for (const [x, z] of [[NaN, 0], [0, Infinity], [-876, 0], [0, 626]]) assert.equal(ground.sample(x, z), null);
const broken = gltf.scene.clone();
broken.remove(broken.children[0]);
assert.throws(() => new HeaderGround(broken), /incomplete/);
const demoRoute = new Route(BERGURA_A_ROUTE);
for (let i = 1; i < demoRoute.points.length; i++) {
  const a = demoRoute.points[i - 1], b = demoRoute.points[i];
  assert.equal(checkGroundPath(ground,
    { x: a.e - HEADER.originE, z: HEADER.originN - a.n },
    { x: b.e - HEADER.originE, z: HEADER.originN - b.n }), 'ok', `demo segment ${i} is blocked`);
}
console.log('PASS: ground matches real triangles; missing chunks and outside positions rejected');

// Exercise actual scroll methods without constructing a WebGL context.
const hero = Object.create(HeroWorld.prototype) as any;
Object.assign(hero, {
  ground, route: new Route(BERGURA_A_ROUTE), config: { preview: false },
  mask: new DiscoveryMask(), marker: new THREE.Group(), roll: new THREE.Group(),
  ready: true, manual: true, progress: 0, revealedDistance: 0, markerDistance: 0,
  draw() {},
});
const colors = ground.meshes.map(mesh => mesh.geometry.getAttribute('color'));
const versions = colors.map(attribute => (attribute as THREE.BufferAttribute).version);
hero.onScroll(0);
assert.ok(hero.mask.data.some((value: number) => value > 0), 'opening reveal pocket missing');
hero.onScroll(1);
const before = hero.mask.data.slice();
hero.onScroll(.2);
assert.deepEqual(hero.mask.data, before, 'scroll-back restored fog');
assert.equal(hero.progress, .2);
assert.equal(hero.marker.position.y, ground.required(hero.marker.position.x, hero.marker.position.z) + 10);
assert.ok(Math.abs(hero.roll.quaternion.length() - 1) < .00001);
for (let i = 0; i < colors.length; i++) assert.equal((colors[i] as THREE.BufferAttribute).version, versions[i], 'scroll repainted a vertex array');
console.log('PASS: opening seed, retained reveal, marker ground contact and no vertex repaint');

// Free play must validate the entire move, not just a destination beyond a
// void/cliff. This does not claim water/road route validation on terrain-only data.
assert.equal(checkGroundPath({ sample: x => x > 4 && x < 6 ? null : 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }), 'outside');
assert.equal(checkGroundPath({ sample: x => x * 3 }, { x: 0, z: 0 }, { x: 10, z: 0 }), 'steep');
assert.equal(checkGroundPath(ground, { x: 0, z: 0 }, { x: 900, z: 0 }), 'outside');
assert.equal(checkGroundPath(ground, { x: 0, z: 0 }, { x: NaN, z: 0 }), 'outside');
const intro = new Route(BERGURA_A_ROUTE).at(0);
hero.marker.position.set(intro.e - HEADER.originE, 0, HEADER.originN - intro.n);
hero.marker.position.y = ground.required(hero.marker.position.x, hero.marker.position.z) + 10;
hero.exploring = true;
const from = hero.marker.position.clone();
assert.equal(hero.moveBallTo(from.x + 15, from.z), true, 'initial free exploration is blocked');
hero.advanceMotion(performance.now() + 3000);
assert.equal(hero.marker.position.x, from.x + 15);
assert.equal(hero.marker.position.y, ground.required(from.x + 15, from.z) + 10);
const freeReveal = hero.mask.data.slice();
hero.onScroll(.6);
assert.equal(hero.marker.position.x, from.x + 15, 'scroll hijacked free-play position');
assert.deepEqual(hero.mask.data, freeReveal);
Object.assign(hero, { renderer: { domElement: { style: {} } }, pointers: new Map(),
  config: { preview: false, onStatus() {} }, storyCamera() {} });
hero.setExploring(false);
assert.deepEqual(hero.mask.data.map((v: number, i: number) => v >= freeReveal[i] ? 1 : 0),
  new Uint8Array(freeReveal.length).fill(1), 'return to story erased exploration');
assert.equal(hero.exploring, false);
assert.equal(hero.marker.position.y, ground.required(hero.marker.position.x, hero.marker.position.z) + 10);
assert.ok(Math.abs(hero.roll.quaternion.length() - 1) < .00001);
console.log('PASS: free movement stays on ground; path misses/cliffs reject; returning keeps discoveries');

const mask = new DiscoveryMask();
mask.revealSegment(-700, 200, 700, 200, 60);
// A fast scroll across the plate must not become disconnected mouse dots.
for (let x = -650; x < 650; x += 50) {
  const col = Math.floor((x - HEADER.minX) / 1750 * mask.width);
  const row = Math.floor((200 - HEADER.minZ) / 1250 * mask.height);
  assert.ok(mask.data[row * mask.width + col] > 250);
}
const material = new THREE.MeshStandardMaterial();
mask.apply(material);
const shader = {
  uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
};
material.onBeforeCompile(shader as any, {} as THREE.WebGLRenderer);
assert.ok(shader.vertexShader.includes('vHeroXZ ='));
assert.ok(shader.fragmentShader.includes('texture2D(heroReveal'));
assert.ok(shader.fragmentShader.includes('outgoingLight = mix'));
assert.ok(shader.fragmentShader.includes('#include <opaque_fragment>'));
mask.flush();
assert.equal(mask.texture.version, 1);
mask.flush();
assert.equal(mask.texture.version, 1, 'idle mask keeps uploading');
console.log('PASS: continuous mask, Three.js shader hooks and no idle texture uploads');

const manifest = JSON.parse(readFileSync('public/hero-header-manifest.json', 'utf8'));
assert.equal(manifest.asset, HEADER.url);
assert.equal(manifest.byteLength, HEADER.bytes);
const source = readFileSync('src/scroll/heroWorld.ts', 'utf8');
assert.ok(!/addEventListener\(\s*['"]wheel/.test(source), 'wheel trap returned');
assert.ok(!source.includes('terrain.bin'), 'tile reconstruction returned');
assert.ok(!source.includes('new THREE.Fog('), 'second fog layer returned');
assert.ok(!/localStorage|indexedDB/.test(source), 'demo persistence returned');
const sceneManifest = JSON.parse(readFileSync('public/hero-scene-manifest.json', 'utf8'));
assert.equal(sceneManifest.asset, HEADER.url);
console.log('PASS: manifest and active loader agree; native wheel, one fog layer, session-only state');

mask.dispose(); hero.mask.dispose();
