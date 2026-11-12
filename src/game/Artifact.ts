/**
 * Brainrot 3D Pet & Caractères loufoques inspirés des pures tendances Internet :
 * Skibidi Toilet, Tung Tung, Sigma Chad, Mewing Giga, Grimace, etc.
 * Rendu cartoony Low-Poly & Voxel punchy avec Flat Shading lumineux et auras VFX colorées.
 */
import * as THREE from 'three';
import { BrainrotAura } from './aura';
import { work, type RarityId } from './catalog';

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

const stdFlat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.1,
    flatShading: true,
    ...extra,
  });

export class Artifact {
  readonly group = new THREE.Group();
  private aura: BrainrotAura | null = null;
  private petMesh: THREE.Group = new THREE.Group();
  private rarity: RarityId = 'commun';
  private idleTime = Math.random() * 10;

  constructor(config: ArtifactConfig, _audio: THREE.AudioListener | null) {
    const [px, py, pz] = config.position;
    const [rx, ry, rz] = config.rotation;

    this.group.position.set(px, py, pz);
    this.group.rotation.set(rx, ry, rz);

    // Détermination de la rareté depuis le catalogue
    try {
      const wk = work(config.id);
      if (wk) this.rarity = wk.rarity;
    } catch {
      this.rarity = 'commun';
    }

    // 1. Piédestal Cartoony Voxel stylisé avec bordures dorées ou néon
    this.buildPedestal(config.scale);

    // 2. Modèle 3D Brainrot Pet / Personnage
    this.buildBrainrotPet(config);

    // 3. Aura VFX colorée selon l'échelle de rareté
    this.aura = new BrainrotAura(this.rarity);
    this.group.add(this.aura.group);
  }

