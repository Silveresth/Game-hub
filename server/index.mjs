// Serveur Node sans dépendance — Steal a Masterpiece :
//  - barre live : joueurs en ligne (flux SSE), visiteurs depuis le lancement, heure serveur, prochaines ventes
//  - API REST du jeu 3D (game, auctions, admin, push)
//  - hébergement statique du build (dossier dist/)
// Usage : npm run build && npm start     (PORT=3001 et HOST=127.0.0.1 par défaut)
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createDatabase } from './db.mjs';
import { createGame } from './game.mjs';
import { attachDistricts } from './district.mjs';
import { createAuctions } from './auctions.mjs';
import { createPush } from './push.mjs';
import { clientIp } from './ip.mjs';

// Filet de sécurité : une promesse rejetée oubliée est journalisée au lieu d'arrêter tout le serveur.
process.on('unhandledRejection', (e) => console.error('Promesse rejetée non gérée :', e));

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
// SAM_DATA_DIR : dossier des données (joueurs, ventes, clés push), par exemple pour isoler un serveur de test
const DATA = process.env.SAM_DATA_DIR ? resolve(process.env.SAM_DATA_DIR) : join(ROOT, 'server', 'data');

/**
 * Domaines autorisés à lire les statistiques publiques (/api/live, /api/stats) depuis un autre site,
 * par exemple la page d'accueil hébergée sur Vercel. Liste séparée par des virgules ; « *.vercel.app » accepte
 * les aperçus Vercel, « * » accepte tout le monde (ces deux routes ne renvoient que des données publiques).
 */
const CORS_ORIGINS = (process.env.SAM_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = String(req.headers.origin ?? '');
  if (!origin || !CORS_ORIGINS.length) return {};
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    return {};
  }
  const ok = CORS_ORIGINS.some((o) => o === '*' || o === origin || (o.startsWith('*.') && host.endsWith(o.slice(1))));
  return ok ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.webp': 'image/webp',
};

// ------------------------------------------------------------------ HTTP

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const MAX_BODY = 40 * 1024 * 1024;
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch (e) {
    send(res, e.status ?? 400, { error: e.status === 413 ? 'Requête trop volumineuse' : 'JSON invalide' });
    return undefined;
  }
}

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + sep)) return send(res, 403, 'Interdit', 'text/plain');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': cache,
      // en-têtes de sécurité de base pour la mise en ligne
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'SAMEORIGIN',
      // micro autorisé sur ce site seulement (discussion vocale, sur demande du joueur)
      'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
    });
    res.end(body);
  } catch {
    send(res, 404, 'Introuvable (avez-vous lancé « npm run build » ?)', 'text/plain; charset=utf-8');
  }
}

// ------------------------------------------------------------------ barre live : présence, visiteurs, ventes

const VID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_LIVE = 5000;
/** Identifiants anonymes (générés par le navigateur) de tous les visiteurs depuis le lancement. */
const visitors = new Set();
/** Connexions SSE ouvertes → identifiant du visiteur (plusieurs onglets = une seule personne en ligne). */
const live = new Map();
let visitorsTimer = null;

function saveVisitorsSoon() {
  clearTimeout(visitorsTimer);
  visitorsTimer = setTimeout(async () => {
    try {
      await db.kvSet('visitors', [...visitors]);
    } catch (e) {
      // disque plein, base injoignable… : on le signale sans arrêter le serveur, nouvel essai à la prochaine visite
      console.error('Enregistrement des visiteurs impossible :', e.message);
    }
  }, 1000);
}

// Planning des ventes (heure de Paris) : voir server/auctions.mjs

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

function liveStats() {
  const now = Date.now();
  const richest = game.leaderboard(1)[0];
  return {
    online: new Set(live.values()).size,
    visitors: visitors.size,
    serverTime: now,
    sales: auctions.schedule(now, 4),
    nextMajor: auctions.nextMajor(now),
    liveSale: auctions.live(),
    // événement du convoi en cours / à venir (Heure dorée, Trésors rares, Soldes)
    event: game.eventAt(now),
    // musée n°1 : seulement ce que la barre live affiche (l'ancien format des musées publiés n'existe plus)
    top: richest ? { name: richest.name, value: richest.value } : null,
  };
}

