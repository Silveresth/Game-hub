import * as THREE from 'three';
import type { ArtifactConfig, SculptureForm, SculptureMaterial } from './types';
import { isGenSpec, renderGenArt } from './art';

export const SCULPTURE_FORMS: Record<SculptureForm, string> = {
  knot: 'Nœud', orb: 'Gemme', spiral: 'Spirale', rings: 'Anneaux', monolith: 'Monolithe',
};
export const SCULPTURE_MATERIALS: Record<SculptureMaterial, { label: string; swatch: string }> = {
  marble: { label: 'Marbre', swatch: '#f2efe8' },
  gold: { label: 'Or', swatch: '#e8b64c' },
  bronze: { label: 'Bronze', swatch: '#a0612f' },
  glass: { label: 'Verre', swatch: '#bfe6ff' },
  jade: { label: 'Jade', swatch: '#3fa77a' },
};

const FRAME_COLOR = 0x1d140d;
const SCULPTURE_RADIUS = 0.6;

// Texture de halo partagée (jamais libérée)
let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,240,210,.75)');
  grad.addColorStop(0.45, 'rgba(255,230,190,.28)');
  grad.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.userData.shared = true;
  return glowTexture;
}

function glowMaterial(opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: glow(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      if (mat.map && !mat.map.userData.shared) mat.map.dispose();
      mat.dispose();
    }
  });
}

function sculptureMaterial(kind: SculptureMaterial): THREE.Material {
  switch (kind) {
    case 'gold': return new THREE.MeshStandardMaterial({ color: 0xe8b64c, metalness: 1, roughness: 0.22 });
    case 'bronze': return new THREE.MeshStandardMaterial({ color: 0xa0612f, metalness: 0.9, roughness: 0.38 });
    // Verre « bon marché » (sans passe de transmission, qui re-rend toute la scène à chaque image)
    case 'glass': return new THREE.MeshPhysicalMaterial({
      color: 0xcfeeff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.45,
      clearcoat: 1, envMapIntensity: 2, side: THREE.DoubleSide, depthWrite: false,
    });
    case 'jade': return new THREE.MeshPhysicalMaterial({ color: 0x3fa77a, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    default: return new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.3, clearcoat: 0.4 });
  }
}

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 6;
    const r = 0.3 * (1 - t * 0.45);
    return target.set(Math.cos(a) * r, t * 0.95 - 0.47, Math.sin(a) * r);
  }
}

function sculptureObject(form: SculptureForm, mat: THREE.Material): THREE.Object3D {
  switch (form) {
    case 'orb': {
      (mat as THREE.MeshStandardMaterial).flatShading = true;
      return new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat);
    }
    case 'spiral':
      return new THREE.Mesh(new THREE.TubeGeometry(new HelixCurve(), 240, 0.055, 14), mat);
    case 'rings': {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4 - i * 0.08, 0.04, 16, 72), mat);
        ring.rotation.set((i * Math.PI) / 3, (i * Math.PI) / 4, 0);
        g.add(ring);
      }
      return g;
    }
    case 'monolith': {
      const geo = new THREE.BoxGeometry(0.32, 0.95, 0.32, 1, 32, 1);
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const a = (y + 0.475) * 1.7;
        const x = p.getX(i);
        const z = p.getZ(i);
        p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
      }
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    }
    default:
      return new THREE.Mesh(new THREE.TorusKnotGeometry(0.27, 0.085, 200, 24), mat);
  }
}

/** Une œuvre : cadre photo, plaque sonore spatialisée ou sculpture sur socle, avec éclairage d'ambiance. */
export class Artifact {
  readonly group = new THREE.Group();
  private audio?: THREE.PositionalAudio;
  private rings: THREE.Mesh[] = [];
  private spinner?: THREE.Object3D;
  private disposed = false;

  constructor(public config: ArtifactConfig, private listener: THREE.AudioListener) {
    this.group.userData.artifactId = config.id;
    this.rebuild();
  }

