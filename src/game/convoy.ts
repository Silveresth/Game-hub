import * as THREE from 'three';
import { textureAnisotropy } from './quality';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Label } from './labels';
import { CATALOG, RARITY_STARS, artUrl, frameTag, money, perSec, incomeOf, work } from './catalog';
import { ROAD } from './district';
import type { ConvoyItem } from './api';
import { artTextureByUrl, aspectOf, setRainbow } from './textures';
import { mergeStatic } from './merge';

/** Texture d'une œuvre du catalogue (cache partagé avec les tableaux des musées, voir textures.ts). */
export function artTexture(id: string): THREE.Texture {
  return artTextureByUrl(artUrl(id)).tex;
}

const FRAME_COLORS: Record<string, number> = {
  normal: 0x5b3a22, // noyer : se détache sur le fond ardoise de la vitrine
  dore: 0xffd36b,
  diamant: 0x9fe3ff,
  arcenciel: 0xff5ea8,
  givre: 0xc8f2ff,
  hante: 0x7b45c9,
  fleuri: 0xff9ecb,
  solaire: 0xffa526,
  festif: 0xff4f9a,
};

// ------------------------------------------------------------------ dimensions (m), camion orienté vers +x

/** Centre de l'œuvre exposée et taille maximale de la toile (cadre et passe-partout en plus). */
const ART = { x: -0.9, y: 2.66, maxW: 4.8, maxH: 2.5 };
const MAT = 0.06; // passe-partout autour de la toile
const BAR = 0.15; // largeur des baguettes du cadre
const WHEEL_R = 0.5;
const AXLES = [3.45, -2.35, -3.4]; // essieu avant (cabine) et double essieu arrière
const WHEEL_Z = 1.08;
const ROOF_TOP = 4.62;
const MAX_TRUCKS = 10;

// ------------------------------------------------------------------ pièces partagées par tous les camions

interface Kit {
  /** Carrosserie fixe fusionnée : un maillage par matériau, partagé (clone) par chaque camion. */
  body: THREE.Group;
  spokeGeo: THREE.BufferGeometry;
  spokeMat: THREE.Material;
  accentGeo: THREE.BufferGeometry;
  glassGeo: THREE.BufferGeometry;
  glassMat: THREE.Material;
  sirenGeo: THREE.BufferGeometry;
  sirenBlue: THREE.MeshBasicMaterial;
  sirenAmber: THREE.MeshBasicMaterial;
  unitBox: THREE.BoxGeometry;
  unitPlane: THREE.PlaneGeometry;
  passeMat: THREE.Material;
  beamGeo: THREE.BufferGeometry;
  /** Peinture de la carrosserie (remplacée sur chaque camion par une peinture à la couleur de la rareté). */
  pearl: THREE.Material;
}

/** Peinture des camions selon la rareté de l'œuvre transportée : on sait ce qui arrive avant de lire l'étiquette. */
const BODY_PAINT: Record<string, number> = { commun: 0xeef1f5, rare: 0x3f8fff, epique: 0xa45bff, legendaire: 0xffa81f, mythique: 0xff3b4e };
/** Peinture des camions qui portent une mutation saisonnière. */
const MUTATION_PAINT: Record<string, number> = { givre: 0x9fe8ff, hante: 0x5b2a9e, fleuri: 0xff8fc8, solaire: 0xffb52e, festif: 0xff4f9a };

let kitCache: Kit | null = null;