function broadcastLive() {
  if (!live.size) return;
  const msg = `data: ${JSON.stringify(liveStats())}\n\n`;
  for (const res of live.keys()) res.write(msg);
}
setInterval(broadcastLive, 5000).unref();

/** Flux Server-Sent Events : la connexion ouverte compte comme « en ligne », et reçoit les stats toutes les 5 s. */
function openLiveStream(req, res, url) {
  if (live.size >= MAX_LIVE) return send(res, 503, { error: 'Trop de connexions' });
  const v = url.searchParams.get('v') ?? '';
  const id = VID_RE.test(v) ? v : `anon-${randomBytes(6).toString('hex')}`;
  if (VID_RE.test(v) && !visitors.has(v)) {
    visitors.add(v);
    saveVisitorsSoon();
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...corsHeaders(req),
  });
  res.write('retry: 5000\n\n');
  live.set(res, id);
  req.on('close', () => {
    live.delete(res);
    broadcastLive();
  });
  broadcastLive();
}

// ------------------------------------------------------------------ démarrage

/**
 * Serveurs ICE de la discussion vocale (WebRTC). Par défaut un serveur STUN public ; SAM_ICE_SERVERS (JSON) permet
 * d'ajouter un serveur TURN, nécessaire quand deux joueurs sont derrière des réseaux très fermés.
 */
const ICE_SERVERS = (() => {
  try {
    const v = JSON.parse(process.env.SAM_ICE_SERVERS ?? 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch {
    console.error('SAM_ICE_SERVERS illisible (JSON attendu) : serveur STUN par défaut');
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
})();

const DEV = process.env.SAM_DEV === '1'; // active /api/game/dev/* et les raccourcis de test (jamais en production)
await mkdir(DATA, { recursive: true });
// une seule connexion à la base (PostgreSQL si DATABASE_URL, sinon fichiers JSON), partagée par tout le serveur
const db = await createDatabase({ dataDir: DATA });
const push = await createPush({ db, devMode: DEV });
const game = await createGame({
  dataDir: DATA,
  catalogFile: join(ROOT, 'src', 'shared', 'catalog.json'),
  devMode: DEV,
  push,
  db,
});
const auctions = await createAuctions({ game, db, devMode: DEV });

/**
 * Digital Asset Links : prouve à Android que l'APK (Trusted Web Activity, via Bubblewrap) appartient à ce site,
 * pour qu'il s'ouvre en plein écran sans barre d'adresse. Variables : SAM_ANDROID_PACKAGE et SAM_ANDROID_SHA256
 * (empreintes SHA-256 du certificat de signature, séparées par des virgules).
 */
function assetLinks() {
  const pkg = process.env.SAM_ANDROID_PACKAGE;
  const prints = (process.env.SAM_ANDROID_SHA256 ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!pkg || !prints.length) return [];
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } }];
}

// ------------------------------------------------------------------ admin (jeton dans SAM_ADMIN_TOKEN ; « dev-admin » en mode test)

