// Tests navigateur de bout en bout : chaque page, des parties simulées, erreurs console et captures.
// Prérequis : `npm run server` (API) et `npm run dev` (Vite) lancés.
// Usage : node tests/smoke.mjs [baseUrl]    (PW_CHANNEL=chrome|msedge, défaut msedge)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
mkdirSync('tests/shots', { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'msedge',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });

let failures = 0;
async function check(name, path, fn, ctx = context) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; // ONLY=game : ne lancer qu'une partie des tests
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /shader|WebGL|THREE/i.test(m.text()))) errors.push(m.type() + ': ' + m.text());
  });
  const t0 = Date.now();
  try {
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    if (fn) await fn(page);
  } catch (e) {
    errors.push('test: ' + e.message.split('\n')[0]);
  }
  await page.screenshot({ path: `tests/shots/${name}.png`, timeout: 120000 }).catch(() => errors.push('capture impossible'));
  console.log(`${errors.length ? '✗' : '✓'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  errors.forEach((e) => console.log('   ', e.slice(0, 400)));
  failures += errors.length;
  await page.close();
}
const shot = (p, name) => p.screenshot({ path: `tests/shots/${name}.png`, timeout: 120000 });
const until = (p, fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout });

// ================================================================== Memory Museum

function makePng(w = 8, h = 6) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 60 + x * 20; raw[o + 2] = 90; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const enter = async (p) => {
  await p.click('#enter');
  await until(p, () => document.body.classList.contains('playing'), null, 8000);
};
const look = (p, x, z, yaw, pitch = 0) =>
  p.evaluate(([x, z, yaw, pitch]) => {
    const c = window.__museum.camera;
    c.position.set(x, 1.7, z);
    c.rotation.order = 'YXZ';
    c.rotation.set(pitch, yaw, 0);
  }, [x, z, yaw, pitch]);
const count = (p) => p.evaluate(() => window.__museum.artifacts.size);
const rooms = (p) => p.evaluate(() => window.__museum.data().rooms.length);
async function submitModal(p) {
  await p.click('#form button[type=submit]');
  await until(p, () => !document.getElementById('modal').classList.contains('open'), null, 10000);
}
async function ensurePlaying(p) {
  await p.waitForTimeout(300);
  if (!(await p.evaluate(() => document.body.classList.contains('playing')))) await enter(p);
}

/** Vérifie que la barre live affiche des chiffres venus du serveur. */
async function checkLiveBar(p) {
  await until(p, () => /\d/.test(document.querySelector('#livebar [data-k="online"]')?.textContent ?? ''), null, 15000)
    .catch(() => { throw new Error('barre live : « en ligne » jamais reçu'); });
  const bar = await p.evaluate(() => {
    const t = (k) => document.querySelector(`#livebar [data-k="${k}"]`).textContent;
    return { online: Number(t('online').replace(/\s/g, '')), visitors: Number(t('visitors').replace(/\s/g, '')), clock: t('clock'), countdown: t('countdown'), top: t('top') };
  });
  if (!(bar.online >= 1)) throw new Error('barre live : 0 joueur en ligne alors que la page est ouverte');
  if (!(bar.visitors >= 1)) throw new Error('barre live : compteur de visiteurs vide');
  if (!/^\d\d:\d\d:\d\d$/.test(bar.clock)) throw new Error('barre live : heure invalide ' + bar.clock);
  if (!/^(\d\d:\d\d|\d+ min|\d+ h \d\d|maintenant|en direct · lot \d+\/\d+)$/.test(bar.countdown)) throw new Error('barre live : compte à rebours invalide ' + bar.countdown);
  return bar;
}

await check('hub', '/', async (p) => {
  const bar = await checkLiveBar(p);
  console.log('    barre live :', JSON.stringify(bar));
  await p.waitForSelector('#salesList .sale', { timeout: 10000 });
  await shot(p, 'hub-1-hero');
  await p.waitForSelector('#musees:not([hidden])', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('ventes').scrollIntoView());
  await p.waitForTimeout(300);
  await shot(p, 'hub-2-sections');
  // Un deuxième onglet du même visiteur ne doit pas compter deux fois
  const p2 = await context.newPage();
  await p2.goto(base + '/', { waitUntil: 'load' });
  await p2.waitForTimeout(6500);
  const online2 = await p.evaluate(() => Number(document.querySelector('#livebar [data-k="online"]').textContent));
  await p2.close();
  if (online2 !== bar.online) throw new Error(`deux onglets comptés comme ${online2} personnes (attendu ${bar.online})`);
});

