// Icônes et écrans de démarrage de l'application Android (Capacitor), dessinés à partir du logo.
// Remplace chaque image du projet android/ à sa taille exacte. Usage : node tools/make-android-assets.mjs
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RES = 'android/app/src/main/res';
const icon = readFileSync('public/icons/icon.svg', 'utf8'); // logo complet (fond velours arrondi)
const mark = readFileSync('public/logo.svg', 'utf8'); // marque seule (fond transparent)
const VELVET = 'radial-gradient(ellipse 60% 50% at 50% 42%, #6e1a2d, #2c0b14 75%)';

/** Largeur et hauteur d'un PNG (en-tête IHDR). */
function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/^(ic_launcher(_round|_foreground)?|splash)\.png$/.test(f)) files.push(p);
  }
})(RES);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage();
for (const file of files) {
  const { w, h } = pngSize(file);
  const name = file.split(/[\\/]/).pop();
  let html;
  if (name === 'splash.png') {
    const s = Math.round(Math.min(w, h) * 0.34);
    html = `<div style="width:${w}px;height:${h}px;background:${VELVET};display:grid;place-items:center"><div style="width:${s}px;height:${s}px">${mark}</div></div>`;
  } else if (name === 'ic_launcher_foreground.png') {
    // icône adaptative : le motif tient dans la zone sûre (66 % du centre)
    const s = Math.round(w * 0.6);
    html = `<div style="width:${w}px;height:${h}px;display:grid;place-items:center"><div style="width:${s}px;height:${s}px">${mark}</div></div>`;
  } else {
    const round = name === 'ic_launcher_round.png';
    html = `<div style="width:${w}px;height:${h}px;${round ? 'border-radius:50%;overflow:hidden;' : ''}">${icon}</div>`;
  }
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
  await page.screenshot({ path: file, omitBackground: name !== 'splash.png' });
}
await browser.close();

// fond des icônes adaptatives : le velours du logo
const bg = join(RES, 'values', 'ic_launcher_background.xml');
writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2C0B14</color>\n</resources>\n');
console.log(`${files.length} images Android régénérées, fond des icônes adaptatives : velours`);
