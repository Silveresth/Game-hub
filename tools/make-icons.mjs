// Génère les icônes PNG de la PWA à partir de public/icons/icon.svg.
// Usage : node tools/make-icons.mjs     (PW_CHANNEL=chrome|msedge, défaut msedge)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // icône adaptative : fond plein (sans coins arrondis) et motif dans la zone sûre de 80 %
  const inner = maskable ? Math.round(size * 0.8) : size;
  const body = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#2c0b14;display:grid;place-items:center"><div style="width:${inner}px;height:${inner}px">${svg}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: !maskable });
  console.log('✓', file);
}

await render('icon-192.png', 192);
await render('icon-512.png', 512);
await render('maskable-512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { maskable: true });
await browser.close();