// ================================================================== Jeu (phase 1)

const g = (p, fn, arg) => p.evaluate(fn, arg);
const devGrant = (p, body) =>
  p.evaluate(async (b) => {
    const s = JSON.parse(localStorage.getItem('sam-player'));
    const r = await fetch('/api/game/dev/grant', { method: 'POST', headers: { 'content-type': 'application/json', 'x-player-id': s.id, 'x-player-token': s.token }, body: JSON.stringify(b) });
    if (!r.ok) throw new Error('dev/grant indisponible : lancez le serveur avec SAM_DEV=1');
  }, body);

/** Se place à côté d'un camion encore sur la route et achète, jusqu'à posséder `count` œuvres. */
async function buyFromConvoy(p, count) {
  for (let k = 0; k < 40; k++) {
    const target = await g(p, () => {
      const now = window.__game.serverNow;
      const it = window.__game.convoy.items.find((i) => !i.sold && now > i.startsAt + 4000 && now < i.startsAt + 32000);
      if (!it) return null;
      const x = -72 + 144 * ((now - it.startsAt) / 40000);
      window.__game.teleport(x + 0.5, 4.0); // sur le trottoir, face au plateau du camion
      return it.window;
    });
    if (target !== null) {
      await p.waitForTimeout(300);
      await p.keyboard.press('KeyE');
      try {
        await until(p, (n) => window.__game.state.artworks.length >= n, count, 8000);
        return true;
      } catch { /* camion manqué : on réessaie */ }
    }
    await p.waitForTimeout(1000);
  }
  return false;
}

/** Nouvelle partie dans la page `p` : nom, puis attente de l'entrée dans le quartier. */
/** Appel direct à l'API du jeu avec la session du joueur de la page. */
const apiPost = (p, path, body = {}) =>
  p.evaluate(async ([path, body]) => {
    const s = JSON.parse(localStorage.getItem('sam-player'));
    const r = await fetch('/api/game/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-player-id': s.id, 'x-player-token': s.token }, body: JSON.stringify(body) });
    return r.json();
  }, [path, body]);

async function newGame(p, name) {
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 });
  await p.fill('#nameInput', name);
  await p.click('#welcomeForm .go');
  await until(p, (n) => window.__game?.state?.name === n && document.body.classList.contains('playing') && window.__game.myPlot >= 0, name, 30000);
}

