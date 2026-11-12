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

const THEME_COLORS: Record<ThemeId, { wall: number; floor: number; trim: number; wallRoughness?: number; floorRoughness?: number; floorMetalness?: number }> = {
  modern:      { wall: 0x3a424e, floor: 0x242831, trim: 0x4f5b6d, wallRoughness: 0.5, floorRoughness: 0.25, floorMetalness: 0.1 }, // Béton ciré anthracite moderne, murs contrastés galerie contemporaine
  classic:     { wall: 0x6e262c, floor: 0x54361c, trim: 0xb89758, wallRoughness: 0.8, floorRoughness: 0.4 }, // Velours rouge rubis impérial, parquet bois noble chaleureux et moulures dorées
  futuristic:  { wall: 0x121524, floor: 0x0c0f1a, trim: 0x00d2ff, wallRoughness: 0.3, floorRoughness: 0.2, floorMetalness: 0.4 }, // Cyber-galerie sombre néon cyan & reflets tech
  zen:         { wall: 0x485848, floor: 0xb8aa82, trim: 0x33251a, wallRoughness: 0.85, floorRoughness: 0.6 }, // Bambou vert sauge, nattes tatami sable et boiseries sombres cèdre
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
        std(colors.floor, { roughness: colors.floorRoughness ?? 0.65, metalness: colors.floorMetalness ?? 0 }),
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

        if (neighbor) {
          // Entre deux salles voisines : arcade ouverte avec retombées de mur latérales (largeur d'arche = 4.2m)
          // Permet aux tableaux accrochés sur les ailes de reposer sur un véritable mur physique !
          // segW = (12 - 4.2) / 2 = 3.9 m de chaque côté
          const doorPassage = 4.2;
          const segW = (CELL - doorPassage) / 2;
          for (const side of [-1, 1]) {
            const partitionWall = new THREE.Mesh(
              new THREE.BoxGeometry(axis === 'z' ? segW : WALL_T, WALL_H, axis === 'x' ? segW : WALL_T),
              std(colors.wall, { roughness: colors.wallRoughness ?? 0.7 }),
            );
            partitionWall.position.set(
              cx + (axis === 'z' ? side * (segW / 2 + doorPassage / 2) : offset),
              WALL_H / 2,
              cz + (axis === 'x' ? side * (segW / 2 + doorPassage / 2) : offset),
            );
            this.group.add(partitionWall);
            this.hangables.push(partitionWall);
          }
          // Imposte supérieure au-dessus de l'arcade pour une belle transition architecturale
          const transom = new THREE.Mesh(
            new THREE.BoxGeometry(axis === 'z' ? doorPassage : WALL_T, 1.2, axis === 'x' ? doorPassage : WALL_T),
            std(colors.trim, { roughness: 0.5 }),
          );
          transom.position.set(
            cx + (axis === 'x' ? offset : 0),
            WALL_H - 0.6,
            cz + (axis === 'z' ? offset : 0),
          );
          this.group.add(transom);
          continue;
        }

        if (isEntrance) {
          // mur percé : deux segments de chaque côté de la porte (largeur 3 m)
          const segW = (CELL - 3) / 2;
          for (const side of [-1, 1]) {
            const wall = new THREE.Mesh(
              new THREE.BoxGeometry(axis === 'z' ? segW : WALL_T, WALL_H, axis === 'x' ? segW : WALL_T),
              std(colors.wall, { roughness: colors.wallRoughness ?? 0.7 }),
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
            std(colors.wall, { roughness: colors.wallRoughness ?? 0.7 }),
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
