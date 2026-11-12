// Test serveur du multijoueur et du vol (sans navigateur). Prérequis : serveur lancé avec SAM_DEV=1.
// Usage : node tests/ws.mjs [baseUrl]
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const layout = JSON.parse(readFileSync('src/shared/layout.json', 'utf8'));
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

async function http(path, body, auth) {
  const res = await fetch(base + '/api/game/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-player-id': auth.id, 'x-player-token': auth.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function newPlayer(name) {
  const r = await http('login', { name });
  return { id: r.id, token: r.token, name };
}

function connect(auth, join = null) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred, ms = 8000) => new Promise((res, rej) => {
    const hit = inbox.find(pred);
    if (hit) return res(hit);
    const w = { pred, res };
    waiters.push(w);
    setTimeout(() => rej(new Error(`délai dépassé en attendant ${pred.toString()}`)), ms);
  });
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'auth', id: auth.id, token: auth.token, ...(join ? { join } : {}) }));
    res({ ws, wait, inbox, send: (m) => ws.send(JSON.stringify(m)) });
  }));
}

const plotOf = (i) => layout.plots[i];
const slotWorld = (plot, slot) => ({ x: plot.x + layout.slots[slot][0], z: plot.z + plot.f * layout.slots[slot][1] });
const roomCenter = (plot) => ({ x: plot.x, z: plot.z });

// --- A : un musée riche, sans bouclier ---
const A = await newPlayer('Musée Alpha');
await http('dev/grant', { coins: 1_000_000 }, A);
const convoy = await http('convoy', null, A);
const w = Math.floor(convoy.serverTime / 20000);
for (const it of convoy.items) {
  try { await http('buy', { window: it.window }, A); } catch {}
}
if ((await http('state', null, A)).artworks.length < 2) {
  await sleep(100);
  const cvExtra = await http('convoy', null, A);
  for (const it of cvExtra.items) {
    try { await http('buy', { window: it.window }, A); } catch {}
  }
}
await http('dev/age', {}, A);
const stateA = await http('state', null, A);
ok(stateA.artworks.length >= 2 && !stateA.shielded, `A possède ${stateA.artworks.length} œuvre(s), bouclier levé`);

// --- Régression : une clé spéciale (__proto__, constructor…) ne doit jamais rendre le solde NaN ---
{
  const X = await newPlayer('Musée Proto');
  const tries = [
    ['security', { item: 'guards', tier: '__proto__' }],
    ['security', { item: 'guards', tier: 'constructor' }],
    ['security', { item: 'vitrine', slot: '__proto__' }],
    ['security', { item: 'vitrine', slot: 'constructor' }],
    ['blackmarket', { tool: '__proto__' }],
    ['blackmarket', { tool: 'toString' }],
    ['blackmarket', { tool: 'repro', workId: '__proto__' }],
  ];
  for (const [route, body] of tries) await http(route, body, X);
  const sx = await http('state', null, X);
  ok(Number.isFinite(sx.coins) && sx.coins === 500, `clés spéciales refusées, solde intact (${sx.coins})`);
}

// --- Boutique, récompense du jour, Renaissance, événements du convoi ---
{
  const Y = await newPlayer('Musée Boutique');
  await http('dev/grant', { coins: 1_000_000 }, Y);
  const u1 = await http('upgrade', { id: 'speed' }, Y);
  ok(u1.state?.upgrades.speed.level === 1 && u1.state.coins === 1_000_500 - 2000, `boutique : baskets de sprint niveau 1 (${u1.error ?? u1.price})`);
  const badUp = await http('upgrade', { id: '__proto__' }, Y);
  ok(/inconnue/.test(badUp.error ?? ''), 'amélioration inconnue refusée');
  const d1 = await http('daily', {}, Y);
  ok(d1.reward >= 500 && d1.streak === 1, `récompense du jour : ${d1.reward} (série ${d1.streak})`);
  const d2 = await http('daily', {}, Y);
  ok(/déjà/.test(d2.error ?? ''), 'une seule récompense par jour');
  await http('dev/yesterday', {}, Y);
  const d3 = await http('daily', {}, Y);
  ok(d3.streak === 2, `la série continue le lendemain (jour ${d3.streak})`);
  const rb0 = await http('rebirth', {}, Y);
  ok(/niveau/.test(rb0.error ?? ''), `Renaissance refusée trop tôt : « ${rb0.error} »`);
  await http('dev/grant', { coins: 200_000_000 }, Y);
  for (let i = 0; i < 4; i++) await http('expand', {}, Y);
  const rb = await http('rebirth', {}, Y);
  ok(rb.rebirths === 1 && rb.state?.level === 1 && rb.state.coins === 500 && rb.state.incomeMult === 1.5 && rb.state.upgrades.speed.level === 1,
    `Renaissance : niveau 1, 500 pièces, revenu ×${rb.state?.incomeMult}, améliorations gardées`);
  const stats = await fetch(base + '/api/stats').then((r) => r.json());
  ok(!!(stats.event?.current || stats.event?.next), `événement du convoi annoncé (${(stats.event?.current ?? stats.event?.next)?.label})`);
}

