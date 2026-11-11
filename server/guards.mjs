// Gardes des musées (phase 3) : simulés par le serveur, en coordonnées LOCALES de la parcelle
// (x vers la droite, z vers le fond du musée ; l'entrée est au milieu du mur z = -CELL/2 de la salle 0,0).
//
// Comportement, volontairement lisible pour que les failles soient exploitables :
//  - ronde : de salle en salle, pause au centre en tournant sur soi (cône de vision de ±55°, 10 m, même salle) ;
//  - poursuite : un voleur vu en train de décrocher ou de porter une œuvre est pris en chasse (6 m/s) ;
//  - alerte : caméra, laser ou sabotage → les gardes accourent vers le voleur ;
//  - relève : toutes les 10 min, 8 s sans patrouille (le garde bâille 6 s avant) ;
//  - fumigène (aveugle 6 s), leurre (le garde va le voir 6 s) ;
//  - laisse : un garde ne s'éloigne pas à plus de 22 m de l'entrée.

export const GUARD = {
  PATROL: 2.0,
  ALERT: 5.0,
  CHASE: 6.0,
  LURE: 3.5,
  VISION: 10,
  HALF_ANGLE: 0.96, // ≈ 55°
  CLOSE: 3.5, // à cette distance, un garde en poursuite vous sent même sans vous voir
  CATCH: 1.4,
  LOOK_MS: 3600,
  MEMORY_MS: 3000,
  ALERT_MS: 8000,
  LEASH: 22,
  CYCLE_MS: 600_000,
  BREAK_MS: 8_000,
  YAWN_MS: 6_000,
  BLIND_MS: 6_000,
  LURE_MS: 6_000,
};

const OFFSETS = [[0, 0], [1.6, 1.6], [-1.6, 1.6]];

