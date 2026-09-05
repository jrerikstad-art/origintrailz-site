import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      // Scroll-driven landing hero (terrain + reveal). Candidates tooling stays on scenePack.
      entry: resolve(__dirname, 'src/scroll/main.ts'),
      formats: ['es'],
      fileName: () => 'hero.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'hero.js',
      },
    },
    target: 'es2020',
    sourcemap: false,
    minify: true,
    reportCompressedSize: false,
  },
});