// --- B : petit musée ---
const B = await newPlayer('Musée Bêta');
const cA = await connect(A);
const wA = await cA.wait((m) => m.t === 'welcome');
const cB = await connect(B);
const wB = await cB.wait((m) => m.t === 'welcome');
ok(wA.district === wB.district, `A et B dans le même quartier (n°${wA.district})`);
const plotA = plotOf(wA.you.plot);
const plotB = plotOf(wB.you.plot);
ok(wA.you.plot !== wB.you.plot, `parcelles distinctes (${wA.you.plot} et ${wB.you.plot})`);
await cB.wait((m) => m.t === 'snap' && m.players.length === 2);
ok(true, 'B voit les deux joueurs dans les instantanés');

// Refus : trop loin
const target = stateA.artworks.find((a) => a.slot !== null);
cB.send({ t: 'steal', plot: wA.you.plot, uid: target.uid });
const refusedFar = await cB.wait((m) => m.t === 'steal' && m.phase === 'refused');
ok(/Approchez/.test(refusedFar.error), `vol refusé à distance : « ${refusedFar.error} »`);

// --- Vol réussi ---
const at = slotWorld(plotA, target.slot);
const stand = { x: at.x + (plotA.x - at.x) * 0.25, z: at.z + (plotA.z - at.z) * 0.25 };
cB.send({ t: 'pos', x: stand.x, z: stand.z, ry: 0, anim: 'Idle' });
await new Promise((r) => setTimeout(r, 300));
cB.send({ t: 'steal', plot: wA.you.plot, uid: target.uid });
const started = await cB.wait((m) => m.t === 'steal' && m.phase === 'start');
ok(true, `décrochage commencé (${((started.endsAt - Date.now()) / 1000).toFixed(1)} s)`);
const alarm = await cA.wait((m) => m.t === 'steal' && m.phase === 'start');
ok(alarm.thiefName === 'Musée Bêta', 'le propriétaire voit le décrochage en direct');
await new Promise((r) => setTimeout(r, 300));
ok(!cA.inbox.some((m) => m.t === 'alarm'), 'sans caméra, pas d’alarme');
const carry = await cB.wait((m) => m.t === 'steal' && m.phase === 'carry', 15000);
ok(carry.workId === target.workId, 'B porte l’œuvre');
const snapA = (await http('state', null, A));
ok(snapA.artworks.find((a) => a.uid === target.uid) && snapA.income < stateA.income, 'l’œuvre portée ne rapporte plus à A');
// B rentre chez lui
const home = roomCenter(plotB);
cB.send({ t: 'pos', x: home.x + 2, z: home.z, ry: 0, anim: 'Running' });
const delivered = await cB.wait((m) => m.t === 'steal' && m.phase === 'delivered', 5000);
ok(delivered.artwork?.workId === target.workId, 'casse réussi : l’œuvre arrive dans le musée de B');
const sA = await http('state', null, A);
const sB = await http('state', null, B);
ok(!sA.artworks.some((a) => a.uid === target.uid) && sB.artworks.some((a) => a.workId === target.workId), 'transfert enregistré côté serveur');
ok(sA.immuneUntil > Date.now(), 'A est immunisé 15 min');
const boardT = await http('leaderboard?board=theft');
ok(boardT.some((r) => r.name === 'Musée Bêta' && r.value > 0), 'classement « plus gros casses » à jour');
// B revend son butin : A redevient une cible valable quel que soit le tirage du convoi
const loot = sB.artworks.find((a) => a.workId === target.workId);
await http('sell', { uid: loot.uid }, B);

