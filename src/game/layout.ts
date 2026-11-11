import * as THREE from 'three';
import raw from '../shared/layout.json';
import type { ThemeId } from './Room';

/** Géométrie partagée avec le serveur (générée par tools/gen-layout.mjs). */
export interface Plot {
  index: number;
  x: number;
  z: number;
  /** +1 : le musée s'agrandit vers le sud (rangée sud) ; -1 : vers le nord. */
  f: 1 | -1;
}

const L = raw as unknown as {
  cell: number;
  floors: number;
  floorH: number;
  stairs: [number, number];
  rooms: Array<[number, number, ThemeId]>;
  slots: Array<[number, number, number, number, string?]>;
  plots: Plot[];
};
export const CELL = L.cell;
export const ROOMS = L.rooms;
export const PLOTS = L.plots;
/** Hauteur d'un étage (m). */
export const FLOOR_H = L.floorH;
export const MAX_FLOORS = L.floors;
/** Escalier en colimaçon (coordonnées locales, salle d'entrée). */
export const STAIRS = L.stairs;

/** Coordonnées locales du musée (z croissant = vers le fond) → monde. */
export function toWorld(plot: Plot, lx: number, ly: number, lz: number): THREE.Vector3 {
  return new THREE.Vector3(plot.x + lx, ly, plot.z + plot.f * lz);
}

/** Rotation y locale → monde (miroir sur z pour la rangée nord). */
export const ryWorld = (plot: Plot, ry: number) => (plot.f === 1 ? ry : Math.PI - ry);

/** Étage d'un emplacement (0 = rez-de-chaussée). */
export const slotFloor = (slot: number) => L.slots[slot]?.[3] ?? 0;
export const isStatueSlot = (slot: number) => L.slots[slot]?.[4] === 'statue';

export function slotWorld(plot: Plot, slot: number): { p: THREE.Vector3; ry: number; normal: THREE.Vector3; floor: number; isStatue: boolean } {
  const [x, z, ry, floor = 0, kind] = L.slots[slot] ?? [0, 0, 0, 0];
  const r = ryWorld(plot, ry);
  const isStatue = kind === 'statue';
  const py = isStatue ? floor * FLOOR_H : 2.1 + floor * FLOOR_H;
  return { p: toWorld(plot, x, py, z), ry: r, normal: new THREE.Vector3(Math.sin(r), 0, Math.cos(r)), floor, isStatue };
}

/** Dans les salles du musée, à l'étage donné (les étages supérieurs ont toujours les 9 salles). */
export function inside(plot: Plot, rooms: number, p: THREE.Vector3, floor = 0, floors = 1): boolean {
  if (floor >= floors) return false;
  const n = floor > 0 ? ROOMS.length : rooms;
  const lx = p.x - plot.x;
  const lz = (p.z - plot.z) * plot.f;
  const i = Math.round(lx / CELL);
  const j = Math.round(lz / CELL);
  if (Math.abs(lx - i * CELL) >= CELL / 2 || Math.abs(lz - j * CELL) >= CELL / 2) return false;
  return ROOMS.slice(0, n).some(([a, b]) => a === i && b === j);
}

/** Point de départ d'une parcelle, sur la place devant l'entrée. */
export const spawnOf = (plot: Plot) => toWorld(plot, 0, 0, -17);
/** Juste devant la porte, côté place. */
export const doorstepOf = (plot: Plot) => toWorld(plot, 0, 0, -7.5);
/** Pied de l'escalier, en coordonnées monde. */
export const stairsOf = (plot: Plot) => toWorld(plot, STAIRS[0], 0, STAIRS[1]);
