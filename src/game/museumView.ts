import * as THREE from 'three';
import { MuseumBuilding, type ThemeId } from './Room';
import { Artifact } from './Artifact';
import { Label } from './labels';
import { CATALOG, artUrl, incomeOf, money, perSec, work, type FrameId } from './catalog';
import { CELL, FLOOR_H, ROOMS, STAIRS, inside, isStatueSlot, slotFloor, slotWorld, toWorld, type Plot } from './layout';
import { disposeMerged, mergeStatic } from './merge';
import type { Box, Circle } from './district';
import type { PlayerState, PublicSecurity } from './api';

/** Ce que le serveur publie d'un musée (le vôtre ou celui d'un autre joueur). */
export interface MuseumSnap {
  id: string;
  name: string;
  color: string;
  country?: string;
  level: number;
  rooms: number;
  artworks: Array<{ uid: string; workId: string; frame: FrameId; slot: number | null; carried?: boolean; repro?: boolean }>;
  /** Prix du billet d'entrée (musées des autres). */
  ticket?: number;
  value: number;
  shielded: boolean;
  immuneUntil: number;
  sec: PublicSecurity;
  themes?: Record<string, string>;
  /** Nombre d'étages (1 = rez-de-chaussée seul). */
  floors?: number;
}

const NO_SEC: PublicSecurity = { guards: 0, cameras: false, lasers: false, generator: false, insured: false, vitrines: {}, dog: false };

