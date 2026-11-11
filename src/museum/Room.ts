import * as THREE from 'three';
import type { RoomCell } from './types';

export type ThemeId = 'modern' | 'classic' | 'futuristic' | 'zen';

/** Dimensions d'une salle (cellule de la grille du musée). */
export const CELL = 12;
export const HEIGHT = 5;
export const WALL_T = 0.2;
export const DOOR_HALF = 1.5;
export const DOOR_H = 3.2;
export const MAX_ROOMS = 9;
/** Les salles occupent les coordonnées -GRID..GRID sur chaque axe. */
export const GRID = 3;
const PLAYER_R = 0.35;

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

interface ThemeDef {
  label: string;
  swatch: string;
  wall: Painter;
  wallUnit: number;
  floor: Painter;
  floorUnit: number;
  floorGlow?: boolean;
  trim: number;
  trimGlow?: boolean;
  ceiling: number;
  panel: number;
  light: number;
  lightIntensity: number;
  bench: number;
}

// ------------------------------------------------------------------ textures procédurales

function noise(g: CanvasRenderingContext2D, s: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
}

const plaster = (color: string): Painter => (g, s) => {
  g.fillStyle = color;
  g.fillRect(0, 0, s, s);
  noise(g, s, 9000, 0.035);
};

const PAINT = {
  concrete: ((g, s) => {
    g.fillStyle = '#b9b7b1';
    g.fillRect(0, 0, s, s);
    noise(g, s, 16000, 0.05);
    g.strokeStyle = 'rgba(60,60,60,.35)';
    g.lineWidth = 3;
    for (const p of [0, s / 2]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, s); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(s, p); g.stroke();
    }
  }) as Painter,
  parquet: ((g, s) => {
    const rowH = s / 8;
    const tones = ['#7a4f2c', '#8a5a33', '#6c4426', '#94653b', '#7f532e'];
    for (let r = 0; r < 8; r++) {
      let x = -Math.random() * 120;
      while (x < s) {
        const w = 120 + Math.random() * 140;
        g.fillStyle = tones[Math.floor(Math.random() * tones.length)];
        g.fillRect(x, r * rowH, w, rowH);
        g.fillStyle = 'rgba(0,0,0,.06)';
        for (let k = 0; k < 6; k++) g.fillRect(x, r * rowH + Math.random() * rowH, w, 1);
        g.fillStyle = 'rgba(25,12,4,.7)';
        g.fillRect(x, r * rowH, 2, rowH);
        x += w;
      }
      g.fillStyle = 'rgba(25,12,4,.7)';
      g.fillRect(0, r * rowH, s, 2);
    }
  }) as Painter,
  neonGrid: ((g, s) => {
    g.fillStyle = '#090d1c';
    g.fillRect(0, 0, s, s);
    noise(g, s, 4000, 0.03);
    g.strokeStyle = '#3a66ff';
    g.shadowColor = '#3a66ff';
    g.shadowBlur = 12;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.lineWidth = 1;
    g.strokeRect(s / 4, s / 4, s / 2, s / 2);
    g.shadowBlur = 0;
  }) as Painter,
  tatami: ((g, s) => {
    for (let m = 0; m < 2; m++) {
      const x0 = m * (s / 2);
      g.fillStyle = '#cdc28a';
      g.fillRect(x0, 0, s / 2, s);
      for (let y = 0; y < s; y += 4) {
        g.fillStyle = y % 8 ? 'rgba(90,80,30,.10)' : 'rgba(255,255,220,.10)';
        g.fillRect(x0, y, s / 2, 2);
      }
      g.fillStyle = '#2f4a2a';
      g.fillRect(x0, 0, 14, s);
      g.fillRect(x0 + s / 2 - 14, 0, 14, s);
    }
  }) as Painter,
  damask: ((g, s) => {
    plaster('#7a2f33')(g, s);
    g.fillStyle = 'rgba(255,210,170,.06)';
    for (let x = 0; x < s; x += 64) g.fillRect(x, 0, 22, s);
    g.fillStyle = 'rgba(30,5,5,.25)';
    g.fillRect(0, s * 0.62, s, 6);
  }) as Painter,
  panels: ((g, s) => {
    g.fillStyle = '#121838';
    g.fillRect(0, 0, s, s);
    noise(g, s, 5000, 0.03);
    g.strokeStyle = 'rgba(90,120,255,.35)';
    g.lineWidth = 2;
    g.strokeRect(6, 6, s - 12, s / 2 - 12);
    g.strokeRect(6, s / 2 + 6, s - 12, s / 2 - 12);
  }) as Painter,
  shoji: ((g, s) => {
    plaster('#f4efe3')(g, s);
    g.fillStyle = '#86643f';
    for (let x = 0; x <= s; x += s / 4) g.fillRect(x - 4, 0, 8, s);
    for (let y = 0; y <= s; y += s / 3) g.fillRect(0, y - 4, s, 8);
  }) as Painter,
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  modern: {
    label: 'Moderne', swatch: '#e9e6e1', wall: plaster('#ebe8e3'), wallUnit: 3, floor: PAINT.concrete, floorUnit: 4,
    trim: 0xd2cdc4, ceiling: 0xf3f3f3, panel: 0xffffff, light: 0xffffff, lightIntensity: 45, bench: 0xc9a27a,
  },
  classic: {
    label: 'Classique', swatch: '#7a2f33', wall: PAINT.damask, wallUnit: 2.5, floor: PAINT.parquet, floorUnit: 3,
    trim: 0x3a2414, ceiling: 0xe6dcc6, panel: 0xffe7c4, light: 0xffd9a8, lightIntensity: 42, bench: 0x5a1f1f,
  },
  futuristic: {
    label: 'Futuriste', swatch: '#141b3a', wall: PAINT.panels, wallUnit: 2.5, floor: PAINT.neonGrid, floorUnit: 3, floorGlow: true,
    trim: 0x3d6bff, trimGlow: true, ceiling: 0x070a18, panel: 0x6f8dff, light: 0x9fb8ff, lightIntensity: 34, bench: 0xdfe6ff,
  },
  zen: {
    label: 'Zen', swatch: '#d9cfa8', wall: PAINT.shoji, wallUnit: 2.4, floor: PAINT.tatami, floorUnit: 3.6,
    trim: 0x7a5a38, ceiling: 0xe8dfcc, panel: 0xfff6e8, light: 0xfff1dc, lightIntensity: 40, bench: 0x9b7650,
  },
};