  private buildPedestal(s: number): void {
    // Piédestal octogonal ou cylindrique cartoon avec anneaux dorés
    const baseMat = stdFlat(0x1a1d2e, { roughness: 0.4 });
    const trimMat = stdFlat(this.rarity === 'mythique' ? 0xff007f : 0xffd600, {
      metalness: 0.7,
      roughness: 0.2,
      emissive: this.rarity === 'mythique' ? 0x660033 : 0x443300,
      emissiveIntensity: 0.4,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * s, 0.65 * s, 0.22, 12), baseMat);
    base.position.y = 0.11;
    base.castShadow = true;
    base.receiveShadow = true;

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.58 * s, 0.58 * s, 0.05, 12), trimMat);
    ring.position.y = 0.21;
    ring.castShadow = true;

    // Tapis de présentation ou surface d'exposition
    const carpetMat = stdFlat(0x23273e, { roughness: 0.5 });
    const carpet = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * s, 0.5 * s, 0.02, 12), carpetMat);
    carpet.position.y = 0.23;

    this.group.add(base, ring, carpet);
  }

  private buildBrainrotPet(config: ArtifactConfig): void {
    const s = config.scale;
    const g = this.petMesh;
    g.position.y = 0.24;

    const id = config.id;

    if (id.includes('toilet') || id.includes('liseuse') || id.includes('babel')) {
      // Modèle Skibidi Toilet Stylisé
      this.buildSkibidiToilet(g, s);
    } else if (id.includes('pepe') || id.includes('cri')) {
      // Pepe Frog Screaming
      this.buildPepeFrog(g, s);
    } else if (id.includes('doge') || id.includes('menines') || id.includes('dog')) {
      // Doge / Shiba Pet
      this.buildDogePet(g, s);
    } else if (id.includes('sus') || id.includes('soleil-levant')) {
      // Amogus Sus Impostor
      this.buildAmogus(g, s);
    } else if (id.includes('capybara') || id.includes('dame-hermine')) {
      // Capybara Voxel
      this.buildCapybara(g, s);
    } else if (id.includes('penseur') || id.includes('david') || id.includes('sigma') || id.includes('mewing')) {
      // GigaChad / Mewing Moai 🗿
      this.buildMoaiChad(g, s);
    } else {
      // Voxel Meme Pet universel avec écran animé ou tête expressive
      this.buildVoxelMemePet(g, s, config);
    }

    this.group.add(g);
  }

  private buildSkibidiToilet(g: THREE.Group, s: number): void {
    const whiteMat = stdFlat(0xf0f4f8, { roughness: 0.2 });
    const chromeMat = stdFlat(0xcccccc, { metalness: 0.9, roughness: 0.1 });
    const skinMat = stdFlat(0xffcca3, { roughness: 0.4 });
    const hairMat = stdFlat(0x332211, { roughness: 0.8 });

    // Cuve des toilettes
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.25 * s, 0.45 * s, 10), whiteMat);
    bowl.position.y = 0.35 * s;
    bowl.castShadow = true;
    g.add(bowl);

    // Réservoir arrière
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.45 * s, 0.22 * s), whiteMat);
    tank.position.set(0, 0.55 * s, -0.25 * s);
    tank.castShadow = true;
    g.add(tank);

    // Poignée de chasse d'eau
    const flush = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.08 * s), chromeMat);
    flush.rotation.z = Math.PI / 2;
    flush.position.set(-0.21 * s, 0.7 * s, -0.25 * s);
    g.add(flush);

    // Tête humaine émergente
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28 * s, 0.3 * s, 0.28 * s), skinMat);
    head.position.set(0, 0.7 * s, 0.05 * s);
    head.castShadow = true;
    g.add(head);

    // Cheveux
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.1 * s, 0.3 * s), hairMat);
    hair.position.set(0, 0.86 * s, 0.05 * s);
    g.add(hair);

    // Yeux cartoon
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.06 * s, 0.02 * s), eyeMat);
    eyeR.position.set(0.08 * s, 0.72 * s, 0.2 * s);
    const eyeL = eyeR.clone();
    eyeL.position.x = -0.08 * s;
    g.add(eyeR, eyeL);
  }

  private buildPepeFrog(g: THREE.Group, s: number): void {
    const greenMat = stdFlat(0x5ca038, { roughness: 0.5 });
    const lipMat = stdFlat(0xc94a29, { roughness: 0.4 });
    const blueMat = stdFlat(0x1976d2, { roughness: 0.5 });

    // Corps / T-shirt bleu
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.35 * s), blueMat);
    body.position.y = 0.35 * s;
    body.castShadow = true;
    g.add(body);

    // Grosse tête de Pepe verte
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58 * s, 0.42 * s, 0.4 * s), greenMat);
    head.position.set(0, 0.7 * s, 0);
    head.castShadow = true;
    g.add(head);

    // Yeux globuleux cartoony
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const side of [-1, 1]) {
      const eyeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 8, 8), eyeWhiteMat);
      eyeSphere.position.set(side * 0.18 * s, 0.92 * s, 0.1 * s);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.06 * s, 0.04 * s), eyePupilMat);
      pupil.position.set(side * 0.18 * s, 0.92 * s, 0.2 * s);
      g.add(eyeSphere, pupil);
    }

    // Lèvres tombantes iconiques de Pepe
    const lips = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.1 * s, 0.12 * s), lipMat);
    lips.position.set(0, 0.58 * s, 0.22 * s);
    g.add(lips);
  }

  private buildDogePet(g: THREE.Group, s: number): void {
    const furMat = stdFlat(0xe5a93c, { roughness: 0.6 });
    const whiteMat = stdFlat(0xfff5e6, { roughness: 0.5 });
    const blackMat = stdFlat(0x1a1a1a);

    // Corps du Doge Shiba
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.4 * s, 0.55 * s), furMat);
    body.position.set(0, 0.35 * s, 0);
    body.castShadow = true;
    g.add(body);

    // Tête ronde shiba
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.36 * s, 0.38 * s), furMat);
    head.position.set(0, 0.65 * s, 0.22 * s);
    head.castShadow = true;
    g.add(head);

    // Museau blanc
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.16 * s, 0.14 * s), whiteMat);
    snout.position.set(0, 0.6 * s, 0.42 * s);
    g.add(snout);

    // Truffe noire
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.06 * s, 0.04 * s), blackMat);
    nose.position.set(0, 0.65 * s, 0.5 * s);
    g.add(nose);

    // Oreilles pointues
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.16 * s, 4), furMat);
      ear.position.set(side * 0.14 * s, 0.88 * s, 0.22 * s);
      ear.rotation.y = Math.PI / 4;
      g.add(ear);
    }
  }

  private buildAmogus(g: THREE.Group, s: number): void {
    const redMat = stdFlat(0xee2222, { roughness: 0.3 });
    const visorMat = stdFlat(0x70d6ff, { roughness: 0.1, metalness: 0.3 });
    const shadowMat = stdFlat(0x991111);

    // Corps gélule Among Us
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * s, 0.32 * s, 0.65 * s, 12), redMat);
    body.position.y = 0.5 * s;
    body.castShadow = true;
    g.add(body);

    const topDome = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), redMat);
    topDome.position.y = 0.82 * s;
    g.add(topDome);

    // Visière cyan brillante
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36 * s, 0.2 * s, 0.14 * s), visorMat);
    visor.position.set(0, 0.68 * s, 0.26 * s);
    g.add(visor);

    // Sac à dos oxygène
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.45 * s, 0.16 * s), shadowMat);
    backpack.position.set(0, 0.5 * s, -0.36 * s);
    g.add(backpack);

    // Pieds boudins
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 0.22 * s, 8), redMat);
      leg.position.set(side * 0.16 * s, 0.12 * s, 0);
      g.add(leg);
    }
  }

  private buildCapybara(g: THREE.Group, s: number): void {
    const brownMat = stdFlat(0x8d5b4c, { roughness: 0.7 });
    const darkMat = stdFlat(0x56382d);

    // Corps cylindrique dodu
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48 * s, 0.38 * s, 0.7 * s), brownMat);
    body.position.set(0, 0.35 * s, 0);
    body.castShadow = true;
    g.add(body);

    // Tête cubique iconique très calme (OK I pull up)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.34 * s, 0.44 * s), darkMat);
    head.position.set(0, 0.55 * s, 0.38 * s);
    head.castShadow = true;
    g.add(head);

    // Petite orange sur la tête (Meme iconique)
    const orangeMat = stdFlat(0xff9800);
    const orange = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 8, 8), orangeMat);
    orange.position.set(0, 0.78 * s, 0.38 * s);
    g.add(orange);
  }

  private buildMoaiChad(g: THREE.Group, s: number): void {
    const rockMat = stdFlat(0x6b7280, { roughness: 0.7 });
    const goldMat = stdFlat(0xffd600, { metalness: 0.8, roughness: 0.2 });
    const mat = this.rarity === 'legendaire' || this.rarity === 'mythique' ? goldMat : rockMat;

    // Tête Moai 🗿 allongée Voxel
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.9 * s, 0.38 * s), mat);
    head.position.y = 0.65 * s;
    head.castShadow = true;
    g.add(head);

    // Nez proéminent
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.38 * s, 0.16 * s), mat);
    nose.position.set(0, 0.65 * s, 0.24 * s);
    g.add(nose);

    // Menton giga mewing saillant
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.38 * s, 0.18 * s, 0.14 * s), mat);
    chin.position.set(0, 0.28 * s, 0.22 * s);
    g.add(chin);

    // Arcades sourcilières
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.44 * s, 0.12 * s, 0.14 * s), mat);
    brow.position.set(0, 0.88 * s, 0.22 * s);
    g.add(brow);
  }

  private buildVoxelMemePet(g: THREE.Group, s: number, config: ArtifactConfig): void {
    // Pet Voxel Cartoony punchy avec l'image du Brainrot affichée en badge holographique
    const bodyMat = stdFlat(0x283593, { roughness: 0.3 });
    const trimMat = stdFlat(0x00e5ff, { metalness: 0.5, roughness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46 * s, 0.46 * s, 0.46 * s), bodyMat);
    body.position.y = 0.45 * s;
    body.castShadow = true;
    g.add(body);

    // Écran d'affichage / portrait de Brainrot
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.48 * s, 0.48 * s, 0.04 * s), trimMat);
    frame.position.set(0, 0.45 * s, 0.23 * s);
    g.add(frame);

    // Image texture chargée
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42 * s, 0.42 * s),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        map: new THREE.TextureLoader().load(config.url),
      }),
    );
    plane.position.set(0, 0.45 * s, 0.26 * s);
    g.add(plane);

    // Petites cornes / antennes cartoon néon
    for (const side of [-1, 1]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.2 * s, 6), trimMat);
      antenna.position.set(side * 0.18 * s, 0.78 * s, 0);
      antenna.rotation.z = side * -0.25;
      g.add(antenna);
    }
  }

  update(t: number, dt: number): void {
    this.idleTime += dt;
    // Animation de flottement / balancement cartoon (idle bobbing)
    const bob = Math.sin(this.idleTime * 2.8) * 0.04;
    const sway = Math.sin(this.idleTime * 1.8) * 0.05;
    this.petMesh.position.y = 0.24 + bob;
    this.petMesh.rotation.y = sway;

    // Mise à jour de l'aura VFX
    if (this.aura) {
      this.aura.update(t, dt);
    }
  }

  dispose(): void {
    if (this.aura) this.aura.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
