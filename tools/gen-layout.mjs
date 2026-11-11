// Génère src/shared/layout.json : géométrie partagée client / serveur (parcelles, salles, étages, emplacements).
// Usage : node tools/gen-layout.mjs
import { writeFileSync } from 'node:fs';

const CELL = 12;
const W = CELL / 2 - 0.12; // face intérieure d'un mur, depuis le centre de la salle

// Ordre d'ouverture des salles (cellule x, z ; z croît en s'éloignant de la place) et leur ambiance.
const rooms = [
  [0, 0, 'classic'], [0, 1, 'modern'], [-1, 0, 'zen'], [1, 0, 'futuristic'],
  [-1, 1, 'modern'], [1, 1, 'classic'], [-1, 2, 'futuristic'], [0, 2, 'zen'], [1, 2, 'classic'],
];

// Étages (phase 5 + 6 : niveaux 1 à 8) : 3 étages de salles couvertes (0, 1, 2) + le toit-terrasse (3).
// Un escalier en colimaçon relie les étages, dans un coin de la salle d'entrée (0, 0).
const FLOORS = 4;
const FLOOR_H = 5;
const STAIRS = [3, 3]; // loin des emplacements muraux : l'invite de l'escalier ne masque pas celle d'une œuvre

// Emplacements en coordonnées LOCALES (x, z, rotation y, étage, type?) :
// - 2 par mur pour les étages 0, 1, 2 (tableaux).
// - socles au sol pour la terrasse (étage 3) : 2 socles par salle de terrasse (total 18 socles pour statues).
const slots = [];
const r = (n) => Math.round(n * 1000) / 1000;
for (let floor = 0; floor < 3; floor++) {
  rooms.forEach(([i, j], k) => {
    const cx = i * CELL;
    const cz = j * CELL;
    for (const o of [-3, 3]) slots.push([r(cx - W), r(cz + o), r(Math.PI / 2), floor]);
    for (const o of [-3, 3]) slots.push([r(cx + W), r(cz + o), r(-Math.PI / 2), floor]);
    for (const o of [-3.75, 3.75]) slots.push([r(cx + o), r(cz + W), r(Math.PI), floor]);
    if (k !== 0 || floor > 0) for (const o of [-3.75, 3.75]) slots.push([r(cx + o), r(cz - W), 0, floor]);
  });
}

// Étage 3 : Toit-terrasse (socles pour statues au sol)
// 2 socles par dalle de 12×12 m, orientés vers le sud (rotation 0)
rooms.forEach(([i, j]) => {
  const cx = i * CELL;
  const cz = j * CELL;
  slots.push([r(cx - 2.5), r(cz), 0, 3, 'statue']);
  slots.push([r(cx + 2.5), r(cz), 0, 3, 'statue']);
});

// Parcelles : rangée sud (entrée au nord, vers la place) et rangée nord (entrée au sud).
// `f` = sens dans lequel le musée s'agrandit sur l'axe z (+1 vers le sud, -1 vers le nord).
const plots = [
  { x: -60, row: 'south' }, { x: -20, row: 'south' }, { x: 20, row: 'south' }, { x: 60, row: 'south' },
  { x: -60, row: 'north' }, { x: -20, row: 'north' }, { x: 20, row: 'north' },
].map((p, index) => ({ index, x: p.x, z: p.row === 'south' ? 28 : -28, f: p.row === 'south' ? 1 : -1 }));

writeFileSync('src/shared/layout.json', JSON.stringify({ cell: CELL, floors: FLOORS, floorH: FLOOR_H, stairs: STAIRS, rooms, slots, plots }, null, 1));
console.log(`layout.json : ${rooms.length} salles × ${FLOORS} étages, ${slots.length} emplacements, ${plots.length} parcelles`);
