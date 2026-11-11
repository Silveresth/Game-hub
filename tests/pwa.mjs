// Vérifie la PWA sur le build de production servi par le serveur Node.
// Prérequis : `npm start` (build + serveur sur le port 3001).
// Usage : node tests/pwa.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3001';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(base + '/', { waitUntil: 'load' });
const result = await page.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
  const href = document.querySelector('link[rel=manifest]').href;
  const manifest = await (await fetch(href)).json();
  const icons = await Promise.all(manifest.icons.map(async (i) => {
    const r = await fetch(new URL(i.src, href));
    return `${i.src} ${r.status} ${r.headers.get('content-type')}`;
  }));
  return { sw: reg ? reg.active?.scriptURL ?? 'en attente' : null, name: manifest.name, display: manifest.display, icons };
});
console.log(JSON.stringify(result, null, 2));

// Hors connexion : la page doit encore s'afficher depuis le cache
await page.reload({ waitUntil: 'load' }); // le service worker contrôle maintenant la page
await page.context().setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => errors.push('hors ligne : ' + e.message));
const offlineTitle = await page.title();
console.log('Titre hors connexion :', offlineTitle);
await page.context().setOffline(false);

const ok = result.sw && result.icons.every((i) => / 200 image\//.test(i)) && /Steal a Masterpiece/.test(offlineTitle);
const real = errors.filter((e) => !/api\/|EventSource|ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(e));
real.forEach((e) => console.log('  erreur :', e));
console.log(ok && !real.length ? '✓ PWA OK' : '✗ PWA incomplète');
await browser.close();
process.exit(ok && !real.length ? 0 : 1);
