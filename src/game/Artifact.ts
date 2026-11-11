/**
 * Œuvre d'art 3D (tableau accroché au mur, ou sculpture posée au sol).
 * Remplace l'ancien src/museum/Artifact.ts — seule l'API utilisée par museumView.ts est conservée.
 */
import * as THREE from 'three';

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
}

const FRAME_COLORS: Record<string, number> = {
  normal: 0x3b2a15,
  dore: 0xe8b64c,
  diamant: 0x9fd0ff,
  obsidienne: 0x1a1a2e,
};

const SCULPT_COLORS: Record<string, number> = {
  marble: 0xe9e2d0,
  gold: 0xffc83d,
  bronze: 0x8b6914,
  glass: 0xb8d4e8,
  jade: 0x4a9e6a,
};

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

/**
 * Un objet 3D représentant une œuvre d'art dans le musée.
 */
export class Artifact {
  readonly group = new THREE.Group();
  private bobY = 0;
  private isSculpt: boolean;

  constructor(config: ArtifactConfig, _audio: THREE.AudioListener | null) {
    this.isSculpt = config.type === 'SCULPTURE';
    const [px, py, pz] = config.position;
    const [rx, ry, rz] = config.rotation;

    this.group.position.set(px, py, pz);
    this.group.rotation.set(rx, ry, rz);

    if (this.isSculpt) {
      this.buildSculpture(config);
    } else {
      this.buildPainting(config);
    }
  }

  private buildPainting(config: ArtifactConfig): void {
    const s = config.scale;
    const frameColor = FRAME_COLORS[config.frameStyle ?? 'normal'] ?? 0x3b2a15;

    // cadre
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.6 * s, 1.2 * s, 0.08),
      std(frameColor, { roughness: 0.35, metalness: frameColor === 0xe8b64c ? 0.8 : 0.2 }),
    );
    frame.castShadow = true;
    frame.receiveShadow = true;

    // toile (intérieur du cadre)
    const canvas = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 * s, 1.0 * s),
      this.canvasMaterial(config),
    );
    canvas.position.z = 0.045;

    // spot lumineux
    if (config.spot) {
      const spot = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6 * s, 1.2 * s),
        new THREE.MeshBasicMaterial({ color: 0xfff8e0, transparent: true, opacity: 0.08, depthWrite: false }),
      );
      spot.position.z = 0.05;
      this.group.add(spot);
    }

    this.group.add(frame, canvas);
  }

  private canvasMaterial(config: ArtifactConfig): THREE.Material {
    // Pour les url procédurales (gen:...) ou data-url, on génère une couleur d'après le seed
    if (config.url.startsWith('gen:') || config.url.startsWith('data:')) {
      const parts = config.url.split(':');
      const seed = parseInt(parts[2] ?? '0', 10) || 0;
      const hue = (seed * 137.5) % 360;
      const color = new THREE.Color().setHSL(hue / 360, 0.45, 0.5);
      return new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    }

    // URL réelle (art du catalogue) → tentative de chargement de texture
    const loader = new THREE.TextureLoader();
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });
    loader.load(
      config.url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      },
      undefined,
      () => { /* silently ignore load errors */ },
    );
    return mat;
  }

  private buildSculpture(config: ArtifactConfig): void {
    const s = config.scale;
    const color = SCULPT_COLORS[config.material ?? 'marble'] ?? 0xe9e2d0;
    const mat = std(color, {
      roughness: config.material === 'glass' ? 0.1 : config.material === 'gold' ? 0.25 : 0.4,
      metalness: config.material === 'gold' || config.material === 'bronze' ? 0.8 : 0.1,
    });

    let mesh: THREE.Mesh;
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
        this.group.add(g);
        // piédestal
        this.addPedestal(s, color);
        return;
      }
      case 'monolith':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 1.8 * s, 0.3 * s), mat);
        mesh.position.y = 0.9 * s;
        break;
      default: // knot
        mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.4 * s, 0.12 * s, 80, 16), mat);
        mesh.position.y = 1.0 * s;
        break;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // piédestal
    this.addPedestal(s, color);
  }

  private addPedestal(s: number, color: number): void {
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35 * s, 0.4 * s, 0.25, 24),
      std(color, { roughness: 0.3 }),
    );
    ped.position.y = 0.125;
    ped.castShadow = true;
    ped.receiveShadow = true;
    this.group.add(ped);
  }

  /** Met à jour l'animation (léger balancement des sculptures). */
  update(t: number, _dt: number): void {
    if (this.isSculpt) {
      this.bobY = Math.sin(t * 2) * 0.02;
      // on ne modifie que la position y relative du premier enfant sculpture
      const child = this.group.children[0];
      if (child && !child.userData.floor) {
        child.position.y += this.bobY;
      }
    }
  }

  /** Libère la géométrie et les matériaux. */
  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      }
    });
  }
}
