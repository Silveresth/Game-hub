/**
 * Construction 3D des salles d'un musée (sols, murs, plinthes, corniches), sur une grille de 12 m.
 * Les 4 ambiances ont de vraies textures (voir textures.ts), partagées entre toutes les salles.
 */
import * as THREE from 'three';
import { boxUvMeters, planeUvMeters, themeMaterials } from './textures';

export type ThemeId = 'modern' | 'classic' | 'futuristic' | 'zen';

interface RoomDef {
  x: number;
  z: number;
  theme: ThemeId;
}

interface BuildOptions {
  entrance?: { x: number; z: number; side: string };
  roofless?: boolean;
  lights?: boolean;
}

interface Box {
  minX: number; maxX: number; minZ: number; maxZ: number;
}
interface Circle {
  x: number; z: number; r: number;
}

const CELL = 12;
const WALL_H = 5;
const WALL_T = 0.24;
const HALF = CELL / 2;
/** Plinthe (bas de mur) et corniche (haut de mur, visible d'en haut puisque les salles n'ont pas de toit). */
const BASE_H = 0.28;
const BASE_T = 0.06;
const CAP_H = 0.14;

/**
 * Bâtiment composé de salles sur une grille.
 * Chaque salle est un cube ouvert en haut avec 4 murs, percés là où une salle voisine existe (arcade)
 * ou là où se trouve l'entrée (porte de 3 m).
 */
export class MuseumBuilding {
  readonly group = new THREE.Group();
  /** Maillages auxquels des œuvres peuvent être accrochées (murs + sols) ; seuls les murs bloquent. */
  hangables: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Construit (ou reconstruit) toutes les salles. */
  build(rooms: RoomDef[], opts: BuildOptions = {}): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o: THREE.Object3D) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.hangables = [];

    const set = new Set(rooms.map((r) => `${r.x},${r.z}`));
    const has = (x: number, z: number) => set.has(`${x},${z}`);
    const entrance = opts.entrance;

    for (const room of rooms) {
      const cx = room.x * CELL;
      const cz = room.z * CELL;
      const mats = themeMaterials(room.theme);

      // Sol texturé (le motif garde son échelle : 4 m par répétition)
      const floor = new THREE.Mesh(planeUvMeters(new THREE.PlaneGeometry(CELL, CELL), CELL, CELL), mats.floor);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0.005, cz);
      floor.userData.floor = true;
      floor.receiveShadow = true;
      this.group.add(floor);
      this.hangables.push(floor);

      /** Un pan de mur (axe 'z' = mur nord/sud, 'x' = mur ouest/est) avec sa plinthe et sa corniche. */
      const wallPiece = (axis: 'x' | 'z', len: number, px: number, pz: number) => {
        const w = axis === 'z' ? len : WALL_T;
        const d = axis === 'x' ? len : WALL_T;
        const wall = new THREE.Mesh(boxUvMeters(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d), mats.wall);
        wall.position.set(px, WALL_H / 2, pz);
        this.group.add(wall);
        this.hangables.push(wall);
        // plinthe : une simple bande au pied du mur (avant : une dalle de 12 × 12 m recouvrait tout le sol)
        const base = new THREE.Mesh(new THREE.BoxGeometry(w + (axis === 'x' ? BASE_T * 2 : 0), BASE_H, d + (axis === 'z' ? BASE_T * 2 : 0)), mats.trim);
        base.position.set(px, BASE_H / 2, pz);
        this.group.add(base);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, CAP_H, d + 0.08), mats.trim);
        cap.position.set(px, WALL_H + CAP_H / 2, pz);
        this.group.add(cap);
      };

      const dirs: Array<[number, number, 'x' | 'z', number]> = [
        [0, -1, 'z', -HALF], // nord
        [0, 1, 'z', HALF], // sud
        [-1, 0, 'x', -HALF], // ouest
        [1, 0, 'x', HALF], // est
      ];

      for (const [dx, dz, axis, offset] of dirs) {
        const neighbor = has(room.x + dx, room.z + dz);
        const isEntrance = !!entrance && room.x === entrance.x && room.z === entrance.z &&
          ((entrance.side === 'n' && dx === 0 && dz === -1) ||
           (entrance.side === 's' && dx === 0 && dz === 1) ||
           (entrance.side === 'w' && dx === -1 && dz === 0) ||
           (entrance.side === 'e' && dx === 1 && dz === 0));
        // position d'un pan décalé de `along` le long du mur
        const at = (along: number): [number, number] => (axis === 'z' ? [cx + along, cz + offset] : [cx + offset, cz + along]);

        if (neighbor) {
          // arcade de 4,2 m vers la salle voisine. Chaque salle dessine sa moitié du mur commun ;
          // on ne la dessine qu'une fois (côté sud / est) pour éviter deux murs superposés qui scintillent.
          if (dx < 0 || dz < 0) continue;
          const passage = 4.2;
          const segW = (CELL - passage) / 2;
          for (const side of [-1, 1]) wallPiece(axis, segW, ...at(side * (segW / 2 + passage / 2)));
          const [tx, tz] = at(0);
          const transom = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? passage : WALL_T, 1.2, axis === 'x' ? passage : WALL_T), mats.trim);
          transom.position.set(tx, WALL_H - 0.6, tz);
          this.group.add(transom);
          continue;
        }
        if (isEntrance) {
          const segW = (CELL - 3) / 2;
          for (const side of [-1, 1]) wallPiece(axis, segW, ...at(side * (segW / 2 + 1.5)));
          continue;
        }
        wallPiece(axis, CELL, ...at(0));
      }
    }

    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.floor) m.castShadow = m.receiveShadow = true;
    });
  }

  /** Retourne les obstacles du bâtiment en coordonnées monde. */
  worldColliders(): { boxes: Box[]; circles: Circle[] } {
    const boxes: Box[] = [];
    const pos = this.group.position;
    const sz = this.group.scale.z;

    for (const mesh of this.hangables) {
      if (mesh.userData.floor) continue; // les sols ne bloquent pas
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const halfW = (bb.max.x - bb.min.x) / 2;
      const halfD = (bb.max.z - bb.min.z) / 2;
      const wx = pos.x + mesh.position.x;
      const wz = pos.z + mesh.position.z * sz;
      boxes.push({
        minX: wx - halfW,
        maxX: wx + halfW,
        minZ: wz - halfD * Math.abs(sz),
        maxZ: wz + halfD * Math.abs(sz),
      });
    }
    return { boxes, circles: [] };
  }
}