await check('game-play', '/game/', async (p) => {
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 });
  await p.fill('#nameInput', 'Musée Robot');
  await p.click('#colors button:nth-child(3)'); // bleu
  await p.click('#welcomeForm .go');
  await until(p, () => window.__game?.state?.name === 'Musée Robot', null, 20000);
  const s0 = await g(p, () => window.__game.state);
  if (s0.coins !== 500 || s0.level !== 1 || s0.slots !== 4) throw new Error('état initial inattendu ' + JSON.stringify({ c: s0.coins, l: s0.level }));
  if (s0.color !== '#3d8bff') throw new Error('couleur du personnage non enregistrée : ' + s0.color);
  if (s0.quest?.id !== 'first-buy' || !(await p.isVisible('#quest'))) throw new Error('premier objectif absent');
  await checkLiveBar(p);
  await p.waitForTimeout(1500);
  await shot(p, 'game-1-spawn');

  // Achat au convoi : on se place à côté d'un camion encore sur la route
  await devGrant(p, { coins: 200000 });
  if (!(await buyFromConvoy(p, 1))) throw new Error('impossible d’acheter au convoi');
  await shot(p, 'game-2-bought');
  await until(p, () => window.__game.museum.hiddenUid === null, null, 20000);
  const s1 = await g(p, () => window.__game.state);
  if (s1.artworks[0].slot !== 0 || !(s1.income > 0)) throw new Error('œuvre achetée mal placée ou sans revenu');

  // Objectif accompli → récompense
  await p.waitForSelector('#questClaim:not([hidden])', { timeout: 10000 });
  const beforeClaim = await g(p, () => window.__game.state.coins);
  await p.click('#questClaim');
  await until(p, (c) => window.__game.state.quest?.id === 'first-collect' && window.__game.state.coins >= c + 200, beforeClaim, 10000)
    .catch(() => { throw new Error('récompense d’objectif non versée'); });
  await shot(p, 'game-2b-quest');

  // Dans le musée : l'œuvre est exposée
  await g(p, () => { const c = window.__game.museum.cellWorld(0, 0, -2, 1); window.__game.teleport(c.x, c.z); });
  await p.waitForTimeout(2500);
  await shot(p, 'game-3-inside');

  // Caisse : on marche sur le cercle doré
  const coinsBefore = await g(p, () => window.__game.state.coins);
  await g(p, () => { const r = window.__game.museum.registerPos; window.__game.teleport(r.x, r.z); });
  await until(p, (c) => window.__game.state.coins > c, coinsBefore, 20000).catch(() => { throw new Error('la caisse n’a rien encaissé'); });

  // Agrandissement
  await g(p, () => { const s = window.__game.museum.signPos; window.__game.teleport(s.x, s.z); });
  await p.waitForTimeout(400);
  await p.keyboard.press('KeyE');
  await until(p, () => window.__game.state.level === 2, null, 15000).catch(() => { throw new Error('agrandissement refusé'); });
  await g(p, () => { const c = window.__game.museum.cellWorld(0, 0, 0, 2); window.__game.teleport(c.x, c.z); });
  await p.waitForTimeout(2500);
  await shot(p, 'game-4-expanded');

  // Visiteurs PNJ
  await until(p, () => window.__game.visitors >= 1, null, 30000).catch(() => { throw new Error('aucun visiteur PNJ'); });

  // Revente (deux appuis sur R pour confirmer)
  await g(p, () => {
    const { p: at, normal } = window.__game.museum.slotWorld(0);
    window.__game.teleport(at.x + normal.x * 1.2, at.z + normal.z * 1.2);
  });
  await until(p, () => /Revendre/.test(window.__game.prompt), null, 10000)
    .catch(async () => { throw new Error('pas d’invite de revente : « ' + (await g(p, () => window.__game.prompt + ' | busy=' + window.__game.busy + ' | pos=' + JSON.stringify(window.__game.pos))) + ' »'); });
  await p.keyboard.press('KeyR');
  await until(p, () => /Appuyez encore/.test(document.getElementById('toast').textContent), null, 10000);
  await p.keyboard.press('KeyR');
  await until(p, () => window.__game.state.artworks.length === 0, null, 10000).catch(() => { throw new Error('revente refusée'); });

  // Rechargement : la partie reprend sans redemander le nom
  await p.reload({ waitUntil: 'load' });
  await until(p, () => window.__game?.state?.name === 'Musée Robot', null, 30000);
  if (await p.evaluate(() => document.getElementById('welcome').classList.contains('open'))) throw new Error('le nom est redemandé après rechargement');
  if ((await g(p, () => window.__game.state.level)) !== 2) throw new Error('niveau perdu après rechargement');
});