export function createGuardBrain(CELL, allRooms) {
  const half = CELL / 2;

  // `n` = nombre de salles de l'étage ; négatif pour un étage supérieur (pas de sortie vers la place).
  function cellKey(n, x, z) {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    if (Math.abs(x - i * CELL) >= half || Math.abs(z - j * CELL) >= half) return 'out';
    return allRooms.slice(0, Math.abs(n)).some(([a, b]) => a === i && b === j) ? `${i},${j}` : 'out';
  }
  const parse = (k) => k.split(',').map(Number);

  function neighbors(n, k) {
    if (k === 'out') return n > 0 ? ['0,0'] : [];
    const [i, j] = parse(k);
    const out = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${i + di},${j + dj}`;
      if (allRooms.slice(0, Math.abs(n)).some(([a, b]) => `${a},${b}` === key)) out.push(key);
    }
    if (k === '0,0' && n > 0) out.push('out');
    return out;
  }

  /** Milieu de la porte entre deux cellules voisines et direction de a vers b. */
  function door(a, b) {
    if (a === 'out' || b === 'out') return { x: 0, z: -half, nx: 0, nz: a === 'out' ? 1 : -1 };
    const [ia, ja] = parse(a);
    const [ib, jb] = parse(b);
    return { x: ((ia + ib) / 2) * CELL, z: ((ja + jb) / 2) * CELL, nx: ib - ia, nz: jb - ja };
  }

  function bfs(n, from, to) {
    // quand les deux sont dehors, forcer le passage par l'entrée (0,0) au lieu de couper en ligne droite
    if (from === to && from === 'out' && n > 0) return ['out', '0,0', 'out'];
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const k = queue.shift();
      for (const nb of neighbors(n, k)) {
        if (prev.has(nb)) continue;
        prev.set(nb, k);
        if (nb === to) {
          const path = [to];
          let c = k;
          while (c) {
            path.unshift(c);
            c = prev.get(c);
          }
          return path;
        }
        queue.push(nb);
      }
    }
    return [from];
  }

  /** Points de passage pour aller de g à (tx, tz) en passant par les portes. */
  function plan(n, g, tx, tz) {
    const path = bfs(n, cellKey(n, g.x, g.z), cellKey(n, tx, tz));
    const wps = [];
    for (let k = 0; k + 1 < path.length; k++) {
      const d = door(path[k], path[k + 1]);
      wps.push({ x: d.x - d.nx * 0.9, z: d.z - d.nz * 0.9 }, { x: d.x + d.nx * 0.9, z: d.z + d.nz * 0.9 });
    }
    wps.push({ x: tx, z: tz });
    return wps;
  }

  /** Ronde : visite de toutes les salles, aller-retour en profondeur depuis l'entrée. */
  function tour(n) {
    const seq = [];
    const seen = new Set();
    const visit = (k) => {
      seen.add(k);
      seq.push(k);
      for (const nb of neighbors(n, k)) {
        if (nb === 'out' || seen.has(nb)) continue;
        visit(nb);
        seq.push(k);
      }
    };
    visit('0,0');
    if (seq.length > 1) seq.pop(); // le retour final à l'entrée enchaîne sur le départ
    return seq;
  }

  function step(g, x, z, speed, dt) {
    const dx = x - g.x;
    const dz = z - g.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return true;
    g.ry = Math.atan2(dx, dz);
    const s = Math.min(d, speed * dt);
    g.x += (dx / d) * s;
    g.z += (dz / d) * s;
    return d - s < 0.05;
  }

  /** Avance vers une cible en suivant les portes ; renvoie true une fois arrivé. */
  function follow(n, g, tx, tz, speed, dt, now) {
    if (!g.wps || now - g.planAt > 600 || Math.hypot(g.planX - tx, g.planZ - tz) > 1) {
      g.wps = plan(n, g, tx, tz);
      g.planAt = now;
      g.planX = tx;
      g.planZ = tz;
    }
    while (g.wps.length) {
      const w = g.wps[0];
      if (!step(g, w.x, w.z, speed, dt)) return false;
      g.wps.shift();
      if (g.wps.length) return false; // un point par pas : mouvement régulier
    }
    return true;
  }

  function sees(n, g, t) {
    const dx = t.x - g.x;
    const dz = t.z - g.z;
    const d = Math.hypot(dx, dz);
    if (d > GUARD.VISION) return false;
    let a = Math.atan2(dx, dz) - g.ry;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) > GUARD.HALF_ANGLE) return false;
    const gk = cellKey(n, g.x, g.z);
    const tk = cellKey(n, t.x, t.z);
    // les murs arrêtent le regard ; en extérieur, pas de ligne de vue (murs entre les salles)
    if (gk === 'out' || tk === 'out') return false;
    return gk === tk;
  }

  /** Garde k : affecté à un étage (le 1er au rez-de-chaussée, le 2e au 1er étage…), il y apparaît. */
  function spawn(k, floors = 1, stairs = [4.2, 4.2]) {
    const home = k % floors;
    const [x, z] = home === 0 ? [OFFSETS[k % 3][0], -half + 2.2] : [stairs[0] - 1.6, stairs[1] - 1.6];
    return { k, home, floor: home, x, z, ry: 0, s: 'patrol', tourIdx: k, lookUntil: 0, target: null, seenAt: 0, blindUntil: 0, lureUntil: 0, lure: null, alertUntil: 0, wps: null, planAt: 0, planX: 0, planZ: 0 };
  }

  /** Va jusqu'à l'escalier et change d'étage vers `floor`. Renvoie true une fois l'étage changé. */
  function climb(n, g, floor, stairs, speed, dt, now) {
    if (follow(n, g, stairs[0], stairs[1], speed, dt, now)) {
      g.floor += Math.sign(floor - g.floor);
      g.wps = null;
      return true;
    }
    return false;
  }

  /** Relève de la garde : décalée d'un musée à l'autre. Renvoie 'break', 'yawn' ou null. */
  function shift(seed, now) {
    const t = (now + seed) % GUARD.CYCLE_MS;
    if (t >= GUARD.CYCLE_MS - GUARD.BREAK_MS) return 'break';
    if (t >= GUARD.CYCLE_MS - GUARD.BREAK_MS - GUARD.YAWN_MS) return 'yawn';
    return null;
  }

  /**
   * Fait vivre les gardes d'un musée pendant dt secondes.
   * @param suspects voleurs de ce musée, en coordonnées locales : [{ id, x, z }]
   * @returns l'identifiant du voleur attrapé, ou null
   */
  function tick(museum, suspects, dt, now) {
    const { guards, rooms, stairs = [4.2, 4.2] } = museum;
    const shiftState = shift(museum.seed, now);
    for (const g of guards) {
      g.floor ??= 0;
      g.home ??= 0;
      const n = g.floor === 0 ? rooms : -9; // étage supérieur : 9 salles, pas de sortie
      const blind = g.blindUntil > now;
      const lured = g.lureUntil > now;
      const resting = shiftState === 'break' && g.s !== 'chase';
      g.yawn = shiftState === 'yawn';
      // 1. regarder (seulement à son étage)
      if (!blind && !lured && !resting) {
        for (const t of suspects) {
          if ((t.floor ?? 0) !== g.floor) continue;
          const close = g.s === 'chase' && g.target === t.id && Math.hypot(t.x - g.x, t.z - g.z) < GUARD.CLOSE;
          if (close || sees(n, g, t)) {
            g.s = 'chase';
            g.target = t.id;
            g.seenAt = now;
            break;
          }
        }
      }
      // 2. agir
      if (blind) {
        g.s = 'blind';
        continue;
      }
      if (lured) {
        g.s = 'lured';
        g.target = null;
        if (follow(n, g, g.lure.x, g.lure.z, GUARD.LURE, dt, now)) g.ry += dt * 0.6;
        continue;
      }
      if (g.s === 'lured' || g.s === 'blind') g.s = 'return';
      if (resting) {
        g.s = 'break';
        continue;
      }
      if (g.s === 'break') g.s = 'return';

      if (g.s === 'chase' || g.s === 'alert') {
        const t = suspects.find((x) => x.id === g.target);
        const lost = g.s === 'chase' ? now - g.seenAt > GUARD.MEMORY_MS : now > g.alertUntil;
        const tooFar = cellKey(n, g.x, g.z) === 'out' && Math.hypot(g.x, g.z + half) > GUARD.LEASH;
        if (!t || lost || tooFar) {
          g.s = 'return';
          g.target = null;
        } else if ((t.floor ?? 0) !== g.floor) {
          // le voleur a changé d'étage : le garde prend l'escalier
          if (climb(n, g, t.floor ?? 0, stairs, g.s === 'chase' ? GUARD.CHASE : GUARD.ALERT, dt, now) && g.s === 'chase') g.seenAt = now;
          continue;
        } else {
          follow(n, g, t.x, t.z, g.s === 'chase' ? GUARD.CHASE : GUARD.ALERT, dt, now);
          if (Math.hypot(t.x - g.x, t.z - g.z) < GUARD.CATCH) {
            g.s = 'return';
            g.target = null;
            return t.id;
          }
          continue;
        }
      }
      // retour à son étage d'affectation
      if (g.floor !== g.home) {
        g.s = 'return';
        climb(n, g, g.home, stairs, GUARD.ALERT * 0.6, dt, now);
        continue;
      }
      // ronde
      const route = tour(n);
      const k = route[g.tourIdx % route.length];
      const [i, j] = k.split(',').map(Number);
      const off = OFFSETS[g.k % 3];
      const tx = i * CELL + off[0];
      const tz = j * CELL + off[1];
      if (g.lookUntil > now) {
        g.ry += dt * ((Math.PI * 2) / (GUARD.LOOK_MS / 1000)); // tour sur soi-même
        continue;
      }
      if (follow(n, g, tx, tz, g.s === 'return' ? GUARD.ALERT * 0.6 : GUARD.PATROL, dt, now)) {
        g.s = 'patrol';
        if (g.arrived !== g.tourIdx) {
          g.arrived = g.tourIdx;
          g.lookUntil = now + GUARD.LOOK_MS;
        } else g.tourIdx++;
      } else if (g.s !== 'return') g.s = 'patrol';
    }
    return null;
  }

  /** Alerte (caméra, laser, sabotage) : tous les gardes libres accourent. */
  function alert(museum, thiefId, now) {
    for (const g of museum.guards) {
      if (g.s === 'chase' || g.blindUntil > now || g.lureUntil > now) continue;
      g.s = 'alert';
      g.target = thiefId;
      g.alertUntil = now + GUARD.ALERT_MS;
      g.lookUntil = 0;
    }
  }

  return { tick, alert, spawn, cellKey, shift };
}