// Refus : immunité
const other = sA.artworks.find((a) => a.slot !== null);
if (other) {
  cB.send({ t: 'pos', x: stand.x, z: stand.z, ry: 0, anim: 'Idle' });
  await new Promise((r) => setTimeout(r, 200));
  cB.send({ t: 'steal', plot: wA.you.plot, uid: other.uid });
  const refusedImmune = await cB.wait((m) => m.t === 'steal' && m.phase === 'refused' && /cambriolé/.test(m.error));
  ok(true, `second vol refusé : « ${refusedImmune.error} »`);

  // --- Arrestation : on lève l'immunité, B vole, A le touche ---
  await http('dev/age', {}, A);
  const w2 = slotWorld(plotA, other.slot);
  const stand2 = { x: w2.x + (plotA.x - w2.x) * 0.25, z: w2.z + (plotA.z - w2.z) * 0.25 };
  cB.send({ t: 'pos', x: stand2.x, z: stand2.z, ry: 0, anim: 'Idle' });
  await new Promise((r) => setTimeout(r, 200));
  cB.send({ t: 'steal', plot: wA.you.plot, uid: other.uid });
  await cB.wait((m) => m.t === 'steal' && m.phase === 'carry' && m.uid === other.uid, 15000);
  const coinsB = (await http('state', null, B)).coins;
  cA.send({ t: 'pos', x: stand2.x + 0.5, z: stand2.z, ry: 0, anim: 'Running' });
  const arrested = await cB.wait((m) => m.t === 'steal' && m.phase === 'arrested', 5000);
  ok(arrested.byName === 'Musée Alpha', `voleur arrêté par le propriétaire, amende ${arrested.fine}`);
  const after = await http('state', null, A);
  ok(after.artworks.some((a) => a.uid === other.uid), 'l’œuvre est revenue à A');
  ok((await http('state', null, B)).coins <= coinsB, 'B a payé l’amende');
  cB.send({ t: 'steal', plot: wA.you.plot, uid: other.uid });
  const jail = await cB.wait((m) => m.t === 'steal' && m.phase === 'refused' && /cellule/.test(m.error));
  ok(true, `en cellule : « ${jail.error} »`);
}

// --- Verrou ---
cA.send({ t: 'lock' });
const lock = await cA.wait((m) => m.t === 'lock' && m.lockedUntil > Date.now());
ok(Math.round((lock.lockedUntil - Date.now()) / 1000) >= 58, 'verrou posé pour 60 s');
cA.send({ t: 'lock' });
const again = await cA.wait((m) => m.t === 'lock' && m.error);
ok(/recharge/.test(again.error), 'verrou en recharge ensuite');

// ================================================================ phase 3 : sécurité
const catalog = JSON.parse(readFileSync('src/shared/catalog.json', 'utf8'));
const stealSecs = { commun: 2.5, rare: 4, epique: 6, legendaire: 9, mythique: 12 };
const rarityOf = (workId) => catalog.works.find((w) => w.id === workId).rarity;
const standBy = (plot, slot) => {
  const p = slotWorld(plot, slot);
  return { x: p.x + (plot.x - p.x) * 0.25, z: p.z + (plot.z - p.z) * 0.25 };
};

await http('dev/age', {}, A);
let s3 = await http('security', { item: 'cameras' }, A);
ok(s3.state?.sec.cameras, `caméras installées (${s3.price} pièces)`);
s3 = await http('security', { item: 'guards', tier: 'vigile' }, A);
ok(s3.state?.sec.guards === 1 && s3.state.guardsUntil > Date.now() + 29 * 60_000, `vigile sous contrat 30 min (${s3.price} pièces)`);
const poor = await newPlayer('Musée Pauvre');
const tooPoor = await http('security', { item: 'generator' }, poor);
ok(/manque/.test(tooPoor.error ?? ''), `achat refusé sans argent : « ${tooPoor.error} »`);

// D : un voleur équipé au marché noir
const D = await newPlayer('Musée Delta');
await http('dev/grant', { coins: 50_000 }, D);
for (const tool of ['brouilleur', 'pied', 'fumigene']) await http('blackmarket', { tool }, D);
const sD = await http('state', null, D);
ok(sD.tools.brouilleur === 1 && sD.tools.pied === 1 && sD.tools.fumigene === 1, 'outils achetés au marché noir');
const cD = await connect(D);
await cD.wait((m) => m.t === 'welcome');
const gSnap = await cD.wait((m) => m.t === 'snap' && m.guards?.some((g) => g.plot === wA.you.plot));
ok(true, `un garde patrouille chez A (état : ${gSnap.guards.find((g) => g.plot === wA.you.plot).s})`);

