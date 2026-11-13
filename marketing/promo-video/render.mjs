// Rendu de la vidéo promo : planche d'aperçu (preview t1 t2 …) ou toutes les images (frames).
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const require = createRequire('c:/game-hub/package.json');
const { chromium } = require('playwright');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUB = 'c:/game-hub/public';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const fromPublic = u.startsWith('/art/') || u.startsWith('/fonts/') || u === '/logo.svg';
  const file = fromPublic ? path.join(PUB, u) : path.join(DIR, u === '/' ? 'index.html' : u);
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const mode = process.argv[2] ?? 'preview';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.evaluate(() => window.ready);

if (mode === 'preview') {
  const args = process.argv.slice(3);
  const name = args[0] && isNaN(Number(args[0])) ? args.shift() : 'preview';
  const big = name.startsWith('big');
  const data = await page.evaluate(([times, big]) => window.contactSheet(times, big ? 2 : 4, big ? 540 : 270), [args.map(Number), big]);
  writeFileSync(path.join(DIR, `${name}.jpg`), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
  console.log('aperçu :', path.join(DIR, `${name}.jpg`));
} else {
  const out = path.join(DIR, 'frames');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  const FPS = 30;
  const n = Math.round((await page.evaluate(() => window.DURATION)) * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const data = await page.evaluate((t) => {
      window.renderFrame(t);
      return document.getElementById('c').toDataURL('image/jpeg', 0.94);
    }, i / FPS);
    writeFileSync(path.join(out, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    if (i % 90 === 0) console.log(`${i}/${n} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  console.log(`${n} images en ${Math.round((Date.now() - t0) / 1000)} s`);
}
await browser.close();
server.close();
