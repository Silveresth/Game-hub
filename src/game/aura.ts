import * as THREE from 'three';
import type { RarityId } from './catalog';

/**
 * Auras VFX colorées pour les Brainrots selon leur rareté :
 * - Commune (Gris / Blanc doux)
 * - Rare (Bleu / Cyan néon pulsant)
 * - Épique (Violet néon étincelant)
 * - Légendaire (Doré brillant avec particules solaires)
 * - Secrète (Effet Rainbow Glitch néon iridescent)
 */
export class BrainrotAura {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private glowPill: THREE.Mesh;
  private particles: THREE.Points | null = null;
  private particlePositions: Float32Array | null = null;
  private rarity: RarityId;
  private isSecret: boolean;

  constructor(rarity: RarityId = 'commun') {
    this.rarity = rarity;
    this.isSecret = rarity === 'mythique';

    const colorHex = this.getRarityColor(rarity);

    // 1. Anneau au sol sous le piédestal / Brainrot
    const ringGeo = new THREE.RingGeometry(0.55, 0.72, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.group.add(this.ring);

    // 2. Colonne de lumière / aura verticale transparente
    const pillGeo = new THREE.CylinderGeometry(0.65, 0.65, 1.8, 24, 1, true);
    const pillMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: rarity === 'commun' ? 0.08 : rarity === 'rare' ? 0.18 : 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowPill = new THREE.Mesh(pillGeo, pillMat);
    this.glowPill.position.y = 0.95;
    this.group.add(this.glowPill);

    // 3. Particules d'aura étincelantes (pour Épique, Légendaire, et Secrète)
    if (rarity === 'epique' || rarity === 'legendaire' || this.isSecret) {
      const pCount = this.isSecret ? 32 : rarity === 'legendaire' ? 24 : 14;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(pCount * 3);
      this.particlePositions = new Float32Array(pCount * 3);

      for (let i = 0; i < pCount; i++) {
        const rad = 0.3 + Math.random() * 0.4;
        const ang = Math.random() * Math.PI * 2;
        const py = Math.random() * 1.8;
        pos[i * 3] = Math.cos(ang) * rad;
        pos[i * 3 + 1] = py;
        pos[i * 3 + 2] = Math.sin(ang) * rad;
      }
      this.particlePositions.set(pos);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

      const pMat = new THREE.PointsMaterial({
        color: colorHex,
        size: this.isSecret ? 0.18 : 0.14,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.particles = new THREE.Points(geo, pMat);
      this.group.add(this.particles);
    }
  }

  private getRarityColor(rarity: RarityId): number {
    switch (rarity) {
      case 'rare': return 0x00e5ff; // Cyan néon
      case 'epique': return 0xd500f9; // Violet néon
      case 'legendaire': return 0xffd600; // Or étincelant
      case 'mythique': return 0xff007f; // Magenta / Rainbow secret
      default: return 0xb0bec5; // Gris / Blanc doux
    }
  }

  update(t: number, dt: number): void {
    // 1. Rotation et pulsation de l'anneau
    this.ring.rotation.z += 0.8 * dt;
    const pulse = 1 + Math.sin(t * 3.5) * 0.08;
    this.ring.scale.set(pulse, pulse, 1);

    // 2. Pulsation de l'aura lumineuse
    if (this.glowPill) {
      this.glowPill.rotation.y += 0.5 * dt;
      const mat = this.glowPill.material as THREE.MeshBasicMaterial;
      mat.opacity = (this.rarity === 'commun' ? 0.08 : 0.22) + Math.sin(t * 4) * 0.07;
    }

    // 3. Effet Secret Glitch / Rainbow néon
    if (this.isSecret) {
      const hue = (t * 0.3) % 1;
      const secretCol = new THREE.Color().setHSL(hue, 1.0, 0.58);
      (this.ring.material as THREE.MeshBasicMaterial).color.copy(secretCol);
      (this.glowPill.material as THREE.MeshBasicMaterial).color.copy(secretCol);
      if (this.particles) {
        (this.particles.material as THREE.PointsMaterial).color.copy(secretCol);
      }
      // Effet de micro jitter / glitch
      if (Math.random() < 0.15) {
        this.glowPill.position.x = (Math.random() - 0.5) * 0.08;
        this.glowPill.position.z = (Math.random() - 0.5) * 0.08;
      } else {
        this.glowPill.position.x = 0;
        this.glowPill.position.z = 0;
      }
    }

    // 4. Animation d'élévation des particules
    if (this.particles && this.particlePositions) {
      const attr = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const count = arr.length / 3;
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1] += dt * 0.7; // élévation
        if (arr[i * 3 + 1] > 1.9) {
          arr[i * 3 + 1] = 0.1;
        }
      }
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.glowPill.geometry.dispose();
    (this.glowPill.material as THREE.Material).dispose();
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}
