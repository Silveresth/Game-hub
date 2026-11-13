/**
 * Œuvre d'art 3D : tableau accroché au mur (aux vraies proportions de l'image) ou sculpture posée au sol.
 */
import * as THREE from 'three';
import { artTextureByUrl, aspectOf, setRainbow } from './textures';

export interface ArtifactConfig {
  id: string;
  type: 'SCULPTURE' | 'PHOTO' | 'AUDIO';
  title: string;
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  spot: boolean;
  frameStyle?: string;
  form?: string;
  material?: string;
  /** Couleur de la rareté : halo lumineux derrière l'œuvre (de plus en plus fort avec la rareté). */
  aura?: string;
  /** Force du halo (0 = aucun, 1 = Mythique). */
  auraLevel?: number;
}

const FRAME_COLORS: Record<string, number> = {
  normal: 0x3b2a15,
  dore: 0xe8b64c,
  diamant: 0x9fd0ff,
  arcenciel: 0xff5ea8,
  // mutations saisonnières
  givre: 0xc8f2ff,
  hante: 0x6b3fb0,
  fleuri: 0xff9ecb,
  solaire: 0xffa526,
  festif: 0xff4f9a,
};
/** Lueur propre des cadres qui « brillent » (mutations). */
const FRAME_GLOW: Record<string, number> = { givre: 0x5fd3ff, hante: 0x9b4dff, solaire: 0xff8a00, festif: 0xff3d8a, fleuri: 0xff6fb0 };

let auraTex: THREE.Texture | null = null;
/** Halo doux (dégradé radial) partagé par toutes les œuvres. */
function auraTexture(): THREE.Texture {
  if (auraTex) return auraTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  auraTex = new THREE.CanvasTexture(c);
  auraTex.colorSpace = THREE.SRGBColorSpace;
  return auraTex;
}

const SCULPT_COLORS: Record<string, number> = {
  marble: 0xeee8da,
  gold: 0xffc83d,
  bronze: 0x7a5a2a,
  glass: 0xb8d4e8,
  jade: 0x4a9e6a,
};

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

/** Dimensions maximales d'une toile (m) avant le facteur d'échelle de l'œuvre. */
const MAX_W = 1.75;
const MAX_H = 1.35;
const FRAME_BORDER = 0.11;

export class Artifact {
  readonly group = new THREE.Group();
  private isSculpt: boolean;
  /** Partie animée d'une sculpture (lévitation douce des formes abstraites) et sa hauteur de repos. */
  private floatPart: THREE.Object3D | null = null;
  private floatBase = 0;
  private disposed = false;

  constructor(config: ArtifactConfig, _audio: THREE.AudioListener | null) {
    this.isSculpt = config.type === 'SCULPTURE';
    const [px, py, pz] = config.position;
    const [rx, ry, rz] = config.rotation;
    this.group.position.set(px, py, pz);
    this.group.rotation.set(rx, ry, rz);
    if (this.isSculpt) this.buildSculpture(config);
    else this.buildPainting(config);
  }

  // ---------------------------------------------------------------- tableaux

