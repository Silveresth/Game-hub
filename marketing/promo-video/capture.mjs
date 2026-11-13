// Prises de vue propres du jeu (sans interface) pour la vidéo promo 9:16.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire('c:/game-hub/package.json');
const { chromium } = require('playwright');
const WebSocket = require('ws');

const base = 'http://localhost:5174';
const api = 'http://127.0.0.1:3011';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const layout = JSON.parse(readFileSync('c:/game-hub/src/shared/layout.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 864, height: 1080 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('sam-quality', 'high');
    localStorage.setItem('sam-tip-bonk', '1');
  } catch {}
});
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
const call = (path, body, auth) => fetch(api + '/api/game/' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { 'x-player-id': auth.id, 'x-player-token': auth.token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const admin = (method, path, body) => fetch(api + '/api/admin/' + path, { method, headers: { 'x-admin-token': 'dev-admin', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const HIDE = 'body > *:not(canvas) { opacity: 0 !important; } .toast, #banner { display: none !important; }';
const shoot = async (name, cam, look, wait = 3500) => {
  await page.evaluate(([c, l]) => window.__game.shoot(c, l), [cam, look]);
  await sleep(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('✓', name);
};
const playing = () => page.waitForFunction(() => window.__game?.state && document.body.classList.contains('playing'), null, { timeout: 240000 });

// joueur principal : tenue décontractée, couleur corail
await page.goto(base + '/game/', { waitUntil: 'load', timeout: 180000 });
await page.waitForSelector('#guestLink', { timeout: 60000 });
await page.fill('#nameInput', 'Musée Lumière');
await page.evaluate(() => { document.querySelector('#colors button[data-c="#ff5e62"]').click(); document.querySelector('#skins button:nth-child(3)').click(); document.querySelector('#guestLink').click(); });
await playing();
await page.addStyleTag({ content: HIDE });
await sleep(4000);
const auth = await page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    try { const j = JSON.parse(localStorage.getItem(localStorage.key(i))); if (j?.id && j?.token) return j; } catch {}
  }
  return null;
});
await call('dev/grant', { coins: 50_000_000 }, auth);
await admin('POST', 'live', { kind: 'arcenciel', minutes: 15 });

// 1. la place, vue d'ensemble avec le ciel
await shoot('hero', [14, 12, -24], [0, 3.5, 12]);
await shoot('hero2', [-30, 9, -16], [-6, 3, 10]);

// 2. un camion du convoi arc-en-ciel
for (let i = 0; i < 30; i++) {
  const t = await page.evaluate(() => window.__game.convoy.trucks.filter((x) => x.item && !x.item.sold && x.item.event === 'arcenciel' && x.root.visible).map((x) => ({ ...x.artworkWorld(), frame: x.item.frame }))[0] ?? null);
  if (t && t.x > -40 && t.x < 30) {
    await shoot('truck', [t.x + 7, 3.6, t.z - 9], [t.x - 1, 2.2, t.z], 2500);
    break;
  }
  await sleep(1500);
}

// 3. acheter au camion : l'œuvre au-dessus de la tête
for (let i = 0; i < 6; i++) {
  const t = await page.evaluate(() => window.__game.convoy.trucks.filter((x) => x.item && !x.item.sold && x.root.visible).map((x) => x.artworkWorld()).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0] ?? null);
  if (t) {
    await page.evaluate(([x, z]) => window.__game.teleport(x, z), [t.x + 1.5, t.z - 3.2]);
    await sleep(1500);
    await page.keyboard.press('KeyE');
    await sleep(3000);
    if (await page.evaluate(() => !!window.__game.carrying)) break;
  }
  await sleep(2500);
}
const me = await page.evaluate(() => window.__game.pos);
if (await page.evaluate(() => !!window.__game.carrying)) {
  await shoot('carry', [me.x + 2.4, 2.1, me.z - 3.6], [me.x, 2.3, me.z]);
  await shoot('carry2', [me.x - 2.2, 1.4, me.z + 3.4], [me.x, 2.4, me.z]);
}

// 4. coup de parapluie : un passant arrive et frappe
const login = await call('login', { name: 'Passant', skin: 1, color: '#b46bff' });
const code = await page.evaluate(() => window.__game.state.inviteCode);
const ws = new WebSocket(api.replace('http', 'ws') + '/ws');
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ t: 'auth', id: login.id, token: login.token, join: code }));
await sleep(1000);
const me2 = await page.evaluate(() => window.__game.pos);
ws.send(JSON.stringify({ t: 'pos', x: me2.x + 1.7, z: me2.z, ry: -Math.PI / 2, anim: 'Idle' }));
await page.evaluate(([c, l]) => window.__game.shoot(c, l), [[me2.x + 0.9, 2.3, me2.z - 4.6], [me2.x + 0.9, 1.4, me2.z]]);
await sleep(4000);
await page.screenshot({ path: `${out}/duo.png` });
ws.send(JSON.stringify({ t: 'bonk' }));
await sleep(350);
await page.screenshot({ path: `${out}/bonk.png` });
await sleep(450);
await page.screenshot({ path: `${out}/bonk2.png` });
console.log('✓ bonk');
ws.close();

// 5. le musée : 4 œuvres en cadres précieux, étincelles
await page.keyboard.press('Escape');
await sleep(1500);
for (let round = 0; round < 4; round++) {
  const s = await call('state', null, auth);
  if (s.artworks.filter((a) => a.slot !== null).length >= 4) break;
  const cv = await call('convoy', null, auth);
  const now = Math.floor(cv.serverTime / cv.intervalMs);
  for (const it of cv.items.filter((i) => i.window <= now)) await call('buy', { window: it.window }, auth);
  if ((await call('state', null, auth)).artworks.filter((a) => a.slot !== null).length >= 4) break;
  await sleep(21000);
}
const st = await call('state', null, auth);
const LOOK = { 0: ['tournesols', 'dore'], 1: ['cri', 'normal'], 2: ['nuit-etoilee', 'arcenciel'], 3: ['grande-vague', 'diamant'] };
for (const a of st.artworks) if (a.slot !== null && LOOK[a.slot]) await call('dev/mythic', { uid: a.uid, workId: LOOK[a.slot][0], frame: LOOK[a.slot][1] }, auth);
await page.reload({ waitUntil: 'load' });
await playing();
await page.addStyleTag({ content: HIDE });
await sleep(5000);
const plot = layout.plots[await page.evaluate(() => window.__game.myPlot)];
await shoot('room', [plot.x - 6.5, 7.8, plot.z], [plot.x + 5.88, 2.0, plot.z], 5000);
await shoot('room2', [plot.x - 2.5, 2.4, plot.z - plot.f * 0.5], [plot.x + 5.88, 2.3, plot.z + plot.f * 3], 3500);

// 6. pluie d'or sur la place
await admin('POST', 'live', { kind: 'pluie' });
await sleep(14000);
await shoot('coins', [-24, 4.2, -2], [-12, 0.6, -11], 3000);
await shoot('coins2', [22, 5, 3], [10, 0.6, 10], 3000);
await admin('DELETE', 'live');
await browser.close();
console.log('fini');
