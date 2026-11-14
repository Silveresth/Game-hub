// Test serveur de la gestion des joueurs du panneau admin : liste, recherche, fiche, modification, création,
// cadeaux (en direct et à la reconnexion), retrait d'une œuvre, déconnexion forcée et suppression.
// Prérequis : serveur lancé avec SAM_DEV=1. Usage : node tests/admin.mjs [baseUrl]
import WebSocket from 'ws';

const base = process.argv[2] ?? 'http://127.0.0.1:3001';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

async function game(path, body, auth) {
  const res = await fetch(base + '/api/game/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-player-id': auth.id, 'x-player-token': auth.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

async function admin(method, path, body, token = 'dev-admin') {
  const res = await fetch(base + '/api/admin/' + path, {
    method,
    headers: { 'x-admin-token': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

/** Connexion au quartier : renvoie une fonction qui attend un message précis. */
function connect(auth) {
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
    waiters.push({ pred, res });
    setTimeout(() => rej(new Error('délai dépassé')), ms);
  });
  const closed = new Promise((res) => ws.on('close', res));
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'auth', id: auth.id, token: auth.token }));
    res({ ws, wait, closed });
  }));
}

const stamp = Date.now().toString(36);
const mail = (who) => `${who}-${stamp}@example.com`;

// --- accès
ok((await admin('GET', 'players', null, 'mauvais')).status === 401, 'liste des joueurs refusée sans le bon jeton');

// --- un invité et un inscrit
const guest = await game('login', { name: `Invité ${stamp}` });
const G = { id: guest.id, token: guest.token };
const reg = await game('register', { username: `Inscrit${stamp}`, email: mail('inscrit'), password: 'motdepasse1' });
let R = { id: reg.id, token: reg.token };
ok(reg.status === 201, 'joueur inscrit (e-mail + mot de passe)');

// --- liste, recherche, filtres
const all = await admin('GET', `players?q=${stamp}`);
ok(all.status === 200 && all.total === 2, `recherche par nom : les 2 joueurs du test (${all.total})`);
ok(all.counts.all >= 2 && all.counts.registered >= 1 && all.counts.guests >= 1, 'compteurs : tous, inscrits, invités');
const regs = await admin('GET', `players?q=${stamp}&filter=registered`);
ok(regs.total === 1 && regs.players[0].email === mail('inscrit') && regs.players[0].registered, 'filtre « inscrits » : seulement le compte e-mail');
ok((await admin('GET', `players?q=${stamp}&filter=guests`)).players.every((p) => !p.registered), 'filtre « invités »');
const row = regs.players[0];
ok(!('passwordHash' in row) && !('tokenHash' in row) && !('deviceTokens' in row), 'jamais de mot de passe ni de jeton dans la liste');
ok((await admin('GET', `players?q=${mail('inscrit')}`)).total === 1, 'recherche par e-mail');
ok((await admin('GET', `players?q=${R.id}`)).total === 1, 'recherche par identifiant');

// --- fiche et modification
const det = await admin('GET', `players/${R.id}`);
ok(det.status === 200 && det.player.id === R.id && Array.isArray(det.player.artworks) && det.player.chests.simple === 0, 'fiche du joueur');
ok((await admin('GET', 'players/inexistant')).status === 404, 'joueur inconnu : 404');
const upd = await admin('PATCH', `players/${R.id}`, { coins: 123456, sth: 77, level: 3, country: 'TG', name: `Renommé${stamp}` });
ok(upd.status === 200 && upd.player.coins === 123456 && upd.player.sth === 77 && upd.player.level === 3 && upd.player.country === 'TG' && upd.player.name === `Renommé${stamp}`,
  'modification : pièces, STH, niveau, pays et nom');
const st = await game('state', null, R);
ok(st.coins >= 123456 && st.sth === 77 && st.level === 3 && st.name === `Renommé${stamp}`, 'le joueur voit tout de suite les nouvelles valeurs');
ok((await admin('PATCH', `players/${R.id}`, { coins: -5 })).status === 422, 'solde négatif refusé');
ok((await admin('PATCH', `players/${R.id}`, { level: 99 })).status === 422, 'niveau hors limites refusé');
ok((await admin('PATCH', `players/${R.id}`, { email: 'pas-un-email' })).status === 422, 'e-mail invalide refusé');
ok((await admin('PATCH', `players/${R.id}`, { country: '__proto__' })).status === 422, 'pays inconnu refusé');
const bad = await admin('PATCH', `players/${R.id}`, { coins: 1, level: 99 });
ok(bad.status === 422 && (await game('state', null, R)).coins >= 123456, 'requête refusée : rien n’est modifié à moitié');
ok((await admin('PATCH', `players/${G.id}`, { logout: true })).status === 422, 'invité : pas de déconnexion forcée (il perdrait son musée)');

// --- nouveau mot de passe choisi par l'admin : anciennes sessions fermées, joueur en ligne sorti du quartier
const live = await connect(R);
await live.wait((m) => m.t === 'welcome');
const pw = await admin('PATCH', `players/${R.id}`, { password: 'nouveaumdp2' });
ok(pw.status === 200 && pw.loggedOut, 'nouveau mot de passe : sessions fermées');
const kicked = await live.wait((m) => m.t === 'kicked');
ok(kicked.title === 'Session fermée', 'le joueur en ligne est déconnecté du quartier');
ok((await game('state', null, R)).status === 401, 'l’ancienne session ne vaut plus rien');
const relog = await game('login/password', { email: mail('inscrit'), password: 'nouveaumdp2' });
ok(relog.status === 200, 'connexion avec le mot de passe choisi par l’admin');
R = { id: relog.id, token: relog.token };

