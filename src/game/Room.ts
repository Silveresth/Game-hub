/**
 * Types et classe pour la construction 3D des musées (salles, murs, sols, plafonds).
 * Remplace l'ancien src/museum/Room.ts — seule l'API utilisée par museumView.ts est conservée.
 */
import * as THREE from 'three';

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

const THEME_COLORS: Record<ThemeId, { wall: number; floor: number; trim: number }> = {
  modern:      { wall: 0xf5f0e6, floor: 0xd9d1bf, trim: 0xe8e0ce },
  classic:     { wall: 0xece4d3, floor: 0x8b7355, trim: 0xd4c9b2 },
  futuristic:  { wall: 0x1a1d2b, floor: 0x23262e, trim: 0x2b2f38 },
  zen:         { wall: 0xe9e2d0, floor: 0xc4b896, trim: 0xd5cdb5 },
};

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

/**
 * Bâtiment composé de salles sur une grille.
 * Chaque salle est un cube ouvert en haut (roofless) avec 4 murs, percés là où une salle voisine existe.
 */
export class MuseumBuilding {
  readonly group = new THREE.Group();
  /** Maillages auxquels des œuvres peuvent être accrochées (murs + sols). */
  hangables: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Construit (ou reconstruit) toutes les salles. */
  build(rooms: RoomDef[], opts: BuildOptions = {}): void {
    // nettoyage
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
      const colors = THEME_COLORS[room.theme];

      // Sol
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL, CELL),
        std(colors.floor, { roughness: 0.65 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      floor.userData.floor = true;
      this.group.add(floor);
      this.hangables.push(floor);

      // Murs (4 directions)
      const dirs: Array<[number, number, 'x' | 'z', number]> = [
        [0, -1, 'z', -HALF], // nord
        [0, 1, 'z', HALF],   // sud
        [-1, 0, 'x', -HALF], // ouest
        [1, 0, 'x', HALF],   // est
      ];

      for (const [dx, dz, axis, offset] of dirs) {
        const neighbor = has(room.x + dx, room.z + dz);
        const isEntrance = entrance && room.x === entrance.x && room.z === entrance.z &&
          ((entrance.side === 'n' && dx === 0 && dz === -1) ||
           (entrance.side === 's' && dx === 0 && dz === 1) ||
           (entrance.side === 'w' && dx === -1 && dz === 0) ||
           (entrance.side === 'e' && dx === 1 && dz === 0));

        if (neighbor) continue; // ouverture vers la salle voisine

        if (isEntrance) {
          // mur percé : deux segments de chaque côté de la porte (largeur 3 m)
          const segW = (CELL - 3) / 2;
          for (const side of [-1, 1]) {
            const wall = new THREE.Mesh(
              new THREE.BoxGeometry(axis === 'z' ? segW : WALL_T, WALL_H, axis === 'x' ? segW : WALL_T),
              std(colors.wall),
            );
            wall.position.set(
              cx + (axis === 'z' ? side * (segW / 2 + 1.5) : offset),
              WALL_H / 2,
              cz + (axis === 'x' ? side * (segW / 2 + 1.5) : offset),
            );
            this.group.add(wall);
            this.hangables.push(wall);
          }
        } else {
          // mur plein
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(axis === 'z' ? CELL : WALL_T, WALL_H, axis === 'x' ? CELL : WALL_T),
            std(colors.wall),
          );
          wall.position.set(
            cx + (axis === 'x' ? offset : 0),
            WALL_H / 2,
            cz + (axis === 'z' ? offset : 0),
          );
          this.group.add(wall);
          this.hangables.push(wall);
        }
      }

      // Plinthes basses (trim)
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(CELL + WALL_T, 0.25, CELL + WALL_T),
        std(colors.trim, { roughness: 0.5 }),
      );
      trim.position.set(cx, 0.125, cz);
      this.group.add(trim);
    }
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