function canvasTexture(paint: Painter, size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Ramène les UV d'une boîte en unités monde pour que les textures se répètent sans étirement. */
function worldUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, unit: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / unit, (uv.getY(i) * dims[f][1]) / unit);
    }
  }
}

interface ThemeMaterials {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  ceil: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
}

interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Circle { x: number; z: number; r: number }

const key = (x: number, z: number) => `${x},${z}`;

/**
 * Bâtiment du musée : une grille de salles carrées. Deux salles voisines sont reliées par une porte ;
 * chaque face de mur prend le thème de la salle qu'elle regarde.
 */
export class MuseumBuilding {
  readonly group = new THREE.Group();
  /** Murs et sols : surfaces visées par le raycast de placement. */
  readonly hangables: THREE.Object3D[] = [];

  private rooms = new Map<string, RoomCell>();
  private boxes: Box2[] = [];
  private circles: Circle[] = [];
  private mats = new Map<ThemeId, ThemeMaterials>();
  private shared = {
    pot: new THREE.MeshStandardMaterial({ color: 0xb5643c, roughness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 0.7, flatShading: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4, metalness: 0.8 }),
  };

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  has(x: number, z: number): boolean {
    return this.rooms.has(key(x, z));
  }

  get(x: number, z: number): RoomCell | undefined {
    return this.rooms.get(key(x, z));
  }

  cellOf(x: number, z: number): { x: number; z: number } {
    return { x: Math.round(x / CELL), z: Math.round(z / CELL) };
  }

  /** Clé de la cloison qui porte l'entrée extérieure (voir `build`). */
  private entranceKey: string | null = null;
  private roofless = false;
  /** Une lampe par salle (désactivable : sans toit, le soleil suffit et 60 lampes ruineraient les performances). */
  private lights = true;