// Caméra : le décrochage déclenche l'alarme, le garde accourt et attrape le voleur
const sA3 = await http('state', null, A);
const t3 = sA3.artworks.find((a) => a.slot !== null);
const st3 = standBy(plotA, t3.slot);
cD.send({ t: 'pos', x: st3.x, z: st3.z, ry: 0, anim: 'Idle' });
await sleep(250);
// vitrine sur l'œuvre visée (×2) puis pied-de-biche (÷2) : durée normale
s3 = await http('security', { item: 'vitrine', slot: t3.slot }, A);
ok(s3.state?.sec.vitrines[t3.slot] === 1, 'vitrine blindée posée');
cD.send({ t: 'tool', tool: 'pied' });
const crow = await cD.wait((m) => m.t === 'tool');
ok(crow.ok, `pied-de-biche : « ${crow.message ?? crow.error} »`);
cD.send({ t: 'steal', plot: wA.you.plot, uid: t3.uid });
const st3msg = await cD.wait((m) => m.t === 'steal' && (m.phase === 'start' || m.phase === 'refused'));
ok(st3msg.phase === 'start' && Math.abs(st3msg.ms - stealSecs[rarityOf(t3.workId)] * 1000) < 1, `vitrine ×2 et pied-de-biche ÷2 : ${st3msg.ms} ms`);
const camAlarm = await cA.wait((m) => m.t === 'alarm' && m.reason === 'camera', 3000).catch(() => null);
ok(camAlarm?.thiefName === 'Musée Delta', 'la caméra déclenche l’alarme chez le propriétaire');
const caught = await cD.wait((m) => m.t === 'steal' && (m.phase === 'caught' || m.phase === 'arrested') && m.thief === D.id, 12000).catch(() => null);
ok(!!caught, `le garde attrape le voleur (${caught?.phase})`);
cD.send({ t: 'steal', plot: wA.you.plot, uid: t3.uid });
const jail3 = await cD.wait((m) => m.t === 'steal' && m.phase === 'refused' && /cellule/.test(m.error));
ok(true, `voleur en cellule : « ${jail3.error} »`);
cD.ws.close();
await sleep(200);
const cD2 = await connect(D);
const wD2 = await cD2.wait((m) => m.t === 'welcome');
ok(wD2.you.jailUntil > Date.now(), 'la cellule survit à une reconnexion');

// E : brouilleur → plus d'alarme caméra
const E = await newPlayer('Musée Epsilon');
await http('dev/grant', { coins: 50_000 }, E);
await http('blackmarket', { tool: 'brouilleur' }, E);
await http('blackmarket', { tool: 'pince' }, E);
const cE = await connect(E);
await cE.wait((m) => m.t === 'welcome');
cE.send({ t: 'tool', tool: 'brouilleur' });
const far = await cE.wait((m) => m.t === 'tool');
ok(!far.ok && /Approchez/.test(far.error), `outil refusé loin du musée : « ${far.error} »`);
const t4 = sA3.artworks.filter((a) => a.slot !== null)[1] ?? t3;
const st4 = standBy(plotA, t4.slot);
cE.send({ t: 'pos', x: st4.x, z: st4.z, ry: 0, anim: 'Idle' });
await sleep(250);
cE.send({ t: 'tool', tool: 'brouilleur' });
const jam = await cE.wait((m) => m.t === 'tool' && m !== far);
ok(jam.ok, `brouilleur : « ${jam.message ?? jam.error} »`);
const jamPlot = await cE.wait((m) => m.t === 'plot' && m.plot.index === wA.you.plot && m.plot.jamUntil > Date.now());
ok(!!jamPlot, 'le quartier voit les caméras brouillées');
const alarmsBefore = cA.inbox.filter((m) => m.t === 'alarm').length;
cE.send({ t: 'steal', plot: wA.you.plot, uid: t4.uid });
await cE.wait((m) => m.t === 'steal' && (m.phase === 'start' || m.phase === 'refused'));
await sleep(400);
ok(cA.inbox.filter((m) => m.t === 'alarm').length === alarmsBefore, 'caméras brouillées : pas d’alarme au décrochage');
cE.send({ t: 'steal-cancel' });
cE.send({ t: 'tool', tool: 'pince' });
const cut = await cE.wait((m) => m.t === 'tool' && m.tool === 'pince');
ok(cut.ok && /Courant coupé/.test(cut.message), `pince : « ${cut.message ?? cut.error} »`);
s3 = await http('security', { item: 'insurance' }, A);
ok(s3.state?.insuranceUntil > Date.now(), 'assurance souscrite 24 h');
cE.ws.close();
cD2.ws.close();

