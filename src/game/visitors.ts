import * as THREE from 'three';
import { Character } from './character';
import { doorstepOf, PLOTS, toWorld } from './layout';
import raw from '../shared/layout.json';
import type { MuseumView } from './museumView';
import { BENCHES, BLACK_MARKET, BOARD_POS, BOUTIQUE } from './district';

const SLOTS = (raw as unknown as { slots: Array<[number, number, number]>; cell: number }).slots;
const CELL = (raw as unknown as { cell: number }).cell;
/** Trottoirs de part et d'autre de la route du convoi (z = ±5,5) : les piétons ne traversent jamais la route. */
const SIDEWALK = 5.5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Walker {
  ch: Character;
  path: THREE.Vector3[];
  i: number;
  speed: number;
  wait: number;
  lookAt: THREE.Vector3 | null;
}

/** Fait avancer un piéton sur son trajet ; renvoie true une fois arrivé au bout. */
function walk(w: Walker, dt: number): boolean {
  const target = w.path[w.i];
  if (!target) return true;
  const pos = w.ch.root.position;
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dd = Math.hypot(dx, dz);
  if (dd < 0.15) {
    w.i++;
    return w.i >= w.path.length;
  }
  const step = Math.min(dd, w.speed * dt);
  pos.x += (dx / dd) * step;
  pos.z += (dz / dd) * step;
  let diff = Math.atan2(dx, dz) - w.ch.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  w.ch.root.rotation.y += diff * Math.min(1, dt * 8);
  w.ch.play('Walking');
  return false;
}

function face(w: Walker, at: THREE.Vector3): void {
  const p = w.ch.root.position;
  w.ch.root.rotation.y = Math.atan2(at.x - p.x, at.z - p.z);
}

function newWalker(scene: THREE.Scene, start: THREE.Vector3): Walker {
  const ch = new Character(undefined, { crowd: true });
  ch.root.position.copy(start);
  const speed = rand(1.3, 1.95);
  ch.setTimeScale(speed / 1.7); // le pas suit la vitesse de marche
  scene.add(ch.root);
  return { ch, path: [], i: 0, speed, wait: 0, lookAt: null };
}

// ================================================================== visiteurs de votre musée

interface Visitor extends Walker {
  phase: 'in' | 'look' | 'out';
  exit: THREE.Vector3[];
}

/**
 * Visiteurs PNJ de votre musée : ils arrivent par le trottoir, prennent l'allée du musée, passent la porte,
 * traversent les salles par les arcades, admirent une œuvre (un peu décalés pour ne pas s'empiler), puis repartent.
 */
export class Visitors {
  private list: Visitor[] = [];
  private target = 0;
  private spawnTimer = 0;
  museum: MuseumView | null = null;

  constructor(private scene: THREE.Scene) {}

  setTarget(n: number): void {
    this.target = Math.min(8, n);
  }

  get count(): number {
    return this.list.length;
  }

  /** Trajet de la salle d'entrée jusqu'à une salle, par les arcades (parcours en largeur). */
  private routeTo(m: MuseumView, cell: [number, number]): THREE.Vector3[] {
    const cells = m.roomCells;
    const key = (c: [number, number]) => `${c[0]},${c[1]}`;
    const prev = new Map<string, [number, number] | null>([['0,0', null]]);
    const queue: Array<[number, number]> = [[0, 0]];
    while (queue.length) {
      const c = queue.shift()!;
      if (key(c) === key(cell)) break;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n: [number, number] = [c[0] + dx, c[1] + dz];
        if (!prev.has(key(n)) && cells.some((x: [number, number]) => x[0] === n[0] && x[1] === n[1])) {
          prev.set(key(n), c);
          queue.push(n);
        }
      }
    }
    const chain: Array<[number, number]> = [];
    for (let c: [number, number] | null | undefined = cell; c; c = prev.get(key(c))) chain.unshift(c);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < chain.length; k++) {
      const [x, z] = chain[k];
      if (k > 0) {
        const [px, pz] = chain[k - 1];
        pts.push(m.cellWorld((x + px) / 2, (z + pz) / 2)); // milieu de l'arcade
      }
      pts.push(m.cellWorld(x, z, rand(-1.5, 1.5), k === 0 ? -1.5 : rand(-1, 1)));
    }
    return pts;
  }

  private spawn(m: MuseumView, slots: number[]): void {
    if (!slots.length) return;
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const { p, normal } = m.slotWorld(slot);
    const [sx, sz] = SLOTS[slot];
    const cell: [number, number] = [Math.round(sx / CELL), Math.round(sz / CELL)];
    // devant l'œuvre, à 1,6–2,2 m, un peu décalé sur le côté
    const lateral = new THREE.Vector3(normal.z, 0, -normal.x).multiplyScalar(rand(-0.7, 0.7));
    const stand = p.clone().addScaledVector(normal, rand(1.6, 2.2)).add(lateral).setY(0);
    const f = m.plot.f;
    const x0 = m.plot.x;
    const sideZ = f * SIDEWALK + rand(-0.6, 0.6);
    const from = Math.random() < 0.5 ? -1 : 1;
    const start = new THREE.Vector3(x0 + from * rand(14, 30), 0, sideZ);
    const axis = new THREE.Vector3(x0 + rand(-0.8, 0.8), 0, sideZ);
    const walkway = new THREE.Vector3(x0 + rand(-0.6, 0.6), 0, m.plot.z - f * 12);
    const door = doorstepOf(m.plot);
    const inside = toWorld(m.plot, rand(-0.4, 0.4), 0, -4.4);
    const way = [axis, walkway, door, inside, ...this.routeTo(m, cell), stand];
    const v = newWalker(this.scene, start) as Visitor;
    v.path = way;
    v.i = 0;
    v.phase = 'in';
    v.lookAt = p.clone().setY(0);
    // sortie : même chemin à l'envers, puis on s'éloigne de l'autre côté du trottoir
    v.exit = [...way].reverse().slice(1).concat(new THREE.Vector3(x0 - from * rand(16, 32), 0, sideZ));
    this.list.push(v);
  }

  update(dt: number): void {
    const m = this.museum;
    const occupied = m ? m.occupiedSlots() : [];
    this.spawnTimer -= dt;
    if (m && this.list.length < this.target && this.spawnTimer <= 0 && occupied.length) {
      this.spawn(m, occupied);
      this.spawnTimer = rand(2.5, 5.5);
    }
    for (const v of [...this.list]) {
      v.ch.update(dt);
      if (v.wait > 0) {
        v.wait -= dt;
        if (v.wait <= 0) {
          v.phase = 'out';
          v.path = v.exit;
          v.i = 0;
          if (Math.random() < 0.35) v.ch.gesture('Wave', 'Walking');
        }
        continue;
      }
      if (!walk(v, dt)) continue;
      if (v.phase === 'in') {
        v.phase = 'look';
        v.wait = rand(4, 9);
        v.ch.play('Idle');
        if (v.lookAt) face(v, v.lookAt);
      } else {
        v.ch.dispose();
        this.list.splice(this.list.indexOf(v), 1);
      }
    }
  }
}

