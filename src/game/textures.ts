/**
 * Textures procédurales (dessinées dans un canvas, rien à télécharger) et cache des images d'œuvres.
 *  - sols et murs des 4 ambiances de salle : parquet en chevrons, béton ciré, grille néon, tatami / shōji ;
 *  - utilitaire de coordonnées de texture « au mètre » (un motif garde la même taille quel que soit le mur) ;
 *  - cache partagé des toiles du catalogue (une seule texture par œuvre, même dans 7 musées).
 */
import * as THREE from 'three';
import type { ThemeId } from './Room';
import { textureAnisotropy } from './quality';

/** Taille (m) couverte par une répétition de motif. */
export const TILE_M = 4;

function canvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Grain léger (bruit) pour casser l'aspect « couleur unie ». */
function grain(g: CanvasRenderingContext2D, size: number, amount: number, alpha: number): void {
  for (let i = 0; i < amount; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = textureAnisotropy;
  return t;
}

// ------------------------------------------------------------------ sols

function parquet(): HTMLCanvasElement {
  // chevrons : lames de 128 × 32 px, alternées à ±45°
  const [c, g] = canvas();
  g.fillStyle = '#5a3a1e';
  g.fillRect(0, 0, 512, 512);
  const tones = ['#7a4f2a', '#6b4423', '#8a5a31', '#734a27', '#5f3c1f'];
  g.save();
  g.translate(256, 256);
  g.rotate(Math.PI / 4);
  for (let row = -12; row < 12; row++) {
    for (let col = -12; col < 12; col++) {
      const x = col * 64 + (row % 2 ? 32 : 0);
      const y = row * 32;
      g.fillStyle = tones[(row * 7 + col * 3 + 50) % tones.length];
      g.fillRect(x, y, 62, 30);
    }
  }
  g.restore();
  grain(g, 512, 7000, 0.04);
  return c;
}

function concrete(): HTMLCanvasElement {
  const [c, g] = canvas();
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#8d9094');
  grad.addColorStop(1, '#7c8085');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // taches et voile du béton ciré
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.035)`;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 80, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, 512, 9000, 0.05);
  // joints de dilatation discrets (dalles de 2 m)
  g.strokeStyle = 'rgba(40,42,46,.45)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  g.beginPath();
  g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256);
  g.stroke();
  return c;
}

function neonGrid(): HTMLCanvasElement {
  const [c, g] = canvas();
  g.fillStyle = '#0b0e18';
  g.fillRect(0, 0, 512, 512);
  // dalles sombres légèrement contrastées
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = (i + j) % 2 ? '#0e1220' : '#0a0d17';
    g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
  }
  // grille lumineuse (servira aussi de carte d'émission)
  g.strokeStyle = '#19e1ff';
  g.lineWidth = 3;
  g.shadowColor = '#19e1ff';
  g.shadowBlur = 10;
  for (let k = 0; k <= 4; k++) {
    g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, k * 128); g.lineTo(512, k * 128); g.stroke();
  }
  return c;
}

function tatami(): HTMLCanvasElement {
  // 2 tatamis par motif (256 × 512), bordure de tissu sombre
  const [c, g] = canvas();
  for (const [x, y, w, h] of [[0, 0, 256, 512], [256, 0, 256, 256], [256, 256, 256, 256]] as const) {
    g.fillStyle = '#c9bb8c';
    g.fillRect(x, y, w, h);
    // fibres de jonc
    g.strokeStyle = 'rgba(120,105,60,.25)';
    g.lineWidth = 1;
    for (let k = y; k < y + h; k += 5) {
      g.beginPath(); g.moveTo(x, k); g.lineTo(x + w, k); g.stroke();
    }
    g.strokeStyle = '#3a2b1c';
    g.lineWidth = 10;
    g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  }
  grain(g, 512, 4000, 0.03);
  return c;
}

// ------------------------------------------------------------------ murs

function damask(): HTMLCanvasElement {
  const [c, g] = canvas();
  g.fillStyle = '#6a1f26';
  g.fillRect(0, 0, 512, 512);
  // motif de damas : médaillons dorés très discrets en quinconce
  g.fillStyle = 'rgba(232,182,76,.13)';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const cx = col * 128 + (row % 2 ? 64 : 0);
      const cy = row * 128 + 64;
      g.beginPath();
      g.ellipse(cx, cy, 26, 40, 0, 0, Math.PI * 2);
      g.fill();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * 36, cy + Math.sin(a) * 48, 9, 14, a, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  grain(g, 512, 5000, 0.03);
  return c;
}

function plaster(): HTMLCanvasElement {
  const [c, g] = canvas();
  g.fillStyle = '#ebe8e1';
  g.fillRect(0, 0, 512, 512);
  grain(g, 512, 9000, 0.025);
  return c;
}

function techPanels(): HTMLCanvasElement {
  const [c, g] = canvas();
  g.fillStyle = '#121626';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(25,225,255,.55)';
  g.lineWidth = 2;
  for (let k = 0; k < 2; k++) {
    g.strokeRect(k * 256 + 8, 8, 240, 496);
  }
  g.fillStyle = 'rgba(25,225,255,.25)';
  g.fillRect(0, 380, 512, 6);
  grain(g, 512, 4000, 0.03);
  return c;
}

function shoji(): HTMLCanvasElement {
  const [c, g] = canvas();
  g.fillStyle = '#efe8d6';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#4a3523';
  g.lineWidth = 7;
  for (let k = 0; k <= 4; k++) {
    g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, 512); g.stroke();
  }
  g.lineWidth = 4;
  for (let k = 0; k <= 6; k++) {
    g.beginPath(); g.moveTo(0, k * 85); g.lineTo(512, k * 85); g.stroke();
  }
  return c;
}

// ------------------------------------------------------------------ matériaux par ambiance (partagés)

interface ThemeMaterials {
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
}

const THEMES: Record<ThemeId, () => ThemeMaterials> = {
  classic: () => ({
    floor: new THREE.MeshStandardMaterial({ map: finish(parquet()), roughness: 0.32, metalness: 0.04, envMapIntensity: 0.55 }),
    wall: new THREE.MeshStandardMaterial({ map: finish(damask()), roughness: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe0b45a, roughness: 0.28, metalness: 1, emissive: 0x3a2808, emissiveIntensity: 0.22, envMapIntensity: 1.15 }),
  }),
  modern: () => ({
    floor: new THREE.MeshStandardMaterial({ map: finish(concrete()), roughness: 0.3, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ map: finish(plaster()), roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }),
  }),
  futuristic: () => {
    const grid = finish(neonGrid());
    return {
      floor: new THREE.MeshStandardMaterial({ map: grid, emissiveMap: grid, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.4 }),
      wall: new THREE.MeshStandardMaterial({ map: finish(techPanels()), roughness: 0.35, metalness: 0.3 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x19e1ff, emissive: 0x19e1ff, emissiveIntensity: 0.8, roughness: 0.3 }),
    };
  },
  zen: () => ({
    floor: new THREE.MeshStandardMaterial({ map: finish(tatami()), roughness: 0.8 }),
    wall: new THREE.MeshStandardMaterial({ map: finish(shoji()), roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3a2b1c, roughness: 0.6 }),
  }),
};

const themeCache = new Map<ThemeId, ThemeMaterials>();
/** Matériaux d'une ambiance (créés une fois, partagés par toutes les salles de tous les musées). */
export function themeMaterials(theme: ThemeId): ThemeMaterials {
  let m = themeCache.get(theme);
  if (!m) {
    m = (THEMES[theme] ?? THEMES.classic)();
    themeCache.set(theme, m);
  }
  return m;
}

/**
 * Coordonnées de texture « au mètre » pour une BoxGeometry (w × h × d) : le motif garde la même échelle
 * sur un petit pan de mur comme sur un mur de 12 m (sinon il est étiré).
 */
export function boxUvMeters(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile = TILE_M): THREE.BoxGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // faces dans l'ordre de three.js : +x, -x, +y, -y, +z, -z (4 sommets chacune)
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = dims[Math.floor(i / 4)];
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Même chose pour un plan (sol) de w × h mètres. */
export function planeUvMeters(geo: THREE.PlaneGeometry, w: number, h: number, tile = TILE_M): THREE.PlaneGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  uv.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------------ cadres arc-en-ciel (couleur qui tourne, légère lueur)

const rainbow = new Set<THREE.MeshStandardMaterial>();
let rainbowTex: THREE.CanvasTexture | null = null;
/** Dégradé de tout le spectre, répété : il défile sur le cadre. */
function rainbowTexture(): THREE.CanvasTexture {
  if (rainbowTex) return rainbowTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 6; i++) grd.addColorStop(i / 6, `hsl(${i * 60}, 95%, 60%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 4);
  rainbowTex = new THREE.CanvasTexture(c);
  rainbowTex.colorSpace = THREE.SRGBColorSpace;
  rainbowTex.wrapS = THREE.RepeatWrapping;
  return rainbowTex;
}
/** Inscrit (ou retire) un matériau de cadre arc-en-ciel : un arc-en-ciel lumineux qui défile. */
export function setRainbow(mat: THREE.MeshStandardMaterial, on: boolean): void {
  if (on) {
    if (rainbow.has(mat)) return;
    rainbow.add(mat);
    mat.map = mat.emissiveMap = rainbowTexture();
    mat.color.setHex(0xffffff);
    mat.emissive.setHex(0xffffff);
    mat.emissiveIntensity = 0.4;
    mat.metalness = 0.35;
    mat.roughness = 0.25;
    mat.needsUpdate = true;
  } else if (rainbow.delete(mat)) {
    mat.map = mat.emissiveMap = null;
    mat.emissive.setHex(0x000000);
    mat.needsUpdate = true;
  }
}
// ------------------------------------------------------------------ kit vitrine (marbre, bois verni, velours, or, verre)

function marbleCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(256);
  g.fillStyle = '#f3efe6';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(190,184,172,.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(0, 30 + i * 34);
    g.bezierCurveTo(80, 10 + i * 36, 160, 60 + i * 28, 256, 24 + i * 34);
    g.stroke();
  }
  grain(g, 256, 500, 0.05);
  return c;
}

export interface ShowcaseKit {
  marble: THREE.MeshPhysicalMaterial;
  wood: THREE.MeshStandardMaterial;
  /** Bois sombre verni (portes, escalier, bancs). */
  woodDark: THREE.MeshStandardMaterial;
  velvet: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshStandardMaterial;
  /** Verre sans réfraction (pas de second rendu de la scène). */
  glass: THREE.MeshPhysicalMaterial;
}

let kit: ShowcaseKit | null = null;

/** Matériaux partagés. Créés au premier musée, pas au chargement du module. */
export function showcase(): ShowcaseKit {
  if (kit) return kit;
  const woodMap = finish(parquet());
  kit = {
    marble: new THREE.MeshPhysicalMaterial({
      map: finish(marbleCanvas()), roughness: 0.2, metalness: 0.02,
      clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 1.05,
    }),
    wood: new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.3, metalness: 0.04, envMapIntensity: 0.6 }),
    woodDark: new THREE.MeshStandardMaterial({ map: woodMap, color: 0x6a4330, roughness: 0.34, metalness: 0.06, envMapIntensity: 0.55 }),
    velvet: new THREE.MeshPhysicalMaterial({
      color: 0x9a1830, roughness: 0.94, metalness: 0, sheen: 1, sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xff8d98), envMapIntensity: 0.2,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xe8b64c, metalness: 1, roughness: 0.26,
      emissive: 0x4a3008, emissiveIntensity: 0.4, envMapIntensity: 1.2,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xc5e4ff, roughness: 0.05, metalness: 0, transmission: 0,
      transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
      envMapIntensity: 1.45, depthWrite: false,
    }),
  };
  return kit;
}

