// Petits effets visuels partagés : étincelles au-dessus des grandes œuvres, pièces de la « pluie d'or »,
// poussière de course et onde de choc du coup de parapluie. Tout est animé par updateFx(t, dt) une fois par image.
import * as THREE from 'three';

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

/** Étincelles qui flottent autour d'une œuvre précieuse (Épique et plus, cadres diamant / arc-en-ciel). */
export class Sparkles {
  readonly points: THREE.Points;
  private seeds: Float32Array;
  private base: THREE.Vector3;
  private rainbow: boolean;

  constructor(at: THREE.Vector3, color: string, opts: { count?: number; radius?: number; height?: number; rainbow?: boolean } = {}) {
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
    this.points.frustumCulled = false;
    this.base = at.clone();
    this.rainbow = !!opts.rainbow;
    sparkles.add(this);
  }

  update(t: number): void {
    const arr = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const n = arr.length / 3;
    for (let i = 0; i < n; i++) {
      const a = this.seeds[i * 4] + t * 0.6;
      const r = this.seeds[i * 4 + 1];
      const v = (this.seeds[i * 4 + 2] + t * 0.18) % 1;
      arr[i * 3] = this.base.x + Math.cos(a) * r;
      arr[i * 3 + 1] = this.base.y + v * this.seeds[i * 4 + 3];
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

export class Coins {
  readonly group = new THREE.Group();
  private map = new Map<number, { mesh: THREE.Mesh; born: number; seed: number }>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  add(list: Array<{ id: number; x: number; z: number }>, now = performance.now()): void {
    for (const c of list) {
      if (this.map.has(c.id)) continue;
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.set(c.x, 9, c.z); // elle tombe du ciel
      mesh.castShadow = true;
      // halo doré : on repère les pièces de loin sur la place
      const glow = new THREE.Sprite(coinGlow());
      glow.scale.setScalar(1.6);
      mesh.add(glow);
      this.group.add(mesh);
      this.map.set(c.id, { mesh, born: now, seed: Math.random() * 6 });
    }
  }

  remove(ids: number[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const id of ids) {
      const c = this.map.get(id);
      if (!c) continue;
      out.push(c.mesh.position.clone());
      c.mesh.removeFromParent();
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
    for (const [id, c] of this.map) {
      const d = Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z);
      if (!best || d < best.dist) best = { id, dist: d };
    }
    return best;
  }

  update(t: number, now = performance.now()): void {
    for (const c of this.map.values()) {
      const age = (now - c.born) / 1000;
      // chute avec un petit rebond, puis flottement
      const fall = Math.max(0, 9 - age * age * 14);
      const bob = 0.55 + Math.sin(t * 3 + c.seed) * 0.12;
      c.mesh.position.y = fall > 0 ? Math.max(bob, fall) : bob;
      c.mesh.rotation.y = t * 3 + c.seed;
    }
  }
}

// ------------------------------------------------------------------ poussière & chocs (particules éphémères)

interface Puff {
  mesh: THREE.Sprite | THREE.Mesh;
  life: number;
  max: number;
  vel: THREE.Vector3;
  grow: number;
}

const puffs: Puff[] = [];
let fxScene: THREE.Scene | null = null;
const dustMat = () => new THREE.SpriteMaterial({ map: dot(), color: 0xe9dcc4, transparent: true, opacity: 0.55, depthWrite: false });

export function initFx(scene: THREE.Scene): void {
  fxScene = scene;
}

/** Petit nuage de poussière sous les pieds (course, atterrissage). */
export function dust(at: THREE.Vector3, n = 1, spread = 0.25): void {
  if (!fxScene || puffs.length > 90) return;
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(dustMat());
    s.position.set(at.x + (Math.random() - 0.5) * spread, 0.12 + Math.random() * 0.1, at.z + (Math.random() - 0.5) * spread);
    s.scale.setScalar(0.35);
    fxScene.add(s);
    puffs.push({ mesh: s, life: 0, max: 0.55 + Math.random() * 0.25, vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8), grow: 1.4 });
  }
}

/** Onde de choc + étoiles colorées (coup de parapluie, pièce ramassée…). */
export function burst(at: THREE.Vector3, color: number, big = false): void {
  if (!fxScene) return;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(at.x, at.y + 0.08, at.z);
  fxScene.add(ring);
  puffs.push({ mesh: ring, life: 0, max: 0.45, vel: new THREE.Vector3(), grow: big ? 9 : 5 });
  const n = big ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(at.x, at.y + 1.1, at.z);
    s.scale.setScalar(0.3);
    fxScene.add(s);
    const a = (i / n) * Math.PI * 2;
    puffs.push({ mesh: s, life: 0, max: 0.6, vel: new THREE.Vector3(Math.cos(a) * 3.2, 2.5 + Math.random() * 1.5, Math.sin(a) * 3.2), grow: 0.2 });
  }
}

export function updateFx(t: number, dt: number): void {
  for (const s of sparkles) s.update(t);
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt;
    const k = p.life / p.max;
    if (k >= 1) {
      p.mesh.removeFromParent();
      (p.mesh.material as THREE.Material).dispose();
      if (p.mesh instanceof THREE.Mesh) p.mesh.geometry.dispose();
      puffs.splice(i, 1);
      continue;
    }
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.y -= (p.mesh instanceof THREE.Sprite && p.grow < 1 ? 7 : 0) * dt; // les étoiles retombent
    p.mesh.scale.multiplyScalar(1 + p.grow * dt);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (p.mesh instanceof THREE.Mesh ? 0.9 : 0.6);
  }
}
