// Test serveur de la monnaie premium (STH coins), des Lucky coffres, de l'inventaire et des paiements (mode test).
// Prérequis : serveur lancé avec SAM_DEV=1 et sans clé de prestataire de paiement.
// Usage : node tests/shop.mjs [baseUrl]
const base = process.argv[2] ?? 'http://127.0.0.1:3001';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

async function call(path, body, auth, prefix = '/api/game/') {
  const res = await fetch(base + prefix + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-player-id': auth.id, 'x-player-token': auth.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const pay = (path, body, auth) => call(path, body, auth, '/api/pay/');

const login = await call('login', { name: 'Coffres test' });
const me = { id: login.id, token: login.token };
ok(login.state.sth === 0 && login.state.chests.simple === 0, 'nouveau joueur : 0 STH, aucun coffre');

// --- échange pièces → STH : taux très élevé (1 STH = 1 M pièces) et plafond mensuel (100 STH, 3 échanges)
ok(login.state.exchange?.left === 100 && login.state.exchange.count === 0, 'plafond du mois : 100 STH, aucun échange');
const poor = await call('sth/exchange', { sth: 10 }, me);
ok(poor.status === 402, 'échange refusé sans assez de pièces');
const badQty = await call('sth/exchange', { sth: 3 }, me);
ok(badQty.status === 422, 'échange refusé sous le minimum');
ok((await call('sth/exchange', { sth: 101 }, me)).status === 422, 'échange refusé au-delà du plafond mensuel');
await call('dev/grant', { coins: 200 * 1_000_000 }, me);
const ex = await call('sth/exchange', { sth: 10 }, me);
ok(ex.status === 200 && ex.state.sth === 10 && ex.cost === 10_000_000, `10 STH contre ${ex.cost?.toLocaleString('fr-FR')} pièces`);
ok(ex.state.exchange.used === 10 && ex.state.exchange.left === 90 && ex.state.exchange.count === 1, 'échange décompté du plafond du mois');
const ex2 = await call('sth/exchange', { sth: 85 }, me);
ok(ex2.status === 200 && ex2.state.exchange.left === 5, 'deuxième échange : il reste 5 STH ce mois-ci');
ok((await call('sth/exchange', { sth: 10 }, me)).status === 422, 'au-delà de ce qui reste du mois : refusé');
const ex3 = await call('sth/exchange', { sth: 5 }, me);
ok(ex3.status === 200 && ex3.state.exchange.left === 0 && ex3.state.sth === 100, 'troisième échange : plafond atteint (100 STH)');
const capped = await call('sth/exchange', { sth: 5 }, me);
ok(capped.status === 409 && capped.limit === true, 'quatrième échange refusé : limite du mois');

// --- achat de coffres : ils vont dans l'inventaire, sans s'ouvrir
const broke = await call('chest/buy', { id: 'legendaire', qty: 1 }, me);
ok(broke.status === 402 && broke.missingSth === 1100, 'coffre refusé : il manque 1 100 STH');
ok((await call('chest/buy', { id: '__proto__' }, me)).status === 422, 'coffre inconnu refusé (__proto__)');
ok((await call('chest/buy', { id: 'simple', qty: 3 }, me)).status === 422, 'quantité invalide refusée');
await call('dev/sth', { sth: 5000 }, me);
const one = await call('chest/buy', { id: 'simple', qty: 1 }, me);
ok(one.status === 200 && one.state.chests.simple === 1 && one.state.sth === 5100 - 60, 'coffre simple acheté (60 STH), rangé dans l’inventaire');
const five = await call('chest/buy', { id: 'rare', qty: 5 }, me);
ok(five.status === 200 && five.cost === 810 && five.state.chests.rare === 5, `5 coffres rares avec remise : ${five.cost} STH au lieu de 900`);
ok(five.state.artworks.length === 0, 'aucune œuvre tant que les coffres ne sont pas ouverts');

// --- ouverture : une œuvre de la bonne rareté, au mur ou en réserve
const opened = await call('chest/open', { id: 'simple' }, me);
ok(opened.status === 200 && opened.state.chests.simple === 0 && opened.state.artworks.length === 1, `coffre ouvert : « ${opened.artwork?.workId} » (${opened.rarity}, cadre ${opened.frame})`);
ok(['commun', 'rare', 'epique', 'legendaire'].includes(opened.rarity), 'rareté conforme aux probabilités du coffre simple');
ok((await call('chest/open', { id: 'simple' }, me)).status === 409, 'impossible d’ouvrir un coffre qu’on n’a plus');
const rarities = [];
for (let i = 0; i < 5; i++) rarities.push((await call('chest/open', { id: 'rare' }, me)).rarity);
ok(rarities.every((r) => ['rare', 'epique', 'legendaire'].includes(r)), `coffres rares : jamais de Commune (${rarities.join(', ')})`);

// --- garantie : 12e coffre simple sans Épique → Épique
await call('dev/sth', { sth: 60 * 12 }, me);
let pityHit = false;
for (let i = 0; i < 12; i++) {
  await call('chest/buy', { id: 'simple', qty: 1 }, me);
  const r = await call('chest/open', { id: 'simple' }, me);
  if (['epique', 'legendaire'].includes(r.rarity)) pityHit = true;
}
ok(pityHit, 'au moins une Épique en 12 coffres simples (garantie)');

// --- inventaire : ranger en réserve, exposer
let st = (await call('state', null, me));
const shown = st.artworks.find((a) => a.slot !== null);
const stored = await call('store', { uid: shown.uid }, me);
ok(stored.status === 200 && stored.state.artworks.find((a) => a.uid === shown.uid).slot === null, 'œuvre rangée dans la réserve');
ok((await call('store', { uid: shown.uid }, me)).status === 409, 'déjà en réserve : refusé');
const placed = await call('place', { uid: shown.uid }, me);
ok(placed.status === 200 && Number.isInteger(placed.slot), `œuvre exposée à l’emplacement ${placed.slot}`);
st = placed.state;
// musée plein (4 emplacements au niveau 1) : exposer depuis la réserve demande un remplacement
const reserve = st.artworks.find((a) => a.slot === null);
if (reserve) {
  const full = await call('place', { uid: reserve.uid }, me);
  ok(full.status === 409, 'musée plein : « place » refusé, il faut remplacer');
  const target = st.artworks.find((a) => a.slot !== null);
  const swap = await call('move', { uid: reserve.uid, slot: target.slot }, me);
  ok(swap.status === 200 && swap.state.artworks.find((a) => a.uid === target.uid).slot === null, 'remplacement : l’ancienne œuvre part en réserve');
}

// --- paiements en mode test
const cfg = await pay('config');
ok(cfg.test === true && cfg.methods.length >= 3, `moyens de paiement (test) : ${cfg.methods.map((m) => m.id).join(', ')}`);
ok((await pay('create', { pack: 'p1200', method: 'tmoney' })).status === 401, 'paiement refusé sans session');
ok((await pay('create', { pack: 'gratuit', method: 'tmoney' }, me)).status === 422, 'offre inconnue refusée');
const before = (await call('state', null, me)).sth;
const order = await pay('create', { pack: 'p1200', method: 'tmoney', amount: 1 }, me);
ok(order.status === 200 && order.order.amount === 5000 && order.order.currency === 'XOF' && order.order.sth === 1200, 'commande : 1 200 STH pour 5 000 FCFA (le montant envoyé par le client est ignoré)');
const pending = await pay(`order?id=${order.order.id}`, null, me);
ok(pending.order.status === 'pending', 'commande en attente tant que le paiement n’est pas confirmé');
const done = await pay('test/complete', { id: order.order.id }, me);
ok(done.order.status === 'paid' && done.sth === before + 1200, `paiement confirmé : +1 200 STH (${done.sth})`);
const again = await pay('test/complete', { id: order.order.id }, me);
ok(again.sth === before + 1200, 'une commande n’est créditée qu’une seule fois');
const pp = await pay('create', { pack: 'p550', method: 'paypal', currency: 'EUR' }, me);
ok(pp.order?.amount === 4.99 && pp.order.currency === 'EUR', 'PayPal : prix en euros (4,99 €)');
const other = await call('login', { name: 'Curieux' });
ok((await pay(`order?id=${order.order.id}`, null, { id: other.id, token: other.token })).status === 404, 'la commande d’un autre joueur reste invisible');

// --- serveur privé (STH coins) et cadeau saisonnier
const privBefore = (await call('state', null, me));
const priv = await call('private/buy', {}, me);
ok(priv.status === 200 && priv.state.privateServer.until > Date.now() + 29 * 86_400_000 && priv.state.sth === privBefore.sth - privBefore.privateServer.price, `serveur privé acheté (${privBefore.privateServer.price} STH, 30 jours)`);
const broke2 = await call('private/buy', {}, { id: other.id, token: other.token });
ok(broke2.status === 402, 'serveur privé refusé sans assez de STH');
const ADMIN = { 'x-admin-token': 'dev-admin', 'content-type': 'application/json' };
const setSeason = (body) => fetch(base + '/api/admin/season', { method: 'POST', headers: ADMIN, body: JSON.stringify(body) }).then((r) => r.json());
const noel = await setSeason({ mode: 'manual', id: 'noel', custom: { skyTop: '#123456', grass: 'pas-une-couleur' } });
ok(noel.season?.id === 'noel' && noel.season.custom?.skyTop === '#123456' && !noel.season.custom.grass, 'admin : saison Noël imposée, couleur invalide ignorée');
ok((await setSeason({ mode: 'manual', id: '__proto__' })).error, 'admin : saison inconnue refusée');
const g1 = await call('gift', {}, me);
ok(g1.status === 200 && ['coins', 'sth', 'chest'].includes(g1.reward?.kind) && g1.state.gift.available === false, `cadeau de Noël ouvert : ${g1.reward?.kind} ${g1.reward?.amount}`);
ok((await call('gift', {}, me)).status === 409, 'un seul cadeau par jour');
const classic = await setSeason({ mode: 'manual', id: 'classique' });
ok(classic.season?.id === 'classique' && (await call('state', null, me)).gift === null, 'thème classique : pas de cadeau saisonnier');
await setSeason({ mode: 'auto' });

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