  /** Cercle de collision au sol (sculptures uniquement). */
  get collider(): { x: number; z: number; r: number } | null {
    if (this.config.type !== 'SCULPTURE') return null;
    return { x: this.config.position[0], z: this.config.position[2], r: SCULPTURE_RADIUS * Math.max(1, this.config.scale * 0.8) };
  }

  rebuild(): void {
    this.clear();
    const c = this.config;
    this.group.position.fromArray(c.position);
    this.group.rotation.set(c.rotation[0], c.rotation[1], c.rotation[2]);
    if (c.type === 'PHOTO') this.loadPhoto();
    else if (c.type === 'AUDIO') this.buildAudio();
    else this.buildSculpture();
  }

  update(time: number, dt: number): void {
    const playing = this.audio?.isPlaying ?? false;
    this.rings.forEach((r, i) => {
      const t = (time * 0.6 + i / this.rings.length) % 1;
      r.scale.setScalar(1 + t * 1.6);
      (r.material as THREE.MeshBasicMaterial).opacity = playing ? (1 - t) * 0.5 : 0.08;
    });
    if (this.spinner) this.spinner.rotation.y += dt * 0.35;
  }

  startAudio(): void {
    if (this.audio && !this.audio.isPlaying && this.audio.buffer) this.audio.play();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  // ---------------------------------------------------------------- construction

  private clear(): void {
    if (this.audio) {
      if (this.audio.isPlaying) this.audio.stop();
      this.audio.disconnect();
      this.audio = undefined;
    }
    this.rings = [];
    this.spinner = undefined;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeTree(child);
    }
  }

  private loadPhoto(): void {
    const url = this.config.url;
    if (isGenSpec(url)) {
      const tex = new THREE.CanvasTexture(renderGenArt(url));
      this.buildPhoto(4 / 3, tex);
      return;
    }
    this.buildPhoto(4 / 3, null);
    new THREE.TextureLoader().load(url, (tex) => {
      if (this.disposed) return tex.dispose();
      const img = tex.image as { width: number; height: number };
      this.buildPhoto(img.width / img.height, tex);
    });
  }

  private buildPhoto(aspect: number, tex: THREE.Texture | null): void {
    this.clear();
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
    }
    const long = 1.4 * this.config.scale;
    const w = aspect >= 1 ? long : long * aspect;
    const h = aspect >= 1 ? long / aspect : long;
    const border = 0.09 * this.config.scale;