// ---------------------------------------------------------------- multijoueur : un vrai cambriolage à deux navigateurs
const ctxB = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
ctxB.setDefaultNavigationTimeout(120000); // deux pages en rendu logiciel en même temps : chargement lent
context.setDefaultNavigationTimeout(120000);
await check('game-multi', '/game/', async (pA) => {
  await newGame(pA, 'Musée Alpha');
  await devGrant(pA, { coins: 1000000 });
  if (!(await buyFromConvoy(pA, 1))) throw new Error('A n’a pas pu acheter');
  await apiPost(pA, 'dev/age');
  // sans caméra, pas de sirène : A en installe pour être prévenu du décrochage
  await apiPost(pA, 'security', { item: 'cameras' });
  // A rentre chez lui (pour voir l'alarme et le vol)
  await g(pA, () => { const c = window.__game.museum.cellWorld(0, 0, 2, 2); window.__game.teleport(c.x, c.z); });

  const pB = await ctxB.newPage();
  const errorsB = [];
  pB.on('pageerror', (e) => errorsB.push(e.message));
  await pB.goto(base + '/game/', { waitUntil: 'load' });
  await newGame(pB, 'Musée Bêta');
  await until(pB, () => window.__game.remotes >= 1, null, 20000).catch(() => { throw new Error('B ne voit pas A'); });
  await until(pA, () => window.__game.remotes >= 1, null, 20000).catch(() => { throw new Error('A ne voit pas B'); });

  // B va devant l'œuvre de A
  const target = await g(pB, () => {
    for (const v of window.__game.views.values()) {
      if (v.owner?.name !== 'Musée Alpha') continue;
      const a = v.owner.artworks.find((x) => x.slot !== null && !x.carried);
      const { p, normal } = v.slotWorld(a.slot);
      window.__game.teleport(p.x + normal.x * 1.2, p.z + normal.z * 1.2);
      return { plot: v.plot.index, uid: a.uid };
    }
    return null;
  });
  if (!target) throw new Error('B ne trouve pas le musée de A');
  await until(pB, () => /Maintenez pour voler/.test(window.__game.prompt), null, 30000)
    .catch(async () => { throw new Error('pas d’invite de vol : « ' + (await g(pB, () => window.__game.prompt)) + ' »'); });
  await shot(pB, 'multi-1-before');
  await pB.keyboard.down('KeyE');
  await until(pA, () => document.getElementById('alert').classList.contains('on'), null, 15000).catch(() => { throw new Error('pas d’alarme chez A'); });
  await shot(pA, 'multi-2-alarm');
  await until(pB, () => !!window.__game.carrying, null, 30000).catch(async () => { throw new Error('B ne porte pas l’œuvre : ' + (await g(pB, () => window.__game.prompt))); });
  await pB.keyboard.up('KeyE');
  await shot(pB, 'multi-3-carry');

  // B rentre chez lui avec l'œuvre
  await g(pB, () => { const c = window.__game.museum.cellWorld(0, 0, 2, 0); window.__game.teleport(c.x, c.z); });
  await until(pB, () => !window.__game.carrying && window.__game.state.artworks.length === 1, null, 20000)
    .catch(() => { throw new Error('casse non abouti'); });
  await until(pA, () => window.__game.state.artworks.length === 0, null, 20000).catch(() => { throw new Error('A possède encore l’œuvre'); });
  await until(pA, () => /On vous a volé/.test(document.getElementById('banner').textContent), null, 10000);
  await shot(pA, 'multi-4-victim');
  await pB.waitForTimeout(1500);
  await shot(pB, 'multi-5-thief');
  if (errorsB.length) throw new Error('erreur page B : ' + errorsB[0]);
  await pB.close();
});

// ================================================================== phase 3 : sécurité et marché noir
await check('game-security', '/game/', async (p) => {
  await newGame(p, 'Musée Forteresse');
  await devGrant(p, { coins: 5000000 });
  if (!(await buyFromConvoy(p, 1))) throw new Error('achat impossible');
  await g(p, () => window.__game.state); // état à jour
  // Panneau Sécurité (touche G), achats par les boutons
  await p.keyboard.press('KeyG');
  await p.waitForSelector('#security.open', { timeout: 5000 });
  for (const sel of ['[data-item="guards"][data-tier="agent"]', '[data-item="cameras"]', '[data-item="lasers"]', '[data-item="generator"]', '[data-item="vitrine"]']) {
    await p.click(`#secBody button${sel}`);
    await p.waitForTimeout(400);
  }
  await until(p, () => { const s = window.__game.state; return s.sec.guards === 2 && s.sec.cameras && s.sec.lasers && s.sec.generator && Object.keys(s.sec.vitrines).length === 1; }, null, 15000)
    .catch(async () => { throw new Error('achats de sécurité incomplets : ' + JSON.stringify(await g(p, () => window.__game.state.sec))); });
  await shot(p, 'sec-1-panel');
  await p.keyboard.press('Escape');
  // Les deux gardes apparaissent dans le musée (simulés par le serveur)
  await until(p, () => window.__game.guards.states(window.__game.myPlot).length === 2, null, 15000)
    .catch(() => { throw new Error('les gardes ne sont pas apparus'); });
  if (!/👮 2/.test(await p.textContent('#secInfo'))) throw new Error('HUD sécurité : ' + (await p.textContent('#secInfo')));
  await g(p, () => { const c = window.__game.museum.cellWorld(0, 0, 0, -2); window.__game.teleport(c.x, c.z); });
  await p.waitForTimeout(2500);
  await shot(p, 'sec-2-guards');
  // Marché noir : E devant la tente
  await g(p, () => window.__game.teleport(-60, -9.4));
  await until(p, () => /Marché noir/.test(window.__game.prompt), null, 10000).catch(async () => { throw new Error('pas d’invite marché noir : ' + (await g(p, () => window.__game.prompt))); });
  await p.keyboard.press('KeyE');
  await p.waitForSelector('#market.open', { timeout: 5000 });
  await p.click('#marketBody button[data-tool="brouilleur"]');
  await until(p, () => window.__game.state.tools.brouilleur === 1, null, 10000);
  await p.click('#marketBody button[data-tool="leurre"]');
  await until(p, () => window.__game.state.tools.leurre === 1, null, 10000);
  await shot(p, 'sec-3-market');
  await p.keyboard.press('Escape');
  if ((await p.locator('#toolbar button').count()) !== 2) throw new Error('barre d’outils : 2 outils attendus');
  // un outil loin de tout musée rival est refusé proprement
  await p.keyboard.press('Digit1');
  await until(p, () => /Approchez-vous/.test(document.getElementById('toast').textContent), null, 8000);
  await shot(p, 'sec-4-toolbar');
});

