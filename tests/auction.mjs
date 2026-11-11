// Test serveur des enchères, des notifications et de l'admin (sans navigateur). Prérequis : serveur lancé avec SAM_DEV=1.
// Usage : node tests/auction.mjs [baseUrl]
import WebSocket from 'ws';

const base = process.argv[2] ?? 'http://127.0.0.1:3001';
const ADMIN = { 'x-admin-token': 'dev-admin', 'content-type': 'application/json' };
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, body, auth) {
  const res = await fetch(base + '/api/game/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-player-id': auth.id, 'x-player-token': auth.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
async function admin(method, path, body, headers = ADMIN) {
  const res = await fetch(base + '/api/admin/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json()) };
}
async function newPlayer(name, coins = 0) {
  const r = await http('login', { name });
  const p = { id: r.id, token: r.token, name };
  if (coins) await http('dev/grant', { coins }, p);
  return p;
}
function connect(auth) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  /** Attend un message ; `fresh` ignore ceux déjà reçus. */
  const wait = (pred, ms = 10000, fresh = false) => new Promise((res, rej) => {
    const hit = fresh ? null : inbox.find(pred);
    if (hit) return res(hit);
    const w = { pred, res };
    waiters.push(w);
    setTimeout(() => rej(new Error(`délai dépassé en attendant ${pred.toString()}`)), ms);
  });
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'auth', id: auth.id, token: auth.token }));
    res({ ws, wait, inbox, send: (m) => ws.send(JSON.stringify(m)) });
  }));
}

// --- Admin : protégé par jeton ---
const denied = await admin('GET', 'overview', null, { 'x-admin-token': 'mauvais' });
ok(denied.status === 401, 'admin refusé avec un mauvais jeton');
const ov = await admin('GET', 'overview');
ok(ov.status === 200 && ov.upcoming.length >= 3, `admin : ${ov.upcoming.length} ventes à venir (${ov.upcoming.slice(0, 3).map((s) => s.label).join(', ')})`);
const badSale = await admin('POST', 'sales', { title: 'Vide', at: Date.now() + 60_000, lots: [] });
ok(badSale.status === 422, `vente sans lot refusée : « ${badSale.error} »`);

// --- Une vente admin abuse d'un lot, lancée tout de suite ---
const est = 150000; // La Grande Vague, Épique
const created = await admin('POST', 'sales', { title: 'Test enchères', at: Date.now() + 3_600_000, lots: [{ workId: 'grande-vague', frame: 'normal' }] });
ok(created.status === 200 && created.sale.id.startsWith('abuse-'), `vente admin créée (${created.sale?.id})`);
const ov1 = await admin('GET', 'overview');
ok(ov1.upcoming.some((s) => s.id === created.sale.id && s.admin), 'la vente admin apparaît au planning');

const P = await newPlayer('Musée Enchérisseur', 1_000_000);
const Q = await newPlayer('Musée Rival', 1_000_000);
const cP = await connect(P);
const cQ = await connect(Q);
await cP.wait((m) => m.t === 'welcome');
await cQ.wait((m) => m.t === 'welcome');
cP.send({ t: 'hall-enter' });
cQ.send({ t: 'hall-enter' });
const hallP = await cP.wait((m) => m.t === 'hall' && m.you.seat !== null);
const hallQ = await cQ.wait((m) => m.t === 'hall' && m.you.seat !== null);
ok(hallP.you.seat !== hallQ.you.seat, `places attribuées automatiquement (${hallP.you.seat} et ${hallQ.you.seat})`);
ok(hallP.seats.filter((s) => s.npc).length === 8, 'collectionneurs PNJ assis dans la salle');

const started = await admin('POST', `sales/${created.sale.id}/start`);
ok(started.status === 200, 'vente lancée par l’admin (mode test)');
const saleStart = await cP.wait((m) => m.t === 'sale' && m.phase === 'start' && m.id === created.sale.id);
ok(saleStart.workId === 'grande-vague', 'tout le serveur est prévenu du début de la vente');
const live = await (await fetch(base + '/api/stats')).json();
ok(live.liveSale?.workId === 'grande-vague', 'la barre live voit la vente en direct');

cQ.send({ t: 'bid', amount: est });
const early = await cQ.wait((m) => m.t === 'hall-error', 3000);
ok(/pas ouvertes/.test(early.error), `enchère refusée pendant la présentation : « ${early.error} »`);

const bidding = await cP.wait((m) => m.t === 'hall' && m.lot?.phase === 'bidding', 9000, true);
ok(bidding.lot.price === est * 0.5, `mise à prix 50 % de l’estimation (${bidding.lot.price})`);

