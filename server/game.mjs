// Économie de Steal a Masterpiece (phase 1, solo) — le serveur fait autorité :
// argent, caisse, revenus (en ligne / hors ligne), convoi, achats, agrandissement, revente, classement.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cleanSubscription } from './push.mjs';
import { clientIp } from './ip.mjs';
import { createDatabase } from './db.mjs';
import { cleanEmail, hashPassword, newToken, passwordProblem, sendResetEmail, verifyPassword } from './accounts.mjs';

const WINDOW_MS = 8_000; // un nouveau camion du convoi toutes les 8 s (environ 29 m entre deux camions)
const TRAVEL_MS = 40_000; // durée de traversée de la place
const BUY_GRACE_MS = 1_000; // latence réseau : un camion qui sort tout juste de la place reste achetable un instant
const ONLINE_GRACE_S = 60; // au-delà d'une minute sans nouvelle, le joueur est considéré hors ligne
const OFFLINE_RATE = 0.5;
const CASH_HOURS = 2;
const MIN_CASH_CAP = 500;
const SELL_RATE = 0.5;
// Règles de vol (cahier des charges, « Sécurité et vols »)
const BEGINNER_MS = 24 * 3600_000; // bouclier débutant : 24 h…
const BEGINNER_VALUE = 100_000; // … tant que le musée vaut moins de 100 000
// Plus de restriction d'attente (immunité ou délai hors-ligne) : on peut voler le nombre de fois qu'on veut et à tout moment
const IMMUNE_MS = 0;
const OFFLINE_LOSS_MS = 0;
const FINE_RATE = 0.1; // amende du voleur arrêté, versée au propriétaire
const STATUE_SLOT_FROM = 214; // emplacements 214+ : socles du toit-terrasse (tools/gen-layout.mjs)
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

const hash = (s) => createHash('sha256').update(s).digest('hex');
/** Clé envoyée par le client : seulement une propriété propre de l'objet (jamais __proto__, constructor, toString…). */
const own = (obj, key) => (typeof key === 'string' || typeof key === 'number') && Object.hasOwn(obj, String(key));
/** Prix utilisable : un nombre fini et positif (un prix NaN laisserait tout acheter gratuitement). */
const validPrice = (n) => Number.isFinite(n) && n >= 0;

