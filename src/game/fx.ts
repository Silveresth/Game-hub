// Petits effets visuels partagés : étincelles au-dessus des grandes œuvres, pièces de la « pluie d'or »,
// poussière de course et onde de choc du coup de parapluie. Tout est animé par updateFx(t, dt) une fois par image.
import * as THREE from 'three';
import { shadowMode } from './quality';

let dotTex: THREE.Texture | null = null;
/** Petit point lumineux doux (dégradé radial), partagé par tous les effets. */
function dot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

// ------------------------------------------------------------------ étincelles

const sparkles = new Set<Sparkles>();
let sparkleDist = 40;
let sparkleCap = 48;

/** Distance et nombre d'étincelles selon le palier. Les œuvres trop loin s'éteignent. */
export function setSparkleBudget(dist: number, cap: number): void {
  sparkleDist = dist;
  sparkleCap = cap;
}

/** Cache les étincelles hors de portée. N'en rallume pas : le musée décide déjà si l'œuvre est dessinée. */
export function cullSparkles(cam: THREE.Vector3): void {
  let shown = 0;
  const far = sparkleDist * sparkleDist;
  const near = (sparkleDist * 0.55) * (sparkleDist * 0.55);
  for (const s of sparkles) {
    if (!s.points.visible) continue;
    const dx = s.base.x - cam.x;
    const dz = s.base.z - cam.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > far || (d2 > near && shown >= sparkleCap)) {
      s.points.visible = false;
      continue;
    }
    shown++;
  }
}

/** Étincelles qui flottent autour d'une œuvre précieuse (Épique et plus, cadres diamant / arc-en-ciel). */
export class Sparkles {
  readonly points: THREE.Points;
  private seeds: Float32Array;
  readonly base: THREE.Vector3;
  private rainbow: boolean;
  /** Flocons (mutation Givrée) : ils descendent au lieu de monter. */
  private snow: boolean;

  constructor(at: THREE.Vector3, color: string, opts: { count?: number; radius?: number; height?: number; rainbow?: boolean; snow?: boolean } = {}) {
    const n = opts.count ?? 14;
    const pos = new Float32Array(n * 3);
    this.seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.seeds[i * 4] = Math.random() * Math.PI * 2; // angle
      this.seeds[i * 4 + 1] = (0.35 + Math.random() * 0.65) * (opts.radius ?? 0.9); // rayon
      this.seeds[i * 4 + 2] = Math.random(); // phase verticale
      this.seeds[i * 4 + 3] = (opts.height ?? 2.2) * (0.6 + Math.random() * 0.4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: dot(),
      color: new THREE.Color(color),
      size: 0.16,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.base = at.clone();
    this.rainbow = !!opts.rainbow;
    this.snow = !!opts.snow;
    sparkles.add(this);
  }

  update(t: number): void {
    if (!this.points.visible) return;
    const arr = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const n = arr.length / 3;
    for (let i = 0; i < n; i++) {
      const a = this.seeds[i * 4] + t * 0.6;
      const r = this.seeds[i * 4 + 1];
      const v = (this.seeds[i * 4 + 2] + t * 0.18) % 1;
      arr[i * 3] = this.base.x + Math.cos(a) * r;
      arr[i * 3 + 1] = this.base.y + (this.snow ? 1 - v : v) * this.seeds[i * 4 + 3];
      arr[i * 3 + 2] = this.base.z + Math.sin(a) * r;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    const m = this.points.material as THREE.PointsMaterial;
    m.size = 0.13 + Math.sin(t * 5) * 0.04;
    if (this.rainbow) m.color.setHSL((t * 0.2) % 1, 0.9, 0.65);
  }

  dispose(): void {
    sparkles.delete(this);
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ pièces de la pluie d'or

const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 22);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.9, roughness: 0.22, emissive: 0x6b4300, emissiveIntensity: 0.6 });
let glowMat: THREE.SpriteMaterial | null = null;
const coinGlow = () => (glowMat ??= new THREE.SpriteMaterial({ map: dot(), color: 0xffc93c, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));

// pluies saisonnières : cadeaux emballés, bonbons, œufs décorés (au lieu des pièces)
const PARTY = [0xff3b5c, 0x2ec4f1, 0x3ddc84, 0xffd23f, 0xb46bff, 0xff8c42];
const partyMats = new Map<number, THREE.MeshStandardMaterial>();
const partyMat = (c: number) => {
  let m = partyMats.get(c);
  if (!m) partyMats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.1, emissive: c, emissiveIntensity: 0.18 })));
  return m;
};
const giftBox = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const ribbonA = new THREE.BoxGeometry(0.64, 0.64, 0.14);
const ribbonB = new THREE.BoxGeometry(0.14, 0.64, 0.64);
const bow = new THREE.TorusGeometry(0.12, 0.045, 8, 16);
const candyBody = new THREE.SphereGeometry(0.24, 16, 12);
const candyEnd = new THREE.ConeGeometry(0.16, 0.24, 10);
const eggGeo = new THREE.SphereGeometry(0.3, 18, 14);
const eggBand = new THREE.TorusGeometry(0.29, 0.04, 8, 24);