/** Bandeau « CONVOI D'ŒUVRES D'ART » sur les flancs du toit (fond transparent, découpé par alphaTest). */
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = textureAnisotropy;
  const draw = () => {
    g.clearRect(0, 0, 1024, 64);
    g.fillStyle = '#c9a24e';
    g.fillRect(24, 30, 112, 4);
    g.fillRect(888, 30, 112, 4);
    for (const x of [156, 868]) {
      g.beginPath();
      g.moveTo(x, 18);
      g.lineTo(x + 13, 32);
      g.lineTo(x, 46);
      g.lineTo(x - 13, 32);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#1e232c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "700 38px 'Cinzel', Georgia, 'Times New Roman', serif";
    (g as unknown as { letterSpacing: string }).letterSpacing = '5px';
    g.fillText('CONVOI D’ŒUVRES D’ART', 512, 34, 660);
    tex.needsUpdate = true;
  };
  draw();
  // la police du jeu peut arriver après le premier dessin
  void document.fonts?.ready.then(draw);
  return tex;
}

function buildKit(): Kit {
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x1e232c, roughness: 0.5, metalness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dee5, roughness: 0.12, metalness: 1 });
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x223448, roughness: 0.08, metalness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25e, roughness: 0.25, metalness: 0.95 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.92 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x252d3b, roughness: 0.92 }); // fond de la vitrine
  const light = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  const sign = new THREE.MeshStandardMaterial({ map: signTexture(), alphaTest: 0.5, roughness: 0.4 });

  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const rbox = (w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number) =>
    add(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z);
  const both = (fn: (s: number) => void) => [1, -1].forEach(fn);

  // --- cabine haute, lignes arrondies, grand pare-brise sombre
  rbox(1.9, 2.6, 2.5, 0.3, pearl, 3.45, 2.275, 0);
  box(0.08, 1.2, 2.0, darkGlass, 4.39, 2.55, 0); // pare-brise
  both((s) => {
    rbox(1.05, 1.0, 0.06, 0.03, darkGlass, 3.57, 2.62, s * 1.245); // vitres latérales
    box(1.3, 0.05, 0.02, gold, 3.45, 1.75, s * 1.258); // filet doré
    box(0.06, 0.05, 0.35, graphite, 4.2, 2.75, s * 1.4); // bras de rétroviseur
    rbox(0.12, 0.42, 0.2, 0.04, graphite, 4.24, 2.6, s * 1.6); // rétroviseur
    box(0.05, 0.16, 0.5, light, 4.415, 1.35, s * 0.78); // phares
  });
  box(0.04, 0.07, 2.0, light, 4.41, 1.58, 0); // bandeau LED avant
  box(0.03, 0.18, 0.18, gold, 4.41, 1.78, 0); // emblème
  rbox(0.4, 0.55, 2.55, 0.12, graphite, 4.3, 0.75, 0); // pare-chocs
  rbox(0.45, 0.1, 1.7, 0.04, graphite, 3.85, 3.625, 0); // support de la rampe lumineuse
  rbox(1.25, 0.75, 2.4, 0.3, pearl, 2.9, 3.85, 0); // déflecteur de toit (rejoint la hauteur de la vitrine)

  // --- châssis, roues, jupes
  box(7.6, 0.32, 1.5, graphite, 0, 0.72, 0);
  for (const x of AXLES) {
    both((s) => {
      add(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.4, 28).rotateX(Math.PI / 2), tire, x, WHEEL_R, s * WHEEL_Z);
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.42, 24).rotateX(Math.PI / 2), chrome, x, WHEEL_R, s * WHEEL_Z);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.44, 12).rotateX(Math.PI / 2), graphite, x, WHEEL_R, s * WHEEL_Z);
    });
  }
  both((s) => {
    box(3.95, 0.42, 0.06, graphite, 0.225, 0.72, s * 1.25); // jupe latérale
    box(0.04, 0.4, 0.42, graphite, -3.98, 0.55, s * WHEEL_Z); // bavette
    box(0.04, 0.12, 0.5, red, -4.12, 0.92, s * 0.85); // feux arrière
    box(0.04, 2.6, 0.08, red, -4.115, 2.65, s * 1.18); // feux verticaux
  });
  rbox(0.25, 0.3, 2.4, 0.06, graphite, -4.15, 0.6, 0); // pare-chocs arrière

  // --- vitrine : plateau bas, cloisons avant / arrière, toit ; vitres sur les deux flancs (à part, transparentes)
  rbox(6.4, 0.36, 2.6, 0.08, pearl, -0.9, 0.92, 0); // dessus à 1,10 m (le haut des roues reste caché dedans)
  rbox(0.22, 3.1, 2.6, 0.06, pearl, 2.19, 2.65, 0);
  rbox(0.22, 3.1, 2.6, 0.06, pearl, -3.99, 2.65, 0);
  rbox(6.5, 0.42, 2.7, 0.08, pearl, -0.9, 4.41, 0);
  box(5.0, 0.03, 1.4, light, -0.9, 4.185, 0); // éclairage de galerie au plafond
  box(5.6, 0.08, 0.5, graphite, -0.9, 1.14, 0); // socle
  box(5.4, 2.95, 0.12, slate, ART.x, ART.y, 0); // cloison d'exposition (l'œuvre est montée des deux côtés)
  const signGeo = new THREE.PlaneGeometry(3.8, 0.24);
  add(signGeo, sign, -0.9, 4.41, 1.358);
  add(signGeo.clone().rotateY(Math.PI), sign, -0.9, 4.41, -1.358);

  const body = mergeStatic(g);
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());

  // rayons des jantes : seule pièce qui tourne (une par essieu)
  const spokes: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) spokes.push(new THREE.BoxGeometry(0.56, 0.07, 0.43).rotateZ((k * Math.PI) / 3).translate(0, 0, s * WHEEL_Z));

  // bandes LED à la couleur de la rareté : cadre lumineux de la vitrine et liseré sous les jupes
  const accents: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    accents.push(
      new THREE.BoxGeometry(5.9, 0.05, 0.05).translate(-0.9, 4.175, s * 1.2),
      new THREE.BoxGeometry(5.9, 0.04, 0.05).translate(-0.9, 1.12, s * 1.2),
      new THREE.BoxGeometry(0.05, 3.0, 0.05).translate(2.055, 2.65, s * 1.2),
      new THREE.BoxGeometry(0.05, 3.0, 0.05).translate(-3.855, 2.65, s * 1.2),
      new THREE.BoxGeometry(3.95, 0.04, 0.03).translate(0.225, 0.52, s * 1.285),
    );
  }

  const glass = [
    new THREE.PlaneGeometry(5.96, 3.1).translate(-0.9, 2.65, 1.25),
    new THREE.PlaneGeometry(5.96, 3.1).rotateY(Math.PI).translate(-0.9, 2.65, -1.25),
  ];

  return {
    body,
    spokeGeo: mergeGeometries(spokes, false)!,
    spokeMat: graphite,
    accentGeo: mergeGeometries(accents, false)!,
    // verre extra-clair : un léger reflet, mais l'œuvre reste parfaitement lisible
    glassGeo: mergeGeometries(glass, false)!,
    glassMat: new THREE.MeshStandardMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.1, roughness: 0.02, metalness: 0.9, depthWrite: false }),
    sirenGeo: new RoundedBoxGeometry(0.36, 0.14, 0.7, 2, 0.05),
    sirenBlue: new THREE.MeshBasicMaterial({ color: 0x39b6ff, toneMapped: false }),
    sirenAmber: new THREE.MeshBasicMaterial({ color: 0xffa424, toneMapped: false }),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    unitPlane: new THREE.PlaneGeometry(1, 1),
    passeMat: new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9 }),
    beamGeo: new THREE.CylinderGeometry(1.5, 1.5, 16, 24, 1, true),
    pearl,
  };
}

