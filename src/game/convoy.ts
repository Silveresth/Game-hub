import * as THREE from 'three';
import { Label } from './labels';
import { CATALOG, artUrl, money, perSec, incomeOf, work } from './catalog';
import { ROAD } from './district';
import type { ConvoyItem } from './api';

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
export function artTexture(id: string): THREE.Texture {
  let t = textures.get(id);
  if (!t) {
    t = loader.load(artUrl(id));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(id, t);
  }
  return t;
}

const FRAME_COLORS: Record<string, number> = {
  normal: 0x1f2430,
  dore: 0xffd36b,
  diamant: 0x9fe3ff,
};

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25, ...extra });

/**
 * Camion Cyber-Transport moderne de haute sécurité pour les chefs-d'œuvre :
 * - Carrosserie aérodynamique futuriste noir mat & inserts néon
 * - Vitrine blindée transparente illuminée de l'intérieur
 * - Toile visible en grand format des deux côtés (recto / verso) avec éclairage LED
 * - Gyrophares et feux avant LED
 */
class Truck {
  readonly root = new THREE.Group();
  readonly label = new Label(1.35, 640, 240);
  item: ConvoyItem | null = null;
  private canvasFront: THREE.Mesh;
  private canvasBack: THREE.Mesh;
  private frame: THREE.Mesh;
  private beam: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private sirens: THREE.Mesh[] = [];

  constructor() {
    // 1. Châssis & carrosserie cartoony Low-Poly Cyberpunk
    const bodyMat = std(0x111422, { roughness: 0.35, metalness: 0.4 });
    const trimMat = std(0x00e5ff, { roughness: 0.2, metalness: 0.7, emissive: 0x006688, emissiveIntensity: 0.4 });
    const chromeMat = std(0xffd600, { roughness: 0.1, metalness: 0.9 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x00e5ff,
      transmission: 0.85,
      opacity: 0.9,
      transparent: true,
      roughness: 0.1,
      metalness: 0.1,
      ior: 1.5,
    });

    // Cabine profilée
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.1, 2.5), bodyMat);
    cab.position.set(2.5, 1.45, 0);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 2.3), trimMat);
    cabRoof.position.set(2.4, 2.55, 0);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 2.5), chromeMat);
    bumper.position.set(3.8, 0.7, 0);

    // Pare-brise et vitres latérales
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 2.2), glassMat);
    windshield.position.set(3.76, 1.8, 0);
    windshield.rotation.z = -0.25;

    // Feux avant LED
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0x90e0ef });
    for (const sz of [-0.95, 0.95]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.45), headlightMat);
      hl.position.set(3.78, 1.1, sz);
      this.root.add(hl);
    }

    // Plateau renforcé
    const bed = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.45, 2.6), bodyMat);
    bed.position.set(-1.0, 0.75, 0);
    const bedRails = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.15, 2.65), trimMat);
    bedRails.position.set(-1.0, 1.0, 0);

    this.root.add(cab, cabRoof, bumper, windshield, bed, bedRails);

    // Roues modernes avec jantes alliage
    const tireMat = std(0x111317, { roughness: 0.85 });
    const rimMat = chromeMat;
    for (const [x, z] of [[2.4, 1.25], [2.4, -1.25], [-0.8, 1.25], [-0.8, -1.25], [-2.4, 1.25], [-2.4, -1.25]]) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(x, 0.48, z);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.38, 20), tireMat);
      tire.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 10), rimMat);
      rim.rotation.x = Math.PI / 2;
      wheelGroup.add(tire, rim);
      this.wheels.push(tire);
      this.root.add(wheelGroup);
    }

    // Vitrine de sécurité centrale transparente pour exposer l'œuvre
    const caseGlass = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6, 1.6), glassMat);
    caseGlass.position.set(-1.0, 2.3, 0);
    const caseFrame = new THREE.Mesh(
      new THREE.BoxGeometry(3.68, 2.68, 1.68),
      std(0x202430, { wireframe: true }),
    );
    caseFrame.position.set(-1.0, 2.3, 0);
    this.root.add(caseGlass, caseFrame);

    // Cadre central de l'œuvre
    this.frame = new THREE.Mesh(
      new THREE.BoxGeometry(3.1, 2.2, 0.14),
      std(0x1a1c24, { metalness: 0.8, roughness: 0.2 }),
    );
    this.frame.position.set(-1.0, 2.25, 0);

    // Toile recto (visible côté sud / joueurs)
    this.canvasFront = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.9),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }),
    );
    this.canvasFront.position.set(-1.0, 2.25, 0.08);

    // Toile verso (visible côté nord)
    this.canvasBack = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.9),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }),
    );
    this.canvasBack.rotation.y = Math.PI;
    this.canvasBack.position.set(-1.0, 2.25, -0.08);

    // Spots d'éclairage LED braqués sur la toile
    const ledStripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ledStripTop = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 0.3), ledStripMat);
    ledStripTop.position.set(-1.0, 3.4, 0);
    this.root.add(this.frame, this.canvasFront, this.canvasBack, ledStripTop);

    // Gyrophares sur la cabine (bleu / orange)
    for (const [sz, col] of [[-0.6, 0x00d2ff], [0.6, 0xff7b00]] as const) {
      const siren = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 12), new THREE.MeshBasicMaterial({ color: col }));
      siren.position.set(2.4, 2.75, sz);
      this.sirens.push(siren);
      this.root.add(siren);
    }

    // Faisceau vertical volumétrique moderne pour les œuvres rares
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 16, 24, 1, true),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.position.set(-1.0, 8.5, 0);
    this.root.add(this.beam);

    // Étiquette au-dessus du convoi
    this.label.sprite.position.set(-1.0, 4.6, 0);
    this.root.add(this.label.sprite);

    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.beam && m !== caseGlass) m.castShadow = true;
    });
  }

  setItem(item: ConvoyItem): void {
    this.item = item;
    const rar = CATALOG.rarities[item.rarity];
    const tex = artTexture(item.workId);

    const matFront = this.canvasFront.material as THREE.MeshStandardMaterial;
    matFront.map = tex;
    matFront.needsUpdate = true;

    const matBack = this.canvasBack.material as THREE.MeshStandardMaterial;
    matBack.map = tex;
    matBack.needsUpdate = true;

    const frameMat = this.frame.material as THREE.MeshStandardMaterial;
    frameMat.color.setHex(FRAME_COLORS[item.frame] ?? 0xffd36b);
    frameMat.metalness = item.frame === 'normal' ? 0.3 : 0.95;
    frameMat.roughness = item.frame === 'normal' ? 0.4 : 0.15;

    const special = item.frame !== 'normal' || item.rarity !== 'commun';
    this.beam.visible = special;
    (this.beam.material as THREE.MeshBasicMaterial).color.set(
      item.frame === 'diamant' ? '#9fe3ff' : item.frame === 'dore' ? '#ffd36b' : rar.color,
    );

    this.refreshLabel();
  }

  refreshLabel(): void {
    const item = this.item!;
    const wk = work(item.workId);
    const rar = CATALOG.rarities[item.rarity];
    const tag = item.frame === 'normal' ? rar.label : `${rar.label} · ${CATALOG.frames[item.frame].label}`;
    const visible = !item.sold;
    this.canvasFront.visible = this.canvasBack.visible = this.frame.visible = visible;

    this.label.update(
      item.sold
        ? [{ text: 'ACQUIS', color: '#ff6b6b', size: 72, weight: 900 }]
        : [
            { text: wk.title.length > 28 ? `${wk.title.slice(0, 26)}…` : wk.title, color: '#ffffff', size: 48, weight: 900 },
            { text: tag.toUpperCase(), color: item.frame === 'normal' ? rar.color : '#ffd36b', size: 38, weight: 800 },
            { text: `${money(item.price)} pièces  ·  +${perSec(incomeOf(item.workId, item.frame))}/s`, color: '#7dff9a', size: 44, weight: 900 },
          ],
      { bg: 'rgba(10,14,24,0.92)', border: item.sold ? '#ff6b6b' : rar.color },
    );
  }

  /** Position monde de l'œuvre sur le plateau. */
  artworkWorld(): THREE.Vector3 {
    return this.canvasFront.getWorldPosition(new THREE.Vector3());
  }

  spinWheels(dist: number): void {
    for (const w of this.wheels) w.rotation.y = -dist / 0.48;
  }
}