export function updateRainbow(t: number): void {
  if (!rainbowTex || !rainbow.size) return;
  rainbowTex.offset.x = (t * 0.25) % 1;
  const pulse = 0.35 + Math.sin(t * 4) * 0.12;
  for (const m of rainbow) m.emissiveIntensity = pulse;
}

// ------------------------------------------------------------------ toiles du catalogue

const artLoader = new THREE.TextureLoader();
const artCache = new Map<string, { tex: THREE.Texture; ready: Promise<THREE.Texture> }>();

/**
 * Texture d'une œuvre (une seule par image, partagée). `ready` se résout une fois l'image chargée :
 * on peut alors lire ses proportions (tex.image.width / height) pour ne plus déformer les tableaux.
 */
export function artTextureByUrl(url: string): { tex: THREE.Texture; ready: Promise<THREE.Texture> } {
  let e = artCache.get(url);
  if (!e) {
    let resolve!: (t: THREE.Texture) => void;
    const ready = new Promise<THREE.Texture>((r) => (resolve = r));
    const tex = artLoader.load(url, (t) => resolve(t), undefined, () => resolve(tex));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = textureAnisotropy;
    e = { tex, ready };
    artCache.set(url, e);
  }
  return e;
}

/** Proportions largeur / hauteur d'une image chargée (1,33 par défaut). */
export function aspectOf(tex: THREE.Texture): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  return img?.width && img?.height ? img.width / img.height : 4 / 3;
}