const kit = (): Kit => (kitCache ??= buildKit());

/**
 * Camion de transport d'œuvres d'art, moderne et épuré :
 * - cabine haute blanc nacré, pare-brise sombre, filets dorés, rampe lumineuse bleu / ambre ;
 * - vitrine vitrée des deux côtés : l'œuvre, en grand (jusqu'à 4,8 × 2,5 m), encadrée avec passe-partout,
 *   est montée recto / verso sur une cloison ardoise et se voit depuis les deux trottoirs ;
 * - bandes LED à la couleur de la rareté (ou du cadre) autour de la vitrine.
 */
class Truck {
  readonly root = new THREE.Group();
  readonly label = new Label(1.35, 640, 240);
  item: ConvoyItem | null = null;
  private display = new THREE.Group();
  private canvasFront: THREE.Mesh;
  private canvasBack: THREE.Mesh;
  private canvasMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  private passe: THREE.Mesh;
  private bars: THREE.Mesh[] = [];
  private frameMat = new THREE.MeshStandardMaterial({ color: FRAME_COLORS.normal, roughness: 0.4, metalness: 0.3 });
  private accentMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private beam: THREE.Mesh;
  private spokes: THREE.Mesh[] = [];
  /** Faisceau et LED qui changent de couleur (cadre arc-en-ciel). */
  rainbowBeam = false;