/** Objet à ramasser selon la pluie en cours : pièce d'or, cadeau, bonbon ou œuf. */
function pickupMesh(style: string): THREE.Object3D {
  const c = PARTY[Math.floor(Math.random() * PARTY.length)];
  const c2 = PARTY[(PARTY.indexOf(c) + 3) % PARTY.length];
  if (style === 'cadeaux') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(giftBox, partyMat(c)), new THREE.Mesh(ribbonA, partyMat(c2)), new THREE.Mesh(ribbonB, partyMat(c2)));
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(bow, partyMat(c2));
      b.position.set(s * 0.1, 0.38, 0);
      b.rotation.y = s * 0.5;
      g.add(b);
    }
    return g;
  }
  if (style === 'bonbons') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(candyBody, partyMat(c));
    body.scale.set(1.3, 1, 1);
    g.add(body);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(candyEnd, partyMat(c2));
      end.rotation.z = (s * Math.PI) / 2;
      end.position.x = s * 0.4;
      g.add(end);
    }
    return g;
  }
  if (style === 'oeufs') {
    const egg = new THREE.Mesh(eggGeo, partyMat(c));
    egg.scale.set(1, 1.35, 1);
    const band = new THREE.Mesh(eggBand, partyMat(c2));
    band.rotation.x = Math.PI / 2;
    egg.add(band);
    return egg;
  }
  return new THREE.Mesh(coinGeo, coinMat);
}

interface CoinRec {
  id: number;
  x: number;
  z: number;
  born: number;
  seed: number;
  /** Null pour une pièce d'or (maillage instancié). */
  mesh: THREE.Object3D | null;
}

const GOLD_MAX = 96;
const coinDummy = new THREE.Object3D();

function coinHeight(age: number, seed: number, t: number): number {
  const fall = Math.max(0, 9 - age * age * 14);
  const bob = 0.55 + Math.sin(t * 3 + seed) * 0.12;
  return fall > 0 ? Math.max(bob, fall) : bob;
}

export class Coins {
  readonly group = new THREE.Group();
  private map = new Map<number, CoinRec>();
  /** Forme des objets qui tombent : « pluie » (pièces d'or), « cadeaux », « bonbons », « oeufs ». */
  style = 'pluie';
  private gold: THREE.InstancedMesh;

  constructor(scene: THREE.Scene) {
    this.gold = new THREE.InstancedMesh(coinGeo, coinMat, GOLD_MAX);
    this.gold.count = 0;
    this.gold.frustumCulled = false;
    this.gold.castShadow = shadowMode !== 'low';
    this.group.add(this.gold);
    scene.add(this.group);
  }