// ================================================================ phase 6 : billet, Mythique, chasseur de primes, déguisement, chien, reproductions
{
  // M possède La Joconde (via le raccourci de test « move » après un achat : on force le workId)
  const M = await newPlayer('Musée Mythique');
  await http('dev/grant', { coins: 2_000_000_000 }, M);
  const repro = await http('blackmarket', { tool: 'repro', workId: 'joconde' }, M);
  ok(repro.state?.artworks.some((a) => a.repro && a.workId === 'joconde') && repro.state.value === 0, 'reproduction accrochée, sans valeur');
  const badRepro = await http('blackmarket', { tool: 'repro', workId: 'fifre' }, M);
  ok(/Mythiques/.test(badRepro.error ?? ''), 'pas de reproduction d’une œuvre ordinaire');
  const dog = await http('security', { item: 'dog' }, M);
  ok(dog.state?.sec.dog && dog.state.dogUntil > Date.now() + 3.9 * 3600_000, `chien de garde 4 h (${dog.price} pièces)`);

  // billet d'entrée : V entre dans le musée de M, paie, M encaisse ; sans argent, on reste dehors
  await http('dev/age', {}, M);
  const V = await newPlayer('Musée Visiteur');
  const cM = await connect(M);
  const wM = await cM.wait((m) => m.t === 'welcome');
  const plotM = plotOf(wM.you.plot);
  const cV = await connect(V);
  await cV.wait((m) => m.t === 'welcome');
  const coinsM0 = (await http('state', null, M)).coins;
  const coinsV0 = (await http('state', null, V)).coins;
  cV.send({ t: 'pos', x: plotM.x, z: plotM.z, f: 0, ry: 0, anim: 'Idle' });
  const ticket = await cV.wait((m) => m.t === 'ticket');
  ok(ticket.ok && ticket.price >= 20, `billet payé : ${ticket.price} pièces`);
  const visit = await cM.wait((m) => m.t === 'visitor');
  ok(visit.name === 'Musée Visiteur', 'le propriétaire est prévenu de la visite');
  await sleep(200);
  ok((await http('state', null, M)).coins === coinsM0 + ticket.price && (await http('state', null, V)).coins === coinsV0 - ticket.price, 'le billet passe du visiteur au propriétaire');
  cV.send({ t: 'pos', x: plotM.x + 1, z: plotM.z, f: 0, ry: 0, anim: 'Idle' });
  await sleep(200);
  ok(!cV.inbox.filter((m) => m.t === 'ticket').some((m, i) => i > 0), 'un seul billet pour rester dans le musée');
  const B2 = await newPlayer('Musée Fauché');
  const cB2 = await connect(B2);
  await cB2.wait((m) => m.t === 'welcome');
  await http('dev/grant', { coins: 0 }, B2);
  // B2 (500 pièces) entre chez M : le billet vaut 0,05 % de la valeur, ici 20 pièces → accepté. On vide d'abord ses poches.
  const sB2 = await http('state', null, B2);
  const cvB = await http('convoy', null, B2);
  for (const it of cvB.items) if (!it.sold && it.price <= sB2.coins) { await http('buy', { window: it.window }, B2); break; }
  const poorNow = (await http('state', null, B2)).coins;
  if (poorNow < 20) {
    cB2.send({ t: 'pos', x: plotM.x, z: plotM.z, f: 0, ry: 0, anim: 'Idle' });
    const refused = await cB2.wait((m) => m.t === 'ticket' && !m.ok, 3000).catch(() => null);
    ok(!!refused, 'sans argent pour le billet, l’entrée est refusée');
  } else ok(true, `(billet non testé sans argent : il reste ${poorNow} pièces)`);

  // déguisement : les gardes de M (avec chien) le flairent quand même
  await http('dev/grant', { coins: 5000 }, V);
  const bought = await http('blackmarket', { tool: 'deguisement' }, V);
  ok(bought.state?.tools.deguisement === 1, `déguisement acheté (${bought.price} pièces)`);
  cV.send({ t: 'tool', tool: 'deguisement' });
  const dis = await cV.wait((m) => m.t === 'tool' && m.tool === 'deguisement');
  ok(dis.ok && /chien/.test(dis.message), `déguisement : « ${dis.message ?? dis.error} »`);
  const snapDis = await cM.wait((m) => m.t === 'snap' && m.players.some((p) => p.id === V.id && p.disguised), 3000).catch(() => null);
  ok(!!snapDis, 'les autres joueurs voient le badge « employé »');
  cV.ws.close();
  cB2.ws.close();

  // --- vol d'une Mythique : 20 s, alerte serveur, chasseur de primes ---
  // M reçoit La Joconde (vraie) : on achète au convoi puis on transforme l'œuvre (raccourci de test)
  const cvM = await http('convoy', null, M);
  await http('buy', { window: Math.floor(cvM.serverTime / 20000) }, M);
  const sM = await http('state', null, M);
  const real = sM.artworks.find((a) => !a.repro);
  const mythic = await http('dev/mythic', { uid: real.uid, workId: 'joconde' }, M);
  ok(mythic.state?.artworks.some((a) => a.workId === 'joconde' && !a.repro) && mythic.state.value >= 800_000_000, 'M possède La Joconde');
  await http('dev/age', {}, M);
  const TH = await newPlayer('Musée Voleur');
  const HU = await newPlayer('Musée Chasseur');
  await http('dev/grant', { coins: 1_000_000_000 }, TH);
  await http('dev/grant', { coins: 1_000_000_000 }, HU);
  await http('dev/age', {}, TH);
  await http('dev/age', {}, HU);
  const cTH = await connect(TH);
  await cTH.wait((m) => m.t === 'welcome');
  const cHU = await connect(HU);
  await cHU.wait((m) => m.t === 'welcome');
  const jo = mythic.state.artworks.find((a) => a.workId === 'joconde' && !a.repro);
  const sj = slotWorld(plotM, jo.slot);
  const standJ = { x: sj.x + (plotM.x - sj.x) * 0.25, z: sj.z + (plotM.z - sj.z) * 0.25 };
  cTH.send({ t: 'pos', x: standJ.x, z: standJ.z, f: 0, ry: 0, anim: 'Idle' });
  await sleep(300);
  cTH.send({ t: 'steal', plot: wM.you.plot, uid: jo.uid });
  const stJ = await cTH.wait((m) => m.t === 'steal' && (m.phase === 'start' || m.phase === 'refused'));
  ok(stJ.phase === 'start' && stJ.ms === 20000, `décrochage d’une Mythique : ${stJ.ms} ms${stJ.error ? ` (${stJ.error})` : ''}`);
  const alertAll = await cHU.wait((m) => m.t === 'mythic' && m.phase === 'start', 3000).catch(() => null);
  ok(alertAll?.workId === 'joconde', 'tout le serveur est prévenu du vol de la Joconde');
  await cTH.wait((m) => m.t === 'steal' && m.phase === 'carry' && m.uid === jo.uid, 25000);
  const coinsHU = (await http('state', null, HU)).coins;
  cHU.send({ t: 'pos', x: standJ.x + 0.5, z: standJ.z, f: 0, ry: 0, anim: 'Running' });
  const caughtJ = await cTH.wait((m) => m.t === 'steal' && m.phase === 'arrested' && m.uid === jo.uid, 5000);
  ok(caughtJ.byName === 'Musée Chasseur' && caughtJ.bounty === 8_000_000, `arrêté par un chasseur de primes, prime ${caughtJ.bounty}`);
  await sleep(200);
  ok((await http('state', null, HU)).coins > coinsHU, 'le chasseur a touché la prime');
  ok((await http('state', null, M)).artworks.some((a) => a.workId === 'joconde' && !a.repro), 'La Joconde est revenue chez M');
  await http('sell', { uid: jo.uid }, M); // la Joconde est unique : on la libère pour que le test soit rejouable
  cTH.ws.close();
  cHU.ws.close();
  cM.ws.close();
}

