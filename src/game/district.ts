import * as THREE from 'three';
import { money } from './catalog';
import { textureAnisotropy } from './quality';
import { showcase } from './textures';

/** Quartier des musées : place centrale, route du convoi, 7 parcelles de joueurs + l'hôtel des ventes. */
export const BOUNDS = { minX: -84, maxX: 84, minZ: -62, maxZ: 62 };
export const ROAD = { z: 0, x0: -72, x1: 72 };
/**
 * Comptoir du marché noir (devant la tente, côté place). Entre deux musées (x = -40) : avant, la tente était
 * posée sur l'allée et sur le point d'apparition du musée de la parcelle x = -60.
 */
export const BLACK_MARKET = { x: -40, z: -10 };
/** Comptoir de la boutique d'améliorations (symétrique du marché noir). */
export const BOUTIQUE = { x: 40, z: -10 };
/** Grand panneau des classements : au sud de la place, entre deux musées, face à la route. */
export const BOARD_POS = { x: 0, z: 15 };
/** Bancs : deux autour de la fontaine, deux face au classement. `look` : là où regarde la personne assise. */
export const BENCHES: Array<{ x: number; z: number; ry: number; look: { x: number; z: number } }> = [
  { x: -6.6, z: -12, ry: Math.PI / 2, look: { x: 0, z: -12 } },
  { x: 6.6, z: -12, ry: -Math.PI / 2, look: { x: 0, z: -12 } },
  { x: -6, z: 11.2, ry: 0, look: { x: -6, z: 15 } },
  { x: 6, z: 11.2, ry: 0, look: { x: 6, z: 15 } },
];
const LAMP_X = [-50, -30, -10, 10, 30, 50];
const LAMP_Z = 7.3;
/** Porte de l'hôtel des ventes (au pied des marches). */
export const AUCTION_DOOR = { x: 60, z: -24.4 };

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Circle { x: number; z: number; r: number }

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function tileTexture(base: string, line: string, tiles: number, noise = 0.05): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${noise})` : `rgba(0,0,0,${noise})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
  const s = 512 / tiles;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = textureAnisotropy;
  return t;
}

/** Relief léger partagé (aucun fichier) : il donne du grain aux sols sans changer leur couleur. */
let softNormalTex: THREE.CanvasTexture | null = null;
function softNormal(): THREE.CanvasTexture {
  if (softNormalTex) return softNormalTex;
  const s = 64;
  const h = new Float32Array(s * s);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  const blur = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let a = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += h[((y + j + s) % s) * s + ((x + i + s) % s)];
    blur[y * s + x] = a / 9;
  }
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const l = blur[y * s + ((x - 1 + s) % s)];
    const r = blur[y * s + ((x + 1) % s)];
    const u = blur[((y - 1 + s) % s) * s + x];
    const d = blur[((y + 1) % s) * s + x];
    const dx = (l - r) * 2.2;
    const dy = (u - d) * 2.2;
    const dz = 1;
    const len = Math.hypot(dx, dy, dz) || 1;
    const i = (y * s + x) * 4;
    img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
    img.data[i + 2] = (dz / len) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  softNormalTex = new THREE.CanvasTexture(c);
  softNormalTex.wrapS = softNormalTex.wrapT = THREE.RepeatWrapping;
  softNormalTex.repeat.set(10, 10);
  return softNormalTex;
}

/**
 * Pelouse : vert franc, brins plus clairs et plus sombres, quelques fleurettes.
 * `snow` : tapis de neige bleutée qui scintille (saison de Noël).
 */
function grassTexture(base = '#4fa63f', snow = false, stripes = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  if (stripes) {
    // pelouse tondue en bandes (parcelles des musées)
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 32, 256);
  }
  for (let i = 0; i < 5000; i++) {
    const v = Math.random();
    if (snow) g.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.6)' : v < 0.95 ? 'rgba(150,180,220,0.22)' : 'rgba(200,240,255,0.95)';
    else g.fillStyle = v < 0.45 ? 'rgba(120,200,80,0.35)' : v < 0.9 ? 'rgba(30,90,30,0.3)' : 'rgba(255,240,140,0.5)';
    g.fillRect(Math.random() * 256, Math.random() * 256, v < 0.9 ? 1.5 : 2.5, v < 0.9 ? 3 : 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = textureAnisotropy;
  return t;
}

/** Pavés en damier de deux couleurs chaudes (la place) : vivant, sans le grand aplat beige d'avant. */
function paverTexture(a: string, b: string, grout: string, tiles = 4): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const s = 512 / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      g.fillStyle = (i + j) % 2 ? a : b;
      g.fillRect(i * s, j * s, s, s);
      // léger relief : bord clair en haut à gauche, sombre en bas à droite
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(i * s, j * s, s, 6);
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(i * s, j * s + s - 6, s, 6);
    }
  }
  for (let k = 0; k < 7000; k++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = grout;
  g.lineWidth = 4;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = textureAnisotropy;
  return t;
}

/** Haie taillée (le grand mur d'enceinte) : feuillage vert en touffes. */
function hedgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d8a3a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.4 ? 'rgba(110,190,80,0.45)' : v < 0.85 ? 'rgba(20,70,25,0.4)' : 'rgba(255,120,160,0.7)';
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, v < 0.85 ? 3 + Math.random() * 6 : 2.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Emplacements libres de la place pour le décor des saisons (sapins, citrouilles, palmiers…) :
 * hors de la route, des allées des musées, des lampadaires, des étals et du classement.
 */
