// Tests navigateur de bout en bout : chaque page, des parties simulées, erreurs console et captures.
// Prérequis : `npm run server` (API) et `npm run dev` (Vite) lancés.
// Usage : node tests/smoke.mjs [baseUrl]    (PW_CHANNEL=chrome|msedge, défaut msedge)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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
// Rendu logiciel (sans carte graphique) : tout est lent, les délais sont doublés (SMOKE_SLOW pour ajuster).
const SLOW = Number(process.env.SMOKE_SLOW ?? 2);
const until = (p, fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout: timeout * SLOW });

/** Vérifie que la barre live (capsule : en ligne, prochaine vente, musée n°1) affiche des chiffres venus du serveur. */
async function checkLiveBar(p) {
  await until(p, () => /\d/.test(document.querySelector('#livebar [data-k="online"]')?.textContent ?? ''), null, 15000)
    .catch(() => { throw new Error('barre live : « en ligne » jamais reçu'); });
  const bar = await p.evaluate(() => {
    const t = (k) => document.querySelector(`#livebar [data-k="${k}"]`)?.textContent ?? '';
    return { online: Number(t('online').replace(/\s/g, '')), countdown: t('countdown'), top: t('top') };
  });
  if (!(bar.online >= 1)) throw new Error('barre live : 0 joueur en ligne alors que la page est ouverte');
  if (!/^(\d\d:\d\d|\d+ min|\d+ h \d\d|maintenant|en direct · lot \d+\/\d+)$/.test(bar.countdown)) throw new Error('barre live : compte à rebours invalide ' + bar.countdown);
  return bar;
}

// Page d'accueil : la salle rouge, le bouton Jouer, le planning des ventes reçu du serveur.
await check('hub', '/', async (p) => {
  const bar = await checkLiveBar(p);
  console.log('    barre live :', JSON.stringify(bar));
  const play = await p.getAttribute('#playHero', 'href');
  if (play !== '/game/') throw new Error('bouton Jouer : lien inattendu ' + play);
  await until(p, () => document.querySelectorAll('#salesList .sale .left').length >= 2, null, 15000)
    .catch(() => { throw new Error('planning des ventes non reçu'); });
  const cartel = await p.textContent('[data-work="joconde"] .cartel');
  if (!/800,0 M pièces/.test(cartel)) throw new Error('cartel de la Joconde sans sa valeur : ' + cartel);
  await shot(p, 'hub-1-accueil');
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
  // la page vient peut-être de reprendre une session (connexion en cours) : on attend la fin du démarrage,
  // sinon cette connexion réenregistrerait la session juste après qu'on l'a effacée
  await until(p, () => document.body.classList.contains('playing') || document.getElementById('welcome')?.classList.contains('open'), null, 120000);
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 * SLOW });
  await p.fill('#nameInput', name);
  await p.click('#welcomeForm .go');
  await until(p, (n) => window.__game?.state?.name === n && document.body.classList.contains('playing') && window.__game.myPlot >= 0, name, 30000);
}

await check('game-play', '/game/', async (p) => {
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 * SLOW });
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
  // L'œuvre est entre les mains du joueur : on l'accroche soi-même à l'emplacement 1 (E devant le mur)
  if (!(await g(p, () => !!window.__game.carrying))) throw new Error('l’œuvre achetée n’est pas en mains');
  await g(p, () => {
    const { p: at, normal } = window.__game.museum.slotWorld(1);
    window.__game.teleport(at.x + normal.x * 1.2, at.z + normal.z * 1.2);
  });
  await until(p, () => /Accrocher/.test(window.__game.prompt), null, 10000)
    .catch(async () => { throw new Error('pas d’invite pour accrocher : « ' + (await g(p, () => window.__game.prompt)) + ' »'); });
  await p.keyboard.press('KeyE');
  await until(p, () => window.__game.museum.hiddenUid === null && !window.__game.carrying, null, 20000)
    .catch(() => { throw new Error('l’œuvre achetée n’a pas pu être accrochée'); });
  const s1 = await g(p, () => window.__game.state);
  if (s1.artworks[0].slot !== 1 || !(s1.income > 0)) throw new Error('œuvre achetée mal placée ou sans revenu (emplacement ' + s1.artworks[0].slot + ')');

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
    const { p: at, normal } = window.__game.museum.slotWorld(window.__game.state.artworks[0].slot);
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
  await p.waitForSelector('#security.open', { timeout: 20000 });
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
  await g(p, () => window.__game.teleport(-40, -9.4)); // tente du marché noir, entre deux musées
  await until(p, () => /Marché noir/.test(window.__game.prompt), null, 10000).catch(async () => { throw new Error('pas d’invite marché noir : ' + (await g(p, () => window.__game.prompt))); });
  await p.keyboard.press('KeyE');
  await p.waitForSelector('#market.open', { timeout: 20000 });
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
  // classements : 5 onglets (plus riches, semaine, casses, enchères, nations)
  await p.click('#boardBtn');
  await until(p, () => document.querySelectorAll('#boardTabs button').length === 5 && document.querySelectorAll('#boardList li').length >= 1, null, 10000);
  await p.click('#boardTabs [data-board="weekly"]');
  await until(p, () => document.querySelector('#boardTabs .on')?.dataset.board === 'weekly', null, 20000);
  await shot(p, 'boards-1');
  await p.keyboard.press('Escape');
});

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await check('game-mobile', '/game/', async (p) => {
  await p.evaluate(() => localStorage.removeItem('sam-player'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#welcome.open', { timeout: 30000 * SLOW });
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

await browser.close();
process.exit(failures ? 1 : 0);