// ================================================================== phase 4 : enchères et admin
const adminCall = (method, path, body) =>
  fetch(base + '/api/admin/' + path, { method, headers: { 'x-admin-token': 'dev-admin', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

await check('game-auction', '/game/', async (p) => {
  await newGame(p, 'Musée Collectionneur');
  await devGrant(p, { coins: 2000000 });
  await g(p, () => window.__game.state);
  // à pied jusqu'à l'hôtel des ventes, E pour entrer
  await g(p, () => window.__game.teleport(60, -23.6));
  await until(p, () => /hôtel des ventes/.test(window.__game.prompt), null, 10000).catch(async () => { throw new Error('pas d’invite hôtel des ventes : ' + (await g(p, () => window.__game.prompt))); });
  await p.keyboard.press('KeyE');
  await until(p, () => document.body.classList.contains('in-hall') && window.__game.hall.state?.you.seat != null, null, 15000)
    .catch(() => { throw new Error('pas de place dans la salle'); });
  const sale = await adminCall('POST', 'sales', { title: 'Vente du test', at: Date.now() + 3600000, lots: [{ workId: 'tournesols', frame: 'normal' }] });
  if (!sale.sale) throw new Error('vente admin : ' + sale.error);
  await adminCall('POST', `sales/${sale.sale.id}/start`);
  await until(p, () => window.__game.hall.state?.lot?.phase === 'present', null, 15000);
  await until(p, () => /2,0 M|1,9 M/.test(document.getElementById('bidCoins').textContent), null, 10000)
    .catch(async () => { throw new Error('porte-monnaie de la salle pas à jour : ' + (await p.textContent('#bidCoins'))); });
  await shot(p, 'auction-1-present');
  await until(p, () => window.__game.hall.state?.lot?.phase === 'bidding', null, 15000);
  // montant libre à 97 % de l'estimation : aucun PNJ ne suit
  await p.fill('#bidCustom', String(Math.round(400000 * 0.97)));
  await p.click('#bidGo');
  await until(p, () => /Vous menez/.test(document.getElementById('bidLeader').textContent), null, 10000)
    .catch(async () => { throw new Error('enchère non prise : ' + (await p.textContent('#toast'))); });
  await p.waitForTimeout(1200);
  await shot(p, 'auction-2-leading');
  await until(p, () => /Adjugé/.test(document.getElementById('banner').textContent), null, 45000);
  await until(p, () => window.__game.state.artworks.some((a) => a.workId === 'tournesols'), null, 10000);
  await shot(p, 'auction-3-won');
  await p.click('#hallLeave');
  await until(p, () => !document.body.classList.contains('in-hall'), null, 5000);
});

await check('admin', '/admin/', async (p) => {
  // (le refus d'un mauvais jeton est vérifié par tests/auction.mjs)
  await p.fill('#token', 'dev-admin');
  await p.click('#loginForm button');
  await until(p, () => !document.getElementById('panel').hidden && document.querySelectorAll('#sales tr').length >= 3, null, 15000);
  await p.selectOption('#lots select.work', 'perle');
  await p.selectOption('#lots select.frame', 'diamant');
  await p.fill('#title', 'Nuit de la Perle');
  await p.click('#saleForm button[type=submit]');
  await until(p, () => /programmée/.test(document.getElementById('msg').textContent), null, 10000)
    .catch(async () => { throw new Error('création refusée : ' + (await p.textContent('#msg'))); });
  await until(p, () => [...document.querySelectorAll('#sales tr')].some((tr) => /Nuit de la Perle/.test(tr.textContent)), null, 10000);
  await shot(p, 'admin-1');
  p.once('dialog', (d) => d.accept());
  await p.click('#sales button[data-act="cancel"]');
  await until(p, () => /annulée/.test(document.getElementById('msg').textContent), null, 10000);
});

// ================================================================== phase 5 : étages et classements
await check('game-floors', '/game/', async (p) => {
  await newGame(p, 'Musée Gratte-Ciel');
  await devGrant(p, { coins: 7000000000 });
  for (let i = 0; i < 6; i++) await apiPost(p, 'expand');
  await p.reload({ waitUntil: 'load' }); // le musée se recharge avec ses 3 étages
  // un musée à 3 étages met du temps à se construire en rendu logiciel (tests) : délais larges
  await until(p, () => window.__game?.state?.floors === 3 && window.__game.myPlot >= 0 && document.body.classList.contains('playing'), null, 90000);
  // au pied de l'escalier de la salle d'entrée
  await g(p, () => { const c = window.__game.museum.cellWorld(0, 0, 2.2, 2.2); window.__game.teleport(c.x, c.z); });
  await until(p, () => /Monter au 1er étage/.test(window.__game.prompt), null, 10000)
    .catch(async () => { throw new Error('pas d’escalier : ' + (await g(p, () => window.__game.prompt))); });
  await p.keyboard.press('KeyE');
  await until(p, () => window.__game.floor === 1, null, 20000);
  await p.waitForTimeout(1500);
  await shot(p, 'floors-1');
  await p.keyboard.press('KeyR'); // redescendre
  await until(p, () => window.__game.floor === 0, null, 20000);
  // classements : 4 onglets
  await p.click('#boardBtn');
  await until(p, () => document.querySelectorAll('#boardTabs button').length === 4 && document.querySelectorAll('#boardList li').length >= 1, null, 10000);
  await p.click('#boardTabs [data-board="weekly"]');
  await until(p, () => document.querySelector('#boardTabs .on')?.dataset.board === 'weekly', null, 20000);
  await shot(p, 'boards-1');
  await p.keyboard.press('Escape');
});

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await check('game-mobile', '/game/', async (p) => {
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 });
  await p.fill('#nameInput', 'Musée Mobile');
  await p.tap('#welcomeForm .go');
  await until(p, () => window.__game?.state?.name === 'Musée Mobile' && document.body.classList.contains('playing'), null, 20000);
  if (!(await p.isVisible('#joy'))) throw new Error('joystick tactile absent');
  // le panneau d'objectif ne doit pas recouvrir le centre de l'écran (le personnage)
  const q = await p.locator('#quest').boundingBox();
  if (q && q.y + q.height > 844 * 0.45) throw new Error('le panneau d’objectif cache le personnage');
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('débordement horizontal');
  // pousser le joystick vers le haut fait avancer le personnage
  const before = await p.evaluate(() => window.__game.pos);
  const box = await p.locator('#joy').boundingBox();
  const cdp = await p.context().newCDPSession(p);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 45 }] });
  await until(p, (b) => { const q = window.__game.pos; return Math.hypot(q.x - b.x, q.z - b.z) > 1; }, before, 20000)
    .catch(() => { throw new Error('le joystick ne fait pas bouger le personnage'); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await shot(p, 'game-5-mobile');
}, phone);

