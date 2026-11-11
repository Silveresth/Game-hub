import * as THREE from 'three';
import { Character } from './character';
import { doorstepOf } from './layout';
import raw from '../shared/layout.json';
import type { MuseumView } from './museumView';

const SLOTS = (raw as unknown as { slots: Array<[number, number, number]>; cell: number }).slots;
const CELL = (raw as unknown as { cell: number }).cell;
const TINTS = [0x5aa9ff, 0xff7aa2, 0x7ddc84, 0xf2ede1, 0xb28dff, 0xff9f43, 0x4dd0c4];
const SPEED = 1.7;

interface Visitor {
  ch: Character;
  path: THREE.Vector3[];
  i: number;
  wait: number;
  phase: 'in' | 'look' | 'out';
  lookAt: THREE.Vector3 | null;
}

/** Visiteurs PNJ de votre musée : ils arrivent par la place, entrent, admirent une œuvre, puis repartent. */
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

  /** Trajet de la porte jusqu'à une salle, par les portes intérieures (en évitant le banc central). */
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
        pts.push(m.cellWorld((x + px) / 2, (z + pz) / 2));
      }
      pts.push(m.cellWorld(x, z, 2.4, k === 0 ? -2 : 0));
    }
    return pts;
  }

  private spawn(m: MuseumView, slots: number[]): void {
    if (!slots.length) return;
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const { p, normal } = m.slotWorld(slot);
    const [sx, sz] = SLOTS[slot];
    const cell: [number, number] = [Math.round(sx / CELL), Math.round(sz / CELL)];
    const stand = p.clone().addScaledVector(normal, 1.9).setY(0);
    const door = doorstepOf(m.plot);
    const d = -m.plot.f; // vers la place
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = new THREE.Vector3(door.x + side * (14 + Math.random() * 30), 0, door.z + d * (12 + Math.random() * 4));
    const path = [start, door.clone().add(new THREE.Vector3(0, 0, d * 2.5)), door.clone().add(new THREE.Vector3(0, 0, -d * 2)), ...this.routeTo(m, cell), stand];
    const ch = new Character(TINTS[Math.floor(Math.random() * TINTS.length)]);
    ch.root.position.copy(start);
    this.scene.add(ch.root);
    this.list.push({ ch, path, i: 1, wait: 0, phase: 'in', lookAt: p.clone().setY(0) });
  }

  update(dt: number): void {
    const m = this.museum;
    const occupied = m ? m.occupiedSlots() : [];
    this.spawnTimer -= dt;
    if (m && this.list.length < this.target && this.spawnTimer <= 0 && occupied.length) {
      this.spawn(m, occupied);
      this.spawnTimer = 2.5 + Math.random() * 3;
    }
    for (const v of [...this.list]) {
      v.ch.update(dt);
      if (v.wait > 0) {
        v.wait -= dt;
        if (v.wait <= 0) {
          v.phase = 'out';
          v.path = [...v.path].reverse();
          v.i = 1;
          if (Math.random() < 0.3) v.ch.gesture('ThumbsUp', 'Walking');
        }
        continue;
      }
      const target = v.path[v.i];
      if (!target) {
        if (v.phase === 'in') {
          v.phase = 'look';
          v.wait = 4 + Math.random() * 5;
          v.ch.play('Idle');
          if (v.lookAt) v.ch.root.rotation.y = Math.atan2(v.lookAt.x - v.ch.root.position.x, v.lookAt.z - v.ch.root.position.z);
        } else {
          v.ch.dispose();
          this.list.splice(this.list.indexOf(v), 1);
        }
        continue;
      }
      const pos = v.ch.root.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 0.15) {
        v.i++;
        continue;
      }
      const step = Math.min(dd, SPEED * dt);
      pos.x += (dx / dd) * step;
      pos.z += (dz / dd) * step;
      let diff = Math.atan2(dx, dz) - v.ch.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      v.ch.root.rotation.y += diff * Math.min(1, dt * 8);
      v.ch.play('Walking');
    }
  }
}