// Q enchérit au minimum : son argent est bloqué
const coinsQ0 = (await http('state', null, Q)).coins;
const minNow = (await cQ.wait((m) => m.t === 'hall' && m.lot?.phase === 'bidding', 3000)).lot.min;
cQ.send({ t: 'bid', amount: minNow + 40000 });
await cQ.wait((m) => m.t === 'hall' && m.lot?.leader?.id === Q.id, 5000, true);
const sQ1 = await http('state', null, Q);
ok(sQ1.coins === coinsQ0 - (minNow + 40000) && sQ1.escrow === minNow + 40000, `argent de Q bloqué (${sQ1.escrow})`);
cQ.send({ t: 'bid', amount: minNow + 999999 });
const self = await cQ.wait((m) => m.t === 'hall-error' && /déjà/.test(m.error), 3000);
ok(!!self, 'on ne surenchérit pas sur soi-même');
const tooLow = (minNow + 40000) + 1;
cP.send({ t: 'bid', amount: tooLow });
const low = await cP.wait((m) => m.t === 'hall-error' && /minimale/.test(m.error), 3000);
ok(!!low, `enchère trop basse refusée : « ${low.error} »`);

// P met 97 % de l'estimation : aucun PNJ ne peut suivre (ils s'arrêtent entre 60 et 95 %)
const big = Math.round(est * 0.97);
cP.send({ t: 'bid', amount: big });
await cP.wait((m) => m.t === 'hall' && m.lot?.leader?.id === P.id && m.lot.price === big, 5000, true);
const sQ2 = await http('state', null, Q);
ok(sQ2.coins === coinsQ0 && sQ2.escrow === 0, 'Q surenchéri : son argent lui est rendu');
const won = await cP.wait((m) => m.t === 'won', 40000);
ok(won.workId === 'grande-vague' && won.price === big, `adjugé à P pour ${won.price}`);
const sP = await http('state', null, P);
ok(sP.artworks.some((a) => a.workId === 'grande-vague' && a.slot !== null) && sP.escrow === 0, 'l’œuvre est accrochée dans le musée de P');
const boardA = await http('leaderboard?board=auction');
ok(boardA.some((r) => r.name === 'Musée Enchérisseur' && r.value === big), 'classement « plus grosses enchères » à jour');
const boardW = await http('leaderboard?board=weekly');
ok(boardW.some((r) => r.name === 'Musée Enchérisseur'), 'classement de la semaine à jour');
const sold = await cQ.wait((m) => m.t === 'sale' && m.phase === 'sold');
ok(sold.winner === 'Musée Enchérisseur', 'la vente est annoncée à tous');
const end = await cP.wait((m) => m.t === 'sale' && m.phase === 'end' && m.id === created.sale.id, 10000);
ok(!!end, 'fin de la vente');

// --- Notifications : abonnement, réglages, envoi à un joueur absent ---
const R = await newPlayer('Musée Absent');
const fakeSub = { endpoint: 'https://127.0.0.1:9/push/fake', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const subR = await http('push/subscribe', { subscription: fakeSub, prefs: { cash: false } }, R);
ok(subR.state?.push.devices === 1 && subR.state.push.prefs.cash === false, 'appareil abonné, catégorie « caisse pleine » coupée');
const badSub = await http('push/subscribe', { subscription: { endpoint: 'javascript:alert(1)' } }, R);
ok(/invalide/.test(badSub.error ?? ''), 'abonnement invalide refusé');
const ab = await admin('POST', 'sales', { title: 'Nuit des Mythiques', at: Date.now() + 3_600_000, lots: [{ workId: 'perle', frame: 'diamant' }], announce: true });
ok(ab.status === 200 && ab.sale.announced, 'vente admin annoncée');
const announced = await cP.wait((m) => m.t === 'sale' && m.phase === 'soon' && m.id === ab.sale.id, 3000);
ok(!!announced, 'annonce diffusée dans le jeu');
await sleep(300);
const parisHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const ov2 = await admin('GET', 'overview');
const pushed = ov2.push.find((x) => x.player === 'Musée Absent' && x.category === 'abuse');
if (parisHour >= 22 || parisHour < 8) ok(!pushed, 'heures calmes : pas de notification la nuit');
else ok(!!pushed, `notification push envoyée au joueur absent : « ${pushed?.title} »`);
ok(!ov2.push.some((x) => x.player === 'Musée Enchérisseur' && x.category === 'abuse'), 'pas de push pour un joueur en ligne');
const cancel = await admin('DELETE', `sales/${ab.sale.id}`);
ok(cancel.status === 200, 'vente admin annulée');

cP.ws.close();
cQ.ws.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
process.exit(failures ? 1 : 0);