function seededRandom(seedText) {
  let a = parseInt(hash(seedText).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 24 ? name : null;
}

export async function createGame({ dataDir, catalogFile, devMode = false, push = null, db: sharedDb = null }) {
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  const works = new Map(catalog.works.map((w) => [w.id, w]));
  const levels = catalog.levels;
  const frames = catalog.frames;
  const quests = catalog.quests;
  const colors = catalog.colors;
  const START_COINS = catalog.startCoins ?? 300;
  const COUNTRY_CODES = new Set((catalog.countries ?? []).map((c) => c.code));
  /** Code pays du catalogue, ou null (on n'accepte plus n'importe quels 2 caractères). */
  const cleanCountry = (c) => (typeof c === 'string' && COUNTRY_CODES.has(c.toUpperCase()) ? c.toUpperCase() : null);
  /** Tenue du personnage (index dans catalog.skins), ou null. */
  const cleanSkin = (s) => (Number.isInteger(s) && s >= 0 && s < (catalog.skins?.length ?? 4) ? s : null);
  const DECOR_COST = catalog.decorCost ?? 5000;
  const UPGRADES = catalog.upgrades ?? {};
  const REBIRTH = catalog.rebirth ?? { minLevel: 5, baseCost: 50_000_000, growth: 5, incomeBonus: 0.5 };
  const DAILY = catalog.daily ?? [500];
  const EVENTS = catalog.events ?? null;
  const THEMES = catalog.themes ?? ['classic', 'modern', 'futuristic', 'zen'];
  /** Taux de revenu par rareté : les communes se remboursent vite (début de partie), les grandes œuvres lentement. */
  const rateOf = (a) => catalog.rarities[works.get(a.workId).rarity].incomeRate ?? catalog.incomeRate;
  const convoyPool = Object.entries(catalog.rarities).filter(([, r]) => r.convoyWeight > 0);

  const db = sharedDb ?? (await createDatabase({ dataDir }));

  /** @type {Map<string, any>} */
  const players = await db.loadAllPlayers(migrate);

  // Écriture différée et atomique des joueurs modifiés (une passe à la fois : une suppression attend la passe en cours)
  const dirty = new Set();
  async function saveDirty() {
    for (const id of [...dirty]) {
      dirty.delete(id);
      const p = players.get(id);
      if (!p) continue;
      await db.savePlayer(id, p);
    }
  }
  let saving = Promise.resolve();
  setInterval(() => {
    saving = saving.then(saveDirty).catch((e) => console.error('Enregistrement des joueurs :', e.message));
  }, 2000).unref();
  const touch = (p) => dirty.add(p.id);
  /** Dernière activité du joueur (affichée dans le panneau admin), notée au plus une fois par minute. */
  function seen(p) {
    const now = Date.now();
    if (now - (p.lastSeen ?? 0) < 60_000) return;
    p.lastSeen = now;
    touch(p);
  }

  // ---------------------------------------------------------------- calculs

  // une reproduction (marché noir) décore, mais ne vaut rien et ne rapporte rien
  const workValue = (a) => (a.repro ? 0 : works.get(a.workId).price * (frames[a.frame]?.mult ?? 1));
  const levelInfo = (p) => levels[p.level - 1];

  // ---------------------------------------------------------------- boutique, renaissance (améliorations permanentes)

  /** Niveau acheté d'une amélioration (0 = aucun). */
  const upgLevel = (p, id) => Math.min(p.upgrades?.[id] ?? 0, UPGRADES[id]?.levels.length ?? 0);
  /** Valeur de l'amélioration au niveau acheté, ou `def` sans achat. */
  const upgValue = (p, id, def) => {
    const lvl = upgLevel(p, id);
    return lvl ? UPGRADES[id].levels[lvl - 1].value : def;
  };
  /** Bonus de revenu des renaissances : +50 % par renaissance (cumulatif, permanent). */
  const incomeMult = (p) => 1 + (p.rebirths ?? 0) * REBIRTH.incomeBonus;
  const rebirthCost = (p) => Math.round(REBIRTH.baseCost * REBIRTH.growth ** (p.rebirths ?? 0));

  // une œuvre décrochée par un voleur (carriedBy) ne rapporte plus rien tant qu'elle n'est pas revenue
  const income = (p) => incomeMult(p) * p.artworks.reduce((s, a) => s + (a.slot === null || a.carriedBy ? 0 : workValue(a) * rateOf(a)), 0);
  const value = (p) => p.artworks.reduce((s, a) => s + workValue(a), 0);
  /** Plafond de la caisse : 2 h de revenu, plus avec le coffre-fort de la boutique. */
  const cashCap = (p) => Math.max(MIN_CASH_CAP, income(p) * upgValue(p, 'vault', CASH_HOURS) * 3600);

  // ---------------------------------------------------------------- événements du convoi (toutes les 15 min, 3 min)

  /**
   * Événements « admin abuse » (déclenchés par l'admin ou le soir automatiquement), prioritaires sur ceux du convoi.
   * On garde les derniers : un camion parti pendant un événement garde son contenu (cadre arc-en-ciel…)
   * même si l'événement est arrêté plus tôt ou remplacé par un autre.
   */
  let adminEvents = []; // [{ kind, startsAt, endsAt }]
  function setAdminEvent(kind, minutes, now = Date.now()) {
    if (kind !== null && !EVENTS?.kinds[kind]?.admin) throw new Error('Événement inconnu');
    // l'événement en cours s'arrête maintenant (sans effacer son passé)
    for (const e of adminEvents) if (e.startsAt <= now && e.endsAt > now) e.endsAt = now;
    if (kind === null) return null;
    adminEvents = [...adminEvents.filter((e) => now - e.endsAt < 2 * 3_600_000).slice(-9), { kind, startsAt: now, endsAt: now + Math.max(1, Math.min(60, minutes)) * 60_000 }];
    return liveAdminEvent(now);
  }
  const liveAdminEvent = (ms) => {
    const e = adminEvents.findLast((x) => x.startsAt <= ms && x.endsAt > ms);
    return e ? { ...EVENTS.kinds[e.kind], kind: e.kind, startsAt: e.startsAt, endsAt: e.endsAt } : null;
  };

  /** Événement en cours à l'instant `ms` (ou null), et le prochain : identiques pour tous les joueurs. */

  function eventAt(ms) {
    if (!EVENTS) return { current: null, next: null };
    const cycle = EVENTS.cycleMinutes * 60_000;
    const dur = EVENTS.durationMinutes * 60_000;
    // le cycle automatique ne tire que les événements du convoi (pas ceux réservés à l'admin)
    const kinds = Object.keys(EVENTS.kinds).filter((k) => !EVENTS.kinds[k].admin);
    const make = (k) => {
      const kind = kinds[parseInt(hash(`event:${k}`).slice(0, 6), 16) % kinds.length];
      const startsAt = (k + 1) * cycle - dur;
      return { kind, ...EVENTS.kinds[kind], startsAt, endsAt: startsAt + dur };
    };
    const k = Math.floor(ms / cycle);
    const ev = make(k);
    const admin = liveAdminEvent(ms);
    if (admin) return { current: admin, next: ms >= ev.startsAt ? make(k + 1) : ev };
    if (ms >= ev.startsAt) return { current: ev, next: make(k + 1) };
    return { current: null, next: ev };
  }

  /**
   * Pièce ramassée pendant une pluie d'or : environ 15 s de revenu, 100 pièces au moins.
   * Pluies saisonnières (cadeaux, bonbons, œufs) : `mult` fois plus.
   */
  function coinPickup(p, mult = 1) {
    accrue(p);
    const amount = Math.max(100, Math.round(income(p) * 15)) * Math.max(1, Math.min(5, Number(mult) || 1));
    p.coins += amount;
    touch(p);
    return amount;
  }

  /** Semaine en cours (elles commencent le lundi à 0 h UTC) : le classement hebdomadaire repart de zéro. */
  const weekKey = (now) => Math.floor((now / 86_400_000 + 3) / 7);
  function rollWeek(p, now = Date.now()) {
    const key = weekKey(now);
    if (p.week.key === key) return;
    p.week = { key, start: value(p), theft: 0, auction: 0 };
    touch(p);
  }

  /** Fait avancer la caisse jusqu'à maintenant. Renvoie le gain réalisé hors ligne. */
  function accrue(p, now = Date.now()) {
    rollWeek(p, now);
    const dt = Math.max(0, (now - p.lastTick) / 1000);
    const online = Math.min(dt, ONLINE_GRACE_S);
    const offline = dt - online;
    const inc = income(p);
    const cap = cashCap(p);
    const before = p.cash;
    const afterOnline = Math.min(cap, p.cash + inc * online);
    p.cash = Math.min(cap, afterOnline + inc * offline * OFFLINE_RATE);
    p.lastTick = now;
    if (p.cash !== before) touch(p);
    return offline > 0 ? p.cash - afterOnline : 0;
  }

  const isStatueWork = (workId) => works.get(workId)?.kind === 'statue';
  /** Socles de statues du toit-terrasse (voir tools/gen-layout.mjs) : un tableau ne s'y pose jamais. */
  const isStatueSlot = (slot) => slot >= STATUE_SLOT_FROM;

  /**
   * Emplacement libre pour une œuvre : une statue va d'abord sur un socle (toit-terrasse), sinon devant un mur ;
   * un tableau va seulement sur un mur. null = réserve.
   */
  function freeSlot(p, workId = null) {
    const used = new Set(p.artworks.map((a) => a.slot).filter((s) => s !== null));
    const totalSlots = levelInfo(p).slots;
    if (workId && isStatueWork(workId)) {
      for (let i = STATUE_SLOT_FROM; i < totalSlots; i++) if (!used.has(i)) return i;
    }
    const maxWall = Math.min(STATUE_SLOT_FROM, totalSlots);
    for (let i = 0; i < maxWall; i++) if (!used.has(i)) return i;
    return null;
  }

  // Anciennes sauvegardes : un tableau posé sur un socle de statue repart sur un mur (ou en réserve).
  for (const p of players.values()) {
    for (const a of p.artworks) {
      if (a.slot !== null && isStatueSlot(a.slot) && !isStatueWork(a.workId)) {
        a.slot = null;
        a.slot = freeSlot(p, a.workId);
        touch(p);
      }
    }
  }

  // ---------------------------------------------------------------- objectifs (une chaîne, un à la fois)

  /** Anciennes sauvegardes : complète les champs ajoutés depuis. */
  function migrate(p) {
    // un solde corrompu (NaN sauvegardé en null) ne doit jamais contourner les contrôles d'achat
    if (!Number.isFinite(p.coins)) p.coins = 0;
    if (!Number.isFinite(p.cash)) p.cash = 0;
    p.stats ??= { collected: 0, rare: 0, epic: 0, framed: 0 };
    p.stats.stolen ??= 0;
    p.questIndex ??= 0;
    p.color ??= colors[0];
    p.country ??= 'FR';
    p.inbox ??= [];
    p.immuneUntil ??= 0;
    p.lastOfflineLoss ??= 0;
    p.stats.secured ??= 0;
    p.stats.arrests ??= 0;
    p.security ??= {};
    const s = p.security;
    s.guards ??= null; // { tier, count, until }
    s.camerasUntil ??= 0;
    s.lasers ??= false;
    s.generator ??= false;
    s.insuranceUntil ??= 0;
    s.vitrines ??= {}; // emplacement → niveau (1 ou 2)
    s.dogUntil ??= 0;
    p.tools ??= {};
    // phase 4 : enchères et notifications
    if (!Number.isFinite(p.escrow)) p.escrow = 0;
    if (p.escrow > 0) {
      // serveur arrêté pendant une enchère : l'argent bloqué revient au joueur
      p.coins += p.escrow;
      p.escrow = 0;
    }
    p.stats.auctions ??= 0;
    // phase 5 : records (classement permanent) et semaine en cours (classement hebdomadaire)
    p.records ??= { theft: 0, auction: 0 };
    p.week ??= { key: -1, start: 0, theft: 0, auction: 0 };
    p.cashFullNotified ??= false;
    p.guardsNotified ??= 0;
    p.roomThemes ??= {};
    // boutique, renaissance, récompense quotidienne
    p.upgrades ??= {};
    p.rebirths ??= 0;
    p.daily ??= { day: '', streak: 0 };
    // code d'invitation à partager (jamais l'identifiant du compte)
    p.inviteCode ??= randomBytes(5).toString('base64url');
    p.skin ??= 0; // tenue du personnage (0 à 3)
    // monnaie premium (STH coins), Lucky coffres non ouverts, compteurs de garantie, achats en argent réel
    if (!Number.isFinite(p.sth) || p.sth < 0) p.sth = 0;
    p.chests ??= {};
    p.pity ??= {};
    p.purchases ??= [];
    p.stats.chests ??= 0;
    // échanges pièces → STH du mois en cours (plafonnés), cadeau saisonnier du jour, serveur privé
    p.exchange ??= { month: '', sth: 0, count: 0 };
    p.seasonGift ??= { day: '', season: '' };
    if (!Number.isFinite(p.privateUntil)) p.privateUntil = 0;
    // une œuvre restée « en cours de vol » (serveur arrêté pendant un vol) revient à son propriétaire
    for (const a of p.artworks) delete a.carriedBy;
    return p;
  }

  // ---------------------------------------------------------------- sécurité (phase 3)

  const SEC = catalog.security;
  const TOOLS = catalog.tools;
  const MAX_TOOLS = catalog.maxTools ?? 3;
  const round = (n) => Math.round(n);

  const guardCount = (p, now = Date.now()) => (p.security.guards && p.security.guards.until > now ? p.security.guards.count : 0);
  const vitrineMult = (p, slot) => SEC.vitrine.levels[(p.security.vitrines[slot] ?? 0) - 1]?.mult ?? 1;

  /** Ce que tout le monde voit des protections d'un musée (les failles doivent être lisibles). */
  function publicSecurity(p, now = Date.now()) {
    const s = p.security;
    return {
      guards: guardCount(p, now),
      cameras: s.camerasUntil > now,
      lasers: s.lasers,
      generator: s.generator,
      insured: s.insuranceUntil > now,
      vitrines: s.vitrines,
      dog: s.dogUntil > now,
    };
  }

  // ---------------------------------------------------------------- billet d'entrée, primes (phase 6)

  /** Prix du billet pour visiter (ou cambrioler) un musée : une petite part de sa valeur, versée au propriétaire. */
  const ticketPrice = (owner) => Math.round(Math.max(catalog.ticket?.min ?? 20, value(owner) * (catalog.ticket?.valueShare ?? 0.0005)));

  function payTicket(visitor, owner) {
    accrue(visitor);
    const price = ticketPrice(owner);
    if (visitor.coins < price) return null;
    visitor.coins -= price;
    owner.coins += price;
    touch(visitor);
    touch(owner);
    return price;
  }

  /** Prime du chasseur qui arrête le voleur d'une Mythique : 1 % de sa valeur. */
  function bounty(hunter, workId) {
    const amount = Math.floor(works.get(workId).price * 0.01);
    hunter.coins += amount;
    touch(hunter);
    return amount;
  }

  /** Prix proportionnels au musée : protéger coûte une part de ce qu'on gagne ou de ce qu'on possède. */
  function securityOffers(p) {
    const inc = income(p);
    const val = value(p);
    const guards = {};
    for (const [id, g] of Object.entries(SEC.guards)) guards[id] = round(Math.max(g.min, inc * g.minutes * 60 * g.incomeShare));
    const vitrines = {};
    for (const a of p.artworks) {
      if (a.slot === null) continue;
      const lvl = p.security.vitrines[a.slot] ?? 0;
      const next = SEC.vitrine.levels[lvl];
      vitrines[a.slot] = { level: lvl, price: next ? round(Math.max(next.min, workValue(a) * next.workShare)) : null };
    }
    return {
      guards,
      cameras: round(Math.max(SEC.cameras.min, inc * SEC.cameras.incomeMinutes * 60)),
      lasers: p.security.lasers ? null : round(Math.max(SEC.lasers.min, val * SEC.lasers.valueShare)),
      generator: p.security.generator ? null : round(Math.max(SEC.generator.min, val * SEC.generator.valueShare)),
      insurance: round(Math.max(SEC.insurance.min, val * SEC.insurance.valueShare)),
      dog: round(Math.max(SEC.dog.min, inc * SEC.dog.hours * 3600 * SEC.dog.incomeShare)),
      vitrines,
    };
  }

  const toolPrice = (p, id) => round(Math.max(TOOLS[id].base, value(p) * TOOLS[id].valueShare));
  const toolPrices = (p) => Object.fromEntries(Object.keys(TOOLS).map((id) => [id, toolPrice(p, id)]));

  function useTool(p, id) {
    if (!(p.tools[id] > 0)) return false;
    p.tools[id]--;
    touch(p);
    return true;
  }

  function pushInbox(p, item) {
    p.inbox = [...p.inbox.slice(-19), item];
    touch(p);
  }

  /** Tentative repérée (caméra, laser, sabotage) pendant l'absence du propriétaire : il l'apprendra au retour. */
  function noteAttempt(victim, thiefName, reason) {
    const last = [...victim.inbox].reverse().find((i) => i.type === 'attempt' && i.by === thiefName);
    if (last && Date.now() - last.at < 5 * 60_000) return;
    pushInbox(victim, { type: 'attempt', by: thiefName, reason, at: Date.now() });
  }

  // ---------------------------------------------------------------- présence et notifications (phase 4)

  let isOnline = () => false; // fourni par le gestionnaire de quartiers
  const notify = (p, category, msg) => (push ? push.notify(p, category, msg).catch(() => 'erreur') : Promise.resolve('push désactivé'));

  /** Toutes les 30 s : gardes sur le départ, caisse pleine (seulement pour les joueurs absents). */
  setInterval(() => {
    const now = Date.now();
    for (const p of players.values()) {
      if (!p.push?.subs?.length || isOnline(p.id)) continue;
      const g = p.security.guards;
      if (g && g.until > now && g.until - now <= 10 * 60_000 && p.guardsNotified !== g.until) {
        p.guardsNotified = g.until;
        touch(p);
        void notify(p, 'guards', { title: '👮 Vos gardes partent bientôt', body: `Leur contrat se termine dans ${Math.ceil((g.until - now) / 60_000)} min. Revenez le renouveler avant les voleurs !` });
      }
      if (!p.cashFullNotified && income(p) > 0) {
        accrue(p, now);
        if (p.cash >= cashCap(p) - 1) {
          p.cashFullNotified = true;
          touch(p);
          void notify(p, 'cash', { title: '💰 Caisse pleine', body: `${Math.floor(p.cash).toLocaleString('fr-FR')} pièces vous attendent : elle ne se remplit plus tant que vous n’encaissez pas.` });
        }
      }
    }
  }, 30_000).unref();

  // ---------------------------------------------------------------- enchères : argent bloqué et attribution des lots

  /** Bloque `amount` pièces pour une enchère (rendues si le joueur est surenchéri). */
  function hold(p, amount) {
    accrue(p);
    if (!validPrice(amount) || !Number.isFinite(p.coins) || p.coins < amount) return false;
    p.coins -= amount;
    p.escrow += amount;
    touch(p);
    return true;
  }

  function release(p, amount) {
    const a = Math.min(amount, p.escrow);
    p.escrow -= a;
    p.coins += a;
    touch(p);
  }

  /** Lot adjugé : l'argent bloqué est encaissé, l'œuvre arrive dans le musée (ou en réserve). */
  function award(p, workId, frame, price) {
    const now = Date.now();
    accrue(p, now);
    p.escrow = Math.max(0, p.escrow - price);
    const artwork = { uid: randomBytes(6).toString('base64url'), workId, frame, slot: freeSlot(p, workId), boughtAt: now, auction: true };
    p.artworks.push(artwork);
    p.stats.auctions++;
    p.records.auction = Math.max(p.records.auction, price);
    p.week.auction = Math.max(p.week.auction, price);
    const rarity = works.get(workId).rarity;
    if (rarity !== 'commun') p.stats.rare++;
    if (['epique', 'legendaire', 'mythique'].includes(rarity)) p.stats.epic++;
    if (frame !== 'normal') p.stats.framed++;
    touch(p);
    changed(p);
    return artwork;
  }

  /** Une œuvre unique (Mythique) déjà possédée par un joueur ne peut pas repasser en vente. */
  const ownerOf = (workId) => [...players.values()].find((p) => p.artworks.some((a) => a.workId === workId && !a.repro)) ?? null;

  // ---------------------------------------------------------------- monnaie premium (STH coins) et Lucky coffres

  const PREMIUM = catalog.premium ?? { coinsPerSth: 150_000, minExchange: 10, maxExchange: 100_000, packs: [] };
  const CHESTS = catalog.chests ?? {};
  const BULK = catalog.chestBulk ?? { qty: 5, discount: 0.1 };
  const RARITY_ORDER = ['commun', 'rare', 'epique', 'legendaire', 'mythique'];
  const rank = (r) => RARITY_ORDER.indexOf(r);
  /** Tirage équitable (générateur cryptographique) : un nombre dans [0, 1). */
  const fairRandom = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

  /** Mythiques uniques que personne ne possède (recalculé au plus toutes les 2 s, et après chaque changement). */
  let mythicCache = { at: 0, list: /** @type {any[]} */ ([]) };
  function freeMythics() {
    const now = Date.now();
    if (now - mythicCache.at > 2000) mythicCache = { at: now, list: catalog.works.filter((w) => w.unique && !ownerOf(w.id)) };
    return mythicCache.list;
  }

  /** Prix d'un achat de coffres : un lot (×5) bénéficie d'une remise. */
  const chestCost = (id, qty) => Math.round(CHESTS[id].price * qty * (qty >= BULK.qty ? 1 - BULK.discount : 1));

  /**
   * Ouvre un coffre : rareté tirée selon les probabilités affichées, garantie (« pity ») si elle est due,
   * œuvre au hasard dans cette rareté, cadre spécial selon les chances du coffre.
   * Une Mythique n'est possible que si l'une d'elles est libre (unique sur tout le serveur), sinon c'est une Légendaire.
   */
  function rollChest(p, id) {
    const c = CHESTS[id];
    const entries = Object.entries(c.odds).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = fairRandom() * total;
    let rarity = entries[entries.length - 1][0];
    for (const [k, w] of entries) {
      r -= w;
      if (r < 0) {
        rarity = k;
        break;
      }
    }
    let pityUsed = false;
    if (c.pity) {
      p.pity[id] = (p.pity[id] ?? 0) + 1;
      if (rank(rarity) < rank(c.pity.rarity) && p.pity[id] >= c.pity.every) {
        rarity = c.pity.rarity;
        pityUsed = true;
      }
      if (rank(rarity) >= rank(c.pity.rarity)) p.pity[id] = 0;
    }
    let pool = [];
    if (rarity === 'mythique') {
      pool = freeMythics();
      if (!pool.length) rarity = 'legendaire';
    }
    if (rarity !== 'mythique') pool = catalog.works.filter((w) => w.rarity === rarity && !w.unique);
    const w = pool[Math.floor(fairRandom() * pool.length)];
    let frame = 'normal';
    if (!w.unique) {
      const f = fairRandom() * 100;
      const fr = c.frames ?? {};
      if (f < (fr.arcenciel ?? 0)) frame = 'arcenciel';
      else if (f < (fr.arcenciel ?? 0) + (fr.diamant ?? 0)) frame = 'diamant';
      else if (f < (fr.arcenciel ?? 0) + (fr.diamant ?? 0) + (fr.dore ?? 0)) frame = 'dore';
      // saison en cours : une petite chance de mutation saisonnière (Givrée à Noël, Hantée à Halloween…)
      const mut = seasonMutation();
      if (frame === 'normal' && mut && fairRandom() < (SEASON_RULES.chestMutationChance ?? 0)) frame = mut;
    }
    return { workId: w.id, rarity, frame, pityUsed };
  }

  /** Crédit de STH coins après un paiement confirmé : une seule fois par commande (idempotent). */
  function creditSth(playerId, sth, orderId, meta = {}) {
    const p = players.get(playerId);
    if (!p || !Number.isInteger(sth) || sth <= 0) return null;
    if (p.purchases.some((x) => x.order === orderId)) return { already: true, sth: p.sth };
    p.sth += sth;
    p.purchases = [...p.purchases.slice(-49), { order: orderId, sth, at: Date.now(), ...meta }];
    touch(p);
    return { already: false, sth: p.sth };
  }

  // ---------------------------------------------------------------- vols (appelés par le gestionnaire de quartiers)

  const listeners = [];
  const changed = (p) => {
    rankCache.at = 0; // une valeur de musée a pu changer : le classement est recalculé à la prochaine demande
    mythicCache.at = 0; // une Mythique a pu changer de main
    listeners.forEach((fn) => fn(p));
  };
  const shielded = (p, now = Date.now()) => now - p.createdAt < BEGINNER_MS && value(p) < BEGINNER_VALUE;

  /** Raison pour laquelle `thief` ne peut pas voler `victim`, ou null si c'est permis. */
  function stealBlocker(thief, victim, victimOnline, now = Date.now()) {
    if (thief.id === victim.id) return 'C’est votre propre musée';
    if (shielded(victim, now)) return 'Bouclier débutant : ce musée est protégé';
    // Plus de restriction de délai d'attente après un vol (en ligne ou absent) : vol libre à tout moment
    return null;
  }

  /** « 1 h 05 » ou « 12 min ». */
  const waitText = (ms) => {
    const min = Math.max(1, Math.ceil(ms / 60_000));
    return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
  };

  /** L'œuvre est décrochée : elle reste au propriétaire mais ne rapporte plus et ne s'affiche plus. */
  function markCarried(victim, uid, thiefId) {
    const a = victim.artworks.find((x) => x.uid === uid && x.slot !== null && !x.carriedBy);
    if (!a) return null;
    accrue(victim);
    a.carriedBy = thiefId;
    touch(victim);
    changed(victim);
    return a;
  }

  function returnCarried(victim, uid) {
    const a = victim.artworks.find((x) => x.uid === uid);
    if (!a?.carriedBy) return;
    accrue(victim);
    delete a.carriedBy;
    touch(victim);
    changed(victim);
  }

  /** Vol réussi : l'œuvre change de propriétaire. */
  function completeTheft(thief, victim, uid, victimOnline) {
    const i = victim.artworks.findIndex((x) => x.uid === uid && x.carriedBy === thief.id);
    if (i < 0) return null;
    const now = Date.now();
    accrue(victim, now);
    accrue(thief, now);
    const [a] = victim.artworks.splice(i, 1);
    delete a.carriedBy;
    // la place reste VIDE : avant, une œuvre de la réserve s'y accrochait toute seule, et les autres joueurs
    // croyaient voir l'œuvre volée encore au mur (surtout quand c'était un double du même tableau).
    // Le propriétaire choisit lui-même quoi exposer à sa place (inventaire → réserve).
    const artwork = { ...a, slot: freeSlot(thief, a.workId), boughtAt: now };
    thief.artworks.push(artwork);
    thief.stats.stolen++;
    const loot = workValue(a);
    thief.records.theft = Math.max(thief.records.theft, loot);
    thief.week.theft = Math.max(thief.week.theft, loot);
    victim.immuneUntil = 0;
    // assurance : la moitié de la valeur est remboursée
    const refund = victim.security.insuranceUntil > now ? Math.floor(workValue(a) * SEC.insurance.refund) : 0;
    victim.coins += refund;
    if (!victimOnline) {
      // absent : il l'apprendra à sa reconnexion (en ligne, il est prévenu en direct)
      victim.lastOfflineLoss = now;
      pushInbox(victim, { type: 'stolen', workId: a.workId, frame: a.frame, by: thief.name, refund, at: now });
      void notify(victim, 'stolen', {
        title: '🖼 On vous a volé une œuvre',
        body: `${thief.name} est reparti avec « ${works.get(a.workId).title} ».${refund ? ` Assurance : +${refund.toLocaleString('fr-FR')} pièces.` : ' Pensez aux gardes !'}`,
      });
    }
    touch(victim);
    touch(thief);
    changed(victim);
    changed(thief);
    return Object.assign(artwork, { refund });
  }

  /** Voleur arrêté (par le propriétaire ou un garde) : l'œuvre revient, il paie une amende au propriétaire. */
  function arrest(thief, victim, uid, { byGuard = false, victimOnline = true } = {}) {
    const a = victim.artworks.find((x) => x.uid === uid);
    if (!a) return 0;
    returnCarried(victim, uid);
    accrue(thief);
    const fine = Math.min(Math.floor(thief.coins), Math.floor(workValue(a) * FINE_RATE));
    thief.coins -= fine;
    victim.coins += fine;
    victim.stats.arrests++;
    if (!victimOnline) pushInbox(victim, { type: 'caught', by: thief.name, workId: a.workId, fine, byGuard, at: Date.now() });
    touch(thief);
    touch(victim);
    return fine;
  }

  /** Voleur surpris en plein décrochage par un garde : pas d'amende, mais le propriétaire absent est prévenu. */
  function caughtTrying(thief, victim, victimOnline) {
    victim.stats.arrests++;
    if (!victimOnline) pushInbox(victim, { type: 'caught', by: thief.name, fine: 0, byGuard: true, at: Date.now() });
    touch(victim);
  }

  /** Vue publique d'un musée (ce que les autres joueurs voient). */
  function snapshot(p) {
    return {
      id: p.id, name: p.name, color: p.color, country: p.country ?? 'FR', level: p.level, rooms: levelInfo(p).rooms, floors: levelInfo(p).floors ?? 1,
      artworks: p.artworks.filter((a) => a.slot !== null).map((a) => ({ uid: a.uid, workId: a.workId, frame: a.frame, slot: a.slot, carried: !!a.carriedBy, ...(a.repro ? { repro: true } : {}) })),
      themes: p.roomThemes ?? {},
      ticket: ticketPrice(p),
      value: Math.round(value(p)), shielded: shielded(p), immuneUntil: 0,
      robbedUntil: 0,
      sec: publicSecurity(p),
      rebirths: p.rebirths ?? 0,
      skin: p.skin ?? 0,
    };
  }

  /** Jeton de l'appareil d'origine, ou d'un appareil connecté ensuite avec Google. */
  function tokenOk(p, token) {
    if (typeof token !== 'string' || !token) return false;
    const a = Buffer.from(hash(token));
    return [p.tokenHash, ...(p.deviceTokens ?? [])].some((h) => {
      const b = Buffer.from(h);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  function authenticate(id, token) {
    const p = ID_RE.test(String(id)) ? players.get(id) : null;
    if (!p || !tokenOk(p, token)) return null;
    seen(p);
    return p;
  }

  // ---------------------------------------------------------------- compte Google (facultatif : SAM_GOOGLE_CLIENT_ID)

  const GOOGLE_CLIENT_ID = process.env.SAM_GOOGLE_CLIENT_ID || '';
  /**
   * Vérifie un jeton « Sign in with Google » auprès de Google et renvoie une empreinte de l'identifiant du compte.
   * On ne garde ni l'e-mail ni le nom : seulement cette empreinte, pour retrouver le musée sur un autre appareil.
   */
  async function googleKey(credential) {
    if (!GOOGLE_CLIENT_ID) throw Object.assign(new Error('Connexion Google non configurée sur ce serveur'), { status: 503 });
    if (typeof credential !== 'string' || credential.length > 4096) throw Object.assign(new Error('Jeton Google invalide'), { status: 422 });
    let info;
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      info = r.ok ? await r.json() : null;
    } catch {
      throw Object.assign(new Error('Google ne répond pas, réessayez'), { status: 503 });
    }
    const okIss = info && (info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com');
    if (!info || info.aud !== GOOGLE_CLIENT_ID || !okIss || Number(info.exp) * 1000 < Date.now() || !info.sub) {
      throw Object.assign(new Error('Jeton Google refusé'), { status: 401 });
    }
    // on garde seulement une empreinte de l'identifiant Google ; le nom sert à nommer un nouveau musée
    return { key: hash(`google:${info.sub}`), name: typeof info.name === 'string' ? info.name : '' };
  }

  // ---------------------------------------------------------------- comptes

  /** Nouveau joueur (invité ou compte) : renvoie le joueur et son jeton de session. */
  function newPlayer(body) {
    const id = randomBytes(9).toString('base64url');
    const token = newToken();
    const p = migrate({
      id, tokenHash: hash(token), name: cleanName(body.name) ?? `Musée n°${players.size + 1}`,
      color: colors.includes(body.color) ? body.color : colors[0],
      country: cleanCountry(body.country) ?? 'FR',
      skin: cleanSkin(body.skin) ?? 0,
      coins: START_COINS, level: 1, artworks: [], cash: 0, lastTick: Date.now(), createdAt: Date.now(), lastSeen: Date.now(), bought: [],
    });
    players.set(id, p);
    touch(p);
    return { p, token };
  }

  const byEmail = (email) => (email ? [...players.values()].find((x) => x.email === email) ?? null : null);
  /** Nom déjà utilisé par un autre compte (les invités, eux, peuvent porter le même nom). */
  const nameTaken = (name, self) => [...players.values()].some((x) => x !== self && (x.email || x.googleKey) && x.name.toLowerCase() === name.toLowerCase());

  /** Session pour un nouvel appareil (5 appareils au plus) : jeton, état, gains hors ligne, messages en attente. */
  function openSession(p) {
    const token = newToken();
    p.deviceTokens = [...(p.deviceTokens ?? []).slice(-4), hash(token)];
    const offlineGain = accrue(p);
    const inbox = p.inbox;
    p.inbox = [];
    seen(p);
    touch(p);
    return { id: p.id, token, state: state(p), offlineGain: Math.floor(offlineGain), created: false, inbox };
  }

  function metric(p, m) {
    switch (m) {
      case 'owned': return p.artworks.length;
      case 'shown': return p.artworks.filter((a) => a.slot !== null).length;
      case 'level': return p.level;
      case 'income': return income(p);
      case 'value': return value(p);
      default: return p.stats[m] ?? 0; // collected, rare, epic, framed : compteurs cumulés
    }
  }

  function currentQuest(p) {
    const q = quests[p.questIndex];
    if (!q) return null;
    const progress = Math.min(q.target, metric(p, q.metric));
    return { id: q.id, label: q.label, hint: q.hint, progress, target: q.target, reward: q.reward, done: progress >= q.target, index: p.questIndex, total: quests.length };
  }

  /** Rang du joueur au classement des valeurs (1 = le plus riche). */
  // Valeurs de tous les musées, triées et recalculées au plus toutes les 2 s :
  // avant, chaque appel à state() reparcourait tous les joueurs et toutes leurs œuvres.
  let rankCache = { at: 0, values: /** @type {number[]} */ ([]) };
  function rankOf(p) {
    const now = Date.now();
    if (now - rankCache.at > 2000 || rankCache.values.length !== players.size) {
      rankCache = { at: now, values: [...players.values()].map(value).sort((a, b) => b - a) };
    }
    const v = value(p);
    // nombre de musées strictement plus riches (recherche dichotomique dans la liste décroissante)
    let lo = 0;
    let hi = rankCache.values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rankCache.values[mid] > v) lo = mid + 1;
      else hi = mid;
    }
    return { rank: lo + 1, of: players.size };
  }

  function state(p) {
    const next = levels[p.level] ?? null;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      country: p.country ?? 'FR',
      quest: currentQuest(p),
      ...rankOf(p),
      coins: Math.floor(p.coins),
      level: p.level,
      slots: levelInfo(p).slots,
      rooms: levelInfo(p).rooms,
      floors: levelInfo(p).floors ?? 1,
      roomThemes: p.roomThemes ?? {},
      visitorsCap: levelInfo(p).visitors,
      next: next ? { level: next.level, cost: next.cost, rooms: next.rooms, slots: next.slots, floors: next.floors ?? 1 } : null,
      // l'identifiant interne du voleur (carriedBy) ne sort pas du serveur : seulement « en cours de vol »
      artworks: p.artworks.map(({ carriedBy, ...a }) => (carriedBy ? { ...a, carried: true } : a)),
      cash: Math.floor(p.cash),
      cashCap: Math.floor(cashCap(p)),
      income: income(p),
      value: value(p),
      serverTime: Date.now(),
      shielded: shielded(p),
      immuneUntil: 0,
      stolen: p.stats.stolen,
      arrests: p.stats.arrests,
      sec: publicSecurity(p),
      guardsUntil: p.security.guards?.until ?? 0,
      guardsTier: p.security.guards?.tier ?? null,
      camerasUntil: p.security.camerasUntil,
      insuranceUntil: p.security.insuranceUntil,
      dogUntil: p.security.dogUntil,
      offers: securityOffers(p),
      tools: p.tools,
      toolPrices: toolPrices(p),
      escrow: p.escrow,
      google: !!p.googleKey,
      push: { devices: p.push?.subs?.length ?? 0, prefs: p.push?.prefs ?? null },
      // boutique, renaissance, récompense du jour, événement du convoi
      upgrades: Object.fromEntries(Object.keys(UPGRADES).map((id) => {
        const lvl = upgLevel(p, id);
        const next = UPGRADES[id].levels[lvl] ?? null;
        return [id, { level: lvl, max: UPGRADES[id].levels.length, value: upgValue(p, id, null), next: next ? { price: next.price, value: next.value } : null }];
      })),
      rebirths: p.rebirths,
      incomeMult: incomeMult(p),
      rebirth: { cost: rebirthCost(p), minLevel: REBIRTH.minLevel, bonus: REBIRTH.incomeBonus, ready: p.level >= REBIRTH.minLevel },
      daily: dailyInfo(p),
      event: eventAt(Date.now()),
      inviteCode: p.inviteCode,
      skin: p.skin ?? 0,
      // monnaie premium et inventaire des Lucky coffres
      sth: Math.floor(p.sth),
      chests: Object.fromEntries(Object.keys(CHESTS).map((id) => [id, p.chests[id] ?? 0])),
      pity: Object.fromEntries(Object.keys(CHESTS).filter((id) => CHESTS[id].pity).map((id) => [id, { count: p.pity[id] ?? 0, every: CHESTS[id].pity.every, rarity: CHESTS[id].pity.rarity }])),
      freeMythics: freeMythics().map((w) => w.id),
      // échange pièces → STH plafonné par mois, saison du monde, cadeau saisonnier, serveur privé
      exchange: exchangeInfo(p),
      season: currentSeason(),
      gift: giftInfo(p),
      privateServer: { until: p.privateUntil ?? 0, price: PRIVATE.price, days: PRIVATE.days },
      // compte : l'e-mail n'est envoyé qu'à son propriétaire ; jamais le mot de passe ni son empreinte
      account: { email: p.email ?? null, password: !!p.passwordHash, google: !!p.googleKey },
    };
  }

  // ---------------------------------------------------------------- récompense quotidienne (série de jours)

  const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (ms) => parisDay.format(new Date(ms));
  /** Récompense du jour : la série continue si l'on revient le lendemain ; montant indexé sur le revenu. */
  function dailyInfo(p, now = Date.now()) {
    const today = dayKey(now);
    const yesterday = dayKey(now - 86_400_000);
    const claimable = p.daily.day !== today;
    const streak = claimable ? (p.daily.day === yesterday ? p.daily.streak + 1 : 1) : p.daily.streak;
    const i = (Math.max(1, streak) - 1) % DAILY.length;
    // 10 à 40 min de revenu, jamais moins que le barème (pour rester utile en fin de partie)
    const reward = Math.max(DAILY[i], Math.round(income(p) * 60 * (5 + 5 * (i + 1))));
    return { claimable, streak, reward, day: i + 1, days: DAILY.length };
  }

  // ---------------------------------------------------------------- échange pièces → STH : plafond mensuel

  /** Mois en cours (heure de Paris) : « 2026-11 ». */
  const monthKey = (ms) => dayKey(ms).slice(0, 7);
  /** Ce qu'il reste à échanger ce mois-ci (montant et nombre d'échanges plafonnés : les STH s'achètent surtout). */
  function exchangeInfo(p, now = Date.now()) {
    const month = monthKey(now);
    const same = p.exchange?.month === month;
    const used = same ? p.exchange.sth : 0;
    const count = same ? p.exchange.count : 0;
    const cap = PREMIUM.monthlyCap ?? 100;
    const maxCount = PREMIUM.monthlyCount ?? 3;
    const left = count >= maxCount ? 0 : Math.max(0, cap - used);
    // prochain mois : le 1er à minuit (heure de Paris, approchée à l'heure UTC du serveur)
    const [y, m] = month.split('-').map(Number);
    return { month, used, count, cap, maxCount, left, rate: PREMIUM.coinsPerSth, min: PREMIUM.minExchange ?? 5, resetsAt: Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) };
  }

  // ---------------------------------------------------------------- saisons (thème du monde choisi par l'admin)

  const SEASONS = catalog.seasons ?? {};
  const SEASON_RULES = catalog.seasonRules ?? { mutationChance: 0.05, chestMutationChance: 0.04, gift: { coinsMinutes: 15, minCoins: 2000, sth: 5, odds: { coins: 62, sth: 30, chest: 8 } } };
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  /** Réglage de l'admin : « auto » (selon la date) ou une saison imposée, avec des couleurs personnalisées facultatives. */
  let seasonCfg = { mode: 'auto', id: null, custom: null };
  try {
    const saved = await db.kvGet('season');
    if (saved && typeof saved === 'object') seasonCfg = { mode: saved.mode === 'manual' ? 'manual' : 'auto', id: saved.id ?? null, custom: saved.custom ?? null };
  } catch (e) {
    console.error('Lecture de la saison impossible :', e.message);
  }

  /** Saison du calendrier : Noël du 1er décembre au 6 janvier, Halloween du 15 octobre au 2 novembre, etc. */
  function autoSeason(ms) {
    const d = dayKey(ms);
    const v = Number(d.slice(5, 7)) * 100 + Number(d.slice(8, 10));
    for (const [id, s] of Object.entries(SEASONS)) {
      if (!Array.isArray(s.auto)) continue;
      const a = s.auto[0][0] * 100 + s.auto[0][1];
      const b = s.auto[1][0] * 100 + s.auto[1][1];
      if (a <= b ? v >= a && v <= b : v >= a || v <= b) return id;
    }
    return 'classique';
  }

  function currentSeason(now = Date.now()) {
    const id = seasonCfg.mode === 'manual' && own(SEASONS, seasonCfg.id) ? seasonCfg.id : autoSeason(now);
    return { id, mode: seasonCfg.mode, custom: seasonCfg.custom ?? null };
  }

  /** Admin : saison imposée (ou « auto ») et couleurs personnalisées du ciel et du sol. */
  async function setSeason(body) {
    const mode = body.mode === 'auto' ? 'auto' : 'manual';
    const id = mode === 'manual' ? String(body.id ?? '') : null;
    if (mode === 'manual' && !own(SEASONS, id)) throw new Error('Saison inconnue');
    let custom = null;
    if (body.custom && typeof body.custom === 'object') {
      custom = {};
      for (const k of ['skyTop', 'skyHorizon', 'grass']) if (HEX_RE.test(String(body.custom[k] ?? ''))) custom[k] = String(body.custom[k]).toLowerCase();
      if (!Object.keys(custom).length) custom = null;
    }
    seasonCfg = { mode, id, custom };
    await db.kvSet('season', seasonCfg);
    return currentSeason();
  }

  /** Mutation saisonnière en cours (frame du catalogue), ou null. */
  function seasonMutation(now = Date.now()) {
    const m = SEASONS[currentSeason(now).id]?.mutation;
    return m && frames[m] ? m : null;
  }

  /** Cadeau saisonnier du jour (un par jour et par joueur, pendant les saisons qui en offrent). */
  function giftInfo(p, now = Date.now()) {
    const id = currentSeason(now).id;
    const g = SEASONS[id]?.gift;
    if (!g) return null;
    return { season: id, label: g.label, icon: g.icon, available: p.seasonGift?.day !== dayKey(now) };
  }

  function openGift(p, now = Date.now()) {
    const info = giftInfo(p, now);
    if (!info) return { error: 'Pas de cadeau en ce moment : revenez pendant une saison festive !' };
    if (!info.available) return { error: `${info.label} déjà ouvert aujourd’hui : revenez demain !` };
    accrue(p, now);
    const rules = SEASON_RULES.gift ?? {};
    const odds = Object.entries(rules.odds ?? { coins: 1 });
    let r = fairRandom() * odds.reduce((s, [, w]) => s + w, 0);
    let kind = odds[0][0];
    for (const [k, w] of odds) {
      r -= w;
      if (r < 0) {
        kind = k;
        break;
      }
    }
    let amount = 1;
    if (kind === 'sth') {
      amount = rules.sth ?? 5;
      p.sth += amount;
    } else if (kind === 'chest' && CHESTS.simple) {
      p.chests.simple = (p.chests.simple ?? 0) + 1;
    } else {
      kind = 'coins';
      amount = Math.max(rules.minCoins ?? 2000, Math.round(income(p) * 60 * (rules.coinsMinutes ?? 15)));
      p.coins += amount;
    }
    p.seasonGift = { day: dayKey(now), season: info.season };
    touch(p);
    return { reward: { kind, amount }, gift: info };
  }

  // ---------------------------------------------------------------- serveur privé (acheté en STH coins)

  const PRIVATE = catalog.privateServer ?? { price: 200, days: 30, max: 7 };

  // ---------------------------------------------------------------- convoi

  function convoyItem(p, window) {
    const rnd = seededRandom(`${p.id}:${window}`);
    // événement en cours au départ du camion, et flair de collectionneur (boutique)
    const ev = eventAt(window * WINDOW_MS).current?.kind ?? null;
    const luck = upgValue(p, 'luck', 1) * (ev === 'rare' ? 3 : 1);
    const weight = (id, r) => r.convoyWeight * (id === 'commun' ? 1 : luck);
    const total = convoyPool.reduce((s, [id, r]) => s + weight(id, r), 0);
    let roll = rnd() * total;
    let rarity = convoyPool[0][0];
    for (const [id, r] of convoyPool) {
      roll -= weight(id, r);
      if (roll < 0) {
        rarity = id;
        break;
      }
    }
    const pool = catalog.works.filter((w) => w.rarity === rarity && !w.unique);
    const work = pool[Math.floor(rnd() * pool.length)];
    const f = rnd();
    const fx = ev === 'golden' ? 4 : 1;
    // cadre arc-en-ciel (×10) : très rare, un camion sur quatre pendant le « convoi arc-en-ciel »
    const rainbow = ev === 'arcenciel' ? 0.25 : (frames.arcenciel?.chance ?? 0) * fx;
    let frame = rnd() < rainbow ? 'arcenciel'
      : f < frames.diamant.chance * fx ? 'diamant' : f < (frames.diamant.chance + frames.dore.chance) * fx ? 'dore' : 'normal';
    // saison en cours : mutation saisonnière sur une partie des camions (tirage à part : le reste du camion ne change pas)
    const mut = seasonMutation();
    if (mut && frame === 'normal' && seededRandom(`${p.id}:${window}:mutation`)() < (SEASON_RULES.mutationChance ?? 0)) frame = mut;
    return {
      window, workId: work.id, frame, rarity, event: ev,
      price: Math.round(work.price * frames[frame].mult * (ev === 'soldes' ? 0.7 : 1)),
      startsAt: window * WINDOW_MS,
      sold: p.bought.includes(window),
    };
  }

  // ---------------------------------------------------------------- panneau admin : gestion des joueurs et cadeaux

  /** Erreur renvoyée telle quelle au panneau admin (statut HTTP 422 par défaut). */
  const fail = (message, status = 422) => {
    throw Object.assign(new Error(message), { status });
  };
  const isRegistered = (p) => !!(p.email || p.googleKey);
  const seenAt = (p) => p.lastSeen ?? p.lastTick ?? 0;
  function needPlayer(id) {
    const p = typeof id === 'string' ? players.get(id) : null;
    if (!p) fail('Joueur introuvable', 404);
    return p;
  }

  /** Ligne de la liste des joueurs (jamais le mot de passe, son empreinte ni les jetons de session). */
  function adminRow(p) {
    return {
      id: p.id, name: p.name, email: p.email ?? null, google: !!p.googleKey, password: !!p.passwordHash, registered: isRegistered(p),
      country: p.country ?? 'FR', color: p.color, level: p.level, maxLevel: levels.length,
      coins: Math.floor(p.coins), sth: Math.floor(p.sth), value: Math.round(value(p)), artworks: p.artworks.length,
      chestCount: Object.values(p.chests).reduce((s, n) => s + (Number(n) || 0), 0), rebirths: p.rebirths ?? 0,
      createdAt: p.createdAt ?? 0, lastSeen: seenAt(p), online: isOnline(p.id), escrow: p.escrow,
    };
  }

  /**
   * Liste paginée des joueurs. `filter` : all | registered (e-mail ou Google) | guests | online ;
   * `sort` : recent | seen | value | coins | sth | name ; `q` cherche dans le nom, l'e-mail, l'identifiant et le code d'invitation.
   */
  function adminListPlayers({ q = '', filter = 'all', sort = 'recent', page = 0, size = 50 } = {}) {
    const needle = String(q).trim().toLowerCase().slice(0, 100);
    const all = [...players.values()];
    let list = all;
    if (filter === 'registered') list = list.filter(isRegistered);
    else if (filter === 'guests') list = list.filter((p) => !isRegistered(p));
    else if (filter === 'online') list = list.filter((p) => isOnline(p.id));
    if (needle) {
      list = list.filter((p) => p.name.toLowerCase().includes(needle) || (p.email ?? '').includes(needle) || p.id.toLowerCase() === needle || p.inviteCode?.toLowerCase() === needle);
    }
    const key = { recent: (p) => p.createdAt ?? 0, seen: seenAt, value, coins: (p) => p.coins, sth: (p) => p.sth }[sort];
    if (key) list = list.map((p) => [key(p), p]).sort((a, b) => b[0] - a[0]).map(([, p]) => p);
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const n = Math.max(10, Math.min(200, Math.floor(Number(size)) || 50));
    const pages = Math.max(1, Math.ceil(list.length / n));
    const pg = Math.max(0, Math.min(pages - 1, Math.floor(Number(page)) || 0));
    const registered = all.filter(isRegistered).length;
    return {
      total: list.length, page: pg, pages, size: n,
      counts: { all: all.length, registered, guests: all.length - registered, online: all.filter((p) => isOnline(p.id)).length },
      players: list.slice(pg * n, pg * n + n).map(adminRow),
    };
  }

  /** Fiche complète d'un joueur pour le panneau admin. */
  function adminPlayer(id) {
    const p = needPlayer(id);
    accrue(p);
    const s = p.security;
    return {
      ...adminRow(p),
      cash: Math.floor(p.cash), income: income(p), inviteCode: p.inviteCode, skin: p.skin ?? 0, quest: p.questIndex,
      devices: 1 + (p.deviceTokens?.length ?? 0), pushDevices: p.push?.subs?.length ?? 0,
      chests: Object.fromEntries(Object.keys(CHESTS).map((c) => [c, p.chests[c] ?? 0])),
      tools: p.tools, upgrades: p.upgrades, stats: p.stats, privateUntil: p.privateUntil ?? 0,
      security: { guardsUntil: s.guards?.until ?? 0, camerasUntil: s.camerasUntil, insuranceUntil: s.insuranceUntil, dogUntil: s.dogUntil, lasers: s.lasers, generator: s.generator },
      artworks: p.artworks.map((a) => ({ uid: a.uid, workId: a.workId, frame: a.frame, slot: a.slot, repro: !!a.repro, carried: !!a.carriedBy, value: Math.round(workValue(a)) })),
      purchases: p.purchases.slice(-10).reverse(),
    };
  }

  /** Création d'un compte par l'admin : l'e-mail est l'identifiant ; sans mot de passe, le joueur passe par « Mot de passe oublié ». */
  async function adminCreatePlayer(body) {
    const name = cleanName(body.name);
    if (!name) fail('Nom d’utilisateur : 2 à 24 caractères');
    const email = cleanEmail(body.email);
    if (!email) fail('E-mail invalide : il sert d’identifiant au joueur');
    if (byEmail(email)) fail('Cet e-mail a déjà un compte', 409);
    if (nameTaken(name, null)) fail('Ce nom d’utilisateur est déjà pris', 409);
    let passwordHash = null;
    if (body.password) {
      const bad = passwordProblem(body.password);
      if (bad) fail(bad);
      passwordHash = await hashPassword(body.password);
    }
    const { p } = newPlayer({ name, color: body.color, country: body.country });
    p.email = email;
    if (passwordHash) p.passwordHash = passwordHash;
    touch(p);
    changed(p);
    return adminPlayer(p.id);
  }

  /** Modification d'un joueur : identité, solde, niveau, mot de passe, déconnexion de tous ses appareils. */
  async function adminUpdatePlayer(id, body) {
    const p = needPlayer(id);
    // tout est vérifié avant la moindre modification : une requête refusée ne laisse rien à moitié changé
    const name = body.name === undefined ? undefined : cleanName(body.name);
    if (name === null) fail('Nom d’utilisateur : 2 à 24 caractères');
    const email = body.email === undefined || body.email === (p.email ?? '') ? undefined : cleanEmail(body.email);
    if (email === null) fail('E-mail invalide');
    if (email && byEmail(email) && byEmail(email) !== p) fail('Cet e-mail est déjà utilisé par un autre compte', 409);
    if (name && (email || isRegistered(p)) && nameTaken(name, p)) fail('Ce nom d’utilisateur est déjà pris', 409);
    const country = body.country === undefined ? undefined : cleanCountry(body.country);
    if (country === null) fail('Pays inconnu');
    if (body.color !== undefined && !colors.includes(body.color)) fail('Couleur inconnue');
    const num = (v, label, max) => {
      if (v === undefined || v === '' || v === null) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) fail(`${label} : un nombre entier entre 0 et ${max.toLocaleString('fr-FR')}`);
      return n;
    };
    const coins = num(body.coins, 'Pièces', 1e15);
    const sth = num(body.sth, 'STH coins', 1e9);
    const level = num(body.level, 'Niveau', levels.length);
    if (level === 0) fail(`Niveau : de 1 à ${levels.length}`);
    if (level !== undefined && level !== p.level && p.artworks.some((a) => a.carriedBy)) fail('Une de ses œuvres est en train d’être volée : réessayez dans un instant', 409);
    const password = typeof body.password === 'string' && body.password ? body.password : null;
    if (password) {
      const bad = passwordProblem(password);
      if (bad) fail(bad);
      if (!email && !p.email) fail('Ajoutez d’abord un e-mail : c’est l’identifiant de connexion');
    }
    if (body.logout && !isRegistered(p) && !email) fail('Joueur invité : sans compte, il perdrait son musée pour toujours (supprimez-le plutôt)');
    const passwordHash = password ? await hashPassword(password) : null;

    accrue(p);
    if (name) p.name = name;
    if (email) p.email = email;
    if (country) p.country = country;
    if (body.color !== undefined) p.color = body.color;
    if (coins !== undefined) p.coins = coins;
    if (sth !== undefined) p.sth = sth;
    if (level !== undefined && level !== p.level) {
      const up = level > p.level;
      p.level = level;
      const slots = levelInfo(p).slots;
      // musée réduit : ce qui n'a plus de place part en réserve ; agrandi : la réserve rejoint les nouveaux emplacements
      for (const a of p.artworks) if (a.slot !== null && a.slot >= slots) a.slot = null;
      if (up) for (const a of p.artworks) if (a.slot === null) a.slot = freeSlot(p, a.workId);
    }
    if (passwordHash) p.passwordHash = passwordHash;
    if (body.logout || passwordHash) {
      // nouveau mot de passe ou déconnexion forcée : toutes les sessions ouvertes sont fermées
      p.tokenHash = hash(newToken());
      p.deviceTokens = [];
    }
    touch(p);
    changed(p);
    return { player: adminPlayer(p.id), loggedOut: !!(body.logout || passwordHash) };
  }

  /** Retire une œuvre du musée d'un joueur (modération). */
  function adminRemoveArtwork(id, uid) {
    const p = needPlayer(id);
    const i = p.artworks.findIndex((a) => a.uid === uid);
    if (i < 0) fail('Œuvre introuvable', 404);
    if (p.artworks[i].carriedBy) fail('Cette œuvre est en train d’être volée : réessayez dans un instant', 409);
    accrue(p);
    p.artworks.splice(i, 1);
    touch(p);
    changed(p);
    return adminPlayer(p.id);
  }

  /** Raison pour laquelle un joueur ne peut pas être supprimé tout de suite, ou null. */
  function adminDeleteBlocker(id) {
    const p = needPlayer(id);
    if (p.escrow > 0) return 'Ce joueur a une enchère en cours : réessayez à la fin du lot';
    if (p.artworks.some((a) => a.carriedBy)) return 'Une de ses œuvres est en train d’être volée : réessayez dans un instant';
    return null;
  }

  /** Suppression définitive (ses Mythiques redeviennent libres pour les ventes et les coffres). */
  async function adminDeletePlayer(id) {
    const why = adminDeleteBlocker(id);
    if (why) fail(why, 409);
    const p = players.get(id);
    players.delete(id);
    dirty.delete(id);
    rankCache.at = 0;
    mythicCache.at = 0;
    await saving; // une sauvegarde de ce joueur déjà en cours se termine avant l'effacement (sinon il reviendrait)
    await db.deletePlayer(id);
    return { id, name: p.name };
  }

  /**
   * Cadeau de l'admin : pièces, STH coins, Lucky coffres ou une œuvre, pour un ou plusieurs joueurs choisis,
   * ou pour tous (`target` : all | registered | online). Le joueur absent le découvre à sa reconnexion
   * (et par notification) ; celui qui est en ligne est prévenu en direct par le quartier (`online`).
   */
  function adminGift(body) {
    const kind = String(body.kind ?? '');
    const message = typeof body.message === 'string' ? body.message.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    let targets;
    if (body.target === 'all') targets = [...players.values()];
    else if (body.target === 'registered') targets = [...players.values()].filter(isRegistered);
    else if (body.target === 'online') targets = [...players.values()].filter((p) => isOnline(p.id));
    else if (Array.isArray(body.ids)) targets = [...new Set(body.ids.slice(0, 1000).map(String))].map((x) => players.get(x)).filter(Boolean);
    else targets = [];
    if (!targets.length) fail('Aucun joueur choisi');

    const amount = (max, label) => {
      const n = Number(body.amount);
      if (!Number.isInteger(n) || n < 1 || n > max) fail(`${label} : un nombre entier entre 1 et ${max.toLocaleString('fr-FR')}`);
      return n;
    };
    let gift;
    if (kind === 'coins') gift = { kind, amount: amount(1e12, 'Pièces') };
    else if (kind === 'sth') gift = { kind, amount: amount(1_000_000, 'STH coins') };
    else if (kind === 'chest') {
      if (!own(CHESTS, body.chest)) fail('Coffre inconnu');
      gift = { kind, chest: body.chest, amount: amount(100, 'Nombre de coffres') };
    } else if (kind === 'artwork') {
      const w = typeof body.workId === 'string' ? works.get(body.workId) : null;
      if (!w) fail('Œuvre inconnue');
      const frame = typeof body.frame === 'string' && own(frames, body.frame) ? body.frame : 'normal';
      if (w.unique) {
        // une Mythique est unique sur tout le serveur
        if (targets.length !== 1) fail('Une Mythique est unique : choisissez un seul joueur');
        const owner = ownerOf(w.id);
        if (owner) fail(`« ${w.title} » appartient déjà à ${owner.name}`, 409);
      }
      gift = { kind, workId: w.id, frame };
    } else fail('Cadeau inconnu');
    if (message) gift.message = message;

    const now = Date.now();
    const online = [];
    for (const p of targets) {
      accrue(p, now);
      if (kind === 'coins') p.coins += gift.amount;
      else if (kind === 'sth') p.sth += gift.amount;
      else if (kind === 'chest') p.chests[gift.chest] = (p.chests[gift.chest] ?? 0) + gift.amount;
      else {
        p.artworks.push({ uid: randomBytes(6).toString('base64url'), workId: gift.workId, frame: gift.frame, slot: freeSlot(p, gift.workId), boughtAt: now, gift: true });
        const rarity = works.get(gift.workId).rarity;
        if (rarity !== 'commun') p.stats.rare++;
        if (rank(rarity) >= rank('epique')) p.stats.epic++;
        if (gift.frame !== 'normal') p.stats.framed++;
        changed(p);
      }
      touch(p);
      if (isOnline(p.id)) online.push(p.id);
      else {
        pushInbox(p, { type: 'gift', ...gift, at: now });
        void notify(p, 'abuse', { title: '🎁 Un cadeau vous attend', body: `${giftText(gift)}${message ? ` · ${message}` : ''}. Revenez dans votre musée !` });
      }
    }
    return { gift, count: targets.length, online };
  }

  /** « 5 000 pièces », « 2 × Lucky coffre rare », « La Joconde (cadre doré) »… */
  function giftText(g) {
    const fr = (n) => n.toLocaleString('fr-FR');
    if (g.kind === 'coins') return `${fr(g.amount)} pièces`;
    if (g.kind === 'sth') return `${fr(g.amount)} STH coins`;
    if (g.kind === 'chest') return `${g.amount} × ${CHESTS[g.chest]?.label ?? 'Lucky coffre'}`;
    const w = works.get(g.workId);
    return `« ${w?.title ?? g.workId} »${g.frame !== 'normal' ? ` (${frames[g.frame]?.label ?? g.frame})` : ''}`;
  }

  // ---------------------------------------------------------------- HTTP

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new Error('json'));
        }
      });
      req.on('error', reject);
    });
  }

  const hits = new Map();
  // purge régulière : sans elle, une entrée par adresse IP s'accumulerait pour toujours
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 10 * 60_000) hits.delete(k);
  }, 5 * 60_000).unref();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  }

  function auth(req) {
    return authenticate(String(req.headers['x-player-id'] ?? ''), String(req.headers['x-player-token'] ?? ''));
  }

  async function handle(req, res, url) {
    const ip = clientIp(req);
    const route = url.pathname.slice('/api/game/'.length);
    if (req.method === 'POST' && limited(`${ip}:post`, devMode ? 5000 : 240, 60_000)) return json(res, 429, { error: 'Trop de requêtes' });

    if (route === 'leaderboard' && req.method === 'GET') {
      const board = url.searchParams.get('board') ?? 'value';
      const country = url.searchParams.get('country') || undefined;
      // « me » : la ligne du joueur qui regarde (repérée par son identifiant, pas par son nom qui peut avoir des homonymes)
      return json(res, 200, leaderboard(10, board, country, auth(req)));
    }

    let body = {};
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Requête invalide' });
      }
    }

    if (route === 'login' && req.method === 'POST') {
      const existing = ID_RE.test(String(body.id ?? '')) ? players.get(body.id) : null;
      if (existing && tokenOk(existing, body.token)) {
        seen(existing);
        const offlineGain = accrue(existing);
        const inbox = existing.inbox;
        if (inbox.length) {
          existing.inbox = [];
          touch(existing);
        }
        return json(res, 200, { id: existing.id, state: state(existing), offlineGain: Math.floor(offlineGain), created: false, inbox });
      }
      if (limited(`${ip}:create`, devMode ? 10_000 : 20, 10 * 60_000)) return json(res, 429, { error: 'Trop de comptes créés, réessayez plus tard' });
      const { p, token } = newPlayer(body);
      return json(res, 201, { id: p.id, token, state: state(p), offlineGain: 0, created: true });
    }

    // ------------------------------------------------------------ comptes : inscription, connexion, mot de passe oublié

    if (route === 'register' && req.method === 'POST') {
      // inscription. Avec une session d'invité : son musée devient un compte (rien n'est perdu)
      if (limited(`${ip}:create`, devMode ? 10_000 : 20, 10 * 60_000)) return json(res, 429, { error: 'Trop de comptes créés, réessayez plus tard' });
      const name = cleanName(body.username);
      if (!name) return json(res, 422, { error: 'Nom d’utilisateur : 2 à 24 caractères' });
      const email = cleanEmail(body.email);
      if (!email) return json(res, 422, { error: 'Adresse e-mail invalide' });
      const bad = passwordProblem(body.password);
      if (bad) return json(res, 422, { error: bad });
      if (byEmail(email)) return json(res, 409, { error: 'Cet e-mail a déjà un compte : connectez-vous (ou « Mot de passe oublié »)' });
      const guest = auth(req);
      if (nameTaken(name, guest)) return json(res, 409, { error: 'Ce nom d’utilisateur est déjà pris' });
      const passwordHash = await hashPassword(body.password);
      if (guest && !guest.email) {
        guest.name = name;
        guest.email = email;
        guest.passwordHash = passwordHash;
        if (colors.includes(body.color)) guest.color = body.color;
        const country = cleanCountry(body.country);
        if (country) guest.country = country;
        const skin = cleanSkin(body.skin);
        if (skin !== null) guest.skin = skin;
        touch(guest);
        changed(guest);
        return json(res, 200, { id: guest.id, state: state(guest), upgraded: true });
      }
      const { p, token } = newPlayer({ ...body, name });
      p.email = email;
      p.passwordHash = passwordHash;
      touch(p);
      return json(res, 201, { id: p.id, token, state: state(p), offlineGain: 0, created: true });
    }

    if (route === 'login/password' && req.method === 'POST') {
      const email = cleanEmail(body.email);
      if (limited(`${ip}:pw`, devMode ? 10_000 : 20, 15 * 60_000) || (email && limited(`mail:${email}`, devMode ? 10_000 : 10, 15 * 60_000))) {
        return json(res, 429, { error: 'Trop d’essais : réessayez dans quelques minutes' });
      }
      const p = email ? byEmail(email) : null;
      if (!p?.passwordHash || !(await verifyPassword(String(body.password ?? ''), p.passwordHash))) {
        return json(res, 401, { error: 'E-mail ou mot de passe incorrect' });
      }
      return json(res, 200, openSession(p));
    }

    if (route === 'password/forgot' && req.method === 'POST') {
      // réponse identique que le compte existe ou non (on ne révèle pas quels e-mails sont inscrits)
      const email = cleanEmail(body.email);
      if (!email) return json(res, 422, { error: 'Adresse e-mail invalide' });
      if (limited(`${ip}:forgot`, devMode ? 10_000 : 5, 15 * 60_000) || limited(`forgot:${email}`, devMode ? 10_000 : 3, 3600_000)) {
        return json(res, 429, { error: 'Trop de demandes : réessayez plus tard' });
      }
      const reply = { ok: true, message: 'Si un compte existe avec cet e-mail, un lien pour changer le mot de passe vient d’y être envoyé (valable 1 heure).' };
      const p = byEmail(email);
      if (!p) return json(res, 200, reply);
      const token = newToken(32);
      p.reset = { hash: hash(token), until: Date.now() + 3600_000 };
      touch(p);
      const base = (process.env.SAM_PUBLIC_URL || (devMode ? `http://${req.headers.host}` : '')).replace(/\/+$/, '');
      const link = `${base}/game/?reset=${token}`;
      if (!base) {
        console.error('Mot de passe oublié : SAM_PUBLIC_URL manquant, impossible de construire le lien');
        return json(res, 200, reply);
      }
      try {
        const sent = await sendResetEmail({ to: email, name: p.name, link });
        if (sent === 'not-configured') {
          console.warn(`Mot de passe oublié : Brevo non configuré (BREVO_API_KEY, SAM_MAIL_FROM). Lien pour ${p.name} : ${devMode ? link : '(masqué)'}`);
          if (devMode) return json(res, 200, { ...reply, devLink: link });
        }
      } catch (e) {
        console.error('Mot de passe oublié :', e.message);
      }
      return json(res, 200, reply);
    }

    if (route === 'password/reset' && req.method === 'POST') {
      if (limited(`${ip}:reset`, devMode ? 10_000 : 10, 15 * 60_000)) return json(res, 429, { error: 'Trop d’essais : réessayez plus tard' });
      const h = typeof body.token === 'string' && body.token ? hash(body.token) : '';
      const p = h ? [...players.values()].find((x) => x.reset?.hash === h && x.reset.until > Date.now()) : null;
      if (!p) return json(res, 410, { error: 'Lien expiré ou déjà utilisé : refaites une demande « Mot de passe oublié »' });
      const bad = passwordProblem(body.password);
      if (bad) return json(res, 422, { error: bad });
      p.passwordHash = await hashPassword(body.password);
      delete p.reset;
      // nouveau mot de passe : toutes les sessions ouvertes ailleurs sont fermées
      p.tokenHash = hash(newToken());
      p.deviceTokens = [];
      return json(res, 200, openSession(p));
    }

    if (route === 'login/google' && req.method === 'POST') {
      // connexion avec Google : retrouve le musée lié, sinon crée le compte (ou rattache le musée de l'invité)
      if (limited(`${ip}:google`, 20, 10 * 60_000)) return json(res, 429, { error: 'Trop d’essais, réessayez plus tard' });
      let g;
      try {
        g = await googleKey(body.credential);
      } catch (e) {
        return json(res, e.status ?? 401, { error: e.message });
      }
      let p = [...players.values()].find((x) => x.googleKey === g.key);
      if (!p) {
        const guest = auth(req);
        if (guest && !guest.googleKey && !guest.email) {
          p = guest;
        } else {
          let name = cleanName(g.name) ?? `Musée n°${players.size + 1}`;
          for (let i = 2; nameTaken(name, null) && i < 99; i++) name = cleanName(`${(cleanName(g.name) ?? 'Musée').slice(0, 20)} ${i}`) ?? name;
          p = newPlayer({ name, color: body.color, country: body.country }).p;
        }
        p.googleKey = g.key;
        touch(p);
      }
      return json(res, 200, openSession(p));
    }

    const p = auth(req);
    if (!p) return json(res, 401, { error: 'Session invalide' });

    if (route === 'logout' && req.method === 'POST') {
      // déconnexion de cet appareil : son jeton ne vaut plus rien (un invité ne peut pas se déconnecter : il perdrait son musée)
      if (!p.email && !p.googleKey) return json(res, 409, { error: 'Créez d’abord un compte, sinon votre musée serait perdu' });
      const h = hash(String(req.headers['x-player-token'] ?? ''));
      if (p.tokenHash === h) p.tokenHash = hash(newToken());
      p.deviceTokens = (p.deviceTokens ?? []).filter((x) => x !== h);
      touch(p);
      return json(res, 200, { ok: true });
    }

    if (route === 'link/google' && req.method === 'POST') {
      let key;
      try {
        key = (await googleKey(body.credential)).key;
      } catch (e) {
        return json(res, e.status ?? 401, { error: e.message });
      }
      const other = [...players.values()].find((x) => x.googleKey === key && x !== p);
      if (other) return json(res, 409, { error: 'Ce compte Google est déjà lié à un autre musée' });
      if (p.googleKey && p.googleKey !== key) return json(res, 409, { error: 'Ce musée est déjà lié à un autre compte Google' });
      p.googleKey = key;
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'state' && req.method === 'GET') {
      accrue(p);
      return json(res, 200, state(p));
    }

    if (route === 'convoy' && req.method === 'GET') {
      const now = Date.now();
      const w = Math.floor(now / WINDOW_MS);
      // tous les camions encore sur la route, plus le prochain départ
      const items = [];
      for (let x = Math.ceil((now - TRAVEL_MS) / WINDOW_MS); x <= w + 1; x++) items.push(convoyItem(p, x));
      return json(res, 200, { serverTime: now, intervalMs: WINDOW_MS, travelMs: TRAVEL_MS, items });
    }

    if (route === 'buy' && req.method === 'POST') {
      const now = Date.now();
      const window = Number(body.window);
      // achetable seulement pendant que le camion traverse la place
      const onRoad = Number.isInteger(window) && window * WINDOW_MS <= now && now <= window * WINDOW_MS + TRAVEL_MS + BUY_GRACE_MS;
      if (!onRoad) return json(res, 409, { error: 'Ce camion est déjà parti' });
      if (p.bought.includes(window)) return json(res, 409, { error: 'Déjà vendu' });
      const item = convoyItem(p, window);
      accrue(p, now);
      if (p.coins < item.price) return json(res, 402, { error: 'Pas assez de pièces' });
      p.coins -= item.price;
      const artwork = { uid: randomBytes(6).toString('base64url'), workId: item.workId, frame: item.frame, slot: freeSlot(p, item.workId), boughtAt: now };
      p.artworks.push(artwork);
      // assez d'historique pour couvrir tous les camions visibles en même temps (jamais deux achats du même camion)
      p.bought = [...p.bought.slice(-19), window];
      if (item.rarity !== 'commun') p.stats.rare++;
      if (item.rarity === 'epique') p.stats.epic++;
      if (item.frame !== 'normal') p.stats.framed++;
      touch(p);
      changed(p);
      return json(res, 200, { artwork, state: state(p) });
    }

    if (route === 'collect' && req.method === 'POST') {
      accrue(p);
      const collected = Math.floor(p.cash);
      p.coins += collected;
      p.cash -= collected;
      p.stats.collected += collected;
      p.cashFullNotified = false;
      touch(p);
      return json(res, 200, { collected, state: state(p) });
    }

    if (route === 'expand' && req.method === 'POST') {
      const next = levels[p.level];
      if (!next) return json(res, 409, { error: 'Musée déjà au maximum' });
      accrue(p);
      if (p.coins < next.cost) return json(res, 402, { error: 'Pas assez de pièces' });
      p.coins -= next.cost;
      p.level = next.level;
      // la réserve rejoint les nouveaux emplacements
      for (const a of p.artworks) if (a.slot === null) a.slot = freeSlot(p, a.workId);
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'sell' && req.method === 'POST') {
      const i = p.artworks.findIndex((a) => a.uid === body.uid);
      if (i < 0) return json(res, 404, { error: 'Œuvre introuvable' });
      if (p.artworks[i].carriedBy) return json(res, 409, { error: 'Cette œuvre est en train d’être volée !' });
      accrue(p);
      const [a] = p.artworks.splice(i, 1);
      const gain = Math.floor(workValue(a) * SELL_RATE);
      p.coins += gain;
      // une œuvre en réserve prend la place libérée
      const waiting = p.artworks.find((x) => x.slot === null);
      if (waiting && a.slot !== null) waiting.slot = a.slot;
      touch(p);
      changed(p);
      return json(res, 200, { gain, state: state(p) });
    }

    if (route === 'move' && req.method === 'POST') {
      const a = p.artworks.find((x) => x.uid === body.uid);
      if (!a) return json(res, 404, { error: 'Œuvre introuvable' });
      if (a.carriedBy) return json(res, 409, { error: 'Cette œuvre est en cours de vol' });
      const slot = Number(body.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= levelInfo(p).slots) return json(res, 422, { error: 'Emplacement invalide' });
      if (isStatueSlot(slot) && !isStatueWork(a.workId)) return json(res, 422, { error: 'Ce socle est réservé aux statues' });
      // Si une œuvre occupe déjà cet emplacement, on intervertit (swap)
      const other = p.artworks.find((x) => x.slot === slot && x.uid !== a.uid);
      if (other) {
        if (other.carriedBy) return json(res, 409, { error: 'L’œuvre ciblée est en cours de vol' });
        if (a.slot !== null && isStatueSlot(a.slot) && !isStatueWork(other.workId)) return json(res, 422, { error: 'Un tableau ne peut pas aller sur un socle de statue' });
        other.slot = a.slot;
      }
      a.slot = slot;
      touch(p);
      changed(p);
      // swappedUid : l'œuvre décrochée, que le joueur reprend en mains (sinon elle semblerait disparaître)
      return json(res, 200, { state: state(p), swapped: !!other, swappedUid: other?.uid ?? null });
    }

    if (route === 'decor' && req.method === 'POST') {
      const room = Number(body.room);
      const totalRooms = (levelInfo(p).floors ?? 1) > 1 ? 9 * Math.min(3, levelInfo(p).floors ?? 1) : levelInfo(p).rooms;
      if (!Number.isInteger(room) || room < 0 || room >= totalRooms) return json(res, 422, { error: 'Salle invalide' });
      const theme = String(body.theme || '');
      if (!THEMES.includes(theme)) return json(res, 422, { error: 'Thème invalide' });
      accrue(p);
      const COST = DECOR_COST;
      if (p.coins < COST) return json(res, 402, { error: `Il vous manque ${Math.ceil(COST - p.coins)} pièces pour relooker la salle` });
      p.coins -= COST;
      p.roomThemes ??= {};
      p.roomThemes[room] = theme;
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p), room, theme, cost: COST });
    }

    if (route === 'name' && req.method === 'POST') {
      const name = body.name === undefined ? p.name : cleanName(body.name);
      if (!name) return json(res, 422, { error: 'Nom de 2 à 24 caractères' });
      if ((p.email || p.googleKey) && nameTaken(name, p)) return json(res, 409, { error: 'Ce nom d’utilisateur est déjà pris' });
      const skin = body.skin === undefined ? p.skin : cleanSkin(body.skin);
      if (skin === null) return json(res, 422, { error: 'Tenue inconnue' });
      if (body.color !== undefined && !colors.includes(body.color)) return json(res, 422, { error: 'Couleur inconnue' });
      p.skin = skin;
      p.name = name;
      if (body.color) p.color = body.color;
      if (body.country !== undefined) {
        const country = cleanCountry(body.country);
        if (!country) return json(res, 422, { error: 'Pays inconnu' });
        p.country = country;
      }
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'security' && req.method === 'POST') {
      const now = Date.now();
      accrue(p, now);
      const offers = securityOffers(p);
      const s = p.security;
      let price;
      let apply;
      let label;
      switch (body.item) {
        case 'guards': {
          if (!own(SEC.guards, body.tier)) return json(res, 422, { error: 'Contrat inconnu' });
          const g = SEC.guards[body.tier];
          price = offers.guards[body.tier];
          label = `${g.label} : ${g.minutes >= 60 ? `${g.minutes / 60} h` : `${g.minutes} min`}`;
          apply = () => {
            // même contrat : on prolonge ; contrat différent : il remplace l'ancien
            const from = s.guards?.tier === body.tier && s.guards.until > now ? s.guards.until : now;
            s.guards = { tier: body.tier, count: g.count, until: from + g.minutes * 60_000 };
            p.stats.secured++;
          };
          break;
        }
        case 'cameras':
          price = offers.cameras;
          label = SEC.cameras.label;
          apply = () => {
            s.camerasUntil = Math.max(now, s.camerasUntil) + SEC.cameras.hours * 3600_000;
            p.stats.secured++;
          };
          break;
        case 'lasers':
        case 'generator':
          if (s[body.item]) return json(res, 409, { error: 'Déjà installé' });
          price = offers[body.item];
          label = SEC[body.item].label;
          apply = () => {
            s[body.item] = true;
            p.stats.secured++;
          };
          break;
        case 'dog':
          price = offers.dog;
          label = `${SEC.dog.label} · ${SEC.dog.hours} h`;
          apply = () => {
            s.dogUntil = Math.max(now, s.dogUntil) + SEC.dog.hours * 3600_000;
            p.stats.secured++;
          };
          break;
        case 'insurance':
          price = offers.insurance;
          label = SEC.insurance.label;
          apply = () => (s.insuranceUntil = Math.max(now, s.insuranceUntil) + SEC.insurance.hours * 3600_000);
          break;
        case 'vitrine': {
          if (!Number.isInteger(body.slot) || !own(offers.vitrines, body.slot)) return json(res, 404, { error: 'Aucune œuvre à cet emplacement' });
          const v = offers.vitrines[body.slot];
          if (v.price === null) return json(res, 409, { error: 'Vitrine déjà au maximum' });
          price = v.price;
          label = `${SEC.vitrine.label} (×${SEC.vitrine.levels[v.level].mult})`;
          apply = () => {
            s.vitrines[body.slot] = v.level + 1;
            p.stats.secured++;
          };
          break;
        }
        default:
          return json(res, 422, { error: 'Protection inconnue' });
      }
      if (!validPrice(price)) return json(res, 422, { error: 'Prix invalide' });
      if (p.coins < price) return json(res, 402, { error: `Il vous manque ${Math.ceil(price - p.coins)} pièces` });
      p.coins -= price;
      apply();
      touch(p);
      changed(p);
      return json(res, 200, { label, price, state: state(p) });
    }

    if (route === 'blackmarket' && req.method === 'POST' && body.tool === 'repro') {
      // reproduction d'une Mythique : pour la déco, sans valeur ni revenu
      const w = typeof body.workId === 'string' ? works.get(body.workId) : null;
      if (!w || !w.unique) return json(res, 422, { error: 'Seules les Mythiques sont reproduites' });
      accrue(p);
      const price = catalog.repro.price;
      if (p.coins < price) return json(res, 402, { error: `Il vous manque ${Math.ceil(price - p.coins)} pièces` });
      p.coins -= price;
      const artwork = { uid: randomBytes(6).toString('base64url'), workId: w.id, frame: 'normal', slot: freeSlot(p, w.id), boughtAt: Date.now(), repro: true };
      p.artworks.push(artwork);
      touch(p);
      changed(p);
      return json(res, 200, { tool: 'repro', artwork, price, state: state(p) });
    }

    if (route === 'blackmarket' && req.method === 'POST') {
      if (!own(TOOLS, body.tool)) return json(res, 422, { error: 'Outil inconnu' });
      if ((p.tools[body.tool] ?? 0) >= MAX_TOOLS) return json(res, 409, { error: `Vous en portez déjà ${MAX_TOOLS}` });
      accrue(p);
      const price = toolPrice(p, body.tool);
      if (!validPrice(price)) return json(res, 422, { error: 'Prix invalide' });
      if (p.coins < price) return json(res, 402, { error: `Il vous manque ${Math.ceil(price - p.coins)} pièces` });
      p.coins -= price;
      p.tools[body.tool] = (p.tools[body.tool] ?? 0) + 1;
      touch(p);
      return json(res, 200, { tool: body.tool, price, state: state(p) });
    }

    if (route === 'push/subscribe' && req.method === 'POST') {
      if (!push) return json(res, 503, { error: 'Notifications indisponibles' });
      const sub = cleanSubscription(body.subscription);
      if (!sub) return json(res, 422, { error: 'Abonnement invalide' });
      push.subscribe(p, sub);
      if (body.prefs) push.setPrefs(p, body.prefs);
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'push/prefs' && req.method === 'POST') {
      if (!push) return json(res, 503, { error: 'Notifications indisponibles' });
      push.setPrefs(p, body.prefs);
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'upgrade' && req.method === 'POST') {
      // boutique : améliorations permanentes, achetées niveau par niveau
      if (!own(UPGRADES, body.id)) return json(res, 422, { error: 'Amélioration inconnue' });
      const u = UPGRADES[body.id];
      const lvl = upgLevel(p, body.id);
      const next = u.levels[lvl];
      if (!next) return json(res, 409, { error: `${u.label} : déjà au niveau maximum` });
      accrue(p);
      if (!validPrice(next.price)) return json(res, 422, { error: 'Prix invalide' });
      if (p.coins < next.price) return json(res, 402, { error: `Il vous manque ${Math.ceil(next.price - p.coins)} pièces` });
      p.coins -= next.price;
      p.upgrades[body.id] = lvl + 1;
      touch(p);
      changed(p);
      return json(res, 200, { id: body.id, level: lvl + 1, price: next.price, state: state(p) });
    }

    if (route === 'rebirth' && req.method === 'POST') {
      // Renaissance : on repart de zéro (musée, œuvres, pièces) contre un bonus de revenu permanent.
      // Les améliorations de la boutique, les objectifs et les records sont conservés.
      if (p.level < REBIRTH.minLevel) return json(res, 409, { error: `Renaissance possible à partir du niveau ${REBIRTH.minLevel} (rez-de-chaussée complet)` });
      if (p.escrow > 0) return json(res, 409, { error: 'Vous avez une enchère en cours : attendez la fin du lot' });
      if (p.artworks.some((a) => a.carriedBy)) return json(res, 409, { error: 'Une de vos œuvres est en train d’être volée !' });
      accrue(p);
      const cost = rebirthCost(p);
      if (p.coins < cost) return json(res, 402, { error: `Il vous manque ${Math.ceil(cost - p.coins)} pièces pour la Renaissance` });
      p.rebirths++;
      p.coins = START_COINS;
      p.cash = 0;
      p.level = 1;
      p.artworks = []; // les Mythiques retournent dans le pool des ventes aux enchères
      p.security.vitrines = {};
      p.roomThemes = {};
      p.bought = [];
      p.cashFullNotified = false;
      p.lastTick = Date.now();
      touch(p);
      changed(p);
      return json(res, 200, { rebirths: p.rebirths, incomeMult: incomeMult(p), state: state(p) });
    }

    if (route === 'daily' && req.method === 'POST') {
      accrue(p);
      const d = dailyInfo(p);
      if (!d.claimable) return json(res, 409, { error: 'Récompense déjà récupérée aujourd’hui : revenez demain !' });
      p.daily = { day: dayKey(Date.now()), streak: d.streak };
      p.coins += d.reward;
      touch(p);
      return json(res, 200, { reward: d.reward, streak: d.streak, state: state(p) });
    }

    // ------------------------------------------------------------ inventaire : réserve et emplacements

    if (route === 'store' && req.method === 'POST') {
      // ranger une œuvre exposée dans la réserve (elle ne rapporte plus tant qu'elle n'est pas raccrochée)
      const a = p.artworks.find((x) => x.uid === body.uid);
      if (!a) return json(res, 404, { error: 'Œuvre introuvable' });
      if (a.carriedBy) return json(res, 409, { error: 'Cette œuvre est en train d’être volée !' });
      if (a.slot === null) return json(res, 409, { error: 'Cette œuvre est déjà en réserve' });
      accrue(p);
      a.slot = null;
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'place' && req.method === 'POST') {
      // exposer une œuvre de la réserve sur le premier emplacement libre (pour remplacer une œuvre : route « move »)
      const a = p.artworks.find((x) => x.uid === body.uid);
      if (!a) return json(res, 404, { error: 'Œuvre introuvable' });
      if (a.slot !== null) return json(res, 409, { error: 'Cette œuvre est déjà exposée' });
      const slot = freeSlot(p, a.workId);
      if (slot === null) return json(res, 409, { error: 'Aucun emplacement libre : choisissez une œuvre à remplacer, ou agrandissez votre musée' });
      accrue(p);
      a.slot = slot;
      touch(p);
      changed(p);
      return json(res, 200, { slot, state: state(p) });
    }

    // ------------------------------------------------------------ STH coins et Lucky coffres

    if (route === 'sth/exchange' && req.method === 'POST') {
      // échange de pièces du jeu contre des STH coins : taux très élevé ET plafond mensuel (montant et nombre d'échanges)
      const sth = Number(body.sth);
      const info = exchangeInfo(p);
      const fmt = (n) => n.toLocaleString('fr-FR');
      if (info.count >= info.maxCount) return json(res, 409, { error: `Déjà ${info.maxCount} échanges ce mois-ci : le prochain sera possible le 1er du mois. En attendant, les STH coins s’achètent dans l’onglet 💎.`, limit: true });
      if (info.left < info.min) return json(res, 409, { error: `Plafond du mois atteint (${fmt(info.cap)} STH par mois) : nouvel échange le 1er du mois.`, limit: true });
      const max = Math.min(PREMIUM.maxExchange ?? info.cap, info.left);
      if (!Number.isInteger(sth) || sth < info.min || sth > max) return json(res, 422, { error: `Entre ${info.min} et ${fmt(max)} STH pour cet échange (encore ${fmt(info.left)} STH convertibles ce mois-ci)` });
      const cost = sth * PREMIUM.coinsPerSth;
      if (!validPrice(cost)) return json(res, 422, { error: 'Montant invalide' });
      accrue(p);
      if (p.coins < cost) return json(res, 402, { error: `Il vous manque ${fmt(Math.ceil(cost - p.coins))} pièces` });
      p.coins -= cost;
      p.sth += sth;
      p.exchange = { month: info.month, sth: info.used + sth, count: info.count + 1 };
      touch(p);
      return json(res, 200, { sth, cost, state: state(p) });
    }

    if (route === 'gift' && req.method === 'POST') {
      // cadeau saisonnier du jour (sous le grand sapin, dans le chaudron d'Halloween…)
      const r = openGift(p);
      if (r.error) return json(res, 409, { error: r.error });
      return json(res, 200, { reward: r.reward, gift: r.gift, state: state(p) });
    }

    if (route === 'private/buy' && req.method === 'POST') {
      // serveur privé : un quartier rien qu'à soi et à ses amis invités, pendant 30 jours (prolongeable)
      const price = PRIVATE.price;
      if (!validPrice(price)) return json(res, 422, { error: 'Prix invalide' });
      if (p.sth < price) return json(res, 402, { error: `Il vous manque ${Math.ceil(price - p.sth)} STH coins`, missingSth: Math.ceil(price - p.sth) });
      const now = Date.now();
      p.sth -= price;
      p.privateUntil = Math.max(now, p.privateUntil ?? 0) + PRIVATE.days * 86_400_000;
      touch(p);
      return json(res, 200, { until: p.privateUntil, price, state: state(p) });
    }

    if (route === 'chest/buy' && req.method === 'POST') {
      // le coffre va dans l'inventaire : il s'ouvre plus tard, quand le joueur le décide
      if (!own(CHESTS, body.id)) return json(res, 422, { error: 'Coffre inconnu' });
      const qty = Number(body.qty ?? 1);
      if (qty !== 1 && qty !== BULK.qty) return json(res, 422, { error: 'Quantité invalide' });
      const cost = chestCost(body.id, qty);
      if (!validPrice(cost)) return json(res, 422, { error: 'Prix invalide' });
      if (p.sth < cost) return json(res, 402, { error: `Il vous manque ${Math.ceil(cost - p.sth)} STH coins`, missingSth: Math.ceil(cost - p.sth) });
      p.sth -= cost;
      p.chests[body.id] = (p.chests[body.id] ?? 0) + qty;
      touch(p);
      return json(res, 200, { id: body.id, qty, cost, state: state(p) });
    }

    if (route === 'chest/open' && req.method === 'POST') {
      if (!own(CHESTS, body.id)) return json(res, 422, { error: 'Coffre inconnu' });
      if (!((p.chests[body.id] ?? 0) > 0)) return json(res, 409, { error: 'Vous n’avez pas ce coffre : achetez-le dans la boutique' });
      accrue(p);
      const roll = rollChest(p, body.id);
      p.chests[body.id]--;
      const now = Date.now();
      const artwork = { uid: randomBytes(6).toString('base64url'), workId: roll.workId, frame: roll.frame, slot: freeSlot(p, roll.workId), boughtAt: now, chest: body.id };
      p.artworks.push(artwork);
      p.stats.chests++;
      if (roll.rarity !== 'commun') p.stats.rare++;
      if (rank(roll.rarity) >= rank('epique')) p.stats.epic++;
      if (roll.frame !== 'normal') p.stats.framed++;
      touch(p);
      changed(p);
      return json(res, 200, { chest: body.id, artwork, rarity: roll.rarity, frame: roll.frame, pityUsed: roll.pityUsed, state: state(p) });
    }

    if (devMode && route === 'dev/sth' && req.method === 'POST') {
      // tests : STH coins offerts
      p.sth += Math.max(0, Math.floor(Number(body.sth) || 0));
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    if (devMode && route === 'dev/yesterday' && req.method === 'POST') {
      // tests : la dernière récompense quotidienne date d'hier (la série continue)
      p.daily = { day: dayKey(Date.now() - 86_400_000), streak: p.daily.streak || 1 };
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    if (route === 'claim' && req.method === 'POST') {
      const q = currentQuest(p);
      if (!q || q.id !== body.quest) return json(res, 409, { error: 'Objectif déjà récupéré' });
      if (!q.done) return json(res, 409, { error: 'Objectif pas encore atteint' });
      p.coins += q.reward;
      p.questIndex++;
      touch(p);
      return json(res, 200, { reward: q.reward, state: state(p) });
    }

    if (devMode && route === 'dev/age' && req.method === 'POST') {
      // tests : fin du bouclier débutant et de l'immunité (keepOfflineLoss : garder la protection « absent, déjà volé »)
      p.createdAt = Date.now() - BEGINNER_MS - 1000;
      p.immuneUntil = 0;
      if (!body.keepOfflineLoss) p.lastOfflineLoss = 0;
      p.clearLock = true;
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (devMode && route === 'dev/move' && req.method === 'POST') {
      // tests : accroche une œuvre à un emplacement précis (par exemple à l'étage)
      const a = p.artworks.find((x) => x.uid === body.uid);
      const slot = Number(body.slot);
      if (!a || !Number.isInteger(slot) || slot < 0 || slot >= levelInfo(p).slots || p.artworks.some((x) => x.slot === slot)) return json(res, 422, { error: 'Emplacement invalide' });
      a.slot = slot;
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (devMode && route === 'dev/mythic' && req.method === 'POST') {
      // tests : transforme une œuvre possédée en Mythique (ou autre), sans passer par une vente
      const a = p.artworks.find((x) => x.uid === body.uid);
      const w = works.get(body.workId);
      if (!a || !w) return json(res, 422, { error: 'Œuvre invalide' });
      if (w.unique && ownerOf(w.id) && ownerOf(w.id) !== p) return json(res, 409, { error: 'Déjà possédée' });
      a.workId = w.id;
      if (typeof body.frame === 'string' && own(frames, body.frame)) a.frame = body.frame; // tests : cadre au choix
      touch(p);
      changed(p);
      return json(res, 200, { state: state(p) });
    }

    if (devMode && route === 'dev/grant' && req.method === 'POST') {
      p.coins += Math.max(0, Number(body.coins) || 0);
      if (body.cash) p.cash = Math.min(cashCap(p), p.cash + Number(body.cash));
      touch(p);
      return json(res, 200, { state: state(p) });
    }

    return json(res, 404, { error: 'Route inconnue' });
  }

  /**
   * Classements : `value` (musées les plus riches, permanent), `weekly` (valeur gagnée depuis lundi),
   * `theft` (plus gros casse), `auction` (plus grosse enchère remportée), `countries` (valeur cumulée par pays).
   */
  function leaderboard(n, board = 'value', filterCountry, viewer = null) {
    if (board === 'countries') {
      const countryTotals = new Map();
      for (const p of players.values()) {
        const c = p.country || 'FR';
        const v = value(p);
        const cur = countryTotals.get(c) || { country: c, value: 0, level: 0, artworks: 0, players: 0 };
        cur.value += v;
        cur.artworks += p.artworks.length;
        cur.players += 1;
        countryTotals.set(c, cur);
      }
      return [...countryTotals.values()]
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, n)
        .map((r) => {
          const cInfo = catalog.countries?.find((x) => x.code === r.country);
          return {
            name: cInfo?.name ?? r.country,
            value: Math.round(r.value),
            level: r.players,
            artworks: r.artworks,
            country: r.country,
            flag: cInfo?.flag ?? '🏳️',
          };
        });
    }

    const key = weekKey(Date.now());
    const score = {
      value: (p) => value(p),
      weekly: (p) => (p.week.key === key ? Math.max(0, value(p) - p.week.start) : 0),
      theft: (p) => p.records.theft,
      auction: (p) => p.records.auction,
    }[board] ?? ((p) => value(p));
    let list = [...players.values()];
    if (filterCountry) {
      list = list.filter((p) => (p.country || 'FR') === filterCountry);
    }
    return list
      .map((p) => {
        const cInfo = catalog.countries?.find((x) => x.code === (p.country || 'FR'));
        return {
          name: p.name,
          value: Math.round(score(p)),
          level: p.level,
          artworks: p.artworks.length,
          country: p.country || 'FR',
          flag: cInfo?.flag ?? '🏳️',
          ...(viewer && p === viewer ? { me: true } : {}),
        };
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  return {
    /** Bonus de vitesse (baskets de la boutique) : 0,12 = +12 %. */
    speedBonus: (p) => upgValue(p, 'speed', 0),
    /** Durée du verrou des portes (verrou renforcé), en ms. */
    lockMs: (p) => upgValue(p, 'lock', 60) * 1000,
    /** Multiplicateur du temps de décrochage (gants de velours). */
    stealMult: (p) => upgValue(p, 'gloves', 1),
    eventAt,
    setAdminEvent,
    coinPickup,
    /** Saison du monde (thème choisi par l'admin ou selon la date) et son réglage. */
    currentSeason,
    setSeason,
    seasons: SEASONS,
    /** Serveur privé actif (acheté en STH coins). */
    privateActive: (p) => (p?.privateUntil ?? 0) > Date.now(),
    privateMax: PRIVATE.max ?? 7,
    /** Joueur dont le code d'invitation est `code` (ou null). */
    byInvite: (code) => (typeof code === 'string' && code ? [...players.values()].find((x) => x.inviteCode === code) ?? null : null),
    handle, leaderboard, authenticate, snapshot, stealBlocker, markCarried, returnCarried, completeTheft, arrest, caughtTrying,
    guardCount, vitrineMult, publicSecurity, useTool, noteAttempt,
    hold, release, award, ownerOf, notify, workValue, catalog, ticketPrice, payTicket, bounty,
    setPresence: (fn) => (isOnline = fn),
    /** Paiements : crédit des STH coins (idempotent par commande), joueur authentifié d'une requête, offres. */
    creditSth,
    authReq: auth,
    premium: PREMIUM,
    workById: (id) => works.get(id) ?? null,
    roomCount: (p) => levelInfo(p).rooms,
    floorCount: (p) => levelInfo(p).floors ?? 1,
    getPlayer: (id) => players.get(id) ?? null,
    allPlayers: () => players.values(),
    value,
    rarityOf: (workId) => works.get(workId)?.rarity,
    /** Appelé à chaque changement visible d'un musée (achat, agrandissement, vol…). */
    onChange: (fn) => listeners.push(fn),
    /** Panneau admin : joueurs (liste, fiche, création, modification, suppression) et cadeaux. */
    admin: {
      players: adminListPlayers,
      player: adminPlayer,
      create: adminCreatePlayer,
      update: adminUpdatePlayer,
      removeArtwork: adminRemoveArtwork,
      deleteBlocker: adminDeleteBlocker,
      remove: adminDeletePlayer,
      gift: adminGift,
    },
  };
}