  /**
   * @param opts.entrance porte vers l'extérieur sur un côté d'une salle (jeu à la 3e personne)
   * @param opts.roofless sans plafond : la caméra voit l'intérieur d'en haut
   */
  build(rooms: RoomCell[], opts: { entrance?: { x: number; z: number; side: 'n' | 's' | 'e' | 'w' }; roofless?: boolean; lights?: boolean } = {}): void {
    this.clear();
    this.roofless = !!opts.roofless;
    this.lights = opts.lights ?? true;
    const e = opts.entrance;
    this.entranceKey = !e ? null
      : e.side === 'n' ? `h:${e.x}:${e.z - 1}` : e.side === 's' ? `h:${e.x}:${e.z}`
      : e.side === 'w' ? `v:${e.x - 1}:${e.z}` : `v:${e.x}:${e.z}`;
    this.rooms = new Map(rooms.map((r) => [key(r.x, r.z), r]));
    for (const r of rooms) this.buildCell(r);
    const done = new Set<string>();
    for (const r of rooms) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ax = dx < 0 ? r.x - 1 : r.x;
        const az = dz < 0 ? r.z - 1 : r.z;
        const kind = dx !== 0 ? 'v' : 'h';
        const k = `${kind}:${ax}:${az}`;
        if (done.has(k)) continue;
        done.add(k);
        this.buildBoundary(kind, ax, az);
      }
    }
  }

  /**
   * Obstacles en coordonnées MONDE (le groupe peut être déplacé) : murs, banc, plantes.
   * Utilisé par le jeu à la 3e personne, où l'on circule aussi à l'extérieur du bâtiment.
   */
  worldColliders(): { boxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>; circles: Circle[] } {
    this.group.updateMatrixWorld(true);
    const boxes = this.hangables
      .filter((m) => !m.userData.floor && !m.userData.noHang)
      .map((m) => {
        const b = new THREE.Box3().setFromObject(m);
        return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
      });
    // mobilier : coordonnées locales → monde (le groupe peut être déplacé et retourné en miroir)
    const w = (x: number, z: number) => this.group.localToWorld(new THREE.Vector3(x, 0, z));
    for (const b of this.boxes) {
      const a = w(b.minX + PLAYER_R, b.minZ + PLAYER_R);
      const c = w(b.maxX - PLAYER_R, b.maxZ - PLAYER_R);
      boxes.push({ minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z) });
    }
    return { boxes, circles: this.circles.map((c) => { const p = w(c.x, c.z); return { x: p.x, z: p.z, r: c.r }; }) };
  }

  /** Collision joueur : hors salle, dans un mur (hors porte) ou dans un meuble / une sculpture. */
  isBlocked(x: number, z: number, extra: Circle[] = []): boolean {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    if (!this.has(i, j)) return true;
    const lx = x - i * CELL;
    const lz = z - j * CELL;
    const lim = CELL / 2 - WALL_T / 2 - PLAYER_R;
    const doorLim = DOOR_HALF - PLAYER_R;
    const outX = Math.abs(lx) > lim;
    const outZ = Math.abs(lz) > lim;
    if (outX && outZ) return true;
    if (outX && !(this.has(i + Math.sign(lx), j) && Math.abs(lz) < doorLim)) return true;
    if (outZ && !(this.has(i, j + Math.sign(lz)) && Math.abs(lx) < doorLim)) return true;
    if (this.boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return true;
    return [...this.circles, ...extra].some((c) => Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_R);
  }

  /** Vrai si un socle de sculpture peut être posé ici (loin des murs, des portes et du mobilier). */
  canPlaceFloor(x: number, z: number, extra: Circle[]): boolean {
    const i = Math.round(x / CELL);
    const j = Math.round(z / CELL);
    if (!this.has(i, j)) return false;
    const lx = x - i * CELL;
    const lz = z - j * CELL;
    if (Math.abs(lx) > CELL / 2 - 0.9 || Math.abs(lz) > CELL / 2 - 0.9) return false;
    const pad = 0.5;
    if (this.boxes.some((b) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad)) return false;
    return ![...this.circles, ...extra].some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.75);
  }

  // ---------------------------------------------------------------- construction

  private materials(id: ThemeId): ThemeMaterials {
    let m = this.mats.get(id);
    if (m) return m;
    const t = THEMES[id];
    const floorMap = canvasTexture(t.floor);
    floorMap.repeat.set(CELL / t.floorUnit, CELL / t.floorUnit);
    const wallMap = canvasTexture(t.wall);
    m = {
      wall: new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.9 }),
      floor: new THREE.MeshStandardMaterial({
        map: floorMap,
        roughness: id === 'modern' ? 0.45 : id === 'classic' ? 0.5 : 0.8,
        metalness: 0,
        emissive: t.floorGlow ? 0xffffff : 0x000000,
        emissiveMap: t.floorGlow ? floorMap : null,
        emissiveIntensity: t.floorGlow ? 0.55 : 0,
      }),
      ceil: new THREE.MeshStandardMaterial({ color: t.ceiling, roughness: 1 }),
      trim: new THREE.MeshStandardMaterial({
        color: t.trim, roughness: 0.5, emissive: t.trimGlow ? t.trim : 0x000000, emissiveIntensity: t.trimGlow ? 1.4 : 0,
      }),
      panel: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: t.panel, emissiveIntensity: 1.2 }),
      bench: new THREE.MeshStandardMaterial({ color: t.bench, roughness: 0.55 }),
    };
    this.mats.set(id, m);
    return m;
  }

  private clear(): void {
    this.hangables.length = 0;
    this.boxes = [];
    this.circles = [];
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  private add(mesh: THREE.Object3D): void {
    this.group.add(mesh);
  }

  private buildCell(r: RoomCell): void {
    const cx = r.x * CELL;
    const cz = r.z * CELL;
    const m = this.materials(r.theme);
    const t = THEMES[r.theme];

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), m.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.userData.floor = true;
    this.add(floor);
    this.hangables.push(floor);

    if (!this.roofless) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), m.ceil);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(cx, HEIGHT, cz);
      this.add(ceil);

      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 3.2), m.panel);
      panel.position.set(cx, HEIGHT - 0.03, cz);
      this.add(panel);
    }

    if (this.lights) {
      const light = new THREE.PointLight(t.light, t.lightIntensity, 18, 1.6);
      light.position.set(cx, HEIGHT - 0.6, cz);
      this.add(light);
    }

    if (r.theme === 'futuristic') {
      const inset = CELL / 2 - 0.25;
      for (const [w, d, x, z] of [
        [CELL - 0.5, 0.05, cx, cz - inset], [CELL - 0.5, 0.05, cx, cz + inset],
        [0.05, CELL - 0.5, cx - inset, cz], [0.05, CELL - 0.5, cx + inset, cz],
      ] as const) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), m.trim);
        strip.position.set(x, HEIGHT - 0.12, z);
        this.add(strip);
      }
    }

    // Banc central
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.6), m.bench);
    seat.position.y = 0.45;
    bench.add(seat);
    for (const sx of [-1.05, 1.05]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.5), this.shared.metal);
      leg.position.set(sx, 0.21, 0);
      bench.add(leg);
    }
    bench.position.set(cx, 0, cz);
    this.add(bench);
    this.boxes.push({ minX: cx - 1.2 - PLAYER_R, maxX: cx + 1.2 + PLAYER_R, minZ: cz - 0.3 - PLAYER_R, maxZ: cz + 0.3 + PLAYER_R });

    // Plantes dans deux coins
    for (const [sx, sz] of [[-1, -1], [1, 1]] as const) {
      const px = cx + sx * (CELL / 2 - 0.9);
      const pz = cz + sz * (CELL / 2 - 0.9);
      const plant = new THREE.Group();
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.5, 14), this.shared.pot);
      pot.position.y = 0.25;
      plant.add(pot);
      for (let k = 0; k < 5; k++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + Math.random() * 0.12, 0), this.shared.leaf);
        leaf.position.set((Math.random() - 0.5) * 0.35, 0.75 + k * 0.17, (Math.random() - 0.5) * 0.35);
        leaf.scale.y = 1.3;
        plant.add(leaf);
      }
      plant.position.set(px, 0, pz);
      this.add(plant);
      this.circles.push({ x: px, z: pz, r: 0.4 });
    }
  }

  private buildBoundary(kind: 'v' | 'h', ax: number, az: number): void {
    const A = this.get(ax, az);
    const B = kind === 'v' ? this.get(ax + 1, az) : this.get(ax, az + 1);
    if (!A && !B) return;
    const tA = (A ?? B)!.theme;
    const tB = (B ?? A)!.theme;
    const line = kind === 'v' ? ax * CELL + CELL / 2 : az * CELL + CELL / 2;
    const center = kind === 'v' ? az * CELL : ax * CELL;
    const half = CELL / 2;
    const seg = (a0: number, a1: number, y0: number, y1: number, noHang: boolean) =>
      this.addWall(kind, line, center, a0, a1, y0, y1, tA, tB, !!A, !!B, noHang);

    if ((A && B) || `${kind}:${ax}:${az}` === this.entranceKey) {
      seg(-half, -DOOR_HALF, 0, HEIGHT, false);
      seg(DOOR_HALF, half, 0, HEIGHT, false);
      seg(-DOOR_HALF, DOOR_HALF, DOOR_H, HEIGHT, true);
      this.addDoorFrame(kind, line, center, this.materials(tA).trim);
    } else {
      seg(-half, half, 0, HEIGHT, false);
    }
  }

  private addWall(
    kind: 'v' | 'h', line: number, center: number, a0: number, a1: number, y0: number, y1: number,
    tA: ThemeId, tB: ThemeId, hasA: boolean, hasB: boolean, noHang: boolean,
  ): void {
    const len = a1 - a0;
    const h = y1 - y0;
    const mid = center + (a0 + a1) / 2;
    const mA = this.materials(tA);
    const mB = this.materials(tB);
    const unit = THEMES[tA].wallUnit;
    let mesh: THREE.Mesh;
    if (kind === 'v') {
      const geo = new THREE.BoxGeometry(WALL_T, h, len);
      worldUV(geo, WALL_T, h, len, unit);
      mesh = new THREE.Mesh(geo, [mB.wall, mA.wall, mA.trim, mA.trim, mA.trim, mA.trim]);
      mesh.position.set(line, y0 + h / 2, mid);
    } else {
      const geo = new THREE.BoxGeometry(len, h, WALL_T);
      worldUV(geo, len, h, WALL_T, unit);
      mesh = new THREE.Mesh(geo, [mA.trim, mA.trim, mA.trim, mA.trim, mB.wall, mA.wall]);
      mesh.position.set(mid, y0 + h / 2, line);
    }
    mesh.userData.noHang = noHang;
    this.add(mesh);
    this.hangables.push(mesh);

    if (y0 !== 0) return;
    // Plinthes du côté de chaque salle existante
    for (const [has, sign, mat] of [[hasA, -1, mA.trim], [hasB, 1, mB.trim]] as const) {
      if (!has) continue;
      const off = sign * (WALL_T / 2 + 0.015);
      const base = new THREE.Mesh(
        kind === 'v' ? new THREE.BoxGeometry(0.03, 0.14, len) : new THREE.BoxGeometry(len, 0.14, 0.03),
        mat,
      );
      if (kind === 'v') base.position.set(line + off, 0.07, mid);
      else base.position.set(mid, 0.07, line + off);
      this.add(base);
    }
  }

  private addDoorFrame(kind: 'v' | 'h', line: number, center: number, mat: THREE.Material): void {
    const T = WALL_T + 0.1;
    const parts: Array<[number, number, number, number, number]> = [
      // along, y, longueur (le long du mur), hauteur, épaisseur
      [-(DOOR_HALF + 0.07), DOOR_H / 2, 0.14, DOOR_H, T],
      [DOOR_HALF + 0.07, DOOR_H / 2, 0.14, DOOR_H, T],
      [0, DOOR_H + 0.07, 2 * DOOR_HALF + 0.28, 0.14, T],
    ];
    for (const [along, y, l, h, th] of parts) {
      const m = new THREE.Mesh(kind === 'v' ? new THREE.BoxGeometry(th, h, l) : new THREE.BoxGeometry(l, h, th), mat);
      if (kind === 'v') m.position.set(line, y, center + along);
      else m.position.set(center + along, y, line);
      this.add(m);
    }
  }
}
