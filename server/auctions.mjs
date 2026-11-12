// Hôtel des ventes (phase 4) : un seul pour tout le serveur, partagé par tous les quartiers.
//  - planning (heure de Paris) : vente express toutes les 30 min (3 lots, Rare à Épique), grande vente à 13 h et 19 h
//    (6 lots, Épique à Légendaire), vente prestige le dimanche à 20 h (3 lots, Légendaire à Mythique),
//    et les ventes « admin abuse » créées depuis le panneau admin ;
//  - déroulé d'un lot : présentation 5 s, enchères 20 s, une enchère dans les 10 dernières secondes remet le chrono à 10 s ;
//  - mise à prix 50 % de l'estimation, pas de 5 % ; l'argent du meilleur enchérisseur est bloqué, rendu s'il est surenchéri ;
//  - des enchérisseurs PNJ montent jusqu'à 60–95 % de l'estimation ;
//  - l'œuvre adjugée arrive directement dans le musée du gagnant (ou dans sa réserve).
import { createHash, randomBytes } from 'node:crypto';

const HALF_HOUR = 30 * 60_000;
export const TIMING = { PRESENT_MS: 5000, BID_MS: 20_000, SNIPE_MS: 10_000, SOLD_MS: 4500, SOON_MS: 15 * 60_000, STALE_MS: 10 * 60_000 };
const SEATS = 48; // 6 rangs de 8
const NPC_SEATS = [2, 5, 9, 14, 19, 22, 28, 35];
const NPC_NAMES = ['Comtesse de Vaneau', 'M. Okafor', 'Fondation Lumière', 'Mme Takahashi', 'Galerie Brandt', 'Lord Pemberton', 'Sra. Alvarez', 'Collection Nakamura'];
const NPC_COLORS = ['#8c7b6b', '#5b6b8c', '#7a5b8c', '#6b8c7b', '#8c6b5b', '#6b6b6b', '#8c5b6b', '#5b8c8c'];

export const KINDS = {
  express: { label: 'Vente express', lots: 3, pool: [['rare', 75], ['epique', 25]] },
  grande: { label: 'Grande vente', lots: 6, pool: [['epique', 75], ['legendaire', 25]] },
  prestige: { label: 'Vente prestige', lots: 3, pool: [['legendaire', 80], ['mythique', 20]] },
  abuse: { label: 'Admin abuse', lots: 0, pool: [] },
};

const parisFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parisClock(ms) {
  const p = Object.fromEntries(parisFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute) };
}

/** Type de la vente régulière à l'instant t (une demi-heure pile). */
export function regularKind(ms) {
  const { weekday, hour, minute } = parisClock(ms);
  if (minute === 0 && weekday === 'Sun' && hour === 20) return 'prestige';
  if (minute === 0 && (hour === 13 || hour === 19)) return 'grande';
  return 'express';
}