  /** Peinture propre à ce camion (couleur de la rareté transportée). */
  private paint: THREE.MeshPhysicalMaterial;

  constructor() {
    const k = kit();
    const body = k.body.clone();
    this.paint = (k.pearl as THREE.MeshPhysicalMaterial).clone();
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === k.pearl) m.material = this.paint;
    });
    this.root.add(body);
    for (const x of AXLES) {
      const s = new THREE.Mesh(k.spokeGeo, k.spokeMat);
      s.position.set(x, WHEEL_R, 0);
      this.spokes.push(s);
      this.root.add(s);
    }
    this.root.add(new THREE.Mesh(k.accentGeo, this.accentMat));
    const glass = new THREE.Mesh(k.glassGeo, k.glassMat);
    glass.renderOrder = 2;
    this.root.add(glass);
    for (const [z, mat] of [[0.36, k.sirenBlue], [-0.36, k.sirenAmber]] as const) {
      const siren = new THREE.Mesh(k.sirenGeo, mat);
      siren.position.set(3.85, 3.745, z);
      this.root.add(siren);
    }

    // l'œuvre : cadre en 4 baguettes, passe-partout, toile recto (trottoir sud) et verso (trottoir nord)
    this.display.position.set(ART.x, ART.y, 0);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(k.unitBox, this.frameMat);
      b.castShadow = true;
      this.bars.push(b);
      this.display.add(b);
    }
    this.passe = new THREE.Mesh(k.unitBox, k.passeMat);
    this.canvasFront = new THREE.Mesh(k.unitPlane, this.canvasMat);
    this.canvasFront.position.z = 0.104;
    this.canvasBack = new THREE.Mesh(k.unitPlane, this.canvasMat);
    this.canvasBack.rotation.y = Math.PI;
    this.canvasBack.position.z = -0.104;
    this.display.add(this.passe, this.canvasFront, this.canvasBack);
    this.root.add(this.display);
    this.fit(4 / 3);

    // faisceau vertical au-dessus du toit pour les pièces remarquables
    this.beam = new THREE.Mesh(
      k.beamGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.position.set(ART.x, ROOF_TOP + 8, 0);
    this.root.add(this.beam);

    this.label.sprite.position.set(ART.x, 5.6, 0);
    this.root.add(this.label.sprite);
  }

  /** Proportions réelles de l'œuvre (aucune toile étirée), le plus grand possible dans la vitrine. */
  private fit(aspect: number): void {
    const w = Math.min(ART.maxW, ART.maxH * aspect);
    const h = w / aspect;
    const mw = w + 2 * MAT;
    const mh = h + 2 * MAT;
    this.canvasFront.scale.set(w, h, 1);
    this.canvasBack.scale.set(w, h, 1);
    this.passe.scale.set(mw, mh, 0.2);
    const [top, bottom, left, right] = this.bars;
    top.scale.set(mw + 2 * BAR, BAR, 0.26);
    top.position.set(0, mh / 2 + BAR / 2, 0);
    bottom.scale.copy(top.scale);
    bottom.position.set(0, -(mh / 2 + BAR / 2), 0);
    left.scale.set(BAR, mh, 0.26);
    left.position.set(-(mw / 2 + BAR / 2), 0, 0);
    right.scale.copy(left.scale);
    right.position.set(mw / 2 + BAR / 2, 0, 0);
  }

  setItem(item: ConvoyItem): void {
    this.item = item;
    const rar = CATALOG.rarities[item.rarity];

    // toile éclairée « de l'intérieur » : bien lisible même à l'ombre ou côté opposé au soleil
    const entry = artTextureByUrl(artUrl(item.workId));
    this.canvasMat.map = this.canvasMat.emissiveMap = entry.tex;
    this.canvasMat.emissive.setHex(0xffffff);
    this.canvasMat.emissiveIntensity = 0.22;
    this.canvasMat.needsUpdate = true;
    const apply = (t: THREE.Texture) => {
      if (this.item === item) this.fit(aspectOf(t));
    };
    if ((entry.tex.image as HTMLImageElement | undefined)?.complete) apply(entry.tex);
    else {
      this.fit(4 / 3);
      void entry.ready.then(apply);
    }

    setRainbow(this.frameMat, item.frame === 'arcenciel');
    if (item.frame !== 'arcenciel') {
      this.frameMat.color.setHex(FRAME_COLORS[item.frame] ?? 0xffd36b);
      this.frameMat.metalness = item.frame === 'normal' ? 0.15 : 0.95;
      this.frameMat.roughness = item.frame === 'normal' ? 0.55 : 0.15;
    }

    const fr = CATALOG.frames[item.frame];
    const color = item.frame !== 'normal' ? fr.color : rar.color;
    this.accentMat.color.set(color);
    this.rainbowBeam = item.frame === 'arcenciel';
    (this.beam.material as THREE.MeshBasicMaterial).color.set(color);
    // carrosserie : couleur de la rareté (mutation saisonnière : sa couleur ; arc-en-ciel : peinture animée)
    setRainbow(this.paint, item.frame === 'arcenciel');
    if (item.frame !== 'arcenciel') {
      this.paint.color.setHex(MUTATION_PAINT[item.frame] ?? BODY_PAINT[item.rarity] ?? BODY_PAINT.commun);
      this.paint.metalness = item.frame === 'dore' || item.frame === 'diamant' ? 0.6 : 0.15;
    }

    this.refreshLabel();
  }

  refreshLabel(): void {
    const item = this.item!;
    const wk = work(item.workId);
    const rar = CATALOG.rarities[item.rarity];
    const EVENT_TAG: Record<string, string> = { golden: '✨ HEURE DORÉE', rare: '💎 TRÉSORS RARES', soldes: '🏷 SOLDES −30 %', arcenciel: '🌈 CONVOI ARC-EN-CIEL' };
    const fr = CATALOG.frames[item.frame];
    this.display.visible = !item.sold;
    this.beam.visible = !item.sold && (item.frame !== 'normal' || item.rarity !== 'commun');

    this.label.update(
      item.sold
        ? [{ text: 'ACQUIS', color: '#ff6b6b', size: 72, weight: 900 }]
        : [
            { text: wk.title.length > 28 ? `${wk.title.slice(0, 26)}…` : wk.title, color: '#ffffff', size: 46, weight: 900 },
            // rareté et mutation dans des pastilles colorées : lisibles de loin
            { text: `${RARITY_STARS[item.rarity]} ${rar.label.toUpperCase()}${item.frame !== 'normal' ? `  ·  ${frameTag(item.frame).toUpperCase()}` : ''}`, color: '#ffffff', size: 36, weight: 900, pill: item.frame !== 'normal' && item.rarity === 'commun' ? fr.color : rar.color },
            ...(item.event && EVENT_TAG[item.event] ? [{ text: EVENT_TAG[item.event], color: '#ffd36b', size: 32, weight: 800 }] : []),
            { text: `${money(item.price)} pièces  ·  +${perSec(incomeOf(item.workId, item.frame))}/s`, color: '#7dff9a', size: 42, weight: 900 },
          ],
      { bg: 'rgba(10,14,24,0.92)', border: item.sold ? '#ff6b6b' : item.frame !== 'normal' ? fr.color : rar.color },
    );
  }

  /** Position monde de l'œuvre sur le plateau. */
  artworkWorld(): THREE.Vector3 {
    return this.canvasFront.getWorldPosition(new THREE.Vector3());
  }

  spinWheels(dist: number): void {
    for (const s of this.spokes) s.rotation.z = -dist / WHEEL_R;
    if (this.rainbowBeam) {
      const hue = ((performance.now() / 1000) * 0.25) % 1;
      (this.beam.material as THREE.MeshBasicMaterial).color.setHSL(hue, 0.9, 0.6);
      this.accentMat.color.setHSL(hue, 0.9, 0.6);
    }
  }
}