const ADMIN_TOKEN = process.env.SAM_ADMIN_TOKEN || (DEV ? 'dev-admin' : '');
const adminFails = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of adminFails) if (!list.some((t) => now - t < 15 * 60_000)) adminFails.delete(ip);
}, 5 * 60_000).unref();
function adminOk(req, ip) {
  if (!ADMIN_TOKEN) return false;
  const now = Date.now();
  const fails = (adminFails.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (fails.length >= 10) return false; // 10 essais ratés : 15 min de pause
  const a = Buffer.from(hashToken(String(req.headers['x-admin-token'] ?? '')));
  const b = Buffer.from(hashToken(ADMIN_TOKEN));
  if (timingSafeEqual(a, b)) return true;
  adminFails.set(ip, [...fails, now]);
  return false;
}

async function adminApi(req, res, url) {
  const ip = clientIp(req);
  if (!ADMIN_TOKEN) return send(res, 503, { error: 'Admin désactivé : définissez SAM_ADMIN_TOKEN' });
  if (!adminOk(req, ip)) return send(res, 401, { error: 'Jeton admin invalide' });
  const parts = url.pathname.split('/').filter(Boolean); // ['api','admin','sales',id?,action?]
  const ok = (body) => send(res, 200, body, undefined, { 'cache-control': 'no-store' });
  try {
    if (parts[2] === 'overview' && req.method === 'GET') {
      return ok({ ...auctions.adminList(), stats: { players: [...game.allPlayers()].length, online: districts.stats().online, districts: districts.stats().districts }, push: push.log.slice(-20).reverse(), dev: DEV, liveEvent: game.eventAt(Date.now()).current });
    }
    // « admin abuse » en direct : pluie d'or, convoi arc-en-ciel, super vitesse
    if (parts[2] === 'live' && req.method === 'POST') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      return ok({ event: districts.startLiveEvent(String(body.kind ?? ''), Number(body.minutes) || undefined) });
    }
    if (parts[2] === 'live' && req.method === 'DELETE') {
      districts.stopLiveEvent();
      return ok({ event: null });
    }
    if (parts[2] === 'sales' && !parts[3] && req.method === 'POST') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      return ok({ sale: auctions.createSale(body) });
    }
    if (parts[2] === 'sales' && parts[3]) {
      if (req.method === 'DELETE' && !parts[4]) return ok({ ok: auctions.cancelSale(parts[3]) ?? true });
      if (req.method === 'POST' && parts[4] === 'announce') return ok({ sale: auctions.announceSale(parts[3]) });
      if (req.method === 'POST' && parts[4] === 'start') return ok({ sale: auctions.startNow(parts[3]) });
    }
  } catch (e) {
    return send(res, 422, { error: e.message });
  }
  return send(res, 404, { error: 'Route inconnue' });
}

try {
  for (const v of (await db.kvGet('visitors')) ?? []) if (VID_RE.test(v)) visitors.add(v);
} catch (e) {
  console.error('Lecture des visiteurs impossible :', e.message);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/live') return openLiveStream(req, res, url);
    if ((req.method === 'GET' || req.method === 'HEAD' || req.method === 'POST') && url.pathname === '/api/ping') {
      // maintien en éveil (Upstash QStash toutes les 10 min) : le service Render et la base Neon ne s'endorment pas
      try {
        const ms = await db.ping();
        return send(res, 200, { ok: true, db: db.isPostgres() ? 'postgres' : 'fichiers', dbMs: ms, uptime: Math.round(process.uptime()) }, undefined, { 'cache-control': 'no-store' });
      } catch (e) {
        return send(res, 503, { ok: false, error: `Base injoignable : ${e.message}` }, undefined, { 'cache-control': 'no-store' });
      }
    }
    if (url.pathname.startsWith('/api/game/')) return await game.handle(req, res, url);
    if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/push/key') return send(res, 200, { key: push.publicKey });
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { googleClientId: process.env.SAM_GOOGLE_CLIENT_ID || null, iceServers: ICE_SERVERS });
    if (req.method === 'GET' && url.pathname === '/.well-known/assetlinks.json') return send(res, 200, assetLinks());
    if (req.method === 'GET' && url.pathname === '/api/stats') return send(res, 200, liveStats(), undefined, { 'cache-control': 'no-store', ...corsHeaders(req) });
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Route inconnue' });
    return await serveStatic(res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Erreur serveur' });
  }
});

// Quartiers multijoueurs (WebSocket sur /ws)
const districts = await attachDistricts(server, game, {
  layoutFile: join(ROOT, 'src', 'shared', 'layout.json'),
  devMode: DEV,
  auctions,
});

server.listen(PORT, HOST, () => console.log(`Game Hub → http://${HOST}:${PORT}`));