function seeded(text) {
  let a = parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createAuctions({ game, db, devMode = false }) {
  const catalog = game.catalog;
  let saved = { admin: [], done: [], results: [] };
  try {
    saved = { ...saved, ...((await db.kvGet('sales')) ?? {}) };
  } catch (e) {
    console.error('Lecture des ventes impossible :', e.message);
  }
  /** Ventes admin abuse : { id, kind:'abuse', label, at, lots:[{workId, frame}], announced, createdAt } */
  const admin = saved.admin;
  const done = new Set(saved.done);
  const results = saved.results; // derniers lots adjugés
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const data = { admin, done: [...done].slice(-200), results: results.slice(-50) };
      try {
        await db.kvSet('sales', data);
      } catch (e) {
        console.error('Enregistrement des ventes impossible :', e.message);
      }
    }, 300);
  };

  // transport fourni par le gestionnaire de quartiers
  let io = { send: () => undefined, broadcast: () => undefined, isOnline: () => false };

  // ---------------------------------------------------------------- planning

  const estimateOf = (lot) => Math.round(game.workById(lot.workId).price * (catalog.frames[lot.frame]?.mult ?? 1));

  /** Lots d'une vente régulière : tirés au hasard (graine = identifiant de la vente), sans Mythique déjà possédée. */
  function regularLots(id, kind) {
    const rnd = seeded(id);
    const k = KINDS[kind];
    const lots = [];
    for (let i = 0; i < k.lots; i++) {
      const total = k.pool.reduce((s, [, w]) => s + w, 0);
      let roll = rnd() * total;
      let rarity = k.pool[0][0];
      for (const [r, w] of k.pool) if ((roll -= w) < 0) {
        rarity = r;
        break;
      }
      let pool = catalog.works.filter((w) => w.rarity === rarity && !(w.unique && (game.ownerOf(w.id) || lots.some((l) => l.workId === w.id))));
      if (!pool.length) pool = catalog.works.filter((w) => w.rarity === k.pool[0][0] && !w.unique);
      const work = pool[Math.floor(rnd() * pool.length)];
      const f = rnd();
      const frame = work.unique ? 'normal' : f < 0.03 ? 'diamant' : f < 0.18 ? 'dore' : 'normal';
      lots.push({ workId: work.id, frame });
    }
    return lots;
  }

  function regularSale(at) {
    const kind = regularKind(at);
    return { id: `${kind}-${at}`, kind, label: KINDS[kind].label, at };
  }

  /** Prochaines ventes (régulières + admin), triées. La vente en cours est incluse. */
  function schedule(now, n = 4) {
    const out = [];
    for (let t = Math.floor(now / HALF_HOUR) * HALF_HOUR + HALF_HOUR; out.length < n + 2; t += HALF_HOUR) out.push(regularSale(t));
    for (const s of admin) if (s.at > now - HALF_HOUR && !done.has(s.id)) out.push(s);
    if (cur) out.push(cur.sale);
    const uniq = [...new Map(out.map((s) => [s.id, s])).values()].filter((s) => !done.has(s.id) || s === cur?.sale);
    return uniq.sort((a, b) => a.at - b.at).slice(0, n).map(publicSale);
  }

  function nextMajor(now) {
    const ad = admin.filter((s) => s.at > now && !done.has(s.id)).sort((a, b) => a.at - b.at)[0];
    for (let t = Math.floor(now / HALF_HOUR) * HALF_HOUR + HALF_HOUR, k = 0; k < 7 * 48; k++, t += HALF_HOUR) {
      const s = regularSale(t);
      if (s.kind !== 'express') return publicSale(ad && ad.at < s.at ? ad : s);
    }
    return ad ? publicSale(ad) : null;
  }

  const publicSale = (s) => ({ id: s.id, kind: s.kind, label: s.label, at: s.at, live: cur?.sale.id === s.id });

  // ---------------------------------------------------------------- salle : places

  /** Joueurs présents dans la salle → place. */
  const hall = new Map();
  function freeSeat() {
    const used = new Set([...hall.values()].map((h) => h.seat));
    for (let i = 0; i < SEATS; i++) if (!NPC_SEATS.includes(i) && !used.has(i)) return i;
    return null;
  }

  function seatsInfo() {
    const list = NPC_SEATS.map((seat, i) => ({ seat, id: `npc:${i}`, name: NPC_NAMES[i], color: NPC_COLORS[i], npc: true }));
    for (const [id, h] of hall) {
      const p = game.getPlayer(id);
      if (p) list.push({ seat: h.seat, id, name: p.name, color: p.color, npc: false });
    }
    return list;
  }

  // ---------------------------------------------------------------- vente en cours

  /** @type {null | {sale:any, lots:any[], index:number, phase:'present'|'bidding'|'sold', phaseEnd:number, price:number, leader:any, npcs:any[], npcAt:number, lastBid:any, outcome:any}} */
  let cur = null;

  const stepOf = (est) => Math.max(1, Math.round(est * 0.05));
  const nextMin = () => (cur.leader ? cur.price + stepOf(cur.est) : cur.price);

  function lotInfo() {
    if (!cur) return null;
    const lot = cur.lots[cur.index];
    return {
      index: cur.index, count: cur.lots.length, workId: lot.workId, frame: lot.frame, estimate: cur.est,
      phase: cur.phase, phaseEnd: cur.phaseEnd, price: cur.price, step: stepOf(cur.est), min: nextMin(),
      leader: cur.leader ? { id: cur.leader.id, name: cur.leader.name, npc: !!cur.leader.npc, seat: cur.leader.seat } : null,
      lastBid: cur.lastBid, outcome: cur.outcome,
    };
  }

  function hallState(id) {
    const now = Date.now();
    const next = cur ? null : schedule(now, 1)[0] ?? null;
    return {
      t: 'hall', now, you: { seat: hall.get(id)?.seat ?? null },
      seats: seatsInfo(), sale: cur ? { ...publicSale(cur.sale), lots: cur.lots.map((l) => ({ ...l, estimate: estimateOf(l) })) } : null,
      next, lot: lotInfo(),
    };
  }

  const pushHall = () => {
    for (const id of hall.keys()) io.send(id, hallState(id));
  };

  function startLot(now) {
    const lot = cur.lots[cur.index];
    cur.est = estimateOf(lot);
    cur.phase = 'present';
    cur.phaseEnd = now + TIMING.PRESENT_MS;
    cur.price = Math.max(1, Math.round(cur.est * 0.5));
    cur.leader = null;
    cur.lastBid = null;
    cur.outcome = null;
    // 3 à 5 collectionneurs PNJ, chacun avec son plafond (60 à 95 % de l'estimation)
    const rnd = seeded(`${cur.sale.id}:${cur.index}`);
    const n = 3 + Math.floor(rnd() * 3);
    const picks = [...NPC_SEATS.keys()].sort(() => rnd() - 0.5).slice(0, n);
    cur.npcs = picks.map((i) => ({ id: `npc:${i}`, name: NPC_NAMES[i], seat: NPC_SEATS[i], npc: true, max: Math.round(cur.est * (0.6 + rnd() * 0.35)) }));
    cur.npcAt = now + TIMING.PRESENT_MS + 1500 + Math.random() * 2000;
  }

  function begin(sale, now) {
    const lots = sale.kind === 'abuse' ? sale.lots.filter((l) => !(game.workById(l.workId)?.unique && game.ownerOf(l.workId))) : regularLots(sale.id, sale.kind);
    if (!lots.length) {
      done.add(sale.id);
      save();
      return;
    }
    // marquée « faite » dès son lancement : si le serveur redémarre en pleine vente, elle n'est pas rejouée
    // (les lots déjà adjugés ne repasseraient pas une deuxième fois)
    done.add(sale.id);
    save();
    cur = { sale, lots, index: 0 };
    startLot(now);
    io.broadcast({ t: 'sale', phase: 'start', id: sale.id, label: sale.label, kind: sale.kind, lots: lots.length, workId: lots[0].workId });
    pushHall();
  }

  function placeBid(bidder, amount, now) {
    const prev = cur.leader;
    if (prev && !prev.npc) {
      const pp = game.getPlayer(prev.id);
      if (pp) game.release(pp, cur.price); // le précédent meilleur enchérisseur récupère son argent
    }
    cur.price = amount;
    cur.leader = bidder;
    cur.lastBid = { seat: bidder.seat, at: now, name: bidder.name, amount };
    // anti-sniping : une enchère dans les 10 dernières secondes relance le chrono à 10 s
    if (cur.phaseEnd - now < TIMING.SNIPE_MS) cur.phaseEnd = now + TIMING.SNIPE_MS;
    pushHall();
  }

  function npcTick(now) {
    if (now < cur.npcAt) return;
    const min = nextMin();
    const able = cur.npcs.filter((n) => n.id !== cur.leader?.id && n.max >= min);
    cur.npcAt = now + 1200 + Math.random() * 3300;
    if (!able.length) return;
    const n = able[Math.floor(Math.random() * able.length)];
    // parfois un PNJ saute d'un cran pour impressionner la salle
    const jump = Math.random() < 0.25 ? stepOf(cur.est) : 0;
    placeBid(n, Math.min(n.max, min + jump), now);
  }

  function hammer(now) {
    const lot = cur.lots[cur.index];
    const w = game.workById(lot.workId);
    let outcome;
    if (!cur.leader) outcome = { sold: false };
    else if (cur.leader.npc) {
      // Le PNJ a gagné : l'œuvre n'est livrée nulle part, on la recycle (sinon les Mythiques disparaissent).
      // Le résultat reste « vendu au PNJ » pour le spectacle, mais l'œuvre retourne dans le pool.
      outcome = { sold: true, npc: true, name: cur.leader.name, price: cur.price, recycled: true };
    }
    else {
      const p = game.getPlayer(cur.leader.id);
      if (w.unique && game.ownerOf(lot.workId)) {
        // Mythique entre-temps volée ailleurs : vente annulée, argent rendu
        game.release(p, cur.price);
        outcome = { sold: false };
      } else {
        const artwork = game.award(p, lot.workId, lot.frame, cur.price);
        outcome = { sold: true, npc: false, id: p.id, name: p.name, price: cur.price, artwork };
        io.send(p.id, { t: 'won', workId: lot.workId, frame: lot.frame, price: cur.price, artwork });
        if (!io.isOnline(p.id)) void game.notify(p, 'sales', { title: '🔨 Adjugé !', body: `« ${w.title} » est à vous pour ${cur.price.toLocaleString('fr-FR')} pièces.` });
      }
    }
    cur.outcome = outcome;
    cur.phase = 'sold';
    cur.phaseEnd = now + TIMING.SOLD_MS;
    if (outcome.sold) {
      results.push({ at: now, sale: cur.sale.label, workId: lot.workId, frame: lot.frame, price: outcome.price, winner: outcome.name, npc: outcome.npc });
      if (results.length > 50) results.splice(0, results.length - 50); // la mémoire ne grossit plus sans fin
      save();
    }
    io.broadcast({ t: 'sale', phase: 'sold', label: cur.sale.label, workId: lot.workId, frame: lot.frame, sold: outcome.sold, price: outcome.price ?? 0, winner: outcome.name ?? null, npc: !!outcome.npc, winnerId: outcome.id ?? null });
    pushHall();
  }

  // ---------------------------------------------------------------- annonces et notifications

  const announcedSoon = new Set();
  function announce(sale) {
    io.broadcast({ t: 'sale', phase: 'soon', id: sale.id, label: sale.label, kind: sale.kind, at: sale.at });
    // push : grandes ventes, ventes prestige et admin abuse (pas les ventes express, trop fréquentes)
    if (sale.kind === 'express') return;
    const cat = sale.kind === 'abuse' ? 'abuse' : 'sales';
    const when = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(sale.at);
    for (const p of game.allPlayers()) {
      if (!p.push?.subs?.length || io.isOnline(p.id)) continue;
      void game.notify(p, cat, { title: sale.kind === 'abuse' ? `🚨 ${sale.label}` : `🔨 ${sale.label} à ${when}`, body: sale.kind === 'abuse' ? `Vente spéciale à ${when} : Mythiques et cadres diamant !` : 'Les enchères ouvrent bientôt. Entrez dans l’hôtel des ventes pour enchérir.', tag: sale.id });
    }
  }

  // ---------------------------------------------------------------- boucle

  function tick() {
    const now = Date.now();
    // annonce 15 min avant
    for (const s of schedule(now, 3)) {
      if (!s.live && s.at - now <= TIMING.SOON_MS && s.at > now && !announcedSoon.has(s.id)) {
        announcedSoon.add(s.id);
        const full = admin.find((a) => a.id === s.id) ?? s;
        announce(full);
      }
    }
    if (!cur) {
      // vente à lancer (la plus ancienne qui est due) ; on ne rejoue pas une vente ratée il y a plus de 10 min
      const due = [...admin.filter((s) => !done.has(s.id) && s.at <= now), regularSale(Math.floor(now / HALF_HOUR) * HALF_HOUR)]
        .filter((s) => !done.has(s.id) && s.at <= now && now - s.at < TIMING.STALE_MS)
        .sort((a, b) => a.at - b.at)[0];
      if (due) begin(due, now);
      return;
    }
    if (cur.phase === 'present' && now >= cur.phaseEnd) {
      cur.phase = 'bidding';
      cur.phaseEnd = now + TIMING.BID_MS;
      pushHall();
    } else if (cur.phase === 'bidding') {
      npcTick(now);
      if (now >= cur.phaseEnd) hammer(now);
    } else if (cur.phase === 'sold' && now >= cur.phaseEnd) {
      if (cur.index + 1 < cur.lots.length) {
        cur.index++;
        startLot(now);
        pushHall();
      } else {
        done.add(cur.sale.id);
        save();
        io.broadcast({ t: 'sale', phase: 'end', id: cur.sale.id, label: cur.sale.label });
        cur = null;
        pushHall();
      }
    }
  }
  setInterval(tick, 250).unref();

  // ---------------------------------------------------------------- messages des joueurs

  function onMessage(id, msg) {
    const now = Date.now();
    if (msg.t === 'hall-enter') {
      if (!hall.has(id)) {
        const seat = freeSeat();
        if (seat === null) return io.send(id, { t: 'hall-error', error: 'Salle comble, réessayez dans un instant' });
        hall.set(id, { seat });
      }
      pushHall();
    } else if (msg.t === 'hall-leave') {
      leave(id);
    } else if (msg.t === 'bid') {
      const fail = (error) => io.send(id, { t: 'hall-error', error });
      if (!hall.has(id)) return fail('Entrez dans la salle des ventes pour enchérir');
      if (!cur || cur.phase !== 'bidding') return fail('Les enchères ne sont pas ouvertes');
      if (cur.leader?.id === id) return fail('Vous êtes déjà le meilleur enchérisseur');
      const amount = Math.floor(Number(msg.amount));
      if (!Number.isFinite(amount) || amount > 1e15) return fail('Montant invalide');
      if (amount < nextMin()) return fail(`Enchère minimale : ${nextMin().toLocaleString('fr-FR')}`);
      const p = game.getPlayer(id);
      if (!p || !game.hold(p, amount)) return fail('Pas assez de pièces pour cette enchère');
      placeBid({ id, name: p.name, seat: hall.get(id).seat, npc: false }, amount, now);
    }
  }

  function leave(id) {
    if (!hall.delete(id)) return;
    pushHall();
  }

  // ---------------------------------------------------------------- admin

  function adminList() {
    const now = Date.now();
    return {
      now, live: cur ? { sale: publicSale(cur.sale), lot: lotInfo(), hall: hall.size } : null,
      upcoming: schedule(now, 10).map((s) => ({ ...s, lots: admin.find((a) => a.id === s.id)?.lots ?? null, announced: admin.find((a) => a.id === s.id)?.announced ?? null, admin: s.kind === 'abuse' })),
      results: results.slice(-15).reverse(),
      works: catalog.works.map((w) => ({ id: w.id, title: w.title, rarity: w.rarity, price: w.price, unique: !!w.unique, owner: w.unique ? game.ownerOf(w.id)?.name ?? null : null })),
    };
  }

  function createSale({ title, at, lots, announce: now_ }) {
    const now = Date.now();
    const label = typeof title === 'string' && title.trim() ? title.trim().slice(0, 40) : 'Admin abuse';
    if (!Number.isFinite(at)) throw new Error('Date invalide');
    // le cahier des charges : annoncée au moins 1 h avant (les tests peuvent la lancer tout de suite)
    if (!devMode && at < now + 3600_000) throw new Error('Une vente admin doit être programmée au moins 1 h à l’avance');
    if (at > now + 30 * 86400_000) throw new Error('Pas plus de 30 jours à l’avance');
    if (!Array.isArray(lots) || !lots.length || lots.length > 8) throw new Error('De 1 à 8 lots');
    const clean = lots.map((l) => {
      const w = game.workById(l?.workId);
      if (!w) throw new Error('Œuvre inconnue');
      if (w.unique && game.ownerOf(w.id)) throw new Error(`« ${w.title} » appartient déjà à ${game.ownerOf(w.id).name}`);
      const frame = catalog.frames[l.frame] ? l.frame : 'normal';
      return { workId: w.id, frame: w.unique ? 'normal' : frame };
    });
    if (new Set(clean.filter((l) => game.workById(l.workId).unique).map((l) => l.workId)).size !== clean.filter((l) => game.workById(l.workId).unique).length) throw new Error('Une œuvre unique ne peut figurer qu’une fois');
    const sale = { id: `abuse-${randomBytes(4).toString('hex')}`, kind: 'abuse', label, at: Math.round(at), lots: clean, announced: false, createdAt: now };
    admin.push(sale);
    save();
    if (now_) announceSale(sale.id);
    return sale;
  }

  function announceSale(id) {
    const s = admin.find((a) => a.id === id);
    if (!s) throw new Error('Vente introuvable');
    s.announced = true;
    save();
    announcedSoon.add(s.id);
    announce(s);
    return s;
  }

  function cancelSale(id) {
    const i = admin.findIndex((a) => a.id === id);
    if (i < 0) throw new Error('Vente introuvable');
    if (cur?.sale.id === id) throw new Error('Vente en cours : impossible de l’annuler');
    admin.splice(i, 1);
    save();
  }

  /** Tests : lance une vente admin immédiatement. */
  function startNow(id) {
    if (!devMode) throw new Error('Réservé au mode test');
    const s = admin.find((a) => a.id === id);
    if (!s) throw new Error('Vente introuvable');
    if (cur) {
      // mode test : la vente en cours (souvent une vente express) est interrompue, l'argent bloqué rendu
      if (cur.leader && !cur.leader.npc) game.release(game.getPlayer(cur.leader.id), cur.price);
      done.add(cur.sale.id);
      cur = null;
    }
    s.at = Date.now();
    begin(s, Date.now());
    return s;
  }

  return {
    schedule, nextMajor, onMessage, leave, adminList, createSale, announceSale, cancelSale, startNow,
    setTransport: (t) => (io = { ...io, ...t }),
    live: () => (cur ? { label: cur.sale.label, kind: cur.sale.kind, workId: cur.lots[cur.index].workId, index: cur.index, count: cur.lots.length } : null),
    inHall: (id) => hall.has(id),
  };
}