// (façades des musées : x = parcelle ± 11 m, du perron jusqu'à z = ±16,6 ; tapis rouge jusqu'à z = ±5,5)
export const DECO_SPOTS: Array<{ x: number; z: number }> = [
  { x: -34.5, z: -19.5 }, { x: 34.5, z: -19.5 }, { x: -46.5, z: -20 }, { x: 47, z: -20 },
  { x: -35, z: 15.5 }, { x: 35, z: 15.5 }, { x: -45.5, z: 16 }, { x: 45.5, z: 16 },
];
/** Grande pièce centrale du décor saisonnier (grand sapin de Noël…), au nord de la fontaine. */
export const DECO_CENTER = { x: 0, z: -20.2 };

function textTexture(lines: Array<[string, string, number]>, w = 1024, h = 256, bg = '#141826'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8b64c';
  g.lineWidth = 10;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, [, , size]) => s + size * 1.25, 0);
  let y = (h - total) / 2;
  for (const [text, color, size] of lines) {
    g.font = `800 ${size}px Georgia, 'Times New Roman', serif`;
    g.fillStyle = color;
    g.fillText(text, w / 2, y + (size * 1.25) / 2, w - 60);
    y += size * 1.25;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class District {
  readonly group = new THREE.Group();
  /** Sols qui reçoivent le relief procédural (couleurs inchangées). */
  private groundMats: THREE.MeshStandardMaterial[] = [];
  readonly boxes: Box[] = [];
  readonly circles: Circle[] = [];
  /** Volumes opaques qui peuvent masquer le joueur (pour la caméra). */
  readonly occluders: THREE.Object3D[] = [];
  private boardTexture!: THREE.CanvasTexture;
  private boardCanvas = document.createElement('canvas');
  private water!: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.group.userData.decor = 1;
    scene.add(this.group);
    this.buildSky(scene);
    this.buildGround();
    this.buildPlots();
    this.buildPlaza();
    this.buildBoard();
    this.buildPerimeterFence();
    this.buildDepots();
  }

  /** Collision du joueur (rayon r) avec le décor et les limites du quartier. */
  blocked(x: number, z: number, r: number, extraBoxes: Box[] = [], extraCircles: Circle[] = []): boolean {
    if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || z < BOUNDS.minZ + r || z > BOUNDS.maxZ - r) return true;
    for (const b of this.boxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    for (const b of extraBoxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    for (const c of this.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    for (const c of this.seasonCircles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    for (const c of extraCircles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    return false;
  }

  /** Obstacles du décor saisonnier (grand sapin…), remplacés à chaque changement de saison. */
  seasonCircles: Circle[] = [];

  // ---------------------------------------------------------------- thème du monde (saisons)

  private grassMat!: THREE.MeshStandardMaterial;
  private plotMat!: THREE.MeshStandardMaterial;
  private flagsGeo: THREE.BufferGeometry | null = null;
  private bulbMat!: THREE.MeshStandardMaterial;
  private groundKey = '';

  /** Couleurs du ciel : haut et horizon. */
  setSkyColors(top: string, horizon: string): void {
    if (!this.skyMat) return;
    (this.skyMat.uniforms.top.value as THREE.Color).set(top);
    (this.skyMat.uniforms.horizon.value as THREE.Color).set(horizon);
  }

  /** Pelouse (ou neige) du quartier et des parcelles. */
  setGround(color: string, snow = false): void {
    const key = `${color}:${snow}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    const swap = (mat: THREE.MeshStandardMaterial, tex: THREE.CanvasTexture, repeat: [number, number]) => {
      const old = mat.map;
      tex.repeat.set(...repeat);
      mat.map = tex;
      mat.needsUpdate = true;
      old?.dispose();
    };
    swap(this.grassMat, grassTexture(color, snow), [40, 30]);
    const lawn = snow ? color : `#${new THREE.Color(color).offsetHSL(0, 0.04, 0.05).getHexString()}`;
    swap(this.plotMat, grassTexture(lawn, snow, !snow), [5, 5]);
  }

  /** Couleurs des fanions des guirlandes. */
  setFlagColors(colors: string[]): void {
    const geo = this.flagsGeo;
    if (!geo || !colors.length) return;
    const attr = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < attr.count / 3; i++) {
      c.set(colors[i % colors.length]);
      for (let v = 0; v < 3; v++) attr.setXYZ(i * 3 + v, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  /** Couleur des ampoules des lampadaires. */
  setBulb(color: string): void {
    this.bulbMat.emissive.set(color);
  }

  setLeaderboard(
    rows: Array<{ name: string; value: number; me?: boolean }>,
    _myName: string,
    title = 'LES MUSÉES LES PLUS RICHES',
    subtitle = 'valeur totale des collections',
    empty = 'Achetez votre première œuvre pour entrer au classement',
  ): void {
    const c = this.boardCanvas;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d1018';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#e8b64c';
    g.lineWidth = 14;
    g.strokeRect(7, 7, c.width - 14, c.height - 14);
    g.fillStyle = '#e8b64c';
    g.font = "800 64px Georgia, serif";
    g.textAlign = 'center';
    g.fillText(title, c.width / 2, 92, c.width - 80);
    g.font = "600 30px 'Segoe UI', sans-serif";
    g.fillStyle = '#a9a49a';
    g.fillText(subtitle, c.width / 2, 136);
    const medals = ['#ffd36b', '#d9dde6', '#d08a4a'];
    rows.slice(0, 6).forEach((r, i) => {
      const y = 210 + i * 64;
      // le serveur marque la ligne du joueur (« me ») : deux musées homonymes ne sont plus confondus
      const me = !!r.me;
      if (me) {
        g.fillStyle = 'rgba(232,182,76,.16)';
        g.fillRect(60, y - 44, c.width - 120, 58);
      }
      g.textAlign = 'left';
      g.font = "800 40px 'Segoe UI', sans-serif";
      g.fillStyle = medals[i] ?? '#cfc9bb';
      g.fillText(`${i + 1}.`, 80, y);
      g.fillStyle = me ? '#ffd36b' : '#f2ede1';
      g.fillText(r.name.slice(0, 22), 150, y);
      g.textAlign = 'right';
      g.fillStyle = '#ffd36b';
      g.fillText(money(r.value), c.width - 80, y);
    });
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#cfc9bb';
      g.font = "600 40px 'Segoe UI', sans-serif";
      g.fillText(empty, c.width / 2, 320, c.width - 100);
    }
    this.boardTexture.needsUpdate = true;
  }

  update(t: number): void {
    if (this.skyMat) {
      const u = this.skyMat.uniforms;
      const st = this.skyTint;
      u.time.value = t;
      st.amount += (st.want - st.amount) * 0.03;
      u.tintAmt.value = st.amount;
      if (st.rainbow) st.color.setHSL((t * 0.08) % 1, 0.8, 0.6);
    }
    const w = this.water.material as THREE.MeshStandardMaterial;
    w.emissiveIntensity = 0.25 + Math.sin(t * 1.5) * 0.08;
    if (w.normalMap && this.sprayCount > 0) {
      w.normalMap.offset.x = t * 0.015;
      w.normalMap.offset.y = t * 0.008;
    }
    // gouttes de la fontaine : chacune suit une parabole, du bol central jusqu'au bassin
    if (this.sprayGeo && this.sprayCount > 0) {
      const a = this.sprayGeo.getAttribute('position') as THREE.BufferAttribute;
      const n = this.sprayCount;
      for (let i = 0; i < n; i++) {
        const [ang, ph] = this.sprayPhase[i];
        const k = (t * 0.7 + ph) % 1;
        const r = 0.3 + k * 2.3;
        a.setXYZ(i, Math.cos(ang) * r, 3.1 + 1.7 * k - 4.0 * k * k, -12 + Math.sin(ang) * r);
      }
      a.needsUpdate = true;
      this.sprayGeo.setDrawRange(0, n);
    }
  }

  // ---------------------------------------------------------------- construction

  /** Ciel : dégradé, nuages qui dérivent, halo du soleil ; teinté pendant les événements en direct. */
  private skyMat: THREE.ShaderMaterial | null = null;
  private skyTint = { color: new THREE.Color('#ffffff'), amount: 0, want: 0, rainbow: false };

  private buildSky(scene: THREE.Scene): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#1f6fd1') },
        horizon: { value: new THREE.Color('#a9d0f5') },
        time: { value: 0 },
        tint: { value: this.skyTint.color },
        tintAmt: { value: 0 },
        sunDir: { value: new THREE.Vector3(26, 42, 14).normalize() },
        octaves: { value: 5 },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform float time;
        uniform vec3 tint;
        uniform float tintAmt;
        uniform vec3 sunDir;
        uniform float octaves;
        varying vec3 vP;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { if (float(i) >= octaves) break; v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vP);
          vec3 col = mix(horizon, top, smoothstep(-0.02, 0.45, d.y));
          // nuages ronds et blancs (bruit fractal projeté sur un plafond), qui dérivent lentement
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.15) * 1.4 + vec2(time * 0.010, time * 0.004);
            float c = fbm(uv);
            float cloud = smoothstep(0.5, 0.75, c) * smoothstep(0.0, 0.2, d.y);
            vec3 cc = mix(vec3(1.0), vec3(0.78, 0.84, 0.95), smoothstep(0.62, 0.95, c));
            col = mix(col, cc, cloud * 0.92);
          }
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.0 + pow(s, 14.0) * 0.22);
          col = mix(col, col * 0.6 + tint * 0.55, tintAmt);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    scene.add(sky);
  }

  /**
   * Détail selon le palier : nuages, netteté des textures, jets de la fontaine, relief des sols.
   * Les couleurs (Neutral, pelouse, pavés) ne changent pas.
   */
  setVisual(o: { octaves: number; anisotropy: number; spray: number; relief: boolean }): void {
    if (this.skyMat) this.skyMat.uniforms.octaves.value = o.octaves;
    this.sprayCount = o.spray;
    if (this.spray) this.spray.visible = o.spray > 0;
    const normal = o.relief ? softNormal() : null;
    for (const m of this.groundMats) {
      m.normalMap = normal;
      m.normalScale.set(o.relief ? 0.22 : 0, o.relief ? 0.22 : 0);
      m.needsUpdate = true;
    }
    const water = this.water?.material as THREE.MeshStandardMaterial | undefined;
    if (water) {
      water.normalMap = o.relief ? this.waterNormal() : null;
      water.normalScale.set(0.35, 0.35);
      water.needsUpdate = true;
    }
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const mat of mats) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map && map.anisotropy !== o.anisotropy) {
          map.anisotropy = o.anisotropy;
          map.needsUpdate = true;
        }
      }
    });
  }

  private waterNormalTex: THREE.Texture | null = null;
  private waterNormal(): THREE.Texture {
    if (this.waterNormalTex) return this.waterNormalTex;
    const t = softNormal().clone();
    t.repeat.set(3, 3);
    this.waterNormalTex = t;
    return t;
  }

  /** Teinte du ciel pendant un événement (null : ciel normal). */
  setSkyEvent(kind: string | null): void {
    const t = this.skyTint;
    t.rainbow = kind === 'arcenciel';
    t.want = kind === 'pluie' || kind === 'arcenciel' || kind === 'vitesse' || kind === 'golden' ? 0.35 : 0;
    if (kind === 'pluie' || kind === 'golden') t.color.set('#ffc44d');
    else if (kind === 'vitesse') t.color.set('#5ee7ff');
  }

  private plane(w: number, d: number, x: number, z: number, mat: THREE.Material, y = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildGround(): void {
    // Grand dallage minéral et allées structurées en plaques de pierre
    // 1. Dalle de fondation globale en pierre beige/grège chaleureuse
    // (couleurs ravivées : l'ancien sol brun-gris rendait toute la scène terne)
    const baseStone = grassTexture();
    baseStone.repeat.set(40, 30);
    this.grassMat = std(0xffffff, { map: baseStone, roughness: 0.95 });
    this.groundMats.push(this.grassMat);
    this.plane(240, 180, 0, 0, this.grassMat, -0.05);

    // 2. Place centrale en pavés dorés et terre cuite (avant : un grand aplat beige qui « blanchissait » toute la scène)
    const pav = paverTexture('#eaae62', '#de9154', 'rgba(120,62,32,0.45)', 6);
    pav.repeat.set(170 / 6, 48 / 6);
    this.plane(170, 48, 0, 0, this.track(std(0xffffff, { map: pav, roughness: 0.82 })), -0.01);

    // 3. Trottoirs le long de la route (nord et sud) en briques rouges
    const brick = tileTexture('#c0583b', 'rgba(90,35,20,0.5)', 8, 0.05);
    brick.repeat.set(160 / 4, 1);
    const walkwayMat = this.track(std(0xffffff, { map: brick, roughness: 0.8 }));
    this.plane(160, 4.0, 0, -5.5, walkwayMat, 0.01);
    this.plane(160, 4.0, 0, 5.5, walkwayMat, 0.01);

    // 4. Chaussée du convoi (asphalte sombre avec bordures en granit clair)
    const asphalt = tileTexture('#282b30', 'rgba(0,0,0,0)', 1, 0.04);
    asphalt.repeat.set(30, 1);
    this.plane(148, 6.4, 0, ROAD.z, this.track(std(0xffffff, { map: asphalt, roughness: 0.85 })), 0);

    for (let x = ROAD.x0 + 2; x < ROAD.x1; x += 6) {
      this.plane(3, 0.25, x, ROAD.z, std(0xf4f0e4), 0.01);
    }
    for (const z of [-3.35, 3.35]) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(148, 0.2, 0.35), std(0x736c62, { roughness: 0.7 }));
      kerb.position.set(0, 0.1, z);
      kerb.receiveShadow = true;
      this.group.add(kerb);
    }

    // 5. Parcelles des musées : pelouse tondue en bandes (avant : un damier de pierre gris-brun, terne)
    const plot = grassTexture('#5cb84a', false, true);
    plot.repeat.set(5, 5);
    this.plotMat = std(0xffffff, { map: plot, roughness: 0.9 });
    this.groundMats.push(this.plotMat);
    // allées des musées en pavés bleu ardoise : le tapis rouge des entrées s'y détache bien
    const alley = tileTexture('#6f7fa0', 'rgba(30,36,55,0.5)', 3, 0.05);
    alley.repeat.set(1, 3);
    const alleyMat = this.track(std(0xffffff, { map: alley, roughness: 0.75 }));
    for (const x of [-60, -20, 20, 60]) {
      for (const z of [-41, 41]) {
        // pelouse de la parcelle
        this.plane(38, 38, x, z, this.plotMat, -0.005);
        // allée guidant de la chaussée jusqu'à l'entrée du musée
        const walkZ = z > 0 ? 15 : -15;
        this.plane(6, 18, x, walkZ, alleyMat, 0.005);
      }
    }
  }

  /** Bâtiments majestueux et palais d'art impériaux avec toiture classique complète. */
  private buildPlots(): void {
    // colonnes et fronton crème doré, murs framboise : l'hôtel des ventes se repère de loin (avant : tout blanc cassé)
    const stone = std(0xf1d9a8, { roughness: 0.8 });
    const wallRed = std(0xb83a4b, { roughness: 0.78 });
    const dark = std(0x2a2d36, { roughness: 0.5 });
    const roofSlate = std(0x2f3f63, { roughness: 0.7 });
    const goldAccent = std(0xe8b64c, { metalness: 0.7, roughness: 0.3 });

    const facade = (x: number, z: number, facing: 1 | -1, title: string, sub: string, accent = 0xe8b64c, dome = false) => {
      const g = new THREE.Group();
      // Corps principal de l'édifice
      const body = new THREE.Mesh(new THREE.BoxGeometry(30, 9.5, 24), wallRed);
      body.position.set(0, 4.75, 0);
      g.add(body);
      this.occluders.push(body);

      // Corniche supérieure en pierre moulurée
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(31.2, 0.6, 25.2), stone);
      cornice.position.y = 9.8;
      g.add(cornice);

      // Toiture majestueuse à 4 pans (toit complet au-dessus du bâtiment)
      const roofPeak = new THREE.Mesh(new THREE.ConeGeometry(19, 4.8, 4), roofSlate);
      roofPeak.rotation.y = Math.PI / 4;
      roofPeak.scale.set(1.15, 1, 0.9);
      roofPeak.position.set(0, 12.5, 0);
      g.add(roofPeak);

      // Fronton triangulaire architectural sculpté (orienté vers le ciel)
      const pedShape = new THREE.Shape();
      pedShape.moveTo(-13, 0);
      pedShape.lineTo(13, 0);
      pedShape.lineTo(0, 3.2);
      pedShape.closePath();
      const pedGeo = new THREE.ExtrudeGeometry(pedShape, { depth: 0.9, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.08, bevelThickness: 0.08 });
      const ped = new THREE.Mesh(pedGeo, stone);
      ped.position.set(0, 9.8, 12.1);

      const clockOrn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.15, 24), goldAccent);
      clockOrn.rotation.x = Math.PI / 2;
      clockOrn.position.set(0, 10.8, 12.2);
      g.add(ped, clockOrn);

      // Colonnade classique avec chapiteaux dorés
      for (let i = 0; i < 6; i++) {
        const colGroup = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 8.4, 16), stone);
        shaft.position.y = 4.2;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), goldAccent);
        cap.position.y = 8.5;
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), stone);
        base.position.y = 0.2;
        colGroup.add(shaft, cap, base);
        colGroup.position.set(-12.5 + i * 5, 0, 13.6);
        g.add(colGroup);
      }

      // Grand perron et marches monumentales
      const steps = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 3.6), std(0xc98f5a, { roughness: 0.8 }));
      steps.position.set(0, 0.3, 15.4);
      g.add(steps);

      // Grande porte en chêne sombre avec poignées dorées
      const door = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.8, 0.35), dark);
      door.position.set(0, 2.9, 12.05);
      g.add(door);

      // Dôme central prestigieux (pour l'Hôtel des Ventes)
      if (dome) {
        const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 2.2, 32), stone);
        domeBase.position.y = 11.0;
        const d = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(accent, { metalness: 0.8, roughness: 0.25 }));
        d.position.y = 12.1;
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.0, 16), goldAccent);
        lantern.position.y = 19.1;
        g.add(domeBase, d, lantern);
      }

      // Enseigne prestigieuse en laiton gravé
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(10.5, 2.6),
        new THREE.MeshStandardMaterial({ map: textTexture([[title, '#e8b64c', 74], [sub, '#cfc9bb', 46]]), roughness: 0.5 }),
      );
      sign.position.set(0, 7.8, 14.3);
      g.add(sign);

      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      g.position.set(x, 0, z);
      g.rotation.y = facing === 1 ? 0 : Math.PI;
      this.group.add(g);
      // emprise au sol (corps + colonnade + marches)
      const zFront = z + facing * 17.5;
      const zBack = z - facing * 12.5;
      this.boxes.push({ minX: x - 15.8, maxX: x + 15.8, minZ: Math.min(zFront, zBack), maxZ: Math.max(zFront, zBack) });
    };
    // Palais des Enchères (Hôtel des Ventes) situé au nord-est
    facade(60, -42, 1, 'HÔTEL DES VENTES', 'Enchères de Chefs-d’Œuvre', 0xc9302c, true);
  }

  private buildPlaza(): void {
    // fontaine
    const f = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.8, 40), showcase().marble);
    basin.position.y = 0.4;
    this.water = new THREE.Mesh(
      new THREE.CylinderGeometry(3.05, 3.05, 0.1, 40),
      new THREE.MeshStandardMaterial({ color: 0x3f8fe0, emissive: 0x1b4f8f, emissiveIntensity: 0.25, roughness: 0.15, metalness: 0.2 }),
    );
    this.water.position.y = 0.76;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 16), showcase().marble);
    column.position.y = 1.7;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.4, 24), showcase().marble);
    bowl.position.y = 3;
    f.add(basin, this.water, column, bowl);
    f.position.set(0, 0, -12);
    f.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(f);
    this.circles.push({ x: 0, z: -12, r: 3.6 });

    // Lampadaires : sur le bord extérieur des trottoirs (z = ±7.3), jamais sur une allée de musée (x = ±20, ±60),
    // ni au milieu du trottoir (où l'on attend les camions), ni dans les dépôts (avant : x = ±75, dans les murs).
    // Lampadaires instanciés : un seul appel de dessin pour les mâts, un pour les globes.
    const post = std(0x23262e, { metalness: 0.6, roughness: 0.4 });
    const bulb = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd58a, emissiveIntensity: 1.4 });
    this.bulbMat = bulb;
    const lampPos: Array<[number, number]> = [];
    for (const x of LAMP_X) for (const z of [-LAMP_Z, LAMP_Z]) lampPos.push([x, z]);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 4.2, 8), post, lampPos.length);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), bulb, lampPos.length);
    const dummy = new THREE.Object3D();
    lampPos.forEach(([x, z], i) => {
      dummy.position.set(x, 2.1, z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 4.35, z);
      dummy.updateMatrix();
      bulbs.setMatrixAt(i, dummy.matrix);
      this.circles.push({ x, z, r: 0.2 });
    });
    posts.castShadow = bulbs.castShadow = true;
    this.group.add(posts, bulbs);

    // arbres en bacs aux coins de la place
    const leaf = std(0x4e8f44, { flatShading: true });
    const trunkMat = showcase().woodDark;
    const planter = showcase().marble;
    const treeAt: Array<[number, number]> = [[-40, 14], [40, 14], [-75, 14], [75, 14], [-75, -14], [75, -14]];
    const planters = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), planter, treeAt.length);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 8), trunkMat, treeAt.length);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.8, 0), leaf, treeAt.length);
    const treeM = new THREE.Matrix4();
    const treeP = new THREE.Vector3();
    const treeQ = new THREE.Quaternion();
    const treeS = new THREE.Vector3(1, 1, 1);
    treeAt.forEach(([x, z], i) => {
      treeP.set(x, 0.4, z);
      treeM.compose(treeP, treeQ, treeS);
      planters.setMatrixAt(i, treeM);
      treeP.set(x, 1.9, z);
      treeM.compose(treeP, treeQ, treeS);
      trunks.setMatrixAt(i, treeM);
      treeP.set(x, 3.9, z);
      treeS.set(1, 1.15, 1);
      treeM.compose(treeP, treeQ, treeS);
      crowns.setMatrixAt(i, treeM);
      treeS.set(1, 1, 1);
      this.boxes.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
    });
    planters.castShadow = trunks.castShadow = crowns.castShadow = true;
    planters.receiveShadow = true;
    this.group.add(planters, trunks, crowns);

    this.buildLiveliness();

    // Échoppe discrète et élégante du Marché Noir : comptoir en acajou et tenture pourpre
    const tent = new THREE.Group();
    // Pavillon en bois sombre avec toiture en pagode/mansarde pourpre
    const cloth = new THREE.Mesh(new THREE.ConeGeometry(3.6, 3.2, 4), std(0x2d182e, { roughness: 0.6 }));
    cloth.position.y = 3.6;
    cloth.rotation.y = Math.PI / 4;

    const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 4.8), std(0x211728, { roughness: 0.7 }));
    base.position.y = 1.0;

    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.0, 1.2), std(0x3e2723, { roughness: 0.4 }));
    counter.position.set(0, 0.5, 2.0);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4081, emissive: 0xc2185b, emissiveIntensity: 1.8 })
    );
    lantern.position.set(0, 2.5, 2.1);

    tent.add(cloth, base, counter, lantern);
    this.occluders.push(cloth, base);

    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshStandardMaterial({
        map: textTexture([['MARCHÉ NOIR', '#ff4081', 68], ['Outils d’Infiltration', '#e0e0e0', 42]], 1024, 256, '#180c1c'),
        roughness: 0.5,
      })
    );
    tag.position.set(0, 2.2, 2.45);
    tent.add(tag);

    tent.position.set(BLACK_MARKET.x, 0, BLACK_MARKET.z - 3);
    tent.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(tent);
    this.boxes.push({ minX: BLACK_MARKET.x - 2.6, maxX: BLACK_MARKET.x + 2.6, minZ: BLACK_MARKET.z - 6, maxZ: BLACK_MARKET.z });

    this.buildBoutique();
  }

  /** Vie de la place : guirlandes de fanions, fleurs, bancs, jets de la fontaine. */
  private buildLiveliness(): void {
    // 1. guirlandes de fanions multicolores entre les lampadaires (un seul maillage, couleurs par sommet)
    const COLORS = [0xff5e62, 0xffd36b, 0x3d8bff, 0x4cc38a, 0xb46bff, 0xff9f43].map((c) => new THREE.Color(c));
    const pos: number[] = [];
    const col: number[] = [];
    const line: THREE.Vector3[] = [];
    let k = 0;
    for (const z of [-LAMP_Z, LAMP_Z]) {
      for (let i = 0; i + 1 < LAMP_X.length; i++) {
        const a = LAMP_X[i];
        const b = LAMP_X[i + 1];
        const sag = (t: number) => 4.1 - 1.0 * 4 * t * (1 - t);
        for (let s = 0; s <= 24; s++) line.push(new THREE.Vector3(a + ((b - a) * s) / 24, sag(s / 24), z), new THREE.Vector3(a + ((b - a) * (s + 1)) / 24, sag((s + 1) / 24), z));
        line.length -= 2; // dernier segment en trop
        for (let x = a + 0.6; x < b - 0.4; x += 0.75) {
          const y = sag((x - a) / (b - a));
          pos.push(x - 0.22, y, z, x + 0.22, y, z, x, y - 0.48, z);
          const c = COLORS[k++ % COLORS.length];
          for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
        }
      }
    }
    const flagsGeo = new THREE.BufferGeometry();
    flagsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    flagsGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.flagsGeo = flagsGeo;
    flagsGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(flagsGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: 0x3b3f4a })));

    // 2. fleurs dans les bacs des arbres (un seul maillage instancié)
    const trees = [[-40, 14], [40, 14], [-75, 14], [75, 14], [-75, -14], [75, -14]];
    const FLOWER = [0xff5e8a, 0xffd36b, 0xffffff, 0xb46bff, 0xff7a3d, 0x6fd3ff];
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), trees.length * 14);
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const [tx, tz] of trees) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        m4.makeTranslation(tx + Math.cos(a) * 0.95, 0.88 + Math.random() * 0.1, tz + Math.sin(a) * 0.95);
        flowers.setMatrixAt(n, m4);
        flowers.setColorAt(n++, new THREE.Color(FLOWER[(i + Math.abs(tx)) % FLOWER.length]));
      }
    }
    this.group.add(flowers);

    // 3. bancs (bois et fonte), avec collision
    const wood = showcase().wood;
    const iron = std(0x23262e, { metalness: 0.6, roughness: 0.4 });
    for (const b of BENCHES) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.5), wood);
      seat.position.y = 0.46;
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.07), wood);
      back.position.set(0, 0.78, -0.24);
      g.add(seat, back);
      for (const sx of [-0.8, 0.8]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 0.5), iron);
        leg.position.set(sx, 0.23, 0);
        g.add(leg);
      }
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.ry;
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.group.add(g);
      const along = Math.abs(Math.sin(b.ry)) > 0.5; // banc orienté selon z
      this.boxes.push(along ? { minX: b.x - 0.3, maxX: b.x + 0.3, minZ: b.z - 1, maxZ: b.z + 1 } : { minX: b.x - 1, maxX: b.x + 1, minZ: b.z - 0.3, maxZ: b.z + 0.3 });
    }

    // 4. jets de la fontaine : gouttes animées en arcs (voir update)
    const drops = 180;
    this.sprayGeo = new THREE.BufferGeometry();
    this.sprayGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(drops * 3), 3));
    this.sprayPhase = Array.from({ length: drops }, () => [Math.random() * Math.PI * 2, Math.random()]);
    const spray = new THREE.Points(this.sprayGeo, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.13, transparent: true, opacity: 0.85, depthWrite: false }));
    spray.frustumCulled = false;
    this.spray = spray;
    this.group.add(spray);
  }

  private spray: THREE.Points | null = null;
  private sprayCount = 180;

  private track(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.groundMats.push(m);
    return m;
  }

  private sprayGeo: THREE.BufferGeometry | null = null;
  private sprayPhase: number[][] = [];

  /** Boutique d'améliorations : étal à auvent rayé, vitrine de produits, enseigne lumineuse. */
  private buildBoutique(): void {
    const g = new THREE.Group();
    const wood = std(0x6b4a2e, { roughness: 0.6 });
    const cream = std(0xf4ecd8, { roughness: 0.7 });
    // stand
    const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.2, 4.2), std(0x1f5f8b, { roughness: 0.55 }));
    base.position.y = 1.1;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, 1.0), wood);
    counter.position.set(0, 0.5, 2.3);
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 1.2), cream);
    top.position.set(0, 1.05, 2.3);
    // auvent rayé (bandes alternées)
    for (let i = 0; i < 8; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 2.4), std(i % 2 ? 0xf4ecd8 : 0x2a9df4, { roughness: 0.6 }));
      stripe.position.set(-2.31 + i * 0.66, 3.05, 2.0);
      stripe.rotation.x = 0.32;
      g.add(stripe);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.3, 4.6), std(0x173f5f, { roughness: 0.5 }));
    roof.position.y = 2.6;
    // produits exposés : chaussures dorées, gants, cadenas, sablier
    const gold = std(0xffc83d, { metalness: 0.8, roughness: 0.25 });
    const items = [
      new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.24), gold),
      new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), std(0x7a3ff2, { roughness: 0.4 })),
      new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 10, 18), std(0xc0c4cc, { metalness: 0.9, roughness: 0.2 })),
      new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 14), std(0x4cc38a, { roughness: 0.4 })),
    ];
    items.forEach((m, i) => {
      m.position.set(-1.5 + i, 1.3, 2.3);
      g.add(m);
    });
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshStandardMaterial({
        map: textTexture([['BOUTIQUE', '#7fd3ff', 70], ['Améliorations · Renaissance', '#f4ecd8', 40]], 1024, 256, '#0b1d2c'),
        emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5,
      }),
    );
    tag.material.emissiveMap = tag.material.map;
    tag.position.set(0, 3.65, 2.15);
    g.add(base, counter, top, roof, tag);
    this.occluders.push(base, roof);
    g.position.set(BOUTIQUE.x, 0, BOUTIQUE.z - 3);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(g);
    this.boxes.push({ minX: BOUTIQUE.x - 2.7, maxX: BOUTIQUE.x + 2.7, minZ: BOUTIQUE.z - 5.2, maxZ: BOUTIQUE.z });
  }

  private buildBoard(): void {
    this.boardCanvas.width = 1280;
    this.boardCanvas.height = 640;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshStandardMaterial({ map: this.boardTexture, emissive: 0xffffff, emissiveMap: this.boardTexture, emissiveIntensity: 0.65 }),
    );
    screen.position.y = 4.6;
    const back = new THREE.Mesh(new THREE.BoxGeometry(10.6, 5.6, 0.3), std(0x1b1e27, { metalness: 0.5 }));
    back.position.set(0, 4.6, -0.17);
    // écran des deux côtés : les joueurs qui sortent des musées du sud voient aussi le classement (avant : un dos noir)
    const screen2 = new THREE.Mesh(screen.geometry, screen.material);
    screen2.position.set(0, 4.6, -0.34);
    screen2.rotation.y = Math.PI;
    // liseré doré autour du panneau
    const trimMat = std(0xe8b64c, { metalness: 0.85, roughness: 0.3 });
    for (const [w, h, x, y] of [[10.9, 0.18, 0, 7.45], [10.9, 0.18, 0, 1.75], [0.18, 5.9, -5.4, 4.6], [0.18, 5.9, 5.4, 4.6]] as const) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.42), trimMat);
      t.position.set(x, y, -0.17);
      g.add(t);
    }
    g.add(screen, screen2, back);
    for (const sx of [-4, 4]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), std(0x1b1e27));
      p.position.set(sx, 1.1, -0.17);
      g.add(p);
    }
    // Au sud de la place, entre les musées x = -20 et x = 20, écran tourné vers la route.
    // (Avant : x = -20, z = -13, en plein sur l'allée et devant l'entrée du musée de cette parcelle.)
    g.position.set(BOARD_POS.x, 0, BOARD_POS.z);
    g.rotation.y = Math.PI;
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(g);
    this.occluders.push(back);
    this.boxes.push({ minX: BOARD_POS.x - 5.3, maxX: BOARD_POS.x + 5.3, minZ: BOARD_POS.z - 0.4, maxZ: BOARD_POS.z + 0.6 });
    this.setLeaderboard([], '');
  }

  /**
   * Mur d'enceinte géant de la ville (hauteur 14 mètres) :
   * Impossible de voir au-delà et impossible à traverser.
   * Aucune grille intérieure : espace urbain fluide et élégant.
   */
  private buildPerimeterFence(): void {
    const wallHeight = 14.0;
    const wallThick = 2.4;
    // grande haie taillée, fleurie (avant : un mur de pierre brun-gris qui assombrissait tout le quartier)
    const hedge = hedgeTexture();
    hedge.repeat.set(24, 3);
    const wallMat = std(0xffffff, { map: hedge, roughness: 1 });
    const capMat = std(0x2f7a33, { roughness: 0.9 });

    const addPerimeterWall = (x1: number, z1: number, x2: number, z2: number) => {
      const g = new THREE.Group();
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) return;
      const angle = Math.atan2(dx, dz);

      g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
      g.rotation.y = angle;

      // Mur d'enceinte opaque géant
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallHeight, len), wallMat);
      wallMesh.position.y = wallHeight / 2;
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      g.add(wallMesh);
      this.occluders.push(wallMesh);

      // Couronnement / corniche supérieure de protection
      const capMesh = new THREE.Mesh(new THREE.BoxGeometry(wallThick + 0.6, 1.0, len), capMat);
      capMesh.position.y = wallHeight + 0.5;
      capMesh.castShadow = true;
      g.add(capMesh);

      // Contreforts réguliers le long du mur tous les 12 mètres
      const count = Math.max(1, Math.round(len / 12));
      const step = len / count;
      for (let i = 0; i <= count; i++) {
        const offset = -len / 2 + i * step;
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(wallThick + 1.2, wallHeight, 1.6), wallMat);
        buttress.position.set(0, wallHeight / 2, offset);
        buttress.castShadow = true;
        g.add(buttress);
      }

      this.group.add(g);

      // Boîte de collision infranchissable
      const minX = Math.min(x1, x2) - wallThick / 2 - 0.2;
      const maxX = Math.max(x1, x2) + wallThick / 2 + 0.2;
      const minZ = Math.min(z1, z2) - wallThick / 2 - 0.2;
      const maxZ = Math.max(z1, z2) + wallThick / 2 + 0.2;
      this.boxes.push({ minX, maxX, minZ, maxZ });
    };

    // 4 pans du grand mur d'enceinte infranchissable qui clôture toute la ville
    addPerimeterWall(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX, BOUNDS.minZ);
    addPerimeterWall(BOUNDS.minX, BOUNDS.maxZ, BOUNDS.maxX, BOUNDS.maxZ);
    addPerimeterWall(BOUNDS.minX, BOUNDS.minZ, BOUNDS.minX, -6);
    addPerimeterWall(BOUNDS.minX, 6, BOUNDS.minX, BOUNDS.maxZ);
    addPerimeterWall(BOUNDS.maxX, BOUNDS.minZ, BOUNDS.maxX, -6);
    addPerimeterWall(BOUNDS.maxX, 6, BOUNDS.maxX, BOUNDS.maxZ);
  }

  /**
   * Grands bâtiments / hangars d'où sortent et entrent les camions du convoi d'œuvres d'art.
   * - Ouest : Dépôt de logistique d'art d'où les camions sortent par une haute porte noire.
   * - Est : Dépôt sécurisé des convois où les camions entrent à la fin de leur parcours.
   */
  private buildDepots(): void {
    const wallMat = std(0x232630, { roughness: 0.7 });
    const trimMat = std(0x181a22, { roughness: 0.5, metalness: 0.5 });
    const roofMat = std(0x14161d, { roughness: 0.8 });
    const blackDoorMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95 });
    const yellowStripeMat = new THREE.MeshBasicMaterial({ color: 0xf5b722 });

    const createDepot = (xCenter: number, isWest: boolean, title: string) => {
      const g = new THREE.Group();
      // Bâtiment de 20m de large, 10m de haut, 22m de profondeur
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 22), wallMat);
      body.position.set(0, 5, 0);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      this.occluders.push(body);

      // Toit à pans biseautés
      const roof = new THREE.Mesh(new THREE.BoxGeometry(20.8, 1.2, 22.8), roofMat);
      roof.position.set(0, 10.6, 0);
      roof.castShadow = true;
      g.add(roof);

      // Encadrement de la grande porte de convoi (face intérieure tournée vers la place)
      const doorFacingX = isWest ? 10.05 : -10.05;
      const frameW = 0.6;
      const frameH = 6.4;
      const frameD = 8.6;

      const portalFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, frameH, frameD), trimMat);
      portalFrame.position.set(doorFacingX, 3.2, 0);
      portalFrame.castShadow = true;
      g.add(portalFrame);

      // Grande porte noire par laquelle passent les camions
      const blackDoor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.6, 7.6), blackDoorMat);
      blackDoor.position.set(doorFacingX + (isWest ? -0.1 : 0.1), 2.8, 0);
      g.add(blackDoor);

      // Bandes de sécurité jaunes / signalétique au-dessus de la porte
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 7.8), yellowStripeMat);
      stripe.position.set(doorFacingX + (isWest ? 0.05 : -0.05), 5.9, 0);
      g.add(stripe);

      // Enseigne du bâtiment
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 2.2),
        new THREE.MeshStandardMaterial({
          map: textTexture([[title, '#e8b64c', 60], ['CONVOIS SÉCURISÉS', '#cfc9bb', 38]], 1024, 256, '#0f121a'),
          roughness: 0.6,
        }),
      );
      sign.position.set(doorFacingX + (isWest ? 0.15 : -0.15), 7.8, 0);
      sign.rotation.y = isWest ? Math.PI / 2 : -Math.PI / 2;
      g.add(sign);

      // Lampes de quai au-dessus de la porte noire
      const lampGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xffd277, emissive: 0xffaa22, emissiveIntensity: 2.0 }),
      );
      lampGlow.position.set(doorFacingX + (isWest ? 0.35 : -0.35), 6.4, 0);
      g.add(lampGlow);

      g.position.set(xCenter, 0, 0);
      this.group.add(g);

      // Collision solide pour que le joueur ne rentre pas dans le bâtiment
      this.boxes.push({
        minX: xCenter - 10.2,
        maxX: xCenter + 10.2,
        minZ: -11.2,
        maxZ: 11.2,
      });
    };

    // Dépôt OUEST : Départ des convois (xCenter = -80)
    createDepot(-80, true, 'DÉPÔT CENTRAL');

    // Dépôt EST : Arrivée des convois (xCenter = 80)
    createDepot(80, false, 'TERMINAL DES ARTS');
  }
}