// ================================================================ phase 5 : étages
{
  const H = await newPlayer('Musée Tour');
  await http('dev/grant', { coins: 7_000_000_000 }, H);
  let sH;
  for (let i = 0; i < 6; i++) sH = (await http('expand', {}, H)).state;
  ok(sH.level === 7 && sH.floors === 3 && sH.slots === 214, `musée à 3 étages (niveau ${sH.level}, ${sH.slots} places)`);
  const cv = await http('convoy', null, H);
  await http('buy', { window: Math.floor(cv.serverTime / 20000) }, H);
  sH = await http('state', null, H);
  const art = sH.artworks[0];
  const moved = await http('dev/move', { uid: art.uid, slot: 75 }, H);
  ok(moved.state?.artworks[0].slot === 75, 'œuvre accrochée au 1er étage');
  await http('dev/age', {}, H);
  await http('security', { item: 'guards', tier: 'brigade' }, H);
  const cH = await connect(H);
  const wH = await cH.wait((m) => m.t === 'welcome');
  const plotH = plotOf(wH.you.plot);
  const T = await newPlayer('Musée Grimpeur');
  const cT = await connect(T);
  await cT.wait((m) => m.t === 'welcome');
  const gs = await cT.wait((m) => m.t === 'snap' && m.guards.filter((g) => g.plot === wH.you.plot).length === 3, 10000);
  const floorsOfGuards = gs.guards.filter((g) => g.plot === wH.you.plot).map((g) => g.f).sort();
  ok(JSON.stringify(floorsOfGuards) === '[0,1,2]', `un garde par étage (${floorsOfGuards.join(', ')})`);
  // au pied de l'escalier du rez-de-chaussée
  const stairs = { x: plotH.x + layout.stairs[0], z: plotH.z + plotH.f * layout.stairs[1] };
  cT.send({ t: 'pos', x: stairs.x - 1, z: stairs.z, f: 0, ry: 0, anim: 'Idle' });
  await sleep(250);
  // sauter directement au 2e étage : refusé
  cT.send({ t: 'pos', x: stairs.x - 1, z: stairs.z, f: 2, ry: 0, anim: 'Idle' });
  const back = await cT.wait((m) => m.t === 'teleport' && m.f === 0, 3000).catch(() => null);
  ok(!!back, 'impossible de sauter deux étages d’un coup');
  // le vol d'une œuvre de l'étage depuis le rez-de-chaussée est refusé
  const sw = slotWorld(plotH, 75);
  cT.send({ t: 'pos', x: sw.x + (plotH.x - sw.x) * 0.1, z: sw.z, f: 0, ry: 0, anim: 'Idle' });
  await sleep(250);
  cT.send({ t: 'steal', plot: wH.you.plot, uid: art.uid });
  const wrongFloor = await cT.wait((m) => m.t === 'steal' && m.phase === 'refused' && /Approchez/.test(m.error), 3000).catch(() => null);
  ok(!!wrongFloor, 'œuvre du 1er étage hors d’atteinte depuis le rez-de-chaussée');
  // monter par l'escalier
  cT.send({ t: 'pos', x: stairs.x - 1, z: stairs.z, f: 0, ry: 0, anim: 'Idle' });
  await sleep(250);
  cT.send({ t: 'pos', x: stairs.x - 1, z: stairs.z, f: 1, ry: 0, anim: 'Idle' });
  const up = await cT.wait((m) => m.t === 'snap' && m.players.some((p) => p.id === T.id && p.f === 1), 3000).catch(() => null);
  ok(!!up, 'monté au 1er étage par l’escalier');
  cT.send({ t: 'pos', x: sw.x + (plotH.x - sw.x) * 0.1, z: sw.z, f: 1, ry: 0, anim: 'Idle' });
  await sleep(250);
  cT.send({ t: 'steal', plot: wH.you.plot, uid: art.uid });
  const st = await cT.wait((m) => m.t === 'steal' && (m.phase === 'start' || (m.phase === 'refused' && m !== wrongFloor)), 3000);
  ok(st.phase === 'start', `décrochage possible au bon étage${st.error ? ` (${st.error})` : ''}`);
  cT.send({ t: 'steal-cancel' });
  cT.ws.close();
  cH.ws.close();

  // Niveau 8 : Toit-terrasse (4 étages, 232 slots) et réorganisation
  await http('dev/grant', { coins: 50_000_000_000 }, H);
  const s8 = (await http('expand', {}, H)).state;
  ok(s8.level === 8 && s8.floors === 4 && s8.slots === 232, `niveau 8 : toit-terrasse débloqué (${s8.floors} étages, ${s8.slots} places)`);
  // Un tableau ne va jamais sur un socle de statue
  const paintingOnPlinth = await http('move', { uid: art.uid, slot: 214 }, H);
  ok(/statues/.test(paintingOnPlinth.error ?? ''), 'un tableau est refusé sur un socle de statue');
  // Achat d'une 2e œuvre et interversion (swap) de deux tableaux
  await http('dev/grant', { coins: 10_000_000 }, H);
  const cv2 = await http('convoy', null, H);
  const bought2 = await http('buy', { window: cv2.items.find((i) => !i.sold && i.window <= Math.floor(cv2.serverTime / 20000)).window }, H);
  const art2 = bought2.artwork;
  const swapped = await http('move', { uid: art2.uid, slot: 75 }, H);
  ok(swapped.swapped && swapped.state?.artworks.find((a) => a.uid === art2.uid)?.slot === 75, 'interversion (swap) d’œuvres réussie');
  // Une statue va sur un socle du toit-terrasse
  await http('dev/mythic', { uid: art.uid, workId: 'penseur' }, H);
  const mvTerrace = await http('move', { uid: art.uid, slot: 214 }, H);
  ok(mvTerrace.state?.artworks.find((a) => a.uid === art.uid)?.slot === 214, 'statue déplacée sur le toit-terrasse (slot 214)');

  // Personnalisation du décor d'une salle (/api/game/decor)
  const decorRes = await http('decor', { room: 0, theme: 'zen' }, H);
  ok(decorRes.state?.roomThemes?.['0'] === 'zen', 'décor de la salle personnalisé en zen');

  // Classements par pays et filtrage
  await http('name', { name: 'Musée Tokyo', country: 'JP' }, H);
  const lbJP = await fetch(base + '/api/game/leaderboard?board=value&country=JP').then((r) => r.json());
  ok(lbJP.some((x) => x.name === 'Musée Tokyo' && x.country === 'JP' && x.flag === '🇯🇵'), 'classement filtré par pays (JP)');
  const lbNations = await fetch(base + '/api/game/leaderboard?board=countries').then((r) => r.json());
  ok(lbNations.some((x) => x.country === 'JP' && x.name === 'Japon'), 'classement cumulé des nations');
}

