/**
 * FOG.VISUAL.TRUTH local check via Chromium CDP.
 * Usage: node scripts/verify-fog-visual.mjs [baseUrl]
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8765/';
const PORT = 9229;

const BROWSERS = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://local');
        let filePath = path.join(root, decodeURIComponent(url.pathname));
        if (url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const types = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.bin': 'application/octet-stream',
          '.wasm': 'application/wasm',
        };
        res.writeHead(200, {
          'Content-Type': types[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('missing');
      }
    });
    server.listen(8765, '127.0.0.1', () => resolve(server));
  });
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (buf) => {
      const msg = JSON.parse(String(buf));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const mid = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(mid, { resolve, reject });
      this.ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  close() {
    try {
      this.ws?.close();
    } catch (_) {}
  }
}

async function waitForCdp(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      if (Array.isArray(tabs) && tabs.length) return tabs;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('CDP not reachable');
}

const PROBE = `(() => {
  const fog = document.getElementById('fog');
  const world = document.getElementById('hero-world');
  const layer = document.querySelector('.hero-world-layer');
  const copy = document.querySelector('.hero-copy');
  const cs = (el) => (el ? getComputedStyle(el).zIndex : null);
  if (typeof window.__otzAssertFogOpaque === 'function') {
    window.__otzAssertFogOpaque('verify-script');
  }
  let cornerAlpha = null;
  let midEdgeAlpha = null;
  if (fog && fog.width > 4) {
    const ctx = fog.getContext('2d', { willReadFrequently: true });
    const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3] / 255;
    cornerAlpha = a(4, 4);
    midEdgeAlpha = a((fog.width / 2) | 0, 8);
  }
  return {
    ready: !!(fog && fog.width > 0),
    fogOpaqueOk: window.__otzFogOpaqueOk ?? null,
    fogCenterAlpha: window.__otzFogCenterAlpha ?? null,
    cornerAlpha,
    midEdgeAlpha,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    z: { layer: cs(layer), world: cs(world), fog: cs(fog), copy: cs(copy) },
    fogSize: fog
      ? { w: fog.width, h: fog.height, cssW: fog.clientWidth, cssH: fog.clientHeight }
      : null,
    heroFail: window.__otzHeroFail || null,
    href: location.href,
  };
})()`;

async function main() {
  let browserPath = null;
  for (const p of BROWSERS) {
    if (await fileExists(p)) {
      browserPath = p;
      break;
    }
  }
  if (!browserPath) throw new Error('No Chrome/Edge found');

  let server;
  if (!process.argv[2]) server = await serveStatic();

  const profile = path.join(root, '.chrome-fog-verify');
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  browser.stderr?.on('data', (d) => {
    stderr += String(d);
  });

  try {
    const tabs = await waitForCdp(PORT);
    const page =
      tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ||
      tabs.find((t) => t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error('no CDP page');

    const session = new CdpSession(page.webSocketDebuggerUrl);
    await session.open();
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    await session.send('Page.navigate', { url: baseUrl });
    await sleep(1500);

    let value = null;
    for (let i = 0; i < 40; i++) {
      const result = await session.send('Runtime.evaluate', {
        expression: PROBE,
        awaitPromise: true,
        returnByValue: true,
      });
      value = result?.result?.value;
      if (value?.ready && value.fogCenterAlpha != null) break;
      await sleep(250);
    }
    session.close();

    console.log(JSON.stringify({ browser: path.basename(browserPath), ...value }, null, 2));
    const ok =
      value &&
      value.fogOpaqueOk === true &&
      value.fogCenterAlpha >= 0.9 &&
      value.cornerAlpha >= 0.9 &&
      String(value.z?.fog) === '2' &&
      String(value.z?.world) === '1' &&
      String(value.z?.copy) === '3' &&
      value.fogSize &&
      value.fogSize.w > 0 &&
      value.fogSize.h > 0;
    if (!ok) {
      console.error('FOG.VISUAL.TRUTH FAIL');
      if (stderr) console.error(stderr.slice(-500));
      process.exitCode = 1;
    } else {
      console.log('FOG.VISUAL.TRUTH PASS (canvas alpha + stacking)');
    }
  } finally {
    browser.kill();
    if (server) server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