interface Shown {
  art: Artifact;
  label: Label;
  uid: string;
  slot: number;
  workId: string;
  frame: FrameId;
  repro?: boolean;
}

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function signTexture(lines: Array<[string, string, number]>, bg = '#10131d'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#e8b64c';
  g.lineWidth = 10;
  g.strokeRect(10, 10, 1004, 236);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, [, , size]) => s + size * 1.25, 0);
  let y = (256 - total) / 2;
  for (const [text, color, size] of lines) {
    g.font = `800 ${size}px Georgia, 'Times New Roman', serif`;
    g.fillStyle = color;
    g.fillText(text, 512, y + (size * 1.25) / 2, 960);
    y += size * 1.25;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Un musée sur une parcelle du quartier : façade à son nom, salles, œuvres avec leur revenu.
 * Pour votre musée seulement : caisse, panneau d'agrandissement et verrou.
 */
export class MuseumView {
  owner: MuseumSnap | null = null;
  online = false;
  lockedUntil = 0;
  lockReadyAt = 0;
  /** uid masqué pendant l'envol d'une œuvre achetée. */
  hiddenUid: string | null = null;

  private building: MuseumBuilding | null = null;
  private rooms = 0;
  private shown = new Map<string, Shown>();
  private facade = new THREE.Group();
  private signMesh: THREE.Mesh | null = null;
  private signKey = '';
  private status = new Label(1.0, 640, 200);
  private barrier: THREE.Mesh;
  private wallColliders: { boxes: Box[]; circles: Circle[] } = { boxes: [], circles: [] };
  private facadeCircles: Circle[] = [];
  private wallOcc: THREE.Object3D[] = [];
  private facadeOcc: THREE.Object3D[] = [];

  // étages (phase 5)
  floors = 1;
  /** Étage le plus haut affiché : les étages au-dessus du joueur sont masqués quand il est dedans. */
  private cut = 99;
  private uppers: MuseumBuilding[] = [];
  private upperColliders: Array<{ boxes: Box[]; circles: Circle[] }> = [];
  private upperOcc: THREE.Object3D[][] = [];
  private stairs = new THREE.Group();
  private stairSegs: THREE.Object3D[] = [];
  // versions fusionnées (performance)
  private groundMerged: THREE.Group | null = null;
  private upperMerged: THREE.Group[] = [];
  private facadeMerged: THREE.Group | null = null;
  /** Musée loin de la caméra : ses œuvres ne sont pas dessinées. */
  private far = false;

  /** Volumes qui peuvent masquer le joueur (pour la caméra), étages masqués exclus. */
  get occluders(): THREE.Object3D[] {
    return [...this.wallOcc, ...this.upperOcc.filter((_, i) => i + 1 <= this.cut).flat(), ...this.facadeOcc];
  }

  // votre musée
  readonly registerPos: THREE.Vector3;
  readonly signPos: THREE.Vector3;
  readonly lockPos: THREE.Vector3;
  private registerLabel?: Label;
  private signLabel?: Label;
  private lockLabel?: Label;
  private rings: THREE.Mesh[] = [];
  private cashStack?: THREE.Mesh;
  private extras = new THREE.Group();
  private themesSig = '';

  constructor(private scene: THREE.Scene, readonly plot: Plot, readonly own: boolean) {
    scene.add(this.facade, this.extras);
    this.registerPos = toWorld(plot, -3.4, 0, -3.4);
    this.signPos = toWorld(plot, 3.4, 0, -3.4);
    this.lockPos = toWorld(plot, 0, 0, -4.2);

    // laser du verrou, dans l'encadrement de la porte d'entrée
    this.barrier = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3.2, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a3d, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.barrier.position.copy(toWorld(plot, 0, 1.6, -6));
    this.barrier.visible = false;
    scene.add(this.barrier);

    this.status.sprite.position.copy(toWorld(plot, 0, 11.6, -8.6));
    scene.add(this.status.sprite);
    if (own) this.buildOwnExtras();
    this.buildEmptyLot();
  }

  // ---------------------------------------------------------------- données

  /** Votre musée : état complet venu de l'API. */
  applyOwn(state: PlayerState): void {
    this.setOwner(
      {
        id: state.id, name: state.name, color: state.color, country: state.country, level: state.level, rooms: state.rooms, floors: state.floors,
        artworks: state.artworks, value: state.value, shielded: state.shielded, immuneUntil: state.immuneUntil, sec: state.sec,
        themes: state.roomThemes ?? {},
      },
      true,
    );
    const newFloor = state.next && state.next.floors > state.floors;
    this.signLabel?.update(
      state.next
        ? [{ text: newFloor ? `${state.next.floors - 1 === 1 ? '1er' : `${state.next.floors - 1}e`} ÉTAGE` : 'AGRANDIR', color: '#9fb6ff', size: 52, weight: 900 }, { text: `${money(state.next.cost)} · ${state.next.slots} places`, color: '#fff', size: 44, weight: 800 }]
        : [{ text: 'MUSÉE AU MAXIMUM', color: '#9fb6ff', size: 48, weight: 900 }],
      { bg: 'rgba(12,16,32,.82)', border: '#6f8dff' },
    );
  }

  setOwner(snap: MuseumSnap | null, online: boolean): void {
    const ownerChanged = (snap?.id ?? null) !== (this.owner?.id ?? null);
    this.owner = snap;
    this.online = online;
    if (!snap) {
      this.clearArtworks();
      this.building?.group.removeFromParent();
      this.building = null;
      disposeMerged(this.groundMerged);
      this.groundMerged = null;
      this.rooms = 0;
      this.wallOcc = [];
      this.wallColliders = { boxes: [], circles: [] };
      this.buildFloors(1);
      this.buildSecurity();
      this.buildEmptyLot();
      this.refreshStatus(Date.now());
      return;
    }
    if (ownerChanged || !this.signMesh) this.buildFacade();
    const flag = CATALOG.countries?.find((c) => c.code === snap.country)?.flag;
    this.setSignName(flag ? `${flag} ${snap.name}` : snap.name);
    if (!this.building) {
      this.building = new MuseumBuilding(this.scene);
      this.building.group.position.set(this.plot.x, 0.02, this.plot.z);
      this.building.group.scale.z = this.plot.f; // miroir pour la rangée nord
    }
    const sig = JSON.stringify(snap.themes ?? {});
    const themesChanged = sig !== this.themesSig;
    this.themesSig = sig;
    const getTheme = (index: number, defaultTheme: ThemeId) => (snap.themes?.[index] as ThemeId) ?? defaultTheme;

    if (snap.rooms !== this.rooms || ownerChanged || themesChanged) {
      this.rooms = snap.rooms;
      this.building.build(ROOMS.slice(0, snap.rooms).map(([x, z, theme], k) => ({ x, z, theme: getTheme(k, theme) })), { entrance: { x: 0, z: 0, side: 'n' }, roofless: true, lights: false });
      this.building.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = !m.userData.floor;
          m.receiveShadow = true;
        }
      });
      this.wallOcc = this.building.hangables.filter((m) => !m.userData.floor);
      this.wallColliders = this.building.worldColliders();
      // performance : un maillage par matériau (les originaux restent pour la caméra et les collisions)
      disposeMerged(this.groundMerged);
      this.groundMerged = mergeStatic(this.building.group);
      this.scene.add(this.groundMerged);
    }
    if ((snap.floors ?? 1) !== this.floors || ownerChanged || themesChanged) this.buildFloors(snap.floors ?? 1);
    this.syncArtworks(snap.artworks.filter((a) => a.slot !== null && !a.carried) as Array<Shown & { slot: number }>);
    this.buildSecurity();
    this.refreshStatus(Date.now());
  }

  // ---------------------------------------------------------------- étages (phase 5)

  /** Étages supérieurs (9 salles chacun) et escalier en colimaçon dans la salle d'entrée. */
  private buildFloors(n: number): void {
    for (const b of this.uppers) b.group.removeFromParent();
    this.upperMerged.forEach(disposeMerged);
    this.upperMerged = [];
    this.uppers = [];
    this.upperColliders = [];
    this.upperOcc = [];
    for (const c of [...this.stairs.children]) {
      this.stairs.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.stairSegs = [];
    this.floors = n;
    this.cut = 99;
    for (let f = 1; f < n; f++) {
      if (f === 3) {
        // Étage 3 : Toit-terrasse panoramique pour les statues (pas de cloisons intérieures, balustrades sur le pourtour)
        const tg = new THREE.Group();
        tg.position.set(this.plot.x, f * FLOOR_H + 0.02, this.plot.z);
        tg.scale.z = this.plot.f;
        // Sol en dalles de pierre claire de 36×36 m
        const floorMat = std(0xd8d4cc, { roughness: 0.65 });
        const terraceFloor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), floorMat);
        terraceFloor.rotation.x = -Math.PI / 2;
        terraceFloor.position.set(0, 0, 12);
        terraceFloor.receiveShadow = true;
        terraceFloor.userData.floor = true;
        tg.add(terraceFloor);

        // Balustrades extérieures (hauteur 1.1 m)
        const railMat = std(0xeeeeee, { roughness: 0.4 });
        const boxes: Box[] = [];
        const addRail = (w: number, d: number, x: number, z: number) => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), railMat);
          rail.position.set(x, 0.55, z);
          rail.castShadow = true;
          rail.receiveShadow = true;
          tg.add(rail);
          const wMin = toWorld(this.plot, x - w / 2, 0, z - d / 2);
          const wMax = toWorld(this.plot, x + w / 2, 0, z + d / 2);
          boxes.push({ minX: Math.min(wMin.x, wMax.x), maxX: Math.max(wMin.x, wMax.x), minZ: Math.min(wMin.z, wMax.z), maxZ: Math.max(wMin.z, wMax.z) });
        };
        // 4 côtés de la terrasse
        addRail(36, 0.4, 0, -6); // Nord
        addRail(36, 0.4, 0, 30); // Sud
        addRail(0.4, 36, -18, 12); // Ouest
        addRail(0.4, 36, 18, 12); // Est

        this.scene.add(tg);
        this.upperMerged.push(tg);
        this.upperColliders.push({ boxes, circles: [] });
        this.upperOcc.push([]);
        continue;
      }
      const b = new MuseumBuilding(this.scene);
      b.group.position.set(this.plot.x, f * FLOOR_H + 0.02, this.plot.z);
      b.group.scale.z = this.plot.f;
      const getUpperTheme = (k: number, def: ThemeId) => (this.owner?.themes?.[f * 9 + k] as ThemeId) ?? def;
      b.build(ROOMS.map(([x, z, theme], k) => ({ x, z, theme: getUpperTheme(k, theme) })), { roofless: true, lights: false });
      b.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = !m.userData.floor;
          m.receiveShadow = true;
        }
      });
      this.uppers.push(b);
      this.upperColliders.push(b.worldColliders());
      this.upperOcc.push(b.hangables.filter((m) => !m.userData.floor));
      const merged = mergeStatic(b.group);
      this.scene.add(merged);
      this.upperMerged.push(merged);
    }
    if (n < 2) return;
    if (!this.stairs.parent) this.scene.add(this.stairs);
    const base = toWorld(this.plot, STAIRS[0], 0, STAIRS[1]);
    this.stairs.position.copy(base);
    const wood = std(0x6b4a2e, { roughness: 0.5 });
    const metal = std(0x2b2f38, { metalness: 0.7, roughness: 0.35 });
    const STEPS = 16;
    for (let f = 0; f < n - 1; f++) {
      const seg = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, FLOOR_H, 10), metal);
      pole.position.y = f * FLOOR_H + FLOOR_H / 2;
      seg.add(pole);
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.42), wood);
        step.position.set(Math.cos(a) * 0.62, f * FLOOR_H + ((i + 1) * FLOOR_H) / STEPS, Math.sin(a) * 0.62);
        step.rotation.y = -a;
        seg.add(step);
      }
      seg.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      // 17 marches + poteau → 2 maillages
      const merged = mergeStatic(seg);
      seg.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.stairs.add(merged);
      this.stairSegs.push(merged);
    }
    // repère doré au pied de l'escalier, à chaque étage
    for (let f = 0; f < n; f++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.6, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = f * FLOOR_H + 0.05;
      ring.userData.floor = f;
      this.stairs.add(ring);
    }
    this.stairs.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  }

  /**
   * Masque les étages au-dessus de `cut` (le joueur est dedans, à cet étage) ; 99 = tout afficher.
   * Sans toit, la caméra regarde par-dessus les murs : il faut retirer les étages du dessus.
   */
  get currentCut(): number {
    return this.cut;
  }

  setCut(cut: number): void {
    if (cut === this.cut) return;
    this.cut = cut;
    this.uppers.forEach((b, i) => (b.group.visible = i + 1 <= cut));
    this.upperMerged.forEach((g, i) => (g.visible = i + 1 <= cut));
    this.stairSegs.forEach((s, f) => (s.visible = f <= cut));
    for (const o of this.stairs.children) if (o.userData.floor !== undefined) o.visible = o.userData.floor <= cut;
    this.secFloors.forEach((g, f) => (g.visible = f <= cut));
  }

  /** Le joueur se tient au pied de l'escalier (à n'importe quel étage). */
  nearStairs(p: THREE.Vector3): boolean {
    if (this.floors < 2) return false;
    const s = toWorld(this.plot, STAIRS[0], 0, STAIRS[1]);
    return Math.hypot(p.x - s.x, p.z - s.z) < 1.4;
  }

  // ---------------------------------------------------------------- sécurité (phase 3)

  jamUntil = 0;
  powerAt = 0;
  powerUntil = 0;
  private secGroup = new THREE.Group();
  private secKey = '';
  private leds: THREE.Mesh[] = [];
  private beams: THREE.Object3D[] = [];
  private secCircles: Circle[] = [];
  private genLed: THREE.Mesh | null = null;
  private secFloors: THREE.Group[] = [];

  get sec(): PublicSecurity {
    return this.owner?.sec ?? NO_SEC;
  }

  setPower(jamUntil: number, powerAt: number, powerUntil: number): void {
    this.jamUntil = jamUntil;
    this.powerAt = powerAt;
    this.powerUntil = powerUntil;
  }

  powerOut(now: number): boolean {
    return this.powerAt <= now && now < this.powerUntil;
  }

  camerasOn(now: number): boolean {
    return this.sec.cameras && this.jamUntil <= now && !this.powerOut(now);
  }

  lasersOn(now: number): boolean {
    return this.sec.lasers && !this.powerOut(now);
  }

  /** Multiplicateur de la vitrine posée sur un emplacement (1 sans vitrine). */
  vitrineMult(slot: number): number {
    const lvl = this.sec.vitrines[slot] ?? 0;
    return lvl ? CATALOG.security.vitrine.levels[lvl - 1].mult : 1;
  }

  /** Caméras dans un coin de chaque salle, lasers à l'entrée, générateur dehors, vitrines devant les œuvres. */
  private buildSecurity(): void {
    const s = this.owner ? this.sec : NO_SEC;
    const occupied = new Set(this.occupiedSlots());
    const vit = Object.entries(s.vitrines).filter(([slot]) => occupied.has(Number(slot)));
    const key = JSON.stringify([s.cameras, s.lasers, s.generator, vit, this.rooms, this.floors]);
    if (key === this.secKey) return;
    this.secKey = key;
    for (const c of [...this.secGroup.children]) {
      this.secGroup.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.leds = [];
    this.beams = [];
    this.secCircles = [];
    this.genLed = null;
    // un groupe par étage, masqué avec l'étage
    this.secFloors = Array.from({ length: this.floors }, (_, f) => {
      const g = new THREE.Group();
      g.visible = f <= this.cut;
      this.secGroup.add(g);
      return g;
    });
    if (!this.secGroup.parent) this.scene.add(this.secGroup);
    if (!this.owner) return;
    const dark = std(0x1b1e26, { metalness: 0.6, roughness: 0.35 });
    const half = CELL / 2 - 0.35;
    if (s.cameras) {
      for (let f = 0; f < this.floors; f++) for (const [i, j] of f === 0 ? this.roomCells : ROOMS.map(([a, b]) => [a, b] as [number, number])) {
        const cam = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.6), std(0xe9e6df, { roughness: 0.4 }));
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14), dark);
        lens.rotation.x = Math.PI / 2;
        lens.position.z = 0.33;
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a3d }));
        led.position.set(0.1, 0.1, 0.3);
        cam.add(body, lens, led);
        this.leds.push(led);
        const p = toWorld(this.plot, i * CELL - half, 4.4 + f * FLOOR_H, j * CELL - half);
        cam.position.copy(p);
        // vise le centre de la salle, légèrement vers le bas
        cam.lookAt(toWorld(this.plot, i * CELL, 0.5 + f * FLOOR_H, j * CELL));
        this.secFloors[f].add(cam);
      }
    }
    if (s.lasers) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2a3d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      for (const y of [0.45, 1.05, 1.65]) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.0, 6), mat);
        beam.rotation.z = Math.PI / 2;
        beam.position.copy(toWorld(this.plot, 0, y, -CELL / 2 - 0.15));
        this.secGroup.add(beam);
        this.beams.push(beam);
      }
      for (const sx of [-1.55, 1.55]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), dark);
        post.position.copy(toWorld(this.plot, sx, 0.95, -CELL / 2 - 0.15));
        this.secGroup.add(post);
      }
    }
    if (s.generator) {
      const gen = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.0), std(0x3f7d3a, { roughness: 0.5 }));
      box.position.y = 0.55;
      const grill = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.04), dark);
      grill.position.set(0, 0.6, this.plot.f === 1 ? -0.52 : 0.52);
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7dff9a }));
      bolt.position.y = 1.2;
      gen.add(box, grill, bolt);
      this.genLed = bolt;
      const p = toWorld(this.plot, 11.4, 0, -7.6);
      gen.position.copy(p);
      this.secGroup.add(gen);
      this.secCircles.push({ x: p.x, z: p.z, r: 0.95 });
    }
    for (const [slot, lvl] of vit) {
      const { p, ry, normal, floor } = this.slotWorld(Number(slot));
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 1.75, 0.5),
        new THREE.MeshStandardMaterial({ color: lvl >= 2 ? 0x9fd0ff : 0xe8f4ff, transparent: true, opacity: lvl >= 2 ? 0.28 : 0.18, roughness: 0.05, metalness: 0.3, depthWrite: false }),
      );
      glass.position.copy(p).addScaledVector(normal, 0.3);
      glass.rotation.y = ry;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: lvl >= 2 ? 0x6fb4ff : 0xdfe9f5 }));
      edges.position.copy(glass.position);
      edges.rotation.copy(glass.rotation);
      (this.secFloors[floor] ?? this.secGroup).add(glass, edges);
    }
  }

  private updateSecurity(t: number, now: number): void {
    const cams = this.camerasOn(now);
    const jammed = this.sec.cameras && this.jamUntil > now;
    const out = this.powerOut(now);
    for (const led of this.leds) led.visible = jammed ? Math.sin(t * 25) > 0 : cams && Math.sin(t * 4) > -0.3;
    // voyant du générateur : vert, clignote en orange pendant un sabotage
    if (this.genLed) {
      const sabotage = this.powerUntil > now && this.powerAt > now;
      (this.genLed.material as THREE.MeshBasicMaterial).color.setHex(sabotage ? (Math.sin(t * 20) > 0 ? 0xff9f43 : 0x332211) : out ? 0x333333 : 0x7dff9a);
    }
    const lasers = this.lasersOn(now);
    for (const b of this.beams) b.visible = lasers;
  }

  setLock(lockedUntil: number, lockReadyAt: number): void {
    this.lockedUntil = lockedUntil;
    this.lockReadyAt = lockReadyAt;
  }

  isLocked(now: number): boolean {
    return this.lockedUntil > now;
  }

  // ---------------------------------------------------------------- géométrie

  slotWorld(slot: number) {
    return slotWorld(this.plot, slot);
  }

  /** Dans les salles du musée, à l'étage donné. */
  contains(p: THREE.Vector3, floor = 0): boolean {
    return !!this.owner && inside(this.plot, this.rooms, p, floor, this.floors);
  }

  /** Index de la salle (0..totalRooms-1) dans laquelle se trouve une position monde à cet étage, ou null si dehors. */
  roomIndexOf(p: THREE.Vector3, floor = 0): number | null {
    if (!this.contains(p, floor) || floor >= 3) return null; // le toit-terrasse n'a pas de pièces murales à décorer
    const lx = p.x - this.plot.x;
    const lz = (p.z - this.plot.z) * this.plot.f;
    const i = Math.round(lx / CELL);
    const j = Math.round(lz / CELL);
    const n = floor > 0 ? ROOMS.length : this.rooms;
    const idx = ROOMS.slice(0, n).findIndex(([a, b]) => a === i && b === j);
    return idx >= 0 ? floor * 9 + idx : null;
  }

  get roomCells(): Array<[number, number]> {
    return ROOMS.slice(0, this.rooms).map(([i, j]) => [i, j]);
  }

  /** Coordonnées locales de salle (cellule) → monde, pour les trajets des visiteurs. */
  cellWorld(i: number, j: number, dx = 0, dz = 0): THREE.Vector3 {
    return toWorld(this.plot, i * CELL + dx, 0, j * CELL + dz);
  }

  /** Obstacles pour le joueur ; le laser du verrou bloque tout le monde sauf le propriétaire. */
  colliders(forOwner: boolean, now: number, floor = 0): { boxes: Box[]; circles: Circle[] } {
    const sp = toWorld(this.plot, STAIRS[0], 0, STAIRS[1]);
    const pole: Circle[] = this.floors > 1 ? [{ x: sp.x, z: sp.z, r: 0.35 }] : [];
    // Statues au sol (obstacles circulaires)
    const statueCircles: Circle[] = [];
    for (const s of this.shown.values()) {
      if (slotFloor(s.slot) === floor && (isStatueSlot(s.slot) || work(s.workId).kind === 'statue')) {
        const { p } = this.slotWorld(s.slot);
        statueCircles.push({ x: p.x, z: p.z, r: 0.7 });
      }
    }
    if (floor > 0) {
      // à l'étage : seulement les murs de cet étage (et le poteau de l'escalier + statues)
      const u = this.upperColliders[floor - 1];
      return u ? { boxes: [...u.boxes], circles: [...u.circles, ...pole, ...statueCircles] } : { boxes: [], circles: statueCircles };
    }
    const boxes = [...this.wallColliders.boxes];
    const circles = [...this.wallColliders.circles, ...this.facadeCircles, ...this.secCircles, ...pole, ...statueCircles];
    if (this.own) circles.push({ x: this.registerPos.x, z: this.registerPos.z - this.plot.f * 1.2, r: 0.85 }, { x: this.signPos.x, z: this.signPos.z - this.plot.f * 1.2, r: 0.35 });
    if (!forOwner && this.isLocked(now)) {
      const d = toWorld(this.plot, 0, 0, -6);
      boxes.push({ minX: d.x - 1.6, maxX: d.x + 1.6, minZ: d.z - 0.3, maxZ: d.z + 0.3 });
    }
    return { boxes, circles };
  }

  /** Œuvre exposée la plus proche (debout devant elle). */
  nearestArtwork(pos: THREE.Vector3, maxDist: number, floor = 0): { uid: string; workId: string; frame: FrameId; slot: number; repro: boolean } | null {
    let best: Shown | null = null;
    let bd = maxDist;
    for (const s of this.shown.values()) {
      if (slotFloor(s.slot) !== floor) continue;
      const { p, normal, isStatue } = this.slotWorld(s.slot);
      const isSculpt = isStatue || work(s.workId).kind === 'statue';
      const d = isSculpt
        ? p.clone().setY(0).distanceTo(pos.clone().setY(0))
        : p.clone().addScaledVector(normal, 1.2).setY(0).distanceTo(pos.clone().setY(0));
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { uid: best.uid, workId: best.workId, frame: best.frame, slot: best.slot, repro: !!best.repro } : null;
  }

  occupiedSlots(): number[] {
    return [...this.shown.values()].map((s) => s.slot);
  }

  /** Emplacement libre ou occupé le plus proche (pour la réorganisation). */
  nearestSlot(pos: THREE.Vector3, maxDist: number, floor = 0, totalSlots = 232): number | null {
    let best: number | null = null;
    let bd = maxDist;
    for (let slot = 0; slot < totalSlots; slot++) {
      if (slotFloor(slot) !== floor) continue;
      const { p, normal, isStatue } = this.slotWorld(slot);
      const d = isStatue
        ? p.clone().setY(0).distanceTo(pos.clone().setY(0))
        : p.clone().addScaledVector(normal, 1.2).setY(0).distanceTo(pos.clone().setY(0));
      if (d < bd) {
        bd = d;
        best = slot;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- rendu

  private clearArtworks(): void {
    for (const s of this.shown.values()) this.dropShown(s);
    this.shown.clear();
  }

  private dropShown(s: Shown): void {
    s.art.dispose();
    s.art.group.removeFromParent();
    s.label.sprite.removeFromParent();
    s.label.dispose();
  }

  private syncArtworks(list: Array<{ uid: string; workId: string; frame: FrameId; slot: number; repro?: boolean }>): void {
    const wanted = new Map(list.map((a) => [a.uid, a]));
    for (const [uid, s] of this.shown) {
      const w = wanted.get(uid);
      if (!w || w.slot !== s.slot) {
        this.dropShown(s);
        this.shown.delete(uid);
      }
    }
    for (const a of wanted.values()) {
      if (this.shown.has(a.uid) || slotFloor(a.slot) >= this.floors) continue;
      const { p, ry, normal, isStatue } = this.slotWorld(a.slot);
      const wk = work(a.workId);
      const isSculpt = isStatue || wk.kind === 'statue';
      const art = new Artifact(
        {
          id: a.uid,
          type: isSculpt ? 'SCULPTURE' : 'PHOTO',
          title: wk.title.length > 28 ? `${wk.title.slice(0, 26)}…` : wk.title,
          url: artUrl(a.workId),
          position: p.toArray() as [number, number, number],
          rotation: [0, ry, 0],
          scale: a.frame === 'normal' ? 1.05 : 1.15,
          spot: true,
          frameStyle: a.frame,
          form: wk.form ?? 'knot',
          material: wk.mat ?? (a.frame === 'dore' ? 'gold' : a.frame === 'diamant' ? 'glass' : 'marble'),
        },
        null as unknown as THREE.AudioListener,
      );
      this.scene.add(art.group);
      const rar = CATALOG.rarities[wk.rarity];
      const label = new Label(0.62, 512, 150);
      label.update(
        a.repro
          ? [{ text: CATALOG.repro.label.toUpperCase(), color: '#cfc9bb', size: 50, weight: 900 }, { text: 'sans valeur · décorative', color: '#a9a49a', size: 38, weight: 700 }]
          : [
              { text: `+${perSec(incomeOf(a.workId, a.frame))} /s`, color: '#7dff9a', size: 58, weight: 900 },
              { text: a.frame === 'normal' ? rar.label : `${rar.label} · ${CATALOG.frames[a.frame].label}`, color: a.frame === 'normal' ? rar.color : '#ffd36b', size: 40, weight: 800 },
            ],
      );
      const labelY = isSculpt ? 2.5 + slotFloor(a.slot) * FLOOR_H : 3.75 + slotFloor(a.slot) * FLOOR_H;
      label.sprite.position.copy(p).addScaledVector(normal, isSculpt ? 0.2 : 1.1).setY(labelY);
      this.scene.add(label.sprite);
      this.shown.set(a.uid, { art, label, uid: a.uid, slot: a.slot, workId: a.workId, frame: a.frame, repro: a.repro });
    }
  }

  private setSignName(name: string): void {
    if (!this.signMesh || this.signKey === name) return;
    this.signKey = name;
    const m = this.signMesh.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.map = signTexture([['MUSÉE', '#e8b64c', 54], [name.toUpperCase(), '#fff4dc', 92]]);
    m.emissiveMap = m.map;
    m.needsUpdate = true;
  }

  private clearFacade(): void {
    disposeMerged(this.facadeMerged);
    this.facadeMerged = null;
    for (const c of [...this.facade.children]) {
      this.facade.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.signMesh = null;
    this.signKey = '';
    this.facadeCircles = [];
    this.facadeOcc = [];
  }

  /** Parcelle libre : un simple panneau. */
  private buildEmptyLot(): void {
    if (this.owner) return;
    this.clearFacade();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), std(0x6b4a2e));
    post.position.copy(toWorld(this.plot, 0, 1.2, -9));
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 1),
      new THREE.MeshStandardMaterial({ map: signTexture([['PARCELLE LIBRE', '#e8b64c', 80], ['un rival peut s’installer ici', '#cfc9bb', 46]]) }),
    );
    board.position.copy(toWorld(this.plot, 0, 2.6, -9.12));
    board.rotation.y = this.plot.f === 1 ? Math.PI : 0;
    this.facade.add(post, board);
  }

  /** Façade classique monumentale : colonnades de marbre, fronton orné, toit en pente noble et entrée majestueuse. */
  private buildFacade(): void {
    this.clearFacade();
    const stoneMat = std(0xe8e2d4, { roughness: 0.75 });
    const stoneDark = std(0xd4cdbd, { roughness: 0.8 });
    const goldTrim = std(0xe8b64c, { roughness: 0.25, metalness: 0.8 });
    const roofSlate = std(0x363e4b, { roughness: 0.7 });

    const d = -this.plot.f; // direction de la place sur l'axe z
    const wallZ = this.plot.z + d * 6.1;
    const colZ = wallZ + d * 2.8;
    const x0 = this.plot.x;

    // Colonnes cannelées classiques en pierre de taille avec base et chapiteaux sculptés dorés
    for (const sx of [-9, -5.4, -1.8, 1.8, 5.4, 9]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 6.4, 16), stoneMat);
      col.position.set(x0 + sx, 3.2, colZ);
      const ringBot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.3), stoneDark);
      ringBot.position.set(x0 + sx, 0.2, colZ);
      const ringTop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.3), goldTrim);
      ringTop.position.set(x0 + sx, 6.2, colZ);
      this.facade.add(col, ringBot, ringTop);
      this.facadeCircles.push({ x: x0 + sx, z: colZ, r: 0.6 });
    }

    // Portique et mur de fondation avec grande arche d'entrée
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(20, 6.2, 0.8), stoneDark);
    backWall.position.set(x0, 3.1, wallZ + d * 0.4);
    this.facade.add(backWall);

    // Entablement monumental en pierre
    const entab = new THREE.Mesh(new THREE.BoxGeometry(22, 1.4, 4.2), stoneMat);
    entab.position.set(x0, 7.1, wallZ + d * 1.6);

    // Fronton triangulaire majestueux avec médaillon doré
    const pediment = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 8.5, 2.8, 3, 1), stoneMat);
    pediment.rotation.set(Math.PI / 2, 0, Math.PI);
    pediment.scale.set(1.4, 0.5, 1);
    pediment.position.set(x0, 9.2, wallZ + d * 3.4);

    const goldMedallion = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 20), goldTrim);
    goldMedallion.rotation.x = Math.PI / 2;
    goldMedallion.position.set(x0, 8.6, wallZ + d * 3.55);

    // Toit classique en ardoise sur la façade
    const roof = new THREE.Mesh(new THREE.BoxGeometry(22.6, 0.6, 4.6), roofSlate);
    roof.position.set(x0, 7.9, wallZ + d * 1.6);

    // Grand perron et marches monumentales d'accueil
    const steps = new THREE.Mesh(new THREE.BoxGeometry(22.0, 0.4, 5.6), stoneDark);
    steps.position.set(x0, 0.2, wallZ + d * 2.5);

    this.facade.add(entab, pediment, goldMedallion, roof, steps);

    // Tapis de marbre noble menant vers la galerie
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 16),
      std(0xeae4d8, { roughness: 0.6 }),
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(x0, 0.02, wallZ + d * 8.4);

    const borderGoldL = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 16), goldTrim);
    borderGoldL.rotation.x = -Math.PI / 2;
    borderGoldL.position.set(x0 - 2.1, 0.025, wallZ + d * 8.4);

    const borderGoldR = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 16), goldTrim);
    borderGoldR.rotation.x = -Math.PI / 2;
    borderGoldR.position.set(x0 + 2.1, 0.025, wallZ + d * 8.4);

    this.facade.add(runway, borderGoldL, borderGoldR);

    this.facade.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== runway) m.castShadow = m.receiveShadow = true;
    });

    // Enseigne classique prestigieuse au nom du musée
    this.signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(8.0, 1.8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    );
    this.signMesh.position.set(x0, 7.1, wallZ + d * 3.75);
    this.signMesh.rotation.y = d === -1 ? Math.PI : 0;
    this.facade.add(this.signMesh);

    this.facadeOcc = [entab, roof, backWall];
    this.facadeMerged = mergeStatic(this.facade);
    this.scene.add(this.facadeMerged);
  }

  private buildOwnExtras(): void {
    const f = this.plot.f;
    // caisse
    const reg = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.8), std(0x2b1d14, { roughness: 0.4 }));
    counter.position.y = 0.5;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.9), std(0xe9e2d0, { roughness: 0.25 }));
    top.position.y = 1.04;
    this.cashStack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 24), new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25 }));
    this.cashStack.position.y = 1.28;
    reg.add(counter, top, this.cashStack);
    reg.position.copy(this.registerPos).add(new THREE.Vector3(0, 0, -f * 1.2));
    // panneau d'agrandissement
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), std(0x23262e, { metalness: 0.6 }));
    post.position.y = 0.8;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.08), std(0x3d6bff, { emissive: 0x1d3aa8, emissiveIntensity: 0.5 }));
    board.position.y = 1.8;
    sign.add(post, board);
    sign.position.copy(this.signPos).add(new THREE.Vector3(0, 0, -f * 1.2));
    this.extras.add(reg, sign);
    this.extras.traverse((o) => ((o as THREE.Mesh).castShadow = true));

    const ring = (at: THREE.Vector3, color: number) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.copy(at).setY(0.04);
      this.extras.add(r);
      this.rings.push(r);
    };
    ring(this.registerPos, 0xffc83d);
    ring(this.signPos, 0x6f8dff);
    ring(this.lockPos, 0xff4d6d);
    this.registerLabel = new Label(0.9, 640, 200);
    this.registerLabel.sprite.position.copy(this.registerPos).add(new THREE.Vector3(0, 2.7, -f * 1.2));
    this.signLabel = new Label(0.85, 640, 200);
    this.signLabel.sprite.position.copy(this.signPos).add(new THREE.Vector3(0, 2.9, -f * 1.2));
    this.lockLabel = new Label(0.7, 640, 160);
    this.lockLabel.sprite.position.copy(this.lockPos).add(new THREE.Vector3(0, 1.4, 0));
    this.extras.add(this.registerLabel.sprite, this.signLabel.sprite, this.lockLabel.sprite);
  }

  setRegister(cash: number, cap: number, t: number): void {
    if (!this.registerLabel || !this.cashStack) return;
    const full = cash >= cap - 0.5;
    this.registerLabel.update(
      [
        { text: full ? 'CAISSE PLEINE !' : 'CAISSE', color: full ? '#ff6b6b' : '#ffd36b', size: 46, weight: 900 },
        { text: `${money(cash)} / ${money(cap)}`, color: '#fff', size: 52, weight: 900 },
      ],
      { bg: 'rgba(20,14,4,.82)', border: full ? '#ff6b6b' : '#ffc83d' },
    );
    const k = Math.min(1, cash / Math.max(1, cap));
    this.cashStack.scale.set(1, 0.2 + k * 2.4, 1);
    this.cashStack.position.y = 1.08 + (0.4 * this.cashStack.scale.y) / 2;
    const pulse = 0.55 + Math.sin(t * 4) * 0.2;
    (this.rings[0].material as THREE.MeshBasicMaterial).opacity = cash >= 1 ? pulse + 0.2 : 0.3;
    (this.rings[1].material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 3) * 0.15;
  }

  /** Résumé des protections, lisible de loin par les voleurs. */
  protectionText(now: number): string {
    const s = this.sec;
    const parts: string[] = [];
    if (s.guards) parts.push(`👮 ${s.guards} garde${s.guards > 1 ? 's' : ''}`);
    if (s.cameras) parts.push(this.jamUntil > now ? '📷 brouillées' : this.powerOut(now) ? '📷 éteintes' : '📷 caméras');
    if (s.lasers) parts.push(this.powerOut(now) ? '⚡ courant coupé' : '🔴 lasers');
    if (s.generator) parts.push('🔋');
    if (Object.keys(s.vitrines).length) parts.push('🔲 vitrines');
    if (s.dog) parts.push('🐕 chien');
    return parts.length ? parts.join(' · ') : '';
  }

  private statusKey = '';
  private refreshStatus(now: number): void {
    const o = this.owner;
    let lines: Array<{ text: string; color?: string; size?: number; weight?: number }>;
    if (this.own) lines = [{ text: 'VOTRE MUSÉE', color: '#ffd36b', size: 66, weight: 900 }];
    else if (!o) lines = [];
    else {
      const tag = o.shielded ? '🛡 Bouclier débutant'
        : o.immuneUntil > now ? `🛡 Protégé ${Math.ceil((o.immuneUntil - now) / 60_000)} min`
        : this.isLocked(now) ? '🔒 Verrouillé'
        : this.online ? '● Propriétaire présent' : '☾ Propriétaire absent';
      lines = [
        { text: o.name, color: '#fff', size: 52, weight: 900 },
        { text: `${money(o.value)} · ${tag}`, color: o.shielded || o.immuneUntil > now ? '#9fe3ff' : this.online ? '#7dff9a' : '#ffb3c1', size: 40, weight: 800 },
      ];
      const prot = this.protectionText(now);
      if (prot) lines.push({ text: prot, color: '#ffd36b', size: 34, weight: 800 });
    }
    const key = JSON.stringify(lines);
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status.sprite.visible = lines.length > 0;
    if (lines.length) this.status.update(lines, { bg: 'rgba(8,10,18,.75)', border: this.own ? '#ffd36b' : 'rgba(255,255,255,.3)' });
  }

  update(t: number, dt: number, now: number, cam?: THREE.Vector3): void {
    // loin de la caméra, les œuvres (cachées derrière les murs) ne sont pas dessinées
    if (cam) this.far = Math.hypot(cam.x - this.plot.x, cam.z - (this.plot.z + this.plot.f * CELL)) > 75;
    for (const [uid, s] of this.shown) {
      s.art.group.visible = s.label.sprite.visible = !this.far && uid !== this.hiddenUid && slotFloor(s.slot) <= this.cut;
      if (!this.far) s.art.update(t, dt);
    }
    const locked = this.isLocked(now);
    this.barrier.visible = locked;
    if (locked) (this.barrier.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 10) * 0.12;
    if (this.own && this.lockLabel) {
      const lines = locked
        ? [{ text: `🔒 VERROUILLÉ · ${Math.ceil((this.lockedUntil - now) / 1000)} s`, color: '#ff8fa0', size: 50, weight: 900 }]
        : now < this.lockReadyAt
          ? [{ text: `Verrou : recharge ${Math.ceil((this.lockReadyAt - now) / 1000)} s`, color: '#cfc9bb', size: 44, weight: 800 }]
          : [{ text: 'VERROU · E', color: '#ff8fa0', size: 50, weight: 900 }];
      this.lockLabel.update(lines, { bg: 'rgba(30,6,12,.75)', border: '#ff4d6d' });
      (this.rings[2].material as THREE.MeshBasicMaterial).opacity = locked ? 0.9 : now < this.lockReadyAt ? 0.25 : 0.6;
    }
    this.updateSecurity(t, now);
    this.status.sprite.position.y = 11.6 + Math.sin(t * 2) * 0.2;
    this.refreshStatus(now);
  }
}
