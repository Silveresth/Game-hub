// node marketing/thumbnail/render.mjs -> miniature-9x16.png (1080x1920) et miniature-16x9.png (1280x720)
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(dir, 'thumb.html')).href;
// Navigateur de Playwright s'il est installé, sinon Edge ou Chrome du système.
let browser;
for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
  try { browser = await chromium.launch(opts); break; } catch { /* essai suivant */ }
}
if (!browser) throw new Error('Aucun navigateur : lancer "npx playwright install chromium"');
for (const [hash, w, h, out] of [['', 1080, 1920, 'miniature-9x16.png'], ['#h', 1280, 720, 'miniature-16x9.png']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url + hash);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, out) });
  await page.close();
}
await browser.close();