await check('hub-mobile', '/', async (p) => {
  await p.setViewportSize({ width: 390, height: 844 });
  await checkLiveBar(p);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('défilement horizontal sur mobile');
  await shot(p, 'hub-3-mobile');
});

await check('museum-own', '/museum/', async (p) => {
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await checkLiveBar(p);
  await shot(p, 'museum-1-menu');
  if ((await rooms(p)) !== 2) throw new Error('2 salles attendues');

  // Agrandir : clic sur un « + » du plan
  await p.click('.pc.add');
  if ((await rooms(p)) !== 3) throw new Error('salle non ajoutée');
  await p.click('[data-theme=futuristic]');
  await shot(p, 'museum-2-plan');

  await enter(p);
  await look(p, 0, 4.5, 0);
  await p.waitForTimeout(500);
  await shot(p, 'museum-3-entrance');
  await look(p, 0, -9, Math.PI * 0.85);
  await p.waitForTimeout(400);
  await shot(p, 'museum-4-classic');

  const n0 = await count(p);
  // Sculpture au sol
  await p.keyboard.press('KeyE');
  await look(p, 0, 4.8, 0, -0.95);
  await p.waitForTimeout(300);
  await p.mouse.click(550, 310);
  await p.waitForSelector('#modal.open');
  if ((await p.textContent('#mTitle')) !== 'Nouvelle sculpture') throw new Error('modal sculpture attendu');
  await p.click('#matChips [data-v=glass]');
  await p.click('#formChips [data-v=rings]');
  await p.fill('#title', 'Test sculpture');
  await submitModal(p);
  if ((await count(p)) !== n0 + 1) throw new Error('sculpture non ajoutée');

  // Œuvre générée sur un mur
  await ensurePlaying(p);
  await look(p, -3, 2.2, Math.PI / 2);
  await p.waitForTimeout(300);
  await p.mouse.click(550, 310);
  await p.waitForSelector('#modal.open');
  await p.click('#genBtn');
  await p.fill('#title', 'Test généré');
  await submitModal(p);
  // Photo importée
  await ensurePlaying(p);
  await look(p, 3, 2.2, -Math.PI / 2);
  await p.waitForTimeout(300);
  await p.mouse.click(550, 310);
  await p.waitForSelector('#modal.open');
  await p.setInputFiles('#photoFile', { name: 'a.png', mimeType: 'image/png', buffer: makePng() });
  await submitModal(p);
  if ((await count(p)) !== n0 + 3) throw new Error('œuvres murales non ajoutées');
  await ensurePlaying(p);
  await look(p, 0, 5, 0, -0.15);
  await p.waitForTimeout(600);
  await shot(p, 'museum-5-edited');

  // Publication
  await p.evaluate(() => document.exitPointerLock());
  await p.waitForSelector('#menu.open');
  await p.click('[data-tab=publish]');
  await p.fill('#pubName', 'Musée de test');
  await p.fill('#pubAuthor', 'Robot');
  await p.click('#publish');
  await p.waitForSelector('#shareRow:not([hidden])', { timeout: 15000 });

  // Explorer
  await p.click('[data-tab=explore]');
  await until(p, () => document.querySelectorAll('#exploreList .mcard').length >= 4, null, 10000);
  await shot(p, 'museum-6-explore');
});

await check('museum-visit', '/museum/?m=demo003', async (p) => {
  await p.waitForSelector('#visitBar:not([hidden])', { timeout: 60000 });
  if ((await rooms(p)) !== 5) throw new Error('le musée visité devrait avoir 5 salles');
  const before = Number(await p.textContent('#likeCount'));
  await p.click('#likeBtn');
  await p.waitForSelector('#likeBtn.liked', { timeout: 10000 });
  // le serveur ne compte qu'un « j'aime » par visiteur : +1 au premier passage, inchangé ensuite
  if (Number(await p.textContent('#likeCount')) < before) throw new Error('compteur de j’aime incohérent');
  await enter(p);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(200);
  if (await p.evaluate(() => document.body.classList.contains('editing'))) throw new Error('édition possible en visite');
  await look(p, 0, 4.5, 0);
  await p.waitForTimeout(600);
  await shot(p, 'museum-7-visit');
  await look(p, 0, -20, Math.PI);
  await p.waitForTimeout(400);
});

await browser.close();
process.exit(failures ? 1 : 0);
