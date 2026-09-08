import { build } from 'vite';
import { rm } from 'node:fs/promises';

try {
  await build({
    configFile: false, publicDir: false, logLevel: 'warn',
    build: {
      ssr: 'tests/header.test.ts', outDir: '.header-tests', target: 'node20',
      rollupOptions: { output: { entryFileNames: 'header.test.mjs' } },
    },
  });
  await import('../.header-tests/header.test.mjs');
} finally {
  await rm('.header-tests', { recursive: true, force: true });
}
