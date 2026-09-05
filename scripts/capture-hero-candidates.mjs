/**
 * Capture WEB.1 hero candidate contact frames via Chrome CDP.
 * Builds candidates bundle, serves it + published /world, screenshots A–F.
 *
 * Usage: node scripts/capture-hero-candidates.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream, existsSync, statSync, createWriteStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, extname, join } from 'node:path';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const heroRoot = path.join(siteRoot, 'hero');
const distCand = path.join(heroRoot, 'dist-candidates');
const PUBLISHED = process.env.OTZ_PUBLISHED || 'C:\\OrigintrailzWorld\\published';
const outDir = path.join(siteRoot, 'docs', 'hero-contact-sheets');
const IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const HTTP_PORT = 5199;
const CDP_PORT = 9333;

const BROWSERS = [
  process.env.CHROME_PATH,
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

function mime(p) {
  switch (extname(p).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.bin':
      return 'application/octet-stream';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

function resolvePublic(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0] || '/');
  if (clean.startsWith('/world/')) {
    const rel = clean.slice('/world/'.length);
    const filePath = normalize(join(PUBLISHED, rel));
    if (!filePath.startsWith(normalize(PUBLISHED))) return null;
    return filePath;
  }
  // Vite build puts assets under dist-candidates/; candidates.html at root of dist
  let filePath = normalize(join(distCand, clean === '/' ? 'candidates.html' : clean));
  if (clean === '/candidates.html' || clean === '/') {
    filePath = join(distCand, 'candidates.html');
  }
  if (clean === '/hero-candidates.json') {
    filePath = join(heroRoot, 'public', 'hero-candidates.json');
  }
  // hashed assets
  if (!existsSync(filePath) && clean.startsWith('/assets/')) {
    filePath = join(distCand, clean.slice(1));
  }
  return filePath;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const filePath = resolvePublic(req.url || '/');
        if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end('missing ' + (req.url || ''));
          return;
        }
        res.writeHead(200, { 'Content-Type': mime(filePath), 'Cache-Control': 'no-store' });
        createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server));
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

async function waitForCdp(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      if (Array.isArray(tabs) && tabs.length) return tabs;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('CDP not reachable');
}

async function captureOne(session, id) {
  const url = `http://127.0.0.1:${HTTP_PORT}/candidates.html?id=${id}&semStride=2`;
  console.log('navigate', url);
  await session.send('Page.navigate', { url });
  let ready = false;
  let fail = null;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const result = await session.send('Runtime.evaluate', {
      expression: `({
        ready: !!window.__otzCandidateReady,
        fail: window.__otzCandidateFail || null,
        id: window.__otzCandidateId || null
      })`,
      returnByValue: true,
    });
    const v = result?.result?.value;
    if (v?.fail) {
      fail = v.fail;
      break;
    }
    if (v?.ready) {
      ready = true;
      break;
    }
    await sleep(1500);
  }
  if (!ready) throw new Error(`candidate ${id} not ready: ${fail || 'timeout'}`);

  await sleep(1000);
  const shot = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const buf = Buffer.from(shot.data, 'base64');
  const out = path.join(outDir, `candidate-${id}.png`);
  await fs.writeFile(out, buf);
  console.log('wrote', out, `(${buf.length} bytes)`);
  return out;
}

async function writeContactHtml() {
  const cells = IDS.map(
    (id) =>
      `<figure><img src="candidate-${id}.png" alt="Candidate ${id}"/><figcaption>${id}</figcaption></figure>`,
  ).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Hero candidate contact sheet</title>
<style>
  body{font:14px/1.4 system-ui;background:#1c1917;color:#faf7f2;margin:24px}
  h1{font-size:20px;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:20px}
  figure{margin:0;background:#292524;border-radius:8px;overflow:hidden}
  img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;background:#3f3428}
  figcaption{padding:8px 10px;font-weight:600;letter-spacing:.04em}
</style></head><body>
<h1>Origintrailz WEB.1 — hero region contact sheet</h1>
<p>Same cinematic camera (FOV 42°, yaw −0.72, dist 2000 m). Choose one before GLB.</p>
<div class="grid">${cells}</div>
</body></html>`;
  const out = path.join(outDir, 'contact-sheet.html');
  await fs.writeFile(out, html, 'utf8');
  console.log('wrote', out);
}

async function buildCandidates() {
  console.log('building candidates bundle…');
  const r = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build:candidates'],
    { cwd: heroRoot, encoding: 'utf8', shell: true },
  );
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error('build:candidates failed');
  }
  console.log(r.stdout.slice(-400));
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await buildCandidates();

  // Fix asset paths in built HTML if needed (absolute /assets)
  let browserPath = null;
  for (const p of BROWSERS) {
    if (await fileExists(p)) {
      browserPath = p;
      break;
    }
  }
  if (!browserPath) throw new Error('No Chrome/Edge found');

  const server = await startServer();
  console.log('serving', `http://127.0.0.1:${HTTP_PORT}/candidates.html`);

  const profile = path.join(siteRoot, '.chrome-hero-candidates');
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--window-size=1440,900',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  try {
    const tabs = await waitForCdp(CDP_PORT);
    const page = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || tabs[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('no CDP page');

    const session = new CdpSession(page.webSocketDebuggerUrl);
    await session.open();
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const id of IDS) {
      console.log('capturing', id, '…');
      await captureOne(session, id);
    }
    session.close();
    await writeContactHtml();

    try {
      const { default: sharp } = await import('sharp');
      const imgs = await Promise.all(
        IDS.map((id) =>
          sharp(path.join(outDir, `candidate-${id}.png`))
            .resize(640, 400, { fit: 'cover' })
            .png()
            .toBuffer(),
        ),
      );
      await sharp({
        create: {
          width: 640 * 3,
          height: 400 * 2,
          channels: 3,
          background: { r: 28, g: 25, b: 23 },
        },
      })
        .composite(
          imgs.map((buf, i) => ({
            input: buf,
            left: (i % 3) * 640,
            top: Math.floor(i / 3) * 400,
          })),
        )
        .png()
        .toFile(path.join(outDir, 'contact-sheet.png'));
      console.log('wrote contact-sheet.png');
    } catch (e) {
      console.log('sharp mosaic skipped:', e?.message || e);
    }
  } finally {
    browser.kill();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
