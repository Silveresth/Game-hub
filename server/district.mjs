// Quartiers en temps réel (WebSocket, /ws) — Steal a Masterpiece, phase 2.
//  - jusqu'à 7 joueurs en ligne par quartier, une parcelle chacun ;
//  - les parcelles libres accueillent les « musées en sommeil » de joueurs hors ligne (on peut les voler) ;
//  - positions relayées 10 fois par seconde, vitesse contrôlée par le serveur ;
//  - vols : décrocher (durée selon la rareté), porter jusqu'à son musée, arrestation au contact du propriétaire ;
//  - verrou du musée : 60 s, recharge 3 min.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GUARD, createGuardBrain } from './guards.mjs';

const TICK_MS = 100;
const MAX_ONLINE = 7;
const STEAL_RANGE = 2.6; // distance max à l'œuvre pendant le décrochage
const ARREST_RANGE = 1.6;
const CARRY_MAX_MS = 120_000;
const JAIL_MS = 60_000;
const LOCK_MS = 60_000;
const LOCK_COOLDOWN_MS = 180_000;
const SPEED_MAX = 9.5; // m/s (course 7,5 + marge)
const CARRY_SPEED_MAX = 6.5;
const STEAL_SECONDS = { commun: 2.5, rare: 4, epique: 6, legendaire: 9, mythique: 20 };
const DISGUISE_MS = 60_000;
const TICKET_MS = 10 * 60_000; // un billet vaut 10 min dans le même musée
const BOUNDS = { minX: -84, maxX: 84, minZ: -62, maxZ: 62 };
// Phase 3 : sécurité
const JAM_MS = 15_000;
const POWER_MS = 20_000;
const SABOTAGE_MS = 10_000;
const SMOKE_RANGE = 9;
const TOOL_RANGE = 12;
const CAUGHT_JAIL_MS = 30_000;