// --- cadeaux
const before = await game('state', null, R);
const R_ws = await connect(R);
await R_ws.wait((m) => m.t === 'welcome');
const g1 = await admin('POST', 'gifts', { ids: [R.id, G.id], kind: 'coins', amount: 5000, message: 'Merci <b>!</b>' });
ok(g1.status === 200 && g1.count === 2 && g1.live === 1, `cadeau de pièces à 2 joueurs cochés (${g1.live} en ligne)`);
ok(!/[<>]/.test(g1.gift?.message ?? '<'), 'le petit mot est nettoyé');
const liveGift = await R_ws.wait((m) => m.t === 'admin-gift');
ok(liveGift.gift.kind === 'coins' && liveGift.gift.amount === 5000, 'le joueur en ligne est prévenu en direct');
ok((await game('state', null, R)).coins >= before.coins + 5000, 'pièces créditées');
const g2 = await admin('POST', 'gifts', { ids: [R.id], kind: 'sth', amount: 25 });
ok(g2.status === 200 && (await game('state', null, R)).sth === before.sth + 25, 'STH coins offerts');
const g3 = await admin('POST', 'gifts', { ids: [R.id], kind: 'chest', chest: 'rare', amount: 2 });
ok(g3.status === 200 && (await game('state', null, R)).chests.rare === 2, 'Lucky coffres offerts (dans l’inventaire)');
const g4 = await admin('POST', 'gifts', { ids: [R.id], kind: 'artwork', workId: 'tournesols', frame: 'dore' });
ok(g4.status === 200 && (await game('state', null, R)).artworks.some((a) => a.workId === 'tournesols' && a.frame === 'dore'), 'œuvre offerte (cadre doré)');
ok((await admin('POST', 'gifts', { ids: [R.id], kind: 'chest', chest: '__proto__', amount: 1 })).status === 422, 'coffre inconnu refusé');
ok((await admin('POST', 'gifts', { ids: [], kind: 'coins', amount: 5 })).status === 422, 'sans joueur choisi : refusé');
ok((await admin('POST', 'gifts', { ids: [R.id], kind: 'coins', amount: 0 })).status === 422, 'quantité nulle refusée');
ok((await admin('POST', 'gifts', { ids: [R.id], kind: 'coins', amount: 1.5 })).status === 422, 'quantité non entière refusée');
const freeMythic = (await admin('GET', 'overview')).works.find((w) => w.unique && !w.owner);
if (freeMythic) {
  ok((await admin('POST', 'gifts', { ids: [R.id, G.id], kind: 'artwork', workId: freeMythic.id })).status === 422, 'Mythique : un seul joueur à la fois');
  ok((await admin('POST', 'gifts', { ids: [R.id], kind: 'artwork', workId: freeMythic.id })).status === 200, `Mythique offerte (${freeMythic.title})`);
  ok((await admin('POST', 'gifts', { ids: [G.id], kind: 'artwork', workId: freeMythic.id })).status === 409, 'Mythique déjà possédée : refusée');
}
R_ws.ws.close();

// --- joueur absent : le cadeau l'attend à la connexion
const glog = await game('login', { id: G.id, token: G.token });
ok(glog.inbox?.some((i) => i.type === 'gift' && i.kind === 'coins' && i.amount === 5000 && i.message), 'joueur absent : le cadeau et le mot l’attendent à la connexion');

// --- retrait d'une œuvre
const art = (await admin('GET', `players/${R.id}`)).player.artworks.find((a) => a.workId === 'tournesols');
const rm = await admin('DELETE', `players/${R.id}/artworks/${art.uid}`);
ok(rm.status === 200 && !rm.player.artworks.some((a) => a.uid === art.uid), 'œuvre retirée du musée');

// --- création d'un compte
const created = await admin('POST', 'players', { name: `Créé${stamp}`, email: mail('cree'), password: 'motdepasse3', country: 'TG' });
ok(created.status === 200 && created.player.registered && created.player.country === 'TG', 'compte créé depuis le panneau admin');
ok((await game('login/password', { email: mail('cree'), password: 'motdepasse3' })).status === 200, 'le compte créé peut se connecter');
ok((await admin('POST', 'players', { name: `Autre${stamp}`, email: mail('cree') })).status === 409, 'e-mail déjà utilisé : refusé');
ok((await admin('POST', 'players', { name: `Sans${stamp}` })).status === 422, 'création sans e-mail refusée');
ok((await admin('PATCH', `players/${created.player.id}`, { email: mail('inscrit') })).status === 409, 'e-mail d’un autre compte refusé');

// --- suppression
const R_ws2 = await connect(R);
await R_ws2.wait((m) => m.t === 'welcome');
const del = await admin('DELETE', `players/${R.id}`);
ok(del.status === 200, 'joueur supprimé');
ok((await R_ws2.wait((m) => m.t === 'kicked')).title === 'Compte supprimé', 'le joueur en ligne est prévenu et sorti du quartier');
ok((await admin('GET', `players/${R.id}`)).status === 404, 'joueur supprimé : introuvable');
ok((await game('state', null, R)).status === 401, 'sa session ne fonctionne plus');
if (freeMythic) ok((await admin('GET', 'overview')).works.find((w) => w.id === freeMythic.id)?.owner === null, 'sa Mythique redevient libre');
await admin('DELETE', `players/${created.player.id}`);
await admin('DELETE', `players/${G.id}`);
ok((await admin('GET', `players?q=${stamp}`)).total === 0, 'nettoyage : plus aucun joueur du test');

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