  private buildPainting(config: ArtifactConfig): void {
    const s = config.scale;
    const style = config.frameStyle ?? 'normal';
    const frameColor = FRAME_COLORS[style] ?? FRAME_COLORS.normal;
    const metal = style === 'dore' || style === 'diamant' || style === 'solaire' || style === 'givre';
    const glowColor = FRAME_GLOW[style];
    // géométries unitaires, mises à l'échelle selon les proportions de l'image une fois chargée
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 0.08),
      std(frameColor, {
        roughness: metal ? 0.22 : 0.45,
        metalness: metal ? 0.85 : 0.15,
        ...(glowColor ? { emissive: glowColor, emissiveIntensity: 0.55 } : {}),
      }),
    );
    if (glowColor) this.pulseMat = frame.material as THREE.MeshStandardMaterial;
    if (config.frameStyle === 'arcenciel') {
      this.rainbowMat = frame.material as THREE.MeshStandardMaterial;
      setRainbow(this.rainbowMat, true);
    }
    frame.castShadow = true;
    frame.receiveShadow = true;
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), canvasMat);
    canvas.position.z = 0.045;
    this.group.add(frame, canvas);
    let glow: THREE.Mesh | null = null;
    // (une œuvre avec un halo de rareté n'a pas besoin du halo blanc du projecteur, qui le délavait)
    if (config.spot && !(config.aura && (config.auraLevel ?? 0) > 0)) {
      // halo du projecteur, au-dessus du tableau
      glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      glow.position.z = 0.02;
      this.group.add(glow);
    }
    // halo de rareté derrière le cadre : on reconnaît une grande œuvre d'un coup d'œil, même de loin
    let aura: THREE.Mesh | null = null;
    if (config.aura && (config.auraLevel ?? 0) > 0) {
      // mélange normal (pas additif) : sur un mur clair, un halo additif devenait blanc et la couleur se perdait
      aura = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: auraTexture(), color: config.aura, transparent: true, opacity: 0.3 + (config.auraLevel ?? 0) * 0.45, depthWrite: false, toneMapped: false }),
      );
      aura.position.z = 0.015; // devant le mur, derrière la toile (le cadre en cache le centre)
      aura.renderOrder = 1;
      this.aura = aura;
      this.auraBase = (aura.material as THREE.MeshBasicMaterial).opacity;
      this.auraPulse = (config.auraLevel ?? 0) >= 0.75;
      this.group.add(aura);
    }
    // décor de la mutation : glaçons (Givré), fleurs aux coins (Fleuri)
    const deco = new THREE.Group();
    this.group.add(deco);
    const fit = (aspect: number) => {
      let w = MAX_W * s;
      let h = w / aspect;
      if (h > MAX_H * s) {
        h = MAX_H * s;
        w = h * aspect;
      }
      canvas.scale.set(w, h, 1);
      frame.scale.set(w + FRAME_BORDER * 2, h + FRAME_BORDER * 2, 1);
      if (glow) {
        glow.scale.set(w * 1.6, h * 1.5, 1);
        glow.position.y = h * 0.12;
      }
      if (aura) aura.scale.set(w * 2.1, h * 2.1, 1);
      this.buildFrameDeco(deco, style, w + FRAME_BORDER * 2, h + FRAME_BORDER * 2);
    };
    fit(4 / 3);
    if (config.url.startsWith('gen:') || config.url.startsWith('data:')) {
      const seed = parseInt(config.url.split(':')[2] ?? '0', 10) || 0;
      canvasMat.color.setHSL(((seed * 137.5) % 360) / 360, 0.45, 0.5);
      return;
    }
    const { tex, ready } = artTextureByUrl(config.url);
    const apply = (t: THREE.Texture) => {
      if (this.disposed) return;
      canvasMat.map = t;
      canvasMat.color.set(0xffffff);
      canvasMat.needsUpdate = true;
      fit(aspectOf(t));
    };
    if ((tex.image as HTMLImageElement | undefined)?.complete) apply(tex);
    else void ready.then(apply);
  }

  // ---------------------------------------------------------------- sculptures

  private buildSculpture(config: ArtifactConfig): void {
    const s = config.scale;
    const color = SCULPT_COLORS[config.material ?? 'marble'] ?? SCULPT_COLORS.marble;
    const mat = std(color, {
      roughness: config.material === 'glass' ? 0.1 : config.material === 'gold' ? 0.25 : config.material === 'bronze' ? 0.35 : 0.45,
      metalness: config.material === 'gold' || config.material === 'bronze' ? 0.75 : 0.05,
    });
    const figure = buildFigure(config.form ?? '', mat, s);
    if (figure) {
      // statue figurative sur un socle en pierre (pas de lévitation : elle repose sur son socle)
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 0.9, 1.0 * s), std(0xd8d2c4, { roughness: 0.6 }));
      plinth.position.y = 0.45;
      const plinthCap = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.08, 1.1 * s), std(0xc9c2b2, { roughness: 0.5 }));
      plinthCap.position.y = 0.94;
      if (config.frameStyle === 'arcenciel') {
        this.rainbowMat = plinthCap.material as THREE.MeshStandardMaterial;
        setRainbow(this.rainbowMat, true);
      } else if (config.frameStyle && config.frameStyle !== 'normal') {
        // cadre spécial ou mutation : le chapiteau du socle en prend la couleur (et brille pour les mutations)
        const capMat = plinthCap.material as THREE.MeshStandardMaterial;
        capMat.color.setHex(FRAME_COLORS[config.frameStyle] ?? 0xe8b64c);
        capMat.metalness = 0.7;
        capMat.roughness = 0.25;
        const g = FRAME_GLOW[config.frameStyle];
        if (g) {
          capMat.emissive.setHex(g);
          capMat.emissiveIntensity = 0.55;
          this.pulseMat = capMat;
        }
      }
      figure.position.y = 0.98;
      this.group.add(plinth, plinthCap, figure);
      this.group.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
      this.addFloorAura(config, 1.1 * s);
      return;
    }

    let mesh: THREE.Object3D;
    switch (config.form) {
      case 'orb':
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 32, 24), mat);
        mesh.position.y = 1.0 * s;
        break;
      case 'spiral': {
        const curve = new THREE.CatmullRomCurve3(
          Array.from({ length: 40 }, (_, i) => {
            const t = i / 39;
            return new THREE.Vector3(Math.cos(t * Math.PI * 4) * 0.3 * s, t * 1.8 * s, Math.sin(t * Math.PI * 4) * 0.3 * s);
          }),
        );
        mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.08 * s, 12), mat);
        mesh.position.y = 0.25;
        break;
      }
      case 'rings': {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45 * s, 0.06 * s, 16, 40), mat);
          ring.position.y = 0.6 * s + i * 0.4 * s;
          ring.rotation.x = (i * Math.PI) / 3;
          g.add(ring);
        }
        mesh = g;
        break;
      }
      case 'monolith':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 1.8 * s, 0.3 * s), mat);
        mesh.position.y = 0.9 * s + 0.25;
        break;
      default: // knot
        mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.4 * s, 0.12 * s, 80, 16), mat);
        mesh.position.y = 1.0 * s;
        break;
    }
    this.group.add(mesh);
    this.floatPart = mesh;
    this.floatBase = mesh.position.y;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.4 * s, 0.25, 24), std(color, { roughness: 0.3 }));
    ped.position.y = 0.125;
    if (config.frameStyle === 'arcenciel') {
      this.rainbowMat = ped.material as THREE.MeshStandardMaterial;
      setRainbow(this.rainbowMat, true);
    }
    this.group.add(ped);
    this.group.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
    this.addFloorAura(config, 0.8 * s);
  }

  /** Statue : cercle lumineux au sol, à la couleur de la rareté. */
  private addFloorAura(config: ArtifactConfig, r: number): void {
    if (!config.aura || !(config.auraLevel ?? 0)) return;
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 3.2, r * 3.2),
      new THREE.MeshBasicMaterial({ map: auraTexture(), color: config.aura, transparent: true, opacity: 0.35 + (config.auraLevel ?? 0) * 0.45, depthWrite: false, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.castShadow = ring.receiveShadow = false;
    this.aura = ring;
    this.auraBase = (ring.material as THREE.MeshBasicMaterial).opacity;
    this.auraPulse = (config.auraLevel ?? 0) >= 0.75;
    this.group.add(ring);
  }

  /** Glaçons sur le haut du cadre (Givré), petites fleurs aux quatre coins (Fleuri), étoiles (Festif). */
  private buildFrameDeco(deco: THREE.Group, style: string, fw: number, fh: number): void {
    // (reconstruit quand l'image arrive et donne les vraies proportions : l'ancien décor est libéré)
    for (const c of [...deco.children]) {
      deco.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.decoMats.forEach((m) => m.dispose());
    this.decoMats = [];
    if (style === 'givre') {
      const ice = new THREE.MeshStandardMaterial({ color: 0xe6f9ff, emissive: 0x6fd6ff, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.92 });
      this.decoMats.push(ice);
      const n = Math.max(5, Math.round(fw / 0.22));
      for (let i = 0; i < n; i++) {
        const len = 0.1 + ((i * 37) % 7) * 0.035;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.04, len, 6), ice);
        c.rotation.x = Math.PI; // pointe vers le bas
        c.position.set(-fw / 2 + 0.08 + (i / (n - 1)) * (fw - 0.16), fh / 2 - 0.02 - len / 2, 0.07);
        deco.add(c);
      }
      const snow = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.06, 0.07, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
      this.decoMats.push(snow.material as THREE.Material);
      snow.position.set(0, fh / 2 + 0.03, 0.02);
      deco.add(snow);
    } else if (style === 'fleuri' || style === 'festif') {
      const colors = style === 'fleuri' ? [0xff6fb0, 0xffe066, 0xffffff, 0xb57bff] : [0xff3d8a, 0xffd23f, 0x2ec4f1, 0x3ddc84];
      colors.forEach((col, i) => {
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.5 });
        this.decoMats.push(m);
        const g = style === 'fleuri' ? new THREE.SphereGeometry(0.09, 10, 8) : new THREE.OctahedronGeometry(0.1, 0);
        const flower = new THREE.Mesh(g, m);
        flower.position.set((i % 2 ? 1 : -1) * (fw / 2), (i < 2 ? 1 : -1) * (fh / 2), 0.09);
        flower.scale.z = 0.5;
        deco.add(flower);
      });
    }
  }

  /** Animation : légère lévitation des formes abstraites, halo de rareté qui respire, lueur des mutations. */
  update(t: number, _dt: number): void {
    if (this.floatPart) this.floatPart.position.y = this.floatBase + Math.sin(t * 2 + this.group.position.x) * 0.04;
    const ph = t * 2.2 + this.group.position.x * 0.7;
    if (this.aura && this.auraPulse) (this.aura.material as THREE.MeshBasicMaterial).opacity = this.auraBase * (0.75 + Math.sin(ph) * 0.25);
    if (this.pulseMat) this.pulseMat.emissiveIntensity = 0.45 + Math.sin(ph * 1.3) * 0.25;
  }

  private aura: THREE.Mesh | null = null;
  private auraBase = 0;
  private auraPulse = false;
  private pulseMat: THREE.MeshStandardMaterial | null = null;
  private decoMats: THREE.Material[] = [];

  /** Libère géométries et matériaux (les textures d'œuvres sont partagées : elles restent en cache). */
  private rainbowMat: THREE.MeshStandardMaterial | null = null;

  dispose(): void {
    this.disposed = true;
    if (this.rainbowMat) setRainbow(this.rainbowMat, false);
    this.decoMats.forEach((m) => m.dispose());
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    });
  }
}