export class Convoy {
  private trucks: Truck[] = [];
  private items: ConvoyItem[] = [];
  private travelMs = 40_000;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 3; i++) {
      const t = new Truck();
      t.root.visible = false;
      scene.add(t.root);
      this.trucks.push(t);
    }
  }

  setItems(items: ConvoyItem[], travelMs: number): void {
    this.items = items;
    this.travelMs = travelMs;
    for (const t of this.trucks) t.item = null;
  }

  markSold(window: number): void {
    const item = this.items.find((i) => i.window === window);
    if (item) item.sold = true;
    for (const t of this.trucks) if (t.item?.window === window) t.refreshLabel();
  }

  /** Prochain chef-d'œuvre qui va apparaître sur la route. */
  upcoming(now: number): ConvoyItem | undefined {
    return this.items.find((i) => !i.sold && i.startsAt > now);
  }

  /** Avance les camions selon l'heure du serveur. */
  update(now: number): void {
    const active = this.items.filter((i) => now >= i.startsAt && now <= i.startsAt + this.travelMs);
    for (const t of this.trucks) if (t.item && !active.some((i) => i.window === t.item!.window)) t.item = null;
    for (const item of active) {
      let t = this.trucks.find((x) => x.item?.window === item.window);
      if (!t) {
        t = this.trucks.find((x) => !x.item);
        if (!t) continue;
        t.setItem(item);
      }
      const k = (now - item.startsAt) / this.travelMs;
      const x = ROAD.x0 + (ROAD.x1 - ROAD.x0) * k;
      t.root.position.set(x, 0, ROAD.z);
      t.spinWheels(x);
    }
    for (const t of this.trucks) t.root.visible = !!t.item;
  }

  /** Camion le plus proche (avec une œuvre encore à vendre). */
  nearest(pos: THREE.Vector3, maxDist: number): { truck: Truck; item: ConvoyItem; dist: number } | null {
    let best: { truck: Truck; item: ConvoyItem; dist: number } | null = null;
    for (const t of this.trucks) {
      if (!t.item || t.item.sold) continue;
      const p = t.artworkWorld();
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < maxDist && (!best || d < best.dist)) best = { truck: t, item: t.item, dist: d };
    }
    return best;
  }
}