// ================================================================== passants de la place

/** Points d'intérêt de la place (où un passant s'arrête un moment), de chaque côté de la route. */
interface Interest {
  at: THREE.Vector3;
  look: THREE.Vector3;
  /** Un banc : on s'y assoit. */
  sit?: boolean;
}

function interests(side: 1 | -1): Interest[] {
  const list: Interest[] = [];
  const add = (x: number, z: number, lx: number, lz: number) => list.push({ at: new THREE.Vector3(x, 0, z), look: new THREE.Vector3(lx, 0, lz) });
  // places assises sur les bancs de ce côté de la route (deux par banc)
  for (const b of BENCHES.filter((x) => Math.sign(x.z) === side)) {
    const o = Math.random() < 0.5 ? -0.45 : 0.45;
    list.push({ at: new THREE.Vector3(b.x + Math.cos(b.ry) * o, 0, b.z - Math.sin(b.ry) * o), look: new THREE.Vector3(b.look.x, 0, b.look.z), sit: true });
  }
  if (side === -1) {
    add(rand(-2, 2), -8.2, 0, -12); // fontaine
    add(BLACK_MARKET.x + rand(-1.5, 1.5), BLACK_MARKET.z + 1.4, BLACK_MARKET.x, BLACK_MARKET.z - 3);
    add(BOUTIQUE.x + rand(-1.5, 1.5), BOUTIQUE.z + 1.4, BOUTIQUE.x, BOUTIQUE.z - 3);
  } else {
    add(BOARD_POS.x + rand(-3, 3), BOARD_POS.z - 2.6, BOARD_POS.x, BOARD_POS.z);
  }
  // devant les façades des musées de ce côté
  for (const p of PLOTS.filter((x) => x.f === side)) add(p.x + rand(-2.5, 2.5), side * rand(9.5, 11), p.x, side * 22);
  return list;
}

/** Passants : flânent sur leur trottoir et s'arrêtent devant la fontaine, le classement, les boutiques, les musées. */
export class Pedestrians {
  private list: Array<Walker & { side: 1 | -1; sit?: boolean }> = [];

  constructor(private scene: THREE.Scene) {}

  /** Nombre de passants (moins en mode Éco). */
  setCount(n: number): void {
    while (this.list.length > n) this.list.pop()!.ch.dispose();
    while (this.list.length < n) {
      const side: 1 | -1 = this.list.length % 2 ? 1 : -1;
      const w = newWalker(this.scene, new THREE.Vector3(rand(-64, 64), 0, side * SIDEWALK + rand(-0.8, 0.8)));
      this.list.push(Object.assign(w, { side }));
      this.plan(this.list[this.list.length - 1]);
    }
  }

  get count(): number {
    return this.list.length;
  }

  /** Prochaine étape : un point d'intérêt (L : le long du trottoir, puis vers le point), ou une simple balade. */
  private plan(w: Walker & { side: 1 | -1; sit?: boolean }): void {
    if (w.sit) w.ch.setSitting(false); // on se relève du banc
    w.sit = false;
    const sideZ = w.side * SIDEWALK + rand(-0.8, 0.8);
    const pos = w.ch.root.position;
    const back = new THREE.Vector3(pos.x, 0, sideZ);
    if (Math.random() < 0.6) {
      const list = interests(w.side);
      const it = list[Math.floor(Math.random() * list.length)];
      w.path = [back, new THREE.Vector3(it.at.x, 0, sideZ), it.at];
      w.lookAt = it.look;
      w.sit = !!it.sit;
    } else {
      w.path = [back, new THREE.Vector3(rand(-64, 64), 0, sideZ)];
      w.lookAt = null;
    }
    w.i = 0;
  }

  update(dt: number): void {
    for (const w of this.list) {
      w.ch.update(dt);
      if (w.wait > 0) {
        w.wait -= dt;
        if (w.wait <= 0) this.plan(w);
        continue;
      }
      if (!walk(w, dt)) continue;
      w.wait = w.sit ? rand(8, 16) : w.lookAt ? rand(3, 8) : rand(0.5, 2);
      w.ch.play(w.sit ? 'Sitting' : 'Idle');
      if (w.lookAt) {
        face(w, w.lookAt);
        if (!w.sit && Math.random() < 0.2) w.ch.gesture('Wave', 'Idle');
      }
    }
  }
}