  add(list: Array<{ id: number; x: number; z: number }>, now = performance.now()): void {
    for (const c of list) {
      if (this.map.has(c.id)) continue;
      if (this.style === 'pluie') {
        if (this.map.size >= GOLD_MAX) continue;
        this.map.set(c.id, { id: c.id, x: c.x, z: c.z, born: now, seed: Math.random() * 6, mesh: null });
        continue;
      }
      const mesh = pickupMesh(this.style);
      mesh.position.set(c.x, 9, c.z);
      mesh.traverse((o) => (o.castShadow = true));
      const glow = new THREE.Sprite(coinGlow());
      glow.scale.setScalar(1.6);
      mesh.add(glow);
      this.group.add(mesh);
      this.map.set(c.id, { id: c.id, x: c.x, z: c.z, born: now, seed: Math.random() * 6, mesh });
    }
  }

  remove(ids: number[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const now = performance.now();
    for (const id of ids) {
      const c = this.map.get(id);
      if (!c) continue;
      const y = c.mesh ? c.mesh.position.y : coinHeight((now - c.born) / 1000, c.seed, now / 1000);
      out.push(new THREE.Vector3(c.x, y, c.z));
      c.mesh?.removeFromParent();
      this.map.delete(id);
    }
    return out;
  }

  clear(): void {
    this.remove([...this.map.keys()]);
  }

  get size(): number {
    return this.map.size;
  }

  /** Pièce la plus proche (pour la flèche « ramasse ! » et l'aimant visuel). */
  nearest(p: THREE.Vector3): { id: number; dist: number } | null {
    let best: { id: number; dist: number } | null = null;
    for (const c of this.map.values()) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (!best || d < best.dist) best = { id: c.id, dist: d };
    }
    return best;
  }

