// Musées de démonstration générés (œuvres procédurales « gen: » + sculptures : aucun fichier nécessaire).
const CELL = 12;
const WALL = CELL / 2 - 0.12; // distance du centre de salle à la face intérieure d'un mur
const P = Math.PI;
const STYLES = ['landscape', 'sunset', 'rothko', 'mondrian', 'circles', 'waves', 'mountains', 'bauhaus'];
const FORMS = ['knot', 'orb', 'spiral', 'rings', 'monolith'];
const MATERIALS = ['marble', 'gold', 'bronze', 'glass', 'jade'];
const TITLES = ['Aurore', 'Silence', 'Écume', 'Mémoire', 'Lueur', 'Rivage', 'Vertige', 'Écho', 'Saison', 'Horizon', 'Murmure', 'Éclat'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Remplit chaque salle : tableaux sur les murs (de part et d'autre des portes) et deux sculptures. */
function furnish(rooms, seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const has = (x, z) => rooms.some((c) => c.x === x && c.z === z);
  const artifacts = [];
  let n = 0;
  const add = (a) => artifacts.push({ id: `s${seed}-${n++}`, spot: true, ...a });
  for (const room of rooms) {
    const cx = room.x * CELL;
    const cz = room.z * CELL;
    // [voisin dx, dz, position du mur, rotation y (face vers l'intérieur)]
    const sides = [
      [0, -1, (o) => [cx + o, 2, cz - WALL], 0],
      [0, 1, (o) => [cx + o, 2, cz + WALL], P],
      [-1, 0, (o) => [cx - WALL, 2, cz + o], P / 2],
      [1, 0, (o) => [cx + WALL, 2, cz + o], -P / 2],
    ];
    for (const [dx, dz, at, ry] of sides) {
      const offsets = has(room.x + dx, room.z + dz) ? [-3.75, 3.75] : r() < 0.5 ? [0] : [-2.6, 2.6];
      for (const o of offsets) {
        add({
          type: 'PHOTO', title: pick(TITLES), url: `gen:${pick(STYLES)}:${Math.floor(r() * 1e6)}`,
          position: at(o), rotation: [0, ry, 0], scale: offsets.length === 1 ? 1.5 : 1.1,
        });
      }
    }
    for (const sx of [-3.2, 3.2]) {
      add({
        type: 'SCULPTURE', title: pick(TITLES), url: '', position: [cx + sx, 0, cz + 3.2], rotation: [0, 0, 0],
        scale: 0.9 + r() * 0.4, form: pick(FORMS), material: pick(MATERIALS),
      });
    }
  }
  return artifacts;
}

export function seedMuseums() {
  const defs = [
    {
      name: 'Galerie du Port', author: 'Marie',
      rooms: [{ x: 0, z: 0, theme: 'modern' }, { x: 0, z: -1, theme: 'zen' }, { x: 1, z: -1, theme: 'modern' }],
    },
    {
      name: 'Collection Néon', author: 'Lina',
      rooms: [{ x: 0, z: 0, theme: 'futuristic' }, { x: -1, z: 0, theme: 'futuristic' }, { x: 1, z: 0, theme: 'futuristic' }, { x: 0, z: -1, theme: 'modern' }],
    },
    {
      name: 'Le Palais des Souvenirs', author: 'Yanis',
      rooms: [
        { x: 0, z: 0, theme: 'classic' }, { x: 0, z: -1, theme: 'classic' }, { x: -1, z: -1, theme: 'zen' },
        { x: 1, z: -1, theme: 'classic' }, { x: 0, z: -2, theme: 'futuristic' },
      ],
    },
  ];
  return defs.map((d, i) => ({ version: 2, name: d.name, author: d.author, rooms: d.rooms, artifacts: furnish(d.rooms, 101 + i * 17) }));
}
