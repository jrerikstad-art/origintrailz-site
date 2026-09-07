import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';

const paths = [
  'public/hero-assets/bergura-header-1750x1250.glb',
  '../../bergura-glb/bergura-750m-terrain.glb',
  '../../bergura-glb/bergura-750m-features.glb',
  '../../bergura-glb/bergura-750m-full.glb',
  '../../bergura-glb/bergura-a-core.glb',
];
const results = [];
for (const path of paths) {
  const data = readFileSync(path);
  const name = path.split('/').at(-1);
  const report = await validator.validateBytes(new Uint8Array(data), { uri: name, maxIssues: 100 });
  results.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
    errors: report.issues.numErrors, warnings: report.issues.numWarnings, report });
  console.log(`${name}: ${data.length} bytes, ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`);
}
mkdirSync('../../validation', { recursive: true });
writeFileSync('../../validation/glb-validation.json', JSON.stringify({
  validator: 'Khronos glTF-Validator 2.0.0-dev.3.10', results,
}, null, 2) + '\n');
if (results.some(result => result.errors || result.warnings)) process.exitCode = 1;