  update(t: number, now = performance.now()): void {
    let n = 0;
    for (const c of this.map.values()) {
      const age = (now - c.born) / 1000;
      const y = coinHeight(age, c.seed, t);
      const ry = t * 3 + c.seed;
      if (c.mesh) {
        c.mesh.position.y = y;
        c.mesh.rotation.y = ry;
        continue;
      }
      if (n >= GOLD_MAX) continue;
      coinDummy.position.set(c.x, y, c.z);
      coinDummy.rotation.set(0, ry, 0);
      coinDummy.scale.set(1, 1, 1);
      coinDummy.updateMatrix();
      this.gold.setMatrixAt(n, coinDummy.matrix);
      n++;
    }
    this.gold.count = n;
    this.gold.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ poussière & chocs (particules éphémères)

interface Puff {
  mesh: THREE.Sprite | THREE.Mesh;
  life: number;
  max: number;
  vel: THREE.Vector3;
  grow: number;
  on: boolean;
  kind: 'dust' | 'ring' | 'star';
}

const pool: Puff[] = [];
let fxScene: THREE.Scene | null = null;
const ringGeo = new THREE.RingGeometry(0.3, 0.42, 24);
const _zero = new THREE.Vector3();

function take(kind: Puff['kind']): Puff | null {
  for (const p of pool) if (!p.on && p.kind === kind) return p;
  if (pool.length > 96) return null;
  let mesh: THREE.Sprite | THREE.Mesh;
  if (kind === 'ring') {
    mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
  } else {
    mesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dot(),
      transparent: true,
      depthWrite: false,
      blending: kind === 'star' ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
  }
  const p: Puff = { mesh, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, on: false, kind };
  pool.push(p);
  return p;
}

function spawn(p: Puff): void {
  p.on = true;
  p.life = 0;
  p.mesh.visible = true;
  if (p.mesh.parent !== fxScene) fxScene!.add(p.mesh);
}

export function initFx(scene: THREE.Scene): void {
  fxScene = scene;
}

let moteAcc = 0;
/** Poussière lente dans un musée (une particule de temps en temps, pas à chaque image). */
export function motes(at: THREE.Vector3, dt: number): void {
  moteAcc += dt;
  if (moteAcc < 0.45) return;
  moteAcc = 0;
  const p = take('dust');
  if (!p) return;
  const s = p.mesh as THREE.Sprite;
  (s.material as THREE.SpriteMaterial).color.setHex(0xf4efe4);
  s.position.set(at.x + (Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 1.4, at.z + (Math.random() - 0.5) * 2.4);
  s.scale.setScalar(0.18);
  p.max = 2.4;
  p.vel.set((Math.random() - 0.5) * 0.15, 0.08, (Math.random() - 0.5) * 0.15);
  p.grow = 0.15;
  spawn(p);
}

/** Petit nuage de poussière sous les pieds (course, atterrissage). */
export function dust(at: THREE.Vector3, n = 1, spread = 0.25): void {
  if (!fxScene) return;
  for (let i = 0; i < n; i++) {
    const p = take('dust');
    if (!p) return;
    const s = p.mesh as THREE.Sprite;
    (s.material as THREE.SpriteMaterial).color.setHex(0xe9dcc4);
    s.position.set(at.x + (Math.random() - 0.5) * spread, 0.12 + Math.random() * 0.1, at.z + (Math.random() - 0.5) * spread);
    s.scale.setScalar(0.35);
    p.max = 0.55 + Math.random() * 0.25;
    p.vel.set((Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8);
    p.grow = 1.4;
    spawn(p);
  }
}

/** Onde de choc + étoiles colorées (coup de parapluie, pièce ramassée…). */
export function burst(at: THREE.Vector3, color: number, big = false): void {
  if (!fxScene) return;
  const ring = take('ring');
  if (ring) {
    const m = ring.mesh as THREE.Mesh;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.position.set(at.x, at.y + 0.08, at.z);
    m.scale.setScalar(1);
    ring.max = 0.45;
    ring.vel.copy(_zero);
    ring.grow = big ? 9 : 5;
    spawn(ring);
  }
  const n = big ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const p = take('star');
    if (!p) return;
    const s = p.mesh as THREE.Sprite;
    (s.material as THREE.SpriteMaterial).color.setHex(color);
    s.position.set(at.x, at.y + 1.1, at.z);
    s.scale.setScalar(0.3);
    const a = (i / n) * Math.PI * 2;
    p.max = 0.6;
    p.vel.set(Math.cos(a) * 3.2, 2.5 + Math.random() * 1.5, Math.sin(a) * 3.2);
    p.grow = 0.2;
    spawn(p);
  }
}

/** Éclats plus denses quand la rareté monte (0 commun → 4 mythique). */
export function rarityBurst(at: THREE.Vector3, color: number, level: number): void {
  burst(at, color, level >= 3);
  const extra = Math.min(12, level * 3);
  for (let i = 0; i < extra; i++) {
    const p = take('star');
    if (!p) return;
    const s = p.mesh as THREE.Sprite;
    (s.material as THREE.SpriteMaterial).color.setHex(color);
    s.position.set(at.x, at.y + 1.3, at.z);
    s.scale.setScalar(0.22 + level * 0.04);
    const a = (i / Math.max(1, extra)) * Math.PI * 2;
    p.max = 0.7;
    p.vel.set(Math.cos(a) * (2 + level), 3 + level * 0.4, Math.sin(a) * (2 + level));
    p.grow = 0.15;
    spawn(p);
  }
}

export function updateFx(t: number, dt: number): void {
  for (const s of sparkles) s.update(t);
  for (const p of pool) {
    if (!p.on) continue;
    p.life += dt;
    const k = p.life / p.max;
    if (k >= 1) {
      p.on = false;
      p.mesh.visible = false;
      continue;
    }
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.kind === 'star') p.vel.y -= 7 * dt;
    p.mesh.scale.multiplyScalar(1 + p.grow * dt);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (p.kind === 'ring' ? 0.9 : 0.6);
  }
}