// ------------------------------------------------------------------ statues figuratives (stylisées)

/** Membre : cylindre de `len` m orienté de `from` vers `to`. */
function limb(mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, r1: number, r2 = r1): THREE.Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 12), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Statue figurative stylisée (formes du catalogue : thinker, venus, victory, david), ou null pour une forme abstraite.
 * Repère : pieds à y = 0, face vers +z.
 */
function buildFigure(form: string, mat: THREE.Material, s: number): THREE.Group | null {
  if (!['thinker', 'venus', 'victory', 'david'].includes(form)) return null;
  const g = new THREE.Group();
  const head = (at: THREE.Vector3) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), mat);
    h.position.copy(at);
    h.scale.set(0.9, 1.1, 1);
    g.add(h);
  };
  const torso = (hip: THREE.Vector3, chest: THREE.Vector3) => g.add(limb(mat, hip, chest, 0.17, 0.21));
  const drape = (top: number, bottom: number, rTop: number, rBottom: number) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, top - bottom, 18, 1, true), mat);
    (d.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    d.position.y = (top + bottom) / 2;
    g.add(d);
  };

  switch (form) {
    case 'thinker': {
      // assis sur un rocher, penché en avant, le menton sur la main
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), mat);
      rock.position.set(0, 0.3, -0.1);
      rock.scale.set(1.1, 0.75, 1);
      g.add(rock);
      const hip = v(0, 0.62, -0.1);
      const chest = v(0, 1.12, 0.12);
      torso(hip, chest);
      head(v(0, 1.33, 0.26));
      for (const sx of [-1, 1]) {
        const knee = v(sx * 0.16, 0.66, 0.38);
        g.add(limb(mat, v(sx * 0.12, 0.6, -0.05), knee, 0.09, 0.075));
        g.add(limb(mat, knee, v(sx * 0.16, 0.05, 0.42), 0.07, 0.055));
      }
      // bras droit : coude sur le genou, main sous le menton
      g.add(limb(mat, v(0.2, 1.08, 0.1), v(0.14, 0.72, 0.36), 0.06));
      g.add(limb(mat, v(0.14, 0.72, 0.36), v(0.03, 1.2, 0.3), 0.055));
      // bras gauche posé sur la cuisse
      g.add(limb(mat, v(-0.2, 1.08, 0.1), v(-0.2, 0.76, 0.3), 0.06));
      g.add(limb(mat, v(-0.2, 0.76, 0.3), v(-0.12, 0.7, 0.55), 0.055));
      break;
    }
    case 'venus': {
      // debout, sans bras, drapé sur les hanches
      drape(1.0, 0.0, 0.2, 0.32);
      const hip = v(0, 0.95, 0);
      const chest = v(0.03, 1.45, 0);
      torso(hip, chest);
      head(v(0.05, 1.66, 0.02));
      // moignons d'épaules
      for (const sx of [-1, 1]) g.add(limb(mat, v(sx * 0.18, 1.42, 0), v(sx * 0.22, 1.3, 0), 0.07, 0.06));
      break;
    }
    case 'victory': {
      // sans tête, grandes ailes déployées, drapé au vent
      drape(1.05, 0.0, 0.2, 0.36);
      const hip = v(0, 0.98, 0);
      const chest = v(0, 1.48, 0.05);
      torso(hip, chest);
      for (const sx of [-1, 1]) {
        const wing = new THREE.Shape();
        wing.moveTo(0, 0);
        wing.quadraticCurveTo(0.5, 0.25, 0.95, 0.9);
        wing.quadraticCurveTo(0.6, 0.55, 0.45, 0.05);
        wing.lineTo(0, 0);
        const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.05, bevelEnabled: false }), mat);
        w.position.set(sx * 0.1, 1.25, -0.12);
        w.scale.x = sx;
        w.rotation.y = sx * -0.5;
        g.add(w);
      }
      break;
    }
    case 'david': {
      // debout en contrapposto, bras gauche levé vers l'épaule
      const hip = v(0.03, 1.0, 0);
      const chest = v(0, 1.55, 0);
      torso(hip, chest);
      head(v(-0.02, 1.78, 0.02));
      g.add(limb(mat, v(0.1, 0.98, 0), v(0.13, 0.5, 0.02), 0.09, 0.075));
      g.add(limb(mat, v(0.13, 0.5, 0.02), v(0.14, 0.04, 0), 0.07, 0.055));
      g.add(limb(mat, v(-0.1, 0.98, 0), v(-0.2, 0.52, -0.04), 0.09, 0.075));
      g.add(limb(mat, v(-0.2, 0.52, -0.04), v(-0.26, 0.04, -0.08), 0.07, 0.055));
      g.add(limb(mat, v(0.21, 1.5, 0), v(0.25, 1.15, 0.02), 0.06));
      g.add(limb(mat, v(0.25, 1.15, 0.02), v(0.24, 0.85, 0.04), 0.055));
      g.add(limb(mat, v(-0.21, 1.5, 0), v(-0.3, 1.22, 0.12), 0.06));
      g.add(limb(mat, v(-0.3, 1.22, 0.12), v(-0.16, 1.5, 0.12), 0.055));
      break;
    }
  }
  g.scale.setScalar(s);
  return g;
}