export async function attachDistricts(httpServer, game, { layoutFile, devMode = false, auctions = null }) {
  const layout = JSON.parse(await readFile(layoutFile, 'utf8'));
  const CELL = layout.cell;
  const brain = createGuardBrain(CELL, layout.rooms);
  const seedOf = (id) => [...id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % GUARD.CYCLE_MS, 7);

  // ---------------------------------------------------------------- géométrie (identique au client)

  const toWorld = (plot, lx, lz) => ({ x: plot.x + lx, z: plot.z + plot.f * lz });
  const toLocal = (plot, x, z) => ({ lx: x - plot.x, lz: (z - plot.z) * plot.f });
  /** Dans les salles du musée, à l'étage `floor` (les étages supérieurs ont toujours les 9 salles). */
  function inside(plot, rooms, x, z, floor = 0, floors = 1) {
    if (floor >= floors) return false;
    if (floor > 0) rooms = layout.rooms.length;
    const { lx, lz } = toLocal(plot, x, z);
    const i = Math.round(lx / CELL);
    const j = Math.round(lz / CELL);
    if (Math.abs(lx - i * CELL) >= CELL / 2 || Math.abs(lz - j * CELL) >= CELL / 2) return false;
    return layout.rooms.slice(0, rooms).some(([a, b]) => a === i && b === j);
  }
  const slotWorld = (plot, slot) => toWorld(plot, layout.slots[slot][0], layout.slots[slot][1]);
  const spawnOf = (plot) => toWorld(plot, 0, -17);
  const entranceOf = (plot) => toWorld(plot, 0, -CELL / 2);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const ryWorld = (plot, ry) => (plot.f === 1 ? ry : Math.PI - ry);
  const r2 = (n) => Math.round(n * 100) / 100;
  const roomsOf = (pl) => {
    const o = pl.ownerId ? game.getPlayer(pl.ownerId) : null;
    return o ? game.roomCount(o) : 0;
  };
  const floorsOf = (pl) => {
    const o = pl.ownerId ? game.getPlayer(pl.ownerId) : null;
    return o ? game.floorCount(o) : 1;
  };
  /** Le joueur est dans ce musée, à son étage. */
  const isIn = (pl, c) => inside(pl, roomsOf(pl), c.x, c.z, c.f ?? 0, floorsOf(pl));
  const slotFloor = (slot) => layout.slots[slot][3] ?? 0;
  const STAIRS = layout.stairs ?? [4.2, 4.2];
  const powerOut = (pl, now) => pl.powerAt <= now && now < pl.powerUntil;
  const freshPlotState = () => ({ ownerId: null, online: false, lockedUntil: 0, lockReadyAt: 0, guards: [], wanted: new Map(), jamUntil: 0, powerAt: 0, powerUntil: 0 });

  // ---------------------------------------------------------------- état

  /** @type {Map<number, {id:number, plots:any[], conns:Map<string, any>}>} */
  const districts = new Map();
  /** Joueur → quartier où il est présent (en ligne ou endormi). */
  const placement = new Map();
  let nextDistrict = 1;

  function newDistrict() {
    const d = {
      id: nextDistrict++,
      plots: layout.plots.map((pl) => ({ ...pl, ...freshPlotState() })),
      conns: new Map(),
    };
    districts.set(d.id, d);
    return d;
  }

  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const broadcast = (d, msg) => {
    const s = JSON.stringify(msg);
    for (const c of d.conns.values()) if (c.ws.readyState === 1) c.ws.send(s);
  };

  function plotInfo(pl) {
    const owner = pl.ownerId ? game.getPlayer(pl.ownerId) : null;
    return {
      index: pl.index, owner: owner ? game.snapshot(owner) : null, online: pl.online, lockedUntil: pl.lockedUntil, lockReadyAt: pl.lockReadyAt,
      jamUntil: pl.jamUntil, powerAt: pl.powerAt, powerUntil: pl.powerUntil,
    };
  }

  /** Gardes de tout le quartier, en coordonnées monde, pour l'instantané. */
  function guardsInfo(d) {
    const out = [];
    for (const pl of d.plots) {
      for (const g of pl.guards) {
        const w = toWorld(pl, g.x, g.z);
        out.push({ plot: pl.index, k: g.k, x: r2(w.x), z: r2(w.z), f: g.floor ?? 0, ry: r2(ryWorld(pl, g.ry)), s: g.s === 'patrol' && g.yawn ? 'yawn' : g.s });
      }
    }
    return out;
  }

  function playerInfo(c) {
    return {
      id: c.p.id, name: c.p.name, color: c.p.color, plot: c.plot.index,
      x: Math.round(c.x * 100) / 100, z: Math.round(c.z * 100) / 100, f: c.f ?? 0, ry: Math.round(c.ry * 100) / 100, anim: c.anim,
      carry: c.carrying ? { workId: c.carrying.workId, frame: c.carrying.frame } : null,
      disguised: c.disguiseUntil > Date.now(),
      stealing: c.stealing ? { plot: c.stealing.plot.index, uid: c.stealing.uid, endsAt: c.stealing.endsAt } : null,
    };
  }

  // ---------------------------------------------------------------- musées en sommeil

  /** Remplit les parcelles libres avec des musées de joueurs hors ligne, de valeur proche des joueurs présents. */
  function fillSleeping(d) {
    const free = d.plots.filter((pl) => !pl.ownerId);
    if (!free.length) return;
    const online = [...d.conns.values()].map((c) => game.value(c.p));
    const ref = online.length ? online.reduce((a, b) => a + b, 0) / online.length : 0;
    const candidates = [...game.allPlayers()]
      .filter((p) => !placement.has(p.id) && p.artworks.some((a) => a.slot !== null))
      .sort((a, b) => Math.abs(game.value(a) - ref) - Math.abs(game.value(b) - ref));
    for (const pl of free) {
      const p = candidates.shift();
      if (!p) break;
      Object.assign(pl, freshPlotState());
      pl.ownerId = p.id;
      pl.online = false;
      placement.set(p.id, d.id);
      broadcast(d, { t: 'plot', plot: plotInfo(pl) });
    }
  }

  function freePlot(d, pl) {
    if (pl.ownerId) placement.delete(pl.ownerId);
    Object.assign(pl, freshPlotState());
  }

  /** Choisit le quartier et la parcelle d'un joueur qui se connecte. */
  function assign(p) {
    // déjà présent (endormi) quelque part : il se réveille sur sa parcelle si le quartier a de la place
    const at = placement.get(p.id);
    if (at && !districts.has(at)) placement.delete(p.id);
    if (at && districts.has(at)) {
      const d = districts.get(at);
      const pl = d?.plots.find((x) => x.ownerId === p.id);
      if (d && pl && d.conns.size < MAX_ONLINE) return { d, pl };
      if (d && pl) {
        freePlot(d, pl);
        broadcast(d, { t: 'plot', plot: plotInfo(pl) });
      }
    }
    // sinon : le quartier le plus peuplé qui a encore de la place (on regroupe les joueurs)
    const open = [...districts.values()].filter((d) => d.conns.size < MAX_ONLINE).sort((a, b) => b.conns.size - a.conns.size);
    const d = open[0] ?? newDistrict();
    let pl = d.plots.find((x) => !x.ownerId);
    if (!pl) {
      // on réveille… non : on libère le musée endormi le moins précieux
      pl = d.plots.filter((x) => !x.online).sort((a, b) => game.value(game.getPlayer(a.ownerId)) - game.value(game.getPlayer(b.ownerId)))[0];
      freePlot(d, pl);
    }
    return { d, pl };
  }

  // ---------------------------------------------------------------- connexions

  const conns = new Map(); // playerId → connexion
  const jailed = new Map(); // playerId → fin de cellule

  function join(ws, p) {
    const old = conns.get(p.id);
    if (old) {
      send(old.ws, { t: 'kicked', reason: 'Connexion ouverte dans un autre onglet' });
      old.ws.close();
      leave(old);
    }
    const { d, pl } = assign(p);
    pl.ownerId = p.id;
    pl.online = true;
    placement.set(p.id, d.id);
    const s = spawnOf(pl);
    const c = { ws, p, d, plot: pl, x: s.x, z: s.z, f: 0, ry: pl.f === 1 ? Math.PI : 0, anim: 'Idle', lastPosAt: Date.now(), stealing: null, carrying: null, jailUntil: jailed.get(p.id) ?? 0, crowbar: false, msgs: 0 };
    if (c.jailUntil < Date.now()) jailed.delete(p.id);
    conns.set(p.id, c);
    d.conns.set(p.id, c);
    send(ws, {
      t: 'welcome', now: Date.now(), you: { id: p.id, plot: pl.index, jailUntil: c.jailUntil },
      plots: d.plots.map(plotInfo), players: [...d.conns.values()].map(playerInfo), guards: guardsInfo(d), district: d.id,
    });
    broadcast(d, { t: 'plot', plot: plotInfo(pl) });
    broadcast(d, { t: 'join', player: playerInfo(c) });
    fillSleeping(d);
    return c;
  }

  function leave(c) {
    if (conns.get(c.p.id) !== c) return;
    conns.delete(c.p.id);
    const d = c.d;
    d.conns.delete(c.p.id);
    auctions?.leave(c.p.id);
    if (c.stealing) cancelSteal(c, 'disconnect');
    if (c.carrying) giveBack(c, 'Le voleur s’est déconnecté : l’œuvre revient');
    // son musée reste sur place, endormi : on peut le visiter… et le voler
    c.plot.online = false;
    broadcast(d, { t: 'leave', id: c.p.id });
    broadcast(d, { t: 'plot', plot: plotInfo(c.plot) });
    if (d.conns.size === 0) {
      for (const pl of d.plots) if (pl.ownerId) placement.delete(pl.ownerId);
      districts.delete(d.id);
    }
  }

  // ---------------------------------------------------------------- vols

  function ownerConn(pl) {
    return pl.online ? conns.get(pl.ownerId) : null;
  }

  function startSteal(c, msg) {
    const now = Date.now();
    const fail = (error) => send(c.ws, { t: 'steal', phase: 'refused', error });
    if (c.jailUntil > now) return fail(`En cellule encore ${Math.ceil((c.jailUntil - now) / 1000)} s`);
    if (c.carrying || c.stealing) return fail('Vous avez déjà les mains prises');
    const pl = c.d.plots[msg.plot];
    if (!pl?.ownerId || pl.ownerId === c.p.id) return fail('Rien à voler ici');
    const victim = game.getPlayer(pl.ownerId);
    const blocker = game.stealBlocker(c.p, victim, pl.online, now);
    if (blocker) return fail(blocker);
    const a = victim.artworks.find((x) => x.uid === msg.uid && x.slot !== null && !x.carriedBy);
    if (!a) return fail('Cette œuvre n’est plus là');
    if (a.repro) return fail('C’est une reproduction sans valeur : elle ne vaut pas le risque');
    if (!isIn(pl, c) || c.f !== slotFloor(a.slot) || dist(c, slotWorld(pl, a.slot)) > STEAL_RANGE) return fail('Approchez-vous de l’œuvre');
    // vitrine blindée : ×2 ou ×3 ; pied-de-biche : ÷2 (consommé)
    let ms = (STEAL_SECONDS[game.rarityOf(a.workId)] ?? 3) * 1000 * game.vitrineMult(victim, a.slot);
    const crowbar = c.crowbar;
    if (crowbar) {
      ms /= 2;
      c.crowbar = false;
    }
    c.stealing = { plot: pl, victimId: victim.id, uid: a.uid, workId: a.workId, frame: a.frame, slot: a.slot, endsAt: now + ms };
    broadcast(c.d, { t: 'steal', phase: 'start', thief: c.p.id, thiefName: c.p.name, plot: pl.index, uid: a.uid, workId: a.workId, endsAt: c.stealing.endsAt, ms, crowbar: !!crowbar });
    // caméras : le décrochage déclenche l'alarme (sauf brouillage ou coupure de courant).
    // Une Mythique a sa propre alarme : le brouilleur ne la coupe pas.
    const mythic = game.rarityOf(a.workId) === 'mythique';
    if (game.publicSecurity(victim, now).cameras && (pl.jamUntil <= now || mythic) && !powerOut(pl, now)) raiseAlarm(c.d, pl, c, 'camera');
    if (mythic) {
      // tout le serveur est prévenu : les autres joueurs deviennent chasseurs de primes
      broadcastAll({ t: 'mythic', phase: 'start', thief: c.p.id, thiefName: c.p.name, victimName: victim.name, workId: a.workId, district: c.d.id });
    }
  }

  const broadcastAll = (msg) => {
    const s = JSON.stringify(msg);
    for (const x of conns.values()) if (x.ws.readyState === 1) x.ws.send(s);
  };

  /** Alarme : le propriétaire est prévenu (en direct, ou à son retour), les gardes accourent. */
  function raiseAlarm(d, pl, c, reason) {
    const now = Date.now();
    pl.wanted.set(c.p.id, now + GUARD.ALERT_MS);
    brain.alert(pl, c.p.id, now);
    broadcast(d, { t: 'alarm', plot: pl.index, thief: c.p.id, thiefName: c.p.name, reason });
    const owner = game.getPlayer(pl.ownerId);
    if (owner && !pl.online) {
      game.noteAttempt(owner, c.p.name, reason);
      // notification « vol en cours » : le propriétaire absent peut revenir défendre son musée
      const what = reason === 'camera' ? 'décroche une œuvre' : reason === 'laser' ? 'sort avec une œuvre' : 'sabote votre générateur';
      void game.notify(owner, 'theft', { title: '🚨 Vol en cours !', body: `${c.p.name} ${what} dans votre musée. Revenez vite !`, tag: `theft-${pl.index}` });
    }
  }

  function jail(c, ms, now) {
    c.jailUntil = now + ms;
    jailed.set(c.p.id, c.jailUntil); // la cellule survit à une reconnexion
    const s = spawnOf(c.plot);
    c.x = s.x;
    c.z = s.z;
    c.f = 0;
    c.lastPosAt = now;
    send(c.ws, { t: 'teleport', x: s.x, z: s.z, f: 0 });
  }

  /** Porteur d'œuvre arrêté par le propriétaire (byConn) ou par un garde (byConn = null). */
  function arrestCarrier(c, d, byConn, now, bounty = 0) {
    const k = c.carrying;
    c.carrying = null;
    const victim = game.getPlayer(k.victimId);
    const fine = game.arrest(c.p, victim, k.uid, { byGuard: !byConn, victimOnline: k.plot.online });
    jail(c, JAIL_MS, now);
    k.plot.wanted.delete(c.p.id);
    broadcast(d, {
      t: 'steal', phase: 'arrested', thief: c.p.id, thiefName: c.p.name, by: byConn ? byConn.p.id : 'guard', byName: byConn ? byConn.p.name : 'les gardes',
      plot: k.plot.index, uid: k.uid, workId: k.workId, fine, bounty, jailUntil: c.jailUntil,
    });
    if (game.rarityOf(k.workId) === 'mythique') broadcastAll({ t: 'mythic', phase: 'saved', thiefName: c.p.name, byName: byConn ? byConn.p.name : 'les gardes', workId: k.workId, bounty });
  }

  /** Un garde attrape un voleur (en plein décrochage, en fuite, ou repéré par l'alarme). */
  function guardCatch(d, pl, c, now) {
    if (!c) return;
    if (c.carrying?.plot === pl) return arrestCarrier(c, d, null, now);
    if (c.stealing?.plot === pl) cancelSteal(c, 'guard');
    pl.wanted.delete(c.p.id);
    jail(c, CAUGHT_JAIL_MS, now);
    const owner = game.getPlayer(pl.ownerId);
    if (owner) game.caughtTrying(c.p, owner, pl.online);
    broadcast(d, { t: 'steal', phase: 'caught', thief: c.p.id, thiefName: c.p.name, plot: pl.index, jailUntil: c.jailUntil });
  }

  /** Gardes d'un musée : effectif selon le contrat en cours, puis un pas de simulation. */
  function tickGuards(d, pl, now) {
    const owner = pl.ownerId ? game.getPlayer(pl.ownerId) : null;
    const count = owner ? game.guardCount(owner, now) : 0;
    const floors = owner ? game.floorCount(owner) : 1;
    if (pl.guardFloors !== floors) {
      // nouvel étage : les gardes sont réaffectés (un par étage, dans l'ordre)
      pl.guards = [];
      pl.guardFloors = floors;
    }
    while (pl.guards.length < count) pl.guards.push(brain.spawn(pl.guards.length, floors, STAIRS));
    if (pl.guards.length > count) pl.guards.length = count;
    if (!count) return;
    for (const [id, until] of pl.wanted) if (until < now) pl.wanted.delete(id);
    const suspects = [];
    const dog = game.publicSecurity(owner, now).dog;
    for (const c of d.conns.values()) {
      // déguisé en employé : les gardes ne le reconnaissent pas… sauf si un chien de garde le flaire
      if (c.disguiseUntil > now && !dog) continue;
      if (c.stealing?.plot === pl || c.carrying?.plot === pl || pl.wanted.has(c.p.id)) {
        const l = toLocal(pl, c.x, c.z);
        suspects.push({ id: c.p.id, x: l.lx, z: l.lz, floor: c.f ?? 0 });
      }
    }
    const caught = brain.tick({ guards: pl.guards, rooms: game.roomCount(owner), seed: seedOf(owner.id), stairs: STAIRS }, suspects, TICK_MS / 1000, now);
    if (caught) guardCatch(d, pl, conns.get(caught), now);
  }

  // ---------------------------------------------------------------- outils du voleur (marché noir)

  function useTool(c, msg) {
    const now = Date.now();
    const tool = String(msg.tool ?? '');
    const fail = (error) => send(c.ws, { t: 'tool', ok: false, tool, error });
    if (!(c.p.tools?.[tool] > 0)) return fail('Vous n’avez pas cet outil : passez au marché noir');
    if (c.jailUntil > now) return fail(`En cellule encore ${Math.ceil((c.jailUntil - now) / 1000)} s`);
    // musée visé : celui où l'on se trouve, sinon l'entrée rivale la plus proche
    const rivals = c.d.plots.filter((x) => x.ownerId && x.ownerId !== c.p.id);
    const pl = rivals.find((x) => isIn(x, c))
      ?? rivals.map((x) => ({ x, d: dist(c, entranceOf(x)) })).filter((e) => e.d < TOOL_RANGE).sort((a, b) => a.d - b.d)[0]?.x;
    if (!pl) return fail('Approchez-vous d’un musée rival');
    const victim = game.getPlayer(pl.ownerId);
    const blocker = game.stealBlocker(c.p, victim, pl.online, now);
    if (blocker) return fail(blocker);
    const sec = game.publicSecurity(victim, now);
    const local = toLocal(pl, c.x, c.z);
    let message;
    switch (tool) {
      case 'brouilleur':
        if (!sec.cameras) return fail('Ce musée n’a pas de caméras');
        pl.jamUntil = now + JAM_MS;
        message = 'Caméras brouillées pendant 15 s';
        break;
      case 'pince':
        if (!sec.cameras && !sec.lasers) return fail('Rien à couper : ni caméras ni lasers');
        if (pl.powerUntil > now) return fail('Le courant est déjà coupé');
        if (sec.generator) {
          // le générateur de secours se sabote, mais c'est long et bruyant
          pl.powerAt = now + SABOTAGE_MS;
          pl.powerUntil = pl.powerAt + POWER_MS;
          message = 'Générateur de secours : sabotage en cours (10 s)… ça s’entend !';
        } else {
          pl.powerAt = now;
          pl.powerUntil = now + POWER_MS;
          message = 'Courant coupé 20 s : caméras et lasers éteints';
        }
        break;
      case 'fumigene': {
        const near = pl.guards.filter((g) => (g.floor ?? 0) === c.f && Math.hypot(g.x - local.lx, g.z - local.lz) < SMOKE_RANGE);
        if (!near.length) return fail('Aucun garde à portée du fumigène');
        for (const g of near) g.blindUntil = now + GUARD.BLIND_MS;
        message = `${near.length > 1 ? `${near.length} gardes aveuglés` : 'Garde aveuglé'} pendant 6 s`;
        break;
      }
      case 'leurre': {
        const g = pl.guards.filter((x) => (x.floor ?? 0) === c.f).sort((a, b) => Math.hypot(a.x - local.lx, a.z - local.lz) - Math.hypot(b.x - local.lx, b.z - local.lz))[0];
        if (!g) return fail('Aucun garde à cet étage');
        // lancé 5 m devant soi, sans sortir de la salle
        const ry = ryWorld(pl, c.ry); // même formule dans les deux sens
        let lx = local.lx + Math.sin(ry) * 5;
        let lz = local.lz + Math.cos(ry) * 5;
        const i = Math.round(local.lx / CELL);
        const j = Math.round(local.lz / CELL);
        if (isIn(pl, c)) {
          lx = Math.min(i * CELL + 4.8, Math.max(i * CELL - 4.8, lx));
          lz = Math.min(j * CELL + 4.8, Math.max(j * CELL - 4.8, lz));
        }
        g.lure = { x: lx, z: lz };
        g.lureUntil = now + GUARD.LURE_MS;
        g.wps = null;
        const w = toWorld(pl, lx, lz);
        broadcast(c.d, { t: 'fx', kind: 'leurre', plot: pl.index, x: r2(w.x), z: r2(w.z), until: g.lureUntil });
        message = 'Leurre lancé : un garde va le voir';
        break;
      }
      case 'deguisement':
        if (c.disguiseUntil > now) return fail('Vous êtes déjà déguisé');
        c.disguiseUntil = now + DISGUISE_MS;
        message = sec.dog ? 'Déguisé en employé 60 s… mais un chien de garde flaire les déguisements !' : 'Déguisé en employé 60 s : les gardes ne vous reconnaissent pas';
        break;
      case 'pied':
        if (c.crowbar) return fail('Vous tenez déjà un pied-de-biche');
        c.crowbar = true;
        message = 'Pied-de-biche en main : prochain décrochage 2× plus rapide';
        break;
      default:
        return fail('Outil inconnu');
    }
    game.useTool(c.p, tool);
    send(c.ws, { t: 'tool', ok: true, tool, plot: pl.index, message, tools: c.p.tools });
    if (tool === 'fumigene') broadcast(c.d, { t: 'fx', kind: 'fumigene', plot: pl.index, x: r2(c.x), z: r2(c.z), until: now + GUARD.BLIND_MS });
    if (tool === 'pince' && sec.generator) raiseAlarm(c.d, pl, c, 'sabotage');
    broadcast(c.d, { t: 'plot', plot: plotInfo(pl) });
  }

  function cancelSteal(c, reason) {
    const s = c.stealing;
    c.stealing = null;
    broadcast(c.d, { t: 'steal', phase: 'cancel', thief: c.p.id, plot: s.plot.index, uid: s.uid, reason });
  }

  function giveBack(c, message) {
    const k = c.carrying;
    c.carrying = null;
    const victim = game.getPlayer(k.victimId);
    if (victim) game.returnCarried(victim, k.uid);
    broadcast(c.d, { t: 'steal', phase: 'returned', thief: c.p.id, plot: k.plot.index, uid: k.uid, workId: k.workId, message });
  }

  function tickDistrict(d, now) {
    let hunter = null;
    for (const c of d.conns.values()) {
      if (c.stealing) {
        const s = c.stealing;
        const victim = game.getPlayer(s.victimId);
        const still = victim?.artworks.find((x) => x.uid === s.uid && x.slot !== null && !x.carriedBy);
        if (!still || c.f !== slotFloor(s.slot) || dist(c, slotWorld(s.plot, s.slot)) > STEAL_RANGE) cancelSteal(c, 'moved');
        else if (now >= s.endsAt) {
          c.stealing = null;
          if (!game.markCarried(victim, s.uid, c.p.id)) continue;
          c.carrying = { plot: s.plot, victimId: s.victimId, uid: s.uid, workId: s.workId, frame: s.frame, since: now, inside: true };
          broadcast(d, { t: 'steal', phase: 'carry', thief: c.p.id, thiefName: c.p.name, plot: s.plot.index, uid: s.uid, workId: s.workId, frame: s.frame });
        }
      }
      if (c.carrying) {
        const k = c.carrying;
        const victim = game.getPlayer(k.victimId);
        const owner = ownerConn(k.plot);
        // lasers aux portes : sortir du musée avec l'œuvre déclenche l'alarme (sauf coupure de courant)
        const inSource = isIn(k.plot, c);
        if (k.inside && !inSource && victim && game.publicSecurity(victim, now).lasers && !powerOut(k.plot, now)) raiseAlarm(d, k.plot, c, 'laser');
        k.inside = inSource;
        if (isIn(c.plot, c)) {
          // arrivé dans son propre musée : le casse est réussi
          c.carrying = null;
          k.plot.wanted.delete(c.p.id);
          const artwork = game.completeTheft(c.p, victim, k.uid, !!owner);
          broadcast(d, { t: 'steal', phase: 'delivered', thief: c.p.id, thiefName: c.p.name, plot: k.plot.index, victimName: victim.name, uid: k.uid, workId: k.workId, frame: k.frame, artwork, refund: artwork?.refund ?? 0 });
          if (game.rarityOf(k.workId) === 'mythique') broadcastAll({ t: 'mythic', phase: 'stolen', thiefName: c.p.name, victimName: victim.name, workId: k.workId });
        } else if (owner && owner.d === d && owner.f === c.f && dist(owner, c) < ARREST_RANGE) {
          arrestCarrier(c, d, owner, now);
        } else if (game.rarityOf(k.workId) === 'mythique' && (hunter = [...d.conns.values()].find((x) => x !== c && x !== owner && x.f === c.f && !x.carrying && dist(x, c) < ARREST_RANGE))) {
          // chasseur de primes : n'importe quel joueur peut arrêter le voleur d'une Mythique
          const prize = game.bounty(hunter.p, k.workId);
          arrestCarrier(c, d, hunter, now, prize);
        } else if (now - k.since > CARRY_MAX_MS) {
          giveBack(c, 'Trop long : l’œuvre a été rendue');
        }
      }
    }
    for (const pl of d.plots) tickGuards(d, pl, now);
    if (d.conns.size) broadcast(d, { t: 'snap', now, players: [...d.conns.values()].map(playerInfo), guards: guardsInfo(d) });
  }

  setInterval(() => {
    const now = Date.now();
    for (const d of districts.values()) tickDistrict(d, now);
  }, TICK_MS).unref();

  // Achat, agrandissement, vol… : le quartier où se trouve ce musée est prévenu
  game.onChange((p) => {
    const d = districts.get(placement.get(p.id));
    const pl = d?.plots.find((x) => x.ownerId === p.id);
    if (pl) {
      if (p.clearLock) {
        delete p.clearLock;
        pl.lockedUntil = 0;
        pl.lockReadyAt = 0;
      }
      broadcast(d, { t: 'plot', plot: plotInfo(pl) });
    }
  });

  // ---------------------------------------------------------------- messages

  function onMessage(c, msg) {
    const now = Date.now();
    if (msg.t === 'pos') {
      const { x, z, ry } = msg;
      if (![x, z, ry].every(Number.isFinite)) return;
      if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return;
      const dt = Math.max(0.05, (now - c.lastPosAt) / 1000);
      const max = (c.carrying ? CARRY_SPEED_MAX : SPEED_MAX) * dt + 1.2;
      if (!devMode && Math.hypot(x - c.x, z - c.z) > max) {
        // déplacement impossible : on remet le joueur à sa dernière position connue
        send(c.ws, { t: 'teleport', x: c.x, z: c.z, f: c.f });
        c.lastPosAt = now;
        return;
      }
      // étage : on ne change que d'un niveau à la fois, par l'escalier d'un musée assez haut
      const f = Number.isInteger(msg.f) ? msg.f : c.f;
      if (f !== c.f) {
        const pl = c.d.plots.find((x) => x.ownerId && isIn(x, c));
        const l = pl ? toLocal(pl, x, z) : null;
        const ok = pl && Math.abs(f - c.f) === 1 && f >= 0 && f < floorsOf(pl) && Math.hypot(l.lx - STAIRS[0], l.lz - STAIRS[1]) < 2.4;
        if (!ok) {
          send(c.ws, { t: 'teleport', x: c.x, z: c.z, f: c.f });
          c.lastPosAt = now;
          return;
        }
        c.f = f;
      }
      const prev = { x: c.x, z: c.z };
      Object.assign(c, { x, z, ry, lastPosAt: now, anim: typeof msg.anim === 'string' ? msg.anim.slice(0, 16) : 'Idle' });
      // verrou laser du musée : bloque les intrus non propriétaires
      const lockedPlot = c.d.plots.find((pl) => pl.ownerId && pl.ownerId !== c.p.id && pl.lockedUntil > now && isIn(pl, c));
      if (lockedPlot) {
        Object.assign(c, prev);
        send(c.ws, { t: 'teleport', x: c.x, z: c.z, f: c.f });
        return;
      }
      // billet d'entrée : on entre dans un musée rival comme un visiteur, en payant (le propriétaire encaisse)
      const visiting = c.d.plots.find((pl) => pl.ownerId && pl.ownerId !== c.p.id && isIn(pl, c));
      if (visiting && visiting.index !== c.inPlot) {
        const owner = game.getPlayer(visiting.ownerId);
        c.tickets ??= new Map();
        if (!(c.tickets.get(owner.id) > now)) {
          const price = game.payTicket(c.p, owner);
          if (price === null) {
            Object.assign(c, prev);
            send(c.ws, { t: 'teleport', x: c.x, z: c.z, f: c.f });
            send(c.ws, { t: 'ticket', ok: false, price: game.ticketPrice(owner), name: owner.name });
            return;
          }
          c.tickets.set(owner.id, now + TICKET_MS);
          send(c.ws, { t: 'ticket', ok: true, price, name: owner.name });
          const oc = ownerConn(visiting);
          if (oc) send(oc.ws, { t: 'visitor', name: c.p.name, price });
        }
      }
      c.inPlot = visiting ? visiting.index : -1;
      // hors des salles d'un musée, on est forcément au rez-de-chaussée
      if (c.f > 0 && !c.d.plots.some((x) => x.ownerId && isIn(x, c))) {
        c.f = 0;
        send(c.ws, { t: 'teleport', x: c.x, z: c.z, f: 0 });
      }
    } else if (msg.t === 'steal') startSteal(c, msg);
    else if (msg.t === 'tool') useTool(c, msg);
    else if (auctions && (msg.t === 'hall-enter' || msg.t === 'hall-leave' || msg.t === 'bid')) auctions.onMessage(c.p.id, msg);
    else if (msg.t === 'steal-cancel') {
      if (c.stealing) cancelSteal(c, 'released');
    } else if (msg.t === 'lock') {
      const pl = c.plot;
      if (now < pl.lockReadyAt) return send(c.ws, { t: 'lock', plot: pl.index, lockedUntil: pl.lockedUntil, lockReadyAt: pl.lockReadyAt, error: 'Verrou en recharge' });
      pl.lockedUntil = now + LOCK_MS;
      pl.lockReadyAt = now + LOCK_MS + LOCK_COOLDOWN_MS;
      broadcast(c.d, { t: 'lock', plot: pl.index, lockedUntil: pl.lockedUntil, lockReadyAt: pl.lockReadyAt });
    } else if (msg.t === 'refresh') {
      // le client vient d'acheter / vendre : son musée est renvoyé au quartier
      broadcast(c.d, { t: 'plot', plot: plotInfo(c.plot) });
    }
  }

  // ---------------------------------------------------------------- liens avec l'économie et l'hôtel des ventes

  game.setPresence((id) => conns.has(id));
  auctions?.setTransport({
    send: (id, msg) => {
      const c = conns.get(id);
      if (c) send(c.ws, msg);
    },
    broadcast: (msg) => {
      const s = JSON.stringify(msg);
      for (const c of conns.values()) if (c.ws.readyState === 1) c.ws.send(s);
    },
    isOnline: (id) => conns.has(id),
  });

  // ---------------------------------------------------------------- serveur WebSocket

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let c = null;
    const timer = setTimeout(() => !c && ws.close(), 5000); // authentification obligatoire sous 5 s
    let window = Date.now();
    let count = 0;
    ws.on('message', (raw) => {
      // limite : 40 messages par seconde
      const now = Date.now();
      if (now - window > 1000) {
        window = now;
        count = 0;
      }
      if (++count > 40) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!c) {
        if (msg.t !== 'auth') return;
        const p = game.authenticate(msg.id, msg.token);
        if (!p) {
          send(ws, { t: 'error', error: 'Session invalide' });
          return ws.close();
        }
        clearTimeout(timer);
        c = join(ws, p);
        return;
      }
      onMessage(c, msg);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (c) leave(c);
    });
    ws.on('error', () => undefined);
  });

  return {
    stats: () => ({ districts: districts.size, online: conns.size }),
    id: randomBytes(4).toString('hex'),
  };
}