export class Convoy {
  private trucks: Truck[] = [];
  private items: ConvoyItem[] = [];
  private travelMs = 40_000;
  /** Camions achetés ici : une liste du serveur demandée juste avant l'achat ne doit pas les remettre en vente. */
  private soldWindows = new Set<number>();

  constructor(private scene: THREE.Scene) {
    // un camion part toutes les quelques secondes : plusieurs sont sur la route en même temps (le parc grandit au besoin)
    for (let i = 0; i < 6; i++) this.spawn();
  }

  private spawn(): Truck | undefined {
    if (this.trucks.length >= MAX_TRUCKS) return undefined;
    const t = new Truck();
    t.root.visible = false;
    this.scene.add(t.root);
    this.trucks.push(t);
    return t;
  }

  setItems(items: ConvoyItem[], travelMs: number): void {
    const oldest = Math.min(...items.map((i) => i.window));
    for (const w of this.soldWindows) if (w < oldest) this.soldWindows.delete(w);
    for (const i of items) if (this.soldWindows.has(i.window)) i.sold = true;
    this.items = items;
    this.travelMs = travelMs;
    // les camions déjà sur la route gardent leur chargement (pas de rechargement de texture toutes les 5 s)
    for (const t of this.trucks) {
      if (!t.item) continue;
      const cur = t.item;
      const fresh = items.find((i) => i.window === cur.window);
      if (!fresh) t.item = null;
      else if (fresh.workId !== cur.workId || fresh.frame !== cur.frame || fresh.rarity !== cur.rarity || fresh.price !== cur.price) t.setItem(fresh);
      else {
        t.item = fresh;
        if (fresh.sold !== cur.sold || fresh.event !== cur.event) t.refreshLabel();
      }
    }
  }

  markSold(window: number): void {
    this.soldWindows.add(window);
    const item = this.items.find((i) => i.window === window);
    if (item) item.sold = true;
    for (const t of this.trucks) if (t.item?.window === window) {
      t.item.sold = true;
      t.refreshLabel();
    }
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
        t = this.trucks.find((x) => !x.item) ?? this.spawn();
        if (!t) continue;
        t.setItem(item);
      }
      const k = (now - item.startsAt) / this.travelMs;
      const x = ROAD.x0 + (ROAD.x1 - ROAD.x0) * k;
      t.root.position.set(x, 0, ROAD.z);
      t.spinWheels(x);
    }
    for (const t of this.trucks) t.root.visible = !!t.item;
    // rampe lumineuse : bleu et ambre en alternance
    if (kitCache) {
      const on = Math.floor(performance.now() / 300) % 2 === 0;
      kitCache.sirenBlue.color.setHex(on ? 0x39b6ff : 0x0d2a40);
      kitCache.sirenAmber.color.setHex(on ? 0x3a2408 : 0xffa424);
    }
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