    const style = this.config.frameStyle ?? 'normal';
    const frameMat =
      style === 'dore' ? new THREE.MeshStandardMaterial({ color: 0xd9a93c, roughness: 0.22, metalness: 1, emissive: 0x3a2600, emissiveIntensity: 0.4 })
      : style === 'diamant' ? new THREE.MeshPhysicalMaterial({ color: 0xe3f6ff, roughness: 0.04, metalness: 0.5, clearcoat: 1, emissive: 0x58b4ff, emissiveIntensity: 0.35 })
      : new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.45, metalness: 0.1 });
    const thick = style === 'normal' ? 0.12 : 0.22;
    // profondeur 0.07 : la face avant du cadre (z = 0.035) reste derrière le passe-partout (0.036) et l'image (0.038)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + border * 2 + thick, h + border * 2 + thick, 0.07), frameMat);
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(w + border * 2, h + border * 2),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95 }),
    );
    mat.position.z = 0.036;
    const img = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: tex ? 0xffffff : 0x555555, map: tex, roughness: 0.75,
        emissive: tex ? 0xffffff : 0x000000, emissiveMap: tex, emissiveIntensity: this.config.spot ? 0.32 : 0.1,
      }),
    );
    img.position.z = 0.038;
    this.group.add(frame, mat, img);
    this.addLabel(-(h / 2) - border - 0.26, 0.04);
    if (this.config.spot) this.addWallLight(w + border * 2, h + border * 2);
  }

  private buildAudio(): void {
    const r = 0.28 * this.config.scale;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.35, metalness: 0.6 }),
    );
    disc.rotation.x = Math.PI / 2;
    const icon = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.85, 40),
      new THREE.MeshBasicMaterial({ map: speakerTexture(), transparent: true }),
    );
    icon.position.z = 0.032;
    this.group.add(disc, icon);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.05, r * 1.1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.1, depthWrite: false }),
      );
      ring.position.z = 0.04;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.addLabel(-r - 0.22, 0.02);
    if (this.config.spot) this.addWallLight(r * 2.2, r * 2.2);

    this.audio = new THREE.PositionalAudio(this.listener);
    this.audio.setDistanceModel('exponential');
    this.audio.setRefDistance(1.5);
    this.audio.setRolloffFactor(2); // atténuation quadratique avec la distance
    this.audio.setMaxDistance(16);
    this.audio.setLoop(true);
    this.group.add(this.audio);
    new THREE.AudioLoader().load(
      this.config.url,
      (buffer) => {
        if (this.disposed || !this.audio) return;
        this.audio.setBuffer(buffer);
        if (this.listener.context.state === 'running') this.audio.play();
      },
      undefined,
      () => console.warn('Audio illisible :', this.config.title),
    );
  }

  private buildSculpture(): void {
    const s = this.config.scale;
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.0, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xece7dd, roughness: 0.6 }),
    );
    pedestal.position.y = 0.5;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.05, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.3, metalness: 0.5 }),
    );
    cap.position.y = 1.025;
    this.group.add(pedestal, cap);

    const holder = new THREE.Group();
    holder.add(sculptureObject(this.config.form ?? 'knot', sculptureMaterial(this.config.material ?? 'marble')));
    holder.scale.setScalar(s);
    holder.position.y = 1.05 + 0.5 * s;
    this.group.add(holder);
    this.spinner = holder;

    this.addLabel(0.72, 0.405);

    if (this.config.spot) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.95, 3.6, 32, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff1d6, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        }),
      );
      beam.position.y = 1.0 + 1.8;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), glowMaterial(0.8));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.012;
      this.group.add(beam, pool);
    }
  }

  /** Halo lumineux sur le mur + petite applique : effet de spot sans coût de lumière dynamique. */
  private addWallLight(w: number, h: number): void {
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.1, h * 2.4), glowMaterial());
    halo.position.set(0, h * 0.15, 0.005);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.8, roughness: 0.3 }),
    );
    arm.position.set(0, h / 2 + 0.32, 0.16);
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.09, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.8, roughness: 0.3, emissive: 0xffe2b0, emissiveIntensity: 0.4 }),
    );
    lamp.rotation.x = -Math.PI / 4;
    lamp.position.set(0, h / 2 + 0.27, 0.34);
    this.group.add(halo, arm, lamp);
  }

  private addLabel(y: number, z: number): void {
    const text = this.config.title;
    if (!text) return;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ece6d8';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#1a1612';
    g.font = '600 38px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.slice(0, 28), 256, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.11), new THREE.MeshBasicMaterial({ map: tex }));
    label.position.set(0, y, z);
    this.group.add(label);
  }
}

let speakerTex: THREE.CanvasTexture | null = null;
function speakerTexture(): THREE.CanvasTexture {
  if (speakerTex) return speakerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffb454';
  g.beginPath();
  g.moveTo(34, 52); g.lineTo(54, 52); g.lineTo(78, 32); g.lineTo(78, 96); g.lineTo(54, 76); g.lineTo(34, 76);
  g.closePath();
  g.fill();
  g.strokeStyle = '#ffb454';
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (const rad of [16, 30]) {
    g.beginPath();
    g.arc(80, 64, rad, -0.9, 0.9);
    g.stroke();
  }
  speakerTex = new THREE.CanvasTexture(c);
  speakerTex.colorSpace = THREE.SRGBColorSpace;
  speakerTex.userData.shared = true;
  return speakerTex;
}
