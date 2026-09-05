import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, normalize, extname } from 'path';

const PUBLISHED = resolve('C:/OrigintrailzWorld/published');

function mime(p: string): string {
  switch (extname(p).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.bin':
      return 'application/octet-stream';
    case '.js':
      return 'text/javascript';
    case '.html':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}

function servePublishedWorld(): Plugin {
  return {
    name: 'otz-serve-published-world',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/world/')) return next();
        const rel = decodeURIComponent(req.url.slice('/world/'.length).split('?')[0] ?? '');
        const filePath = normalize(join(PUBLISHED, rel));
        if (!filePath.startsWith(PUBLISHED) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('missing');
          return;
        }
        res.setHeader('Content-Type', mime(filePath));
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(filePath).pipe(res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/world/')) return next();
        const rel = decodeURIComponent(req.url.slice('/world/'.length).split('?')[0] ?? '');
        const filePath = normalize(join(PUBLISHED, rel));
        if (!filePath.startsWith(PUBLISHED) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('missing');
          return;
        }
        res.setHeader('Content-Type', mime(filePath));
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

/** Dev/preview for hero contact-sheet candidates (not the production lib build). */
export default defineConfig({
  publicDir: 'public',
  root: resolve(__dirname),
  plugins: [servePublishedWorld()],
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [resolve(__dirname), PUBLISHED] },
  },
  preview: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: 'dist-candidates',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'candidates.html'),
    },
    target: 'es2020',
  },
});