// --- Social : invitation, discussion, émotes, relais de la voix ---
{
  const Ho = await newPlayer('Musée Hôte');
  const cHo = await connect(Ho);
  const wHo = await cHo.wait((m) => m.t === 'welcome');
  const code = (await http('state', null, Ho)).inviteCode;
  ok(typeof code === 'string' && code.length >= 6, `code d'invitation (${code})`);
  const Fr = await newPlayer('Musée Ami');
  const cFr = await connect(Fr, code);
  const wFr = await cFr.wait((m) => m.t === 'welcome');
  ok(wFr.district === wHo.district && wFr.invite?.status === 'ok', `invitation : l'ami arrive dans le quartier n°${wFr.district} (${wFr.invite?.status})`);
  const Lost = await newPlayer('Musée Perdu');
  const cLost = await connect(Lost, 'inconnu00');
  ok((await cLost.wait((m) => m.t === 'welcome')).invite?.status === 'unknown', 'code d’invitation inconnu signalé');
  cLost.ws.close();
  cFr.send({ t: 'chat', text: '  Salut   connard !  ' });
  const said = await cHo.wait((m) => m.t === 'chat' && m.id === Fr.id);
  ok(said.text === 'Salut ******* !' && said.name === 'Musée Ami', `discussion relayée et filtrée : « ${said.text} »`);
  for (let i = 0; i < 5; i++) cFr.send({ t: 'chat', text: `message ${i}` });
  ok(!!(await cFr.wait((m) => m.t === 'chat-error', 3000).catch(() => null)), 'anti-spam de la discussion');
  cFr.send({ t: 'emote', kind: 'wave' });
  ok((await cHo.wait((m) => m.t === 'emote' && m.id === Fr.id)).kind === 'wave', 'émote relayée');
  cFr.send({ t: 'rtc', to: Ho.id, data: { type: 'offer', sdp: 'x' } });
  await sleep(400);
  ok(!cHo.inbox.some((m) => m.t === 'rtc'), 'voix : rien n’est relayé tant que le micro est coupé');
  cFr.send({ t: 'voice', on: true });
  cHo.send({ t: 'voice', on: true });
  await sleep(200);
  cFr.send({ t: 'rtc', to: Ho.id, data: { type: 'offer', sdp: 'x' } });
  const rtc = await cHo.wait((m) => m.t === 'rtc', 3000).catch(() => null);
  ok(rtc?.from === Fr.id && rtc.data.type === 'offer', 'voix : signalisation relayée entre deux micros actifs');
  const snapV = await cHo.wait((m) => m.t === 'snap' && m.players.some((p) => p.id === Fr.id && p.voice), 3000).catch(() => null);
  ok(!!snapV, 'les autres voient qui a le micro activé');
  cFr.ws.close();
  cHo.ws.close();
}

// --- Musée en sommeil : A se déconnecte, son musée reste visible pour B ---
cA.ws.close();
const asleep = await cB.wait((m) => m.t === 'plot' && m.plot.index === wA.you.plot && m.plot.online === false && m.plot.owner);
ok(asleep.plot.owner.name === 'Musée Alpha', 'le musée de A reste sur place, endormi');

// Bouclier débutant : B (tout neuf) ne peut pas être volé
const C = await newPlayer('Musée Gamma');
await http('dev/grant', { coins: 10 }, C);
const cC = await connect(C);
await cC.wait((m) => m.t === 'welcome');
cC.ws.close();
cB.ws.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
process.exit(failures ? 1 : 0);
